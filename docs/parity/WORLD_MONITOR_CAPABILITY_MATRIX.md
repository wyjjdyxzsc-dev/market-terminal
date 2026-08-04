# World Monitor Capability Matrix

Research date: 2026-07-13

## Summary

- Total rows: 12
- Missing: 5
- Partial: 7
- Implemented: 0
- Entitlement-adapter-ready: 0
- Blocked-by-law: 0
- Checkpoint evidence:
  - local smoke suite `21/21` passed on 2026-07-13
  - in-app browser verification passed on `http://localhost:3000`
  - production smoke suite `28/28` passed on 2026-07-13 (checkpoint 1)
  - production smoke suite `29/29` passed on 2026-07-15 (checkpoint 2)
  - map provenance checkpoint source commit `a25e6be` is production verified: `16/16` unit tests, `23/23` local smoke checks, and `29/29` production smoke checks passed on 2026-07-15
  - AI evidence-policy source commit `5a10b79` is production verified on 2026-07-16: `24/24` unit tests, `28/28` local smoke contracts, and `31/31` production smoke contracts passed
  - checkpoint 5 source commit `20c9252` is production verified: `29/29` unit tests, all 28 keyless-available local smoke contracts, `33/33` production contracts, targeted alert probes, and interactive alert checks passed
  - checkpoint 6 source commit `919f1b9` is production verified: `45/45` unit tests, the versioned 10-case offline AI safety evaluation, all 28 keyless-available local contracts, `33/33` deployed contracts, Worker dry-run bundling, targeted authority probes, and desktop/mobile disclosure checks passed
  - checkpoint 7 source commits `febefb3` and `90c191b` are production verified: the final source served all seven `20260730b` assets, passed `33/33`, returned 12 source-linked NEWS cards on normal/forced-fresh probes, and passed browser disclosure checks
  - checkpoint 8 Deep Dive source commits `9370cc3` and `953c0ea` passed `33/33` production contracts; the final source served all seven `20260804b` assets and passed desktop/mobile checks. Neither changes a World Monitor row

## Capability rows

### WM-001 Unified dual-map situational workspace

- Source product/domain: World Monitor
- Feature/workflow: synchronized 3D globe and 2D WebGL map with shared filters and selection
- User outcome: users pivot between globe and flat map views without losing context
- Current-project equivalent: Leaflet map plus globe module, but not synchronized
- Status: partial
- Data sources and authority tier: internal curated layers plus mixed public feeds
- Refresh frequency and latency class: mixed, 30s to 24h
- Geographic and asset-class coverage: global, mixed domains
- UI surfaces and command aliases: `GLOBAL INTEL`, map, globe
- Backend routes/events/jobs: `/api/map/*`
- Security and privacy class: public read
- Deterministic tests: none yet
- Evaluation criteria: linked 2D/3D state, shared filters, deep links, performance budgets
- Provenance links: `https://www.worldmonitor.app/`
- Licensing or trademark notes: clean-room behavior only; no AGPL code reuse
- Final evidence: local and production checkpoint verified `/api/map/events`, `/api/map/flights`, `/api/map/layers`, `/api/map/conflict`, `/api/map/disease`, `/api/map/gpsjam`; weather degrades honestly when upstream rejects; webcams verified live in production

### WM-002 Layer-rich global intelligence map

