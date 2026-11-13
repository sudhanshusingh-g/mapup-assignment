package repository

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"mapup-geofencing/internal/models"
)

var (
	ErrGeofenceNotFound = errors.New("geofence not found")
	ErrVehicleNotFound  = errors.New("vehicle not found")
)

type ViolationFilter struct {
	VehicleID  string
	GeofenceID string
	StartDate  *time.Time
	EndDate    *time.Time
	Limit      int
	Offset     int
}

type AlertRepository struct {
	pool *pgxpool.Pool
}

func NewAlertRepository(pool *pgxpool.Pool) *AlertRepository {
	return &AlertRepository{pool: pool}
}

func (r *AlertRepository) CreateRule(ctx context.Context, id, geofenceID string, vehicleID *string, eventType string) error {
	var exists bool
	if err := r.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM geofences WHERE id = $1)`, geofenceID).Scan(&exists); err != nil {
		return fmt.Errorf("check geofence existence: %w", err)
	}
	if !exists {
		return ErrGeofenceNotFound
	}

	if vehicleID != nil {
		if err := r.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM vehicles WHERE id = $1)`, *vehicleID).Scan(&exists); err != nil {
			return fmt.Errorf("check vehicle existence: %w", err)
		}
		if !exists {
			return ErrVehicleNotFound
		}
	}

	_, err := r.pool.Exec(ctx, `
		INSERT INTO alert_rules (id, geofence_id, vehicle_id, event_type, status)
		VALUES ($1, $2, $3, $4, 'active')
	`, id, geofenceID, vehicleID, eventType)
	if err != nil {
		return fmt.Errorf("insert alert rule: %w", err)
	}
	return nil
}

func (r *AlertRepository) ListRules(ctx context.Context, geofenceID, vehicleID string, limit, offset int) ([]models.AlertRuleItem, error) {
	query := `
		SELECT ar.id, ar.geofence_id, g.name, ar.vehicle_id, v.vehicle_number, ar.event_type, ar.status, ar.created_at
		FROM alert_rules ar
		JOIN geofences g ON g.id = ar.geofence_id
		LEFT JOIN vehicles v ON v.id = ar.vehicle_id
		WHERE ($1 = '' OR ar.geofence_id = $1)
		  AND ($2 = '' OR ar.vehicle_id = $2 OR ar.vehicle_id IS NULL)
		ORDER BY ar.created_at DESC
	`
	// Note: when filtering specifically by vehicle_id, check exact match vs wildcard?
	// Standard REST query ?vehicle_id=veh_456 typically returns rules targeting that vehicle.
	// Let's filter strictly when vehicle_id is provided so filter matches the exact parameter.
	query = `
		SELECT ar.id, ar.geofence_id, g.name, ar.vehicle_id, v.vehicle_number, ar.event_type, ar.status, ar.created_at
		FROM alert_rules ar
		JOIN geofences g ON g.id = ar.geofence_id
		LEFT JOIN vehicles v ON v.id = ar.vehicle_id
		WHERE ($1 = '' OR ar.geofence_id = $1)
		  AND ($2 = '' OR ar.vehicle_id = $2)
		ORDER BY ar.created_at DESC
	`
	args := []any{geofenceID, vehicleID}
	if limit > 0 {
		query += ` LIMIT $3 OFFSET $4`
		args = append(args, limit, offset)
	}

	rows, err := r.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("list alert rules: %w", err)
	}
	defer rows.Close()

	alerts := make([]models.AlertRuleItem, 0)
	for rows.Next() {
		var (
			item      models.AlertRuleItem
			createdAt time.Time
		)
		if err := rows.Scan(
			&item.AlertID,
			&item.GeofenceID,
			&item.GeofenceName,
			&item.VehicleID,
			&item.VehicleNumber,
			&item.EventType,
			&item.Status,
			&createdAt,
		); err != nil {
			return nil, fmt.Errorf("scan alert rule: %w", err)
		}
		item.CreatedAt = createdAt.UTC().Format(time.RFC3339)
		alerts = append(alerts, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate alert rules: %w", err)
	}
	return alerts, nil
}

