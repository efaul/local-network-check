/**
 * SQLite persistence. One `samples` table holds both the backbone node's own
 * continuous stream and every survey probe's readings — they are the same
 * shape, distinguished only by `device_id` and `location`. A `wifi_samples`
 * table holds the parallel Wi-Fi context readings from survey probes.
 *
 * Duplicate-safe by construction: `(device_id, at)` is unique, so a retried
 * ingest POST after a network blip silently no-ops on the rows it already
 * delivered instead of double-counting them.
 */

import { DatabaseSync } from 'node:sqlite';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ProbeState, Result } from '../shared/result.ts';
import type { WifiSampleDto } from '../shared/contract.js';

export interface Db {
  readonly raw: DatabaseSync;
  close(): void;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL,
  location TEXT NOT NULL,
  at TEXT NOT NULL,
  state TEXT NOT NULL,
  rtt_ms REAL,
  reason TEXT,
  received_at TEXT NOT NULL,
  UNIQUE(device_id, at)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_samples_location_at ON samples(location, at);
CREATE INDEX IF NOT EXISTS idx_samples_device_at ON samples(device_id, at);

CREATE TABLE IF NOT EXISTS wifi_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL,
  location TEXT NOT NULL,
  at TEXT NOT NULL,
  connected INTEGER NOT NULL,
  bssid TEXT,
  ssid TEXT,
  signal_dbm REAL,
  freq_mhz REAL,
  reason TEXT,
  received_at TEXT NOT NULL,
  UNIQUE(device_id, at)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_wifi_location_at ON wifi_samples(location, at);
`;

export async function openDb(path: string): Promise<Db> {
  if (path !== ':memory:') {
    await mkdir(dirname(path), { recursive: true });
  }
  const raw = new DatabaseSync(path);
  raw.exec('PRAGMA journal_mode = WAL;');
  raw.exec('PRAGMA foreign_keys = ON;');
  raw.exec(SCHEMA);
  return {
    raw,
    close: () => raw.close(),
  };
}

interface SampleRow {
  at: string;
  state: string;
  rtt_ms: number | null;
  reason: string | null;
}

const rowToResult = (row: SampleRow): Result => ({
  at: row.at,
  state: row.state as ProbeState,
  rttMs: row.rtt_ms,
  reason: row.reason,
});

export function insertSample(
  db: Db,
  { deviceId, location, result, receivedAt = new Date().toISOString() }:
  { deviceId: string; location: string; result: Result; receivedAt?: string },
): boolean {
  const stmt = db.raw.prepare(
    `INSERT OR IGNORE INTO samples (device_id, location, at, state, rtt_ms, reason, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const info = stmt.run(deviceId, location, result.at, result.state, result.rttMs, result.reason, receivedAt);
  return info.changes > 0;
}

interface WifiRow {
  at: string;
  connected: number;
  bssid: string | null;
  ssid: string | null;
  signal_dbm: number | null;
  freq_mhz: number | null;
  reason: string | null;
}

const rowToWifiSample = (row: WifiRow): WifiSampleDto => ({
  at: row.at,
  connected: row.connected === 1,
  bssid: row.bssid,
  ssid: row.ssid,
  signalDbm: row.signal_dbm,
  freqMhz: row.freq_mhz,
  reason: row.reason,
});

export function insertWifiSample(
  db: Db,
  { deviceId, location, sample, receivedAt = new Date().toISOString() }:
  { deviceId: string; location: string; sample: WifiSampleDto; receivedAt?: string },
): boolean {
  const stmt = db.raw.prepare(
    `INSERT OR IGNORE INTO wifi_samples
       (device_id, location, at, connected, bssid, ssid, signal_dbm, freq_mhz, reason, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const info = stmt.run(
    deviceId,
    location,
    sample.at,
    sample.connected ? 1 : 0,
    sample.bssid,
    sample.ssid,
    sample.signalDbm,
    sample.freqMhz,
    sample.reason,
    receivedAt,
  );
  return info.changes > 0;
}

export function recentSamplesForDevice(db: Db, deviceId: string, sinceIso: string): Result[] {
  const stmt = db.raw.prepare(
    'SELECT at, state, rtt_ms, reason FROM samples WHERE device_id = ? AND at >= ? ORDER BY at ASC',
  );
  return (stmt.all(deviceId, sinceIso) as unknown as SampleRow[]).map(rowToResult);
}

export function lastSampleForDevice(db: Db, deviceId: string): Result | null {
  const stmt = db.raw.prepare(
    'SELECT at, state, rtt_ms, reason FROM samples WHERE device_id = ? ORDER BY at DESC LIMIT 1',
  );
  const row = stmt.get(deviceId) as unknown as SampleRow | undefined;
  return row ? rowToResult(row) : null;
}

export function distinctLocations(db: Db): string[] {
  const stmt = db.raw.prepare('SELECT DISTINCT location FROM samples ORDER BY location ASC');
  return (stmt.all() as unknown as Array<{ location: string }>).map((row) => row.location);
}

export function datesForLocation(db: Db, location: string): string[] {
  const stmt = db.raw.prepare(
    `SELECT DISTINCT substr(at, 1, 10) AS day FROM samples WHERE location = ? ORDER BY day DESC`,
  );
  return (stmt.all(location) as unknown as Array<{ day: string }>).map((row) => row.day);
}

export function latestDateForLocation(db: Db, location: string): string | null {
  return datesForLocation(db, location)[0] ?? null;
}

export function lastSampleForLocation(db: Db, location: string): Result | null {
  const stmt = db.raw.prepare(
    'SELECT at, state, rtt_ms, reason FROM samples WHERE location = ? ORDER BY at DESC LIMIT 1',
  );
  const row = stmt.get(location) as unknown as SampleRow | undefined;
  return row ? rowToResult(row) : null;
}

/** [startIso, endIso) covering one UTC calendar day. */
function dayRange(date: string): [string, string] {
  const start = new Date(`${date}T00:00:00.000Z`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return [start.toISOString(), end.toISOString()];
}

export function samplesForLocationAndDate(db: Db, location: string, date: string): Result[] {
  const [start, end] = dayRange(date);
  const stmt = db.raw.prepare(
    'SELECT at, state, rtt_ms, reason FROM samples WHERE location = ? AND at >= ? AND at < ? ORDER BY at ASC',
  );
  return (stmt.all(location, start, end) as unknown as SampleRow[]).map(rowToResult);
}

export function wifiSamplesForLocationAndDate(db: Db, location: string, date: string): WifiSampleDto[] {
  const [start, end] = dayRange(date);
  const stmt = db.raw.prepare(
    `SELECT at, connected, bssid, ssid, signal_dbm, freq_mhz, reason
       FROM wifi_samples WHERE location = ? AND at >= ? AND at < ? ORDER BY at ASC`,
  );
  return (stmt.all(location, start, end) as unknown as WifiRow[]).map(rowToWifiSample);
}
