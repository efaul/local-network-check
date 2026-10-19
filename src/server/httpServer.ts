/**
 * Central HTTP server: serves the dashboard, the backbone's own live state,
 * the ingest endpoint survey probes post to, and the room/heatmap queries.
 */

import { createServer as createHttpServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import type { ServerConfig } from './config.ts';
import type { Db } from './db.ts';
import { recentSamplesForDevice, lastSampleForDevice } from './db.ts';
import { summarise, deriveStatus, isValidCalendarDate } from '../shared/summary.ts';
import { validateIngestRequest, applyIngest, IngestError } from './ingest.ts';
import { getRoomsList, getHoursForDay, getDaysForLocation, getDayDetail } from './aggregate.ts';
import type { BackboneStateDocument } from '../shared/contract.js';

const RECENT_LIMIT = 300;
const MAX_BODY_BYTES = 2 * 1024 * 1024;

/**
 * Static assets come from the React dashboard's Vite build (`frontend/`,
 * compiled to `public/`), whose JS/CSS chunk names are content-hashed and
 * therefore not known ahead of time. Serve anything under `publicDir`
 * instead of a fixed allowlist, falling back to `index.html` for unknown
 * paths so the client-side (hash) router owns navigation.
 */
const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function contentTypeFor(path: string): string {
  return CONTENT_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

async function resolveStaticFile(publicDir: string, pathname: string): Promise<{ body: Buffer; type: string } | null> {
  const relative = pathname === '/' || pathname === '' ? 'index.html' : pathname.replace(/^\/+/, '');
  const full = normalize(join(publicDir, relative));
  const root = normalize(publicDir) + sep;
  if (!full.startsWith(root)) return null;

  try {
    return { body: await readFile(full), type: contentTypeFor(full) };
  } catch {
    if (extname(relative) !== '') return null; // a missing asset is a 404, not the SPA shell
    try {
      return { body: await readFile(join(publicDir, 'index.html')), type: 'text/html; charset=utf-8' };
    } catch {
      return null;
    }
  }
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new IngestError('request body too large');
    chunks.push(chunk as Buffer);
  }

  const text = Buffer.concat(chunks).toString('utf8');
  if (text.trim() === '') throw new IngestError('request body must not be empty');

  try {
    return JSON.parse(text);
  } catch {
    throw new IngestError('request body must be valid JSON');
  }
}

function buildBackboneState(db: Db, config: ServerConfig): BackboneStateDocument {
  const now = Date.now();
  const since = new Date(now - config.window.ms).toISOString();
  const windowResults = recentSamplesForDevice(db, config.node.id, since);
  const summary = summarise(windowResults);
  const last = lastSampleForDevice(db, config.node.id);
  const { status, reason, ageMs = null } = deriveStatus({ last, summary, intervalMs: config.probe.intervalMs, now });

  return {
    generatedAt: new Date(now).toISOString(),
    node: config.node,
    target: config.target,
    probe: config.probe,
    status,
    statusReason: reason,
    last: last ? { ...last, ageMs } : null,
    window: { minutes: config.window.minutes, ...summary },
    recent: windowResults.slice(-RECENT_LIMIT),
  };
}

export interface CreateServerOptions {
  config: ServerConfig;
  db: Db;
  publicDir: string;
}

export function createServer({ config, db, publicDir }: CreateServerOptions): Server {
  return createHttpServer((req, res) => {
    void handleRequest(req, res, { config, db, publicDir });
  });
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  { config, db, publicDir }: CreateServerOptions,
): Promise<void> {
  const method = req.method ?? 'GET';
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;

  try {
    if (path === '/api/state' && method === 'GET') {
      sendJson(res, 200, buildBackboneState(db, config));
      return;
    }

    if (path === '/api/ingest' && method === 'POST') {
      const body = await readJsonBody(req);
      const request = validateIngestRequest(body);
      sendJson(res, 200, applyIngest(db, request));
      return;
    }

    if (path === '/api/rooms' && method === 'GET') {
      sendJson(res, 200, {
        rooms: getRoomsList(db, {
          backboneDeviceId: config.node.id,
          backboneLocation: config.node.location,
          windowMs: config.window.ms,
          intervalMs: config.probe.intervalMs,
        }),
      });
      return;
    }

    const roomMatch = /^\/api\/rooms\/([^/]+)\/(days|hours|day)$/.exec(path);
    if (roomMatch && method === 'GET') {
      const location = decodeURIComponent(roomMatch[1] ?? '');
      const action = roomMatch[2];
      const date = url.searchParams.get('date');

      if (action === 'days') {
        sendJson(res, 200, getDaysForLocation(db, location));
        return;
      }

      if (date === null || !isValidCalendarDate(date)) {
        sendJson(res, 400, { error: 'invalid-or-missing-date', detail: 'expected ?date=YYYY-MM-DD' });
        return;
      }

      if (action === 'hours') {
        sendJson(res, 200, getHoursForDay(db, location, date));
        return;
      }
      if (action === 'day') {
        sendJson(res, 200, getDayDetail(db, location, date));
        return;
      }
    }

    if (path.startsWith('/api/')) {
      sendJson(res, 404, { error: 'not-found' });
      return;
    }

    if (method !== 'GET' && method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD' });
      res.end();
      return;
    }

    const asset = await resolveStaticFile(publicDir, path);
    if (asset === null) {
      sendJson(res, 404, { error: 'not-found' });
      return;
    }

    res.writeHead(200, {
      'content-type': asset.type,
      'content-length': asset.body.length,
      'cache-control': 'no-store',
    });
    res.end(method === 'HEAD' ? undefined : asset.body);
  } catch (err) {
    if (err instanceof IngestError) {
      sendJson(res, 400, { error: 'invalid-request', detail: err.message });
      return;
    }
    sendJson(res, 500, { error: 'internal-error', detail: (err as Error).message });
  }
}
