import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHART_WIDTH,
  GAP_BREAK_INTERVALS,
  bandSwitches,
  bucketReadings,
  buildSignalPath,
  chooseBucketMs,
  labelledSwitches,
  median,
  medianGapMs,
  segmentBy,
  withGaps,
  xForTime,
  yForDbm,
} from '../frontend/src/signalLayout.ts';

const at = (iso: string): number => Date.parse(iso);

test('xForTime places samples by elapsed time, not by their index', () => {
  // Two samples a minute apart, then one an hour later. By index the middle
  // sample would sit at 50% of the width; by the clock it belongs near 1.7%.
  const first = at('2026-10-20T10:00:00.000Z');
  const middle = at('2026-10-20T10:01:00.000Z');
  const last = at('2026-10-20T11:00:00.000Z');

  assert.equal(xForTime(first, first, last), 0);
  assert.equal(xForTime(last, first, last), CHART_WIDTH);

  const x = xForTime(middle, first, last);
  assert.ok(Math.abs(x - (1 / 60) * CHART_WIDTH) < 0.01, `expected ~16.7, got ${x}`);
  assert.notEqual(x, CHART_WIDTH / 2, 'index-based spacing would have put it at the midpoint');
});

test('xForTime collapses to the centre when no time elapsed', () => {
  const t = at('2026-10-20T10:00:00.000Z');
  assert.equal(xForTime(t, t, t), CHART_WIDTH / 2);
});

test('yForDbm clamps to the plotted range instead of drawing off-chart', () => {
  assert.equal(yForDbm(-30), 0);
  assert.equal(yForDbm(-90), 100);
  assert.equal(yForDbm(-60), 50);
  assert.equal(yForDbm(-10), 0, 'stronger than the ceiling is clamped, not extrapolated');
  assert.equal(yForDbm(-120), 100, 'weaker than the floor is clamped, not extrapolated');
});

test('median returns a measured middle value, not an average', () => {
  assert.equal(median([-70, -69, -68]), -69);
  assert.equal(median([-70, -68]), -69);
  assert.equal(median([]), null);
  assert.equal(median([-42]), -42);
});

test('medianGapMs reports the typical interval, not the outlier', () => {
  assert.equal(medianGapMs([0, 30_000, 60_000, 90_000, 6_249_200]), 30_000);
  assert.equal(medianGapMs([42]), null, 'a single sample has no interval');
  assert.equal(medianGapMs([]), null);
});

test('chooseBucketMs never buckets finer than the sampling interval', () => {
  // 11 hours at 30s sampling: the target width wins.
  const elevenHours = 11 * 3600_000;
  assert.ok(chooseBucketMs(elevenHours, 30_000, 150) > 30_000);

  // A short span would ask for sub-interval buckets; the interval floors it,
  // otherwise smoothing would just re-plot single readings.
  assert.equal(chooseBucketMs(30 * 60_000, 30_000, 150), 30_000);

  assert.equal(chooseBucketMs(0, null), 1, 'degenerate spans still produce a usable width');
});

test('segmentBy splits into consecutive runs, not groups', () => {
  const items = [
    { band: '5 GHz' },
    { band: '5 GHz' },
    { band: '2.4 GHz' },
    { band: '5 GHz' },
  ];
  const runs = segmentBy(items, (i) => i.band);

  assert.deepEqual(runs.map((r) => r.key), ['5 GHz', '2.4 GHz', '5 GHz']);
  assert.equal(runs[0]?.items.length, 2);
  assert.equal(runs[2]?.items.length, 1, 'returning to a band starts a new run');
});

test('bucketReadings reports the median of each window, never an invented value', () => {
  const readings = [
    { atMs: 0, dbm: -70 },
    { atMs: 10_000, dbm: -68 },
    { atMs: 20_000, dbm: -69 },
    // next bucket
    { atMs: 60_000, dbm: -50 },
    { atMs: 70_000, dbm: -52 },
  ];

  const buckets = bucketReadings(readings, 60_000);

  assert.equal(buckets.length, 2);
  assert.equal(buckets[0]?.dbm, -69, 'median of -70,-68,-69');
  assert.equal(buckets[0]?.sampleCount, 3);
  assert.equal(buckets[0]?.minDbm, -70);
  assert.equal(buckets[0]?.maxDbm, -68);
  assert.equal(buckets[1]?.dbm, -51);
  assert.equal(buckets[1]?.sampleCount, 2);
});

test('bucketReadings keeps a short run visible rather than dropping it', () => {
  // The real 11-sample, 5-minute roam onto a nearby AP must not vanish just
  // because the bucket width is larger than the run.
  const readings = Array.from({ length: 11 }, (_, i) => ({ atMs: i * 30_000, dbm: -40 }));
  const buckets = bucketReadings(readings, 4.4 * 60_000);

  assert.ok(buckets.length >= 1, 'a run shorter than one bucket still produces a point');
  assert.equal(buckets[0]?.dbm, -40);
  assert.equal(buckets.reduce((n, b) => n + b.sampleCount, 0), 11, 'every reading is accounted for');
});

