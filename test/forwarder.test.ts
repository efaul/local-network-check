import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createForwarder } from '../src/probe/forwarder.ts';
import type { Result } from '../src/shared/result.ts';

const sample = (at: string): Result => ({ at, state: 'ok', rttMs: 10, reason: null });

test('flush with an empty queue is a no-op success', async () => {
  let calls = 0;
  const forwarder = createForwarder({
    serverUrl: 'http://test',
    deviceId: 'd1',
    location: 'Kitchen',
    maxQueueSize: 10,
    fetchFn: (async () => { calls += 1; return new Response('{}'); }) as typeof fetch,
  });

  assert.equal(await forwarder.flush(), true);
  assert.equal(calls, 0);
});

test('a successful flush empties the queue and posts the right shape', async () => {
  let body: unknown = null;
  const forwarder = createForwarder({
    serverUrl: 'http://test',
    deviceId: 'd1',
    location: 'Kitchen',
    maxQueueSize: 10,
    fetchFn: (async (_url, init) => {
      body = JSON.parse(String((init as RequestInit).body));
      return new Response(JSON.stringify({ acceptedSamples: 1, acceptedWifiSamples: 0 }), { status: 200 });
    }) as typeof fetch,
  });

  forwarder.addSample(sample('2026-06-01T00:00:00.000Z'));
  assert.equal(forwarder.queueSize, 1);

  assert.equal(await forwarder.flush(), true);
  assert.equal(forwarder.queueSize, 0);
  assert.deepEqual((body as { deviceId: string }).deviceId, 'd1');
  assert.deepEqual((body as { location: string }).location, 'Kitchen');
});

test('a failed flush keeps the batch queued for the next attempt', async () => {
  const forwarder = createForwarder({
    serverUrl: 'http://test',
    deviceId: 'd1',
    location: 'Kitchen',
    maxQueueSize: 10,
    fetchFn: (async () => new Response('server error', { status: 500 })) as typeof fetch,
  });

  forwarder.addSample(sample('2026-06-01T00:00:00.000Z'));
  assert.equal(await forwarder.flush(), false);
  assert.equal(forwarder.queueSize, 1);
});

test('a network error is treated the same as a failed flush', async () => {
  const forwarder = createForwarder({
    serverUrl: 'http://test',
    deviceId: 'd1',
    location: 'Kitchen',
    maxQueueSize: 10,
    fetchFn: (async () => { throw new TypeError('fetch failed'); }) as typeof fetch,
  });

  forwarder.addSample(sample('2026-06-01T00:00:00.000Z'));
  assert.equal(await forwarder.flush(), false);
  assert.equal(forwarder.queueSize, 1);
});

test('the queue is capped: oldest items are dropped, not newest', () => {
  const forwarder = createForwarder({ serverUrl: 'http://test', deviceId: 'd1', location: 'Kitchen', maxQueueSize: 2 });

  forwarder.addSample(sample('2026-06-01T00:00:00.000Z'));
  forwarder.addSample(sample('2026-06-01T00:00:05.000Z'));
  forwarder.addSample(sample('2026-06-01T00:00:10.000Z'));

  assert.equal(forwarder.queueSize, 2);
});

test('items collected during a failed flush are preserved alongside the retry', async () => {
  let attempt = 0;
  const forwarder = createForwarder({
    serverUrl: 'http://test',
    deviceId: 'd1',
    location: 'Kitchen',
    maxQueueSize: 10,
    fetchFn: (async () => {
      attempt += 1;
      if (attempt === 1) {
        // Simulate a new sample arriving while the first flush is in flight.
        forwarder.addSample(sample('2026-06-01T00:00:05.000Z'));
        return new Response('error', { status: 500 });
      }
      return new Response(JSON.stringify({ acceptedSamples: 2, acceptedWifiSamples: 0 }), { status: 200 });
    }) as typeof fetch,
  });

  forwarder.addSample(sample('2026-06-01T00:00:00.000Z'));
  assert.equal(await forwarder.flush(), false);
  assert.equal(forwarder.queueSize, 2);

  assert.equal(await forwarder.flush(), true);
  assert.equal(forwarder.queueSize, 0);
});
