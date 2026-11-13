export type GeofenceCategory =
  | 'delivery_zone'
  | 'restricted_zone'
  | 'toll_zone'
  | 'customer_area';

export type AlertEventType = 'entry' | 'exit' | 'both';

export interface Geofence {
  id: string;
  name: string;
  description: string;
  coordinates: [number, number][];
  category: GeofenceCategory;
  created_at: string;
}

export interface CreateGeofencePayload {
  name: string;
  description: string;
  coordinates: [number, number][];
  category: GeofenceCategory;
}

export interface CreateGeofenceResponse {
  id: string;
  name: string;
  status: string;
  time_ns: string;
}

export interface ListGeofencesResponse {
  geofences: Geofence[];
  time_ns: string;
}

export interface Vehicle {
  id: string;
  vehicle_number: string;
  driver_name: string;
  vehicle_type: string;
  phone: string;
  status: string;
  created_at: string;
}

export interface CreateVehiclePayload {
  vehicle_number: string;
  driver_name: string;
  vehicle_type: string;
  phone: string;
}

export interface CreateVehicleResponse {
  id: string;
  vehicle_number: string;
  status: string;
  time_ns: string;
}

export interface ListVehiclesResponse {
  vehicles: Vehicle[];
  time_ns: string;
}

export interface UpdateLocationPayload {
  vehicle_id: string;
  latitude: number;
  longitude: number;
  timestamp: string;
}

export interface UpdateLocationResponse {
  vehicle_id: string;
  location_updated: boolean;
  current_geofences: {
    geofence_id: string;
    geofence_name: string;
    status: string;
  }[];
  time_ns: string;
}

export interface VehicleLocationStatus {
  vehicle_id: string;
  vehicle_number: string;
  current_location: {
    latitude: number;
    longitude: number;
    timestamp: string;
  } | null;
  current_geofences: {
    geofence_id: string;
    geofence_name: string;
    category: GeofenceCategory;
  }[];
  time_ns: string;
}

export interface ConfigureAlertPayload {
  geofence_id: string;
  vehicle_id?: string | null;
  event_type: AlertEventType;
}

export interface ConfigureAlertResponse {
  alert_id: string;
  geofence_id: string;
  vehicle_id: string | null;
  event_type: AlertEventType;
  status: string;
  time_ns: string;
}

export interface AlertRule {
  alert_id: string;
  geofence_id: string;
  geofence_name: string;
  vehicle_id: string | null;
  vehicle_number: string | null;
  event_type: AlertEventType;
  status: string;
  created_at: string;
}

export interface ListAlertsResponse {
  alerts: AlertRule[];
  time_ns: string;
}

export interface Violation {
  id: string;
  vehicle_id: string;
  vehicle_number: string;
  geofence_id: string;
  geofence_name: string;
  event_type: 'entry' | 'exit';
  latitude: number;
  longitude: number;
  timestamp: string;
}

export interface ListViolationsResponse {
  violations: Violation[];
  total_count: number;
  time_ns: string;
}

export interface WebSocketAlert {
  event_id: string;
  event_type: 'entry' | 'exit';
  timestamp: string;
  vehicle: {
    vehicle_id: string;
    vehicle_number: string;
    driver_name: string;
  };
  geofence: {
    geofence_id: string;
    geofence_name: string;
    category: GeofenceCategory;
  };
  location: {
    latitude: number;
    longitude: number;
  };
}
