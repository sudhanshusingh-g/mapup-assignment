package repository

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"mapup-geofencing/internal/geofence"
	"mapup-geofencing/internal/models"
)

var (
	ErrNotFound        = errors.New("resource not found")
	ErrDuplicate       = errors.New("resource already exists")
	ErrInvalidGeometry = errors.New("invalid polygon geometry")
)

type GeofenceRepository struct {
	pool *pgxpool.Pool
}

func NewGeofenceRepository(pool *pgxpool.Pool) *GeofenceRepository {
	return &GeofenceRepository{pool: pool}
}

// Create validates geometry via PostGIS ST_IsValid and inserts the polygon in SRID 4326.
func (r *GeofenceRepository) Create(ctx context.Context, id, name, description, category string, coords [][]float64) error {
	wkt := geofence.CoordsToWKT(coords)

	var isValid bool
	var reason string
	err := r.pool.QueryRow(ctx, `
		WITH g AS (SELECT ST_GeomFromText($1, 4326) AS geom)
		SELECT ST_IsValid(geom), COALESCE(ST_IsValidReason(geom), '') FROM g
	`, wkt).Scan(&isValid, &reason)
	if err != nil {
		return fmt.Errorf("validate geometry with PostGIS: %w", err)
	}
	if !isValid {
		return fmt.Errorf("%w: %s", ErrInvalidGeometry, reason)
	}

	_, err = r.pool.Exec(ctx, `
		INSERT INTO geofences (id, name, description, category, boundary, status)
		VALUES ($1, $2, $3, $4, ST_GeomFromText($5, 4326), 'active')
	`, id, name, description, category, wkt)
	if err != nil {
		return fmt.Errorf("insert geofence: %w", err)
	}
	return nil
}

// List retrieves geofences optionally filtered by category and optional pagination.
func (r *GeofenceRepository) List(ctx context.Context, category string, limit, offset int) ([]models.GeofenceItem, error) {
	query := `
		SELECT id, name, description, ST_AsGeoJSON(boundary), category, created_at
		FROM geofences
		WHERE status = 'active'
		  AND ($1 = '' OR category = $1)
		ORDER BY created_at DESC
	`
	args := []any{category}
	if limit > 0 {
		query += ` LIMIT $2 OFFSET $3`
		args = append(args, limit, offset)
	}

	rows, err := r.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("list geofences: %w", err)
	}
	defer rows.Close()

	items := make([]models.GeofenceItem, 0)
	for rows.Next() {
		var (
			id, name, desc, cat string
			geoJSONRaw          []byte
			createdAt           time.Time
		)
		if err := rows.Scan(&id, &name, &desc, &geoJSONRaw, &cat, &createdAt); err != nil {
			return nil, fmt.Errorf("scan geofence: %w", err)
		}

		coords, err := geofence.GeoJSONToCoords(geoJSONRaw)
		if err != nil {
			return nil, fmt.Errorf("decode coordinates for %s: %w", id, err)
		}

		items = append(items, models.GeofenceItem{
			ID:          id,
			Name:        name,
			Description: desc,
			Coordinates: coords,
			Category:    cat,
			CreatedAt:   createdAt.UTC().Format(time.RFC3339),
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate geofences: %w", err)
	}
	return items, nil
}
