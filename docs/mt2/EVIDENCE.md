# Project Meridian — EVIDENCE

Acceptance evidence with real evidence levels. Never claim a higher level from a lower one.
Levels: IMPLEMENTED · UNIT TESTED · INTEGRATION TESTED · REAL BROWSER TESTED · LIVE TESTED ·
RESTART VERIFIED · HUMAN ACCEPTED

---

## MT2-0 BLACKBOX — 2026-09-20 — source HEAD `1bf0c64` + uncommitted BLACKBOX working tree

### Baseline (before repairs)
- `npm run test:unit` → 61/61 pass. Level: UNIT TESTED.
- `npm run test:ai-eval` → 10 fixtures, `thresholdsPassed: true` (offline recorded fixtures; not a
  live-provider benchmark). Level: UNIT TESTED.
- `node tests/smoke.js` against local `npm start` → 32/32 pass, 3 keyed/network skips
  (`fires`, `weather`, `webcams-live`). Level: INTEGRATION TESTED. **Note:** the `weather` skip
  was masking a real upstream contract break (see repair R2).
- Production `GET /` served all seven `?v=20260811a` assets → the 2026-08-11 commit is deployed
  (CLAUDE.md said "not yet verified in production"; ground truth is that it is deployed).
- Production read-only probes: `/api/map/eonet` 404, `/api/map/conflictnews` 502,
  `/api/map/overpass` 404, `/api/map/weather` 502, `/api/map/flights?bbox=…` 200 with 0 points,
  `/api/intel/{situation,report,instability,analysis}` all `abstained` (single heavy provider
  `github` fails in ~300 ms with failureCode `Error`; `cfai` times out at ~19 s on deep dive),
  `/api/intel/chat` generic → `grounded`. Level: LIVE TESTED (observation only).

### Repairs
**R1 — Nasdaq chart fallback fails for ETFs (server.js + worker.js).**
- Observation: `/api/chart?symbol=SPY&range=1Y` → 502 `Yahoo responded 429`. Nasdaq
  `assetclass=stocks` returns `rCode 400 "Symbol not exists."` for ETFs (SPY/QQQ/DIA/IWM), so the
  quant panel benchmark and every ETF chart die whenever Yahoo rate-limits.
- Change: `fetchNasdaqByAssetClass()` tries `stocks` then `etf` on that exact signal (both
  runtimes, 1D and historical paths).
- Test: new smoke check `GET /api/chart?symbol=SPY&range=1Y (ETF fallback)` — observed FAIL
  (HTTP 502) before the change, PASS after. SPY/QQQ/AAPL 1D+1Y all return points via `nasdaq`.
- Level: INTEGRATION TESTED (local). Worker: IMPLEMENTED + Wrangler dry-run bundled only.

**R2 — NWS weather alerts 502 in both runtimes.**
- Observation: `api.weather.gov/alerts/active?…&limit=250` → 400 `Query parameter "limit" is not
  recognized`; local and production `/api/map/weather` return 502. The smoke suite skipped it as
  "key/network not available", so the test could not detect the failure.
- Change: drop `limit` from the query; bound to 250 alerts in code (both runtimes). Smoke check
  is now strict (keyless route must return `points` + `provenance`).
- Test: strict check observed FAIL (502) against the unpatched server, PASS after restart
  (66 geolocated points from 418 features).
- Level: INTEGRATION TESTED (local). Worker: IMPLEMENTED + dry-run bundled.

**R3 — Global Intel briefing always degraded with the documented default speed provider.**
- Observation: `[ai] groq error: groq responded 400: Failed to validate JSON`. Reproduced with
  the real 60-headline NEWS prompt outside the server: `openai/gpt-oss-120b` spent 2,518
  reasoning tokens, hit the shared 4,000 `max_tokens` ceiling (`finish_reason: length`), and
  Groq JSON mode rejected the truncated output. Groq free tier is also 8,000 TPM, so raising the
  ceiling is not viable.
- Change: registry `groq.reasoningEffort = 'low'`; both body builders send `reasoning_effort`
  when set. Probe after change: 434 reasoning tokens, `finish_reason: stop`.
