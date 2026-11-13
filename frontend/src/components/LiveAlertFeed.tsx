import React from 'react';
import { AlertTriangle, Bell, LogIn, LogOut, Trash2 } from 'lucide-react';
import type { WebSocketAlert } from '../types/api';
import type { WsStatus } from '../hooks/useAlertsWebSocket';
import { CATEGORY_META, formatTimestamp } from '../utils/geo';

interface LiveAlertFeedProps {
  alerts: WebSocketAlert[];
  wsStatus: WsStatus;
  onClear: () => void;
  onFocusLocation?: (center: [number, number]) => void;
}

const AlertFeedItem = React.memo<{
  alert: WebSocketAlert;
  onFocusLocation?: (center: [number, number]) => void;
}>(({ alert, onFocusLocation }) => {
  const isRestricted = alert.geofence.category === 'restricted_zone';
  const isEntry = alert.event_type === 'entry';
  const catMeta = CATEGORY_META[alert.geofence.category];

  return (
    <div
      onClick={() => onFocusLocation?.([alert.location.latitude, alert.location.longitude])}
      className={`cursor-pointer rounded-xl border p-3 transition hover:brightness-110 ${
        isRestricted
          ? 'border-red-500/40 bg-red-950/30'
          : 'border-slate-800 bg-slate-900/70'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          {isRestricted ? (
            <AlertTriangle className="h-4 w-4 text-red-400" />
          ) : (
            <Bell className="h-4 w-4 text-sky-400" />
          )}
          <span className="font-semibold text-xs text-white">{alert.vehicle.vehicle_number}</span>
          <span className="text-[11px] text-slate-400">({alert.vehicle.driver_name})</span>
        </div>
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
            isEntry ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'
          }`}
        >
          {isEntry ? <LogIn className="h-3 w-3" /> : <LogOut className="h-3 w-3" />}
          {alert.event_type}
        </span>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-300">
        <span className="font-medium text-white">{alert.geofence.geofence_name}</span>
        <span className={`rounded border px-1.5 py-0.5 text-[10px] ${catMeta.badgeClass}`}>
          {catMeta.label}
        </span>
      </div>

      <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-500">
        <span className="font-mono">
          {alert.location.latitude.toFixed(4)}, {alert.location.longitude.toFixed(4)}
        </span>
        <span>{formatTimestamp(alert.timestamp)}</span>
      </div>
    </div>
  );
});
AlertFeedItem.displayName = 'AlertFeedItem';

export const LiveAlertFeed: React.FC<LiveAlertFeedProps> = ({
  alerts,
  wsStatus,
  onClear,
  onFocusLocation,
}) => {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-white">Real-time Alert Stream</h3>
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
              wsStatus === 'connected'
                ? 'bg-emerald-500/15 text-emerald-300'
                : wsStatus === 'connecting'
                ? 'bg-amber-500/15 text-amber-300'
                : 'bg-red-500/15 text-red-300'
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                wsStatus === 'connected'
                  ? 'bg-emerald-400 animate-pulse'
                  : wsStatus === 'connecting'
                  ? 'bg-amber-400 animate-pulse'
                  : 'bg-red-400'
              }`}
            />
            {wsStatus}
          </span>
        </div>

        {alerts.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-slate-400 hover:bg-slate-800 hover:text-slate-200"
          >
            <Trash2 className="h-3 w-3" />
            Clear
          </button>
        )}
      </div>

      {alerts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-800 p-8 text-center text-xs text-slate-400">
          Listening for WebSocket events on <code className="text-sky-400">/ws/alerts</code>. Trigger
          a vehicle entry or exit on a configured rule to see instant alerts here.
        </div>
      ) : (
        <div className="max-h-[460px] space-y-2 overflow-y-auto pr-1 custom-scrollbar">
          {alerts.map((alert) => (
            <AlertFeedItem key={alert.event_id} alert={alert} onFocusLocation={onFocusLocation} />
          ))}
        </div>
      )}
    </div>
  );
};
