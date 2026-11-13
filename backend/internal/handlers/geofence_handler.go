package handlers

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"

	"mapup-geofencing/internal/geofence"
	"mapup-geofencing/internal/models"
	"mapup-geofencing/internal/repository"
)

type GeofenceStore interface {
	Create(ctx context.Context, id, name, description, category string, coords [][]float64) error
	List(ctx context.Context, category string, limit, offset int) ([]models.GeofenceItem, error)
}

type GeofenceHandler struct {
	store GeofenceStore
}

func NewGeofenceHandler(store GeofenceStore) *GeofenceHandler {
	return &GeofenceHandler{store: store}
}

// Create handles POST /geofences.
func (h *GeofenceHandler) Create(w http.ResponseWriter, r *http.Request) {
	start := time.Now()

	var req models.CreateGeofenceRequest
	if err := decodeJSONBody(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, start, "invalid JSON request body: "+err.Error())
		return
	}

	req.Name = strings.TrimSpace(req.Name)
	req.Description = strings.TrimSpace(req.Description)
	req.Category = strings.TrimSpace(req.Category)

	if req.Name == "" {
		writeError(w, http.StatusBadRequest, start, "name is required")
		return
	}
	if err := geofence.ValidateCategory(req.Category); err != nil {
		writeError(w, http.StatusBadRequest, start, err.Error())
		return
	}
	if err := geofence.ValidatePolygon(req.Coordinates); err != nil {
		writeError(w, http.StatusBadRequest, start, err.Error())
		return
	}

	id := "geo_" + uuid.NewString()[:12]
	if err := h.store.Create(r.Context(), id, req.Name, req.Description, req.Category, req.Coordinates); err != nil {
		if errors.Is(err, repository.ErrInvalidGeometry) {
			writeError(w, http.StatusBadRequest, start, err.Error())
			return
		}
		writeError(w, http.StatusInternalServerError, start, "failed to create geofence")
		return
	}

	writeJSON(w, http.StatusCreated, models.CreateGeofenceResponse{
		ID:     id,
		Name:   req.Name,
		Status: "active",
		TimeNs: formatElapsedNs(start),
	})
}

// List handles GET /geofences.
func (h *GeofenceHandler) List(w http.ResponseWriter, r *http.Request) {
	start := time.Now()

	category := strings.TrimSpace(r.URL.Query().Get("category"))
	if category != "" {
		if err := geofence.ValidateCategory(category); err != nil {
			writeError(w, http.StatusBadRequest, start, err.Error())
			return
		}
	}

	limit, offset, hasLimit, err := parsePagination(r, 0, 500)
	if err != nil {
		writeError(w, http.StatusBadRequest, start, err.Error())
		return
	}
	if !hasLimit {
		limit = 0
	}

	geofences, err := h.store.List(r.Context(), category, limit, offset)
	if err != nil {
		writeError(w, http.StatusInternalServerError, start, "failed to list geofences")
		return
	}

	writeJSON(w, http.StatusOK, models.ListGeofencesResponse{
		Geofences: geofences,
		TimeNs:    formatElapsedNs(start),
	})
}
