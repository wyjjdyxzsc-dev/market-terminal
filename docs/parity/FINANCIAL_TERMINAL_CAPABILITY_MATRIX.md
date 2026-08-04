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
  - checkpoint 5 source commit `20c9252` is production verified: `29/29` unit tests, all 28 keyless-available local smoke contracts, `33/33` production contracts, zero dependency vulnerabilities, Worker dry-run bundling, targeted probes, and interactive sector/watchlist/alert checks passed
  - checkpoint 6 source commit `919f1b9` is production verified: `45/45` unit tests, the versioned 10-case offline AI safety evaluation, all 28 keyless-available local contracts, `33/33` deployed contracts, zero dependency vulnerabilities, Worker dry-run bundling, targeted authority probes, and desktop/mobile telemetry/chat checks passed
  - checkpoint 7 source commits `febefb3` and `90c191b` are production verified: the final source served all seven `20260730b` assets, passed `33/33`, returned 12 source-linked NEWS cards on normal/forced-fresh probes, and passed browser disclosure checks
  - checkpoint 8 source commits `9370cc3` and `953c0ea` are production verified: the final source served all seven `20260804b` assets, passed `33/33`, returned fresh AAPL/Apple/MSFT dossiers in 1.06-1.35 seconds, and passed pending-to-withheld desktop/mobile checks without console errors
  - checkpoint 9 ticker/options completeness is locally verified: `58/58` unit tests, all AI thresholds, `32/32` available contracts, zero-vulnerability audit, Worker dry-run, live all-seven ticker plus AAPL/SPCX chain probes, and desktop/mobile checks passed; production is pending

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

### 2026-07-22 checkpoint 5 production update

- Sector/company authority: sector interpretation now requires cited, source-diverse evidence and an approved heavy provider; company-news output binds each interpreted item back to canonical title, publisher, URL, timestamp, and identity fields. Safe fallbacks retain source headlines but withhold impact ratings.
- Non-actionable constraints: all sector ranks, scores, stock picks, implied-volatility claims, and options strategies are removed. Missing sector evidence renders `N/A`; deep-dive and supply-chain UI claims were also reconciled with their existing withheld behavior.
- Deterministic technical analysis: `/api/intel/candles` now always uses the shared OHLC pattern engine and identifies that verifier in policy metadata instead of allowing a speed model to replace calculated output.
- Evidence: `29/29` unit tests passed; the expanded suite passed all 28 contracts available in the keyless local environment and `33/33` deployed contracts for source commit `20c9252`. Production probes returned 11 unranked sectors, zero picks or unspecified recommendation fields, canonical-or-withheld lowercase-AAPL company evidence, and deterministic candles. Managed deployment served all seven `20260722a` references; the production browser rendered the constrained states with no console warnings/errors. This preserves `partial` assessments and makes no Bloomberg parity claim.

### 2026-07-28 checkpoint 6 production update

- Provider lifecycle: a shared Express/Worker registry records current model IDs, context/output limits, pricing where documented, lifecycle status, runtime eligibility, and protected health state. Deprecated Groq, Gemini, DeepSeek, Cohere, Together, and AI21 defaults were replaced; unverified Nebius and obsolete OctoAI paths are disabled.
- High-risk authority: generated current-market and high-risk tasks now run a bounded generator followed by a verifier from a different provider and canonical model family. A valid rejection is authoritative; no independent candidate, failed evidence/citation/schema validation, or exhausted call/token/cost/latency budget produces a structured abstention.
- Disclosure and evaluation: safe response metadata exposes actual served models, provider calls, reported or estimated tokens, latency, estimated cost, cost units, and verifier outcome. The versioned offline fixture suite measures policy safety but is not a live-provider quality benchmark.
- Evidence: `45/45` unit tests, the 10-case evaluation thresholds, all 28 keyless-available local API contracts, zero-vulnerability audit, and Wrangler `4.114.0` dry-run bundling passed. After an initial `29/33` production run exposed stale KV policy envelopes, schema-isolation commit `4ffe15a` fixed the defect; final source commit `919f1b9` passed `33/33`, targeted authority probes, and desktop/mobile browser checks with no warnings/errors. Live high-risk attempts abstained after their evidence or verifier gates, so no positive high-risk acceptance or factual-quality claim is made. This improves the AI research safety architecture but does not change any capability row to implemented, add licensed financial data, or establish Bloomberg parity.

### 2026-07-30 checkpoint 7 update

- Company research evidence now combines ticker-resolved RSS and Finnhub company news. Recognized redirect hosts can retain an attributed publisher domain, while unrelated URLs cannot borrow a reputable publisher label.
- High-risk generation reserves an independent verifier within the declared call/cost budget, and price-action prompts request their required evidence IDs. Safe attempt telemetry and specific failure reasons make provider/evidence/verification failures visible without exposing credentials.
- Lower-risk Node/Worker output limits and cooldown semantics are aligned. Company/deep-dive evidence reached two distinct sources; current-market chat correctly explained that the Groq-only local environment lacks the required two-heavy-provider pair.
- Core evidence: source commit `febefb3` exposed richer company evidence plus bounded fail-closed provider attempts. When its first live NEWS probe revealed a one-card result accepted from 60 inputs, source commit `90c191b` deployed `2026-07-30b` useful-batch validation and cache isolation. The final source passed `33/33`, normal and forced-fresh probes returned 12 linked cards, and browser NEWS/chat disclosure checks had no console errors. No capability status changes, new entitlement, positive high-risk quality claim, or Bloomberg parity claim are made.

