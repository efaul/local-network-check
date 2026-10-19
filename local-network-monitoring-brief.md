# Local Network Monitoring — Initial Planning Brief

Date: 19 October 2026  
Status: Discussion brief for the planning agent; implementation choices remain open.

## 1. Goal

Build a local-only monitoring application that provides a holistic view of a home network consisting of Ethernet-connected machines, a switch and a Wi-Fi mesh. Endpoint probes running on Macs and Linux machines, including Raspberry Pis, should measure the network experience from different locations. A central server should retain measurements and visualise health, trends and a meaningful network rating.

The user already has internet monitoring. This application must focus exclusively on the local network. Orb is an inspiration for the endpoint-sensor model and understandable health scores; integration with Orb is not a requirement.

## 2. Agreed requirements

- Support macOS and Linux/Raspberry Pi endpoint probes.
- Monitor from endpoints without requiring router, switch or mesh-controller APIs.
- Provide a central server and browser-based visualisation.
- Cover wired and wireless paths and compare results across locations.
- Help reveal intermittent degradation and symptoms associated with Wi-Fi interference.
- Keep monitoring overhead negligible during normal use.
- Operate locally without cloud services, internet measurement targets or external runtime dependencies such as hosted fonts or analytics.
- Provide explainable health ratings backed by raw measurements and history.
- Treat unsupported metrics and missing observations explicitly.

## 3. Scope boundaries

### In the initial scope

- Lightweight local connectivity measurements.
- Passive collection of interface and Wi-Fi statistics where available.
- Local buffering and central ingestion of observations.
- Historical charts, node comparisons and health summaries.
- Configuration of node names, locations, interfaces and local targets.

### Outside routine monitoring

- Internet speed, public DNS or external website checks.
- Automated throughput, saturation or bufferbloat tests.
- Continuous Wi-Fi scans, channel hopping or packet capture.
- Automatic changes to access points, channels, routing or mesh configuration.
- Full mesh-topology discovery or guaranteed identification of an interference source.

Manual capacity tests could be a later feature, explicitly triggered and coordinated. They are not required for the MVP.

## 4. Proposed architecture

| Component | Role |
| --- | --- |
| Endpoint probe | Collect local counters, run small connectivity probes, timestamp and buffer observations, report to the server. |
| Wired reference node | Act as a stable local destination for endpoint measurements. |
| Central server | Ingest reports, register nodes, store history, calculate summaries and ratings, serve the dashboard. |
| Browser dashboard | Present overall health, individual nodes, comparisons, timelines and measurement freshness. |

Initially, one always-on wired Raspberry Pi could host both the reference service and central server. This is a convenience, not a claim that the reference is infallible. Server/reference failure can affect every node's apparent results and must be represented separately.

Prefer endpoint-initiated reporting. The central service should remain reachable over the LAN without each client needing an inbound management interface. Keep the reference probe protocol separate from ingestion latency: a slow database write must not be interpreted as slow network transit.

## 5. Measurements

| Evaluation | Measurement | Notes |
| --- | --- | --- |
| Local responsiveness | Round-trip latency to the wired reference | Retain samples; summarise median and p95. Show p99 only with sufficient samples. |
| Local variability | Jitter/RTT variation | Define the calculation precisely; avoid an unexplained generic jitter number. |
| Local probe loss | Failed or timed-out probes and consecutive failures | Label by protocol; an ICMP timeout alone does not prove all connectivity has failed. |
| Connectivity stability | Degradation episodes, interruptions, recovery time | Distinguish observed path failure from missing telemetry. |
| Wi-Fi reception | RSSI, noise and derived SNR where supported | Missing data must not become zero or reduce the score. |
| Wi-Fi transmission health | Retry/failure counter deltas where supported | Preserve counter semantics; do not invent a retry percentage without a valid denominator. |
| Airtime context | Channel busy fraction where available | Passive driver counters only; does not identify interference sources. |
| Association context | AP/BSSID, band, channel, channel width and link rate where available | Record changes; negotiated link rate is not measured throughput. |
| Interface health | Interface up/down, errors/drops, Ethernet link speed where available | Handle counter resets, interface replacement and sleep/wake. |
| Probe health | CPU/resource usage, scheduling gaps and collection errors | Identify measurements compromised by a busy or suspended endpoint. |

Optional later: queries to a configured local DNS resolver, reported as a separate local-service health measure. No external resolution is needed.

## 6. Low-impact operating model

These are starting proposals to validate on the real hardware, not fixed performance guarantees:

| Activity | Initial proposal |
| --- | --- |
| Connectivity measurement | One small request/response every 5 seconds per endpoint to the reference. |
| Passive interface/Wi-Fi collection | Every 15–30 seconds. |
| Reporting | Small batches every 30–60 seconds. |
| Peer checks | Disabled initially or limited to selected pairs; no automatic all-to-all mesh. |
| Dashboard refresh | Modest interval with bounded queries and downsampled long-range charts. |
| Failure retries | Bounded exponential backoff, with jitter; no retry storms. |

Active probes cannot have literally zero impact. Translate the user's requirement into measurable budgets for CPU, memory, bytes transferred, wakeups and storage writes. Report expected and measured overhead for representative Mac and Pi hardware before accepting the implementation.

- Stagger schedules so nodes do not all transmit at once.
- Bound payload sizes, queues, local spool size and ingestion work.
- Avoid rapid catch-up bursts when connectivity returns.
- Do not keep Macs awake or change their power settings by default.
- Keep routine collection passive except for the small connectivity probes.

## 7. Correctness and cross-platform behaviour

