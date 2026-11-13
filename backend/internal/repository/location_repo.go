package repository

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"mapup-geofencing/internal/geofence"
	"mapup-geofencing/internal/models"
)

type LocationRepository struct {
	pool *pgxpool.Pool
}

func NewLocationRepository(pool *pgxpool.Pool) *LocationRepository {
	return &LocationRepository{pool: pool}
}

// RecordLocationAndDetectTransitions atomically updates the vehicle's location,
// queries PostGIS ST_Covers (using the GiST spatial index), compares previous vs current
// geofence sets to identify entry/exit transitions, and stores violations.
func (r *LocationRepository) RecordLocationAndDetectTransitions(
	ctx context.Context,
	vehicleID string,
	lat, lon float64,
	recordedAt time.Time,
) ([]models.CurrentGeofenceStatus, []models.TransitionEvent, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, nil, fmt.Errorf("begin location transaction: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// Lock the vehicle row so concurrent updates for the same vehicle serialize cleanly.
	var vehicleNumber, driverName string
	err = tx.QueryRow(ctx, `
		SELECT vehicle_number, driver_name
		FROM vehicles
		WHERE id = $1
		FOR UPDATE
	`, vehicleID).Scan(&vehicleNumber, &driverName)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil, ErrNotFound
		}
		return nil, nil, fmt.Errorf("lock vehicle: %w", err)
	}

	// 1. Read previous geofence membership set for this vehicle.
	prevRows, err := tx.Query(ctx, `
		SELECT g.id, g.name, g.category
		FROM vehicle_geofence_state vgs
		JOIN geofences g ON g.id = vgs.geofence_id
		WHERE vgs.vehicle_id = $1 AND g.status = 'active'
	`, vehicleID)
	if err != nil {
		return nil, nil, fmt.Errorf("query previous geofence state: %w", err)
	}
	var previousRefs []models.GeofenceRef
	for prevRows.Next() {
		var ref models.GeofenceRef
		if err := prevRows.Scan(&ref.ID, &ref.Name, &ref.Category); err != nil {
			prevRows.Close()
			return nil, nil, fmt.Errorf("scan previous geofence state: %w", err)
		}
		previousRefs = append(previousRefs, ref)
	}
	prevRows.Close()
	if err := prevRows.Err(); err != nil {
		return nil, nil, fmt.Errorf("iterate previous geofence state: %w", err)
	}

	// 2. Store location history and update vehicle's latest position.
	// PostGIS ST_MakePoint expects (longitude, latitude).
	locID := "loc_" + uuid.NewString()[:12]
	_, err = tx.Exec(ctx, `
		INSERT INTO vehicle_locations (id, vehicle_id, latitude, longitude, location, recorded_at)
		VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($4, $3), 4326), $5)
	`, locID, vehicleID, lat, lon, recordedAt)
	if err != nil {
		return nil, nil, fmt.Errorf("insert vehicle location: %w", err)
	}

	_, err = tx.Exec(ctx, `
		UPDATE vehicles
		SET current_latitude = $2, current_longitude = $3, last_location_at = $4
		WHERE id = $1
	`, vehicleID, lat, lon, recordedAt)
	if err != nil {
		return nil, nil, fmt.Errorf("update vehicle latest location: %w", err)
	}

	// 3. Evaluate spatial containment with ST_Covers (boundary-inclusive, GiST-indexed).
	// Parameter order: $1 = longitude, $2 = latitude.
	currRows, err := tx.Query(ctx, `
		SELECT id, name, category
		FROM geofences
		WHERE status = 'active'
		  AND ST_Covers(boundary, ST_SetSRID(ST_MakePoint($1, $2), 4326))
		ORDER BY created_at ASC
	`, lon, lat)
	if err != nil {
		return nil, nil, fmt.Errorf("query containing geofences: %w", err)
	}
	var currentRefs []models.GeofenceRef
	currentStatuses := make([]models.CurrentGeofenceStatus, 0)
	currentIDs := make([]string, 0)
	for currRows.Next() {
		var ref models.GeofenceRef
		if err := currRows.Scan(&ref.ID, &ref.Name, &ref.Category); err != nil {
			currRows.Close()
			return nil, nil, fmt.Errorf("scan containing geofence: %w", err)
		}
		currentRefs = append(currentRefs, ref)
		currentIDs = append(currentIDs, ref.ID)
		currentStatuses = append(currentStatuses, models.CurrentGeofenceStatus{
			GeofenceID:   ref.ID,
			GeofenceName: ref.Name,
			Status:       "inside",
		})
	}
	currRows.Close()
	if err := currRows.Err(); err != nil {
		return nil, nil, fmt.Errorf("iterate containing geofences: %w", err)
	}

	// 4. Sync vehicle_geofence_state while preserving original entered_at for unchanged geofences.
	if len(currentIDs) == 0 {
		_, err = tx.Exec(ctx, `DELETE FROM vehicle_geofence_state WHERE vehicle_id = $1`, vehicleID)
	} else {
		_, err = tx.Exec(ctx, `
			DELETE FROM vehicle_geofence_state
			WHERE vehicle_id = $1 AND NOT (geofence_id = ANY($2))
		`, vehicleID, currentIDs)
	}
	if err != nil {
		return nil, nil, fmt.Errorf("prune exited geofence state: %w", err)
	}

	for _, gid := range currentIDs {
		_, err = tx.Exec(ctx, `
			INSERT INTO vehicle_geofence_state (vehicle_id, geofence_id, entered_at)
			VALUES ($1, $2, $3)
			ON CONFLICT (vehicle_id, geofence_id) DO NOTHING
		`, vehicleID, gid, recordedAt)
		if err != nil {
			return nil, nil, fmt.Errorf("upsert geofence state: %w", err)
		}
	}

	// 5. Compare previous vs current sets and record entry/exit transitions in violations.
	entered, exited := geofence.DetectTransitions(previousRefs, currentRefs)
	transitions := make([]models.TransitionEvent, 0, len(entered)+len(exited))

	recordTransitions := func(refs []models.GeofenceRef, eventType string) error {
		for _, g := range refs {
			violID := "viol_" + uuid.NewString()[:12]
			_, err := tx.Exec(ctx, `
				INSERT INTO violations (id, vehicle_id, geofence_id, event_type, latitude, longitude, recorded_at)
				VALUES ($1, $2, $3, $4, $5, $6, $7)
			`, violID, vehicleID, g.ID, eventType, lat, lon, recordedAt)
			if err != nil {
				return fmt.Errorf("insert %s violation: %w", eventType, err)
			}
			transitions = append(transitions, models.TransitionEvent{
				ViolationID:   violID,
				EventType:     eventType,
				VehicleID:     vehicleID,
				VehicleNumber: vehicleNumber,
				DriverName:    driverName,
				GeofenceID:    g.ID,
				GeofenceName:  g.Name,
				Category:      g.Category,
				Latitude:      lat,
				Longitude:     lon,
				OccurredAt:    recordedAt,
			})
		}
		return nil
	}

	if err := recordTransitions(entered, "entry"); err != nil {
		return nil, nil, err
	}
	if err := recordTransitions(exited, "exit"); err != nil {
		return nil, nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, nil, fmt.Errorf("commit location transaction: %w", err)
	}

	return currentStatuses, transitions, nil
}
