import React, { useEffect, useState } from 'react';
import { Crosshair, Loader2, Navigation, Play, PlusCircle, Truck } from 'lucide-react';
import { ApiError, createVehicle, updateVehicleLocation } from '../services/api';
import type { Geofence, Vehicle, VehicleLocationStatus } from '../types/api';
import { CATEGORY_META, formatNsLatency, formatTimestamp, polygonCentroid } from '../utils/geo';

interface VehiclePanelProps {
  vehicles: Vehicle[];
  geofences: Geofence[];
  vehicleLocations: Record<string, VehicleLocationStatus>;
  selectedVehicleId: string;
  onSelectVehicle: (id: string) => void;
  pickedCoords: { lat: number; lon: number; nonce: number } | null;
  onStartPickOnMap: () => void;
  onVehicleCreated: () => Promise<void>;
  onLocationUpdated: (vehicleId: string) => Promise<void>;
  onFocusLocation: (center: [number, number]) => void;
}

export const VehiclePanel: React.FC<VehiclePanelProps> = ({
  vehicles,
  geofences,
  vehicleLocations,
  selectedVehicleId,
  onSelectVehicle,
  pickedCoords,
  onStartPickOnMap,
  onVehicleCreated,
  onLocationUpdated,
  onFocusLocation,
}) => {
  // Vehicle registration form state
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [driverName, setDriverName] = useState('');
  const [vehicleType, setVehicleType] = useState('truck');
  const [phone, setPhone] = useState('');
  const [regSubmitting, setRegSubmitting] = useState(false);
  const [regError, setRegError] = useState<string | null>(null);
  const [regSuccess, setRegSuccess] = useState<string | null>(null);

  // Location update form state
  const [latInput, setLatInput] = useState('37.7799');
  const [lonInput, setLonInput] = useState('-122.4144');
  const [locSubmitting, setLocSubmitting] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);
  const [locResult, setLocResult] = useState<string | null>(null);
  const [simulating, setSimulating] = useState(false);

  useEffect(() => {
    if (pickedCoords) {
      setLatInput(String(pickedCoords.lat));
      setLonInput(String(pickedCoords.lon));
    }
  }, [pickedCoords]);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegError(null);
    setRegSuccess(null);
    setRegSubmitting(true);
    try {
      const res = await createVehicle({
        vehicle_number: vehicleNumber.trim(),
        driver_name: driverName.trim(),
        vehicle_type: vehicleType.trim(),
        phone: phone.trim(),
      });
      setRegSuccess(`Registered ${res.vehicle_number} (${res.id}) in ${formatNsLatency(res.time_ns)}`);
      setVehicleNumber('');
      setDriverName('');
      setPhone('');
      await onVehicleCreated();
      onSelectVehicle(res.id);
    } catch (err) {
      if (err instanceof ApiError) {
        setRegError(`${err.message}${err.timeNs ? ` (${formatNsLatency(err.timeNs)})` : ''}`);
      } else {
        setRegError('Failed to register vehicle');
      }
    } finally {
      setRegSubmitting(false);
    }
  };

  const sendLocationUpdate = async (vehicleId: string, lat: number, lon: number) => {
    setLocError(null);
    setLocResult(null);
    setLocSubmitting(true);
    try {
      const res = await updateVehicleLocation({
        vehicle_id: vehicleId,
        latitude: lat,
        longitude: lon,
        timestamp: new Date().toISOString(),
      });
      const zoneNames = res.current_geofences.map((g) => g.geofence_name).join(', ') || 'Outside all zones';
      setLocResult(`Updated (${formatNsLatency(res.time_ns)}) • Zones: ${zoneNames}`);
      await onLocationUpdated(vehicleId);
      onFocusLocation([lat, lon]);
    } catch (err) {
      if (err instanceof ApiError) {
        setLocError(`${err.message}${err.timeNs ? ` (${formatNsLatency(err.timeNs)})` : ''}`);
      } else {
        setLocError('Failed to update vehicle location');
      }
    } finally {
      setLocSubmitting(false);
    }
  };

  const handleLocationSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedVehicleId) {
      setLocError('Please select a vehicle first');
      return;
    }
    const lat = Number(latInput);
    const lon = Number(lonInput);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      setLocError('Latitude and longitude must be valid numbers');
      return;
    }
    await sendLocationUpdate(selectedVehicleId, lat, lon);
  };

  // Demo helper: drives selected vehicle from outside -> inside first geofence -> outside again
  const handleSimulateCrossZone = async () => {
    if (!selectedVehicleId || geofences.length === 0) {
      setLocError('Register a vehicle and create at least one geofence to simulate crossing');
      return;
    }
    const target = geofences[0];
    const center = polygonCentroid(target.coordinates);
    const outside: [number, number] = [center[0] + 0.03, center[1] + 0.03];

    setSimulating(true);
    try {
      const waypoints: [number, number][] = [outside, center, outside];
      for (const [lat, lon] of waypoints) {
        setLatInput(lat.toFixed(6));
        setLonInput(lon.toFixed(6));
        await sendLocationUpdate(selectedVehicleId, lat, lon);
        await new Promise((resolve) => setTimeout(resolve, 1100));
      }
    } finally {
      setSimulating(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Location Update Form */}
      <form onSubmit={handleLocationSubmit} className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/70 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-white">Update Vehicle Location</h3>
          <button
            type="button"
            onClick={onStartPickOnMap}
            disabled={!selectedVehicleId}
            className="flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-300 hover:bg-amber-500/20 disabled:opacity-40"
          >
            <Crosshair className="h-3.5 w-3.5" />
            Pick on Map
          </button>
        </div>

        <div>
          <label className="mb-1 block text-xs text-slate-400">Target Vehicle *</label>
          <select
            value={selectedVehicleId}
            onChange={(e) => onSelectVehicle(e.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-white focus:border-sky-500 focus:outline-none"
          >
            <option value="">-- Select a vehicle --</option>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.vehicle_number} — {v.driver_name} ({v.vehicle_type})
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <label className="mb-1 block text-xs text-slate-400">Latitude *</label>
            <input
              type="number"
              step="any"
              required
              value={latInput}
              onChange={(e) => setLatInput(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 font-mono text-xs text-white focus:border-sky-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">Longitude *</label>
            <input
              type="number"
              step="any"
              required
              value={lonInput}
              onChange={(e) => setLonInput(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 font-mono text-xs text-white focus:border-sky-500 focus:outline-none"
            />
          </div>
        </div>

        {locError && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {locError}
          </div>
        )}
        {locResult && (
          <div className="rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-xs text-sky-200">
            {locResult}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={locSubmitting || simulating || !selectedVehicleId}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-amber-500 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50"
          >
            {locSubmitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Navigation className="h-3.5 w-3.5" />}
            Send Location
          </button>
          <button
            type="button"
            onClick={handleSimulateCrossZone}
            disabled={simulating || locSubmitting || !selectedVehicleId || geofences.length === 0}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-700 disabled:opacity-40"
            title="Sends 3 real updates: Outside -> Inside Zone -> Outside Zone"
          >
            {simulating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5 text-emerald-400" />}
            Simulate Entry/Exit
          </button>
        </div>
      </form>

      {/* Register Vehicle Form */}
      <form onSubmit={handleRegister} className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/70 p-4">
        <h3 className="text-sm font-semibold text-white">Register New Vehicle</h3>

        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs text-slate-400">Vehicle Number *</label>
            <input
              type="text"
              required
              value={vehicleNumber}
              onChange={(e) => setVehicleNumber(e.target.value)}
              placeholder="KA-01-AB-1234"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">Driver Name *</label>
            <input
              type="text"
              required
              value={driverName}
              onChange={(e) => setDriverName(e.target.value)}
              placeholder="John Doe"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">Vehicle Type *</label>
            <select
              value={vehicleType}
              onChange={(e) => setVehicleType(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-white focus:border-sky-500 focus:outline-none"
            >
              <option value="truck">truck</option>
              <option value="van">van</option>
              <option value="car">car</option>
              <option value="motorcycle">motorcycle</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">Phone *</label>
            <input
              type="text"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+1234567890"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none"
            />
          </div>
        </div>

        {regError && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {regError}
          </div>
        )}
        {regSuccess && (
          <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
            {regSuccess}
          </div>
        )}

        <button
          type="submit"
          disabled={regSubmitting}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-50"
        >
          {regSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlusCircle className="h-4 w-4" />}
          Register Vehicle
        </button>
      </form>

      {/* Registered Vehicles List */}
      <div className="max-h-56 space-y-2 overflow-y-auto pr-1 custom-scrollbar">
        {vehicles.map((v) => {
          const locStatus = vehicleLocations[v.id];
          const isSelected = v.id === selectedVehicleId;
          return (
            <div
              key={v.id}
              onClick={() => {
                onSelectVehicle(v.id);
                if (locStatus?.current_location) {
                  onFocusLocation([
                    locStatus.current_location.latitude,
                    locStatus.current_location.longitude,
                  ]);
                }
              }}
              className={`cursor-pointer rounded-xl border p-3 transition ${
                isSelected
                  ? 'border-sky-500/60 bg-sky-500/10'
                  : 'border-slate-800 bg-slate-900/60 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Truck className="h-4 w-4 text-sky-400" />
                  <span className="font-semibold text-sm text-white">{v.vehicle_number}</span>
                  <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] uppercase text-slate-300">
                    {v.vehicle_type}
                  </span>
                </div>
                <span className="font-mono text-[11px] text-slate-500">{v.id}</span>
              </div>
              <div className="mt-1 text-xs text-slate-400">
                {v.driver_name} • {v.phone}
              </div>
              {locStatus?.current_location ? (
                <div className="mt-2 space-y-1">
                  <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
                    <span>
                      {locStatus.current_location.latitude.toFixed(4)},{' '}
                      {locStatus.current_location.longitude.toFixed(4)}
                    </span>
                    <span>{formatTimestamp(locStatus.current_location.timestamp)}</span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {locStatus.current_geofences.length === 0 ? (
                      <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
                        Outside all zones
                      </span>
                    ) : (
                      locStatus.current_geofences.map((g) => (
                        <span
                          key={g.geofence_id}
                          className={`rounded border px-1.5 py-0.5 text-[10px] ${
                            CATEGORY_META[g.category].badgeClass
                          }`}
                        >
                          {g.geofence_name}
                        </span>
                      ))
                    )}
                  </div>
                </div>
              ) : (
                <div className="mt-1.5 text-[11px] text-slate-500">No location reported yet</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
