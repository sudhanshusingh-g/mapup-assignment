package repository

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"mapup-geofencing/internal/models"
)

type VehicleRepository struct {
	pool *pgxpool.Pool
}

func NewVehicleRepository(pool *pgxpool.Pool) *VehicleRepository {
	return &VehicleRepository{pool: pool}
}

func (r *VehicleRepository) Create(ctx context.Context, id, vehicleNumber, driverName, vehicleType, phone string) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO vehicles (id, vehicle_number, driver_name, vehicle_type, phone, status)
		VALUES ($1, $2, $3, $4, $5, 'active')
	`, id, vehicleNumber, driverName, vehicleType, phone)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return fmt.Errorf("%w: vehicle_number %q is already registered", ErrDuplicate, vehicleNumber)
		}
		return fmt.Errorf("insert vehicle: %w", err)
	}
	return nil
}

func (r *VehicleRepository) List(ctx context.Context, limit, offset int) ([]models.VehicleItem, error) {
	query := `
		SELECT id, vehicle_number, driver_name, vehicle_type, phone, status, created_at
		FROM vehicles
		ORDER BY created_at DESC
	`
	var args []any
	if limit > 0 {
		query += ` LIMIT $1 OFFSET $2`
		args = append(args, limit, offset)
	}

	rows, err := r.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("list vehicles: %w", err)
	}
	defer rows.Close()

	vehicles := make([]models.VehicleItem, 0)
	for rows.Next() {
		var (
			item      models.VehicleItem
			createdAt time.Time
		)
		if err := rows.Scan(
			&item.ID,
			&item.VehicleNumber,
			&item.DriverName,
			&item.VehicleType,
			&item.Phone,
			&item.Status,
			&createdAt,
		); err != nil {
			return nil, fmt.Errorf("scan vehicle: %w", err)
		}
		item.CreatedAt = createdAt.UTC().Format(time.RFC3339)
		vehicles = append(vehicles, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate vehicles: %w", err)
	}
	return vehicles, nil
}

func (r *VehicleRepository) GetLocationStatus(ctx context.Context, vehicleID string) (*models.VehicleLocationResponse, error) {
	var (
		vehNumber string
		lat       *float64
		lon       *float64
		locAt     *time.Time
	)
	err := r.pool.QueryRow(ctx, `
		SELECT vehicle_number, current_latitude, current_longitude, last_location_at
		FROM vehicles
		WHERE id = $1
	`, vehicleID).Scan(&vehNumber, &lat, &lon, &locAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("fetch vehicle location: %w", err)
	}

	var currentLoc *models.VehicleLocationPoint
	if lat != nil && lon != nil && locAt != nil {
		currentLoc = &models.VehicleLocationPoint{
			Latitude:  *lat,
			Longitude: *lon,
			Timestamp: locAt.UTC().Format(time.RFC3339),
		}
	}

	rows, err := r.pool.Query(ctx, `
		SELECT g.id, g.name, g.category
		FROM vehicle_geofence_state vgs
		JOIN geofences g ON g.id = vgs.geofence_id
		WHERE vgs.vehicle_id = $1 AND g.status = 'active'
		ORDER BY vgs.entered_at ASC
	`, vehicleID)
	if err != nil {
		return nil, fmt.Errorf("fetch vehicle current geofences: %w", err)
	}
	defer rows.Close()

	geofences := make([]models.VehicleGeofenceInfo, 0)
	for rows.Next() {
		var g models.VehicleGeofenceInfo
		if err := rows.Scan(&g.GeofenceID, &g.GeofenceName, &g.Category); err != nil {
			return nil, fmt.Errorf("scan vehicle geofence: %w", err)
		}
		geofences = append(geofences, g)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate vehicle geofences: %w", err)
	}

	return &models.VehicleLocationResponse{
		VehicleID:        vehicleID,
		VehicleNumber:    vehNumber,
		CurrentLocation:  currentLoc,
		CurrentGeofences: geofences,
	}, nil
}
