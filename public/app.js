/**
 * Dashboard: backbone live view, room heatmap overview, and per-room detail
 * with a date picker. Hash-routed, no framework. Compiled to public/app.js.
 */
const STATUS_TEXT = {
    ok: 'OK',
    degraded: 'Degraded',
    down: 'No reply',
    error: 'Probe error',
    unknown: 'Unknown',
};
const view = document.getElementById('view');
if (view === null)
    throw new Error('missing #view element');
function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
        if (key === 'className')
            node.className = value;
        else if (key.startsWith('data-'))
            node.setAttribute(key, value);
        else if (key === 'href')
            node.setAttribute('href', value);
        else if (key === 'title')
            node.title = value;
        else
            node.setAttribute(key, value);
    }
    for (const child of children)
        node.append(child);
    return node;
}
const ms = (value) => value !== null && Number.isFinite(value) ? `${value.toFixed(1)} ms` : '—';
const pct = (value) => (value === null ? '—' : `${(value * 100).toFixed(1)}%`);
function age(ageMs) {
    if (ageMs === null || !Number.isFinite(ageMs))
        return '—';
    const seconds = Math.max(0, Math.round(ageMs / 1000));
    if (seconds < 60)
        return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60)
        return `${minutes}m ${seconds % 60}s ago`;
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m ago`;
}
function timeAgoFromIso(iso) {
    if (iso === null)
        return 'never';
    return age(Date.now() - Date.parse(iso));
}
async function getJson(path) {
    const response = await fetch(path, { cache: 'no-store' });
    if (!response.ok)
        throw new Error(`${path}: HTTP ${response.status}`);
    return (await response.json());
}
// ---------------------------------------------------------------- backbone
let backbonePoll = null;
function renderBackboneChart(container, recent) {
    container.replaceChildren();
    if (recent.length === 0) {
        container.append(el('p', { className: 'muted' }, ['No measurements yet.']));
        return;
    }
    const rtts = recent.map((r) => r.rttMs).filter((v) => v !== null && Number.isFinite(v));
    const peak = rtts.length > 0 ? Math.max(...rtts) : 1;
    for (const result of recent) {
        const height = result.rttMs !== null ? Math.max(6, Math.round((result.rttMs / peak) * 100)) : 100;
        const when = new Date(result.at).toLocaleTimeString();
        const title = result.rttMs !== null
            ? `${when} — ${result.rttMs.toFixed(1)} ms`
            : `${when} — ${result.state}${result.reason !== null ? `: ${result.reason}` : ''}`;
        const bar = el('div', { className: 'bar', 'data-state': result.state, title, style: `height:${height}%` });
        container.append(bar);
    }
}
function renderBackbone(container, state) {
    container.replaceChildren(el('div', {}, [
        el('h1', {}, [state.node.name]),
        el('p', { className: 'subtitle' }, [state.node.location]),
    ]), el('section', { className: 'status', 'data-status': state.status }, [
        el('div', { className: 'status-row' }, [
            el('span', { className: 'badge' }, [STATUS_TEXT[state.status]]),
            el('span', { className: 'status-reason' }, [state.statusReason]),
        ]),
        el('dl', { className: 'status-facts' }, [
            el('div', {}, [el('dt', {}, ['Target']), el('dd', {}, [`${state.target.label} (${state.target.address})`])]),
            el('div', {}, [el('dt', {}, ['Last round trip']), el('dd', {}, [state.last && state.last.state === 'ok' ? ms(state.last.rttMs) : state.last ? `— (${state.last.state})` : '—'])]),
            el('div', {}, [el('dt', {}, ['Last check']), el('dd', {}, [state.last ? age(state.last.ageMs) : 'never'])]),
        ]),
    ]), el('section', { className: 'panel' }, [
        el('h2', {}, ['Recent checks']),
        el('div', { className: 'chart', id: 'backbone-chart' }),
        el('p', { className: 'legend' }, [
            el('span', { className: 'key key-ok' }), ' reply ',
            el('span', { className: 'key key-timeout' }), ' no reply ',
            el('span', { className: 'key key-error' }), ' probe error',
        ]),
    ]), el('section', { className: 'panel' }, [
        el('h2', {}, [`Window · last ${state.window.minutes} min`]),
        el('dl', { className: 'stats' }, [
            el('div', {}, [el('dt', {}, ['Median']), el('dd', {}, [ms(state.window.latency.medianMs)])]),
            el('div', {}, [el('dt', {}, ['p95']), el('dd', {}, [ms(state.window.latency.p95Ms)])]),
            el('div', {}, [el('dt', {}, ['No reply']), el('dd', {}, [pct(state.window.lossRatio)])]),
            el('div', {}, [el('dt', {}, ['Replies']), el('dd', {}, [String(state.window.counts.ok)])]),
            el('div', {}, [el('dt', {}, ['Timeouts']), el('dd', {}, [String(state.window.counts.timeout)])]),
            el('div', {}, [el('dt', {}, ['Errors']), el('dd', {}, [String(state.window.counts.error)])]),
        ]),
    ]));
    const chart = container.querySelector('#backbone-chart');
    if (chart instanceof HTMLElement)
        renderBackboneChart(chart, state.recent);
}
async function mountBackbone() {
    if (backbonePoll !== null)
        clearInterval(backbonePoll);
    const poll = async () => {
        try {
            renderBackbone(view, await getJson('/api/state'));
        }
        catch {
            view.replaceChildren(el('p', { className: 'empty-state' }, ['The backbone node is not responding.']));
        }
    };
    await poll();
    backbonePoll = setInterval(() => { void poll(); }, 2000);
}
// -------------------------------------------------------------------- rooms
function roomLink(location) {
    return `#/rooms/${encodeURIComponent(location)}`;
}
function renderRoomsList(container, rooms) {
    if (rooms.length === 0) {
        container.replaceChildren(el('h1', {}, ['Rooms']), el('p', { className: 'empty-state' }, ['No rooms surveyed yet. Run the probe in a room to see it here.']));
        return;
    }
    const rows = rooms.map((room) => el('a', { className: 'room-row', 'data-status': room.status, href: roomLink(room.location) }, [
        el('div', {}, [
            el('div', { className: 'room-name' }, [room.location]),
            el('div', { className: 'room-meta' }, [
                room.isBackbone ? 'Continuous backbone reference' : `Last surveyed: ${timeAgoFromIso(room.lastSeenAt)}`,
            ]),
        ]),
        el('span', { className: 'badge' }, [STATUS_TEXT[room.status]]),
    ]));
    container.replaceChildren(el('div', {}, [el('h1', {}, ['Rooms']), el('p', { className: 'subtitle' }, [roomCountLabel(rooms.length)])]), el('div', { className: 'rooms-list' }, rows));
}
function roomCountLabel(n) {
    return n === 1 ? '1 location' : `${n} locations`;
}
async function mountRooms() {
    try {
        const { rooms } = await getJson('/api/rooms');
        renderRoomsList(view, rooms);
    }
    catch {
        view.replaceChildren(el('p', { className: 'empty-state' }, ['Could not load rooms from the server.']));
    }
}
// ---------------------------------------------------------- room detail
function hourCell(bucket) {
    const title = bucket.counts.ok + bucket.counts.timeout + bucket.counts.error === 0
        ? `${String(bucket.hour).padStart(2, '0')}:00 — no data`
        : `${String(bucket.hour).padStart(2, '0')}:00 — ${STATUS_TEXT[bucket.status]}. ${bucket.statusReason} `
            + `Median ${ms(bucket.latency.medianMs)}, loss ${pct(bucket.lossRatio)}.`;
    return el('div', { className: 'hour-cell', 'data-status': bucket.status, title });
}
async function renderRoomDetail(container, location) {
    container.replaceChildren(el('a', { className: 'back-link', href: '#/rooms' }, ['← All rooms']), el('h1', {}, [location]));
    let days;
    try {
        days = await getJson(`/api/rooms/${encodeURIComponent(location)}/days`);
    }
    catch {
        container.append(el('p', { className: 'empty-state' }, ['Could not load survey days for this room.']));
        return;
    }
    if (days.dates.length === 0) {
        container.append(el('p', { className: 'empty-state' }, ['No survey data for this room yet.']));
        return;
    }
    const select = el('select', { id: 'day-select' }, days.dates.map((date) => el('option', { value: date }, [date])));
    const body = el('div', { id: 'day-body' }, []);
    container.append(el('section', { className: 'panel' }, [
        el('div', { className: 'row-controls' }, [el('label', {}, ['Date: ']), select]),
    ]), body);
    const loadDay = async (date) => {
        body.replaceChildren(el('p', { className: 'muted' }, ['Loading…']));
        try {
            const [hoursDoc, dayDoc] = await Promise.all([
                getJson(`/api/rooms/${encodeURIComponent(location)}/hours?date=${date}`),
                getJson(`/api/rooms/${encodeURIComponent(location)}/day?date=${date}`),
            ]);
            renderDayBody(body, hoursDoc, dayDoc);
        }
        catch {
            body.replaceChildren(el('p', { className: 'empty-state' }, ['Could not load this day.']));
        }
    };
    select.addEventListener('change', () => { void loadDay(select.value); });
    await loadDay(days.dates[0] ?? '');
}
function renderDayBody(body, hoursDoc, dayDoc) {
    const hourLabels = Array.from({ length: 24 }, (_, hour) => el('span', {}, [hour % 3 === 0 ? String(hour).padStart(2, '0') : '']));
    const points = new Map();
    for (const sample of dayDoc.wifiSamples) {
        if (sample.connected && sample.bssid !== null)
            points.set(sample.bssid, sample.ssid);
    }
    const pointChips = [...points.entries()].map(([bssid, ssid]) => el('span', { className: 'point-chip' }, [ssid !== null ? `${ssid} (${bssid})` : bssid]));
    body.replaceChildren(el('section', { className: 'panel' }, [
        el('h2', {}, ['Hour of day (UTC)']),
        el('div', { className: 'hour-grid' }, hoursDoc.hours.map(hourCell)),
        el('div', { className: 'hour-labels' }, hourLabels),
    ]), el('section', { className: 'panel' }, [
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
    ]));
}
// ------------------------------------------------------------------ router
function setActiveNav(name) {
    for (const a of document.querySelectorAll('[data-nav]')) {
        a.classList.toggle('active', a.getAttribute('data-nav') === name);
    }
}
async function route() {
    if (backbonePoll !== null) {
        clearInterval(backbonePoll);
        backbonePoll = null;
    }
    const hash = window.location.hash.replace(/^#\/?/, '');
    const [section, ...rest] = hash.split('/');
    if (section === 'rooms' && rest.length > 0 && rest[0] !== undefined) {
        setActiveNav('rooms');
        await renderRoomDetail(view, decodeURIComponent(rest[0]));
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
if (window.location.hash === '')
    window.location.hash = '#/backbone';
void route();
export {};