- Test: new unit test in `tests/ai-provider-registry.test.js`; after restart `/api/intel/news`
  returned 13 enriched cards, 0 degraded, log `[ai] groq WON`; briefing cards rendered in the
  browser.
- Level: INTEGRATION TESTED + REAL BROWSER TESTED (local). Worker: IMPLEMENTED + dry-run.

**R4 — Raw HTML entities in headlines (`&#x2018;`, `&rsquo;`, …).**
- Observation: MarketWatch titles rendered as `&#x2018;My total balance…&#x2019;` in the
  degraded briefing. `decodeEntities()` handled only decimal numeric entities.
- Change: hex numeric + eight common named entities, `fromCodePoint` (both runtimes).
- Test: node probe of the patched function; after restart `/api/intel/news` had 0 titles with
  raw entities. Level: INTEGRATION TESTED (local).

**R5 — Environment: repository inside iCloud-synced Desktop with 1,711 evicted files.**
- Observation: `git status` hung for >120 s (`read error while indexing … Operation canceled`);
  `worker.js` and 196 `.git` objects were `dataless`.
- Change: no repo change. `.git` and tracked files materialised on demand; `node_modules`
  (git-ignored, lockfile-reproducible) reinstalled via `npm ci` (90 packages).
- Level: RESTART VERIFIED for git operations in this session only. Root cause remains
  (see BACKLOG B-001, HUMAN ACTION).

### Regression after repairs
- `npm test` → unit 62/62, smoke 34/34 (2 allowed keyed skips: `fires`, `webcams-live`).
- `npm run test:ai-eval` → thresholds passed.
- `npx wrangler@4 deploy --dry-run` → bundled, bindings `MT_KV`, `AI`, `ASSETS` resolved.
- `npm audit --omit=dev` → 3 moderate (`qs` via `express`/`body-parser`; fix available).
- `npm run test:prod` NOT run: production was not changed in this checkpoint; deploying merely to
  complete BLACKBOX is prohibited. Read-only production GET probes were used instead.

### Browser (built-in pane, local `npm start`, HEAD + repairs)
- Desktop 1024×768: Terminal (live AAPL quote, 1D chart, snapshot, sentiment, company, news);
  Global Intel → Briefing (enriched cards after R3), Situation Room (explicit RESEARCH WITHHELD:
  no heavy providers locally), Investment Report (withheld state), Global Map (earthquakes +
  aircraft render); Sectors (11 unrated sectors, withheld state); Deep Dive (AAPL fallback dossier
  with quote/fundamentals/analysts/48-contract options snapshot); Supply Chain (withheld edges +
  17-row pipeline shock table); Watchlist (add NVDA via button and MSFT via `requestSubmit`,
  `localStorage mt_watchlist` persisted, evidence cards rendered); Alerts (blocked-permission
  state, empty list); AI chat (generic question → grounded speed-tier reply with evidence
  disclosure).
- Mobile 375×812: no horizontal overflow (`scrollWidth 375`), chart and cards stack.
- Console: only (a) service-worker registration failure on `http://localhost` inside the pane —
  the same registration succeeds on production HTTPS in the same pane, headers are equivalent,
  classified ENVIRONMENT; (b) CORS/403 storm from browser-direct `api.airplanes.live` (BACKLOG
  B-003); (c) transient `ERR_CONNECTION_REFUSED` during my own server restarts.
- Level: REAL BROWSER TESTED (local). Production browser pass: SW registration + asset version
  only. Not verified: physical Enter-key submit on the watchlist form (synthetic key in the pane
  did not submit; DOM `requestSubmit` works), installed-PWA behaviour, push delivery end-to-end,
  3D globe, webcams/fires layers (no keys).

### Deep Research history investigation
- `git log` (74 commits), `git log -i --pickaxe-regex -S'deep[ -_]?research'` across all history,
  and greps of docs/prompts: **no artifact named "Deep Research" has ever existed in this repo.**
