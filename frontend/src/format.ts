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

export type Freshness = 'fresh' | 'stale' | 'very-stale' | 'unknown';

/** YYYY-MM-DD for an instant, in {@link DISPLAY_TIMEZONE}. */
function localDateOf(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: DISPLAY_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/**
 * How stale a room's most recent sample is, in whole calendar days
 * ({@link DISPLAY_TIMEZONE}) rather than elapsed hours - a sample from 23:00
 * yesterday reads as a day old all through today instead of ageing out of
 * "today" partway through the morning.
 */
export function freshnessOf(lastSeenAt: string | null, now: Date = new Date()): Freshness {
  if (lastSeenAt === null) return 'unknown';
  const parsed = Date.parse(lastSeenAt);
  if (Number.isNaN(parsed)) return 'unknown';

  const lastDay = Date.parse(`${localDateOf(new Date(parsed))}T00:00:00.000Z`);
  const today = Date.parse(`${localDateOf(now)}T00:00:00.000Z`);
  const daysOld = Math.round((today - lastDay) / 86_400_000);

  if (daysOld <= 0) return 'fresh';
  if (daysOld === 1) return 'stale';
  return 'very-stale';
}

const FRESHNESS_TITLE: Record<Freshness, string> = {
  fresh: 'Data freshness: up to date (sampled today)',
  stale: 'Data freshness: stale (last sampled yesterday)',
  'very-stale': 'Data freshness: very stale (last sampled 2+ days ago)',
  unknown: 'Data freshness: no samples yet',
};

export function freshnessTitle(freshness: Freshness): string {
  return FRESHNESS_TITLE[freshness];
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
