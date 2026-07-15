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
- Final evidence: local and production checkpoint verified conflict/map event endpoints and structured JSON contract behavior

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
- Deterministic tests: none yet
- Evaluation criteria: transparent categories, severity rules, evidence links
- Provenance links: `https://war-monitor.com/`
- Licensing or trademark notes: independent category system allowed
- Final evidence: RSS ingestion preserves source URLs and reliability labels locally; unauthenticated X syndication was removed from the live ingestion path. Broader OSINT-source expansion remains open.

### 2026-07-13 checkpoint 2 update

- Source-reliability control: market sentiment now uses attributable benchmark and RSS inputs rather than a social-feed scrape.
- Evidence: deterministic unit tests and local smoke verification passed. Production deployment of `55e014c` served `app.js?v=20260713b`; `npm run test:prod` passed `29/29` on 2026-07-15. The canonical endpoint returned attributable evidence and methodology with `status: "live"` and `dataMode: "deterministic"`; the compatibility alias carried deprecation and successor headers.

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
- Final evidence: pending

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
- Current-project equivalent: RSS and X syndication only
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
