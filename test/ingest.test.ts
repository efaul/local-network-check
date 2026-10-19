import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateIngestRequest, applyIngest, IngestError } from '../src/server/ingest.ts';
import { openDb, recentSamplesForDevice, wifiSamplesForLocationAndDate } from '../src/server/db.ts';

const validBody = (): unknown => ({
  deviceId: 'pi-1',
  location: 'Kitchen',
  samples: [
    { at: '2026-06-01T00:00:00.000Z', state: 'ok', rttMs: 9.5, reason: null },
    { at: '2026-06-01T00:00:05.000Z', state: 'timeout', rttMs: null, reason: 'no-reply' },
  ],
  wifiSamples: [
    { at: '2026-06-01T00:00:00.000Z', connected: true, bssid: 'aa:bb:cc:dd:ee:ff', ssid: 'Home', signalDbm: -55, freqMhz: 5180, reason: null },
  ],
});

test('accepts a well formed batch', () => {
  const request = validateIngestRequest(validBody());
  assert.equal(request.deviceId, 'pi-1');
  assert.equal(request.samples.length, 2);
  assert.equal(request.wifiSamples.length, 1);
});

test('defaults wifiSamples to empty when omitted', () => {
  const body = validBody() as Record<string, unknown>;
  delete body['wifiSamples'];
  assert.deepEqual(validateIngestRequest(body).wifiSamples, []);
});

test('rejects a missing deviceId', () => {
  const body = validBody() as Record<string, unknown>;
  delete body['deviceId'];
  assert.throws(() => validateIngestRequest(body), IngestError);
});

test('rejects an rttMs on a non-ok sample', () => {
  const body = validBody() as { samples: unknown[] };
  body.samples = [{ at: '2026-06-01T00:00:00.000Z', state: 'timeout', rttMs: 5, reason: 'no-reply' }];
  assert.throws(() => validateIngestRequest(body), /rttMs must be null unless state is "ok"/);
});

test('rejects an unknown state', () => {
  const body = validBody() as { samples: unknown[] };
  body.samples = [{ at: '2026-06-01T00:00:00.000Z', state: 'bogus', rttMs: null, reason: null }];
  assert.throws(() => validateIngestRequest(body), /must be one of ok, timeout, error/);
});

test('rejects an invalid timestamp', () => {
  const body = validBody() as { samples: unknown[] };
  body.samples = [{ at: 'not-a-date', state: 'ok', rttMs: 1, reason: null }];
  assert.throws(() => validateIngestRequest(body), /must be a valid ISO timestamp/);
});

test('normalises a loosely-formatted but parseable timestamp to canonical ISO', () => {
  // Every later query compares `at` as TEXT (lexicographic ordering), which
  // only holds if timestamps are canonical, zero-padded, and millisecond-
  // precise. A client sending a valid-but-non-canonical ISO form (here:
  // missing milliseconds) must not be stored verbatim.
  const body = validBody() as { samples: unknown[] };
  body.samples = [{ at: '2026-06-01T00:05:00Z', state: 'ok', rttMs: 1, reason: null }];
  const request = validateIngestRequest(body);
  assert.equal(request.samples[0]?.at, '2026-06-01T00:05:00.000Z');
});

test('applyIngest persists samples and wifi samples, and reports accepted counts', async () => {
  const db = await openDb(':memory:');
  const request = validateIngestRequest(validBody());

  const first = applyIngest(db, request);
  assert.equal(first.acceptedSamples, 2);
  assert.equal(first.acceptedWifiSamples, 1);

  // A retried POST (e.g. after a dropped response) must not double-count.
  const second = applyIngest(db, request);
  assert.equal(second.acceptedSamples, 0);
  assert.equal(second.acceptedWifiSamples, 0);

  assert.equal(recentSamplesForDevice(db, 'pi-1', '2026-01-01T00:00:00.000Z').length, 2);
  assert.equal(wifiSamplesForLocationAndDate(db, 'Kitchen', '2026-06-01').length, 1);
});
