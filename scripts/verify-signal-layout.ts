/**
 * Dev helper: replays the signal-chart layout over a real SQLite database and
 * reports smoothing, band switches and line breaks per room-day.
 *
 * Usage: node scripts/verify-signal-layout.ts [path-to-sqlite]
 */
import { DatabaseSync } from 'node:sqlite';
import {
  bandSwitches, bucketReadings, buildSignalPath, chooseBucketMs, labelledSwitches,
  medianGapMs, segmentBy, withGaps, xForTime, yForDbm, CHART_HEIGHT, GAP_BREAK_INTERVALS,
} from '../frontend/src/signalLayout.ts';
import { bandOf } from '../frontend/src/band.ts';

const dbPath = process.argv[2] ?? 'real_data/central.sqlite';
const db = new DatabaseSync(dbPath, { readOnly: true });

const roomDays = db.prepare(
  `SELECT location, substr(at,1,10) d, COUNT(*) n FROM wifi_samples GROUP BY location, d ORDER BY n DESC`,
).all() as Array<{ location: string; d: string; n: number }>;

console.log(dbPath);
console.log('room-day'.padEnd(24), 'raw'.padStart(5), 'plotted'.padStart(8), 'bucket'.padStart(8), 'switches'.padStart(9), 'labels'.padStart(7), 'segments'.padStart(9));
console.log('-'.repeat(76));

for (const rd of roomDays) {
  const rows = db.prepare(
    `SELECT at, connected, bssid, signal_dbm, freq_mhz FROM wifi_samples
     WHERE location=? AND substr(at,1,10)=? ORDER BY at ASC`,
  ).all(rd.location, rd.d) as Array<{ at: string; connected: number; bssid: string | null; signal_dbm: number | null; freq_mhz: number | null }>;
  if (rows.length < 2) continue;

  const times = rows.map((r) => Date.parse(r.at));
  const firstMs = times[0] as number;
  const lastMs = times[times.length - 1] as number;
  const bucketMs = chooseBucketMs(lastMs - firstMs, medianGapMs(times));

  const tagged = rows.map((r) => {
    const usable = r.connected === 1 && r.signal_dbm !== null && r.bssid !== null;
    return { atMs: Date.parse(r.at), dbm: usable ? (r.signal_dbm as number) : null, band: usable ? (bandOf(r.freq_mhz) ?? 'unknown') : 'disconnected' };
  });

  const runs = segmentBy(tagged, (t) => t.band);
  const plot: Array<{ atMs: number; dbm: number | null }> = [];
  for (const run of runs) {
    if (run.key === 'disconnected') { const f = run.items[0]; if (f) plot.push({ atMs: f.atMs, dbm: null }); continue; }
    for (const b of bucketReadings(run.items.map((i) => ({ atMs: i.atMs, dbm: i.dbm as number })), bucketMs)) plot.push(b);
  }

  const gapped = withGaps(plot);
  const typical = medianGapMs(times);
  const threshold = typical === null ? null : Math.max(typical, bucketMs) * GAP_BREAK_INTERVALS;
  const d = buildSignalPath(
    gapped.map((p) => ({ x: xForTime(p.atMs, firstMs, lastMs), y: p.dbm === null ? CHART_HEIGHT : yForDbm(p.dbm), disconnected: p.dbm === null, gapMs: p.gapMs })),
    threshold,
  );

  const bandRuns = runs.filter((r) => r.key !== 'disconnected');
  const marks = bandSwitches(bandRuns).map((m) => ({ ...m, x: xForTime(m.atMs, firstMs, lastMs) }));
  const labels = labelledSwitches(marks, 70).filter(Boolean).length;

  console.log(
    `${rd.location}/${rd.d}`.padEnd(24),
    String(rows.length).padStart(5),
    String(plot.length).padStart(8),
    ((bucketMs / 60000).toFixed(1) + 'm').padStart(8),
    String(marks.length).padStart(9),
    String(labels).padStart(7),
    String((d.match(/M/g) ?? []).length).padStart(9),
  );
}
db.close();
