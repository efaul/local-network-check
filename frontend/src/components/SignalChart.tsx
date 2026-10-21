import type { WifiSampleDto } from '../types';
import { bandOf } from '../band';
import { signalQuality } from '../signal';
import { timeOf } from '../format';
import {
  CHART_HEIGHT,
  CHART_WIDTH,
  GAP_BREAK_INTERVALS,
  SIGNAL_CEILING_DBM,
  SIGNAL_FLOOR_DBM,
  bandSwitches,
  bucketReadings,
  buildSignalPath,
  chooseBucketMs,
  labelledSwitches,
  medianGapMs,
  segmentBy,
  withGaps,
  xForTime,
  yForDbm,
} from '../signalLayout';

/** Minimum horizontal distance between two band labels before one is dropped. */
const MIN_LABEL_SPACING = 70;

const DISCONNECTED = 'disconnected';

function signalAxisTicks(): Array<{ dbm: number; percent: number }> {
  const steps = 4;
  const stepDbm = (SIGNAL_CEILING_DBM - SIGNAL_FLOOR_DBM) / steps;
  return Array.from({ length: steps + 1 }, (_, i) => {
    const dbm = SIGNAL_CEILING_DBM - i * stepDbm;
    return { dbm, percent: (i / steps) * 100 };
  });
}

interface PlotPoint {
  readonly atMs: number;
  readonly dbm: number | null;
  readonly minDbm: number;
  readonly maxDbm: number;
  readonly sampleCount: number;
  readonly band: string;
}

export function SignalChart({ wifiSamples }: { wifiSamples: readonly WifiSampleDto[] }) {
  if (wifiSamples.length === 0) {
    return <p className="muted">No Wi-Fi samples recorded for this day.</p>;
  }

  const ordered = [...wifiSamples].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const allTimes = ordered.map((s) => Date.parse(s.at));
  const firstMs = allTimes[0] as number;
  const lastMs = allTimes[allTimes.length - 1] as number;
  const bucketMs = chooseBucketMs(lastMs - firstMs, medianGapMs(allTimes));

  // Tag every sample with the band it was on (or "disconnected"), then split
  // into runs of one band. Bucketing happens inside a run so a smoothed
  // value is never the median of two different radios.
  const tagged = ordered.map((sample) => {
    const usable =
      sample.connected && sample.signalDbm !== null && Number.isFinite(sample.signalDbm) && sample.bssid !== null;
    const band = usable ? (bandOf(sample.freqMhz) ?? 'unknown band') : DISCONNECTED;
    return { atMs: Date.parse(sample.at), dbm: usable ? (sample.signalDbm as number) : null, band, sample };
  });

  const runs = segmentBy(tagged, (item) => item.band);

  const plotPoints: PlotPoint[] = [];
  for (const run of runs) {
    if (run.key === DISCONNECTED) {
      // One sentinel per disconnected run is enough to break the line; the
      // individual readings are still marked on the floor below.
      const first = run.items[0];
      if (first !== undefined) {
        plotPoints.push({ atMs: first.atMs, dbm: null, minDbm: 0, maxDbm: 0, sampleCount: run.items.length, band: DISCONNECTED });
      }
      continue;
    }
    const buckets = bucketReadings(
      run.items.map((item) => ({ atMs: item.atMs, dbm: item.dbm as number })),
      bucketMs,
    );
    for (const bucket of buckets) plotPoints.push({ ...bucket, band: run.key });
  }

  const withGapInfo = withGaps(plotPoints);
  const typicalGapMs = medianGapMs(allTimes);
  const gapThresholdMs = typicalGapMs === null ? null : Math.max(typicalGapMs, bucketMs) * GAP_BREAK_INTERVALS;

  const path = buildSignalPath(
    withGapInfo.map((p) => ({
      x: xForTime(p.atMs, firstMs, lastMs),
      y: p.dbm === null ? CHART_HEIGHT : yForDbm(p.dbm),
      disconnected: p.dbm === null,
      gapMs: p.gapMs,
    })),
    gapThresholdMs,
  );

  // Band-change annotations. Disconnected runs are not a band, so they are
  // excluded - a drop and reconnect on the same band is not a band switch.
  const bandRuns = runs.filter((run) => run.key !== DISCONNECTED);
  const marks = bandSwitches(bandRuns).map((mark) => ({
    ...mark,
    x: xForTime(mark.atMs, firstMs, lastMs),
  }));
  const showLabel = labelledSwitches(marks, MIN_LABEL_SPACING);

  const disconnectedTimes = tagged.filter((t) => t.band === DISCONNECTED).map((t) => t.atMs);
  const ticks = signalAxisTicks();

  return (
    <>
      <div className="signal-chart">
        <div className="signal-axis">
          {ticks.map((tick) => (
            <span key={tick.dbm} className="signal-tick" style={{ top: `${tick.percent}%` }}>
              {tick.dbm} dBm
            </span>
          ))}
        </div>
        <div className="signal-plot">
          <div className="signal-gridlines">
            {ticks.map((tick) => (
              <div key={tick.dbm} className="signal-gridline" style={{ top: `${tick.percent}%` }} />
            ))}
          </div>

          {/* Band switches, as HTML rather than SVG: the plot is stretched
              non-uniformly, which would distort any text drawn inside it. */}
          <div className="band-marks">
            {marks.map((mark, i) => (
              <div
                key={`${mark.atMs}-${i}`}
                className="band-mark"
                style={{ left: `${(mark.x / CHART_WIDTH) * 100}%` }}
                title={`${timeOf(new Date(mark.atMs).toISOString())} — ${mark.fromBand} → ${mark.toBand}`}
              >
                {showLabel[i] === true ? <span className="band-mark-label">{mark.toBand}</span> : null}
              </div>
            ))}
          </div>

          <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} preserveAspectRatio="none" className="signal-line">
            <path className="signal-path" d={path} />
            {withGapInfo.map((p, i) =>
              p.dbm === null ? null : (
                <circle
                  key={`${p.atMs}-${i}`}
                  cx={xForTime(p.atMs, firstMs, lastMs).toFixed(2)}
                  cy={yForDbm(p.dbm).toFixed(2)}
                  r="1.2"
                  className="signal-point"
                  data-quality={signalQuality(p.dbm)}
                >
                  <title>
                    {`${timeOf(new Date(p.atMs).toISOString())} — ${p.dbm.toFixed(0)} dBm`}
                    {p.sampleCount > 1 ? ` median of ${p.sampleCount} reads (${p.minDbm}..${p.maxDbm})` : ''}
                    {` · ${p.band}`}
                  </title>
                </circle>
              ),
            )}
            {disconnectedTimes.map((atMs, i) => (
              <circle
                key={`down-${atMs}-${i}`}
                cx={xForTime(atMs, firstMs, lastMs).toFixed(2)}
                cy={CHART_HEIGHT}
                r="1.4"
                className="signal-point"
                data-quality="none"
              >
                <title>{`${timeOf(new Date(atMs).toISOString())} — not connected`}</title>
              </circle>
            ))}
          </svg>
        </div>
      </div>
      <p className="legend">
        <span className="key key-good" /> good (≥ −60 dBm) <span className="key key-fair" /> fair{' '}
        <span className="key key-poor" /> poor <span className="key key-none" /> disconnected
        <span className="legend-sep">│</span>
        <span className="band-mark-key" /> band switch
      </p>
    </>
  );
}
