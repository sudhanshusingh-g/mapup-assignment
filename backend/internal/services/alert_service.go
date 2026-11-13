package services

import (
	"context"
	"encoding/json"
	"log"
	"sync"
	"time"

	"github.com/google/uuid"

	"mapup-geofencing/internal/models"
)

// AlertStore persists and queries alert rules and triggered alert history.
type AlertStore interface {
	FindMatchingRule(ctx context.Context, geofenceID, vehicleID, eventType string) (*models.AlertRuleRecord, error)
	SaveAlertEvent(ctx context.Context, eventID string, ruleID string, ev models.TransitionEvent, payloadJSON []byte) error
}

// Broadcaster pushes serialized alert payloads to real-time subscribers.
type Broadcaster interface {
	Broadcast(payload []byte)
}

// AlertService processes geofence transition events asynchronously so alert persistence
// and WebSocket delivery never block the location update HTTP response.
type AlertService struct {
	store       AlertStore
	broadcaster Broadcaster
	queue       chan models.TransitionEvent
	wg          sync.WaitGroup
	mu          sync.RWMutex
	closed      bool
}

// NewAlertService creates and starts an asynchronous worker pool for alert delivery.
func NewAlertService(store AlertStore, broadcaster Broadcaster, workers, bufferSize int) *AlertService {
	if workers <= 0 {
		workers = 4
	}
	if bufferSize <= 0 {
		bufferSize = 1024
	}

	svc := &AlertService{
		store:       store,
		broadcaster: broadcaster,
		queue:       make(chan models.TransitionEvent, bufferSize),
	}

	for i := 0; i < workers; i++ {
		svc.wg.Add(1)
		go svc.worker()
	}
	return svc
}

// Enqueue dispatches transition events without blocking the caller.
func (s *AlertService) Enqueue(events []models.TransitionEvent) {
	if len(events) == 0 {
		return
	}

	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.closed {
		return
	}

	for _, ev := range events {
		select {
		case s.queue <- ev:
		default:
			log.Printf("alert queue full: dropping event for vehicle=%s geofence=%s type=%s", ev.VehicleID, ev.GeofenceID, ev.EventType)
		}
	}
}

// Shutdown closes the queue and waits for active workers to finish draining in-flight alerts.
func (s *AlertService) Shutdown(ctx context.Context) {
	s.mu.Lock()
	if !s.closed {
		s.closed = true
		close(s.queue)
	}
	s.mu.Unlock()

	done := make(chan struct{})
	go func() {
		s.wg.Wait()
		close(done)
	}()

	select {
	case <-done:
	case <-ctx.Done():
	}
}

func (s *AlertService) worker() {
	defer s.wg.Done()
	for ev := range s.queue {
		s.processEvent(ev)
	}
}

func (s *AlertService) processEvent(ev models.TransitionEvent) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	rule, err := s.store.FindMatchingRule(ctx, ev.GeofenceID, ev.VehicleID, ev.EventType)
	if err != nil {
		log.Printf("find matching alert rule failed: %v", err)
		return
	}
	if rule == nil {
		return
	}

	alertMsg := models.WebSocketAlert{
		EventID:   "evt_" + uuid.NewString()[:12],
		EventType: ev.EventType,
		Timestamp: ev.OccurredAt.UTC().Format(time.RFC3339),
		Vehicle: models.AlertVehicleInfo{
			VehicleID:     ev.VehicleID,
			VehicleNumber: ev.VehicleNumber,
			DriverName:    ev.DriverName,
		},
		Geofence: models.AlertGeofenceInfo{
			GeofenceID:   ev.GeofenceID,
			GeofenceName: ev.GeofenceName,
			Category:     ev.Category,
		},
		Location: models.AlertLocationInfo{
			Latitude:  ev.Latitude,
			Longitude: ev.Longitude,
		},
	}

	payload, err := json.Marshal(alertMsg)
	if err != nil {
		log.Printf("marshal websocket alert failed: %v", err)
		return
	}

	if err := s.store.SaveAlertEvent(ctx, alertMsg.EventID, rule.ID, ev, payload); err != nil {
		log.Printf("save alert event failed: %v", err)
	}

	if s.broadcaster != nil {
		s.broadcaster.Broadcast(payload)
	}
}
