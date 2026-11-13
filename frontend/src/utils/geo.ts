import type { GeofenceCategory } from '../types/api';

export const CATEGORY_META: Record<
  GeofenceCategory,
  { label: string; color: string; fillColor: string; badgeClass: string }
> = {
  restricted_zone: {
    label: 'Restricted Zone',
    color: '#ef4444',
    fillColor: '#ef4444',
    badgeClass: 'bg-red-500/15 text-red-300 border-red-500/40',
  },
  delivery_zone: {
    label: 'Delivery Zone',
    color: '#10b981',
    fillColor: '#10b981',
    badgeClass: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
  },
  toll_zone: {
    label: 'Toll Zone',
    color: '#f59e0b',
    fillColor: '#f59e0b',
    badgeClass: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  },
  customer_area: {
    label: 'Customer Area',
    color: '#6366f1',
    fillColor: '#6366f1',
    badgeClass: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/40',
  },
};

export function closePolygonRing(points: [number, number][]): [number, number][] {
  if (points.length === 0) return [];
  const first = points[0];
  const last = points[points.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) {
    return points;
  }
  return [...points, [first[0], first[1]]];
}

export function formatNsLatency(timeNs?: string): string {
  if (!timeNs) return '';
  const ns = Number(timeNs);
  if (!Number.isFinite(ns)) return `${timeNs} ns`;
  if (ns >= 1_000_000) return `${(ns / 1_000_000).toFixed(2)} ms`;
  if (ns >= 1_000) return `${(ns / 1_000).toFixed(1)} µs`;
  return `${ns} ns`;
}

export function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function polygonCentroid(coords: [number, number][]): [number, number] {
  if (coords.length === 0) return [37.7749, -122.4194];
  const isClosed =
    coords.length > 1 &&
    coords[0][0] === coords[coords.length - 1][0] &&
    coords[0][1] === coords[coords.length - 1][1];
  const pts = isClosed ? coords.slice(0, -1) : coords;
  const sum = pts.reduce(
    (acc, [lat, lon]) => [acc[0] + lat, acc[1] + lon],
    [0, 0]
  );
  return [sum[0] / pts.length, sum[1] / pts.length];
}