- Best-evidence candidate for "the original first-complete Claude implementation later degraded":
  the DEEP DIVE analyst report, first complete at `42af0f6` (2026-06-27, "Add DEEP DIVE tab: AI
  analyst report with invest + options ratings", Co-Authored-By Claude Opus 4.8). Files:
  `public/index.html` (+18), `public/intel.js` (+133: `renderDeepDive`, `loadDeepDive`,
  `consensusBar`, RATING/BIAS classes), `public/style.css` (+70), plus `DEEPDIVE_SYSTEM` and
  `/api/intel/deepdive` in `worker.js`/`server.js`. Enriched at `6fafe78` (2026-07-03: technical
  bias / entry zone / stop / target level chips; same commit added the floating "AI RESEARCH"
  chat panel).
- Original experience: single input + ANALYZE; spinner status "Running deep analysis on X…
  (gathering live news, fundamentals & analyst views, then reasoning)"; one-shot JSON render:
  header (logo/ticker/name/quote), executive summary, STOCK rating card (rating, 1-100 score,
  conviction, horizon, thesis, fair value) + OPTIONS card (bias, score, IV, timeframe,
  recommendation, rationale), "What's moving it", bull/bear ×3, catalysts/risks, key stats,
  analyst-consensus bar, "Open in Terminal", disclaimer. No progress steps, no streaming.
  Sources: headlines were passed to the model but **not rendered as citations**; the only
  provenance was the Finnhub consensus bar and stats.
- Later material changes: `5a10b79` (2026-07-16) policy gate + placeholders; `20c9252`,
  `8a8b980` (independent verifier requirement); `9370cc3`/`953c0ea` (2026-08-04 deterministic
  dossier, two-phase `?ai=1`); `ebacf62` (options snapshot); `1bf0c64` (2026-08-11) removed the
  four suppressors, restored the analyst prompt grounded in the Nasdaq chain, and merged dossier
  + analysis. Regression vs intent: the 07-16→08-04 chain was intentional policy work that made the
  surface unusable (four stacked suppressors); 08-11 restored the prompt but production still
  falls back because no heavy provider succeeds (see B-002).
- Alternative candidate: the "AI RESEARCH" chat panel (`6fafe78`). It was never "deep": single-turn
  Q&A. Lower fit.
- Decision needed: see DECISIONS.md D-001 (PROPOSED). Level: evidence from git history only.

### Closure (OWNER-authorized) — commit `fa52e1a` → production
- Diff review: every hunk in the 5 code/test files mapped to R1–R4; no unrelated modification;
  owner untracked files excluded and preserved.
- Local re-run on the exact committed tree: unit 62/62 · smoke 34/34 (2 keyed skips: fires,
  webcams-live) · ai-eval thresholds pass. Level: INTEGRATION TESTED.
- Frontend versioning: `20260920a` verified unused; all seven `?v=` refs bumped together.
- Commit `fa52e1a` "Complete MT2-0 BLACKBOX baseline and Project Meridian control plane";
  `git push origin main` → `1bf0c64..fa52e1a` (normal push, no force).
- Cloudflare GitHub build: production shell switched from `20260811a` to `20260920a` at
  09:14:06 IST (≈2 min after push). Deployed revision confirmed by served asset version and by
  the repaired weather route behaviour (below), not assumed.
- `npm run test:prod` → **36/36 passed** (includes the two new strict checks). Level: LIVE TESTED.
- Focused production probes (read-only):
  - R2 weather: `/api/map/weather` → 200, 71 points, provenance present (was 502 pre-deploy).
    **LIVE TESTED.**
  - R3/R4 NEWS: `/api/intel/news?nocache=1` → 12 items, 0 degraded, 0 raw entities.
    **LIVE TESTED** (no regression; which speed provider won is not exposed, so the Groq-specific
    path is proven locally, not in production).
  - R1 ETF chart: `/api/chart?symbol=SPY|QQQ&range=1D|1Y` → 200 via `yahoo`. Yahoo is not
    rate-limited from Cloudflare egress, so the Nasdaq `etf` fallback branch was **not exercised
    in production**; it is INTEGRATION TESTED locally and deployed (IMPLEMENTED) in the Worker.
  - Parity: identical R1–R4 hunks in server.js and worker.js (diff review); contract routes
    36/36 on the Worker.
- Production browser (built-in pane, desktop): all assets `20260920a`, service worker registered
  (1 registration); Terminal live AAPL quote/chart; Global Intel → Briefing renders enriched cards,
  no degraded banner, no raw entities; Deep Dive AAPL → explicit "AI ANALYSIS UNAVAILABLE — LIVE
  DATA SHOWN" fallback dossier (github `Error` + cfai `generation failed`, B-002, safe abstention);
  Watchlist empty state; Alerts shows corroborated items with blocked-permission notice.
  Console: no errors on any of the five views. Level: REAL BROWSER TESTED (production).
- Not verified in production: ETF Nasdaq fallback branch (see above), mobile viewport on
  production, physical Enter on watchlist (B-012), push delivery, installed PWA.

---

## MT2-1 REWIND — 2026-09-20 — source HEAD `70bc973` + REWIND working tree

### Baseline and routing
- Repo: `main` @ `70bc973`, tracked tree clean, 3 untracked owner files preserved untouched.
- Route verified from the live session (not inherited): `claude-opus-5` / effort `medium` /
  bypass-permissions / serial. Classification BEHAVIORAL + STRUCTURAL (frontend render
  extraction; no durable state, no security authority, no secrets). Change required: NO.

### Historical source of truth (git, not memory)
- `42af0f6` diff read in full: `public/index.html` (tab + form + status + result), `public/intel.js`
  (render + load + tab lifecycle), `public/style.css` (dd-* rules), `worker.js`
  (`DEEPDIVE_SYSTEM` + `fetchDeepDive` + route; `server.js` caught up in `f316b3f`).
- `6fafe78` diff read for the level chips only (`technicalBias/entryZone/stopLoss/priceTarget`
  → `.dd-levels`); the AI chat panel in the same commit is unrelated and untouched.
- Restoration matrix (12 rows) recorded in the checkpoint transcript and summarised in
  DECISIONS D-003: RESTORE report-first hierarchy, STOCK/OPTIONS cards in both states, status
  clearing, submit/first-open/REFRESH/timer refresh model; ADAPT provenance/evidence into a
  bottom "KEY DATA & SOURCES" section and the unavailable notice into one compact strip;
  PRESERVE pooled quote, dossier, chain normalisation, merge authority, evidence gate, provider
  safety, URL sanitation, hardened logo error handling, QUANT LAB, 15-min timer.

### Current implementation audit (narrow)
- Backend already carries the restored analyst prompt grounded in the Nasdaq chain (`1bf0c64`),
  the evidence gate, heavy-tier requirement, and `mergeAnalysisWithDossier` /
  `mergeFallbackWithDossier`. No backend change was needed; `server.js`, `worker.js`, and
  `shared/` are byte-identical to `70bc973` (parity preserved by construction).
- Observed defect in the live local product before change: policy panel + 5-tile provenance grid
  rendered **above** the executive summary; fallback replaced the STOCK card with a green
  "EQUITY DATA 100/100 AVAILABLE" coverage card that reads as a score; the status line duplicated
  the in-card notice. Level: REAL BROWSER TESTED (local, pre-change screenshots).

### Change
- New `public/deepdive.js`: pure renderer `renderDeepDiveReport(d)` (no DOM), dual-exported
  (`module.exports` + `globalThis.MarketTerminalDeepDiveRender`), render contract `2026-09-20a`.
- `public/intel.js`: Deep Dive block reduced to mount + click wiring + QUANT LAB; status clears on
  success; loading text restored to the 42af0f6 phrasing (stages are real: gather, then attempt
  generation); `analyze` exempt from focus/visibility refresh; Quant Lab history fetch returns if
  the report was re-rendered mid-flight.
- `public/style.css`: `.dd-notice`, `.rate-unrated`, `.bias-chain`, `.dd-sources`, `.dd-chain-ctx`,
  `.dd-grounding`, `.dd-cited`; stale `rate-data/rate-partial/bias-data/dd-data-note` removed.
- `public/index.html`: original tab subtitle/status copy; `deepdive.js` loaded before `intel.js`;
  all eight `?v=` refs → `20260920c` (`20260920b` was the deployed version).
- `tests/smoke.js`: shell contract now expects eight synchronized asset versions.

### Tests
- New `tests/deep-dive-render.test.js` (5 tests): contract version; analysis-state hierarchy
  (ordering assertion over 16 markers, STOCK/OPTIONS content, IV "(inferred)", measured chain
  context, level chips, measured stats/consensus win, sources at bottom, cited links); fallback
  state (notice first, NOT RATED / —/100, no fair value, CHAIN ONLY with measured ATM bid/ask
  and P/C, no levels, observation labels, model-supplied `Strong Buy`/`$999` ignored); no-chain
  fallback; URL/escape safety (`javascript:` logo, chain URL, evidence URL never emitted; model
  text escaped).
- Test-the-test: forcing the fallback to render the model's rating → 4/5 pass, 1 fail (the
  fallback test), restored → 5/5.
