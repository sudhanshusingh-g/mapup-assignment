package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"mapup-geofencing/internal/models"
	"mapup-geofencing/internal/repository"
)

var allowedAlertEventTypes = map[string]bool{
	"entry": true,
	"exit":  true,
	"both":  true,
}

type AlertRuleStore interface {
	CreateRule(ctx context.Context, id, geofenceID string, vehicleID *string, eventType string) error
	ListRules(ctx context.Context, geofenceID, vehicleID string, limit, offset int) ([]models.AlertRuleItem, error)
	DeleteRule(ctx context.Context, alertID string) error
	ListRecentAlertEvents(ctx context.Context, limit int) ([][]byte, error)
	ListViolations(ctx context.Context, f repository.ViolationFilter) ([]models.ViolationItem, int, error)
}

type AlertHandler struct {
	store AlertRuleStore
}

func NewAlertHandler(store AlertRuleStore) *AlertHandler {
	return &AlertHandler{store: store}
}

// Configure handles POST /alerts/configure.
func (h *AlertHandler) Configure(w http.ResponseWriter, r *http.Request) {
	start := time.Now()

	var req models.ConfigureAlertRequest
	if err := decodeJSONBody(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, start, "invalid JSON request body: "+err.Error())
		return
	}

	req.GeofenceID = strings.TrimSpace(req.GeofenceID)
	req.EventType = strings.TrimSpace(req.EventType)

	if req.GeofenceID == "" {
		writeError(w, http.StatusBadRequest, start, "geofence_id is required")
		return
	}
	if !allowedAlertEventTypes[req.EventType] {
		writeError(w, http.StatusBadRequest, start, "invalid event_type: must be one of entry, exit, both")
		return
	}

	var normalizedVehicleID *string
	if req.VehicleID != nil {
		trimmed := strings.TrimSpace(*req.VehicleID)
		if trimmed != "" {
			normalizedVehicleID = &trimmed
		}
	}

	alertID := "alert_" + uuid.NewString()[:12]
	if err := h.store.CreateRule(r.Context(), alertID, req.GeofenceID, normalizedVehicleID, req.EventType); err != nil {
		switch {
		case errors.Is(err, repository.ErrGeofenceNotFound):
			writeError(w, http.StatusNotFound, start, "geofence not found")
		case errors.Is(err, repository.ErrVehicleNotFound):
			writeError(w, http.StatusNotFound, start, "vehicle not found")
		default:
			writeError(w, http.StatusInternalServerError, start, "failed to configure alert rule")
		}
		return
	}

	writeJSON(w, http.StatusCreated, models.ConfigureAlertResponse{
		AlertID:    alertID,
		GeofenceID: req.GeofenceID,
		VehicleID:  normalizedVehicleID,
		EventType:  req.EventType,
		Status:     "active",
		TimeNs:     formatElapsedNs(start),
	})
}

// List handles GET /alerts.
func (h *AlertHandler) List(w http.ResponseWriter, r *http.Request) {
	start := time.Now()

	geofenceID := strings.TrimSpace(r.URL.Query().Get("geofence_id"))
	vehicleID := strings.TrimSpace(r.URL.Query().Get("vehicle_id"))

	limit, offset, hasLimit, err := parsePagination(r, 0, 500)
	if err != nil {
		writeError(w, http.StatusBadRequest, start, err.Error())
		return
	}
	if !hasLimit {
		limit = 0
	}

	alerts, err := h.store.ListRules(r.Context(), geofenceID, vehicleID, limit, offset)
	if err != nil {
		writeError(w, http.StatusInternalServerError, start, "failed to list alert rules")
		return
	}

	writeJSON(w, http.StatusOK, models.ListAlertsResponse{
		Alerts: alerts,
		TimeNs: formatElapsedNs(start),
	})
}

// Delete handles DELETE /alerts/{alert_id} so users can manage existing rules from the dashboard.
func (h *AlertHandler) Delete(w http.ResponseWriter, r *http.Request) {
	start := time.Now()

	alertID := strings.TrimSpace(chi.URLParam(r, "alert_id"))
	if alertID == "" {
		writeError(w, http.StatusBadRequest, start, "alert_id is required")
		return
	}

	if err := h.store.DeleteRule(r.Context(), alertID); err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			writeError(w, http.StatusNotFound, start, "alert rule not found")
			return
		}
		writeError(w, http.StatusInternalServerError, start, "failed to delete alert rule")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"deleted":  true,
		"alert_id": alertID,
		"time_ns":  formatElapsedNs(start),
	})
}

// ListRecentEvents handles GET /alerts/history so the frontend can populate recent triggered alerts on load.
func (h *AlertHandler) ListRecentEvents(w http.ResponseWriter, r *http.Request) {
	start := time.Now()

	limit, _, hasLimit, err := parsePagination(r, 30, 100)
	if err != nil {
		writeError(w, http.StatusBadRequest, start, err.Error())
		return
	}
	if !hasLimit {
		limit = 30
	}

	rawEvents, err := h.store.ListRecentAlertEvents(r.Context(), limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, start, "failed to load recent alerts")
		return
	}

	events := make([]json.RawMessage, 0, len(rawEvents))
	for _, raw := range rawEvents {
		events = append(events, json.RawMessage(raw))
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"events":  events,
		"time_ns": formatElapsedNs(start),
	})
}

// ListViolations handles GET /violations/history.
func (h *AlertHandler) ListViolations(w http.ResponseWriter, r *http.Request) {
	start := time.Now()

	q := r.URL.Query()
	vehicleID := strings.TrimSpace(q.Get("vehicle_id"))
	geofenceID := strings.TrimSpace(q.Get("geofence_id"))

	var startDate, endDate *time.Time
	if rawStart := strings.TrimSpace(q.Get("start_date")); rawStart != "" {
		t, err := parseISO8601(rawStart)
		if err != nil {
			writeError(w, http.StatusBadRequest, start, "invalid start_date: "+err.Error())
			return
		}
		startDate = &t
	}
	if rawEnd := strings.TrimSpace(q.Get("end_date")); rawEnd != "" {
		t, err := parseISO8601(rawEnd)
		if err != nil {
			writeError(w, http.StatusBadRequest, start, "invalid end_date: "+err.Error())
			return
		}
		endDate = &t
	}
	if startDate != nil && endDate != nil && startDate.After(*endDate) {
		writeError(w, http.StatusBadRequest, start, "start_date cannot be after end_date")
		return
	}

	limit, offset, _, err := parsePagination(r, 50, 500)
	if err != nil {
		writeError(w, http.StatusBadRequest, start, err.Error())
		return
	}

	violations, totalCount, err := h.store.ListViolations(r.Context(), repository.ViolationFilter{
		VehicleID:  vehicleID,
		GeofenceID: geofenceID,
		StartDate:  startDate,
		EndDate:    endDate,
		Limit:      limit,
		Offset:     offset,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, start, "failed to retrieve violation history")
		return
	}

	writeJSON(w, http.StatusOK, models.ListViolationsResponse{
		Violations: violations,
		TotalCount: totalCount,
		TimeNs:     formatElapsedNs(start),
	})
}
