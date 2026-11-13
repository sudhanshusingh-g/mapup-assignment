import React, { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, History, Loader2, LogIn, LogOut, RotateCcw } from 'lucide-react';
import { fetchViolations } from '../services/api';
import type { Geofence, Vehicle, Violation } from '../types/api';
import { formatNsLatency, formatTimestamp } from '../utils/geo';

interface ViolationHistoryPanelProps {
  geofences: Geofence[];
  vehicles: Vehicle[];
  refreshSignal: number;
}

const ViolationRow = React.memo<{ v: Violation }>(({ v }) => {
  const isEntry = v.event_type === 'entry';
  return (
    <tr className="hover:bg-slate-800/30">
      <td className="py-3 pr-4 font-mono text-slate-400">{v.id}</td>
      <td className="py-3 pr-4">
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase ${
            isEntry ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'
          }`}
        >
          {isEntry ? <LogIn className="h-3 w-3" /> : <LogOut className="h-3 w-3" />}
          {v.event_type}
        </span>
      </td>
      <td className="py-3 pr-4 font-medium text-white">{v.vehicle_number}</td>
      <td className="py-3 pr-4 text-slate-200">{v.geofence_name}</td>
      <td className="py-3 pr-4 font-mono text-slate-400">
        {v.latitude.toFixed(5)}, {v.longitude.toFixed(5)}
      </td>
      <td className="py-3 text-slate-300">{formatTimestamp(v.timestamp)}</td>
    </tr>
  );
});
ViolationRow.displayName = 'ViolationRow';

export const ViolationHistoryPanel: React.FC<ViolationHistoryPanelProps> = ({
  geofences,
  vehicles,
  refreshSignal,
}) => {
  const [vehicleId, setVehicleId] = useState('');
  const [geofenceId, setGeofenceId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [limit, setLimit] = useState(25);
  const [offset, setOffset] = useState(0);

  const [violations, setViolations] = useState<Violation[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [latency, setLatency] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchViolations({
        vehicle_id: vehicleId || undefined,
        geofence_id: geofenceId || undefined,
        start_date: startDate ? new Date(startDate).toISOString() : undefined,
        end_date: endDate ? new Date(endDate).toISOString() : undefined,
        limit,
        offset,
      });
      setViolations(res.violations);
      setTotalCount(res.total_count);
      setLatency(formatNsLatency(res.time_ns));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load violation history');
    } finally {
      setLoading(false);
    }
  }, [vehicleId, geofenceId, startDate, endDate, limit, offset]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory, refreshSignal]);

  const handleResetFilters = () => {
    setVehicleId('');
    setGeofenceId('');
    setStartDate('');
    setEndDate('');
    setOffset(0);
  };

  const currentPage = Math.floor(offset / limit) + 1;
  const totalPages = Math.max(1, Math.ceil(totalCount / limit));

  return (
    <div className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <History className="h-5 w-5 text-sky-400" />
          <div>
            <h2 className="text-base font-semibold text-white">Geofence Entry / Exit History</h2>
            <p className="text-xs text-slate-400">
              {totalCount} total event(s) {latency ? `• Query: ${latency}` : ''}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleResetFilters}
          className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Reset Filters
        </button>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div>
          <label className="mb-1 block text-[11px] text-slate-400">Vehicle</label>
          <select
            value={vehicleId}
            onChange={(e) => {
              setVehicleId(e.target.value);
              setOffset(0);
            }}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white focus:border-sky-500 focus:outline-none"
          >
            <option value="">All Vehicles</option>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.vehicle_number}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-[11px] text-slate-400">Geofence</label>
          <select
            value={geofenceId}
            onChange={(e) => {
              setGeofenceId(e.target.value);
              setOffset(0);
            }}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white focus:border-sky-500 focus:outline-none"
          >
            <option value="">All Geofences</option>
            {geofences.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-[11px] text-slate-400">Start Date</label>
          <input
            type="datetime-local"
            value={startDate}
            onChange={(e) => {
              setStartDate(e.target.value);
              setOffset(0);
            }}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white focus:border-sky-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="mb-1 block text-[11px] text-slate-400">End Date</label>
          <input
            type="datetime-local"
            value={endDate}
            onChange={(e) => {
              setEndDate(e.target.value);
              setOffset(0);
            }}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white focus:border-sky-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="mb-1 block text-[11px] text-slate-400">Page Size</label>
          <select
            value={limit}
            onChange={(e) => {
              setLimit(Number(e.target.value));
              setOffset(0);
            }}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white focus:border-sky-500 focus:outline-none"
          >
            <option value={10}>10 / page</option>
            <option value={25}>25 / page</option>
            <option value={50}>50 / page</option>
            <option value={100}>100 / page</option>
          </select>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12 text-xs text-slate-400">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading violation history...
        </div>
      ) : violations.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-800 p-8 text-center text-xs text-slate-400">
          No entry or exit events recorded matching the selected filters.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-800 text-slate-400 uppercase">
              <tr>
                <th className="py-2.5 pr-4">Event ID</th>
                <th className="py-2.5 pr-4">Type</th>
                <th className="py-2.5 pr-4">Vehicle</th>
                <th className="py-2.5 pr-4">Geofence</th>
                <th className="py-2.5 pr-4">Coordinates</th>
                <th className="py-2.5">Timestamp</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {violations.map((v) => (
                <ViolationRow key={v.id} v={v} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination Controls */}
      <div className="flex items-center justify-between border-t border-slate-800 pt-3 text-xs text-slate-400">
        <span>
          Page <strong className="text-white">{currentPage}</strong> of{' '}
          <strong className="text-white">{totalPages}</strong> ({totalCount} total)
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={offset === 0 || loading}
            onClick={() => setOffset(Math.max(0, offset - limit))}
            className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-slate-200 hover:bg-slate-800 disabled:opacity-40"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Previous
          </button>
          <button
            type="button"
            disabled={offset + limit >= totalCount || loading}
            onClick={() => setOffset(offset + limit)}
            className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-slate-200 hover:bg-slate-800 disabled:opacity-40"
          >
            Next
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
