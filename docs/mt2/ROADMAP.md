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
- STATUS: IN PROGRESS → see STATE.md (2026-09-20)
- OBJECTIVE: Market-identity architecture (exchange, currency, calendar, symbol namespace) for US
  and India, and a MARKETS workspace.
- ENTRY REQUIREMENT: MT2-2 closed; DECISIONS.md record on market identity architecture; explicit
  authorization.
- DONE CONTRACT: symbol/market identity threads through quote, chart, and search contracts for
  both markets with tests; MARKETS workspace verified in browser.
- OUT OF SCOPE: India derivatives depth (MT2-5), portfolio.

## MT2-4 — LEDGER — Portfolio (Equity / Futures / Options)
- STATUS: NOT STARTED
- OBJECTIVE: Portfolio model, storage, and UI for equity, futures, and options positions.
- ENTRY REQUIREMENT: MT2-3 closed; DECISIONS.md record on portfolio storage; explicit authorization.
- DONE CONTRACT: positions persist, P&L computes deterministically with tests, restart-verified.
- OUT OF SCOPE: broker connectivity, trade execution.

## MT2-5 — MARKETGRID — US + India market-data / derivatives capability expansion
- STATUS: NOT STARTED
- OBJECTIVE: Provider expansion and derivatives data (chains, futures curves) for both markets.
- ENTRY REQUIREMENT: MT2-4 closed; DECISIONS.md record on India provider selection; explicit
  authorization.
- DONE CONTRACT: provider cascades with provenance and last-good behavior, live-tested.
- OUT OF SCOPE: execution.

## MT2-6 — WATCHTOWER — Watchlist 2.0
- STATUS: NOT STARTED
- OBJECTIVE: Rebuild the watchlist on the MT2 shell with multi-market symbols and persistence.
- ENTRY REQUIREMENT: MT2-5 closed; explicit authorization.
- DONE CONTRACT: persistence, stale-state handling, and alerts integration verified in browser and
  after restart.
- OUT OF SCOPE: AI watchers.

## MT2-7 — SENTINEL — AI Watchers 2.0
- STATUS: NOT STARTED
- OBJECTIVE: Evidence-gated AI watchers with a materiality model.
- ENTRY REQUIREMENT: MT2-6 closed; DECISIONS.md record on watcher materiality model; explicit
  authorization.
- DONE CONTRACT: watchers abstain without evidence, are verified independently where high-risk,
  and are live-tested.
- OUT OF SCOPE: execution, broker connectivity.

## MT2-8 — CONVERGENCE — Full UI migration / production acceptance
- STATUS: NOT STARTED
- OBJECTIVE: Migrate all surfaces to the MT2 shell, retire the legacy shell, production acceptance.
- ENTRY REQUIREMENT: MT2-2 through MT2-7 closed; explicit authorization.
- DONE CONTRACT: production smoke, browser, and HUMAN ACCEPTED evidence for every surface.
- OUT OF SCOPE: new features.
