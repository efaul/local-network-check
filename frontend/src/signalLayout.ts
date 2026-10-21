/**
 * Pure geometry and aggregation for the Wi-Fi signal chart, kept out of the
 * component so the parts that are easy to get wrong - and were wrong - can
 * be tested directly.
 *
 * Bugs this exists to prevent:
 *
 * 1. Positioning samples by array index rather than by time. That gives
 *    every sample an equal slice of width regardless of how much time it
 *    covers, so calm stretches smear across the chart and short bursts get
 *    stretched. On real survey data that misplaced points by ~15% of the
 *    chart width.
 *
 * 2. Smoothing across a roam. A bucket that spans a band change would take
 *    the median of two different radios and report a value neither of them
 *    ever showed. Readings are therefore segmented into runs of a single
 *    band before being bucketed.
 */

export const CHART_WIDTH = 1000;
export const CHART_HEIGHT = 100;

export const SIGNAL_FLOOR_DBM = -90;
export const SIGNAL_CEILING_DBM = -30;

/**
 * A reading separated from the previous one by more than this many times the
 * typical interval is treated as a break in observation rather than a
 * continuous line. Mirrors STALE_INTERVALS in ../../src/shared/summary.ts.
 */
export const GAP_BREAK_INTERVALS = 3;

/** Roughly how many plotted points to aim for across the whole chart width. */
export const TARGET_BUCKETS = 150;

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

/** Median interval between consecutive timestamps. Null when there is no interval to measure. */
export function medianGapMs(timestamps: readonly number[]): number | null {
  if (timestamps.length < 2) return null;
  const gaps: number[] = [];
  for (let i = 1; i < timestamps.length; i += 1) {
    gaps.push((timestamps[i] as number) - (timestamps[i - 1] as number));
  }
  return median(gaps);
}

/**
 * Horizontal position for a timestamp within a run, proportional to elapsed
 * time. A run with no elapsed time collapses to the centre rather than
 * dividing by zero.
 */
export function xForTime(atMs: number, firstMs: number, lastMs: number): number {
  const spanMs = lastMs - firstMs;
  if (spanMs <= 0) return CHART_WIDTH / 2;
  return ((atMs - firstMs) / spanMs) * CHART_WIDTH;
}

/** Vertical position for a signal reading, clamped to the plotted dBm range. */
export function yForDbm(dbm: number): number {
  const clamped = Math.min(SIGNAL_CEILING_DBM, Math.max(SIGNAL_FLOOR_DBM, dbm));
  const fraction = (clamped - SIGNAL_FLOOR_DBM) / (SIGNAL_CEILING_DBM - SIGNAL_FLOOR_DBM);
  return CHART_HEIGHT - fraction * CHART_HEIGHT;
}

/**
 * Bucket width for smoothing. Never finer than the probe's own sampling
 * interval - bucketing below that would only re-plot single readings and
 * reintroduce the jitter the smoothing exists to remove.
 */
export function chooseBucketMs(spanMs: number, typicalGapMs: number | null, targetBuckets = TARGET_BUCKETS): number {
  const byTarget = spanMs > 0 ? spanMs / targetBuckets : 0;
  return Math.max(byTarget, typicalGapMs ?? 0, 1);
}

/** Splits an ordered list into consecutive runs sharing the same key. */
export function segmentBy<T>(items: readonly T[], keyOf: (item: T) => string): Array<{ key: string; items: T[] }> {
  const runs: Array<{ key: string; items: T[] }> = [];
  for (const item of items) {
    const key = keyOf(item);
    const current = runs[runs.length - 1];
    if (current !== undefined && current.key === key) current.items.push(item);
    else runs.push({ key, items: [item] });
  }
  return runs;
}

export interface Reading {
  readonly atMs: number;
  readonly dbm: number;
}

export interface Bucket {
  /** Midpoint of the readings this bucket summarises. */
  readonly atMs: number;
  /** Median of the readings in the bucket - a real measured value, never interpolated. */
  readonly dbm: number;
  readonly minDbm: number;
  readonly maxDbm: number;
  readonly sampleCount: number;
}

