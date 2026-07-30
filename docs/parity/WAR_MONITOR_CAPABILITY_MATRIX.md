# War Monitor Capability Matrix

Research date: 2026-07-13

## Summary

- Total rows: 9
- Missing: 3
- Partial: 6
- Implemented: 0
- Entitlement-adapter-ready: 0
- Blocked-by-law: 0
- Checkpoint evidence:
  - local smoke suite `21/21` passed on 2026-07-13
  - production smoke suite `28/28` passed on 2026-07-13 (checkpoint 1)
  - production smoke suite `29/29` passed on 2026-07-15 (checkpoint 2)
  - map provenance checkpoint source commit `a25e6be` is production verified: `16/16` unit tests, `23/23` local smoke checks, and `29/29` production smoke checks passed on 2026-07-15
  - AI evidence-policy source commit `5a10b79` is production verified on 2026-07-16: `24/24` unit tests, `28/28` local smoke contracts, and `31/31` production smoke contracts passed
  - checkpoint 5 source commit `20c9252` is production verified: `29/29` unit tests, all 28 keyless-available local smoke contracts, `33/33` production contracts, targeted alert probes, and interactive alert checks passed
  - checkpoint 6 source commit `919f1b9` is production verified: `45/45` unit tests, the versioned 10-case offline AI safety evaluation, all 28 keyless-available local contracts, `33/33` deployed contracts, Worker dry-run bundling, targeted authority probes, and desktop/mobile disclosure checks passed
  - checkpoint 7 candidate is locally verified: `50/50` unit tests, all offline AI thresholds, `31/31` available contracts, Worker dry-run bundling, targeted provider/evidence probes, and browser disclosure checks passed; production verification is pending

## Capability rows

### WAR-001 Live threat map

- Source product/domain: War Monitor
- Feature/workflow: interactive real-time conflict map or globe
- User outcome: see conflict events geographically as they unfold
- Current-project equivalent: Global map with conflict layer
- Status: partial
- Data sources and authority tier: GDELT, ACLED public endpoint, curated datasets
- Refresh frequency and latency class: 15 minutes to near-real-time depending on feed
- Geographic and asset-class coverage: global conflict-related
- UI surfaces and command aliases: GLOBAL MAP
- Backend routes/events/jobs: `/api/map/conflict`, `/api/map/events`, `/api/map/layers`
- Security and privacy class: public read
- Deterministic tests: smoke only
- Evaluation criteria: global coverage, conflict-centric filtering, provenance
- Provenance links: `https://war-monitor.com/`, `https://war-monitor.com/dashboard`
- Licensing or trademark notes: original UI and taxonomy only
- Final evidence: local and production checkpoint verified conflict/map event endpoints and structured JSON contract behavior. Checkpoint 3 adds a production-verified explicit `conflictZones` provenance envelope and active-layer source/cache disclosure.

### WAR-002 AI event classification and severity scoring

- Source product/domain: War Monitor
- Feature/workflow: classify events into war, terrorism, cyber, protest, disaster, diplomacy, economic and score severity
- User outcome: understand what kind of event is happening and how serious it is
- Current-project equivalent: AI-synthesized briefing and situation room, but not event-grade canonical classification
- Status: partial
- Data sources and authority tier: public feeds plus AI synthesis
- Refresh frequency and latency class: 15 minutes
- Geographic and asset-class coverage: global
- UI surfaces and command aliases: BRIEFING, SITUATION ROOM
- Backend routes/events/jobs: `/api/intel/news`, `/api/intel/situation`
- Security and privacy class: public read, AI-generated
- Deterministic tests: shared AI-policy fixtures plus local situation/instability smoke contracts
- Evaluation criteria: transparent categories, severity rules, evidence links
- Provenance links: `https://war-monitor.com/`
- Licensing or trademark notes: independent category system allowed
- Final evidence: RSS ingestion preserves source URLs and reliability labels; unauthenticated X syndication was removed from the live ingestion path. Source commit `5a10b79` production verifies cited-or-abstain situation behavior and empty country-risk output without verified inputs; broader OSINT-source expansion remains open.

### 2026-07-13 checkpoint 2 update

- Source-reliability control: market sentiment now uses attributable benchmark and RSS inputs rather than a social-feed scrape.
- Evidence: deterministic unit tests and local smoke verification passed. Production deployment of `55e014c` served `app.js?v=20260713b`; `npm run test:prod` passed `29/29` on 2026-07-15. The canonical endpoint returned attributable evidence and methodology with `status: "live"` and `dataMode: "deterministic"`; the compatibility alias carried deprecation and successor headers.

### 2026-07-15 checkpoint 3 production update

- Conflict-map disclosure: the independent map now identifies conflict zones as a hybrid of project-curated context and public GDELT/ACLED inputs. The panel distinguishes that evidence class from a live authoritative feed and shows cache/refresh state.
- Evidence: `/api/map/conflict` locally and in production returned its `conflictZones` provenance envelope; map-provenance unit coverage and the complete local smoke suite passed (`16/16`, `23/23`), then production smoke passed `29/29` for source commit `a25e6be`. This remains a partial, non-authoritative conflict-monitor capability.