- Source product/domain: World Monitor
- Feature/workflow: 56 live layers across conflict, trade, aviation, energy, macro, hazards, and cyber
- User outcome: one surface for cross-domain live signals
- Current-project equivalent: map layer system with curated and live overlays
- Status: partial
- Data sources and authority tier: USGS, NASA, GDELT, public flight feeds, curated datasets
- Refresh frequency and latency class: live plus cached
- Geographic and asset-class coverage: global
- UI surfaces and command aliases: `GLOBAL MAP`
- Backend routes/events/jobs: `/api/map/layers`, `/api/map/conflict`, `/api/map/flights`, `/api/map/weather`, `/api/map/webcams-live`
- Security and privacy class: public read
- Deterministic tests: smoke only
- Evaluation criteria: provenance on every feature, live/reference separation, performance
- Provenance links: `https://www.worldmonitor.app/`, `https://www.worldmonitor.app/docs/data-sources`
- Licensing or trademark notes: independent datasets only
- Final evidence: intelligence/news pipeline preserves evidence IDs, source URLs, timestamps, and freshness in production payloads. Checkpoint 3 adds a production-verified versioned map-layer catalog and active-layer disclosure for data class, source, cache/refresh state, and honest snapshot/served time.

### 2026-07-13 checkpoint 2 update

- Current-project sentiment surface: `/api/sentiment/market` and the terminal gauge.
- Data sources and authority tier: benchmark quotes from the project quote pool plus source-attributed public RSS evidence; no unauthenticated social scraping.
- Evidence: deterministic unit tests and local endpoint verification passed. Production deployment of `55e014c` served `app.js?v=20260713b`; `npm run test:prod` passed `29/29` on 2026-07-15. The canonical response was `live` and `deterministic` with five benchmarks, 18 headlines, 13 sources, attributable evidence, and methodology; no production visual browser pass is claimed for this checkpoint.

### 2026-07-15 checkpoint 3 production update

- Current-project map capability: `/api/map/layers` now provides a versioned catalog for all Leaflet layers, while live map API payloads retain their data and add a `provenance` envelope.
- Evidence disclosure: `live`, `curated`, `hybrid`, `computed`, and `model-derived` labels are explicit. Active layer controls safely show a primary source, cache state, refresh target, and a source snapshot or served time without manufacturing upstream timestamps.
- Evidence: map-provenance unit coverage and the local smoke suite passed (`16/16`, `23/23`); source commit `a25e6be` then served `20260715b` and production smoke passed `29/29`. This improves the partial map capability but does not establish full World Monitor parity.

### 2026-07-16 checkpoint 4 production update

- Model-derived risk disclosure: country instability scores and globe/map markers are now withheld when there is no verified country-risk input adapter. Situation summaries require fresh, trusted, source-diverse public evidence and allowed citations; otherwise their posture fields become explicit unknowns.
- Shared contract: Express and Worker use the same AI policy schema (`2026-07-15a`), cache-key version, provider restrictions, evidence metadata, and abstention envelope. Frontend policy notices expose source count, as-of time, verifier type, source links, disclaimer, and withheld status.
- Evidence: local policy fixtures passed as part of `24/24` unit tests, the expanded local contract suite passed `28/28`, and source commit `5a10b79` passed `31/31` production contracts. Deployed instability returned an explicit abstention with zero country markers; the situation brief cited five allowed evidence IDs. Interactive browser verification exercised all seven views with no console warnings/errors; no screenshot artifact is claimed. This does not establish country-dossier, canonical event, corroborated-alert, or World Monitor parity.

### 2026-07-22 checkpoint 5 production update

- Alert authority: model-proposed priority is ignored. A deterministic policy can mark an item high priority only when source-bound headlines contain breaking-event language and meet the configured recency, trusted-source, and source-diversity gates.
- State and UI safety: alert state is policy-schema-versioned, downstream delivery accepts only `eligible` records from `intel.alert-prioritization`, and the browser exposes source links/corroboration counts or a guarded empty state.
- Evidence: eligible, single-source, and non-breaking fixtures passed within `29/29` unit tests; the keyless local smoke suite passed all 28 available contracts; targeted probes found no uncorroborated high-priority items; and the browser alert view had no console warnings/errors. This remains short of World Monitor parity because canonical event identity, independent origin-type classification, and cross-feed deduplication are pending.
- Production evidence: source commit `20c9252` served schema `2026-07-22a`; the deployed suite passed `33/33`, targeted probes found no ineligible high-priority or persisted alerts, and the production browser rendered the guarded alert state with no console warnings/errors. Canonical event identity, independent origin-type classification, and cross-feed deduplication remain pending.

