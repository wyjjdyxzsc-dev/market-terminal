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
