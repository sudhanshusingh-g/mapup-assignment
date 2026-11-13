import React, { useEffect, useState } from 'react';
import { Loader2, MapPin, PenTool, PlusCircle } from 'lucide-react';
import { ApiError, createGeofence } from '../services/api';
import type { Geofence, GeofenceCategory } from '../types/api';
import { CATEGORY_META, closePolygonRing, formatNsLatency, polygonCentroid } from '../utils/geo';

interface GeofencePanelProps {
  geofences: Geofence[];
  loading: boolean;
  categoryFilter: string;
  onCategoryFilterChange: (cat: string) => void;
  draftPoints: [number, number][];
  onStartDrawOnMap: () => void;
  onClearDraft: () => void;
  onCreated: () => Promise<void>;
  onFocusGeofence: (center: [number, number]) => void;
}

const DEFAULT_SAMPLE_COORDS = JSON.stringify(
  [
    [37.7749, -122.4194],
    [37.7849, -122.4194],
    [37.7849, -122.4094],
    [37.7749, -122.4094],
    [37.7749, -122.4194],
  ],
  null,
  2
);

export const GeofencePanel: React.FC<GeofencePanelProps> = ({
  geofences,
  loading,
  categoryFilter,
  onCategoryFilterChange,
  draftPoints,
  onStartDrawOnMap,
  onClearDraft,
  onCreated,
  onFocusGeofence,
}) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<GeofenceCategory>('restricted_zone');
  const [coordsText, setCoordsText] = useState(DEFAULT_SAMPLE_COORDS);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    if (draftPoints.length >= 3) {
      const closed = closePolygonRing(draftPoints);
      setCoordsText(JSON.stringify(closed, null, 2));
    }
  }, [draftPoints]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    let parsedCoords: [number, number][];
    try {
      parsedCoords = JSON.parse(coordsText);
      if (!Array.isArray(parsedCoords)) {
        throw new Error('Coordinates must be a JSON array of [lat, lon] pairs');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid coordinates JSON');
      return;
    }

    setSubmitting(true);
    try {
      const res = await createGeofence({
        name: name.trim(),
        description: description.trim(),
        category,
        coordinates: parsedCoords,
      });
      setSuccessMsg(`Created "${res.name}" (${res.id}) in ${formatNsLatency(res.time_ns)}`);
      setName('');
      setDescription('');
      onClearDraft();
      await onCreated();
      if (parsedCoords.length > 0) {
        onFocusGeofence(polygonCentroid(parsedCoords));
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setError(`${err.message}${err.timeNs ? ` (${formatNsLatency(err.timeNs)})` : ''}`);
      } else {
        setError('Failed to create geofence');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const categories: { value: string; label: string }[] = [
    { value: '', label: 'All' },
    { value: 'restricted_zone', label: 'Restricted' },
    { value: 'delivery_zone', label: 'Delivery' },
    { value: 'toll_zone', label: 'Toll' },
    { value: 'customer_area', label: 'Customer' },
  ];

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit} className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/70 p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">Create Geofence</h3>
          <button
            type="button"
            onClick={onStartDrawOnMap}
            className="flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-300 hover:bg-emerald-500/20"
          >
            <PenTool className="h-3.5 w-3.5" />
            Draw on Map
          </button>
        </div>

        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs text-slate-400">Name *</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Downtown Restricted Zone"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">Category *</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as GeofenceCategory)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-white focus:border-sky-500 focus:outline-none"
            >
              <option value="restricted_zone">restricted_zone</option>
              <option value="delivery_zone">delivery_zone</option>
              <option value="toll_zone">toll_zone</option>
              <option value="customer_area">customer_area</option>
            </select>
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs text-slate-400">Description</label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional zone description"
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none"
          />
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="text-xs text-slate-400">
              Coordinates JSON <span className="text-slate-500">([latitude, longitude], closed ring)</span>
            </label>
            <button
              type="button"
              onClick={() => setCoordsText(DEFAULT_SAMPLE_COORDS)}
              className="text-[11px] text-sky-400 hover:underline"
            >
              Load SF Sample
            </button>
          </div>
          <textarea
            rows={4}
            value={coordsText}
            onChange={(e) => setCoordsText(e.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-200 focus:border-sky-500 focus:outline-none"
          />
        </div>

        {error && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
          </div>
        )}
        {successMsg && (
          <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
            {successMsg}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-sky-400 disabled:opacity-50"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlusCircle className="h-4 w-4" />}
          Save Geofence
        </button>
      </form>

      {/* Geofences List + Category Filter */}
      <div className="space-y-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {categories.map((c) => (
            <button
              key={c.value || 'all'}
              type="button"
              onClick={() => onCategoryFilterChange(c.value)}
              className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
                categoryFilter === c.value
                  ? 'bg-sky-500 text-slate-950 font-semibold'
                  : 'border border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-8 text-xs text-slate-400">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading geofences...
          </div>
        ) : geofences.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-800 p-6 text-center text-xs text-slate-400">
            No geofences found for this filter. Draw one on the map or use the form above.
          </div>
        ) : (
          <div className="max-h-64 space-y-2 overflow-y-auto pr-1 custom-scrollbar">
            {geofences.map((g) => {
              const meta = CATEGORY_META[g.category];
              return (
                <div
                  key={g.id}
                  className="flex items-start justify-between gap-2 rounded-xl border border-slate-800 bg-slate-900/60 p-3 hover:border-slate-700"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-sm text-white truncate">{g.name}</span>
                      <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${meta.badgeClass}`}>
                        {meta.label}
                      </span>
                    </div>
                    {g.description && <p className="text-xs text-slate-400 line-clamp-1">{g.description}</p>}
                    <div className="font-mono text-[11px] text-slate-500">
                      {g.id} • {g.coordinates.length} points
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onFocusGeofence(polygonCentroid(g.coordinates))}
                    className="shrink-0 rounded-lg border border-slate-700 bg-slate-800/80 p-1.5 text-slate-300 hover:bg-slate-700 hover:text-white"
                    title="Focus on map"
                  >
                    <MapPin className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
