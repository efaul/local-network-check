/**
 * Survey probe entrypoint: run this on the Raspberry Pi, pointed at a room,
 * and leave it for the day. Pings the central server, samples Wi-Fi
 * association, and forwards both in batches. Stop with Ctrl-C when moving on.
 *
 * Usage: node src/probe/index.ts "Kitchen" [--server http://host:8787] [...]
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProbeRunConfig, ProbeConfigError } from './config.ts';
import { runPing } from '../shared/pingProbe.ts';
import { runWifiScan } from './wifiProbe.ts';
import { createScheduler } from '../shared/scheduler.ts';
import { createForwarder } from './forwarder.ts';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, '..', '..');

const timestamp = (): string => new Date().toISOString();
const log = (message: string): void => console.log(`${timestamp()} ${message}`);
const logError = (message: string): void => console.error(`${timestamp()} ${message}`);

async function main(): Promise<void> {
  let config;
  try {
    config = await loadProbeRunConfig(process.argv.slice(2), join(projectRoot, 'config', 'probe.json'));
  } catch (err) {
    if (err instanceof ProbeConfigError) {
      logError(err.message);
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  // Derive the ping target host from the server URL so the probe measures
  // the same path its data is reported over.
  const target = new URL(config.serverUrl).hostname;

  const abort = new AbortController();
  let shuttingDown = false;

  const forwarder = createForwarder({
    serverUrl: config.serverUrl,
    deviceId: config.deviceId,
    location: config.location,
    maxQueueSize: config.forward.maxQueueSize,
    log,
  });

  const pingScheduler = createScheduler({
    intervalMs: config.probe.intervalMs,
    run: () => runPing({ target, timeoutMs: config.probe.timeoutMs, signal: abort.signal }),
    onResult: (result) => {
      if (shuttingDown) return;
      forwarder.addSample(result);
      if (result.state !== 'ok') log(`ping ${result.state}: ${result.reason ?? 'no detail'}`);
    },
    onGap: ({ lateByMs }) => log(`ping schedule gap: ${Math.round(lateByMs / 1000)}s later than expected`),
    onError: (err) => logError(`ping probe threw unexpectedly: ${(err as Error).stack ?? String(err)}`),
  });

  const wifiScheduler = createScheduler({
    intervalMs: config.wifi.intervalMs,
    run: () => runWifiScan({ iface: config.wifi.iface }),
    onResult: (sample) => {
      if (shuttingDown) return;
      forwarder.addWifiSample(sample);
      if (!sample.connected) log(`wifi: ${sample.reason ?? 'disconnected'}`);
    },
    onError: (err) => logError(`wifi scan threw unexpectedly: ${(err as Error).stack ?? String(err)}`),
  });

  const flushTimer = setInterval(() => { void forwarder.flush(); }, config.forward.flushIntervalMs);
  flushTimer.unref();

  pingScheduler.start();
  wifiScheduler.start();

  log(`survey probe "${config.deviceId}" at "${config.location}"`);
  log(`pinging ${target} every ${config.probe.intervalMs}ms, timeout ${config.probe.timeoutMs}ms`);
  log(`wifi (${config.wifi.iface}) sampled every ${config.wifi.intervalMs}ms`);
  log(`reporting to ${config.serverUrl}/api/ingest every ${config.forward.flushIntervalMs}ms`);
  log('leave this running for the day, then Ctrl-C before moving to the next room');

  let shutdownStarted = false;
  const shutdown = (signal: string): void => {
    if (shutdownStarted) return;
    shutdownStarted = true;
    shuttingDown = true;
    log(`${signal} received, flushing remaining data and shutting down`);
    pingScheduler.stop();
    wifiScheduler.stop();
    clearInterval(flushTimer);
    abort.abort();

    void forwarder.flush().finally(() => {
      if (forwarder.queueSize > 0) {
        logError(`${forwarder.queueSize} buffered items could not be delivered and will be lost.`);
      }
      log('stopped');
      process.exit(0);
    });

    // Do not hang forever if the server stays unreachable.
    setTimeout(() => {
      logError(`${forwarder.queueSize} buffered items could not be delivered and will be lost.`);
      process.exit(0);
    }, 5000).unref();
  };

  process.on('SIGINT', () => { shutdown('SIGINT'); });
  process.on('SIGTERM', () => { shutdown('SIGTERM'); });
}

main().catch((err: unknown) => {
  logError(`Fatal: ${(err as Error).stack ?? String(err)}`);
  process.exitCode = 1;
});