test('bucketReadings handles an empty input', () => {
  assert.deepEqual(bucketReadings([], 1000), []);
});

test('withGaps measures the interval back to the previous point', () => {
  const gapped = withGaps([{ atMs: 0 }, { atMs: 30_000 }, { atMs: 6_279_200 }]);

  assert.equal(gapped[0]?.gapMs, null);
  assert.equal(gapped[1]?.gapMs, 30_000);
  assert.equal(gapped[2]?.gapMs, 6_249_200);
});

test('buildSignalPath breaks the line across a reporting gap', () => {
  const points = [
    { x: 0, y: 50, disconnected: false, gapMs: null },
    { x: 10, y: 50, disconnected: false, gapMs: 30_000 },
    { x: 900, y: 40, disconnected: false, gapMs: 6_249_200 },
    { x: 910, y: 40, disconnected: false, gapMs: 30_000 },
  ];

  const d = buildSignalPath(points, 30_000 * GAP_BREAK_INTERVALS);

  assert.equal(d, 'M0.00,50.00 L10.00,50.00 M900.00,40.00 L910.00,40.00');
  assert.equal((d.match(/M/g) ?? []).length, 2, 'the gap starts a new subpath rather than joining');
});

test('buildSignalPath breaks on a disconnected period', () => {
  const points = [
    { x: 0, y: 50, disconnected: false, gapMs: null },
    { x: 10, y: 100, disconnected: true, gapMs: 30_000 },
    { x: 20, y: 60, disconnected: false, gapMs: 30_000 },
  ];

  const d = buildSignalPath(points, 90_000);

  assert.equal(d, 'M0.00,50.00 M20.00,60.00');
  assert.ok(!d.includes('L'), 'a disconnected period must not be joined through');
});

test('buildSignalPath keeps one continuous line across a band change', () => {
  // A band switch is annotated, not broken - the trace stays single.
  const points = [
    { x: 0, y: 70, disconnected: false, gapMs: null },
    { x: 500, y: 20, disconnected: false, gapMs: 30_000 },
    { x: 1000, y: 70, disconnected: false, gapMs: 30_000 },
  ];

  const d = buildSignalPath(points, 90_000);

  assert.equal(d, 'M0.00,70.00 L500.00,20.00 L1000.00,70.00');
  assert.equal((d.match(/M/g) ?? []).length, 1);
});

test('buildSignalPath joins everything when no typical interval could be measured', () => {
  const points = [
    { x: 0, y: 50, disconnected: false, gapMs: null },
    { x: 1000, y: 50, disconnected: false, gapMs: 9_999_999 },
  ];
  assert.equal(buildSignalPath(points, null), 'M0.00,50.00 L1000.00,50.00');
});

test('bandSwitches reports each boundary with the band on either side', () => {
  const runs = [
    { key: '5 GHz', items: [{ atMs: 0 }, { atMs: 30_000 }] },
    { key: '2.4 GHz', items: [{ atMs: 60_000 }] },
    { key: '5 GHz', items: [{ atMs: 90_000 }] },
  ];

  const switches = bandSwitches(runs);

  assert.equal(switches.length, 2);
  assert.deepEqual(switches[0], { atMs: 60_000, fromBand: '5 GHz', toBand: '2.4 GHz' });
  assert.deepEqual(switches[1], { atMs: 90_000, fromBand: '2.4 GHz', toBand: '5 GHz' });
});

test('bandSwitches reports nothing when the band never changes', () => {
  assert.deepEqual(bandSwitches([{ key: '5 GHz', items: [{ atMs: 0 }] }]), []);
  assert.deepEqual(bandSwitches([]), []);
});

test('labelledSwitches drops labels that would overlap but keeps every marker', () => {
  // Mirrors the real 11:10-11:21 burst: five switches inside ~11px.
  const marks = [{ x: 207 }, { x: 268 }, { x: 269 }, { x: 271 }, { x: 274 }, { x: 279 }, { x: 341 }];

  const shown = labelledSwitches(marks, 70);

  // 207 labels; 268-274 all sit within 70px of it; 279 is 72px clear so it
  // labels; 341 is only 62px past 279.
  assert.deepEqual(shown, [true, false, false, false, false, true, false]);
  assert.equal(shown.length, marks.length, 'every marker is still accounted for');
  assert.equal(shown[0], true, 'the first switch is always labelled');
});

test('labelledSwitches labels everything when switches are well separated', () => {
  const shown = labelledSwitches([{ x: 0 }, { x: 200 }, { x: 400 }], 70);
  assert.deepEqual(shown, [true, true, true]);
});