### 2026-07-16 checkpoint 4 production update

- Situation-room control: public-news synthesis now requires fresh, source-diverse trusted evidence, allowed evidence IDs, and a policy-approved heavy provider. If any gate fails, the route returns an explicit abstention with no fabricated DEFCON posture or serious pizza-index inference.
- Country-risk control: `/api/intel/instability` now emits no country scores or map markers until a verified country-risk adapter exists; the UI says the risk layer is withheld instead of presenting headline-generated scores as intelligence.
- Evidence: AI-policy fixtures and route contracts passed locally (`24/24` unit, `28/28` smoke), then source commit `5a10b79` passed `31/31` production contracts. Deployed situation output was grounded with five allowed citations, while country risk correctly returned no unverified scores. Interactive browser verification switched all seven views and reported no console warnings/errors; no screenshot artifact is claimed. This does not add event-grade classification, official threat posture, conflict timelines, or War Monitor parity.

### 2026-07-22 checkpoint 5 production update

- Alert authority: model-generated `priority: high` is ignored. A report is alert-eligible only when breaking language appears in bound source headlines and a deterministic gate finds two distinct source domains, one trusted source, and evidence no older than 180 minutes.
- State isolation: the Worker persists alerts under the AI-policy schema version, preventing earlier model-prioritized state from appearing as newly compliant. Alert cards preserve evidence links and disclose corroborating-source count.
- Evidence: alert fixtures cover eligible, single-source, and non-breaking cases within a `29/29` unit pass. The keyless local smoke suite passed all 28 available contracts, targeted probes found zero uncorroborated high-priority items/alerts, and the browser rendered the guarded empty-alert state without console warnings/errors.
- Production evidence: source commit `20c9252` served schema `2026-07-22a`; the deployed suite passed `33/33`, targeted probes found no ineligible high-priority or persisted alerts, and the production browser rendered the guarded alert state with no console warnings/errors.
- Scope: this is a notification-safety control, not event-grade classification, conflict-thread correlation, severity scoring, official confirmation, or War Monitor parity.

### 2026-07-28 checkpoint 6 production update

- Any generated high-risk situation analysis must now survive a second claim/evidence check by a different provider and canonical model family. Missing independence, verifier rejection, invalid citations, or exhausted call/token/cost/latency budgets yields a structured abstention.
- Provider and model lifecycle is centralized, actual served identities and usage are disclosed safely, and variable broker routers are barred from the independent-verifier role.
- Evidence passed `45/45` unit tests, the versioned 10-case offline policy evaluation, all 28 keyless-available local API contracts, Worker dry-run bundling, and final `33/33` deployed contracts for source commit `919f1b9`. Production situation/current-market probes failed closed when evidence or verification was insufficient; no generated high-risk response was accepted. Desktop/mobile disclosure checks had no warnings/errors. The initial `8a8b980` run exposed stale KV policy envelopes and passed `29/33`; schema-isolation commit `4ffe15a` fixed the defect before final verification. This is a production-verified model-output guardrail, not official intelligence confirmation, event-grade classification, conflict correlation, severity scoring, or War Monitor parity.

### 2026-07-30 checkpoint 7 local update

- High-risk generation reserves an independent verifier before spending on retries and retains bounded attempt/failure telemetry. Situation and current-market abstentions can now distinguish unavailable providers, invalid generation, verifier rejection/unavailability, and budget exhaustion.
- Lower-risk news-enrichment output limits and provider cooldown classes are aligned across runtimes. The deterministic alert authority and withheld country-risk posture are unchanged.
- Local evidence passed `50/50` unit tests, all offline AI thresholds, `31/31` available contracts, Worker dry-run bundling, targeted probes, and browser disclosure checks. Production verification is pending. This does not add official confirmation, canonical conflict threads, severity scoring, or War Monitor parity.

### WAR-003 Conflict threads and timelines

- Source product/domain: War Monitor
- Feature/workflow: related events grouped into ongoing conflict narratives
- User outcome: follow how a situation evolves over time
- Current-project equivalent: none
- Status: missing
- Data sources and authority tier: event clusters from public feeds
- Refresh frequency and latency class: near-real-time
- Geographic and asset-class coverage: global conflict zones
- UI surfaces and command aliases: none
- Backend routes/events/jobs: none yet
- Security and privacy class: public read
- Deterministic tests: none
- Evaluation criteria: dedupe, event clustering, timeline updates
- Provenance links: `https://war-monitor.com/`
- Licensing or trademark notes: clean-room clustering logic only
- Final evidence: local browser verification showed responsive terminal rendering and degraded-state handling; dedicated mobile conflict workflow verification remains open

### WAR-004 Thread notifications

