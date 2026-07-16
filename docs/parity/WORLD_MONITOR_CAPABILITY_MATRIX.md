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
  - AI evidence-policy checkpoint is local verified on 2026-07-16: `24/24` unit tests and `28/28` local smoke contracts passed; production verification is pending

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

### 2026-07-16 checkpoint 4 local update

- Model-derived risk disclosure: country instability scores and globe/map markers are now withheld when there is no verified country-risk input adapter. Situation summaries require fresh, trusted, source-diverse public evidence and allowed citations; otherwise their posture fields become explicit unknowns.
- Shared contract: Express and Worker use the same AI policy schema (`2026-07-15a`), cache-key version, provider restrictions, evidence metadata, and abstention envelope. Frontend policy notices expose source count, as-of time, verifier type, source links, disclaimer, and withheld status.
- Evidence: local policy fixtures passed as part of `24/24` unit tests and the expanded local contract suite passed `28/28`. This does not establish country-dossier, canonical event, corroborated-alert, or World Monitor parity; production verification is pending.

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
- Final evidence: checkpoint 4 locally verifies an explicit abstention and zero country-score markers without verified inputs; production verification and a real dossier/scoring model remain pending

### WM-004 Corroborated breaking alerts

- Source product/domain: World Monitor
- Feature/workflow: alerts triggered only when independent origin types corroborate an event
- User outcome: fewer, higher-confidence notifications
- Current-project equivalent: breaking alert detection and push
- Status: missing
- Data sources and authority tier: headline feed only at baseline
- Refresh frequency and latency class: hourly warm + live fetches
- Geographic and asset-class coverage: global
- UI surfaces and command aliases: alerts panel, push
- Backend routes/events/jobs: `/api/intel/news`, scheduled cache warmer, push routes
- Security and privacy class: notification workflow
- Deterministic tests: none yet
- Evaluation criteria: origin diversity, dedupe, threshold logic, safe delivery
- Provenance links: `https://www.worldmonitor.app/`
- Licensing or trademark notes: independent implementation only
- Final evidence: pending

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
- Data sources and authority tier: RSS, X syndication, mixed public feeds
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
