package services

import (
	"context"
	"encoding/json"
	"sync"
	"testing"
	"time"

	"mapup-geofencing/internal/models"
)

type fakeAlertStore struct {
	mu          sync.Mutex
	rules       []models.AlertRuleRecord
	savedEvents []models.WebSocketAlert
}

func (f *fakeAlertStore) FindMatchingRule(_ context.Context, geofenceID, vehicleID, eventType string) (*models.AlertRuleRecord, error) {
	f.mu.Lock()
	defer f.mu.Unlock()

	for _, r := range f.rules {
		if r.Status != "active" || r.GeofenceID != geofenceID {
			continue
		}
		if r.VehicleID != nil && *r.VehicleID != vehicleID {
			continue
		}
		if r.EventType != "both" && r.EventType != eventType {
			continue
		}
		copyRule := r
		return &copyRule, nil
	}
	return nil, nil
}

func (f *fakeAlertStore) SaveAlertEvent(_ context.Context, _ string, _ string, _ models.TransitionEvent, payloadJSON []byte) error {
	var msg models.WebSocketAlert
	if err := json.Unmarshal(payloadJSON, &msg); err != nil {
		return err
	}
	f.mu.Lock()
	f.savedEvents = append(f.savedEvents, msg)
	f.mu.Unlock()
	return nil
}

type fakeBroadcaster struct {
	mu       sync.Mutex
	messages [][]byte
}

func (b *fakeBroadcaster) Broadcast(payload []byte) {
	b.mu.Lock()
	b.messages = append(b.messages, payload)
	b.mu.Unlock()
}

func TestAlertServiceMatchesPersistsAndBroadcastsAsync(t *testing.T) {
	vehSpecific := "veh_1"
	store := &fakeAlertStore{
		rules: []models.AlertRuleRecord{
			{ID: "alert_1", GeofenceID: "geo_restricted", VehicleID: nil, EventType: "entry", Status: "active"},
			{ID: "alert_2", GeofenceID: "geo_delivery", VehicleID: &vehSpecific, EventType: "both", Status: "active"},
		},
	}
	broadcaster := &fakeBroadcaster{}

	svc := NewAlertService(store, broadcaster, 2, 32)
	now := time.Now().UTC()

	svc.Enqueue([]models.TransitionEvent{
		{
			ViolationID:   "viol_1",
			EventType:     "entry",
			VehicleID:     "veh_99", // matches wildcard rule alert_1
			VehicleNumber: "KA-01-XX-0099",
			DriverName:    "Alice",
			GeofenceID:    "geo_restricted",
			GeofenceName:  "Restricted Harbor",
			Category:      "restricted_zone",
			Latitude:      37.78,
			Longitude:     -122.41,
			OccurredAt:    now,
		},
		{
			ViolationID:   "viol_2",
			EventType:     "exit",
			VehicleID:     "veh_99", // should NOT match alert_1 (entry only)
			VehicleNumber: "KA-01-XX-0099",
			DriverName:    "Alice",
			GeofenceID:    "geo_restricted",
			GeofenceName:  "Restricted Harbor",
			Category:      "restricted_zone",
			Latitude:      37.79,
			Longitude:     -122.42,
			OccurredAt:    now,
		},
		{
			ViolationID:   "viol_3",
			EventType:     "exit",
			VehicleID:     "veh_1", // matches alert_2 (specific vehicle, both)
			VehicleNumber: "KA-01-AB-1234",
			DriverName:    "John Doe",
			GeofenceID:    "geo_delivery",
			GeofenceName:  "Downtown Delivery Zone",
			Category:      "delivery_zone",
			Latitude:      37.77,
			Longitude:     -122.40,
			OccurredAt:    now,
		},
	})

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	svc.Shutdown(ctx)

	store.mu.Lock()
	savedCount := len(store.savedEvents)
	store.mu.Unlock()

	broadcaster.mu.Lock()
	msgCount := len(broadcaster.messages)
	broadcaster.mu.Unlock()

	if savedCount != 2 {
		t.Fatalf("expected 2 matched alerts saved to DB, got %d", savedCount)
	}
	if msgCount != 2 {
		t.Fatalf("expected 2 alerts broadcast over WebSocket, got %d", msgCount)
	}
}
