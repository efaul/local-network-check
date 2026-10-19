import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readdir } from 'node:fs/promises';
import { createServer } from '../src/server/httpServer.ts';
import { openDb, insertSample } from '../src/server/db.ts';
import type { ServerConfig } from '../src/server/config.ts';
import type { BackboneStateDocument, IngestResponse, RoomsListDocument } from '../src/shared/contract.js';

const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

const testConfig: ServerConfig = {
  node: { id: 'backbone-1', name: 'Test backbone', location: 'Backbone' },
  target: { address: '192.168.86.1', label: 'Primary router' },
  probe: { intervalMs: 5000, timeoutMs: 1000 },
  window: { minutes: 15, ms: 900_000 },
  server: { host: '127.0.0.1', port: 0 },
  db: { path: ':memory:' },
};

async function withServer(
  run: (baseUrl: string, db: Awaited<ReturnType<typeof openDb>>) => Promise<void>,
): Promise<void> {
  const db = await openDb(':memory:');
  const server = createServer({ config: testConfig, db, publicDir });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('expected a bound TCP address');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await run(baseUrl, db);
  } finally {
    db.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test('GET /api/state is unknown before any measurement', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/state`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as BackboneStateDocument;
    assert.equal(body.status, 'unknown');
    assert.equal(body.last, null);
  });
});

test('GET /api/state reflects a sample already in the database', async () => {
  await withServer(async (baseUrl, db) => {
    insertSample(db, {
      deviceId: 'backbone-1',
      location: 'Backbone',
      result: { at: new Date().toISOString(), state: 'ok', rttMs: 7.5, reason: null },
    });

    const body = (await (await fetch(`${baseUrl}/api/state`)).json()) as BackboneStateDocument;
    assert.equal(body.status, 'ok');
    assert.equal(body.last?.rttMs, 7.5);
  });
});

test('serves static files and rejects path traversal', async () => {
  await withServer(async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/`)).status, 200);
    assert.equal((await fetch(`${baseUrl}/style.css`)).status, 200);
    assert.equal((await fetch(`${baseUrl}/app.js`)).status, 200);
    assert.equal((await fetch(`${baseUrl}/band.js`)).status, 200);
    assert.equal((await fetch(`${baseUrl}/../package.json`)).status, 404);
    assert.equal((await fetch(`${baseUrl}/does-not-exist`)).status, 404);
  });
});

test('every compiled .js file in public/ is actually servable', async () => {
  // Regression test: adding a new browser module (e.g. band.ts -> band.js)
  // and forgetting to add it to the server's static-file allow-list is a
  // silent, fatal bug in the browser - an ES module import 404ing breaks the
  // whole dashboard, not just the new feature. This enumerates the real
  // build output so that failure mode can't recur unnoticed.
  const files = await readdir(publicDir);
  const jsFiles = files.filter((name) => name.endsWith('.js'));
  assert.ok(jsFiles.length > 0, 'expected at least one compiled .js file in public/');

  await withServer(async (baseUrl) => {
    for (const file of jsFiles) {
      const response = await fetch(`${baseUrl}/${file}`);
      assert.equal(response.status, 200, `/${file} should be servable but returned ${response.status}`);
    }
  });
});

test('POST /api/ingest accepts a valid batch and rejects a malformed one', async () => {
  await withServer(async (baseUrl) => {
    const good = await fetch(`${baseUrl}/api/ingest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        deviceId: 'pi-1',
        location: 'Kitchen',
        samples: [{ at: '2026-06-01T00:00:00.000Z', state: 'ok', rttMs: 10, reason: null }],
        wifiSamples: [],
      }),
    });
    assert.equal(good.status, 200);
    assert.deepEqual(await good.json() as IngestResponse, { acceptedSamples: 1, acceptedWifiSamples: 0 });

    const bad = await fetch(`${baseUrl}/api/ingest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceId: 'pi-1' }),
    });
    assert.equal(bad.status, 400);

    const malformedJson = await fetch(`${baseUrl}/api/ingest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    assert.equal(malformedJson.status, 400);
  });
});

test('a retried ingest POST is a safe no-op (room list does not double-count)', async () => {
  await withServer(async (baseUrl) => {
    const payload = JSON.stringify({
      deviceId: 'pi-1',
      location: 'Kitchen',
      samples: [{ at: '2026-06-01T00:00:00.000Z', state: 'ok', rttMs: 10, reason: null }],
      wifiSamples: [],
    });
    const options = { method: 'POST', headers: { 'content-type': 'application/json' }, body: payload };

    const first = (await (await fetch(`${baseUrl}/api/ingest`, options)).json()) as IngestResponse;
    const second = (await (await fetch(`${baseUrl}/api/ingest`, options)).json()) as IngestResponse;

    assert.equal(first.acceptedSamples, 1);
    assert.equal(second.acceptedSamples, 0);
  });
});

test('GET /api/rooms lists both the backbone and every surveyed location', async () => {
  await withServer(async (baseUrl, db) => {
    insertSample(db, {
      deviceId: 'backbone-1',
      location: 'Backbone',
      result: { at: new Date().toISOString(), state: 'ok', rttMs: 5, reason: null },
    });
    insertSample(db, {
      deviceId: 'pi-1',
      location: 'Kitchen',
      result: { at: '2026-06-01T12:00:00.000Z', state: 'ok', rttMs: 9, reason: null },
    });

    const body = (await (await fetch(`${baseUrl}/api/rooms`)).json()) as RoomsListDocument;
    const locations = body.rooms.map((r) => r.location).sort();
    assert.deepEqual(locations, ['Backbone', 'Kitchen']);
    assert.equal(body.rooms.find((r) => r.location === 'Backbone')?.isBackbone, true);
  });
});

test('a loose-but-parseable date is rejected, not silently misinterpreted', async () => {
  await withServer(async (baseUrl) => {
    // Before the fix, "2026-6-1" passed a Date.parse-only check and then
    // crashed the day-range query with an opaque 500.
    const looseFormat = await fetch(`${baseUrl}/api/rooms/Kitchen/hours?date=2026-6-1`);
    assert.equal(looseFormat.status, 400);

    // "2026-02-30" does not exist; Date silently rolls it to 2026-03-02
    // instead of rejecting it, so a naive check would also accept this.
    const rolledOver = await fetch(`${baseUrl}/api/rooms/Kitchen/hours?date=2026-02-30`);
    assert.equal(rolledOver.status, 400);

    const missing = await fetch(`${baseUrl}/api/rooms/Kitchen/hours`);
    assert.equal(missing.status, 400);

    const valid = await fetch(`${baseUrl}/api/rooms/Kitchen/hours?date=2026-06-01`);
    assert.equal(valid.status, 200);
  });
});

test('days endpoint for a location with no data returns an empty list, not an error', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/rooms/Nowhere/days`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { location: 'Nowhere', dates: [] });
  });
});

test('an unknown API route is a 404, not a static-file fallthrough', async () => {
  await withServer(async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/api/nonsense`)).status, 404);
  });
});
