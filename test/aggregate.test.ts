import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, insertSample, insertWifiSample } from '../src/server/db.ts';
import type { Db } from '../src/server/db.ts';
import { getRoomsList, getHoursForDay, getDaysForLocation, getDayDetail } from '../src/server/aggregate.ts';
import type { Result } from '../src/shared/result.ts';

const ok = (at: string, rttMs = 10): Result => ({ at, state: 'ok', rttMs, reason: null });
const timeout = (at: string): Result => ({ at, state: 'timeout', rttMs: null, reason: 'no-reply' });

async function seededDb(): Promise<Db> {
  const db = await openDb(':memory:');

  // Backbone: live, currently healthy.
  insertSample(db, { deviceId: 'backbone-1', location: 'Backbone', result: ok(new Date().toISOString()) });

  // Kitchen: one historical day (2026-06-01, Europe/Amsterdam / CEST = UTC+2),
  // hour 0 healthy, hour 23 fully down.
  insertSample(db, { deviceId: 'pi-1', location: 'Kitchen', result: ok('2026-05-31T22:05:00.000Z') });
  insertSample(db, { deviceId: 'pi-1', location: 'Kitchen', result: ok('2026-05-31T22:50:00.000Z') });
  insertSample(db, { deviceId: 'pi-1', location: 'Kitchen', result: timeout('2026-06-01T21:10:00.000Z') });
  insertSample(db, { deviceId: 'pi-1', location: 'Kitchen', result: timeout('2026-06-01T21:20:00.000Z') });
  insertWifiSample(db, {
    deviceId: 'pi-1',
    location: 'Kitchen',
    sample: { at: '2026-05-31T22:05:00.000Z', connected: true, bssid: 'aa:bb:cc:dd:ee:ff', ssid: 'Home', signalDbm: -50, freqMhz: 5180, reason: null },
  });

  return db;
}

test('getRoomsList marks the backbone location and gives it a live status', async () => {
  const db = await seededDb();
  const rooms = getRoomsList(db, { backboneDeviceId: 'backbone-1', backboneLocation: 'Backbone', windowMs: 900_000, intervalMs: 5000 });

  const backbone = rooms.find((r) => r.location === 'Backbone');
  const kitchen = rooms.find((r) => r.location === 'Kitchen');

  assert.equal(backbone?.isBackbone, true);
  assert.equal(backbone?.status, 'ok');
  assert.equal(backbone?.latestBssid, null, 'backbone has no survey wifi samples');
  assert.equal(backbone?.band, null);

  assert.equal(kitchen?.isBackbone, false);
  // Kitchen's latest (only) day has 2 ok + 2 timeout = 50% loss -> degraded.
  assert.equal(kitchen?.status, 'degraded');
  assert.equal(kitchen?.latestDate, '2026-06-01');
  assert.equal(kitchen?.latestBssid, 'aa:bb:cc:dd:ee:ff');
  assert.equal(kitchen?.latestSsid, 'Home');
  assert.equal(kitchen?.band, '5 GHz');
  assert.equal(kitchen?.signalDbm, -50);
  assert.equal(kitchen?.seenAps.length, 1);
  assert.equal(kitchen?.seenAps[0]?.bssid, 'aa:bb:cc:dd:ee:ff');
  assert.equal(kitchen?.seenAps[0]?.band, '5 GHz');
  assert.deepEqual(backbone?.seenAps, [], 'backbone has no survey wifi samples');
});

test('getHoursForDay buckets correctly and leaves untouched hours unknown', async () => {
  const db = await seededDb();
  const doc = getHoursForDay(db, 'Kitchen', '2026-06-01');

  assert.equal(doc.hours.length, 24);
  assert.equal(doc.hours[0]?.status, 'ok');
  assert.equal(doc.hours[23]?.status, 'down');
  assert.equal(doc.hours[12]?.status, 'unknown');
});

test('getDaysForLocation lists every day that has data', async () => {
  const db = await seededDb();
  assert.deepEqual(getDaysForLocation(db, 'Kitchen').dates, ['2026-06-01']);
  assert.deepEqual(getDaysForLocation(db, 'Nowhere').dates, []);
});

test('getDayDetail returns the full timeline, wifi context, and a day-level summary', async () => {
  const db = await seededDb();
  const detail = getDayDetail(db, 'Kitchen', '2026-06-01');

  assert.equal(detail.samples.length, 4);
  assert.equal(detail.wifiSamples.length, 1);
  assert.equal(detail.wifiSamples[0]?.bssid, 'aa:bb:cc:dd:ee:ff');
  assert.equal(detail.summary.status, 'degraded');
  assert.equal(detail.summary.counts.ok, 2);
  assert.equal(detail.summary.counts.timeout, 2);
});
