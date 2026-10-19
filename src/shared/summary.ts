/**
 * Derives window and hourly statistics from results.
 *
 * Two rules matter more than anything else here:
 *  1. Latency statistics are computed from successful replies only. A timeout
 *     has no round-trip time, so it must never be counted as one.
 *  2. `error` results are excluded from the loss ratio. A monitor that could
 *     not run is not evidence that the network dropped a packet.
 */

import { STATE } from './result.ts';
import type { ProbeState, Result } from './result.ts';
import { localDateOf, localHourOf } from './timezone.ts';

export type StateCounts = Record<ProbeState, number>;

export interface LatencySummary {
  readonly sampleCount: number;
  readonly medianMs: number | null;
  readonly p95Ms: number | null;
  readonly minMs: number | null;
  readonly maxMs: number | null;
}

export interface Summary {
  readonly total: number;
  readonly counts: StateCounts;
  readonly lossRatio: number | null;
  readonly latency: LatencySummary;
  readonly trailingFailureStreak: number;
}

export type StatusName = 'ok' | 'degraded' | 'down' | 'error' | 'unknown';

export interface StatusInfo {
  readonly status: StatusName;
  readonly reason: string;
  readonly ageMs?: number;
}

/** Nearest-rank percentile over an unsorted array of numbers. */
export function percentile(values: readonly number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index] ?? null;
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    const low = sorted[mid - 1];
    const high = sorted[mid];
    return low !== undefined && high !== undefined ? (low + high) / 2 : null;
  }
  return sorted[mid] ?? null;
}

/** Length of the run of consecutive non-ok results at the end of the list. */
export function trailingFailureStreak(results: readonly Result[]): number {
  let streak = 0;
  for (let i = results.length - 1; i >= 0; i -= 1) {
    if (results[i]?.state === STATE.OK) break;
    streak += 1;
  }
  return streak;
}

export function summarise(results: readonly Result[] = []): Summary {
  const counts: StateCounts = { ok: 0, timeout: 0, error: 0 };
  const rtts: number[] = [];

  for (const result of results) {
    counts[result.state] += 1;
    if (result.state === STATE.OK && result.rttMs !== null && Number.isFinite(result.rttMs)) {
      rtts.push(result.rttMs);
    }
  }

  const attempted = counts.ok + counts.timeout;

  return {
    total: results.length,
    counts,
    lossRatio: attempted > 0 ? counts.timeout / attempted : null,
    latency: {
      sampleCount: rtts.length,
      medianMs: median(rtts),
      p95Ms: percentile(rtts, 0.95),
      minMs: rtts.length > 0 ? Math.min(...rtts) : null,
      maxMs: rtts.length > 0 ? Math.max(...rtts) : null,
    },
    trailingFailureStreak: trailingFailureStreak(results),
  };
}

/** Loss above this share of attempted probes is reported as degraded. */
export const DEGRADED_LOSS_RATIO = 0.05;

/** A result older than this many intervals is no longer "current". */
export const STALE_INTERVALS = 3;

export interface DeriveStatusInput {
  last: Result | null;
  summary: Summary;
  intervalMs: number;
  now?: number;
}

/**
 * Derives a headline status from a window of results. Every outcome carries a
 * plain-language reason so a view never shows a verdict it cannot justify.
 */
export function deriveStatus({ last, summary, intervalMs, now = Date.now() }: DeriveStatusInput): StatusInfo {
  if (last === null) {
    return { status: 'unknown', reason: 'No measurement has completed yet.' };
  }

  const ageMs = now - Date.parse(last.at);
  if (ageMs > intervalMs * STALE_INTERVALS) {
    return {
      status: 'unknown',
      reason: `No measurement for ${Math.round(ageMs / 1000)}s - monitor may be stopped or suspended.`,
      ageMs,
    };
  }

  if (last.state === STATE.ERROR) {
    return { status: 'error', reason: `Probe could not run: ${last.reason}`, ageMs };
  }

  if (last.state === STATE.TIMEOUT) {
    const streak = summary.trailingFailureStreak;
    return {
      status: 'down',
      reason: streak > 1 ? `No reply to the last ${streak} probes.` : 'No reply to the last probe.',
      ageMs,
    };
  }

  if (summary.lossRatio !== null && summary.lossRatio > DEGRADED_LOSS_RATIO) {
    return {
      status: 'degraded',
      reason: `${(summary.lossRatio * 100).toFixed(1)}% of probes in the window got no reply.`,
      ageMs,
    };
  }

  return { status: 'ok', reason: 'Replies are arriving normally.', ageMs };
}

/**
 * Derives a status for a historical bucket (e.g. one hour of a past day).
 * Unlike {@link deriveStatus}, staleness is meaningless here - we are looking
 * at history, not asking whether the monitor is currently alive.
 */
export function deriveBucketStatus(summary: Summary): StatusInfo {
  if (summary.total === 0) {
    return { status: 'unknown', reason: 'No measurements in this period.' };
  }
  if (summary.counts.error === summary.total) {
    return { status: 'error', reason: 'The probe could not run during this period.' };
  }
  if (summary.lossRatio !== null && summary.lossRatio > DEGRADED_LOSS_RATIO) {
    const allLost = summary.lossRatio >= 0.999;
    return {
      status: allLost ? 'down' : 'degraded',
      reason: `${(summary.lossRatio * 100).toFixed(1)}% of probes in this hour got no reply.`,
    };
  }
  return { status: 'ok', reason: 'Replies arrived normally during this period.' };
}

/** Hour-of-day (0-23) bucket, derived from the result's own timestamp, in {@link DISPLAY_TIMEZONE}. */
export function hourOf(result: Result): number {
  return localHourOf(result.at);
}

/** Groups results into 24 hour-of-day buckets ({@link DISPLAY_TIMEZONE}) and summarises each. */
export function summariseByHour(results: readonly Result[]): Array<{ hour: number; summary: Summary; status: StatusInfo }> {
  const buckets: Result[][] = Array.from({ length: 24 }, () => []);
  for (const result of results) {
    buckets[hourOf(result)]?.push(result);
  }

  return buckets.map((bucketResults, hour) => {
    const summary = summarise(bucketResults);
    return { hour, summary, status: deriveBucketStatus(summary) };
  });
}

/** YYYY-MM-DD for grouping results into calendar days, in {@link DISPLAY_TIMEZONE}. */
export function dayOf(result: Result): string {
  return localDateOf(result.at);
}

const DATE_FORMAT_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * True only for a real calendar date in strict YYYY-MM-DD form.
 *
 * `Date.parse` alone is not enough: it accepts loose forms like "2026-6-1",
 * and it silently normalises an invalid date like "2026-02-30" into
 * "2026-03-02" instead of rejecting it. Either would otherwise pass a naive
 * check and then query the wrong day range without any visible error.
 */
export function isValidCalendarDate(date: string): boolean {
  if (!DATE_FORMAT_RE.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}
