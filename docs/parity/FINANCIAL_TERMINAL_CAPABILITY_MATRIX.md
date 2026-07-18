# Financial Terminal Capability Matrix

Research date: 2026-07-13

## Summary

- Total rows: 18
- Missing: 9
- Partial: 9
- Implemented: 0
- Entitlement-adapter-ready: 0
- Blocked-by-law: 0
- Checkpoint evidence:
  - local unit suite `9/9` passed on 2026-07-13
  - local smoke suite `21/21` passed on 2026-07-13
  - in-app browser verification passed on `http://localhost:3000`
  - production smoke suite `28/28` passed on 2026-07-13 (checkpoint 1)
  - production smoke suite `29/29` passed on 2026-07-15 (checkpoint 2)
  - map provenance checkpoint source commit `a25e6be` is production verified: `16/16` unit tests, `23/23` local smoke checks, and `29/29` production smoke checks passed on 2026-07-15
  - AI evidence-policy source commit `5a10b79` is production verified on 2026-07-16: `24/24` unit tests, `28/28` local smoke contracts, and `31/31` production smoke contracts passed

## Capability rows

### FT-001 Command, context, and workspace system

- Source product/domain: Bloomberg Terminal / Bloomberg Professional Services
- Feature/workflow: command line, autocomplete, history, favorites, linked workspaces
- User outcome: navigate fast and carry a shared instrument context across panels
- Current-project equivalent: symbol command bar only
- Status: partial
- Data sources and authority tier: platform-wide
- Refresh frequency and latency class: immediate UI
- Geographic and asset-class coverage: limited to current symbol workflows
- UI surfaces and command aliases: TERMINAL symbol bar
- Backend routes/events/jobs: search and instrument routes
- Security and privacy class: user workspace state
- Deterministic tests: none
- Evaluation criteria: command palette, recent commands, linked contexts, workspaces
- Provenance links: `https://professional.bloomberg.com/products/bloomberg-terminal/`
- Licensing or trademark notes: original command vocabulary required
- Final evidence: browser verification showed live ticker ribbon and AAPL quote panel rendering locally; smoke suite covers `/api/quote`, `/api/chart`, and `/api/intel/priceaction`; production verification passed

### FT-002 Security master and reference data

- Source product/domain: Bloomberg
- Feature/workflow: identifier mapping, corporate hierarchy, point-in-time reference data
- User outcome: load and compare securities reliably across asset classes
- Current-project equivalent: ticker search, profile, metrics
- Status: partial
- Data sources and authority tier: Finnhub and public vendor fallbacks
- Refresh frequency and latency class: seconds to daily
- Geographic and asset-class coverage: mostly US equities
- UI surfaces and command aliases: TERMINAL
- Backend routes/events/jobs: `/api/search`, `/api/profile`, `/api/metrics`
- Security and privacy class: public read
- Deterministic tests: smoke only
- Evaluation criteria: identifiers, corporate actions, point-in-time history, provenance
- Provenance links: `https://professional.bloomberg.com/products/data/enterprise-catalog/`
- Licensing or trademark notes: many identifiers require licensed datasets
- Final evidence: evidence-preserving news/intelligence pipeline verified in production payloads with source URLs, freshness, and degraded-mode metadata

### 2026-07-13 checkpoint 2 update

- Current-project sentiment capability: deterministic market breadth plus RSS-news tone through `/api/sentiment/market`.
- Data and methodology: SPY, QQQ, DIA, IWM, available VIX data, and a disclosed financial-headline lexicon; the response returns weights, counts, benchmark signals, evidence, and a degraded status when coverage is insufficient.
- Status: partial. This is transparent public-data sentiment, not a licensed professional sentiment or news-analytics entitlement.
- Evidence: `13/13` unit tests and local endpoint verification passed. Production deployment of `55e014c` served `app.js?v=20260713b`; `npm run test:prod` passed `29/29` on 2026-07-15. The canonical response was live and deterministic with five benchmarks, 18 headlines, 13 sources, attributable evidence, and disclosed methodology; the legacy alias returned its deprecation and successor headers.

### 2026-07-15 checkpoint 3 production update

