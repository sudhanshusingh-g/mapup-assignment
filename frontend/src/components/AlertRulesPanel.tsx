import React, { useCallback, useEffect, useState } from 'react';
import { BellPlus, Filter, Loader2, Trash2 } from 'lucide-react';
import { ApiError, configureAlert, deleteAlert, fetchAlerts } from '../services/api';
import type { AlertEventType, AlertRule, Geofence, Vehicle } from '../types/api';
import { formatNsLatency, formatTimestamp } from '../utils/geo';

interface AlertRulesPanelProps {
  geofences: Geofence[];
  vehicles: Vehicle[];
  onRulesChanged: () => void;
}

export const AlertRulesPanel: React.FC<AlertRulesPanelProps> = ({
  geofences,
  vehicles,
  onRulesChanged,
}) => {
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [latency, setLatency] = useState('');

  // Form state
  const [geofenceId, setGeofenceId] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [eventType, setEventType] = useState<AlertEventType>('both');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Filter state
  const [filterGeofence, setFilterGeofence] = useState('');
  const [filterVehicle, setFilterVehicle] = useState('');

  const loadRules = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchAlerts({
        geofence_id: filterGeofence || undefined,
        vehicle_id: filterVehicle || undefined,
      });
      setRules(res.alerts);
      setLatency(formatNsLatency(res.time_ns));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load alert rules');
    } finally {
      setLoading(false);
    }
  }, [filterGeofence, filterVehicle]);

  useEffect(() => {
    void loadRules();
  }, [loadRules]);

  useEffect(() => {
    if (!geofenceId && geofences.length > 0) {
      setGeofenceId(geofences[0].id);
    }
  }, [geofenceId, geofences]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);
    if (!geofenceId) {
      setError('Please select a geofence');
      return;
    }

    setSubmitting(true);
    try {
      const res = await configureAlert({
        geofence_id: geofenceId,
        vehicle_id: vehicleId || undefined,
        event_type: eventType,
      });
      setSuccessMsg(
        `Configured rule ${res.alert_id} (${res.event_type}) in ${formatNsLatency(res.time_ns)}`
      );
      await loadRules();
      onRulesChanged();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(`${err.message}${err.timeNs ? ` (${formatNsLatency(err.timeNs)})` : ''}`);
      } else {
        setError('Failed to configure alert rule');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteAlert(id);
      await loadRules();
      onRulesChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete alert rule');
    }
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      {/* Create Rule Form */}
      <form
        onSubmit={handleSubmit}
        className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-5 lg:col-span-4 h-fit"
      >
        <div>
          <h2 className="text-base font-semibold text-white">Configure Alert Rule</h2>
          <p className="mt-0.5 text-xs text-slate-400">
            Trigger real-time WebSocket notifications when vehicles enter or exit a geofence.
          </p>
        </div>

        <div>
          <label className="mb-1 block text-xs text-slate-400">Geofence *</label>
          <select
            required
            value={geofenceId}
            onChange={(e) => setGeofenceId(e.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
          >
            <option value="">-- Select Geofence --</option>
            {geofences.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name} ({g.category})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs text-slate-400">Target Vehicle (Optional)</label>
          <select
            value={vehicleId}
            onChange={(e) => setVehicleId(e.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
          >
            <option value="">All Registered Vehicles</option>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.vehicle_number} — {v.driver_name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs text-slate-400">Trigger Event Type *</label>
          <div className="grid grid-cols-3 gap-2">
            {(['entry', 'exit', 'both'] as AlertEventType[]).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setEventType(type)}
                className={`rounded-lg border py-2 text-xs font-semibold uppercase transition ${
                  eventType === type
                    ? 'border-sky-500 bg-sky-500/20 text-sky-300'
                    : 'border-slate-700 bg-slate-950 text-slate-400 hover:bg-slate-800'
                }`}
              >
                {type}
              </button>
            ))}
          </div>
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
          disabled={submitting || geofences.length === 0}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-sky-500 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-50"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellPlus className="h-4 w-4" />}
          Create Alert Rule
        </button>
      </form>

      {/* Configured Alert Rules Table */}
      <div className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-5 lg:col-span-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-white">Configured Alert Rules</h2>
            <p className="text-xs text-slate-400">
              {rules.length} active rule(s) {latency ? `• Query: ${latency}` : ''}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Filter className="h-4 w-4 text-slate-500" />
            <select
              value={filterGeofence}
              onChange={(e) => setFilterGeofence(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-200 focus:border-sky-500 focus:outline-none"
            >
              <option value="">All Geofences</option>
              {geofences.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
            <select
              value={filterVehicle}
              onChange={(e) => setFilterVehicle(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-200 focus:border-sky-500 focus:outline-none"
            >
              <option value="">All Vehicles</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.vehicle_number}
                </option>
              ))}
            </select>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-xs text-slate-400">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading alert rules...
          </div>
        ) : rules.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-800 p-8 text-center text-xs text-slate-400">
            No alert rules configured yet. Create a rule on the left to trigger real-time alerts.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-800 text-slate-400 uppercase">
                <tr>
                  <th className="py-2.5 pr-4">Rule ID</th>
                  <th className="py-2.5 pr-4">Geofence</th>
                  <th className="py-2.5 pr-4">Vehicle Scope</th>
                  <th className="py-2.5 pr-4">Event</th>
                  <th className="py-2.5 pr-4">Created</th>
                  <th className="py-2.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {rules.map((rule) => (
                  <tr key={rule.alert_id} className="hover:bg-slate-800/30">
                    <td className="py-3 pr-4 font-mono text-slate-400">{rule.alert_id}</td>
                    <td className="py-3 pr-4 font-medium text-white">{rule.geofence_name}</td>
                    <td className="py-3 pr-4 text-slate-300">
                      {rule.vehicle_number ? (
                        <span className="rounded bg-slate-800 px-2 py-0.5 font-mono text-[11px]">
                          {rule.vehicle_number}
                        </span>
                      ) : (
                        <span className="rounded bg-indigo-500/15 px-2 py-0.5 text-[11px] text-indigo-300">
                          All Vehicles
                        </span>
                      )}
                    </td>
                    <td className="py-3 pr-4">
                      <span className="rounded-full bg-sky-500/15 px-2 py-0.5 font-semibold uppercase text-sky-300">
                        {rule.event_type}
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-slate-400">{formatTimestamp(rule.created_at)}</td>
                    <td className="py-3 text-right">
                      <button
                        type="button"
                        onClick={() => void handleDelete(rule.alert_id)}
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-red-500/15 hover:text-red-400"
                        title="Delete rule"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