- `npm run test:unit` → **67/67** (62 baseline + 5 new). Level: UNIT TESTED.
- `node tests/smoke.js` (local) → **34/34**, 2 keyed skips (fires, webcams-live); the deep-dive
  contract check (`2026-08-11a` schema, dossier fields, chain fields, Not Rated / Data Only under
  fallback) passes unchanged. Level: INTEGRATION TESTED.
- `npm run test:ai-eval` → `thresholdsPassed: true` (offline fixtures).
- `wrangler deploy --dry-run` → bundles.

### Local browser acceptance (built-in pane, http://localhost:3000)
- Desktop fallback (real live path, AAPL then NVDA): restored hierarchy — head → compact amber
  "AI ANALYSIS UNAVAILABLE — LIVE DATA SHOWN" strip (reason: evidence gate for NVDA / no approved
  provider for AAPL) → summary → STOCK `NOT RATED —/100` + OPTIONS `CHAIN ONLY 47 rows` with
  measured ATM 222.50 call 1.45/1.59, put 1.88/2.01, P/C 0.381, source-chain link → observed
  inputs → four observation quadrants → stats → consensus bar → KEY DATA & SOURCES (5 tiles + 6
  evidence rows) → Open in Terminal → disclaimer → QUANT LAB. Status line empty after load.