- Infrastructure context: commodity ports, trade routes, cables, and pipelines now disclose whether they are project-curated references or hybrid public-data augmentation. This helps separate illustrative infrastructure context from live operational or entitlement-grade flow data.
- Evidence: the shared map catalog covers all active Leaflet layers and the infrastructure response; `16/16` unit tests and `23/23` local smoke checks passed, then source commit `a25e6be` served `20260715b` and production smoke passed `29/29`. This preserves the matrix's `partial` assessment and does not claim Bloomberg-grade data coverage or entitlement parity.

### 2026-07-16 checkpoint 4 production update

- AI research control: `shared/ai-task-policy-core.js` now gives Express and the Worker the same task risk, provider allowlist, evidence-age/diversity, deterministic citation, constraint, and abstention rules.
- Financial-output behavior: unverified supply-chain edges and investment picks are empty; deep dives are `Not Rated` with no fair value, target, entry, stop, or options construction; price-action explanations abstain rather than assigning an unsupported cause. Generic educational chat remains available to the speed tier, while current-market questions require a policy-approved heavy provider and qualifying evidence.
- Evidence: eight new policy cases contributed to a `24/24` unit pass, the local API suite passed `28/28`, and source commit `5a10b79` passed `31/31` production contracts while serving `20260716a`. Deployed probes confirmed empty unsupported edges/picks/scores, `Not Rated` deep dive, cited situation output, and speed-tier generic chat. Interactive browser verification loaded a live quote, non-zero chart, all seven views, and no console warnings/errors; no screenshot artifact is claimed. This is a partial safety improvement, not professional-terminal research parity: claim-level verification, deterministic sector/company analysis, options-chain support, and independent model verification remain open.

### FT-003 Real-time market monitors

- Source product/domain: Bloomberg
- Feature/workflow: multi-asset real-time dashboards, movers, breadth, watchlists, hours
- User outcome: monitor live market state across asset classes
- Current-project equivalent: quote panel, ticker tape, sector view
- Status: partial
- Data sources and authority tier: mixed market APIs
- Refresh frequency and latency class: seconds
- Geographic and asset-class coverage: narrow compared with target
- UI surfaces and command aliases: TERMINAL, SECTORS
- Backend routes/events/jobs: `/api/quote`, `/api/ticker`, `/api/chart`
- Security and privacy class: public read
- Deterministic tests: smoke only
- Evaluation criteria: breadth, latency, stale tick labels, cross-asset monitors
- Provenance links: `https://professional.bloomberg.com/products/bloomberg-terminal/`
- Licensing or trademark notes: live comprehensive coverage is entitlement-heavy
- Final evidence: browser verification confirmed chart canvas presence with non-zero dimensions and smoke coverage for `/api/chart`; production smoke passed; broader indicator/export coverage still open

### FT-004 Equities and company intelligence

- Source product/domain: Bloomberg
- Feature/workflow: company description, statements, ownership, estimates, earnings, peer analysis
- User outcome: conduct equity research from one workspace
- Current-project equivalent: deep dive, supply chain, company profile, company news
- Status: partial
- Data sources and authority tier: Finnhub, public headlines, AI synthesis
- Refresh frequency and latency class: minutes to daily
- Geographic and asset-class coverage: mostly US equities
- UI surfaces and command aliases: TERMINAL, DEEP DIVE, WATCHLIST
- Backend routes/events/jobs: `/api/profile`, `/api/news`, `/api/intel/company`, `/api/intel/deepdive`
- Security and privacy class: public read, AI-generated
- Deterministic tests: shared AI-policy fixtures plus local smoke contracts
- Evaluation criteria: structured facts, estimates, evidence links, point-in-time handling
- Provenance links: `https://professional.bloomberg.com/products/bloomberg-terminal/research/`
- Licensing or trademark notes: analyst and estimates data may require licensed sources
- Final evidence: checkpoint 4 production verifies policy metadata and safe deep-dive/supply-chain behavior in source commit `5a10b79`; status remains partial because issuer-grade research, options-chain data, and independent claim verification are absent

### FT-005 Fixed income and credit

