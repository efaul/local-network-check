import type { StatusName } from './types';

/** Must match DISPLAY_TIMEZONE in src/shared/timezone.ts. */
export const DISPLAY_TIMEZONE = 'Europe/Amsterdam';

export const STATUS_TEXT: Record<StatusName, string> = {
  ok: 'OK',
  degraded: 'Degraded',
  down: 'No reply',
  error: 'Probe error',
  unknown: 'Unknown',
};

export function ms(value: number | null): string {
  return value !== null && Number.isFinite(value) ? `${value.toFixed(1)} ms` : '—';
}

export function pct(value: number | null): string {
  return value === null ? '—' : `${(value * 100).toFixed(1)}%`;
}

export function age(ageMs: number | null): string {
  if (ageMs === null || !Number.isFinite(ageMs)) return '—';
  const seconds = Math.max(0, Math.round(ageMs / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s ago`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m ago`;
}

export function timeAgoFromIso(iso: string | null): string {
  if (iso === null) return 'never';
  return age(Date.now() - Date.parse(iso));
}

export function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { timeZone: DISPLAY_TIMEZONE });
}
