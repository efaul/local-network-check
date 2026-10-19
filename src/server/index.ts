/**
 * Central server startup and shutdown: loads config, opens the shared
 * database, starts the backbone probe, and serves the HTTP API + dashboard.
 */

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadServerConfig, ConfigError } from './config.ts';
import { openDb } from './db.ts';
import { createBackboneRunner } from './backboneRunner.ts';
import { createServer } from './httpServer.ts';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, '..', '..');

const timestamp = (): string => new Date().toISOString();
const log = (message: string): void => console.log(`${timestamp()} ${message}`);
const logError = (message: string): void => console.error(`${timestamp()} ${message}`);

async function main(): Promise<void> {
  const configPath = resolve(process.argv[2] ?? join(projectRoot, 'config', 'server.json'));

  let config;
  try {
    config = await loadServerConfig(configPath);
  } catch (err) {
    if (err instanceof ConfigError) {
      logError(`Configuration problem: ${err.message}`);
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  const db = await openDb(resolve(projectRoot, config.db.path));
  const backbone = createBackboneRunner({ config, db, log });

  const server = createServer({ config, db, publicDir: join(projectRoot, 'public') });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      logError(`Port ${config.server.port} is already in use. Stop the other process or change server.port.`);
    } else {
      logError(`Server error: ${err.message}`);
    }
    backbone.stop();
    process.exitCode = 1;
  });

  await new Promise<void>((resolveListen) => {
    server.listen(config.server.port, config.server.host, () => { resolveListen(); });
  });

  backbone.start();

  log(`backbone node "${config.node.name}" (${config.node.location})`);
  log(`probing ${config.target.label} [${config.target.address}] every ${config.probe.intervalMs}ms, timeout ${config.probe.timeoutMs}ms`);
  log(`database at ${config.db.path}`);
  log(`dashboard at http://${config.server.host}:${config.server.port}`);
  log(`survey probes should POST to http://${config.server.host}:${config.server.port}/api/ingest`);

  let shutdownStarted = false;
  const shutdown = (signal: string): void => {
    if (shutdownStarted) return;
    shutdownStarted = true;
    log(`${signal} received, shutting down`);
    backbone.stop();
    server.close(() => {
      db.close();
      log('stopped');
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 2000).unref();
  };

  process.on('SIGINT', () => { shutdown('SIGINT'); });
  process.on('SIGTERM', () => { shutdown('SIGTERM'); });
}

main().catch((err: unknown) => {
  logError(`Fatal: ${(err as Error).stack ?? String(err)}`);
  process.exitCode = 1;
});