- Bind probes to the configured source interface/address and verify the actual route. A Mac with both Ethernet and Wi-Fi must not silently measure Ethernet as Wi-Fi. Record configuration or routing failures explicitly.
- Use monotonic time for elapsed durations and wall-clock timestamps for historical correlation. Track server receipt time and account for clock skew when comparing nodes.
- Treat every node/interface/path as a distinct measurement identity.
- Distinguish unsupported, permission-denied, collection-failed and temporarily unavailable metrics.
- Detect available collectors at runtime and expose capabilities in the dashboard.
- Prototype macOS Wi-Fi collection and permission behaviour early; do not promise parity with Linux.
- Possible collectors: Linux `iw`/OS counters; macOS CoreWLAN/native APIs and a small native helper if necessary. Verify support on actual target OS versions and adapters.
- Run with minimal required privileges and document any helper permissions.
- Buffer observations across disconnections with original timestamps, bounded retention and duplicate-safe ingestion.
- A missing report means stale/unknown until corroborated. It does not by itself prove a network outage or that a Mac is asleep.
- A 5-second probe interval will miss some brief events; communicate measurement resolution.

## 8. Rating design

The rating should describe local responsiveness and reliability. Capacity remains unmeasured without an explicit capacity test.

- Provide per-node/path scores before an overall network score.
- Base core scores on observed loss, latency/variation and stability.
- Present Wi-Fi diagnostics separately; optional radio data must not make wired and wireless scores incomparable.
- Show an absolute service-quality view alongside change from each node's baseline. A persistently poor baseline must not be normalised into a healthy score.
- Publish score inputs, thresholds, time windows, weights and exclusions.
- Show freshness, sample count and coverage with each score. Insufficient evidence should produce an unknown/low-confidence state.
- Avoid double-counting correlated symptoms such as loss and interruption duration.
- Show the worst node and percentage of observed time degraded alongside any overall score.
- Distinguish measured results, correlation and inferred causes. For example: 'Three Wi-Fi nodes degraded while the wired reference remained responsive' is evidence, not proof of RF interference.

Do not finalise the formula before collecting representative baseline data. Missing telemetry must never silently improve the score.

## 9. Dashboard requirements

- Overview: local network rating, observed coverage, stale nodes and worst-performing location.
- Node cards: location, interface, wired/Wi-Fi status, recent quality and last report.
- Detail view: latency, loss, variation and available radio/interface statistics on aligned timelines.
- Comparison view: wired versus wireless and room versus room over the same time range.
- Events: observed failures, association changes, interface changes and correlated degradation.
- Clear unavailable/unknown states and explanations of score changes.
- Filters by node, location, interface and time range.

A logical location/path view is useful. Do not display an invented physical mesh topology when endpoint observations cannot establish it.

## 10. Implementation options to discuss

Suggested starting point, not a committed stack:

- Shared Go probe with OS-specific collectors; macOS native helper if necessary.
- `systemd` service on Linux and `launchd` job on macOS.
- Small local ingestion/query API and SQLite for an initial small deployment.
- Lightweight browser dashboard served locally by the central component.
- Alternative: a time-series backend and Grafana if they materially reduce overall implementation and maintenance work.

Choose storage based on expected node count, sample rate, retention and dashboard queries. Define raw retention, aggregation and cleanup. The server may be containerised; probes should run on the hosts to access the intended interfaces.

Use local node credentials, reasonable access controls and an explicit LAN transport/trust model. Do not upload network metadata externally. Avoid collecting packet contents.

## 11. Suggested delivery sequence

1. **Feasibility spike:** one Mac and one Wi-Fi Pi against a wired reference. Validate interface selection, permissions, available radio metrics and monitoring overhead.
2. **End-to-end MVP:** lightweight probes, buffering, ingestion, storage and a dashboard with raw metrics and freshness.
3. **Health interpretation:** calibrate per-path baselines, add explainable ratings, degradation episodes and comparisons.
4. **Operational packaging:** installers/service definitions, configuration, retention, restart behaviour and documentation.
5. **Optional extensions:** selected peer paths, local DNS checks and explicitly requested capacity tests.

## 12. Acceptance criteria for the initial build

- A Mac and a Linux/Pi probe both report local measurements to one server.
- The system continues monitoring and displaying history with the internet disconnected.
- Routine operation produces no external measurement traffic or cloud requests.
- Tests use and identify the configured interface correctly on dual-connected machines.
- Dashboard shows latency, observed loss, variation, sample freshness and supported Wi-Fi metrics.
- Disconnecting a probe, sleeping a Mac and stopping the central server do not create falsely certain diagnoses.
- Buffered results preserve measurement times and ingest without duplication after recovery.
- Unsupported metrics are explicitly unavailable and do not penalise health scores.
- Routine operation performs no throughput tests or active Wi-Fi scans.
- Monitoring overhead is measured and meets the budget agreed during planning.
- Scores are explainable and remain visibly unknown when evidence is insufficient.

## 13. Questions for the planning discussion

- How many nodes, rooms and distinct interfaces are initially involved?
- Which Mac architectures/macOS versions, Pi models and Linux distributions need support?
- Which node can stay wired and always on, and what is its hardware capacity?
- Is a single reference adequate initially, or is a second independent local target needed to distinguish reference failure?
- What probe protocol best balances permissions, overhead and meaningful failure detection?
- What numeric performance budgets and detection delay are acceptable?
- What history retention and score windows are useful?
- Is a custom dashboard preferred, or is Grafana acceptable?

## Planning-agent handoff

Use this brief to produce a concrete architecture and phased implementation plan. Preserve local-only operation and negligible routine overhead as primary constraints. Separate confirmed requirements from assumptions. Validate macOS collection, interface binding and reference-node failure handling first. Propose the measurement schema, probe protocol, capability model, retention policy, rating method and measurable acceptance gates before expanding scope.
