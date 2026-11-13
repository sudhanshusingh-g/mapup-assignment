import type {
  ConfigureAlertPayload,
  ConfigureAlertResponse,
  CreateGeofencePayload,
  CreateGeofenceResponse,
  CreateVehiclePayload,
  CreateVehicleResponse,
  ListAlertsResponse,
  ListGeofencesResponse,
  ListVehiclesResponse,
  ListViolationsResponse,
  UpdateLocationPayload,
  UpdateLocationResponse,
  VehicleLocationStatus,
  WebSocketAlert,
} from '../types/api';

const RAW_API_URL = (import.meta.env.VITE_API_URL as string | undefined) || 'http://localhost:8080';
export const API_BASE_URL = RAW_API_URL.replace(/\/+$/, '');

export function resolveWebSocketURL(): string {
  const explicit = import.meta.env.VITE_WS_URL as string | undefined;
  if (explicit && explicit.trim() !== '') {
    return explicit.trim();
  }
  const url = new URL(API_BASE_URL);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/ws/alerts`;
  return url.toString();
}

export class ApiError extends Error {
  status: number;
  timeNs?: string;

  constructor(message: string, status: number, timeNs?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.timeNs = timeNs;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(
      data?.error || `Request failed with status ${res.status}`,
      res.status,
      data?.time_ns
    );
  }
  return data as T;
}

export function fetchGeofences(category?: string): Promise<ListGeofencesResponse> {
  const params = new URLSearchParams();
  if (category) params.set('category', category);
  const qs = params.toString();
  return request<ListGeofencesResponse>(`/geofences${qs ? `?${qs}` : ''}`);
}

export function createGeofence(payload: CreateGeofencePayload): Promise<CreateGeofenceResponse> {
  return request<CreateGeofenceResponse>('/geofences', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function fetchVehicles(): Promise<ListVehiclesResponse> {
  return request<ListVehiclesResponse>('/vehicles');
}

export function createVehicle(payload: CreateVehiclePayload): Promise<CreateVehicleResponse> {
  return request<CreateVehicleResponse>('/vehicles', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateVehicleLocation(payload: UpdateLocationPayload): Promise<UpdateLocationResponse> {
  return request<UpdateLocationResponse>('/vehicles/location', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function fetchVehicleLocation(vehicleId: string): Promise<VehicleLocationStatus> {
  return request<VehicleLocationStatus>(`/vehicles/location/${encodeURIComponent(vehicleId)}`);
}

export function configureAlert(payload: ConfigureAlertPayload): Promise<ConfigureAlertResponse> {
  return request<ConfigureAlertResponse>('/alerts/configure', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function fetchAlerts(filters?: {
  geofence_id?: string;
  vehicle_id?: string;
}): Promise<ListAlertsResponse> {
  const params = new URLSearchParams();
  if (filters?.geofence_id) params.set('geofence_id', filters.geofence_id);
  if (filters?.vehicle_id) params.set('vehicle_id', filters.vehicle_id);
  const qs = params.toString();
  return request<ListAlertsResponse>(`/alerts${qs ? `?${qs}` : ''}`);
}

export function deleteAlert(alertId: string): Promise<{ deleted: boolean; time_ns: string }> {
  return request(`/alerts/${encodeURIComponent(alertId)}`, {
    method: 'DELETE',
  });
}

export function fetchRecentAlertEvents(limit = 25): Promise<{ events: WebSocketAlert[]; time_ns: string }> {
  return request(`/alerts/history?limit=${limit}`);
}

export interface ViolationQuery {
  vehicle_id?: string;
  geofence_id?: string;
  start_date?: string;
  end_date?: string;
  limit?: number;
  offset?: number;
}

export function fetchViolations(query: ViolationQuery): Promise<ListViolationsResponse> {
  const params = new URLSearchParams();
  if (query.vehicle_id) params.set('vehicle_id', query.vehicle_id);
  if (query.geofence_id) params.set('geofence_id', query.geofence_id);
  if (query.start_date) params.set('start_date', query.start_date);
  if (query.end_date) params.set('end_date', query.end_date);
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  if (query.offset !== undefined) params.set('offset', String(query.offset));
  const qs = params.toString();
  return request<ListViolationsResponse>(`/violations/history${qs ? `?${qs}` : ''}`);
}
