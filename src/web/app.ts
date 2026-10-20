/**
 * Dashboard: backbone live view, room heatmap overview, and per-room detail
 * with a date picker. Hash-routed, no framework. Compiled to public/app.js.
 */

import type {
  BackboneStateDocument,
  HourBucketDto,
  ResultDto,
  RoomDayDetailDocument,
  RoomDaysDocument,
  RoomHoursDocument,
  RoomSummaryDto,
  RoomsListDocument,
  StatusName,
  WifiSampleDto,
} from '../shared/contract.js';
import { bandOf } from './band.js';

/** Must match {@link DISPLAY_TIMEZONE} in ../shared/timezone.ts (kept local so the web bundle's rootDir stays self-contained). */
const DISPLAY_TIMEZONE = 'Europe/Amsterdam';

const STATUS_TEXT: Record<StatusName, string> = {
  ok: 'OK',
  degraded: 'Degraded',
  down: 'No reply',
  error: 'Probe error',
  unknown: 'Unknown',
};

const view = document.getElementById('view');
if (view === null) throw new Error('missing #view element');

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, string> = {},
  children: Array<Node | string> = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'className') node.className = value;
    else if (key.startsWith('data-')) node.setAttribute(key, value);
    else if (key === 'href') node.setAttribute('href', value);
    else if (key === 'title') node.title = value;
    else node.setAttribute(key, value);
  }
  for (const child of children) node.append(child);
  return node;
}

const ms = (value: number | null): string =>
  value !== null && Number.isFinite(value) ? `${value.toFixed(1)} ms` : '—';

const pct = (value: number | null): string => (value === null ? '—' : `${(value * 100).toFixed(1)}%`);

