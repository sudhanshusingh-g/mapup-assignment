package handlers

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"mapup-geofencing/internal/geofence"
	"mapup-geofencing/internal/models"
	"mapup-geofencing/internal/repository"
)

type VehicleStore interface {
	Create(ctx context.Context, id, vehicleNumber, driverName, vehicleType, phone string) error
	List(ctx context.Context, limit, offset int) ([]models.VehicleItem, error)
	GetLocationStatus(ctx context.Context, vehicleID string) (*models.VehicleLocationResponse, error)
}

type LocationRecorder interface {
	RecordLocationAndDetectTransitions(
		ctx context.Context,
		vehicleID string,
		lat, lon float64,
		recordedAt time.Time,
	) ([]models.CurrentGeofenceStatus, []models.TransitionEvent, error)
}

type EventEnqueuer interface {
	Enqueue(events []models.TransitionEvent)
}

type VehicleHandler struct {
	vehicles  VehicleStore
	locations LocationRecorder
	alerts    EventEnqueuer
}

func NewVehicleHandler(vehicles VehicleStore, locations LocationRecorder, alerts EventEnqueuer) *VehicleHandler {
	return &VehicleHandler{
		vehicles:  vehicles,
		locations: locations,
		alerts:    alerts,
	}
}

// Create handles POST /vehicles.
func (h *VehicleHandler) Create(w http.ResponseWriter, r *http.Request) {
	start := time.Now()

	var req models.CreateVehicleRequest
	if err := decodeJSONBody(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, start, "invalid JSON request body: "+err.Error())
		return
	}

	req.VehicleNumber = strings.TrimSpace(req.VehicleNumber)
	req.DriverName = strings.TrimSpace(req.DriverName)
	req.VehicleType = strings.TrimSpace(req.VehicleType)
	req.Phone = strings.TrimSpace(req.Phone)

	if req.VehicleNumber == "" {
		writeError(w, http.StatusBadRequest, start, "vehicle_number is required")
		return
	}
	if req.DriverName == "" {
		writeError(w, http.StatusBadRequest, start, "driver_name is required")
		return
	}
	if req.VehicleType == "" {
		writeError(w, http.StatusBadRequest, start, "vehicle_type is required")
		return
	}
	if req.Phone == "" {
		writeError(w, http.StatusBadRequest, start, "phone is required")
		return
	}

	id := "veh_" + uuid.NewString()[:12]
	if err := h.vehicles.Create(r.Context(), id, req.VehicleNumber, req.DriverName, req.VehicleType, req.Phone); err != nil {
		if errors.Is(err, repository.ErrDuplicate) {
			writeError(w, http.StatusConflict, start, err.Error())
			return
		}
		writeError(w, http.StatusInternalServerError, start, "failed to register vehicle")
		return
	}

	writeJSON(w, http.StatusCreated, models.CreateVehicleResponse{
		ID:            id,
		VehicleNumber: req.VehicleNumber,
		Status:        "active",
		TimeNs:        formatElapsedNs(start),
	})
}

// List handles GET /vehicles.
func (h *VehicleHandler) List(w http.ResponseWriter, r *http.Request) {
	start := time.Now()

	limit, offset, hasLimit, err := parsePagination(r, 0, 500)
	if err != nil {
		writeError(w, http.StatusBadRequest, start, err.Error())
		return
	}
	if !hasLimit {
		limit = 0
	}

	vehicles, err := h.vehicles.List(r.Context(), limit, offset)
	if err != nil {
		writeError(w, http.StatusInternalServerError, start, "failed to list vehicles")
		return
	}

	writeJSON(w, http.StatusOK, models.ListVehiclesResponse{
		Vehicles: vehicles,
		TimeNs:   formatElapsedNs(start),
	})
}

// UpdateLocation handles POST /vehicles/location.
func (h *VehicleHandler) UpdateLocation(w http.ResponseWriter, r *http.Request) {
	start := time.Now()

	var req models.UpdateLocationRequest
	if err := decodeJSONBody(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, start, "invalid JSON request body: "+err.Error())
		return
	}

	req.VehicleID = strings.TrimSpace(req.VehicleID)
	req.Timestamp = strings.TrimSpace(req.Timestamp)

	if req.VehicleID == "" {
		writeError(w, http.StatusBadRequest, start, "vehicle_id is required")
		return
	}
	if req.Latitude == nil || req.Longitude == nil {
		writeError(w, http.StatusBadRequest, start, "latitude and longitude are required")
		return
	}
	if err := geofence.ValidateCoordinates(*req.Latitude, *req.Longitude); err != nil {
		writeError(w, http.StatusBadRequest, start, err.Error())
		return
	}
	if req.Timestamp == "" {
		writeError(w, http.StatusBadRequest, start, "timestamp is required in ISO 8601 format")
		return
	}
	recordedAt, err := parseISO8601(req.Timestamp)
	if err != nil {
		writeError(w, http.StatusBadRequest, start, "invalid timestamp: "+err.Error())
		return
	}

	currentGeofences, transitions, err := h.locations.RecordLocationAndDetectTransitions(
		r.Context(),
		req.VehicleID,
		*req.Latitude,
		*req.Longitude,
		recordedAt.UTC(),
	)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			writeError(w, http.StatusNotFound, start, "vehicle not found")
			return
		}
		writeError(w, http.StatusInternalServerError, start, "failed to update vehicle location")
		return
	}

	// Dispatch alert matching, DB alert logging, and WebSocket broadcast asynchronously
	// so real-time delivery never slows down the HTTP location update response.
	if h.alerts != nil && len(transitions) > 0 {
		h.alerts.Enqueue(transitions)
	}

	writeJSON(w, http.StatusOK, models.UpdateLocationResponse{
		VehicleID:        req.VehicleID,
		LocationUpdated:  true,
		CurrentGeofences: currentGeofences,
		TimeNs:           formatElapsedNs(start),
	})
}

// GetLocation handles GET /vehicles/location/{vehicle_id}.
func (h *VehicleHandler) GetLocation(w http.ResponseWriter, r *http.Request) {
	start := time.Now()

	vehicleID := strings.TrimSpace(chi.URLParam(r, "vehicle_id"))
	if vehicleID == "" {
		writeError(w, http.StatusBadRequest, start, "vehicle_id is required")
		return
	}

	res, err := h.vehicles.GetLocationStatus(r.Context(), vehicleID)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			writeError(w, http.StatusNotFound, start, "vehicle not found")
			return
		}
		writeError(w, http.StatusInternalServerError, start, "failed to fetch vehicle location")
		return
	}

	res.TimeNs = formatElapsedNs(start)
	writeJSON(w, http.StatusOK, res)
}