- Source product/domain: Bloomberg
- Feature/workflow: bond analytics, curves, spreads, cash flows, credit tools
- User outcome: analyze fixed-income instruments and relative value
- Current-project equivalent: none
- Status: missing
- Data sources and authority tier: not connected
- Refresh frequency and latency class: N/A
- Geographic and asset-class coverage: none
- UI surfaces and command aliases: none
- Backend routes/events/jobs: none
- Security and privacy class: would require entitlement-sensitive data
- Deterministic tests: none
- Evaluation criteria: bond search, YTW, OAS, curves, portfolio attribution
- Provenance links: `https://professional.bloomberg.com/products/bloomberg-terminal/`
- Licensing or trademark notes: many workflows need licensed bond/reference data
- Final evidence: pending

### FT-006 FX, rates, and money markets

- Source product/domain: Bloomberg
- Feature/workflow: spot, forwards, curves, swaps, central-bank monitors
- User outcome: analyze rates and currencies with policy context
- Current-project equivalent: minimal macro/news only
- Status: missing
- Data sources and authority tier: not normalized at present
- Refresh frequency and latency class: N/A
- Geographic and asset-class coverage: limited
- UI surfaces and command aliases: none
- Backend routes/events/jobs: none
- Security and privacy class: public read if open-data-based
- Deterministic tests: none
- Evaluation criteria: curves, policy paths, FX analytics, calendars
- Provenance links: `https://professional.bloomberg.com/products/bloomberg-terminal/`, `https://professional.bloomberg.com/products/data/data-connectivity/server-api/`
- Licensing or trademark notes: live rates depth often requires premium feeds
- Final evidence: pending

### FT-007 Commodities, energy, agriculture, and shipping

- Source product/domain: Bloomberg
- Feature/workflow: physical flows, prices, inventories, shipping, spreads, shocks
- User outcome: connect commodities and logistics to market pricing
- Current-project equivalent: macro shock, map infrastructure, commodity-linked news
- Status: partial
- Data sources and authority tier: mixed public feeds and quote APIs
- Refresh frequency and latency class: minutes to daily
- Geographic and asset-class coverage: partial
- UI surfaces and command aliases: GLOBAL MAP, SUPPLY CHAIN
- Backend routes/events/jobs: `/api/macro/shock`, `/api/map/infrastructure`, `/api/map/flights`
- Security and privacy class: public read
- Deterministic tests: smoke only
- Evaluation criteria: forward curves, flows, disruptions, transparent assumptions
- Provenance links: `https://professional.bloomberg.com/products/bloomberg-terminal/`, `https://professional.bloomberg.com/products/trading/`
- Licensing or trademark notes: many physical datasets require entitlements
- Final evidence: pending

### FT-008 Derivatives and structured products

- Source product/domain: Bloomberg
- Feature/workflow: chains, volatility surfaces, Greeks, payoff and scenario tools
- User outcome: analyze options and structured exposures
- Current-project equivalent: options/risk AI output and quant Monte Carlo
- Status: partial
- Data sources and authority tier: underlying quotes only at baseline
- Refresh frequency and latency class: minutes
- Geographic and asset-class coverage: weak
- UI surfaces and command aliases: DEEP DIVE, QUANT LAB
- Backend routes/events/jobs: `/api/intel/deepdive`
- Security and privacy class: public read, model-generated
- Deterministic tests: none yet
- Evaluation criteria: real chain dependency, liquidity, Greeks provenance, scenario P&L
- Provenance links: `https://professional.bloomberg.com/products/bloomberg-terminal/`
- Licensing or trademark notes: cannot fabricate options-chain-dependent outputs
- Final evidence: pending

### FT-009 Economics, policy, and sovereign analysis

- Source product/domain: Bloomberg
- Feature/workflow: economic calendar, macro series, sovereign dashboards
- User outcome: interpret releases and policy in market context
- Current-project equivalent: headline-driven macro coverage only
- Status: missing
- Data sources and authority tier: public macro sources not yet integrated
- Refresh frequency and latency class: N/A
- Geographic and asset-class coverage: limited
- UI surfaces and command aliases: GLOBAL INTEL target
- Backend routes/events/jobs: none
- Security and privacy class: public read
- Deterministic tests: none
- Evaluation criteria: calendar, series explorer, release decomposition, sovereign comparison
- Provenance links: `https://professional.bloomberg.com/products/bloomberg-terminal/`
- Licensing or trademark notes: public official data can cover much of this cleanly
- Final evidence: pending

