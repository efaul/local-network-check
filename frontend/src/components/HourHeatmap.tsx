import type { HourBucketDto } from '../types';
import { ms, pct, STATUS_TEXT } from '../format';

export function HourHeatmap({ hours }: { hours: readonly HourBucketDto[] }) {
  return (
    <>
      <div className="hour-grid">
        {hours.map((bucket) => {
          const total = bucket.counts.ok + bucket.counts.timeout + bucket.counts.error;
          const title =
            total === 0
              ? `${String(bucket.hour).padStart(2, '0')}:00 — no data`
              : `${String(bucket.hour).padStart(2, '0')}:00 — ${STATUS_TEXT[bucket.status]}. ${bucket.statusReason} ` +
                `Median ${ms(bucket.latency.medianMs)}, loss ${pct(bucket.lossRatio)}.`;
          return <div key={bucket.hour} className="hour-cell" data-status={bucket.status} title={title} />;
        })}
      </div>
      <div className="hour-labels">
        {Array.from({ length: 24 }, (_, hour) => (
          <span key={hour}>{hour % 3 === 0 ? String(hour).padStart(2, '0') : ''}</span>
        ))}
      </div>
    </>
  );
}