func (r *AlertRepository) DeleteRule(ctx context.Context, alertID string) error {
	tag, err := r.pool.Exec(ctx, `DELETE FROM alert_rules WHERE id = $1`, alertID)
	if err != nil {
		return fmt.Errorf("delete alert rule: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// FindMatchingRule returns the highest-priority active rule matching the transition event,
// preferring vehicle-specific rules over wildcard (all-vehicle) rules.
func (r *AlertRepository) FindMatchingRule(ctx context.Context, geofenceID, vehicleID, eventType string) (*models.AlertRuleRecord, error) {
	var rule models.AlertRuleRecord
	err := r.pool.QueryRow(ctx, `
		SELECT id, geofence_id, vehicle_id, event_type, status
		FROM alert_rules
		WHERE geofence_id = $1
		  AND status = 'active'
		  AND (vehicle_id IS NULL OR vehicle_id = $2)
		  AND (event_type = 'both' OR event_type = $3)
		ORDER BY (vehicle_id IS NULL) ASC, created_at ASC
		LIMIT 1
	`, geofenceID, vehicleID, eventType).Scan(&rule.ID, &rule.GeofenceID, &rule.VehicleID, &rule.EventType, &rule.Status)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("query matching alert rule: %w", err)
	}
	return &rule, nil
}

// SaveAlertEvent persists a triggered alert payload into the database for historical auditability.
func (r *AlertRepository) SaveAlertEvent(
	ctx context.Context,
	eventID string,
	ruleID string,
	ev models.TransitionEvent,
	payloadJSON []byte,
) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO alert_events (id, alert_rule_id, violation_id, vehicle_id, geofence_id, event_type, latitude, longitude, payload, occurred_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
	`, eventID, ruleID, ev.ViolationID, ev.VehicleID, ev.GeofenceID, ev.EventType, ev.Latitude, ev.Longitude, payloadJSON, ev.OccurredAt)
	if err != nil {
		return fmt.Errorf("insert alert event: %w", err)
	}
	return nil
}

func (r *AlertRepository) ListRecentAlertEvents(ctx context.Context, limit int) ([][]byte, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	rows, err := r.pool.Query(ctx, `
		SELECT payload
		FROM alert_events
		ORDER BY occurred_at DESC, created_at DESC
		LIMIT $1
	`, limit)
	if err != nil {
		return nil, fmt.Errorf("list alert events: %w", err)
	}
	defer rows.Close()

	var payloads [][]byte
	for rows.Next() {
		var raw []byte
		if err := rows.Scan(&raw); err != nil {
			return nil, fmt.Errorf("scan alert event payload: %w", err)
		}
		payloads = append(payloads, raw)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate alert events: %w", err)
	}
	return payloads, nil
}

func (r *AlertRepository) ListViolations(ctx context.Context, f ViolationFilter) ([]models.ViolationItem, int, error) {
	var conditions []string
	var args []any
	argIdx := 1

	if f.VehicleID != "" {
		conditions = append(conditions, fmt.Sprintf("vl.vehicle_id = $%d", argIdx))
		args = append(args, f.VehicleID)
		argIdx++
	}
	if f.GeofenceID != "" {
		conditions = append(conditions, fmt.Sprintf("vl.geofence_id = $%d", argIdx))
		args = append(args, f.GeofenceID)
		argIdx++
	}
	if f.StartDate != nil {
		conditions = append(conditions, fmt.Sprintf("vl.recorded_at >= $%d", argIdx))
		args = append(args, *f.StartDate)
		argIdx++
	}
	if f.EndDate != nil {
		conditions = append(conditions, fmt.Sprintf("vl.recorded_at <= $%d", argIdx))
		args = append(args, *f.EndDate)
		argIdx++
	}

	whereClause := ""
	if len(conditions) > 0 {
		whereClause = "WHERE " + strings.Join(conditions, " AND ")
	}

	var totalCount int
	countQuery := fmt.Sprintf(`SELECT COUNT(*) FROM violations vl %s`, whereClause)
	if err := r.pool.QueryRow(ctx, countQuery, args...).Scan(&totalCount); err != nil {
		return nil, 0, fmt.Errorf("count violations: %w", err)
	}

	limitIdx := argIdx
	offsetIdx := argIdx + 1
	queryArgs := append(append([]any{}, args...), f.Limit, f.Offset)

	dataQuery := fmt.Sprintf(`
		SELECT vl.id, vl.vehicle_id, v.vehicle_number, vl.geofence_id, g.name, vl.event_type, vl.latitude, vl.longitude, vl.recorded_at
		FROM violations vl
		JOIN vehicles v ON v.id = vl.vehicle_id
		JOIN geofences g ON g.id = vl.geofence_id
		%s
		ORDER BY vl.recorded_at DESC, vl.created_at DESC
		LIMIT $%d OFFSET $%d
	`, whereClause, limitIdx, offsetIdx)

	rows, err := r.pool.Query(ctx, dataQuery, queryArgs...)
	if err != nil {
		return nil, 0, fmt.Errorf("query violations: %w", err)
	}
	defer rows.Close()

	violations := make([]models.ViolationItem, 0)
	for rows.Next() {
		var (
			item       models.ViolationItem
			recordedAt time.Time
		)
		if err := rows.Scan(
			&item.ID,
			&item.VehicleID,
			&item.VehicleNumber,
			&item.GeofenceID,
			&item.GeofenceName,
			&item.EventType,
			&item.Latitude,
			&item.Longitude,
			&recordedAt,
		); err != nil {
			return nil, 0, fmt.Errorf("scan violation: %w", err)
		}
		item.Timestamp = recordedAt.UTC().Format(time.RFC3339)
		violations = append(violations, item)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("iterate violations: %w", err)
	}

	return violations, totalCount, nil
}
