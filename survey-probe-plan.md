# Survey-Probe Plan — Context

Date: 19 October 2026
Status: Agreed direction, pending two open decisions (see bottom). Builds on
`local-network-monitoring-brief.md` and the shipped single-node MVP in `src/`.

## Why this plan exists

The original multi-node plan assumed a dedicated always-on Wi-Fi Linux node in
a problem room. The real device inventory is **Macs, mobile phones, and wired
devices only** — no fixed Linux box. That made per-access-point identification
unreliable (macOS BSSID access is inconsistent for a background process) and
left phones unmeasurable (no viable background agent on iOS/Android).

**Resolution:** use a single Raspberry Pi as a **portable survey instrument**
instead of a fixed node. Walk it to each room, dwell, record, move on. Repeat
the walk periodically to build a trend per room. This produces the spatial
"diagram" originally wanted, honestly — as measured spots, not interpolated
coverage between them.

## Resulting architecture

Two devices, not several:

- **Ubuntu server** — always on, wired. Runs the existing single-node app
  (`src/`) as a **continuous backbone reference** (e.g. pinging the primary
  router), and hosts the central database and dashboard.
- **Raspberry Pi** — a **portable survey probe**, carried room to room,
  reporting completed sessions back to the Ubuntu server.

Wired devices remain targets/reference points, not measurement sources.
Mobile phones remain unmeasured directly; a Mac or phone physically present
during a survey is a reasonable proxy, with manual notes as a fallback (see
the "mark a problem now" idea in the original brief).

## Plan sequence

### Plan 1 — Repurpose the existing app as the backbone reference
- Point `target.address` at the real backbone target (primary router, or
  later an ISP-side target).
- Relabel `node` to its real identity (e.g. "Ubuntu server — backbone
  reference").
- Run as a `systemd` service so it survives reboots.
- **Done when:** it runs unattended on the server with real values, not
  placeholder Mac/Wi-Fi config.

### Plan 2 — SQLite persistence
- Swap the in-memory store for SQLite behind the same read interface.
- **Done when:** restarting the service doesn't lose history.
- (Already the agreed "next slice" before this plan existed; needed now so
  both backbone history and survey history accumulate over weeks.)

### Plan 3 — Survey data model + ingestion endpoint
- New tables, distinct from the continuous stream:
  - `survey_sessions`: id, location label, started_at, ended_at, device id.
  - `survey_samples`: session id, timestamp, ping result (reusing the
    existing `ok` / `timeout` / `error` model from `src/result.ts`), BSSID,
    signal, channel.
- One endpoint on the central server to receive a completed session as a
  batch POST from the Pi.
- **Done when:** a hand-crafted test payload posts successfully and is
  aggregated correctly using the existing `summarise()` logic.

### Plan 4 — Pi survey probe
- Reuse `probe.ts` / `scheduler.ts` / `result.ts` unchanged — same ping
  logic, pointed at the Ubuntu server.
- Add a Wi-Fi collector: run `iw dev <iface> link`, parse BSSID / signal /
  channel. (Linux-only; this is the reason a Pi was chosen over a Mac —
  no sudo/permission ambiguity, no multi-OS inconsistency.)
- Add a survey workflow: start a session with a location label, dwell for a
  fixed duration, stop (manually or via timer), then POST the bundled
  session to the Plan 3 endpoint.
- **Done when:** standing in a room and running one command produces a real
  session on the server with real BSSID and signal data.

### Plan 5 — Room view on the dashboard
- A page listing each distinct location label with its most recent survey
  result, using the same ok/degraded/down colour logic already built.
- Each room links to its history (list or sparkline) so repeated walks show
  a trend over time.
- **Done when:** after 2–3 surveys of the same room, you can see whether it
  is improving or degrading.

### Plan 6 — BSSID → point name mapping (optional, small)
- Config file mapping BSSID to a friendly point name (e.g. "Office point").
- Survey sessions get annotated with the resolved point so the room view can
  show which mesh point served that room.
- **Done when:** a session shows a resolved point name, not a raw BSSID.

### Plan 7 — Hardening
- Duplicate-safe ingestion if a POST retries after a network blip.
- Buffer a session locally on the Pi if the server is briefly unreachable
  mid-walk, flush once reachable again.
- Confirm wall-clock vs monotonic timing stays consistent across a session
  that includes a brief Wi-Fi drop during roaming.

**Build order:** 1 → 2 → 3 → 4 → 5, with 6 and 7 as follow-ups once the core
loop is proven.

## What this honestly gives up

- No continuous Wi-Fi coverage — a problem between two surveys is invisible
  except via the server's own continuous backbone check.
- It's the Pi's radio, not the phone's — a reasonable proxy, not identical
  hardware.
- Each survey takes a few minutes of deliberate effort; this is not
  "set and forget."

## Open decisions (block Plan 4 from being fully concrete)

1. **Dwell duration per room** — long enough to catch intermittent issues
   (candidate: 2–5 minutes)?
2. **Survey start/stop mechanism** — manual CLI command per room, or a fixed
   timer you simply let run at each spot?
