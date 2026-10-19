/**
 * Survey probe config: merges config/probe.json defaults with CLI overrides.
 * Kept self-contained (no import from src/server) so the probe directory can
 * be copied to a Raspberry Pi on its own, without the server code.
 */

import { readFile } from 'node:fs/promises';

export class ProbeConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProbeConfigError';
  }
}

export interface ProbeRunConfig {
  readonly location: string;
  readonly serverUrl: string;
  readonly deviceId: string;
  readonly probe: { readonly intervalMs: number; readonly timeoutMs: number };
  readonly wifi: { readonly iface: string; readonly intervalMs: number };
  readonly forward: { readonly flushIntervalMs: number; readonly maxQueueSize: number };
}

export interface ParsedArgs {
  location: string | null;
  configPath: string | null;
  overrides: {
    serverUrl?: string;
    deviceId?: string;
    intervalMs?: number;
    timeoutMs?: number;
    iface?: string;
    wifiIntervalMs?: number;
  };
}

const FLAG_TO_KEY: Record<string, keyof ParsedArgs['overrides']> = {
  '--server': 'serverUrl',
  '--device-id': 'deviceId',
  '--interval': 'intervalMs',
  '--timeout': 'timeoutMs',
  '--iface': 'iface',
  '--wifi-interval': 'wifiIntervalMs',
};

const NUMERIC_KEYS = new Set<keyof ParsedArgs['overrides']>(['intervalMs', 'timeoutMs', 'wifiIntervalMs']);

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const result: ParsedArgs = { location: null, configPath: null, overrides: {} };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--config') {
      const value = argv[++i];
      if (value === undefined || value.startsWith('--')) {
        throw new ProbeConfigError('--config requires a value');
      }
      result.configPath = value;
      continue;
    }
    if (arg !== undefined && arg in FLAG_TO_KEY) {
      const key = FLAG_TO_KEY[arg as keyof typeof FLAG_TO_KEY];
      const raw = argv[++i];
      if (raw === undefined || raw.startsWith('--')) {
        throw new ProbeConfigError(`${arg} requires a value`);
      }
      if (key !== undefined) {
        if (NUMERIC_KEYS.has(key)) {
          const num = Number(raw);
          if (!Number.isFinite(num)) throw new ProbeConfigError(`${arg} must be a number, got "${raw}"`);
          (result.overrides as Record<string, number>)[key] = num;
        } else {
          (result.overrides as Record<string, string>)[key] = raw;
        }
      }
      continue;
    }
    if (arg !== undefined && !arg.startsWith('--') && result.location === null) {
      result.location = arg;
      continue;
    }
    throw new ProbeConfigError(`unrecognised argument: ${arg}`);
  }

  return result;
}

interface RawProbeFile {
  serverUrl?: unknown;
  deviceId?: unknown;
  probe?: { intervalMs?: unknown; timeoutMs?: unknown };
  wifi?: { iface?: unknown; intervalMs?: unknown };
  forward?: { flushIntervalMs?: unknown; maxQueueSize?: unknown };
}

async function readProbeFile(path: string): Promise<RawProbeFile> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (err) {
    throw new ProbeConfigError(`could not read probe config at ${path}: ${(err as Error).message}`);
  }
  try {
    return JSON.parse(text) as RawProbeFile;
  } catch (err) {
    throw new ProbeConfigError(`probe config at ${path} is not valid JSON: ${(err as Error).message}`);
  }
}

function requireIntInRange(value: number, label: string, { min, max }: { min: number; max: number }): number {
  if (!Number.isInteger(value)) throw new ProbeConfigError(`${label} must be a whole number, got ${value}`);
  if (value < min || value > max) {
    throw new ProbeConfigError(`${label} must be between ${min} and ${max} (got ${value})`);
  }
  return value;
}

export async function loadProbeRunConfig(argv: readonly string[], defaultConfigPath: string): Promise<ProbeRunConfig> {
  const parsed = parseArgs(argv);
  if (parsed.location === null || parsed.location.trim() === '') {
    throw new ProbeConfigError('usage: probe <location> [--server <url>] [--device-id <id>] [--iface <name>] ...');
  }

  const file = await readProbeFile(parsed.configPath ?? defaultConfigPath);

  const serverUrl = parsed.overrides.serverUrl ?? (typeof file.serverUrl === 'string' ? file.serverUrl : undefined);
  if (serverUrl === undefined || serverUrl.trim() === '') {
    throw new ProbeConfigError('serverUrl is required (via --server or probe.json)');
  }

  const deviceId = parsed.overrides.deviceId ?? (typeof file.deviceId === 'string' ? file.deviceId : undefined);
  if (deviceId === undefined || deviceId.trim() === '') {
    throw new ProbeConfigError('deviceId is required (via --device-id or probe.json)');
  }

  const intervalMs = requireIntInRange(
    parsed.overrides.intervalMs ?? (typeof file.probe?.intervalMs === 'number' ? file.probe.intervalMs : 5000),
    'probe.intervalMs', { min: 1000, max: 600_000 },
  );
  const timeoutMs = requireIntInRange(
    parsed.overrides.timeoutMs ?? (typeof file.probe?.timeoutMs === 'number' ? file.probe.timeoutMs : 1000),
    'probe.timeoutMs', { min: 100, max: 60_000 },
  );
  if (timeoutMs >= intervalMs) {
    throw new ProbeConfigError(`probe timeout (${timeoutMs}ms) must be smaller than the interval (${intervalMs}ms)`);
  }

  const iface = parsed.overrides.iface ?? (typeof file.wifi?.iface === 'string' ? file.wifi.iface : 'wlan0');
  const wifiIntervalMs = requireIntInRange(
    parsed.overrides.wifiIntervalMs ?? (typeof file.wifi?.intervalMs === 'number' ? file.wifi.intervalMs : 30_000),
    'wifi.intervalMs', { min: 1000, max: 600_000 },
  );

  const flushIntervalMs = typeof file.forward?.flushIntervalMs === 'number' ? file.forward.flushIntervalMs : 10_000;
  const maxQueueSize = typeof file.forward?.maxQueueSize === 'number' ? file.forward.maxQueueSize : 5000;

  return {
    location: parsed.location.trim(),
    serverUrl: serverUrl.replace(/\/+$/, ''),
    deviceId: deviceId.trim(),
    probe: { intervalMs, timeoutMs },
    wifi: { iface, intervalMs: wifiIntervalMs },
    forward: { flushIntervalMs, maxQueueSize },
  };
}
