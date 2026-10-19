import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createScheduler } from '../src/shared/scheduler.ts';
import type { Gap, TimerHandle } from '../src/shared/scheduler.ts';

interface FakeClock {
  now: () => number;
  setTimeoutFn: (handler: () => void, delayMs: number) => TimerHandle;
  clearTimeoutFn: (handle: TimerHandle) => void;
  advance: (ms: number) => Promise<void>;
}

function fakeClock(): FakeClock {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { handler: () => void; at: number }>();

  return {
    now: () => now,
    setTimeoutFn: (handler, delayMs) => {
      const id = nextId++;
      timers.set(id, { handler, at: now + Math.max(0, delayMs) });
      return id;
    },
    clearTimeoutFn: (handle) => { timers.delete(handle as number); },
    async advance(ms) {
      const target = now + ms;
      let guard = 0;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (due === undefined || (guard += 1) > 1000) break;
        const [id, timer] = due;
        timers.delete(id);
        now = Math.max(now, timer.at);
        timer.handler();
        await Promise.resolve();
        await Promise.resolve();
      }
      now = target;
    },
  };
}

test('runs on a steady cadence that does not drift with probe duration', async () => {
  const clock = fakeClock();
  const startedAt: number[] = [];

  const scheduler = createScheduler<string>({
    intervalMs: 1000,
    now: clock.now,
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
    run: async () => { startedAt.push(clock.now()); return 'result'; },
  });

  scheduler.start();
  await clock.advance(3000);
  scheduler.stop();

  assert.deepEqual(startedAt, [0, 1000, 2000, 3000]);
});

test('reports a gap when a cycle is missed', async () => {
  const clock = fakeClock();
  const gaps: Gap[] = [];
  let call = 0;

  const scheduler = createScheduler<void>({
    intervalMs: 1000,
    now: clock.now,
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
    onGap: (gap) => gaps.push(gap),
    run: async () => {
      call += 1;
      if (call === 1) await clock.advance(2500);
    },
  });

  scheduler.start();
  await clock.advance(4000);
  scheduler.stop();

  assert.ok(gaps.length >= 1);
  assert.ok((gaps[0]?.lateByMs ?? 0) >= 1000);
});

test('a throwing probe does not stop the loop', async () => {
  const clock = fakeClock();
  const errors: unknown[] = [];
  let runs = 0;

  const scheduler = createScheduler<void>({
    intervalMs: 1000,
    now: clock.now,
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
    onError: (err) => errors.push(err),
    run: async () => { runs += 1; throw new Error('boom'); },
  });

  scheduler.start();
  await clock.advance(3000);
  scheduler.stop();

  assert.ok(runs >= 3);
  assert.equal(errors.length, runs);
});

test('stop() prevents any further runs', async () => {
  const clock = fakeClock();
  let runs = 0;

  const scheduler = createScheduler<void>({
    intervalMs: 1000,
    now: clock.now,
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
    run: async () => { runs += 1; },
  });

  scheduler.start();
  await clock.advance(1000);
  const afterStart = runs;
  scheduler.stop();
  await clock.advance(5000);

  assert.equal(runs, afterStart);
  assert.equal(scheduler.isStopped, true);
});
