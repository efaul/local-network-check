import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  summarise, deriveStatus, deriveBucketStatus, summariseByHour, hourOf, dayOf, isValidCalendarDate,
  median, percentile, trailingFailureStreak,
} from '../src/shared/summary.ts';
import type { Result } from '../src/shared/result.ts';

const at = (): string => new Date().toISOString();
const ok = (rttMs: number, when: string = at()): Result => ({ state: 'ok', rttMs, at: when, reason: null });
const timeout = (when: string = at()): Result => ({ state: 'timeout', rttMs: null, at: when, reason: 'no-reply' });
const error = (when: string = at()): Result => ({ state: 'error', rttMs: null, at: when, reason: 'ping-command-not-found' });

test('median and percentile handle small sets', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), null);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.95), 10);
  assert.equal(percentile([], 0.95), null);
});

test('latency statistics ignore timeouts and errors', () => {
  const summary = summarise([ok(10), timeout(), ok(20), error()]);
  assert.equal(summary.latency.sampleCount, 2);
  assert.equal(summary.latency.medianMs, 15);
});

test('p98 is always at or above p95 and null exactly when p95 is null', () => {
  const rtts = [10, 12, 15, 20, 22, 30, 45, 50, 70, 100];
  const summary = summarise(rtts.map((r) => ok(r)));
  assert.equal(summary.latency.p95Ms, 100);
  assert.equal(summary.latency.p98Ms, 100);
  assert.ok((summary.latency.p98Ms ?? 0) >= (summary.latency.p95Ms ?? 0));

  const single = summarise([ok(42)]);
  assert.equal(single.latency.p95Ms, 42);
  assert.equal(single.latency.p98Ms, 42);

  const none = summarise([timeout(), error()]);
  assert.equal(none.latency.p95Ms, null);
  assert.equal(none.latency.p98Ms, null);
});

test('probe errors are excluded from the loss ratio', () => {
  assert.equal(summarise([ok(10), ok(12), error()]).lossRatio, 0);
});

test('loss ratio counts timeouts against attempted probes', () => {
  assert.equal(summarise([ok(10), timeout()]).lossRatio, 0.5);
});

test('loss ratio is unknown when nothing reached the network', () => {
  assert.equal(summarise([error(), error()]).lossRatio, null);
  assert.equal(summarise([]).lossRatio, null);
});

test('trailing failure streak counts only the run at the end', () => {
  assert.equal(trailingFailureStreak([ok(1), timeout(), timeout()]), 2);
  assert.equal(trailingFailureStreak([timeout(), ok(1)]), 0);
});

test('live status is unknown before any measurement', () => {
  const status = deriveStatus({ last: null, summary: summarise([]), intervalMs: 5000 });
  assert.equal(status.status, 'unknown');
});

test('live status is unknown when the last measurement is stale', () => {
  const old = ok(10, new Date(Date.now() - 60_000).toISOString());
  const status = deriveStatus({ last: old, summary: summarise([old]), intervalMs: 5000 });
  assert.equal(status.status, 'unknown');
});

test('live status reports a probe error distinctly from down', () => {
  const last = error();
  const status = deriveStatus({ last, summary: summarise([last]), intervalMs: 5000 });
  assert.equal(status.status, 'error');
});

test('live status is degraded above the loss threshold, not at it', () => {
  const degraded = deriveStatus({
    last: ok(11),
    summary: summarise([...Array.from({ length: 10 }, () => ok(10)), timeout(), timeout(), ok(11)]),
    intervalMs: 5000,
  });
  assert.equal(degraded.status, 'degraded');

  const atThreshold = deriveStatus({
    last: ok(11),
    summary: summarise([...Array.from({ length: 18 }, () => ok(10)), timeout(), ok(11)]),
    intervalMs: 5000,
  });
  assert.equal(atThreshold.status, 'ok');
});

test('bucket status is unknown for an empty period, not down', () => {
  assert.equal(deriveBucketStatus(summarise([])).status, 'unknown');
});

test('bucket status does not care about staleness', () => {
  // A whole hour from a week ago is still a meaningful historical verdict.
  const weekOld = ok(10, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());
  assert.equal(deriveBucketStatus(summarise([weekOld])).status, 'ok');
});

test('bucket status is down when every probe in the period got no reply', () => {
  assert.equal(deriveBucketStatus(summarise([timeout(), timeout()])).status, 'down');
});

test('bucket status is degraded, not down, for partial loss', () => {
  const results = [...Array.from({ length: 10 }, () => ok(10)), timeout(), timeout()];
  assert.equal(deriveBucketStatus(summarise(results)).status, 'degraded');
});

test('summariseByHour buckets by Europe/Amsterdam hour and leaves empty hours unknown', () => {
  // 2026-06-01 is CEST (UTC+2): 00:05/00:50 UTC land in local hour 2,
  // and 23:10 UTC rolls into local hour 1 the next day.
  const day = '2026-06-01';
  const results = [
    ok(10, `${day}T00:05:00.000Z`),
    ok(12, `${day}T00:50:00.000Z`),
    timeout(`${day}T23:10:00.000Z`),
  ];

  const buckets = summariseByHour(results);
  assert.equal(buckets.length, 24);
  assert.equal(buckets[2]?.summary.total, 2);
  assert.equal(buckets[2]?.status.status, 'ok');
  assert.equal(buckets[1]?.status.status, 'down');
  assert.equal(buckets[12]?.status.status, 'unknown');
});

test('hourOf and dayOf read the sample timestamp in Europe/Amsterdam, not the system clock', () => {
  // 14:30 UTC on 2026-06-01 (CEST, UTC+2) is 16:30 local, same calendar day.
  assert.equal(hourOf(ok(1, '2026-06-01T14:30:00.000Z')), 16);
  assert.equal(dayOf(ok(1, '2026-06-01T14:30:00.000Z')), '2026-06-01');
});

test('isValidCalendarDate requires strict zero-padded YYYY-MM-DD', () => {
  assert.equal(isValidCalendarDate('2026-06-01'), true);
  assert.equal(isValidCalendarDate('2026-6-1'), false);
  assert.equal(isValidCalendarDate('2026/06/01'), false);
  assert.equal(isValidCalendarDate('not-a-date'), false);
});

test('isValidCalendarDate rejects a date that silently rolls over (Date does not reject Feb 30)', () => {
  // new Date('2026-02-30T00:00:00.000Z') normalises to 2026-03-02 instead of
  // throwing. A naive Date.parse-based check would accept this and silently
  // query the wrong day.
  assert.equal(isValidCalendarDate('2026-02-30'), false);
  assert.equal(isValidCalendarDate('2026-13-01'), false);
});
