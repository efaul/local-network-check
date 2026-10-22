import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateServerConfig, ConfigError } from '../src/server/config.ts';

const base = (): Record<string, unknown> => ({
  node: { id: 'backbone-1', name: 'Ubuntu server', location: 'Backbone' },
  target: { address: '192.168.86.1', label: 'Primary router' },
  probe: { intervalMs: 5000, timeoutMs: 1000 },
  window: { minutes: 15 },
  server: { host: '127.0.0.1', port: 8787 },
  db: { path: './data/central.sqlite' },
});

test('accepts a well formed config and derives the window in ms', () => {
  const config = validateServerConfig(base());
  assert.equal(config.window.ms, 900_000);
  assert.equal(config.db.path, './data/central.sqlite');
});

test('rejects a timeout that is not smaller than the interval', () => {
  const raw = base();
  (raw['probe'] as Record<string, unknown>)['timeoutMs'] = 5000;
  assert.throws(() => validateServerConfig(raw), (err: unknown) => {
    assert.ok(err instanceof ConfigError);
    assert.match(err.message, /must be smaller than probe\.intervalMs/);
    return true;
  });
});

test('rejects a missing db path', () => {
  const raw = base();
  delete (raw['db'] as Record<string, unknown>)['path'];
  assert.throws(() => validateServerConfig(raw), /db\.path must be a non-empty string/);
});

test('rejects an address containing whitespace', () => {
  const raw = base();
  (raw['target'] as Record<string, unknown>)['address'] = '192.168.86.1 -c 100';
  assert.throws(() => validateServerConfig(raw), /must not contain whitespace/);
});

test('apNames is optional and defaults to empty', () => {
  const config = validateServerConfig(base());
  assert.deepEqual(config.apNames, {});
});

test('apNames accepts a BSSID -> name map and lowercases the key', () => {
  const raw = base();
  raw['apNames'] = { 'AA:BB:CC:DD:EE:FF': 'Living Room Mesh' };
  const config = validateServerConfig(raw);
  assert.deepEqual(config.apNames, { 'aa:bb:cc:dd:ee:ff': 'Living Room Mesh' });
});

test('rejects apNames that is not an object', () => {
  const raw = base();
  raw['apNames'] = 'not an object';
  assert.throws(() => validateServerConfig(raw), /apNames must be an object/);
});

test('rejects an apNames key that is not a valid BSSID', () => {
  const raw = base();
  raw['apNames'] = { 'not-a-bssid': 'Office AP' };
  assert.throws(() => validateServerConfig(raw), /is not a valid BSSID/);
});

test('rejects an apNames value that is not a non-empty string', () => {
  const raw = base();
  raw['apNames'] = { 'aa:bb:cc:dd:ee:ff': 123 };
  assert.throws(() => validateServerConfig(raw), /must be a non-empty string/);
});
