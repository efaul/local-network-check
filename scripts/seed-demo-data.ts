/**
 * One-off dev helper: seeds the real SQLite database (not the in-memory test
 * DB) with a few rooms of plausible ping + Wi-Fi history, so the dashboard
 * has something to show during manual testing.
 *
 * Does NOT touch the "Backbone" location — that's left to the real
 * continuous backbone runner (`npm run server`) so this script never
 * fights with live data.
 *
 * Usage: node scripts/seed-demo-data.ts [path-to-sqlite]
 * Defaults to ./data/central.sqlite (the server's configured db path).
 */

import { resolve } from 'node:path';
import { openDb, insertSample, insertWifiSample } from '../src/server/db.ts';
import type { Result } from '../src/shared/result.ts';
import type { WifiSampleDto } from '../src/shared/contract.js';

const dbPath = resolve(process.argv[2] ?? 'data/central.sqlite');

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const now = Date.now();

const iso = (msAgo: number): string => new Date(now - msAgo).toISOString();

interface RoomPlan {
  location: string;
  deviceId: string;
  /** Ping samples, oldest first, each as ms-ago plus an explicit state. */
  pings: Array<{ msAgo: number; state: 'ok' | 'timeout' | 'error'; rttMs?: number }>;
  /** Wi-Fi context samples, oldest first. */
  wifi: Array<{
    msAgo: number;
    connected: boolean;
    bssid?: string;
    ssid?: string;
    signalDbm?: number;
    freqMhz?: number;
    reason?: string;
  }>;
}

function hourlyPings(
  hours: number,
  perHour: number,
  pattern: (hour: number) => 'ok' | 'timeout' | 'error',
): RoomPlan['pings'] {
  const pings: RoomPlan['pings'] = [];
  for (let h = 0; h < hours; h += 1) {
    const state = pattern(h);
    for (let i = 0; i < perHour; i += 1) {
      const msAgo = h * HOUR + i * (HOUR / perHour);
      pings.push(state === 'ok' ? { msAgo, state, rttMs: 8 + Math.round(Math.random() * 12) } : { msAgo, state });
    }
  }
  return pings;
}

const KITCHEN_BSSID = 'aa:bb:cc:dd:ee:01';
const OFFICE_BSSID = 'aa:bb:cc:dd:ee:02';
const BEDROOM_BSSID = 'aa:bb:cc:dd:ee:03';
const SSID = 'HomeMesh';

const rooms: RoomPlan[] = [
  {
    // Mostly healthy all day, one bad hour in the evening (3h ago).
    location: 'Kitchen',
    deviceId: 'survey-pi-kitchen',
    pings: hourlyPings(24, 4, (h) => (h === 3 ? 'timeout' : 'ok')),
    wifi: [
      { msAgo: 23 * HOUR, connected: true, bssid: KITCHEN_BSSID, ssid: SSID, signalDbm: -58, freqMhz: 5180 },
      { msAgo: 12 * HOUR, connected: true, bssid: KITCHEN_BSSID, ssid: SSID, signalDbm: -62, freqMhz: 5180 },
      { msAgo: 3 * HOUR, connected: true, bssid: KITCHEN_BSSID, ssid: SSID, signalDbm: -65, freqMhz: 5180 },
      { msAgo: 10 * MINUTE, connected: true, bssid: KITCHEN_BSSID, ssid: SSID, signalDbm: -59, freqMhz: 5180 },
    ],
  },
  {
    // Strong all day, on the 6 GHz radio.
    location: 'Office',
    deviceId: 'survey-pi-office',
    pings: hourlyPings(24, 4, () => 'ok'),
    wifi: [
      { msAgo: 23 * HOUR, connected: true, bssid: OFFICE_BSSID, ssid: `${SSID}-6E`, signalDbm: -42, freqMhz: 6115 },
      { msAgo: 12 * HOUR, connected: true, bssid: OFFICE_BSSID, ssid: `${SSID}-6E`, signalDbm: -45, freqMhz: 6115 },
      { msAgo: 10 * MINUTE, connected: true, bssid: OFFICE_BSSID, ssid: `${SSID}-6E`, signalDbm: -44, freqMhz: 6115 },
    ],
  },
  {
    // Degraded for several hours overnight, weak 2.4 GHz signal, and a
    // trailing disconnect blip - exercises lastConnectedWifiSampleForLocation
    // ignoring it and still showing the real last AP association.
    location: 'Bedroom',
    deviceId: 'survey-pi-bedroom',
    pings: hourlyPings(24, 4, (h) => (h >= 6 && h <= 9 ? 'timeout' : 'ok')),
    wifi: [
      { msAgo: 23 * HOUR, connected: true, bssid: BEDROOM_BSSID, ssid: SSID, signalDbm: -74, freqMhz: 2437 },
      { msAgo: 8 * HOUR, connected: true, bssid: BEDROOM_BSSID, ssid: SSID, signalDbm: -79, freqMhz: 2437 },
      { msAgo: 15 * MINUTE, connected: true, bssid: BEDROOM_BSSID, ssid: SSID, signalDbm: -76, freqMhz: 2437 },
      { msAgo: 2 * MINUTE, connected: false, reason: 'roaming' },
    ],
  },
  {
    // Ping-only: no Wi-Fi collector on this one (e.g. a wired laptop dropped
    // off there for a day). Exercises the "No Wi-Fi data" fallback.
    location: 'Garage',
    deviceId: 'survey-pi-garage',
    pings: hourlyPings(24, 2, (h) => (h === 14 ? 'error' : 'ok')),
    wifi: [],
  },
];

async function main(): Promise<void> {
  const db = await openDb(dbPath);
  let samplesInserted = 0;
  let wifiInserted = 0;

  for (const room of rooms) {
    for (const ping of room.pings) {
      const result: Result = {
        at: iso(ping.msAgo),
        state: ping.state,
        rttMs: ping.state === 'ok' ? (ping.rttMs ?? null) : null,
        reason: ping.state === 'ok' ? null : ping.state === 'timeout' ? 'no-reply' : 'probe-error',
      };
      if (insertSample(db, { deviceId: room.deviceId, location: room.location, result })) samplesInserted += 1;
    }

    for (const w of room.wifi) {
      const sample: WifiSampleDto = {
        at: iso(w.msAgo),
        connected: w.connected,
        bssid: w.bssid ?? null,
        ssid: w.ssid ?? null,
        signalDbm: w.signalDbm ?? null,
        freqMhz: w.freqMhz ?? null,
        reason: w.reason ?? null,
      };
      if (insertWifiSample(db, { deviceId: room.deviceId, location: room.location, sample })) wifiInserted += 1;
    }
  }

  db.close();
  console.log(`Seeded ${dbPath}`);
  console.log(`  rooms: ${rooms.map((r) => r.location).join(', ')}`);
  console.log(`  ${samplesInserted} ping samples, ${wifiInserted} wifi samples inserted (duplicates no-op).`);
}

main().catch((err: unknown) => {
  console.error('Seed failed:', err);
  process.exitCode = 1;
});
