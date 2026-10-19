import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, insertSample, insertWifiSample, recentSamplesForDevice, lastSampleForDevice, distinctLocations, datesForLocation, latestDateForLocation, lastSampleForLocation, samplesForLocationAndDate, wifiSamplesForLocationAndDate } from '../src/server/db.ts';
import type { Db } from '../src/server/db.ts';
import type { Result } from '../src/shared/result.ts';
import type { WifiSampleDto } from '../src/shared/contract.js';

const ok = (at: string, rttMs = 10): Result => ({ at, state: 'ok', rttMs, reason: null });

async function freshDb(): Promise<Db> {
  return openDb(':memory:');
}

test('inserting the same (device, at) twice is a no-op the second time', async () => {
  const db = await freshDb();
  const result = ok('2026-06-01T00:00:00.000Z');

  assert.equal(insertSample(db, { deviceId: 'dev1', location: 'Kitchen', result }), true);
  assert.equal(insertSample(db, { deviceId: 'dev1', location: 'Kitchen', result }), false);

  assert.equal(recentSamplesForDevice(db, 'dev1', '2026-01-01T00:00:00.000Z').length, 1);
});

test('recentSamplesForDevice only returns results at or after the cutoff', async () => {
  const db = await freshDb();
  insertSample(db, { deviceId: 'dev1', location: 'Kitchen', result: ok('2026-06-01T00:00:00.000Z') });
  insertSample(db, { deviceId: 'dev1', location: 'Kitchen', result: ok('2026-06-01T01:00:00.000Z') });

  assert.equal(recentSamplesForDevice(db, 'dev1', '2026-06-01T00:30:00.000Z').length, 1);
  assert.equal(recentSamplesForDevice(db, 'dev1', '2026-06-01T00:00:00.000Z').length, 2);
});

test('lastSampleForDevice returns the most recent row, not insertion order', async () => {
  const db = await freshDb();
  insertSample(db, { deviceId: 'dev1', location: 'Kitchen', result: ok('2026-06-01T01:00:00.000Z', 20) });
  insertSample(db, { deviceId: 'dev1', location: 'Kitchen', result: ok('2026-06-01T00:00:00.000Z', 10) });

  assert.equal(lastSampleForDevice(db, 'dev1')?.rttMs, 20);
  assert.equal(lastSampleForDevice(db, 'missing'), null);
});

test('distinctLocations reflects every device that has reported', async () => {
  const db = await freshDb();
  insertSample(db, { deviceId: 'backbone-1', location: 'Backbone', result: ok('2026-06-01T00:00:00.000Z') });
  insertSample(db, { deviceId: 'pi-1', location: 'Kitchen', result: ok('2026-06-01T00:00:00.000Z') });

  assert.deepEqual(distinctLocations(db), ['Backbone', 'Kitchen']);
});

test('datesForLocation groups by calendar day, newest first', async () => {
  const db = await freshDb();
  insertSample(db, { deviceId: 'pi-1', location: 'Kitchen', result: ok('2026-06-01T23:00:00.000Z') });
  insertSample(db, { deviceId: 'pi-1', location: 'Kitchen', result: ok('2026-06-02T01:00:00.000Z') });

  assert.deepEqual(datesForLocation(db, 'Kitchen'), ['2026-06-02', '2026-06-01']);
  assert.equal(latestDateForLocation(db, 'Kitchen'), '2026-06-02');
  assert.equal(latestDateForLocation(db, 'Nowhere'), null);
});

test('samplesForLocationAndDate respects the UTC day boundary', async () => {
  const db = await freshDb();
  insertSample(db, { deviceId: 'pi-1', location: 'Kitchen', result: ok('2026-06-01T23:59:59.999Z') });
  insertSample(db, { deviceId: 'pi-1', location: 'Kitchen', result: ok('2026-06-02T00:00:00.000Z') });

  assert.equal(samplesForLocationAndDate(db, 'Kitchen', '2026-06-01').length, 1);
  assert.equal(samplesForLocationAndDate(db, 'Kitchen', '2026-06-02').length, 1);
});

test('lastSampleForLocation spans devices for that location', async () => {
  const db = await freshDb();
  insertSample(db, { deviceId: 'pi-1', location: 'Kitchen', result: ok('2026-06-01T00:00:00.000Z') });
  insertSample(db, { deviceId: 'pi-2', location: 'Kitchen', result: ok('2026-06-02T00:00:00.000Z') });

  assert.equal(lastSampleForLocation(db, 'Kitchen')?.at, '2026-06-02T00:00:00.000Z');
});

test('wifi samples round-trip with nullable fields intact', async () => {
  const db = await freshDb();
  const sample: WifiSampleDto = {
    at: '2026-06-01T00:00:00.000Z',
    connected: false,
    bssid: null,
    ssid: null,
    signalDbm: null,
    freqMhz: null,
    reason: 'not-connected',
  };

  assert.equal(insertWifiSample(db, { deviceId: 'pi-1', location: 'Kitchen', sample }), true);
  assert.equal(insertWifiSample(db, { deviceId: 'pi-1', location: 'Kitchen', sample }), false);

  const rows = wifiSamplesForLocationAndDate(db, 'Kitchen', '2026-06-01');
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.connected, false);
  assert.equal(rows[0]?.bssid, null);
});
