import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, loadProbeRunConfig, ProbeConfigError } from '../src/probe/config.ts';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('parses a location and flag overrides', () => {
  const parsed = parseArgs(['Kitchen', '--server', 'http://host:8787', '--interval', '3000']);
  assert.equal(parsed.location, 'Kitchen');
  assert.equal(parsed.overrides.serverUrl, 'http://host:8787');
  assert.equal(parsed.overrides.intervalMs, 3000);
});

test('rejects an unrecognised flag', () => {
  assert.throws(() => parseArgs(['Kitchen', '--bogus']), /unrecognised argument/);
});

test('rejects a flag missing its value', () => {
  assert.throws(() => parseArgs(['Kitchen', '--server']), /--server requires a value/);
});

test('rejects a flag whose "value" is actually the next flag', () => {
  // Without this check, `--server` would silently swallow `--device-id` as
  // its value, then misparse everything that follows.
  assert.throws(() => parseArgs(['Kitchen', '--server', '--device-id', 'pi-1']), /--server requires a value/);
});

test('rejects --config missing its value the same way', () => {
  assert.throws(() => parseArgs(['Kitchen', '--config']), /--config requires a value/);
  assert.throws(() => parseArgs(['Kitchen', '--config', '--server', 'x']), /--config requires a value/);
});

test('end to end: CLI overrides win over the config file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'probe-config-'));
  const configPath = join(dir, 'probe.json');
  await writeFile(configPath, JSON.stringify({
    serverUrl: 'http://file-default:8787',
    deviceId: 'file-device',
    probe: { intervalMs: 5000, timeoutMs: 1000 },
    wifi: { iface: 'wlan0', intervalMs: 30000 },
  }));

  try {
    const config = await loadProbeRunConfig(
      ['Office', '--server', 'http://cli-override:8787'],
      configPath,
    );
    assert.equal(config.location, 'Office');
    assert.equal(config.serverUrl, 'http://cli-override:8787');
    assert.equal(config.deviceId, 'file-device');
    assert.equal(config.probe.intervalMs, 5000);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('requires a location', async () => {
  await assert.rejects(
    loadProbeRunConfig([], '/nonexistent/probe.json'),
    (err: unknown) => err instanceof ProbeConfigError,
  );
});

test('rejects a probe timeout that is not smaller than the interval', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'probe-config-'));
  const configPath = join(dir, 'probe.json');
  await writeFile(configPath, JSON.stringify({
    serverUrl: 'http://host:8787',
    deviceId: 'd1',
    probe: { intervalMs: 1000, timeoutMs: 1000 },
  }));

  try {
    await assert.rejects(
      loadProbeRunConfig(['Kitchen'], configPath),
      /must be smaller than the interval/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('rejects an out-of-range interval the same way the server config does', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'probe-config-'));
  const configPath = join(dir, 'probe.json');
  await writeFile(configPath, JSON.stringify({ serverUrl: 'http://host:8787', deviceId: 'd1' }));

  try {
    await assert.rejects(
      loadProbeRunConfig(['Kitchen', '--interval', '0'], configPath),
      /probe\.intervalMs must be between/,
    );
    await assert.rejects(
      loadProbeRunConfig(['Kitchen', '--interval', '1.5'], configPath),
      /must be a whole number/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
