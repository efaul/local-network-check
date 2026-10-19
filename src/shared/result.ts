/**
 * Result record — the shape every probe (backbone or survey) produces.
 *
 * A result is always exactly one of three states, and `rttMs` can only carry
 * a value when the state is `ok`. Keeping this invariant in one place is what
 * stops timeouts and errors from ever being counted as latency or as loss.
 */

export const STATE = {
  OK: 'ok',
  TIMEOUT: 'timeout',
  ERROR: 'error',
} as const;

export type ProbeState = (typeof STATE)[keyof typeof STATE];

export interface Result {
  readonly at: string;
  readonly state: ProbeState;
  /** Only ever non-null when `state` is `ok`. */
  readonly rttMs: number | null;
  /** Short machine-readable explanation for anything other than a clean reply. */
  readonly reason: string | null;
}

export interface CreateResultInput {
  at?: Date;
  state: ProbeState;
  rttMs?: number | null;
  reason?: string | null;
}

const STATES = new Set<string>(Object.values(STATE));

export function createResult({ at = new Date(), state, rttMs = null, reason = null }: CreateResultInput): Result {
  if (!STATES.has(state)) throw new TypeError(`createResult: unknown state "${state}"`);

  const measured = state === STATE.OK && typeof rttMs === 'number' && Number.isFinite(rttMs)
    ? rttMs
    : null;

  return Object.freeze({
    at: at.toISOString(),
    state,
    rttMs: measured,
    reason: state === STATE.OK && measured !== null ? null : reason,
  });
}

export const ok = (rttMs: number | null, at?: Date, reason: string | null = null): Result =>
  createResult({ at, state: STATE.OK, rttMs, reason });

export const timeout = (reason: string, at?: Date): Result =>
  createResult({ at, state: STATE.TIMEOUT, reason });

export const failure = (reason: string, at?: Date): Result =>
  createResult({ at, state: STATE.ERROR, reason });
