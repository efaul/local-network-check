import type { WifiSampleDto } from '../types';
import { bandOf } from '../band';
import { signalQuality } from '../signal';
import { timeOf } from '../format';

// -60 dBm or stronger is a solid connection, -75 dBm is usable but marginal,
// anything weaker is poor — common Wi-Fi signal quality conventions.
const SIGNAL_FLOOR_DBM = -90;
const SIGNAL_CEILING_DBM = -30;
const CHART_WIDTH = 1000;
const CHART_HEIGHT = 100;

function signalAxisTicks(): Array<{ dbm: number; percent: number }> {
  const steps = 4;
  const stepDbm = (SIGNAL_CEILING_DBM - SIGNAL_FLOOR_DBM) / steps;
  return Array.from({ length: steps + 1 }, (_, i) => {
    const dbm = SIGNAL_CEILING_DBM - i * stepDbm;
    return { dbm, percent: (i / steps) * 100 };
  });
}

interface Point {
  readonly x: number;
  readonly y: number;
  readonly quality: 'good' | 'fair' | 'poor' | 'none';
  readonly sample: WifiSampleDto;
}

export function SignalChart({ wifiSamples }: { wifiSamples: readonly WifiSampleDto[] }) {
  if (wifiSamples.length === 0) {
    return <p className="muted">No Wi-Fi samples recorded for this day.</p>;
  }

  const ordered = [...wifiSamples].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  const points: Point[] = ordered.map((sample, i) => {
    const x = ordered.length === 1 ? CHART_WIDTH / 2 : (i / (ordered.length - 1)) * CHART_WIDTH;
    if (!sample.connected || sample.signalDbm === null || !Number.isFinite(sample.signalDbm)) {
      return { x, y: CHART_HEIGHT, quality: 'none', sample };
    }
    const clamped = Math.min(SIGNAL_CEILING_DBM, Math.max(SIGNAL_FLOOR_DBM, sample.signalDbm));
    const fraction = (clamped - SIGNAL_FLOOR_DBM) / (SIGNAL_CEILING_DBM - SIGNAL_FLOOR_DBM);
    return { x, y: CHART_HEIGHT - fraction * CHART_HEIGHT, quality: signalQuality(sample.signalDbm), sample };
  });

  // Line connects consecutive connected readings; a disconnected sample
  // breaks the line rather than dragging it down to the floor.
  let d = '';
  let drawing = false;
  for (const p of points) {
    if (p.quality === 'none') {
      drawing = false;
      continue;
    }
    d += `${drawing ? 'L' : 'M'}${p.x.toFixed(2)},${p.y.toFixed(2)} `;
    drawing = true;
  }

  const ticks = signalAxisTicks();

  return (
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
        <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} preserveAspectRatio="none" className="signal-line">
          <path className="signal-path" d={d.trim()} />
          {points.map((p, i) => {
            const when = timeOf(p.sample.at);
            let title: string;
            if (p.quality === 'none') {
              const reason = p.sample.reason !== null ? `: ${p.sample.reason}` : '';
              title = `${when} — not connected${reason}`;
            } else {
              const band = bandOf(p.sample.freqMhz);
              const label = [p.sample.ssid ?? p.sample.bssid, band !== null ? `· ${band}` : null]
                .filter((part) => part !== null)
                .join(' ');
              title = `${when} — ${(p.sample.signalDbm as number).toFixed(0)} dBm${label ? ` · ${label}` : ''}`;
            }
            return (
              <circle
                key={`${p.sample.at}-${i}`}
                cx={p.x.toFixed(2)}
                cy={p.y.toFixed(2)}
                r="1.6"
                className="signal-point"
                data-quality={p.quality}
              >
                <title>{title}</title>
              </circle>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