### 2026-07-28 checkpoint 6 production update

- Model-derived situation/current-market output now requires a bounded generator plus an independent different-provider/different-model verifier. The verifier checks claims and evidence IDs against the supplied evidence packet; a rejection or unavailable independent model produces an abstention.
- Safe policy metadata discloses the served generator/verifier identities, token usage or estimates, calls, latency, estimated cost, cost units, and budget result. Opaque routers cannot independently verify high-risk content.
- Evidence passed `45/45` unit tests, the 10-case offline policy evaluation, all 28 keyless-available local API contracts, Worker dry-run bundling, and final `33/33` deployed contracts for source commit `919f1b9`. Production probes confirmed generated situation/current-market paths failed closed when evidence or verification was insufficient, while deterministic authority remained model-free; desktop/mobile disclosure checks had no warnings/errors. The initial `8a8b980` run exposed stale KV policy envelopes and passed `29/33`; schema-isolation commit `4ffe15a` fixed the defect before final verification. The fixtures are not live OSINT-quality evidence, no high-risk live acceptance is claimed, and this checkpoint does not add canonical event identity, origin-type corroboration, country-risk inputs, or World Monitor parity.

### 2026-07-30 checkpoint 7 update

- Verified generation now preserves budget for its mandatory independent verifier, keeps safe failed-attempt telemetry, and reports whether generation, verification, provider availability, or a declared budget caused an abstention.
- Lower-risk Express/Worker output ceilings and per-minute versus daily/quota cooldowns are aligned. These controls also apply to public-news enrichment and situation-room provider health without altering deterministic alert or country-risk authority.
- Core source commit `febefb3` passed targeted fail-closed probes but exposed a one-card NEWS result accepted from 60 inputs. Source commit `90c191b` deployed `2026-07-30b` useful-batch validation and cache isolation, passed `33/33`, returned 12 linked cards on normal/forced-fresh probes, and passed browser disclosure checks. No event authority, country-risk input, canonical correlation, or World Monitor parity is added.

### 2026-08-04 checkpoint 8 update

- The shared source-balanced evidence selector, deterministic Deep Dive dossier, and pooled quote path improve a financial research surface only. They do not add a world-event adapter, canonical incident model, map layer, language, team, or enterprise workflow.
- Source commit `9370cc3` served all seven `20260804a` assets and passed `33/33`; source commit `953c0ea` addressed the production-observed Deep Dive wait, served all seven `20260804b` assets, passed `33/33`, and passed desktop/mobile checks. Every World Monitor row retains its prior status.

### WM-003 Country dossiers and instability scoring

- Source product/domain: World Monitor
- Feature/workflow: country brief with risk score, evidence, and timeline
- User outcome: structured country-level situational awareness
- Current-project equivalent: `/api/intel/instability` and map conflict hotspots
- Status: partial
- Data sources and authority tier: no verified country-risk scoring source is connected; public headlines remain contextual evidence only
- Refresh frequency and latency class: scores withheld until a verified adapter is connected
- Geographic and asset-class coverage: global countries
- UI surfaces and command aliases: Situation Room, map overlays
- Backend routes/events/jobs: `/api/intel/instability`
- Security and privacy class: public read
- Deterministic tests: shared AI-policy fixtures plus local instability smoke contract
- Evaluation criteria: transparent score factors, evidence links, uncertainty display
- Provenance links: `https://www.worldmonitor.app/`
- Licensing or trademark notes: do not imply official intelligence scoring
- Final evidence: checkpoint 4 production verifies an explicit abstention and zero country-score markers without verified inputs in source commit `5a10b79`; a real dossier/scoring model remains pending

### WM-004 Corroborated breaking alerts

