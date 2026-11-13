package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"mapup-geofencing/internal/models"
	"mapup-geofencing/internal/repository"
)

type stubGeofenceStore struct {
	items []models.GeofenceItem
}

func (s *stubGeofenceStore) Create(_ context.Context, id, name, description, category string, coords [][]float64) error {
	s.items = append(s.items, models.GeofenceItem{
		ID:          id,
		Name:        name,
		Description: description,
		Coordinates: coords,
		Category:    category,
		CreatedAt:   time.Now().UTC().Format(time.RFC3339),
	})
	return nil
}

func (s *stubGeofenceStore) List(_ context.Context, _ string, _, _ int) ([]models.GeofenceItem, error) {
	return s.items, nil
}

type stubVehicleStore struct{}

func (s *stubVehicleStore) Create(_ context.Context, _, _, _, _, _ string) error { return nil }
func (s *stubVehicleStore) List(_ context.Context, _, _ int) ([]models.VehicleItem, error) {
	return []models.VehicleItem{}, nil
}
func (s *stubVehicleStore) GetLocationStatus(_ context.Context, id string) (*models.VehicleLocationResponse, error) {
	if id == "missing" {
		return nil, repository.ErrNotFound
	}
	return &models.VehicleLocationResponse{
		VehicleID:        id,
		VehicleNumber:    "KA-01-AB-1234",
		CurrentGeofences: []models.VehicleGeofenceInfo{},
	}, nil
}

type stubLocationRecorder struct {
	called bool
}

func (s *stubLocationRecorder) RecordLocationAndDetectTransitions(_ context.Context, _ string, _, _ float64, _ time.Time) ([]models.CurrentGeofenceStatus, []models.TransitionEvent, error) {
	s.called = true
	return []models.CurrentGeofenceStatus{
			{GeofenceID: "geo_123", GeofenceName: "Downtown Delivery Zone", Status: "inside"},
		}, []models.TransitionEvent{
			{ViolationID: "viol_1", EventType: "entry", GeofenceID: "geo_123"},
		}, nil
}

type stubEnqueuer struct {
	events []models.TransitionEvent
}

func (e *stubEnqueuer) Enqueue(events []models.TransitionEvent) {
	e.events = append(e.events, events...)
}

func assertHasTimeNs(t *testing.T, body []byte) {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal(body, &m); err != nil {
		t.Fatalf("response is not valid JSON (%s): %v", string(body), err)
	}
	raw, ok := m["time_ns"]
	if !ok {
		t.Fatalf("missing time_ns in response: %s", string(body))
	}
	str, ok := raw.(string)
	if !ok || str == "" {
		t.Fatalf("time_ns must be a non-empty string, got %T (%v)", raw, raw)
	}
}

func TestGeofenceValidationAndTimeNs(t *testing.T) {
	store := &stubGeofenceStore{}
	h := NewGeofenceHandler(store)

	// Invalid category -> 400 with time_ns
	badBody := `{"name":"Test","coordinates":[[37.77,-122.41],[37.78,-122.41],[37.78,-122.40],[37.77,-122.41]],"category":"invalid_zone"}`
	req := httptest.NewRequest(http.MethodPost, "/geofences", bytes.NewBufferString(badBody))
	rec := httptest.NewRecorder()
	h.Create(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid category, got %d", rec.Code)
	}
	assertHasTimeNs(t, rec.Body.Bytes())

	// Unclosed polygon -> 400 with time_ns
	unclosedBody := `{"name":"Test","coordinates":[[37.77,-122.41],[37.78,-122.41],[37.78,-122.40],[37.77,-122.40]],"category":"delivery_zone"}`
	req = httptest.NewRequest(http.MethodPost, "/geofences", bytes.NewBufferString(unclosedBody))
	rec = httptest.NewRecorder()
	h.Create(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for unclosed polygon, got %d", rec.Code)
	}
	assertHasTimeNs(t, rec.Body.Bytes())

	// Valid polygon -> 201 with exact fields + time_ns
	validBody := `{"name":"Downtown Delivery Zone","coordinates":[[37.7749,-122.4194],[37.7849,-122.4194],[37.7849,-122.4094],[37.7749,-122.4094],[37.7749,-122.4194]],"category":"delivery_zone"}`
	req = httptest.NewRequest(http.MethodPost, "/geofences", bytes.NewBufferString(validBody))
	rec = httptest.NewRecorder()
	h.Create(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201 for valid geofence, got %d (%s)", rec.Code, rec.Body.String())
	}
	assertHasTimeNs(t, rec.Body.Bytes())
}

func TestUpdateLocationDispatchesAsyncAndReturnsTimeNs(t *testing.T) {
	locRecorder := &stubLocationRecorder{}
	enqueuer := &stubEnqueuer{}
	h := NewVehicleHandler(&stubVehicleStore{}, locRecorder, enqueuer)

	// Zero latitude/longitude should still be accepted (valid coordinates!)
	body := `{"vehicle_id":"veh_456","latitude":0,"longitude":0,"timestamp":"2025-01-15T10:35:00Z"}`
	req := httptest.NewRequest(http.MethodPost, "/vehicles/location", bytes.NewBufferString(body))
	rec := httptest.NewRecorder()
	h.UpdateLocation(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d (%s)", rec.Code, rec.Body.String())
	}
	if !locRecorder.called {
		t.Fatal("expected location recorder to be called")
	}
	if len(enqueuer.events) != 1 {
		t.Fatalf("expected 1 transition event enqueued asynchronously, got %d", len(enqueuer.events))
	}
	assertHasTimeNs(t, rec.Body.Bytes())

	// Missing latitude -> 400 with time_ns
	badBody := `{"vehicle_id":"veh_456","longitude":-122.4194,"timestamp":"2025-01-15T10:35:00Z"}`
	req = httptest.NewRequest(http.MethodPost, "/vehicles/location", bytes.NewBufferString(badBody))
	rec = httptest.NewRecorder()
	h.UpdateLocation(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 when latitude is omitted, got %d", rec.Code)
	}
	assertHasTimeNs(t, rec.Body.Bytes())
}
