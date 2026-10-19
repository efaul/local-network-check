/**
 * Central server config: the server's own identity as the backbone node,
 * what it pings continuously, and where its database lives.
 */

import { readFile } from 'node:fs/promises';

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export interface NodeIdentity {
  readonly id: string;
  readonly name: string;
  readonly location: string;
}

export interface TargetConfig {
  readonly address: string;
  readonly label: string;
}

export interface ProbeConfig {
  readonly intervalMs: number;
  readonly timeoutMs: number;
}

export interface WindowConfig {
  readonly minutes: number;
  readonly ms: number;
}

export interface HttpConfig {
  readonly host: string;
  readonly port: number;
}

export interface DbConfig {
  readonly path: string;
}

export interface ServerConfig {
  readonly node: NodeIdentity;
  readonly target: TargetConfig;
  readonly probe: ProbeConfig;
  readonly window: WindowConfig;
  readonly server: HttpConfig;
  readonly db: DbConfig;
}

type Unknowns = Record<string, unknown>;

const isPlainObject = (value: unknown): value is Unknowns =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const section = (value: unknown): Unknowns => (isPlainObject(value) ? value : {});

function requireString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ConfigError(`${path} must be a non-empty string`);
  }
  return value.trim();
}

function requireInt(value: unknown, path: string, { min, max }: { min: number; max: number }): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new ConfigError(`${path} must be a whole number`);
  }
  if (value < min || value > max) {
    throw new ConfigError(`${path} must be between ${min} and ${max} (got ${value})`);
  }
  return value;
}

export function validateServerConfig(raw: unknown): ServerConfig {
  if (!isPlainObject(raw)) throw new ConfigError('config must be a JSON object');

  const node = section(raw['node']);
  const target = section(raw['target']);
  const probe = section(raw['probe']);
  const windowCfg = section(raw['window']);
  const server = section(raw['server']);
  const db = section(raw['db']);

  const address = requireString(target['address'], 'target.address');
  if (/\s/.test(address)) {
    throw new ConfigError('target.address must not contain whitespace');
  }

  const intervalMs = requireInt(probe['intervalMs'], 'probe.intervalMs', { min: 1000, max: 600_000 });
  const timeoutMs = requireInt(probe['timeoutMs'], 'probe.timeoutMs', { min: 100, max: 60_000 });
  if (timeoutMs >= intervalMs) {
    throw new ConfigError(
      `probe.timeoutMs (${timeoutMs}) must be smaller than probe.intervalMs (${intervalMs})`,
    );
  }

  const minutes = requireInt(windowCfg['minutes'], 'window.minutes', { min: 1, max: 1440 });
  const label = target['label'];

  return Object.freeze({
    node: Object.freeze({
      id: requireString(node['id'], 'node.id'),
      name: requireString(node['name'], 'node.name'),
      location: requireString(node['location'], 'node.location'),
    }),
    target: Object.freeze({
      address,
      label: typeof label === 'string' && label.trim() ? label.trim() : address,
    }),
    probe: Object.freeze({ intervalMs, timeoutMs }),
    window: Object.freeze({ minutes, ms: minutes * 60_000 }),
    server: Object.freeze({
      host: requireString(server['host'], 'server.host'),
      port: requireInt(server['port'], 'server.port', { min: 1, max: 65_535 }),
    }),
    db: Object.freeze({
      path: requireString(db['path'], 'db.path'),
    }),
  });
}

export async function loadServerConfig(path: string): Promise<ServerConfig> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (err) {
    throw new ConfigError(`could not read config file at ${path}: ${(err as Error).message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new ConfigError(`config file at ${path} is not valid JSON: ${(err as Error).message}`);
  }

  return validateServerConfig(parsed);
}