### FT-010 News, documents, and research

- Source product/domain: Bloomberg
- Feature/workflow: integrated news and research with filters, search, and source-aware linking
- User outcome: move from story to research quickly with provenance
- Current-project equivalent: Global Intel briefing, company news, alerts
- Status: partial
- Data sources and authority tier: public RSS and vendor company news
- Refresh frequency and latency class: 15 minutes
- Geographic and asset-class coverage: global headlines, limited documents
- UI surfaces and command aliases: GLOBAL INTEL, WATCHLIST, ALERTS
- Backend routes/events/jobs: `/api/intel/news`, `/api/news`, `/api/intel/company`
- Security and privacy class: public read and AI-generated
- Deterministic tests: smoke only
- Evaluation criteria: source links, clustering, search, citations, correction handling
- Provenance links: `https://professional.bloomberg.com/products/bloomberg-terminal/news/`, `https://professional.bloomberg.com/products/bloomberg-terminal/research/`
- Licensing or trademark notes: do not reproduce licensed full text
- Final evidence: pending

### FT-011 Charts and visualization

- Source product/domain: Bloomberg
- Feature/workflow: multi-security charts, overlays, studies, drawing, export
- User outcome: visualize price and related data professionally
- Current-project equivalent: custom canvas chart with indicators and Monte Carlo
- Status: partial
- Data sources and authority tier: quote/chart providers plus internal quant
- Refresh frequency and latency class: seconds to minutes
- Geographic and asset-class coverage: current symbol-centric
- UI surfaces and command aliases: TERMINAL, QUANT LAB
- Backend routes/events/jobs: `/api/chart`
- Security and privacy class: public read
- Deterministic tests: none yet
- Evaluation criteria: overlays, multi-series, exports, indicator correctness
- Provenance links: `https://professional.bloomberg.com/products/bloomberg-terminal/`
- Licensing or trademark notes: original chart UI required
- Final evidence: pending

### FT-012 Portfolio, performance, attribution, and risk

- Source product/domain: Bloomberg PORT / MARS / MAC3
- Feature/workflow: holdings, attribution, optimization, VaR, scenario, liquidity, factor risk
- User outcome: understand and manage portfolio risk and performance
- Current-project equivalent: none
- Status: missing
- Data sources and authority tier: not connected
- Refresh frequency and latency class: N/A
- Geographic and asset-class coverage: none
- UI surfaces and command aliases: none
- Backend routes/events/jobs: none
- Security and privacy class: private user portfolio state
- Deterministic tests: none
- Evaluation criteria: portfolio model, attribution, scenario, factor/risk outputs
- Provenance links: `https://professional.bloomberg.com/products/bloomberg-terminal/portfolio-analytics/`, `https://professional.bloomberg.com/products/risk/mars/`, `https://professional.bloomberg.com/products/risk/mac3/`
- Licensing or trademark notes: premium analytics require clear adapter boundaries
- Final evidence: pending

### FT-013 Screening, idea generation, and relative value

- Source product/domain: Bloomberg
- Feature/workflow: reusable screens, factor ranks, peer groups, catalyst filters
- User outcome: generate explainable ideas from structured data
- Current-project equivalent: sector AI picks only
- Status: partial
- Data sources and authority tier: limited public news and quote data
- Refresh frequency and latency class: minutes
- Geographic and asset-class coverage: narrow
- UI surfaces and command aliases: SECTORS, INVESTMENT REPORT
- Backend routes/events/jobs: `/api/intel/analysis`, `/api/intel/report`
- Security and privacy class: public read, AI-generated
- Deterministic tests: none
- Evaluation criteria: reusable screens, transparent ranking, backtest-safe fields
- Provenance links: `https://professional.bloomberg.com/products/bloomberg-terminal/research/`
- Licensing or trademark notes: must not present unsupported recommendations as facts
- Final evidence: pending

### FT-014 Quant research and programmatic analytics

