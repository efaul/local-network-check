import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { parseIwLinkOutput, runWifiScan } from '../src/probe/wifiProbe.ts';

const CONNECTED_OUTPUT = `Connected to aa:bb:cc:dd:ee:ff (on wlan0)
\tSSID: HomeNetwork
\tfreq: 5180
\tRX: 1234 bytes (10 packets)
\tTX: 5678 bytes (20 packets)
\tsignal: -58 dBm
\trx bitrate: 866.7 MBit/s
\ttx bitrate: 433.3 MBit/s
`;

test('parses a connected iw link output', () => {
  const sample = parseIwLinkOutput(CONNECTED_OUTPUT);
  assert.equal(sample.connected, true);
  assert.equal(sample.bssid, 'aa:bb:cc:dd:ee:ff');
  assert.equal(sample.ssid, 'HomeNetwork');
  assert.equal(sample.signalDbm, -58);
  assert.equal(sample.freqMhz, 5180);
  assert.equal(sample.reason, null);
});

test('normalises BSSID case', () => {
  const output = CONNECTED_OUTPUT.replace('aa:bb:cc:dd:ee:ff', 'AA:BB:CC:DD:EE:FF');
  assert.equal(parseIwLinkOutput(output).bssid, 'aa:bb:cc:dd:ee:ff');
});

test('reports not connected distinctly from unreadable output', () => {
  assert.equal(parseIwLinkOutput('Not connected.\n').reason, 'not-connected');
  assert.equal(parseIwLinkOutput('Not connected.\n').connected, false);

  const garbage = parseIwLinkOutput('something unexpected\n');
  assert.equal(garbage.connected, false);
  assert.equal(garbage.reason, 'unreadable-output');
});

interface FakeChild extends EventEmitter {
  stdout: EventEmitter & { setEncoding: (encoding: string) => void };
}

function fakeChild(): FakeChild {
  const stream = (): EventEmitter & { setEncoding: (encoding: string) => void } =>
    Object.assign(new EventEmitter(), { setEncoding: () => {} });
  return Object.assign(new EventEmitter(), { stdout: stream() }) as FakeChild;
}

const scanWith = (drive: (child: FakeChild) => void): ReturnType<typeof runWifiScan> => {
  const child = fakeChild();
  const promise = runWifiScan({ iface: 'wlan0', spawnFn: () => child as unknown as ChildProcess });
  setImmediate(() => { drive(child); });
  return promise;
};

test('a successful scan resolves with parsed fields and a timestamp', async () => {
  const sample = await scanWith((child) => {
    child.stdout.emit('data', CONNECTED_OUTPUT);
    child.emit('close', 0, null);
  });
  assert.equal(sample.connected, true);
  assert.equal(sample.bssid, 'aa:bb:cc:dd:ee:ff');
  assert.ok(Date.parse(sample.at) > 0);
});

test('a missing iw binary is reported, not thrown', async () => {
  const sample = await scanWith((child) => {
    const err: NodeJS.ErrnoException = new Error('spawn iw ENOENT');
    err.code = 'ENOENT';
    child.emit('error', err);
  });
  assert.equal(sample.connected, false);
  assert.equal(sample.reason, 'iw-not-available');
});

test('a non-zero exit is reported, never thrown', async () => {
  const sample = await scanWith((child) => child.emit('close', 1, null));
  assert.equal(sample.connected, false);
  assert.equal(sample.reason, 'iw-exit-1');
});

test('being killed by the timeout backstop is reported as a scan timeout', async () => {
  const sample = await scanWith((child) => child.emit('close', null, 'SIGKILL'));
  assert.equal(sample.connected, false);
  assert.equal(sample.reason, 'scan-timeout');
});
