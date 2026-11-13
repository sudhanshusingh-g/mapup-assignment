import React from 'react';
import { AlertTriangle, CheckCircle2, LogIn, LogOut, X } from 'lucide-react';
import type { WebSocketAlert } from '../types/api';
import { CATEGORY_META, formatTimestamp } from '../utils/geo';

interface ToastNotificationsProps {
  toasts: WebSocketAlert[];
  onDismiss: (eventId: string) => void;
}

export const ToastNotifications: React.FC<ToastNotificationsProps> = React.memo(
  ({ toasts, onDismiss }) => {
    if (toasts.length === 0) return null;

    return (
      <div className="fixed right-4 top-16 z-[2000] flex w-full max-w-sm flex-col gap-2.5 pointer-events-none">
        {toasts.map((alert) => {
          const isRestricted = alert.geofence.category === 'restricted_zone';
          const isEntry = alert.event_type === 'entry';
          const catMeta = CATEGORY_META[alert.geofence.category];

          return (
            <div
              key={alert.event_id}
              className={`pointer-events-auto rounded-xl border p-3.5 shadow-2xl backdrop-blur-md transition-all ${
                isRestricted
                  ? 'border-red-500/60 bg-red-950/90 text-red-50'
                  : 'border-slate-700 bg-slate-900/95 text-slate-100'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  {isRestricted ? (
                    <AlertTriangle className="h-5 w-5 shrink-0 text-red-400" />
                  ) : (
                    <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" />
                  )}
                  <span className="text-xs font-semibold uppercase tracking-wider">
                    {isRestricted ? 'Restricted Zone Alert' : 'Geofence Alert'}
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase ${
                      isEntry
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : 'bg-amber-500/20 text-amber-300'
                    }`}
                  >
                    {isEntry ? <LogIn className="h-3 w-3" /> : <LogOut className="h-3 w-3" />}
                    {alert.event_type}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => onDismiss(alert.event_id)}
                  className="rounded p-0.5 text-slate-400 hover:bg-white/10 hover:text-white"
                  aria-label="Dismiss notification"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-2 space-y-1 text-xs">
                <div className="font-semibold text-sm">
                  {alert.vehicle.vehicle_number}{' '}
                  <span className="font-normal text-slate-300">({alert.vehicle.driver_name})</span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-slate-200">
                  <span>{isEntry ? 'Entered' : 'Exited'}</span>
                  <span className="font-medium text-white">{alert.geofence.geofence_name}</span>
                  <span className={`rounded border px-1.5 py-0.5 text-[10px] ${catMeta.badgeClass}`}>
                    {catMeta.label}
                  </span>
                </div>
                <div className="flex items-center justify-between pt-1 text-[11px] text-slate-400">
                  <span>
                    {alert.location.latitude.toFixed(4)}, {alert.location.longitude.toFixed(4)}
                  </span>
                  <span>{formatTimestamp(alert.timestamp)}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  }
);

ToastNotifications.displayName = 'ToastNotifications';