- Desktop analysis state: the real live NVDA dossier merged with a simulated analysis payload and
  pushed through the real `renderDeepDiveReport` in the page: STOCK `Buy 76/100`, fair value,
  OPTIONS `Calls 63/100` with `IV Medium (inferred)` + measured chain context, level chips, bull/
  bear/catalysts/risks, cited-source markers, grounding line, no notice above the summary.
  **Simulated payload** — the live heavy-provider path is not exercisable locally (B-002 applies
  to `.env` too). Level: REAL BROWSER TESTED (render path), not LIVE TESTED (generation).
- Refresh model: synthetic `focus` + `visibilitychange` → deep-dive fetch count stays 1; double
  REFRESH click → 3 fetches, Quant Lab intact, no new console error (the one `TypeError` in the
  pane log is from the previous `20260920b` bundle and reproduced the pre-existing race that the
  guard now prevents).
- Mobile 375×812: no horizontal overflow (card 343 px), input usable, notice/cards/quadrants/
  tiles reflow to one or two columns, evidence rows stack, button reachable.
- Reload with `?tab=analyze`: one fetch, report renders, all seven script tags `20260920c`.
- Click-through "Open NVDA in Terminal →" → terminal view active, `state.symbol = NVDA`.
- Console: only the pane's ServiceWorker registration failure ("unknown error occurred when
  fetching the script"), a built-in-browser artifact seen on every page load, unrelated to Deep
  Dive. Level: REAL BROWSER TESTED (local).
- Stale-asset finding: with the version unchanged the pane served the cached `intel.js`
  (transfer 300 B) and ran the old focus handler — direct evidence for the bump-on-every-deploy
  rule; verified again after the bump (transfer 120 KB, exemption active).