/**
 * Collapses readings into fixed-width time buckets, each reported as the
 * median of its readings.
 *
 * Median rather than mean on purpose: one stray reading during a roam should
 * not drag the plotted value away from what the link actually looked like
 * for that window.
 */
export function bucketReadings(readings: readonly Reading[], bucketMs: number): Bucket[] {
  if (readings.length === 0) return [];
  const ordered = [...readings].sort((a, b) => a.atMs - b.atMs);
  const width = Math.max(bucketMs, 1);
  const origin = (ordered[0] as Reading).atMs;

  const buckets: Bucket[] = [];
  let index = 0;
  let current: Reading[] = [];

  const flush = (): void => {
    if (current.length === 0) return;
    const values = current.map((r) => r.dbm);
    const first = current[0] as Reading;
    const last = current[current.length - 1] as Reading;
    buckets.push({
      atMs: (first.atMs + last.atMs) / 2,
      dbm: median(values) as number,
      minDbm: Math.min(...values),
      maxDbm: Math.max(...values),
      sampleCount: current.length,
    });
    current = [];
  };

  for (const reading of ordered) {
    const bucketIndex = Math.floor((reading.atMs - origin) / width);
    if (current.length > 0 && bucketIndex !== index) flush();
    index = bucketIndex;
    current.push(reading);
  }
  flush();

  return buckets;
}

/** Adds the interval since the previous entry to each item of an ordered list. */
export function withGaps<T extends { atMs: number }>(points: readonly T[]): Array<T & { gapMs: number | null }> {
  return points.map((point, i) => ({
    ...point,
    gapMs: i === 0 ? null : point.atMs - (points[i - 1] as T).atMs,
  }));
}

export interface PathPoint {
  readonly x: number;
  readonly y: number;
  /** True when this entry represents a period with no signal reading. */
  readonly disconnected: boolean;
  /** Milliseconds since the previous point; null for the first. */
  readonly gapMs: number | null;
}

/**
 * SVG path for the signal line.
 *
 * The line breaks on a disconnected period and on a reporting gap, and both
 * are deliberate: drawing through either would assert continuous measurement
 * that never happened. A band change does not break the line - it is
 * annotated instead, so the jump stays visible as one trace.
 */
export function buildSignalPath(points: readonly PathPoint[], gapThresholdMs: number | null): string {
  let d = '';
  let drawing = false;

  for (const point of points) {
    if (point.disconnected) {
      drawing = false;
      continue;
    }
    const brokenByGap = gapThresholdMs !== null && point.gapMs !== null && point.gapMs > gapThresholdMs;
    if (brokenByGap) drawing = false;
    d += `${drawing ? 'L' : 'M'}${point.x.toFixed(2)},${point.y.toFixed(2)} `;
    drawing = true;
  }

  return d.trim();
}

export interface BandSwitch {
  readonly atMs: number;
  readonly fromBand: string;
  readonly toBand: string;
}

/** Boundaries where the band changed, for annotating the line. */
export function bandSwitches(runs: ReadonlyArray<{ key: string; items: ReadonlyArray<{ atMs: number }> }>): BandSwitch[] {
  const switches: BandSwitch[] = [];
  for (let i = 1; i < runs.length; i += 1) {
    const previous = runs[i - 1] as { key: string; items: ReadonlyArray<{ atMs: number }> };
    const current = runs[i] as { key: string; items: ReadonlyArray<{ atMs: number }> };
    const firstOfCurrent = current.items[0];
    if (firstOfCurrent === undefined) continue;
    switches.push({ atMs: firstOfCurrent.atMs, fromBand: previous.key, toBand: current.key });
  }
  return switches;
}

/**
 * Thins labels so they do not overlap, keeping every marker. Real data
 * roams in bursts - five band changes inside eleven minutes would otherwise
 * render as unreadable overlapping text.
 */
export function labelledSwitches<T extends { x: number }>(marks: readonly T[], minSpacing: number): boolean[] {
  let lastLabelledX = Number.NEGATIVE_INFINITY;
  return marks.map((mark) => {
    if (mark.x - lastLabelledX >= minSpacing) {
      lastLabelledX = mark.x;
      return true;
    }
    return false;
  });
}