- Source product/domain: World Monitor
- Feature/workflow: alerts triggered only when independent origin types corroborate an event
- User outcome: fewer, higher-confidence notifications
- Current-project equivalent: deterministic recency/trust/source-diversity gate over evidence-bound news, followed by push delivery
- Status: missing
- Data sources and authority tier: existing attributable headline evidence; no canonical event or independent origin-type adapter
- Refresh frequency and latency class: hourly warm + live fetches
- Geographic and asset-class coverage: global
- UI surfaces and command aliases: alerts panel, push
- Backend routes/events/jobs: `/api/intel/news`, scheduled cache warmer, push routes
- Security and privacy class: notification workflow
- Deterministic tests: eligible, single-source, non-breaking, state-schema, smoke, and browser checks locally
- Evaluation criteria: origin diversity, dedupe, threshold logic, safe delivery
- Provenance links: `https://www.worldmonitor.app/`
- Licensing or trademark notes: independent implementation only
- Final evidence: source commit `20c9252` production verifies that only policy-eligible, recent, trusted, source-diverse breaking-language evidence can enter the high-priority path. Status remains missing against the target because event identity, origin-type independence, and cross-feed deduplication are not established.

### WM-005 Scenario engine and route explorer

- Source product/domain: World Monitor
- Feature/workflow: disruption scenarios and route-risk comparisons
- User outcome: users model possible downstream effects before they happen
- Current-project equivalent: macro shock simulator only
- Status: partial
- Data sources and authority tier: static pipeline metadata plus live commodity quotes
- Refresh frequency and latency class: 5 minutes
- Geographic and asset-class coverage: energy infrastructure
- UI surfaces and command aliases: Supply Chain, macro shock table
- Backend routes/events/jobs: `/api/macro/shock`
- Security and privacy class: public read
- Deterministic tests: none yet
- Evaluation criteria: explicit assumptions, low/base/high scenarios, confidence labels
- Provenance links: `https://www.worldmonitor.app/`
- Licensing or trademark notes: must not present simplified elasticity model as precise forecast
- Final evidence: pending

### WM-006 Source-attributed daily/world briefs

- Source product/domain: World Monitor
- Feature/workflow: AI briefs with inline sources and timestamps
- User outcome: fast readouts with auditability
- Current-project equivalent: briefing, situation room, report tabs
- Status: partial
- Data sources and authority tier: RSS and mixed public feeds; unauthenticated X syndication was removed
- Refresh frequency and latency class: 15 minutes
- Geographic and asset-class coverage: global
- UI surfaces and command aliases: BRIEFING, SITUATION ROOM, INVESTMENT REPORT
- Backend routes/events/jobs: `/api/intel/news`, `/api/intel/situation`, `/api/intel/report`
- Security and privacy class: public read, AI-generated
- Deterministic tests: smoke only
- Evaluation criteria: evidence IDs, links, freshness, caveats, abstention on uncertainty
- Provenance links: `https://www.worldmonitor.app/`
- Licensing or trademark notes: metadata/snippet only
- Final evidence: pending

### WM-007 Command palette and saved workspaces

- Source product/domain: World Monitor
- Feature/workflow: hundreds of palette actions and multi-lens layout switching
- User outcome: fast navigation across dashboards and contexts
- Current-project equivalent: tab system only
- Status: missing
- Data sources and authority tier: N/A
- Refresh frequency and latency class: immediate UI
- Geographic and asset-class coverage: platform-wide
- UI surfaces and command aliases: none
- Backend routes/events/jobs: none
- Security and privacy class: user workspace state
- Deterministic tests: none
- Evaluation criteria: discoverable actions, persistence, linked contexts
- Provenance links: `https://www.worldmonitor.app/`
- Licensing or trademark notes: original command vocabulary required
- Final evidence: pending

### WM-008 MCP and REST agent platform