- Source product/domain: War Monitor
- Feature/workflow: watch a thread and set severity thresholds for alerts
- User outcome: receive focused notifications instead of all alerts
- Current-project equivalent: breaking-news push alerts without thread semantics
- Status: partial
- Data sources and authority tier: push plus news detection
- Refresh frequency and latency class: live to scheduled
- Geographic and asset-class coverage: global
- UI surfaces and command aliases: ALERTS
- Backend routes/events/jobs: push routes, alert detection
- Security and privacy class: notification workflow
- Deterministic tests: none yet
- Evaluation criteria: thread following, severity thresholds, dedupe, auth
- Provenance links: `https://war-monitor.com/`
- Licensing or trademark notes: original alert workflow only
- Final evidence: source commit `20c9252` production verifies deterministic recency/trust/source-diversity eligibility, schema-versioned state, and safe empty alert rendering; thread semantics, severity thresholds, and authentication remain pending

### WAR-005 Voice intelligence briefing

- Source product/domain: War Monitor
- Feature/workflow: voice questions and briefings
- User outcome: hands-free intelligence access
- Current-project equivalent: text chat only
- Status: missing
- Data sources and authority tier: same as AI assistant
- Refresh frequency and latency class: interactive
- Geographic and asset-class coverage: global
- UI surfaces and command aliases: AI chat candidate extension
- Backend routes/events/jobs: chat only at baseline
- Security and privacy class: user interaction, possible microphone permission
- Deterministic tests: none
- Evaluation criteria: voice I/O, citations, safe permissions
- Provenance links: `https://war-monitor.com/`
- Licensing or trademark notes: original UX only
- Final evidence: pending

### WAR-006 Conflict-specific trackers

- Source product/domain: War Monitor
- Feature/workflow: dedicated pages for Ukraine, Gaza, Sudan, Syria, Yemen, North Korea, and regional conflict clusters
- User outcome: quickly jump to an active conflict’s dedicated tracker
- Current-project equivalent: generic map and briefing only
- Status: missing
- Data sources and authority tier: canonical event data
- Refresh frequency and latency class: near-real-time
- Geographic and asset-class coverage: active conflicts
- UI surfaces and command aliases: none
- Backend routes/events/jobs: none yet
- Security and privacy class: public read
- Deterministic tests: none
- Evaluation criteria: canonical shared data model, filtered trackers, deep links
- Provenance links: `https://war-monitor.com/conflicts`, `https://war-monitor.com/conflicts/sudan`
- Licensing or trademark notes: original page structure and copy required
- Final evidence: pending

### WAR-007 Tracked categories breadth

- Source product/domain: War Monitor
- Feature/workflow: war, terrorism, cyber attacks, protests, disasters, diplomacy, economic crises
- User outcome: monitor more than kinetic war
- Current-project equivalent: broad map and news concept exists
- Status: partial
- Data sources and authority tier: mixed public feeds
- Refresh frequency and latency class: mixed
- Geographic and asset-class coverage: global
- UI surfaces and command aliases: map, intel briefing
- Backend routes/events/jobs: `/api/map/*`, `/api/intel/*`
- Security and privacy class: public read
- Deterministic tests: none
- Evaluation criteria: explicit category filters, correct classification, provenance
- Provenance links: `https://war-monitor.com/`, Google Play listing for `com.onuraltun.warmonitor`
- Licensing or trademark notes: independent taxonomy implementation
- Final evidence: pending

### WAR-008 Real-time OSINT and Telegram-style source ingest

- Source product/domain: War Monitor
- Feature/workflow: ingest global news and OSINT/Telegram-style sources
- User outcome: see conflict signals faster than traditional roundups
- Current-project equivalent: RSS and mixed public feeds only; unauthenticated X syndication was removed
- Status: partial
- Data sources and authority tier: mixed
- Refresh frequency and latency class: mixed
- Geographic and asset-class coverage: global
- UI surfaces and command aliases: BRIEFING
- Backend routes/events/jobs: current news ingestion stack
- Security and privacy class: public read with source-verification needs
- Deterministic tests: none
- Evaluation criteria: provenance, original-source links, distrust of single-source rumors
- Provenance links: `https://war-monitor.com/`, Google Play listing for `com.onuraltun.warmonitor`
- Licensing or trademark notes: do not scrape or mirror disallowed protected sources
- Final evidence: pending

### WAR-009 Mobile-first conflict tracking

- Source product/domain: War Monitor
- Feature/workflow: mobile app and touch-optimized tracking
- User outcome: usable conflict monitoring from mobile devices
- Current-project equivalent: responsive web app and PWA
- Status: partial
- Data sources and authority tier: platform-wide
- Refresh frequency and latency class: N/A
- Geographic and asset-class coverage: platform-wide
- UI surfaces and command aliases: all
- Backend routes/events/jobs: all
- Security and privacy class: public read and notification permissions
- Deterministic tests: manual only
- Evaluation criteria: mobile layout, touch interactions, installability, performance
- Provenance links: `https://war-monitor.com/`, Google Play listing for `com.onuraltun.warmonitor`
- Licensing or trademark notes: original mobile UI only
- Final evidence: pending
