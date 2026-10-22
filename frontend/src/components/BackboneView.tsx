import { useState } from 'react';
import { api } from '../api';
import type { BackboneStateDocument } from '../types';
import { age, ms, pct } from '../format';
import { StatusBadge } from './StatusBadge';
import { BackboneChart } from './BackboneChart';
import { usePoll } from '../usePoll';

const POLL_MS = 2000;

export function BackboneView() {
  const [state, setState] = useState<BackboneStateDocument | null>(null);
  const [failed, setFailed] = useState(false);

  usePoll(async () => {
    try {
      const next = await api.backboneState();
      setState(next);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, POLL_MS);

  if (state === null) {
    return failed ? (
      <p className="empty-state">The backbone node is not responding.</p>
    ) : (
      <p className="muted">Loading…</p>
    );
  }

  const lastLine =
    state.last === null ? '—' : state.last.state === 'ok' ? ms(state.last.rttMs) : `— (${state.last.state})`;

  return (
    <div className="view-stack">
      <div>
        <h1>{state.node.name}</h1>
        <p className="subtitle">{state.node.location}</p>
      </div>

      <section className={`panel status-panel status-${state.status}`}>
        <div className="status-row">
          <StatusBadge status={state.status} pulse />
          <span className="status-reason">{state.statusReason}</span>
        </div>
        <dl className="fact-grid">
          <div>
            <dt>Target</dt>
            <dd>
              {state.target.label} ({state.target.address})
            </dd>
          </div>
          <div>
            <dt>Last round trip</dt>
            <dd>{lastLine}</dd>
          </div>
          <div>
            <dt>Last check</dt>
            <dd>{state.last ? age(state.last.ageMs) : 'never'}</dd>
          </div>
        </dl>
      </section>

      <section className="panel">
        <h2>Recent checks</h2>
        <BackboneChart recent={state.recent} />
        <p className="legend">
          <span className="key key-ok" /> reply <span className="key key-timeout" /> no reply{' '}
          <span className="key key-error" /> probe error
        </p>
      </section>

      <section className="panel">
        <h2>Window · last {state.window.minutes} min</h2>
        <dl className="fact-grid">
          <div>
            <dt>Median</dt>
            <dd>{ms(state.window.latency.medianMs)}</dd>
          </div>
          <div>
            <dt>p95</dt>
            <dd>{ms(state.window.latency.p95Ms)}</dd>
          </div>
          <div>
            <dt>p98</dt>
            <dd>{ms(state.window.latency.p98Ms)}</dd>
          </div>
          <div>
            <dt>No reply</dt>
            <dd>{pct(state.window.lossRatio)}</dd>
          </div>
          <div>
            <dt>Replies</dt>
            <dd>{state.window.counts.ok}</dd>
          </div>
          <div>
            <dt>Timeouts</dt>
            <dd>{state.window.counts.timeout}</dd>
          </div>
          <div>
            <dt>Errors</dt>
            <dd>{state.window.counts.error}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