- Source product/domain: Bloomberg / BQuant / API surfaces
- Feature/workflow: governed research workspace, reproducible queries, analytics publishing
- User outcome: perform advanced quantitative research with traceable data access
- Current-project equivalent: browser quant lab only
- Status: missing
- Data sources and authority tier: not connected
- Refresh frequency and latency class: N/A
- Geographic and asset-class coverage: none
- UI surfaces and command aliases: none
- Backend routes/events/jobs: none
- Security and privacy class: code execution and data-governance sensitive
- Deterministic tests: none
- Evaluation criteria: notebook or query layer, reproducibility, sandboxing, experiment tracking
- Provenance links: `https://professional.bloomberg.com/products/data/data-connectivity/server-api/`
- Licensing or trademark notes: do not run arbitrary untrusted code in Worker isolate
- Final evidence: pending

### FT-015 Data connectivity and interoperability

- Source product/domain: Bloomberg
- Feature/workflow: APIs, feeds, exports, cloud delivery, spreadsheet integration
- User outcome: consume and distribute normalized data programmatically
- Current-project equivalent: none
- Status: missing
- Data sources and authority tier: none platform-wide
- Refresh frequency and latency class: N/A
- Geographic and asset-class coverage: none
- UI surfaces and command aliases: none
- Backend routes/events/jobs: none
- Security and privacy class: API/auth surface
- Deterministic tests: none
- Evaluation criteria: REST/WebSocket/SSE, schema catalog, entitlement-aware exports
- Provenance links: `https://professional.bloomberg.com/products/data/data-connectivity/`, `https://professional.bloomberg.com/products/data/data-connectivity/server-api/`, `https://professional.bloomberg.com/products/data/enterprise-catalog/`
- Licensing or trademark notes: commercial data delivery requires entitlement boundaries
- Final evidence: pending

### FT-016 Trading, order, and execution workflows

- Source product/domain: Bloomberg
- Feature/workflow: order tickets, EMS/OMS, pre-trade controls, post-trade analytics
- User outcome: route and manage orders safely
- Current-project equivalent: none
- Status: missing
- Data sources and authority tier: no broker adapters connected
- Refresh frequency and latency class: N/A
- Geographic and asset-class coverage: none
- UI surfaces and command aliases: none
- Backend routes/events/jobs: none
- Security and privacy class: destructive financial action
- Deterministic tests: none
- Evaluation criteria: paper trading first, risk checks, audit logs, explicit live enablement
- Provenance links: `https://professional.bloomberg.com/products/trading/order-management-system/`, `https://professional.bloomberg.com/products/trading/`
- Licensing or trademark notes: this revision must not introduce live autonomous trading
- Final evidence: pending

### FT-017 Collaboration and communications

- Source product/domain: Bloomberg
- Feature/workflow: messaging, comments, shared workspaces, notes, team research
- User outcome: collaborate inside the terminal
- Current-project equivalent: none
- Status: missing
- Data sources and authority tier: N/A
- Refresh frequency and latency class: N/A
- Geographic and asset-class coverage: platform-wide
- UI surfaces and command aliases: none
- Backend routes/events/jobs: none
- Security and privacy class: authenticated, multi-user, privacy-sensitive
- Deterministic tests: none
- Evaluation criteria: user accounts, sharing, access control, audit logs
- Provenance links: `https://professional.bloomberg.com/products/bloomberg-terminal/`
- Licensing or trademark notes: original collaboration design only
- Final evidence: pending

### FT-018 Access, mobile, and education

- Source product/domain: Bloomberg
- Feature/workflow: mobile access, remote access, education/help surfaces
- User outcome: use the platform anywhere and learn workflows quickly
- Current-project equivalent: responsive web app and PWA only
- Status: partial
- Data sources and authority tier: platform-wide
- Refresh frequency and latency class: N/A
- Geographic and asset-class coverage: platform-wide
- UI surfaces and command aliases: app shell, help targets not yet built
- Backend routes/events/jobs: PWA assets and push
- Security and privacy class: session/access sensitive
- Deterministic tests: smoke only for shell
- Evaluation criteria: mobile polish, support/help, installability, remote continuity
- Provenance links: `https://professional.bloomberg.com/products/bloomberg-terminal/access/`, `https://professional.bloomberg.com/products/bloomberg-terminal/`
- Licensing or trademark notes: original UX only
- Final evidence: pending