function age(ageMs: number | null): string {
  if (ageMs === null || !Number.isFinite(ageMs)) return '—';
  const seconds = Math.max(0, Math.round(ageMs / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s ago`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m ago`;
}

function timeAgoFromIso(iso: string | null): string {
  if (iso === null) return 'never';
  return age(Date.now() - Date.parse(iso));
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return (await response.json()) as T;
}

// ---------------------------------------------------------------- backbone

let backbonePoll: ReturnType<typeof setInterval> | null = null;

function renderBackboneChart(container: HTMLElement, recent: readonly ResultDto[]): void {
  container.replaceChildren();
  if (recent.length === 0) {
    container.append(el('p', { className: 'muted' }, ['No measurements yet.']));
    return;
  }
  const rtts = recent.map((r) => r.rttMs).filter((v): v is number => v !== null && Number.isFinite(v));
  const peak = rtts.length > 0 ? Math.max(...rtts) : 1;

  for (const result of recent) {
    const height = result.rttMs !== null ? Math.max(6, Math.round((result.rttMs / peak) * 100)) : 100;
    const when = new Date(result.at).toLocaleTimeString('en-GB', { timeZone: DISPLAY_TIMEZONE });
    const title = result.rttMs !== null
      ? `${when} — ${result.rttMs.toFixed(1)} ms`
      : `${when} — ${result.state}${result.reason !== null ? `: ${result.reason}` : ''}`;
    const bar = el('div', { className: 'bar', 'data-state': result.state, title, style: `height:${height}%` });
    container.append(bar);
  }
}

function renderBackbone(container: HTMLElement, state: BackboneStateDocument): void {
  container.replaceChildren(
    el('div', {}, [
      el('h1', {}, [state.node.name]),
      el('p', { className: 'subtitle' }, [state.node.location]),
    ]),
    el('section', { className: 'status', 'data-status': state.status }, [
      el('div', { className: 'status-row' }, [
        el('span', { className: 'badge' }, [STATUS_TEXT[state.status]]),
        el('span', { className: 'status-reason' }, [state.statusReason]),
      ]),
      el('dl', { className: 'status-facts' }, [
        el('div', {}, [el('dt', {}, ['Target']), el('dd', {}, [`${state.target.label} (${state.target.address})`])]),
        el('div', {}, [el('dt', {}, ['Last round trip']), el('dd', {}, [state.last && state.last.state === 'ok' ? ms(state.last.rttMs) : state.last ? `— (${state.last.state})` : '—'])]),
        el('div', {}, [el('dt', {}, ['Last check']), el('dd', {}, [state.last ? age(state.last.ageMs) : 'never'])]),
      ]),
    ]),
    el('section', { className: 'panel' }, [
      el('h2', {}, ['Recent checks']),
      el('div', { className: 'chart', id: 'backbone-chart' }),
      el('p', { className: 'legend' }, [
        el('span', { className: 'key key-ok' }), ' reply ',
        el('span', { className: 'key key-timeout' }), ' no reply ',
        el('span', { className: 'key key-error' }), ' probe error',
      ]),
    ]),
    el('section', { className: 'panel' }, [
      el('h2', {}, [`Window · last ${state.window.minutes} min`]),
      el('dl', { className: 'stats' }, [
        el('div', {}, [el('dt', {}, ['Median']), el('dd', {}, [ms(state.window.latency.medianMs)])]),
        el('div', {}, [el('dt', {}, ['p95']), el('dd', {}, [ms(state.window.latency.p95Ms)])]),
        el('div', {}, [el('dt', {}, ['No reply']), el('dd', {}, [pct(state.window.lossRatio)])]),
        el('div', {}, [el('dt', {}, ['Replies']), el('dd', {}, [String(state.window.counts.ok)])]),
        el('div', {}, [el('dt', {}, ['Timeouts']), el('dd', {}, [String(state.window.counts.timeout)])]),
        el('div', {}, [el('dt', {}, ['Errors']), el('dd', {}, [String(state.window.counts.error)])]),
      ]),
    ]),
  );

  const chart = container.querySelector('#backbone-chart');
  if (chart instanceof HTMLElement) renderBackboneChart(chart, state.recent);
}

async function mountBackbone(): Promise<void> {
  if (backbonePoll !== null) clearInterval(backbonePoll);

  const poll = async (): Promise<void> => {
    try {
      renderBackbone(view!, await getJson<BackboneStateDocument>('/api/state'));
    } catch {
      view!.replaceChildren(el('p', { className: 'empty-state' }, ['The backbone node is not responding.']));
    }
  };

  await poll();
  backbonePoll = setInterval(() => { void poll(); }, 2000);
}

// -------------------------------------------------------------------- rooms

// Thresholds follow common Wi-Fi signal quality conventions: -60 dBm or
// stronger is a solid connection, -75 dBm is usable but marginal, anything
// weaker is poor.
const SIGNAL_FLOOR_DBM = -90;
const SIGNAL_CEILING_DBM = -30;

function signalQuality(dbm: number): 'good' | 'fair' | 'poor' {
  if (dbm >= -60) return 'good';
  if (dbm >= -75) return 'fair';
  return 'poor';
}

function roomLink(location: string): string {
  return `#/rooms/${encodeURIComponent(location)}`;
}

function roomWifiCell(room: RoomSummaryDto): HTMLElement {
  if (room.latestBssid === null) {
    return el('div', { className: 'room-wifi' }, [el('span', { className: 'muted' }, ['No Wi-Fi data'])]);
  }

  const quality = room.signalDbm !== null ? signalQuality(room.signalDbm) : 'none';
  const apLabel = room.latestSsid ?? room.latestBssid;
  const signalLabel = room.signalDbm !== null ? `${room.signalDbm.toFixed(0)} dBm` : '—';

  return el('div', { className: 'room-wifi' }, [
    el('span', { className: `key key-${quality}` }),
    el('span', { className: 'point-chip' }, [apLabel]),
    room.band !== null ? el('span', { className: 'point-chip' }, [room.band]) : '',
    el('span', { className: 'muted' }, [signalLabel]),
  ]);
}

function renderRoomsList(container: HTMLElement, rooms: readonly RoomSummaryDto[]): void {
  if (rooms.length === 0) {
    container.replaceChildren(
      el('h1', {}, ['Rooms']),
      el('p', { className: 'empty-state' }, ['No rooms surveyed yet. Run the probe in a room to see it here.']),
    );
    return;
  }

  const rows = rooms.map((room) =>
    el('a', { className: 'room-row', 'data-status': room.status, href: roomLink(room.location) }, [
      el('div', {}, [
        el('div', { className: 'room-name' }, [room.location]),
        el('div', { className: 'room-meta' }, [
          room.isBackbone ? 'Continuous backbone reference' : `Last surveyed: ${timeAgoFromIso(room.lastSeenAt)}`,
        ]),
        roomWifiCell(room),
      ]),
      el('span', { className: 'badge' }, [STATUS_TEXT[room.status]]),
    ]),
  );

  container.replaceChildren(
    el('div', {}, [el('h1', {}, ['Rooms']), el('p', { className: 'subtitle' }, [roomCountLabel(rooms.length)])]),
    el('div', { className: 'rooms-list' }, rows),
  );
}

function roomCountLabel(n: number): string {
  return n === 1 ? '1 location' : `${n} locations`;
}

async function mountRooms(): Promise<void> {
  try {
    const { rooms } = await getJson<RoomsListDocument>('/api/rooms');
    renderRoomsList(view!, rooms);
  } catch {
    view!.replaceChildren(el('p', { className: 'empty-state' }, ['Could not load rooms from the server.']));
  }
}

// ---------------------------------------------------------- room detail

function hourCell(bucket: HourBucketDto): HTMLElement {
  const title = bucket.counts.ok + bucket.counts.timeout + bucket.counts.error === 0
    ? `${String(bucket.hour).padStart(2, '0')}:00 — no data`
    : `${String(bucket.hour).padStart(2, '0')}:00 — ${STATUS_TEXT[bucket.status]}. ${bucket.statusReason} `
      + `Median ${ms(bucket.latency.medianMs)}, loss ${pct(bucket.lossRatio)}.`;
  return el('div', { className: 'hour-cell', 'data-status': bucket.status, title });
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag) as SVGElementTagNameMap[K];
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}

const CHART_WIDTH = 1000;
const CHART_HEIGHT = 100;

/** Evenly spaced dBm tick marks from ceiling to floor, with their vertical position as a 0-100% fraction down the plot. */
function signalAxisTicks(): Array<{ dbm: number; percent: number }> {
  const steps = 4;
  const stepDbm = (SIGNAL_CEILING_DBM - SIGNAL_FLOOR_DBM) / steps;
  return Array.from({ length: steps + 1 }, (_, i) => {
    const dbm = SIGNAL_CEILING_DBM - i * stepDbm;
    return { dbm, percent: (i / steps) * 100 };
  });
}

function renderSignalChart(container: HTMLElement, wifiSamples: readonly WifiSampleDto[]): void {
  container.replaceChildren();
  if (wifiSamples.length === 0) {
    container.append(el('p', { className: 'muted' }, ['No Wi-Fi samples recorded for this day.']));
    return;
  }

  const ordered = [...wifiSamples].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  const points = ordered.map((sample, i) => {
    const x = ordered.length === 1 ? CHART_WIDTH / 2 : (i / (ordered.length - 1)) * CHART_WIDTH;
    if (!sample.connected || sample.signalDbm === null || !Number.isFinite(sample.signalDbm)) {
      return { x, y: CHART_HEIGHT, quality: 'none' as const, sample };
    }
    const clamped = Math.min(SIGNAL_CEILING_DBM, Math.max(SIGNAL_FLOOR_DBM, sample.signalDbm));
    const fraction = (clamped - SIGNAL_FLOOR_DBM) / (SIGNAL_CEILING_DBM - SIGNAL_FLOOR_DBM);
    const y = CHART_HEIGHT - fraction * CHART_HEIGHT;
    return { x, y, quality: signalQuality(sample.signalDbm), sample };
  });

  // Line connects consecutive connected readings; a disconnected sample
  // breaks the line rather than dragging it down to the floor.
  let d = '';
  let drawing = false;
  for (const p of points) {
    if (p.quality === 'none') {
      drawing = false;
      continue;
    }
    d += `${drawing ? 'L' : 'M'}${p.x.toFixed(2)},${p.y.toFixed(2)} `;
    drawing = true;
  }

  const svg = svgEl('svg', {
    viewBox: `0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`,
    preserveAspectRatio: 'none',
    class: 'signal-line',
  });
  svg.append(svgEl('path', { class: 'signal-path', d: d.trim() }));

  for (const p of points) {
    const when = new Date(p.sample.at).toLocaleTimeString('en-GB', { timeZone: DISPLAY_TIMEZONE });
    let title: string;
    if (p.quality === 'none') {
      const reason = p.sample.reason !== null ? `: ${p.sample.reason}` : '';
      title = `${when} — not connected${reason}`;
    } else {
      const band = bandOf(p.sample.freqMhz);
      const label = [p.sample.ssid ?? p.sample.bssid, band !== null ? `· ${band}` : null].filter((part) => part !== null).join(' ');
      title = `${when} — ${(p.sample.signalDbm as number).toFixed(0)} dBm${label ? ` · ${label}` : ''}`;
    }
    const circle = svgEl('circle', {
      cx: p.x.toFixed(2),
      cy: p.y.toFixed(2),
      r: '1.6',
      class: 'signal-point',
      'data-quality': p.quality,
    });
    const titleEl = svgEl('title');
    titleEl.textContent = title;
    circle.append(titleEl);
    svg.append(circle);
  }

  const ticks = signalAxisTicks();
  const axis = el('div', { className: 'signal-axis' }, ticks.map((tick) =>
    el('span', { className: 'signal-tick', style: `top:${tick.percent}%` }, [`${tick.dbm} dBm`])));
  const gridlines = el('div', { className: 'signal-gridlines' }, ticks.map((tick) =>
    el('div', { className: 'signal-gridline', style: `top:${tick.percent}%` })));
  const plot = el('div', { className: 'signal-plot' }, [gridlines, svg]);

  container.append(axis, plot);
}

async function renderRoomDetail(container: HTMLElement, location: string): Promise<void> {
  container.replaceChildren(
    el('a', { className: 'back-link', href: '#/rooms' }, ['← All rooms']),
    el('h1', {}, [location]),
  );

  let days: RoomDaysDocument;
  try {
    days = await getJson<RoomDaysDocument>(`/api/rooms/${encodeURIComponent(location)}/days`);
  } catch {
    container.append(el('p', { className: 'empty-state' }, ['Could not load survey days for this room.']));
    return;
  }

  if (days.dates.length === 0) {
    container.append(el('p', { className: 'empty-state' }, ['No survey data for this room yet.']));
    return;
  }

  const select = el('select', { id: 'day-select' }, days.dates.map((date) => el('option', { value: date }, [date])));
  const body = el('div', { id: 'day-body' }, []);

  container.append(
    el('section', { className: 'panel' }, [
      el('div', { className: 'row-controls' }, [el('label', {}, ['Date: ']), select]),
    ]),
    body,
  );

  const loadDay = async (date: string): Promise<void> => {
    body.replaceChildren(el('p', { className: 'muted' }, ['Loading…']));
    try {
      const [hoursDoc, dayDoc] = await Promise.all([
        getJson<RoomHoursDocument>(`/api/rooms/${encodeURIComponent(location)}/hours?date=${date}`),
        getJson<RoomDayDetailDocument>(`/api/rooms/${encodeURIComponent(location)}/day?date=${date}`),
      ]);
      renderDayBody(body, hoursDoc, dayDoc);
    } catch {
      body.replaceChildren(el('p', { className: 'empty-state' }, ['Could not load this day.']));
    }
  };

  select.addEventListener('change', () => { void loadDay(select.value); });
  await loadDay(days.dates[0] ?? '');
}

function renderDayBody(body: HTMLElement, hoursDoc: RoomHoursDocument, dayDoc: RoomDayDetailDocument): void {
  const hourLabels = Array.from({ length: 24 }, (_, hour) =>
    el('span', {}, [hour % 3 === 0 ? String(hour).padStart(2, '0') : '']));

  const points = new Map<string, { ssid: string | null; freqMhz: number | null }>();
  for (const sample of dayDoc.wifiSamples) {
    if (sample.connected && sample.bssid !== null) points.set(sample.bssid, { ssid: sample.ssid, freqMhz: sample.freqMhz });
  }
  const pointChips = [...points.entries()].map(([bssid, info]) => {
    const band = bandOf(info.freqMhz);
    const label = [info.ssid ?? bssid, `(${bssid})`, band !== null ? `· ${band}` : null].filter((part) => part !== null).join(' ');
    return el('span', { className: 'point-chip' }, [label]);
  });

  body.replaceChildren(
    el('section', { className: 'panel' }, [
      el('h2', {}, ['Hour of day (Europe/Amsterdam)']),
      el('div', { className: 'hour-grid' }, hoursDoc.hours.map(hourCell)),
      el('div', { className: 'hour-labels' }, hourLabels),
    ]),
    el('section', { className: 'panel' }, [
      el('h2', {}, ['Wi-Fi signal strength']),
      el('div', { className: 'signal-chart', id: 'signal-chart' }),
      el('p', { className: 'legend' }, [
        el('span', { className: 'key key-good' }), ' good (≥ −60 dBm) ',
        el('span', { className: 'key key-fair' }), ' fair ',
        el('span', { className: 'key key-poor' }), ' poor ',
        el('span', { className: 'key key-none' }), ' disconnected',
      ]),
    ]),
    el('section', { className: 'panel' }, [
      el('h2', {}, ['Day summary']),
      el('dl', { className: 'stats' }, [
        el('div', {}, [el('dt', {}, ['Status']), el('dd', {}, [STATUS_TEXT[dayDoc.summary.status]])]),
        el('div', {}, [el('dt', {}, ['Median']), el('dd', {}, [ms(dayDoc.summary.latency.medianMs)])]),
        el('div', {}, [el('dt', {}, ['p95']), el('dd', {}, [ms(dayDoc.summary.latency.p95Ms)])]),
        el('div', {}, [el('dt', {}, ['No reply']), el('dd', {}, [pct(dayDoc.summary.lossRatio)])]),
        el('div', {}, [el('dt', {}, ['Samples']), el('dd', {}, [String(dayDoc.samples.length)])]),
      ]),
      pointChips.length > 0
        ? el('div', {}, [el('p', { className: 'muted' }, ['Access points seen this day:']), el('div', { className: 'points-seen' }, pointChips)])
        : el('p', { className: 'muted' }, ['No Wi-Fi association data recorded for this day.']),
    ]),
  );

  const signalChart = body.querySelector('#signal-chart');
  if (signalChart instanceof HTMLElement) renderSignalChart(signalChart, dayDoc.wifiSamples);
}

// ------------------------------------------------------------------ router

function setActiveNav(name: string): void {
  for (const a of document.querySelectorAll('[data-nav]')) {
    a.classList.toggle('active', a.getAttribute('data-nav') === name);
  }
}

async function route(): Promise<void> {
  if (backbonePoll !== null) {
    clearInterval(backbonePoll);
    backbonePoll = null;
  }

  const hash = window.location.hash.replace(/^#\/?/, '');
  const [section, ...rest] = hash.split('/');

  if (section === 'rooms' && rest.length > 0 && rest[0] !== undefined) {
    setActiveNav('rooms');
    await renderRoomDetail(view!, decodeURIComponent(rest[0]));
    return;
  }

  if (section === 'rooms') {
    setActiveNav('rooms');
    await mountRooms();
    return;
  }

  setActiveNav('backbone');
  await mountBackbone();
}

window.addEventListener('hashchange', () => { void route(); });
if (window.location.hash === '') window.location.hash = '#/backbone';
void route();
