# Project Meridian — STATE (recovery capsule)

PROJECT: Market Terminal 2.0 — Project Meridian
CHECKPOINT: MT2-3 TWINCORE — US / India dual-market architecture
STATUS: IMPLEMENTED + UNIT/INTEGRATION/LOCAL-BROWSER TESTED; deploying for production acceptance
  (2026-09-20T15:05Z). PASS/PARTIAL decided after `test:prod` + production browser pass.
PREVIOUS: POCKET side-track — PASS (7d65fc0, OWNER ACCEPTED). MT2-1A PASS. MT2-2 PASS.
ROUTE: claude-opus-5 / SERIAL / bypass-permissions — re-derived for MT2-3 (MIXED change class:
  shared core + two runtimes + UI + tests + docs); sufficient; no ROUTING STOP.
GIT: branch main; start HEAD 7d65fc0; TWINCORE commit on top (shared/market-core.js, server.js,
  worker.js, public/{app,intel,shell,deepdive,index,style}, shared/{api-contract,deep-dive-core},
  tests, docs). Assets 20260920h. Untracked owner files preserved.
OBJECTIVE: canonical market-context architecture wired through the QUARTZ shell — global US/INDIA
  selector, persistence, canonical market + instrument identity, NSE/BSE vs NYSE/Nasdaq, USD/INR,
  ET/IST, independent calendars, market-aware search/tape/benchmarks/quant/sentiment/Deep Dive,
  provider matrix, explicit data truth, market-scoped caches, backward-compatible US contracts,
  server/worker parity, truthful India degradation.
DONE: gates; provider verification (Finnhub US-only quotes; Yahoo works from Cloudflare for NSE/
  BSE + indices; Nasdaq US-only); shared/market-core.js + 18 tests (6 negative controls);
  backend parity in both runtimes; frontend wiring; Deep Dive market block + INR renderer fix;
  smoke +13 contracts (45/45 local); unit 96/96; ai-eval pass; dry-run bundle; local browser
  pass US, INDIA, US→INDIA, INDIA→US, reload persistence, desktop + mobile; D-009; CHANGELOG;
  CLAUDE.md; BACKLOG B-023…B-027.
ENVIRONMENT HAZARD: B-023 — iCloud evicted repo source + node_modules mid-checkpoint (disk 13 GB
  after Xcode/simulator). Mitigated: simulator runtime + DerivedData deleted (16 GB freed), repo
  re-materialised, local server runs from ~/Library/Developer/market-terminal-run (non-iCloud).
  OWNER must move the repo out of iCloud (B-001).
OPEN: B-001/B-023 (owner), B-002, B-003, B-016…B-019, B-021, B-022, B-024 (NSE calendar verify),
  B-025 (local Yahoo 429), B-026 (watchlist/alerts not market-scoped — WATCHTOWER/SENTINEL),
  B-027 (no India fundamentals/news/options provider).
NEXT EXACT ACTION: git commit; git push origin main (deploy); wait ~90 s; verify production serves
  nine 20260920h assets; npm run test:prod; production browser pass (US, INDIA, US→INDIA,
  INDIA→US, reload, desktop, mobile) with real India data (Yahoo from Cloudflare); record
  EVIDENCE "Production acceptance"; COMMS closure; STATE → PASS/PARTIAL; STOP.
