import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, insertSample, insertWifiSample, recentSamplesForDevice, lastSampleForDevice, distinctLocations, datesForLocation, latestDateForLocation, lastSampleForLocation, samplesForLocationAndDate, wifiSamplesForLocationAndDate, lastConnectedWifiSampleForLocation, distinctConnectedApsForLocation } from '../src/server/db.ts';
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

test('datesForLocation groups by calendar day (Europe/Amsterdam), newest first', async () => {
  const db = await freshDb();
  insertSample(db, { deviceId: 'pi-1', location: 'Kitchen', result: ok('2026-06-01T10:00:00.000Z') });
  insertSample(db, { deviceId: 'pi-1', location: 'Kitchen', result: ok('2026-06-02T10:00:00.000Z') });

  assert.deepEqual(datesForLocation(db, 'Kitchen'), ['2026-06-02', '2026-06-01']);
  assert.equal(latestDateForLocation(db, 'Kitchen'), '2026-06-02');
  assert.equal(latestDateForLocation(db, 'Nowhere'), null);
});

test('samplesForLocationAndDate respects the Europe/Amsterdam day boundary', async () => {
  const db = await freshDb();
  // CEST is UTC+2: 21:59:59.999Z is 23:59:59.999 local (still 06-01),
  // and 22:00:00.000Z is 00:00:00 local the next day (06-02).
  insertSample(db, { deviceId: 'pi-1', location: 'Kitchen', result: ok('2026-06-01T21:59:59.999Z') });
  insertSample(db, { deviceId: 'pi-1', location: 'Kitchen', result: ok('2026-06-01T22:00:00.000Z') });

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

test('lastConnectedWifiSampleForLocation ignores a trailing disconnect and returns the last real AP association', async () => {
  const db = await freshDb();
  insertWifiSample(db, {
    deviceId: 'pi-1',
    location: 'Kitchen',
    sample: { at: '2026-06-01T10:00:00.000Z', connected: true, bssid: 'aa:bb:cc:dd:ee:ff', ssid: 'Home', signalDbm: -55, freqMhz: 5180, reason: null },
  });
  insertWifiSample(db, {
    deviceId: 'pi-1',
    location: 'Kitchen',
    sample: { at: '2026-06-01T11:00:00.000Z', connected: false, bssid: null, ssid: null, signalDbm: null, freqMhz: null, reason: 'roaming' },
  });

  const latest = lastConnectedWifiSampleForLocation(db, 'Kitchen');
  assert.equal(latest?.bssid, 'aa:bb:cc:dd:ee:ff');
  assert.equal(latest?.ssid, 'Home');
  assert.equal(latest?.signalDbm, -55);
  assert.equal(lastConnectedWifiSampleForLocation(db, 'Nowhere'), null);
});

test('distinctConnectedApsForLocation groups by BSSID, newest sighting first, ignoring disconnects', async () => {
  const db = await freshDb();
  // Roamed from ap-1 to ap-2, then back to ap-1, plus a disconnect blip that
  // must not appear as a third "AP".
  insertWifiSample(db, {
    deviceId: 'pi-1',
    location: 'Kitchen',
    sample: { at: '2026-06-01T08:00:00.000Z', connected: true, bssid: 'ap-1', ssid: 'Home', signalDbm: -60, freqMhz: 2437, reason: null },
  });
  insertWifiSample(db, {
    deviceId: 'pi-1',
    location: 'Kitchen',
    sample: { at: '2026-06-01T09:00:00.000Z', connected: true, bssid: 'ap-2', ssid: 'Home', signalDbm: -50, freqMhz: 5180, reason: null },
  });
  insertWifiSample(db, {
    deviceId: 'pi-1',
    location: 'Kitchen',
    sample: { at: '2026-06-01T10:00:00.000Z', connected: false, bssid: null, ssid: null, signalDbm: null, freqMhz: null, reason: 'roaming' },
  });
  insertWifiSample(db, {
    deviceId: 'pi-1',
    location: 'Kitchen',
    sample: { at: '2026-06-01T11:00:00.000Z', connected: true, bssid: 'ap-1', ssid: 'Home', signalDbm: -62, freqMhz: 2437, reason: null },
  });

  const aps = distinctConnectedApsForLocation(db, 'Kitchen');
  assert.equal(aps.length, 2, 'one entry per distinct BSSID, not per sample');
  assert.equal(aps[0]?.bssid, 'ap-1', 'most recently seen AP (11:00) ranks first');
  assert.equal(aps[0]?.lastSeenAt, '2026-06-01T11:00:00.000Z');
  assert.equal(aps[1]?.bssid, 'ap-2');
  assert.deepEqual(distinctConnectedApsForLocation(db, 'Nowhere'), []);
});
