package models

import "time"

// --- Request DTOs ---

type CreateGeofenceRequest struct {
	Name        string      `json:"name"`
	Description string      `json:"description"`
	Coordinates [][]float64 `json:"coordinates"`
	Category    string      `json:"category"`
}

type CreateVehicleRequest struct {
	VehicleNumber string `json:"vehicle_number"`
	DriverName    string `json:"driver_name"`
	VehicleType   string `json:"vehicle_type"`
	Phone         string `json:"phone"`
}

type UpdateLocationRequest struct {
	VehicleID string   `json:"vehicle_id"`
	Latitude  *float64 `json:"latitude"`
	Longitude *float64 `json:"longitude"`
	Timestamp string   `json:"timestamp"`
}

type ConfigureAlertRequest struct {
	GeofenceID string  `json:"geofence_id"`
	VehicleID  *string `json:"vehicle_id,omitempty"`
	EventType  string  `json:"event_type"`
}

// --- Response DTOs (matching exact brief contracts + time_ns on every response) ---

type ErrorResponse struct {
	Error  string `json:"error"`
	TimeNs string `json:"time_ns"`
}

type CreateGeofenceResponse struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Status string `json:"status"`
	TimeNs string `json:"time_ns"`
}

type GeofenceItem struct {
	ID          string      `json:"id"`
	Name        string      `json:"name"`
	Description string      `json:"description"`
	Coordinates [][]float64 `json:"coordinates"`
	Category    string      `json:"category"`
	CreatedAt   string      `json:"created_at"`
}

type ListGeofencesResponse struct {
	Geofences []GeofenceItem `json:"geofences"`
	TimeNs    string         `json:"time_ns"`
}

type CreateVehicleResponse struct {
	ID            string `json:"id"`
	VehicleNumber string `json:"vehicle_number"`
	Status        string `json:"status"`
	TimeNs        string `json:"time_ns"`
}

type VehicleItem struct {
	ID            string `json:"id"`
	VehicleNumber string `json:"vehicle_number"`
	DriverName    string `json:"driver_name"`
	VehicleType   string `json:"vehicle_type"`
	Phone         string `json:"phone"`
	Status        string `json:"status"`
	CreatedAt     string `json:"created_at"`
}

type ListVehiclesResponse struct {
	Vehicles []VehicleItem `json:"vehicles"`
	TimeNs   string        `json:"time_ns"`
}

type CurrentGeofenceStatus struct {
	GeofenceID   string `json:"geofence_id"`
	GeofenceName string `json:"geofence_name"`
	Status       string `json:"status"`
}

type UpdateLocationResponse struct {
	VehicleID        string                  `json:"vehicle_id"`
	LocationUpdated  bool                    `json:"location_updated"`
	CurrentGeofences []CurrentGeofenceStatus `json:"current_geofences"`
	TimeNs           string                  `json:"time_ns"`
}

type VehicleLocationPoint struct {
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
	Timestamp string  `json:"timestamp"`
}

type VehicleGeofenceInfo struct {
	GeofenceID   string `json:"geofence_id"`
	GeofenceName string `json:"geofence_name"`
	Category     string `json:"category"`
}

type VehicleLocationResponse struct {
	VehicleID        string                `json:"vehicle_id"`
	VehicleNumber    string                `json:"vehicle_number"`
	CurrentLocation  *VehicleLocationPoint `json:"current_location"`
	CurrentGeofences []VehicleGeofenceInfo `json:"current_geofences"`
	TimeNs           string                `json:"time_ns"`
}

type ConfigureAlertResponse struct {
	AlertID    string  `json:"alert_id"`
	GeofenceID string  `json:"geofence_id"`
	VehicleID  *string `json:"vehicle_id"`
	EventType  string  `json:"event_type"`
	Status     string  `json:"status"`
	TimeNs     string  `json:"time_ns"`
}

type AlertRuleItem struct {
	AlertID       string  `json:"alert_id"`
	GeofenceID    string  `json:"geofence_id"`
	GeofenceName  string  `json:"geofence_name"`
	VehicleID     *string `json:"vehicle_id"`
	VehicleNumber *string `json:"vehicle_number"`
	EventType     string  `json:"event_type"`
	Status        string  `json:"status"`
	CreatedAt     string  `json:"created_at"`
}

type ListAlertsResponse struct {
	Alerts []AlertRuleItem `json:"alerts"`
	TimeNs string          `json:"time_ns"`
}

type ViolationItem struct {
	ID            string  `json:"id"`
	VehicleID     string  `json:"vehicle_id"`
	VehicleNumber string  `json:"vehicle_number"`
	GeofenceID    string  `json:"geofence_id"`
	GeofenceName  string  `json:"geofence_name"`
	EventType     string  `json:"event_type"`
	Latitude      float64 `json:"latitude"`
	Longitude     float64 `json:"longitude"`
	Timestamp     string  `json:"timestamp"`
}

type ListViolationsResponse struct {
	Violations []ViolationItem `json:"violations"`
	TotalCount int             `json:"total_count"`
	TimeNs     string          `json:"time_ns"`
}

// --- Real-time WebSocket Alert Payload ---

type AlertVehicleInfo struct {
	VehicleID     string `json:"vehicle_id"`
	VehicleNumber string `json:"vehicle_number"`
	DriverName    string `json:"driver_name"`
}

type AlertGeofenceInfo struct {
	GeofenceID   string `json:"geofence_id"`
	GeofenceName string `json:"geofence_name"`
	Category     string `json:"category"`
}

type AlertLocationInfo struct {
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
}

type WebSocketAlert struct {
	EventID   string            `json:"event_id"`
	EventType string            `json:"event_type"`
	Timestamp string            `json:"timestamp"`
	Vehicle   AlertVehicleInfo  `json:"vehicle"`
	Geofence  AlertGeofenceInfo `json:"geofence"`
	Location  AlertLocationInfo `json:"location"`
}

// --- Internal Domain Types ---

type GeofenceRef struct {
	ID       string
	Name     string
	Category string
}

type TransitionEvent struct {
	ViolationID   string
	EventType     string // "entry" or "exit"
	VehicleID     string
	VehicleNumber string
	DriverName    string
	GeofenceID    string
	GeofenceName  string
	Category      string
	Latitude      float64
	Longitude     float64
	OccurredAt    time.Time
}

type AlertRuleRecord struct {
	ID         string
	GeofenceID string
	VehicleID  *string
	EventType  string
	Status     string
}
