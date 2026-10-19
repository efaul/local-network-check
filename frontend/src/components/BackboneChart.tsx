import type { ResultDto } from '../types';
import { timeOf } from '../format';

export function BackboneChart({ recent }: { recent: readonly ResultDto[] }) {
  if (recent.length === 0) {
    return <p className="muted">No measurements yet.</p>;
  }

  const rtts = recent
    .map((r) => r.rttMs)
    .filter((v): v is number => v !== null && Number.isFinite(v));
  const peak = rtts.length > 0 ? Math.max(...rtts) : 1;

  return (
    <div className="chart">
      {recent.map((result, i) => {
        const height = result.rttMs !== null ? Math.max(6, Math.round((result.rttMs / peak) * 100)) : 100;
        const when = timeOf(result.at);
        const title =
          result.rttMs !== null
            ? `${when} — ${result.rttMs.toFixed(1)} ms`
            : `${when} — ${result.state}${result.reason !== null ? `: ${result.reason}` : ''}`;
        return (
          <div
            key={`${result.at}-${i}`}
            className="bar"
            data-state={result.state}
            title={title}
            style={{ height: `${height}%` }}
          />
        );
      })}
    </div>
  );
}
