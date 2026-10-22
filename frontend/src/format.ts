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
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function timeAgoFromIso(iso: string | null): string {
  if (iso === null) return 'never';
  return age(Date.now() - Date.parse(iso));
}

export function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { timeZone: DISPLAY_TIMEZONE });
}

/** Absolute date + time, e.g. "21 Oct, 07:49:41" - for places a relative "X ago" isn't precise enough. */
export function dateTimeOf(iso: string | null): string {
  if (iso === null) return '—';
  const date = new Date(iso);
  const datePart = date.toLocaleDateString('en-GB', { timeZone: DISPLAY_TIMEZONE, day: 'numeric', month: 'short' });
  const timePart = date.toLocaleTimeString('en-GB', { timeZone: DISPLAY_TIMEZONE });
  return `${datePart}, ${timePart}`;
}

/**
 * "ssid(identifier)" where identifier is the configured friendly name (config
 * `apNames`) when one exists, otherwise the raw BSSID - same shape either
 * way, just with a human-readable identifier swapped in when available.
 */
export function networkLabel(ssid: string | null, bssid: string, apName: string | null): string {
  const identifier = apName ?? bssid;
  return `${ssid ?? identifier} (${identifier})`;
}
