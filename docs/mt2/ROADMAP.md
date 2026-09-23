# Project Meridian — Roadmap (Market Terminal 2.0)

Canonical checkpoint sequence. **Appearance here does not authorize a checkpoint.** Each is
authorized only by an explicit OWNER prompt naming it. STATUS values: NOT STARTED / AUTHORIZED /
IN PROGRESS / PASS / PARTIAL / BLOCKED.

---

## MT2-0 — BLACKBOX — Audit / Repair / Baseline
- STATUS: PASS (closed 2026-09-20, commit fa52e1a; bounded open items B-001/B-002 in BACKLOG.md)
- OBJECTIVE: Establish repository/runtime ground truth, create the durable docs/mt2 control plane,
  audit the current product and repair verified material baseline defects, identify (not restore)
  the original first-complete Claude "Deep Research" implementation for MT2-1.
- ENTRY REQUIREMENT: OWNER authorization of MT2-0 only.
- DONE CONTRACT: repository baseline + truthful routing + docs/mt2 seam (all seven files) +
  historical docs preserved + material product audit + blocking defects repaired or bounded with
  focused evidence + regression baseline recorded + browser verification to the achievable level +
  Deep Research origin identified + no out-of-scope implementation + STATE.md current with exact
  next action.
- OUT OF SCOPE: Deep Research restoration; India; UI redesign; Portfolio; Watchlist rebuild;
  new AI watchers; broker connections; trading execution.

## MT2-1 — REWIND — Original Deep Research restoration
- STATUS: PASS (closed 2026-09-20, commit f4a162a + closure; generated-analysis production
  acceptance not claimed while B-002 stands)
- OBJECTIVE: Restore the original first-complete Claude Deep Research experience identified in
  MT2-0, reconciled with the current evidence/authority model rather than blindly reverted.
- ENTRY REQUIREMENT: MT2-0 PASS (met) and origin confirmed by OWNER (D-001 CONFIRMED:
  `42af0f6`, with `6fafe78` for same-experience extensions only); explicit MT2-1 authorization
  (given 2026-09-20).
- DONE CONTRACT: restored experience runs locally and in production, verified in a real browser,
  with evidence recorded in EVIDENCE.md; no regression of the regression baseline.
- OUT OF SCOPE: new UI system, India, Portfolio, Watchlist 2.0, watchers.

## MT2-1A — REWIND RECONCILIATION — Deep Research vs Deep Dive identity check
- STATUS: PASS (closed 2026-09-20, investigative; no code change)
- OBJECTIVE: prove whether the OWNER's "Deep Research" is the DEEP DIVE surface restored in MT2-1.
- RESULT: CASE A — same surface (DECISIONS D-007). MT2-1 remains PASS.
- NOTE: authorized after MT2-2 QUARTZ had already closed in a separate session; QUARTZ untouched.

## MT2-2 — QUARTZ — Apple/macOS-derived UI system + new shell
- STATUS: PASS (closed 2026-09-20, commit b46bbb2 + closure; B-002 still bounds generated-analysis acceptance)
- OBJECTIVE: Introduce the MT2 design system and application shell alongside (not replacing) the
  existing shell.
- ENTRY REQUIREMENT: MT2-1 closed; explicit authorization.
- DONE CONTRACT: design tokens, shell, navigation primitives, and at least one migrated surface
  verified in browser at desktop and mobile widths; old shell still functional.
- OUT OF SCOPE: full migration (MT2-8), market/portfolio features.

## MT2-3 — TWINCORE — US / India market architecture + MARKETS workspace
- STATUS: PASS (closed 2026-09-20; D-009; EVIDENCE.md "MT2-3 TWINCORE")
- OBJECTIVE: Market-identity architecture (exchange, currency, calendar, symbol namespace) for US
  and India, and a MARKETS workspace.
- ENTRY REQUIREMENT: MT2-2 closed; DECISIONS.md record on market identity architecture; explicit
  authorization.
