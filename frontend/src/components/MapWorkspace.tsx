import React, { useEffect, useMemo } from 'react';
import L from 'leaflet';
import {
  CircleMarker,
  MapContainer,
  Marker,
  Polygon,
  Polyline,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import { Crosshair, Maximize2, MousePointer, PenTool, RotateCcw, Trash2, Check } from 'lucide-react';
import type { Geofence, Vehicle, VehicleLocationStatus } from '../types/api';
import { CATEGORY_META, formatTimestamp } from '../utils/geo';

export type MapMode = 'inspect' | 'draw_geofence' | 'pick_location';

export interface MapFocusTarget {
  center: [number, number];
  zoom: number;
  nonce: number;
}

interface MapWorkspaceProps {
  geofences: Geofence[];
  vehicles: Vehicle[];
  vehicleLocations: Record<string, VehicleLocationStatus>;
  selectedVehicleId: string;
  mapMode: MapMode;
  onMapModeChange: (mode: MapMode) => void;
  draftPoints: [number, number][];
  onAddDraftPoint: (pt: [number, number]) => void;
  onUndoDraftPoint: () => void;
  onClearDraftPoints: () => void;
  onUseDraftPolygon: () => void;
  onPickLocation: (lat: number, lon: number) => void;
  focusTarget: MapFocusTarget | null;
}

function createVehicleIcon(label: string, inRestricted: boolean, selected: boolean): L.DivIcon {
  const bg = inRestricted ? '#ef4444' : selected ? '#38bdf8' : '#10b981';
  const ring = selected ? '0 0 0 3px rgba(56,189,248,0.45)' : '0 2px 6px rgba(0,0,0,0.6)';
  return L.divIcon({
    className: 'custom-vehicle-marker',
    html: `
      <div style="display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-50%);">
        <div style="width:16px;height:16px;border-radius:9999px;background:${bg};border:2.5px solid #ffffff;box-shadow:${ring};"></div>
        <span style="margin-top:3px;padding:1px 6px;border-radius:4px;background:rgba(15,23,42,0.9);color:#f8fafc;font-size:10px;font-weight:700;white-space:nowrap;border:1px solid rgba(148,163,184,0.35);">
          ${label}
        </span>
      </div>
    `,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });
}

const MapController: React.FC<{
  focusTarget: MapFocusTarget | null;
  mapMode: MapMode;
  onAddDraftPoint: (pt: [number, number]) => void;
  onPickLocation: (lat: number, lon: number) => void;
}> = ({ focusTarget, mapMode, onAddDraftPoint, onPickLocation }) => {
  const map = useMap();

  useEffect(() => {
    if (focusTarget) {
      map.flyTo(focusTarget.center, focusTarget.zoom, { duration: 0.6 });
    }
  }, [focusTarget, map]);

  useMapEvents({
    click(e) {
      const lat = Number(e.latlng.lat.toFixed(6));
      const lon = Number(e.latlng.lng.toFixed(6));
      if (mapMode === 'draw_geofence') {
        onAddDraftPoint([lat, lon]);
      } else if (mapMode === 'pick_location') {
        onPickLocation(lat, lon);
      }
    },
  });

  return null;
};

const FitBoundsButton: React.FC<{
  geofences: Geofence[];
  vehicleLocations: Record<string, VehicleLocationStatus>;
}> = ({ geofences, vehicleLocations }) => {
  const map = useMap();

  const handleFit = () => {
    const pts: [number, number][] = [];
    geofences.forEach((g) => g.coordinates.forEach((c) => pts.push(c)));
    Object.values(vehicleLocations).forEach((loc) => {
      if (loc.current_location) {
        pts.push([loc.current_location.latitude, loc.current_location.longitude]);
      }
    });
    if (pts.length === 0) {
      map.setView([37.7799, -122.4144], 13);
      return;
    }
    const bounds = L.latLngBounds(pts);
    map.fitBounds(bounds.pad(0.2), { maxZoom: 15 });
  };

  return (
    <button
      type="button"
      onClick={handleFit}
      className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900/90 px-2.5 py-1.5 text-xs font-medium text-slate-200 shadow-lg backdrop-blur hover:bg-slate-800"
      title="Fit map to all geofences and vehicles"
    >
      <Maximize2 className="h-3.5 w-3.5 text-sky-400" />
      Fit All
    </button>
  );
};

const GeofenceLayer = React.memo<{ geofence: Geofence }>(({ geofence }) => {
  const meta = CATEGORY_META[geofence.category];
  return (
    <Polygon
      positions={geofence.coordinates}
      pathOptions={{
        color: meta.color,
        fillColor: meta.fillColor,
        fillOpacity: 0.2,
        weight: 2.5,
      }}
    >
      <Tooltip sticky>{geofence.name}</Tooltip>
      <Popup>
        <div className="min-w-[180px] space-y-1 text-slate-900">
          <div className="font-bold text-sm">{geofence.name}</div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {meta.label}
          </div>
          {geofence.description && <p className="text-xs text-slate-700">{geofence.description}</p>}
          <div className="pt-1 text-[11px] text-slate-500 font-mono">
            {geofence.id} • {geofence.coordinates.length} pts
          </div>
        </div>
      </Popup>
    </Polygon>
  );
});
GeofenceLayer.displayName = 'GeofenceLayer';

const VehicleMapMarker = React.memo<{
  vehicle: Vehicle;
  status: VehicleLocationStatus;
  selected: boolean;
}>(({ vehicle, status, selected }) => {
  const loc = status.current_location;
  const inRestricted = status.current_geofences.some((g) => g.category === 'restricted_zone');
  const icon = useMemo(
    () => createVehicleIcon(vehicle.vehicle_number, inRestricted, selected),
    [vehicle.vehicle_number, inRestricted, selected]
  );

  if (!loc) return null;

  return (
    <Marker position={[loc.latitude, loc.longitude]} icon={icon}>
      <Popup>
        <div className="min-w-[200px] space-y-1.5 text-slate-900">
          <div className="font-bold text-sm">{vehicle.vehicle_number}</div>
          <div className="text-xs text-slate-700">
            Driver: <span className="font-medium">{vehicle.driver_name}</span> ({vehicle.vehicle_type})
          </div>
          <div className="text-xs font-mono text-slate-600">
            {loc.latitude.toFixed(5)}, {loc.longitude.toFixed(5)}
          </div>
          <div className="text-[11px] text-slate-500">{formatTimestamp(loc.timestamp)}</div>
          <div className="pt-1 border-t border-slate-200">
            <div className="text-[11px] font-semibold text-slate-600">Inside Geofences:</div>
            {status.current_geofences.length === 0 ? (
              <div className="text-xs text-slate-500">Outside all zones</div>
            ) : (
              <ul className="mt-0.5 space-y-0.5">
                {status.current_geofences.map((g) => (
                  <li key={g.geofence_id} className="text-xs font-medium text-slate-800">
                    • {g.geofence_name} ({g.category})
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Popup>
    </Marker>
  );
});
VehicleMapMarker.displayName = 'VehicleMapMarker';

export const MapWorkspace: React.FC<MapWorkspaceProps> = ({
  geofences,
  vehicles,
  vehicleLocations,
  selectedVehicleId,
  mapMode,
  onMapModeChange,
  draftPoints,
  onAddDraftPoint,
  onUndoDraftPoint,
  onClearDraftPoints,
  onUseDraftPolygon,
  onPickLocation,
  focusTarget,
}) => {
  const selectedVehicle = useMemo(
    () => vehicles.find((v) => v.id === selectedVehicleId),
    [vehicles, selectedVehicleId]
  );

  return (
    <div className="relative h-full min-h-[460px] w-full overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-xl">
      {/* Top-right Map Mode Toolbar */}
      <div className="absolute right-3 top-3 z-[1000] flex flex-wrap items-center gap-1.5 rounded-xl border border-slate-700/80 bg-slate-950/90 p-1.5 shadow-xl backdrop-blur">
        <button
          type="button"
          onClick={() => onMapModeChange('inspect')}
          className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
            mapMode === 'inspect'
              ? 'bg-sky-500 text-slate-950 font-semibold'
              : 'text-slate-300 hover:bg-slate-800'
          }`}
        >
          <MousePointer className="h-3.5 w-3.5" />
          Inspect
        </button>
        <button
          type="button"
          onClick={() => onMapModeChange('draw_geofence')}
          className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
            mapMode === 'draw_geofence'
              ? 'bg-emerald-500 text-slate-950 font-semibold'
              : 'text-slate-300 hover:bg-slate-800'
          }`}
        >
          <PenTool className="h-3.5 w-3.5" />
          Draw Geofence
        </button>
        <button
          type="button"
          onClick={() => onMapModeChange('pick_location')}
          className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
            mapMode === 'pick_location'
              ? 'bg-amber-500 text-slate-950 font-semibold'
              : 'text-slate-300 hover:bg-slate-800'
          }`}
        >
          <Crosshair className="h-3.5 w-3.5" />
          Move Vehicle
        </button>
      </div>

      <MapContainer
        center={[37.7799, -122.4144]}
        zoom={13}
        className="h-full w-full"
        style={{ cursor: mapMode === 'inspect' ? 'grab' : 'crosshair' }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <div className="leaflet-top leaflet-left pointer-events-none">
          <div className="pointer-events-auto ml-14 mt-3">
            <FitBoundsButton geofences={geofences} vehicleLocations={vehicleLocations} />
          </div>
        </div>

        <MapController
          focusTarget={focusTarget}
          mapMode={mapMode}
          onAddDraftPoint={onAddDraftPoint}
          onPickLocation={onPickLocation}
        />

        {geofences.map((g) => (
          <GeofenceLayer key={g.id} geofence={g} />
        ))}

        {vehicles.map((v) => {
          const status = vehicleLocations[v.id];
          if (!status) return null;
          return (
            <VehicleMapMarker
              key={v.id}
              vehicle={v}
              status={status}
              selected={v.id === selectedVehicleId}
            />
          );
        })}

        {/* Draft polygon vertices & preview while drawing */}
        {draftPoints.length >= 2 && (
          <Polyline
            positions={draftPoints}
            pathOptions={{ color: '#34d399', dashArray: '6 6', weight: 2.5 }}
          />
        )}
        {draftPoints.length >= 3 && (
          <Polygon
            positions={draftPoints}
            pathOptions={{
              color: '#10b981',
              fillColor: '#10b981',
              fillOpacity: 0.18,
              dashArray: '4 4',
              weight: 2,
            }}
          />
        )}
        {draftPoints.map((pt, idx) => (
          <CircleMarker
            key={`${pt[0]}-${pt[1]}-${idx}`}
            center={pt}
            radius={5}
            pathOptions={{
              color: '#ffffff',
              fillColor: idx === 0 ? '#f59e0b' : '#10b981',
              fillOpacity: 1,
              weight: 2,
            }}
          >
            <Tooltip direction="top">Point {idx + 1}</Tooltip>
          </CircleMarker>
        ))}
      </MapContainer>

      {/* Interactive Mode Bottom Banner */}
      {mapMode === 'draw_geofence' && (
        <div className="absolute bottom-3 left-3 right-3 z-[1000] flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-500/40 bg-slate-950/95 px-3.5 py-2.5 text-xs shadow-2xl backdrop-blur">
          <div className="text-slate-200">
            <span className="font-semibold text-emerald-400">Draw Mode:</span> Click map to drop
            polygon vertices ({draftPoints.length} placed, min 3 unique required; closing point added
            automatically).
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onUndoDraftPoint}
              disabled={draftPoints.length === 0}
              className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-slate-200 hover:bg-slate-800 disabled:opacity-40"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Undo
            </button>
            <button
              type="button"
              onClick={onClearDraftPoints}
              disabled={draftPoints.length === 0}
              className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-slate-200 hover:bg-slate-800 disabled:opacity-40"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Clear
            </button>
            <button
              type="button"
              onClick={onUseDraftPolygon}
              disabled={draftPoints.length < 3}
              className="flex items-center gap-1 rounded-lg bg-emerald-500 px-3 py-1 font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-40"
            >
              <Check className="h-3.5 w-3.5" />
              Use Polygon
            </button>
          </div>
        </div>
      )}

      {mapMode === 'pick_location' && (
        <div className="absolute bottom-3 left-3 right-3 z-[1000] flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-500/40 bg-slate-950/95 px-3.5 py-2.5 text-xs shadow-2xl backdrop-blur">
          <div className="text-slate-200">
            <span className="font-semibold text-amber-400">Move Vehicle Mode:</span> Click anywhere
            on the map to send a location update for{' '}
            <span className="font-semibold text-white">
              {selectedVehicle ? selectedVehicle.vehicle_number : 'selected vehicle'}
            </span>
            .
          </div>
          <button
            type="button"
            onClick={() => onMapModeChange('inspect')}
            className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-slate-200 hover:bg-slate-800"
          >
            Done
          </button>
        </div>
      )}
    </div>
  );
};
