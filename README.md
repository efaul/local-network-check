# local-net-check

A local-only network monitor with two roles:

- **Central server** — runs on an always-on wired machine. Continuously
  pings a reference target (the "backbone"), persists history in SQLite, and
  serves the dashboard and an ingestion API.
- **Survey probe** — a portable CLI, meant for a Raspberry Pi, carried room
  to room. Pings the central server, samples Wi-Fi association (`iw`), and
  forwards everything it collects. Leave it in a room for a day, move it,
  repeat.

The dashboard turns a day of survey data per room into an **hour-of-day
heatmap**, so intermittent problems (e.g. evening congestion) are visible
even when the whole day's rollup would otherwise read "fine."

See `local-network-monitoring-brief.md` and `survey-probe-plan.md` for the
full background and design rationale.

## Requirements

- Node.js 24 LTS (runs TypeScript directly via built-in type stripping; uses
  the built-in `node:sqlite` module, which reaches Release Candidate
  stability on this line — no more `ExperimentalWarning` at startup).
  `.nvmrc` and `.tool-versions` pin this for `nvm`/`fnm`/`mise`/`asdf`.
- A `ping` binary (standard on macOS and Linux)
- On the survey probe only: Linux with `iw` (standard on Raspberry Pi OS,
  Ubuntu, etc.) — this is why the probe is Linux, not macOS: `iw` exposes
  BSSID/signal without the permission ambiguity of modern macOS tools.
- No runtime dependencies. `typescript` and `@types/node` are dev-only.

## Running the central server

```bash
npm install
npm run server   # or: node src/server/index.ts
```

Configure it in `config/server.json`:

```json
{
  "node": { "id": "backbone-1", "name": "Ubuntu server", "location": "Backbone" },
  "target": { "address": "192.168.86.1", "label": "Primary router" },
  "probe": { "intervalMs": 5000, "timeoutMs": 1000 },
  "window": { "minutes": 15 },
  "server": { "host": "0.0.0.0", "port": 8787 },
  "db": { "path": "./data/central.sqlite" }
}
```

`probe.timeoutMs` must be smaller than `probe.intervalMs`. The dashboard is
at `http://<host>:<port>/`, with `#/backbone` (the continuous reference) and
`#/rooms` (the survey heatmap) as the two views.

Run as a `systemd` service for unattended operation; it survives restarts
since history is in SQLite, not memory.

## Running a survey probe

Copy `src/shared/`, `src/probe/`, and `config/probe.json` to the Pi (or run
the whole repo there — either works).

```bash
node src/probe/index.ts "Kitchen" --server http://<server-host>:8787
```

Leave it running for the day. `Ctrl-C` flushes any buffered data and stops
it cleanly before you move to the next room. All options:

```bash
node src/probe/index.ts <location> \
  [--server <url>] [--device-id <id>] \
  [--interval <ms>] [--timeout <ms>] \
  [--iface <name>] [--wifi-interval <ms>] \
  [--config <path-to-probe.json>]
```

Defaults come from `config/probe.json`; CLI flags override them.

## What a result means

Every ping is exactly one of three states — the distinction is enforced in
the type system and in tests, not just by convention:

| State | Meaning |
| --- | --- |
| `ok` | A reply arrived. Only these carry a round-trip time. |
| `timeout` | The probe ran and nothing came back — real network evidence. |
| `error` | The probe could not run at all — **not** evidence about the network. |

Consequences: latency statistics use `ok` results only; the loss ratio
counts `timeout` against `ok + timeout` and excludes `error`, so a broken
probe can never masquerade as packet loss. `ping` exit codes differ by
platform (macOS: 2 = no reply, Linux: 1 = no reply) — handled explicitly,
confirmed against both real binaries.

## Status values

**Live** (the backbone's own `/api/state`): `ok`, `degraded` (>5% loss in
the window), `down` (last probe got no reply), `error` (last probe couldn't
run), or `unknown` (no data yet, or stale — older than 3 probe intervals).

**Historical** (a room's hour/day buckets): the same `ok`/`degraded`/`down`
statuses, but computed without caring about staleness — a bucket from last
month is just as meaningful as one from today. Fully lost periods are
`down`; partial loss is `degraded`; nothing recorded is `unknown`.

## Data model

One SQLite database, two tables:

- `samples` — every ping result from every device, tagged with `device_id`
  and `location`. The backbone writes here continuously; survey probes
  write here too. `(device_id, at)` is unique, so a retried ingest POST
  after a dropped response is a safe no-op, not a duplicate.
- `wifi_samples` — the parallel Wi-Fi association readings from survey
  probes, same dedupe guarantee.

The backbone's own location is just another row in the rooms list — it
happens to update continuously, where survey rooms are historical snapshots
of whichever day they were last visited.

## API

- `GET /api/state` — the backbone's live status.
- `POST /api/ingest` — survey probes post `{ deviceId, location, samples,
  wifiSamples }` here. Rejects a malformed batch outright (400) rather than
  partially applying it.
- `GET /api/rooms` — one row per surveyed location.
- `GET /api/rooms/:location/days` — every calendar day with data.
- `GET /api/rooms/:location/hours?date=YYYY-MM-DD` — the 24-bucket heatmap row.
- `GET /api/rooms/:location/day?date=YYYY-MM-DD` — full timeline, Wi-Fi
  context, and a day-level summary.

## Structure

```
src/shared/   result, pingProbe, scheduler, summary — used by both roles
src/server/   config, db, ingest, aggregate, httpServer, backboneRunner, index
src/probe/    config, wifiProbe, forwarder, index
src/web/      app.ts, compiled to public/app.js (npm run build)
config/       server.json, probe.json
```

## Develop

```bash
npm test          # type check, then all unit tests
npm run typecheck
npm run test:unit
npm run build      # recompile the browser dashboard script
```

## Known limitations (by design, for this slice)

- The survey probe buffers in memory only — a hard crash mid-day loses
  whatever hasn't been flushed yet. Acceptable since a survey session is one
  long-running foreground process, not something restarted mid-day.
- Hour buckets are UTC, not local time.
- No authentication on `/api/ingest` or the dashboard — LAN-only MVP.
- The heatmap shows the Pi's radio experience, not the phone's — a
  reasonable proxy, not identical hardware.