- DONE CONTRACT: symbol/market identity threads through quote, chart, and search contracts for
  both markets with tests; MARKETS workspace verified in browser.
- OUT OF SCOPE: India derivatives depth (MT2-5), portfolio.

## MT2-4 — ATLAS — Maps (geographic market-intelligence foundation)
- STATUS: PASS (closed 2026-09-21; D-010; EVIDENCE.md "MT2-4 ATLAS")
- OBJECTIVE: canonical GeoEntity / MapLayer / CompanyGeoLink / GeoEvent model, sourced datasets,
  reusable map API, clustering, search, detail drawer, company → security path.
- DONE CONTRACT: PASS contract in the ATLAS brief (COMMS 2026-09-21).
- OUT OF SCOPE: relationship graph (NEXUS), IPO location (LAUNCHPAD), event collection (WORLDWIRE).

## MT2-5 — NEXUS — Supply (listed-company universe, suppliers/customers/competitors/facilities, dependency graph)
- STATUS: PASS (closed 2026-09-22; source commit `59a7bba`; see CLAUDE.md "MT2-5 NEXUS" —
  this file's own seam entries for the checkpoint were not written at the time; recorded
  retroactively in MT2-5A CENSUS below from CLAUDE.md's already-production-verified record).
- OBJECTIVE: canonical public-company registry + evidence-backed relationship graph replacing
  the permanently-abstaining Supply Chain stub.
- OUT OF SCOPE: full listed-security reconciliation, BSE onboarding, cross-listing identity
  (all deferred to MT2-5A CENSUS below — NEXUS's own registry builder had undiscovered field-
  mapping bugs that silently zeroed BSE and NSE ISIN; see D-011).

## MT2-5A — CENSUS — Listed-Company Universe Completeness Lock
- STATUS: PASS (closed 2026-09-23; D-011; EVIDENCE.md "MT2-5A CENSUS")
- OBJECTIVE: hardening checkpoint, not a NEXUS rebuild — complete US listed-security
  reconciliation (real SEC exchange classification, not a collapsed fallback), BSE onboarding,
  NSE/BSE cross-listing deduplication, Company vs ListedSecurity separation, 100%
  security-accounting and company-identity coverage, zero silent drops.
- OUT OF SCOPE: expanding relationship coverage (UNKNOWN stays UNKNOWN); LAUNCHPAD.

## MT2-6 — LAUNCHPAD — IPOs
- STATUS: NOT STARTED · ENTRY: MT2-5A closed; explicit authorization.

## MT2-7 — WORLDWIRE — News (large-scale geopolitical event collection into GeoEvent)
- STATUS: NOT STARTED · ENTRY: explicit authorization.

## MT2-8 — ORACLE — Research
- STATUS: NOT STARTED · ENTRY: explicit authorization.

## MT2-9 — LEDGER — Portfolio (Equity / Futures / Options)
- STATUS: NOT STARTED · ENTRY: DECISIONS record on portfolio storage; explicit authorization.

## MT2-10 — MARKETGRID — Data
- STATUS: NOT STARTED · ENTRY: explicit authorization.

## MT2-11 — WATCHTOWER — Watchlist
- STATUS: NOT STARTED · ENTRY: explicit authorization.

## MT2-12 — SENTINEL — Alerts
- STATUS: NOT STARTED · ENTRY: explicit authorization.

## MT2-13 — CONVERGENCE — Polish / full migration
- STATUS: NOT STARTED · ENTRY: explicit authorization.

---
ROADMAP CORRECTION (2026-09-21): the numbering above is the OWNER's canonical roadmap (ATLAS brief).
The earlier sequence that placed LEDGER at MT2-4, MARKETGRID at MT2-5, WATCHTOWER at MT2-6,
SENTINEL at MT2-7 and CONVERGENCE at MT2-8 is superseded; references to those old numbers in
BACKLOG/EVIDENCE entries written before this date map onto the new names, not the old numbers.