- Source product/domain: World Monitor
- Feature/workflow: public REST API, MCP server, SDKs
- User outcome: agent and developer access to live platform data
- Current-project equivalent: none
- Status: missing
- Data sources and authority tier: platform aggregate
- Refresh frequency and latency class: API-dependent
- Geographic and asset-class coverage: platform-wide
- UI surfaces and command aliases: none
- Backend routes/events/jobs: none
- Security and privacy class: API key and entitlement surface
- Deterministic tests: none
- Evaluation criteria: machine-readable capability catalog, scoped access, docs
- Provenance links: `https://www.worldmonitor.app/`
- Licensing or trademark notes: original API and SDK design only
- Final evidence: pending

### WM-009 Market/macro monitor lens

- Source product/domain: World Monitor
- Feature/workflow: finance lens with rates, FX, commodities, ETF flows, central banks
- User outcome: cross-asset macro situational awareness
- Current-project equivalent: terminal quotes, sectors, market news
- Status: partial
- Data sources and authority tier: Finnhub and public feeds
- Refresh frequency and latency class: seconds to minutes
- Geographic and asset-class coverage: limited relative to target
- UI surfaces and command aliases: TERMINAL, SECTORS, GLOBAL INTEL
- Backend routes/events/jobs: quote/chart/intel routes
- Security and privacy class: public read
- Deterministic tests: smoke only
- Evaluation criteria: breadth, provenance, macro calendar, lens switching
- Provenance links: `https://www.worldmonitor.app/`
- Licensing or trademark notes: clean-room only
- Final evidence: pending

### WM-010 Infrastructure and connectivity layers

- Source product/domain: World Monitor
- Feature/workflow: datacenters, subsea cables, pipelines, landing stations, outages
- User outcome: connect physical and digital infrastructure risk
- Current-project equivalent: curated infrastructure layers
- Status: partial
- Data sources and authority tier: curated reference plus public augmentation
- Refresh frequency and latency class: mostly 24h
- Geographic and asset-class coverage: global but uneven
- UI surfaces and command aliases: GLOBAL MAP, Supply Chain
- Backend routes/events/jobs: `/api/map/layers`, `/api/map/infrastructure`
- Security and privacy class: public read
- Deterministic tests: smoke only
- Evaluation criteria: provenance, status freshness, outage overlays, cascade analysis
- Provenance links: `https://www.worldmonitor.app/`, `https://www.worldmonitor.app/docs/data-sources`
- Licensing or trademark notes: original datasets and attribution required
- Final evidence: pending

### WM-011 Multilingual and RTL support

- Source product/domain: World Monitor
- Feature/workflow: 24 interface languages with RTL
- User outcome: localized research and map use
- Current-project equivalent: none
- Status: missing
- Data sources and authority tier: N/A
- Refresh frequency and latency class: UI
- Geographic and asset-class coverage: platform-wide
- UI surfaces and command aliases: all
- Backend routes/events/jobs: translation-aware queries would be needed
- Security and privacy class: user preference state
- Deterministic tests: none
- Evaluation criteria: locale switching, translated UI, RTL rendering
- Provenance links: `https://www.worldmonitor.app/`
- Licensing or trademark notes: original translations only
- Final evidence: pending

### WM-012 Private/team and enterprise deployment controls

- Source product/domain: World Monitor
- Feature/workflow: SSO, MFA, RBAC, team workspaces, on-prem or air-gapped deployment
- User outcome: operational use in organizations
- Current-project equivalent: none
- Status: missing
- Data sources and authority tier: N/A
- Refresh frequency and latency class: platform-wide
- Geographic and asset-class coverage: platform-wide
- UI surfaces and command aliases: none
- Backend routes/events/jobs: auth, org, audit services needed
- Security and privacy class: authenticated multi-tenant
- Deterministic tests: none
- Evaluation criteria: auth flows, RBAC, audit logs, deployment options
- Provenance links: `https://www.worldmonitor.app/`
- Licensing or trademark notes: original enterprise workflow design only
- Final evidence: pending