### 2026-08-04 checkpoint 8 update

- Equities workflow: Deep Dive now returns a deterministic dossier from the pooled quote cascade, Finnhub metrics/recommendation counts, and source-balanced company evidence even when generated narrative cannot form an independent heavy-provider pair.
- Authority boundary: deterministic observations describe supplied numbers and recent source titles only. Investment rating/score, fair value, trade levels, target, implied volatility, and options construction remain explicitly unavailable.
- Evidence: source commit `9370cc3` served all seven `20260804a` assets and passed `33/33`; source commit `953c0ea` then separated the deterministic response from optional verification after production exposed 32-37 second uncached waits. The follow-up served all seven `20260804b` assets, passed `33/33`, returned fresh dossiers in 1.06-1.35 seconds, and passed responsive pending-to-withheld browser checks. FT-004 remains `partial`, and no Bloomberg, licensed-research, or positive high-risk model-quality parity is claimed.

### 2026-08-04 checkpoint 9 update

- Market monitor: the seven-symbol tape now uses the canonical quote pool and source-attributed last-good fallback instead of caching direct-Finnhub failures as zeroes.
- Equity/derivatives data: Deep Dive schema `2026-08-04b` distinguishes dataset coverage from investment merit and adds a bounded source-linked Nasdaq at-the-money chain snapshot for optionable US stocks. Returned rows, expiries, nearest strike, call/put market, activity, and put/call ratios are deterministic observations.
- Authority boundary: the adapter does not supply IV or Greeks, does not create a chain for non-optionable stocks, and does not issue a valuation or trade. FT-003, FT-004, and FT-008 remain `partial`; local evidence passed `58/58` unit tests, `32/32` available contracts, targeted AAPL/SPCX probes, Worker dry-run, and responsive browser checks. Production is pending.

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
- Deterministic tests: strict ticker-core unit and seven-symbol smoke contracts
- Evaluation criteria: breadth, latency, stale tick labels, cross-asset monitors
- Provenance links: `https://professional.bloomberg.com/products/bloomberg-terminal/`
- Licensing or trademark notes: live comprehensive coverage is entitlement-heavy
- Final evidence: prior production verifies chart/ticker shell behavior. Checkpoint 9 locally verifies seven positive pooled tape quotes plus source/freshness metadata and last-good fallback; production is pending and broader cross-asset monitor breadth remains open.

### FT-004 Equities and company intelligence

- Source product/domain: Bloomberg
- Feature/workflow: company description, statements, ownership, estimates, earnings, peer analysis
- User outcome: conduct equity research from one workspace
- Current-project equivalent: deep dive, supply chain, company profile, company news
- Status: partial
- Data sources and authority tier: pooled quotes, Finnhub company data, public headlines, bounded Nasdaq options rows, optional verified AI synthesis
- Refresh frequency and latency class: minutes to daily
- Geographic and asset-class coverage: mostly US equities
- UI surfaces and command aliases: TERMINAL, DEEP DIVE, WATCHLIST
- Backend routes/events/jobs: `/api/profile`, `/api/news`, `/api/intel/company`, `/api/intel/deepdive`
- Security and privacy class: public read, AI-generated
- Deterministic tests: shared AI-policy fixtures plus local smoke contracts
- Evaluation criteria: structured facts, estimates, evidence links, point-in-time handling
- Provenance links: `https://professional.bloomberg.com/products/bloomberg-terminal/research/`
- Licensing or trademark notes: analyst and estimates data may require licensed sources
- Final evidence: checkpoint 4 production verifies policy metadata and safe deep-dive/supply-chain behavior in source commit `5a10b79`; checkpoint 5 production verifies canonical company-news binding and non-actionable sector constraints in source commit `20c9252`; checkpoint 8 production-verifies the resilient data-first dossier. Checkpoint 9 locally verifies truthful equity coverage and a bounded listed-options snapshot; production is pending. Status stays partial because issuer-grade research, complete statements/estimates, IV/Greeks, and positive high-risk output quality evidence are absent.

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
- Current-project equivalent: bounded Nasdaq chain snapshot, deterministic chain activity, quant Monte Carlo
- Status: partial
- Data sources and authority tier: public Nasdaq at-the-money chain snapshot plus pooled underlying quotes
- Refresh frequency and latency class: minutes
- Geographic and asset-class coverage: weak
- UI surfaces and command aliases: DEEP DIVE, QUANT LAB
- Backend routes/events/jobs: `/api/intel/deepdive`
- Security and privacy class: public read, model-generated
- Deterministic tests: shared options-chain normalizer plus strict AAPL Deep Dive smoke contract
- Evaluation criteria: real chain dependency, liquidity, Greeks provenance, scenario P&L
- Provenance links: `https://professional.bloomberg.com/products/bloomberg-terminal/`
- Licensing or trademark notes: public website availability is not a professional real-time derivatives entitlement; IV/Greeks and trade construction remain unavailable
- Final evidence: checkpoint 9 locally returns bounded source-linked AAPL/SPCX chain rows, expiries, nearest strikes, markets, and activity without issuing a trade. Production verification is pending; status remains partial.

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
- Final evidence: source commit `20c9252` production verifies canonical-or-withheld company-news evidence and deterministic corroboration-gated alert eligibility; document search, correction workflows, and licensed research remain pending

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
- Final evidence: source commit `20c9252` production verifies that candle commentary is generated only by the shared deterministic OHLC engine; broad indicator reference coverage, multi-security charting, and export workflows remain pending

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
