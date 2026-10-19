/**
 * The server's own continuous backbone probe: pings the configured target on
 * a fixed cadence and writes each result straight into the shared database
 * under the server's own device id and location.
 */

import { runPing } from '../shared/pingProbe.ts';
import { createScheduler } from '../shared/scheduler.ts';
import type { Scheduler } from '../shared/scheduler.ts';
import { insertSample } from './db.ts';
import type { Db } from './db.ts';
import type { ServerConfig } from './config.ts';

export interface BackboneRunner {
  start(): void;
  stop(): void;
}

export interface CreateBackboneRunnerOptions {
  config: ServerConfig;
  db: Db;
  log?: (message: string) => void;
}

export function createBackboneRunner({ config, db, log = () => {} }: CreateBackboneRunnerOptions): BackboneRunner {
  const abort = new AbortController();
  let shuttingDown = false;

  const scheduler: Scheduler = createScheduler({
    intervalMs: config.probe.intervalMs,
    run: () =>
      runPing({
        target: config.target.address,
        timeoutMs: config.probe.timeoutMs,
        signal: abort.signal,
      }),
    onResult: (result) => {
      if (shuttingDown) return;
      insertSample(db, { deviceId: config.node.id, location: config.node.location, result });
      if (result.state !== 'ok') log(`backbone probe ${result.state}: ${result.reason ?? 'no detail'}`);
    },
    onGap: ({ lateByMs }) => log(`backbone schedule gap: ${Math.round(lateByMs / 1000)}s later than expected`),
    onError: (err) => log(`backbone probe threw unexpectedly: ${(err as Error).stack ?? String(err)}`),
  });

  return {
    start(): void {
      scheduler.start();
    },
    stop(): void {
      shuttingDown = true;
      scheduler.stop();
      abort.abort();
    },
  };
}
