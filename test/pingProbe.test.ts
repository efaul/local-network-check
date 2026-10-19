import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { buildPingArgs, parseRttMs, classifyExitCode, runPing } from '../src/shared/pingProbe.ts';
import type { Result } from '../src/shared/result.ts';

test('ping timeout flag is milliseconds on macOS and seconds on Linux', () => {
  assert.deepEqual(buildPingArgs('10.0.0.1', 1000, 'darwin'), ['-c', '1', '-n', '-W', '1000', '10.0.0.1']);
  assert.deepEqual(buildPingArgs('10.0.0.1', 1500, 'linux'), ['-c', '1', '-n', '-W', '2', '10.0.0.1']);
});

test('linux timeout never rounds down to zero seconds', () => {
  assert.equal(buildPingArgs('10.0.0.1', 200, 'linux').at(-2), '1');
});

test('parses round trip time from ping output', () => {
  assert.equal(parseRttMs('64 bytes from 10.0.0.1: icmp_seq=0 ttl=64 time=9.882 ms'), 9.882);
  assert.equal(parseRttMs('64 bytes from 10.0.0.1: icmp_seq=0 ttl=64 time<1 ms'), 1);
  assert.equal(parseRttMs('no timing here'), null);
});

test('exit codes mean different things on macOS and Linux', () => {
  assert.equal(classifyExitCode(0, 'darwin'), 'ok');
  assert.equal(classifyExitCode(2, 'darwin'), 'timeout');
  assert.equal(classifyExitCode(68, 'darwin'), 'error');
  assert.equal(classifyExitCode(0, 'linux'), 'ok');
  assert.equal(classifyExitCode(1, 'linux'), 'timeout');
  assert.equal(classifyExitCode(2, 'linux'), 'error');
});

interface FakeChild extends EventEmitter {
  stdout: EventEmitter & { setEncoding: (encoding: string) => void };
  stderr: EventEmitter & { setEncoding: (encoding: string) => void };
}

function fakeChild(): FakeChild {
  const stream = (): EventEmitter & { setEncoding: (encoding: string) => void } =>
    Object.assign(new EventEmitter(), { setEncoding: () => {} });
  return Object.assign(new EventEmitter(), { stdout: stream(), stderr: stream() }) as FakeChild;
}

const probeWith = (drive: (child: FakeChild) => void, platform = 'linux'): Promise<Result> => {
  const child = fakeChild();
  const promise = runPing({
    target: '10.0.0.1',
    timeoutMs: 1000,
    platform,
    spawnFn: () => child as unknown as ChildProcess,
  });
  setImmediate(() => { drive(child); });
  return promise;
};

test('a reply becomes ok with its round trip time', async () => {
  const result = await probeWith((child) => {
    child.stdout.emit('data', 'time=12.5 ms\n');
    child.emit('close', 0, null);
  });
  assert.equal(result.state, 'ok');
  assert.equal(result.rttMs, 12.5);
});

test('no reply is a timeout on Linux (exit 1)', async () => {
  const result = await probeWith((child) => child.emit('close', 1, null), 'linux');
  assert.equal(result.state, 'timeout');
  assert.equal(result.reason, 'no-reply');
});

test('no reply is a timeout on macOS (exit 2)', async () => {
  const result = await probeWith((child) => child.emit('close', 2, null), 'darwin');
  assert.equal(result.state, 'timeout');
});

test('the same exit code is an error on the other platform', async () => {
  const linux = await probeWith((child) => child.emit('close', 2, null), 'linux');
  const macos = await probeWith((child) => child.emit('close', 1, null), 'darwin');
  assert.equal(linux.state, 'error');
  assert.equal(macos.state, 'error');
});

test('being killed by the backstop timeout is a timeout', async () => {
  const result = await probeWith((child) => child.emit('close', null, 'SIGKILL'));
  assert.equal(result.state, 'timeout');
  assert.equal(result.reason, 'probe-timeout');
});

test('a missing ping binary is an error', async () => {
  const result = await probeWith((child) => {
    const err: NodeJS.ErrnoException = new Error('spawn ping ENOENT');
    err.code = 'ENOENT';
    child.emit('error', err);
  });
  assert.equal(result.state, 'error');
  assert.equal(result.reason, 'ping-command-not-found');
});

test('a probe aborted by shutdown is marked as such, not as loss', async () => {
  const result = await probeWith((child) => {
    const err = new Error('aborted');
    err.name = 'AbortError';
    child.emit('error', err);
  });
  assert.equal(result.state, 'error');
  assert.equal(result.reason, 'probe-aborted');
});

test('a real invocation always resolves with a valid result', async () => {
  const result = await runPing({ target: '127.0.0.1', timeoutMs: 1000 });
  assert.ok(['ok', 'timeout', 'error'].includes(result.state));
  if (result.state !== 'ok') assert.equal(result.rttMs, null);
});

test('an unroutable address is reported as no reply, not as an error', async () => {
  const result = await runPing({ target: '192.0.2.1', timeoutMs: 1000 });
  assert.equal(result.state, 'timeout');
});
