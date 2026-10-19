/**
 * Fires a probe on a fixed cadence with no overlap. Each run is scheduled
 * relative to the previous intended start, so the cadence does not drift by
 * the duration of each probe. If a run overruns its slot, the missed time is
 * reported as a gap instead of being silently swallowed.
 */

export type TimerHandle = ReturnType<typeof setTimeout> | number;
export type SetTimeoutFn = (handler: () => void, delayMs: number) => TimerHandle;
export type ClearTimeoutFn = (handle: TimerHandle) => void;

export interface Gap {
  readonly expectedAt: number;
  readonly actualAt: number;
  readonly lateByMs: number;
}

export interface SchedulerOptions<T> {
  intervalMs: number;
  run: () => T | Promise<T>;
  onResult?: (result: T) => void;
  onGap?: (gap: Gap) => void;
  onError?: (error: unknown) => void;
  setTimeoutFn?: SetTimeoutFn;
  clearTimeoutFn?: ClearTimeoutFn;
  now?: () => number;
}

export interface Scheduler {
  start(): void;
  stop(): void;
  readonly isRunning: boolean;
  readonly isStopped: boolean;
}

export function createScheduler<T>({
  intervalMs,
  run,
  onResult = () => {},
  onGap = () => {},
  onError = () => {},
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  now = () => Date.now(),
}: SchedulerOptions<T>): Scheduler {
  if (typeof run !== 'function') throw new TypeError('createScheduler: run must be a function');
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new TypeError('createScheduler: intervalMs must be a positive number');
  }

  let timer: TimerHandle | null = null;
  let running = false;
  let stopped = true;
  let nextDueAt = 0;

  const schedule = (delayMs: number): void => {
    if (stopped) return;
    timer = setTimeoutFn(() => { void tick(); }, Math.max(0, delayMs));
  };

  async function tick(): Promise<void> {
    if (stopped) return;

    const startedAt = now();
    const lateBy = startedAt - nextDueAt;
    if (nextDueAt > 0 && lateBy >= intervalMs) {
      onGap({ expectedAt: nextDueAt, actualAt: startedAt, lateByMs: lateBy });
    }

    running = true;
    try {
      const result = await run();
      if (result !== undefined) onResult(result);
    } catch (err) {
      onError(err);
    } finally {
      running = false;
    }

    nextDueAt = startedAt + intervalMs;
    schedule(nextDueAt - now());
  }

  return {
    start(): void {
      if (!stopped) return;
      stopped = false;
      nextDueAt = now();
      schedule(0);
    },
    stop(): void {
      stopped = true;
      if (timer !== null) clearTimeoutFn(timer);
      timer = null;
    },
    get isRunning(): boolean {
      return running;
    },
    get isStopped(): boolean {
      return stopped;
    },
  };
}
