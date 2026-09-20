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

### Production acceptance — commit `f4a162a` → production
- `git push origin main` → `70bc973..f4a162a` (normal push). Cloudflare GitHub build switched the
  production shell from `20260920b` to `20260920c` at 09:41:25 IST (≈2.5 min after push);
  `GET /` carries eight `20260920c` refs; `GET /deepdive.js?v=20260920c` → 200, 17,702 B.
- `npm run test:prod` → **36/36 passed** (eight-asset shell contract, deep-dive contract, all
  route contracts). Level: LIVE TESTED.
- Production browser (built-in pane, desktop): `?tab=analyze` renders NVDA fallback (evidence
  gate: 1 normalized source); ANALYZE with `AAPL` → AAPL fallback in ~3 s with the truthful B-002
  strip "Configured provider attempts completed, but no output passed the task schema and evidence
  checks · no model output accepted after 2 attempts (github, cfai)"; restored hierarchy: head →
  strip → summary → STOCK `NOT RATED —/100` + OPTIONS `CHAIN ONLY 48 rows` (ATM 335.00 call
  2.27/2.56 · put 1.29/1.70, put/call 0.455, nearest September 21, 2026, Nasdaq source link) →
  observed inputs → quadrants → stats ($4.91T, P/E 38.0, P/B 51.0, β 1.09, 52W 344.57/236.65,
  92.2%) → consensus (53) → KEY DATA & SOURCES (5 tiles, 6 evidence rows with https publisher /
  known-redirect links) → Open in Terminal → disclaimer → QUANT LAB. Status line empty. No
  horizontal overflow. Console: **no errors**. Level: REAL BROWSER TESTED (production).
- Production mobile 375×812: no horizontal overflow; input, notice, cards, quadrants reflow;
  all script tags `20260920c`.
- Production navigation: Terminal, Global Intel, Sectors, Supply Chain, Watchlist, Alerts, Deep
  Dive all activate and render their headers/content; chart canvas present; console clean.
- Pane artifact noted (not a product defect): a synthetic Return in `#ddInput` did not submit
  the form in the built-in pane (same symptom as B-012); the ANALYZE button — the same submit
  handler — works. Physical Enter remains a HUMAN check.
- **Not claimed:** generated-analysis acceptance in production. B-002 is unchanged (github fails,
  cfai produces no accepted output); the analysis state is REAL BROWSER TESTED locally through the
  real render path with a simulated payload and UNIT TESTED, not LIVE TESTED.
- Closure commit bumps assets to `20260920d` (deploy rule), docs/seam only otherwise.

---

## MT2-2 QUARTZ — design system + application shell (2026-09-20)

### Baseline and routing
- Baseline: `main` @ `6ffb81c` (= expected), single worktree, tracked tree clean, three untracked
  owner files preserved untouched. Route verified from the live session: `claude-opus-5`, serial,
  bypass-permissions; effort not observable in-session (STATE.md records medium). Classified
  STRUCTURAL + BEHAVIORAL frontend; no routing stop.
- No owner-supplied Apple/platform research existed in the workspace (grep of docs/ and the
  master prompt); HIG principles were applied directly (hierarchy, deference, system type,
  tabular numerals, 8-pt spacing, segmented controls, toolbars, visible focus, reduced motion).

### Before (narrow UI inventory, from index.html/style.css/app.js/intel.js at 6ffb81c)
- Website-style header with emoji "💬 ASK AI" and "🤖 Why is it moving?"; seven flat tabs; emoji
  pill sub-tabs (📡 🛰 📈 🚢) inside Global Intel; 7–10 px rounded cards with gradient banners;
  amber as text colour for every label/heading; all-monospace body type; per-panel ad-hoc
  spacing and colours (≈40 hard-coded hex values); AI chat as blue speech bubbles; Quant Lab
  embedded at the bottom of every Deep Dive; sentiment gauge inside the Terminal.

### Implemented
- `public/shell.js` (new, 2026-09-20a): pure navigation + market-mode registry, dual export.
- `tests/shell-nav.test.js` (new, 8 tests): hierarchy/order, every enabled target → existing
  `#view-*`/`#gi-*` id in index.html, Portfolio cannot resolve/hash/appear in enabledTargets,
  exactly one active market (US) with India reserved, locate() inverse of resolve(), legacy
  `?tab=` and `#/…` mapping. Test-the-test: the index.html assertion failed before the new views
  existed (`index.html is missing #view-markets`) and passed after.
- `public/index.html`: chrome (brand · market mode · command · session), tape, `#primaryNav`,
  `#subNav`, workspaces MARKETS/TERMINAL/INTELLIGENCE/SECTORS/DEEP DIVE/SUPPLY/WATCHLIST/QUANT/
  ALERTS, research-assistant drawer, status bar; nine `?v=20260920e` assets. All JS-bound ids
  preserved (`symbolInput`, `goBtn`, `autocomplete`, `qSymbol`…`sPE`, `chartCanvas`, osc/KC/MC
  buttons, `sent*`, `dd*`, `sc*`, `watch*`, `alert*`, `aiChat*`, map/globe containers).
- `public/style.css`: rewritten in ten layers with semantic tokens + legacy aliases (see D-006).
- `public/app.js`: `navigateTo()/renderShellNav()/renderSubnav()/syncShellNav()` with roving
  tabindex (←/→/Home/End, Enter/Space), `/` focuses the command bar, hash + legacy `?tab=` deep
  links, command → Terminal, MARKETS loader (`/api/quote` for SPY/QQQ/DIA/IWM, freshness badge
  derived only from the quote timestamp and session state), market-context registry, chart
  "Loading" overlay suppressed during silent refreshes, aria-pressed on chart toggles, emoji
  labels removed.
- `public/intel.js`: `mt:gisub` listener, Quant Lab extracted into `mountQuantLab()` for the
  QUANT workspace with Deep Dive/Terminal subject rules, "Open … in Quant Lab" action, emoji
  labels removed, aria-expanded on the assistant toggle. `public/deepdive.js` untouched.
- `tests/smoke.js`: shell contract = nine synchronized assets + nav/workspace ids + shell.js.

### Local verification
- Unit: `node --test tests/*.test.js` → **75/75** (67 prior + 8 shell-nav). Deep Dive render
  tests unchanged and passing (REWIND contract).
- Smoke (local server): **34/34** passed, keyed fires/webcams skipped as before.
- AI eval: `npm run test:ai-eval` → thresholdsPassed true.
- Wrangler dry-run bundling: OK.
- Browser (built-in pane, http://localhost:3000, viewport 1440×900 and 1280×800):
  Terminal renders security band + chart-dominant grid + rail; MARKETS renders 4 benchmark rows
  (SPY 761.69 −0.12 % … IWM 284.10 −0.47 %) with `SNAPSHOT` freshness (market closed), the
  sentiment gauge (Neutral −0.05, 4 benchmarks · 18 headlines · 9 sources) and the market
  context table (US active · India "Not yet active"); RESEARCH subnav (Deep Dive · Sectors);
  Deep Dive NVDA fallback keeps the full REWIND hierarchy (head → strip → summary → NOT RATED /
  CHAIN ONLY 47 rows → observed inputs → quadrants → stats → consensus → KEY DATA & SOURCES →
  Open in Terminal → disclaimer) and ends with "Open NVDA in Quant Lab"; QUANT workspace mounts
  the lab (RJD MC 2,000 paths, B-S pricer, Greeks, indicator suite) for NVDA; INTELLIGENCE subnav
  (Briefing · Situation Room · Investment Report · Supply Chain · Global Map) all open — briefing
  cards, situation/report abstention states (B-002), supply chain + shock table, Leaflet map with
  layer panel; Watchlist persisted NVDA and rendered; Alerts CTA + hint + empty state.
- Disabled surfaces: clicking PORTFOLIO leaves the Terminal active and writes "Portfolio arrives
  with MT2-4 LEDGER. Nothing is tracked yet." to the status line; `aria-disabled="true"`. India
  is `aria-disabled`, `aria-pressed="false"`, inert.
- Keyboard: nav ArrowRight×2 from Terminal → Watchlist focused; Enter (keydown) activates →
  `view-watchlist`, hash `#/watchlist`; `/` from body focuses `#symbolInput`.
- Explain move → interpretation block with evidence-insufficient label and related headlines;
  Ask → drawer opens with `aria-expanded="true"`.
- Mobile 375×812: `scrollWidth === innerWidth === 375` on Terminal, Markets, Deep Dive; chrome
  reflows to brand/session · mode · command rows; nav scrolls horizontally; stats 4-up.
- Console: only the pane's ServiceWorker registration artifact ("unknown error occurred when
  fetching the script"), previously documented in REWIND; all nine local assets and all API
  calls 200. Level: REAL BROWSER TESTED (local).
- Screenshots were inspected in the pane; no binary artifacts were added to Git (repository
  convention).

### Production acceptance — commit `b46bbb2` → production
- `git push origin main` → `6ffb81c..b46bbb2` (normal push, no force). Production switched from
  `20260920d` to `20260920e` at 10:16:00 local (≈2 min after push); `GET /` carries nine
  `20260920e` refs; `GET /shell.js?v=20260920e` → 200, 6,463 B.
- `npm run test:prod` → **36/36 passed** (nine-asset shell contract + nav/workspace ids + all
  route contracts). Level: LIVE TESTED.
- Production browser (built-in pane, 1440×900): shell renders with all eight nav items,
  PORTFOLIO `aria-disabled` "Soon", market mode US active / India "Soon" inert; Terminal AAPL
  336.13 −0.87 (−0.26 %) with security band, chart, quant snapshot, company, news; **console: no
  errors** on load. MARKETS: SPY/QQQ/DIA/IWM rows from the pooled quote route (761.69 / 721.45 /
  515.88 / 284.10) labelled `Snapshot` (market closed), sentiment Neutral −0.12, market context
  US `CLOSED · Active · data context` / India `Not yet active`. RESEARCH → Deep Dive AAPL renders
  `data-dd-state="fallback"` with the REWIND order head → notice → summary → ratings (NOT RATED /
  CHAIN ONLY 48 rows) → drivers → cases ×2 → stats → consensus → sources → open → disclaimer,
  status line empty, plus "Open AAPL in Quant Lab". Programmatic `navigateTo()` over quant,
  intelligence/{briefing,situation,report,supply,map}, research/sectors, watchlist, alerts each
  activated the correct view, subnav selection, Global-Intel panel and hash; Quant Lab mounted
  (`#quantLab` present); Leaflet map initialised. Level: REAL BROWSER TESTED (production).
- Console after opening Global Map: the known B-003 aircraft-layer CORS storm
  (api.airplanes.live) — pre-existing, unrelated to QUARTZ; no other errors.
- Production mobile 375×812: `scrollWidth === innerWidth === 375` on Terminal, Markets, Deep
  Dive and Quant; chrome reflows; nav scrolls horizontally; band shows symbol/price side by side
  with four-up stats.
- Not claimed: generated-analysis acceptance (B-002 unchanged); physical-keyboard Enter in the
  command bar and nav (pane synthetic keys are unreliable — HUMAN check, same as B-012); the
  India mode switch (not implemented by design).
- Closure commit bumps assets to `20260920f` (deploy rule), docs/seam only otherwise.

---

## MT2-1A REWIND RECONCILIATION — 2026-09-20 — HEAD `30bb5eb` (investigative)

- Baseline: `main` @ `30bb5eb` (prompt expected `6ffb81c`; two QUARTZ commits `b46bbb2`,
  `30bb5eb` landed in a separate session and are recorded PASS in the seam). Tracked tree
  clean; 3 untracked owner files preserved. No reset; QUARTZ not touched.
- Searches run (working tree + `git log --all`): case-insensitive `deep research`,
  `deepresearch`, `deep-research`, `deep_research` in content (`-S`) and commit messages
  (`--grep`); file adds/deletes/renames matching `research`; every historical `.ttab` label
  (index.html at every commit); every `/api/intel/*` route string ever in server.js/worker.js;
  every historical code hit for `research`; the OWNER's master prompt. Results in D-007.
- Deep Dive continuity check at HEAD: `public/deepdive.js`, `shared/deep-dive-core.js`, and
  both Deep Dive test files are byte-identical to the MT2-1 closure (`git diff 6ffb81c..HEAD`
  empty for them); `index.html` loads `deepdive.js?v=20260920f`; render + core tests 11/11.
- Production (read-only): `GET /` serves nine `20260920f` refs; `/api/intel/deepdive?q=AAPL`
  → schema `2026-08-11a`, `deterministic-dossier`, `aiNarrativeStatus: unavailable`, Not Rated /
  Data Only, policy `abstained` (B-002 unchanged). Level: LIVE TESTED (observation).
- Classification: **CASE A — SAME SURFACE.** No code changed; docs/mt2 only.

---

## POCKET — iPhone delivery (side-track) — 2026-09-20 — start HEAD `bd51724`

### Ground truth
- Repository: `main` @ `bd51724`, tracked tree clean; 3 untracked owner files preserved
  (`MARKET_TERMINAL_TOTAL_PLATFORM_CODEX_MASTER_PROMPT.{md,txt}`, `worker-startup.cpuprofile`).
  Production `GET /` → 200, nine `?v=20260920g` assets. Web app: vanilla JS, `manifest.json`
  standalone PWA, `sw.js` push-only service worker (no offline cache), `viewport-fit=cover`
  with no `safe-area-inset` CSS.
- Mac: Apple M1, macOS 26.5.2, Command Line Tools 26.6 (`swift 6.3.3`), **no Xcode**
  (`/Library/Developer/CommandLineTools` active; no `/Applications/Xcode*.app`; DerivedData
  from a July install remains), **0 code-signing identities**, `devicectl`/`simctl`/`xctrace`
  absent. App Store Xcode is 27.0 and requires macOS 26.6 (26.7 update is offered by
  `softwareupdate -l`, needs admin password + restart). `mas get 497799835` requires sudo.
  Disk: 33 GiB free.
- iPhone: **none detected** (`system_profiler SPUSBDataType` lists no Apple mobile device).
  Pairing/trust/Developer Mode: not observable.

### Implemented (level: IMPLEMENTED unless stated)
- `ios/project.yml` + generated `ios/MarketTerminal.xcodeproj` (XcodeGen 2.46.0), three
  configurations (Debug/Release → production, Development → local), two schemes, app + XCTest
  targets, automatic signing, no team pinned.
- Swift sources: `AppConfig` (Info.plist → typed config, https enforced), `NavigationPolicy`,
  `DeepLinkRouter`, `TerminalSession` (WKWebView owner: persistent data store, JS on,
  data detectors off, inline media, UA suffix `MarketTerminalIOS/<v>`, navigation + UI
  delegates, response MIME gate, process-termination reload, foreground retry),
  `ContentView`/`StateViews`/`SafariView`/`Theme`, `MarketTerminalApp` (scene phase, onOpenURL).
- Resources: production `Info.plist` (no ATS keys), `Info-Development.plist` (NSAllowsLocalNetworking
  + localhost exception only), asset catalog with an opaque 1024 px icon rendered from the
  QUARTZ favicon path, launch background `#0b0c0f`, accent `#e8b25c`.
- `ios/README.md` (build/sign/install/reinstall/IPA fallback/dev-server/troubleshooting);
  `.gitignore` rules for xcuserdata, DerivedData, build/dist, Local.xcconfig, IPA/archives,
  provisioning profiles, certificates.

### Verification actually performed
- `swiftc -parse` on all 13 Swift files → no errors. Level: IMPLEMENTED (syntax only for the
  UIKit/WebKit/SwiftUI files; the iOS SDK is not present).
- Pure logic compiled **and executed** on macOS: `AppConfig.swift + NavigationPolicy.swift +
  DeepLinkRouter.swift` against a 28-assertion `main.swift` mirroring `MarketTerminalTests`
  → `28/28 passed` (production/development parsing, https rejection, real production host,
  internal/external/new-window/iframe/system/blocked decisions, workspace routes, reserved
  entity routes, destination building). Level: UNIT TESTED (macOS toolchain; the XCTest
  bundle itself has not run — B-020).
- `plutil -lint` both plists → OK. Generated pbxproj carries per-config `INFOPLIST_FILE`,
  `PRODUCT_MODULE_NAME = MarketTerminal`, xcconfig base references, 52 Swift file refs.
- Web suites unchanged and green after the change: `npm run test:unit` 75/75;
  `npm run test:ai-eval` `thresholdsPassed: true`. No tracked web asset changed → no `?v=` bump.
- iPhone-dimension audit of **production** in the built-in browser (Level: REAL BROWSER
  TESTED, not device): portrait 375×812 `scrollWidth 375`, chrome/mode/command/tape/nav/band/
  chart render; landscape 812×375 across `#/terminal, markets, watchlist, research/analyze,
  research/sectors, intelligence/{briefing,situation,supply,map}, quant, alerts` → every route
  shows its view, `scrollWidth === 812` for all, Leaflet map initialises (440 px), Deep Dive
  form renders; console errors only the known B-003 aircraft CORS storm. Landscape chrome
  stack ≈ 170 px (B-016).

### Not achieved (truthfully)
- IOS BUILD TESTED, SIGNED, DEVICE INSTALLED, DEVICE LAUNCHED, REAL DEVICE TESTED, RESTART
  VERIFIED, OWNER ACCEPTED: **none** — no Xcode, no signing identity, no iPhone connected.
  Evidence level reached: **UNIT TESTED (pure logic) / IMPLEMENTED (shell)**.
- No IPA produced (requires Xcode). AltStore not required.

### POCKET continuation — 2026-09-20T09:45Z — HEAD `2eb8a84` + working tree (Xcode phase)
- Environment now: Xcode 26.6 (17F113) at `/Applications/Xcode.app`, iOS 26.5 SDK, iOS 26.5
  simulator runtime (downloaded this session, 8.5 GB), Apple ID account with Personal Team
  `S9HRQZG54C` (found in `com.apple.dt.Xcode.plist` `IDEProvisioningTeamByIdentifier`; pinned
  in git-ignored `ios/Config/Local.xcconfig`). iPhone 17 Pro (`iPhone18,1`, iOS **27.0**,
  UDID `00008150-000A6C923CC0401C`) paired via `devicectl manage pair` (no prompt — previously
  trusted), Developer Mode enabled by the OWNER, DDI services available.
- **IOS BUILD TESTED**: `xcodebuild build` Debug, `platform=iOS,id=<UDID>`, arm64, iphoneos26.5
  → `** BUILD SUCCEEDED **` after two real fixes: (1) `PRODUCT_MODULE_NAME` in `Base.xcconfig`
  leaked to the test target ("Multiple commands produce …swiftmodule") — removed, the app-target
  setting in `project.yml` stands; (2) `codesign: resource fork, Finder information, or similar
  detritus not allowed` — the `.app` under the in-repo `ios/build/` (iCloud-synced, B-001) carried
  `com.apple.FinderInfo`; building into `~/Library/Developer/Xcode/DerivedData/…` resolved it and
  the README now says so.
- **SIGNED**: `Signing Identity: "Apple Development: krishivjain20000@icloud.com (N24JRWS3B9)"`,
  `Provisioning Profile: "iOS Team Provisioning Profile: com.krishivjain.marketterminal"`,
  `codesign -dv` → `TeamIdentifier=S9HRQZG54C`, `get-task-allow` present. The originally chosen
  `com.marketterminal.app` failed with "cannot be registered to your development team because it
  is not available" (owned by another team) → bundle id changed to
  `com.krishivjain.marketterminal` (tracked default; D-008 amended).
- **DEVICE INSTALLED**: `devicectl device install app` → installationURL
  `/private/var/containers/Bundle/Application/53472F4B-…/Market Terminal.app/`;
  `devicectl device info apps` lists `Market Terminal   com.krishivjain.marketterminal   1.0.0   1`.
- First launch refused: `FBSOpenApplicationErrorDomain error 3 … profile has not been explicitly
  trusted by the user` (expected Personal-Team gate). OWNER trusted the profile on the phone.
- **DEVICE LAUNCHED**: `devicectl device process launch` → "Launched application"; process
  `…/Market Terminal.app/Market Terminal` pid 1158 alive after 8 s; `device info crashes` → no
  Market Terminal entries.
- **RESTART VERIFIED (process level)**: `process terminate --pid 1158` → 0 matching processes →
  `process launch` → new pid 1164 alive after 6 s → still 0 crash logs. Visual state restoration
  (last symbol/workspace) was not observed by the engineering session.
- **UNIT TESTED (XCTest, iOS)**: `xcodebuild test` on iPhone 17e simulator → AppConfig 4/4,
  DeepLinkRouter 5/5, NavigationPolicy 8/8 = **17/17**, `** TEST SUCCEEDED **`. The first attempt
  hung 33 min at 0 % CPU while `diskimagesiod` mounted the runtime on the 8 GB M1 (load avg 44–60,
  2.8 GB swap, iCloud daemons syncing the in-repo build dir) — killed, `ios/build/` deleted, rerun
  into `~/Library` DerivedData succeeded.
- Web after the change: `test:unit` 75/75, `test:ai-eval` thresholdsPassed. No `public/` change.
- **NOT achieved / not claimed**: REAL DEVICE TESTED (the 28-point visual acceptance: no Safari
  chrome, production render, navigation, search, workspaces, external-link sheet, portrait/
  landscape, keyboard, background/resume, state after relaunch) — requires eyes on the phone;
  the OWNER took the device. OWNER ACCEPTED: pending. Production connectivity from the phone is
  inferred from launch + no crash only, not observed.

### POCKET closure — 2026-09-20T10:32Z — HEAD `3d100fe`
- **OWNER ACCEPTED**: the OWNER ran the visual acceptance on the iPhone 17 Pro and reported
  "OWNER ACCEPTANCE: PASS" (COMMS 10:32Z). Level: HUMAN ACCEPTED. The engineering session did
  not itself observe the screen (B-022 note stands as provenance, not as an open defect).
- Final checks before push: tracked diff free of team ids / identities / profiles; only
  `ios/Config/Local.xcconfig` and `xcuserdata/` hold owner-specific state and both are ignored;
  the three untracked owner files are untouched; no `public/` change → no `?v=` bump.
- Push + production health recorded in COMMS closure entry.

---

## MT2-3 TWINCORE — 2026-09-20 — start HEAD `7d65fc0`

### Gates
- Baseline: `main` @ `7d65fc0` = `origin/main`, tracked tree clean, 3 untracked owner files
  preserved. Phase identity: MT2-3 TWINCORE (roadmap objective + OWNER brief agree); entry
  requirement satisfied by D-009. Change type: **MIXED** (STRUCTURAL market core + BEHAVIORAL
  routes/UI + TEST-ONLY invariants + DOCUMENTATION). Route from zero: claude-opus-5, SERIAL,
  bypass-permissions — verified live; sufficient for a shared-core + two-runtime change with
  browser acceptance; no ROUTING STOP. POCKET's route was not inherited (re-derived).

### Provider verification (before wiring India — LIVE TESTED, observation)
- Finnhub (local key): `/quote?symbol=RELIANCE.NS` → `{"error":"You don't have access to this
  resource."}`; `NSE:RELIANCE` → all zeros; `/search?q=reliance` → `RELIANCE.NS`, `RPOWER.NS`,
  `RELINFRA.NS`, `RIIL.NS` (search covers NSE, quotes do not).
- Yahoo from this Mac: HTTP 429 on chart, search and ^NSEI (local vantage throttle, B-025).
- Yahoo from production (Cloudflare, pre-TWINCORE routes): `/api/chart?symbol=RELIANCE.NS&range=1D`
  → 73 INR 5-minute bars 09:15→15:15 IST on 2026-09-18, `meta.currency: "INR"`; `/api/quote?
  symbol=RELIANCE.NS` → `c 1226.4, src yahoo`; `^NSEI 23346.4`, `^BSESN 74294.96`, `^INDIAVIX
  11.385` all `src yahoo`; `NIFTY` (bare) → zeros (not a Yahoo symbol).
- Conclusion encoded in `PROVIDER_CAPABILITIES`: India = Yahoo DELAYED quotes/charts + Finnhub
  search only; fundamentals/news/options UNAVAILABLE (B-027).

### Implemented
- `shared/market-core.js` (schema `2026-09-20a`): markets, identity parser, cache keys, session/
  calendar, money formatting, data truth, provider matrix, invariant helper, catalog.
- server.js + worker.js (parity): `/api/market`; identity-aware `getQuote`/`getQuoteCached`
  (capability-filtered cascade, market-scoped cache, US-only WS cache), `decorateQuote`
  envelope (market, exchange, symbol, canonical, currency, providerSymbol, truth, asOf);
  chart (`decorateChart` with session window; Nasdaq US-only; `chartsrc` tuning US-only);
  search normalisation (US no-dot filter kept; IN keeps NSE/BSE, canonicalises, dedupes);
  ticker per market (basket, last-good, truth); profile/metrics/news `marketUnavailable`;
  sentiment per market (benchmarks + feeds, `isForeignBenchmark` guard, `sentiment:market:<id>`);
  Deep Dive `?market=` with measured `market` block, INR-aware summary, options/fundamentals
  skipped not faked; `shared/api-contract.js` registers `/api/market`.
- Frontend: `shell.js` two active markets + `mt:market` persistence + per-market last-symbol key;
  `app.js` `Market` context (catalog from `/api/market`, offline fallback), mode buttons and
  registry rows switch markets, IST/ET clock + status from the market's own calendar, market-
  aware tape/quote/profile/metrics/news/chart/search/sentiment/MARKETS table/quant benchmark
  (`Beta vs NIFTY 50`), INR digit grouping, currency chip + truth badge in the security band,
  1D canvas on the market session window, tooltip in market tz, label-aware chart gutter;
  `intel.js` Deep Dive + Quant Lab carry `market=` and reset on `mt:market`; `deepdive.js`
  currency-aware money + exchange/currency/truth chip; `index.html` assets `20260920h`.

### Tests (UNIT TESTED)
- `tests/market-core.test.js` 18 tests incl. the six required negative controls: SPY under
  India, INR rendered as USD, India using NYSE holidays (and US using NSE holidays), market
  missing from cache identity, provider suffix in canonical identity, delayed Indian data as
  REALTIME. `tests/deep-dive-render.test.js` INR-never-`$` control **caught a real leak** in the
  dossier summary (`formatPrice` hardcoded `$`) → fixed in `shared/deep-dive-core.js`.
- Full unit suite 96/96; ai-eval thresholds pass; Wrangler dry-run bundles (472 KiB).
- Local smoke (server from the non-iCloud mirror, B-023): **45/45**, skips = India 1D chart
  (Yahoo 429 locally), fires, webcams. New contracts: catalog, 404, legacy US envelope,
  IN quote envelope + suffix inference, three UNAVAILABLE routes, IN search (no suffix, NSE/BSE
  only, AAPL never under IN), IN ticker, IN chart session window, IN sentiment universe.

### Local browser pass (REAL BROWSER TESTED, localhost, desktop 800×600 + mobile 375×812)
- US boot: catalog loaded, `USD` chip, truth badge, `Beta vs SPY`, ET clock.
- US → INDIA (mode button): `mt:market=IN`, clock `19:58 IST`, status title `NSE · BSE · IST ·
  09:15–15:30 IST`, RELIANCE 1,226.40 ▼17.50 (−1.41%) `INR`, `NSE` exchange, fundamentals
  "Not available for NSE on current providers", company news unavailable notice, tape =
  RELIANCE/TCS/HDFCBANK/INFY/ICICIBANK/SBIN/ITC with per-item truth ("End of day quote · INR
  from yahoo" / LAST GOOD / No quote), `Beta vs NIFTY 50`, `mt:lastSymbol:IN=RELIANCE` while
  `mt:lastSymbol=NVDA` kept. Chart: "Yahoo responded 429" (local throttle, B-025).
- Reload (`#/markets`): India persisted; "India benchmarks · INR" ^NSEI/^BSESN/^NSEBANK/
  ^INDIAVIX (unavailable under throttle); India sentiment "18 headlines · 4 sources · degraded";
  registry shows US "Available · switch".
- INDIA → US (registry row): SPY/QQQ/DIA/IWM `eod`, `USD`, US sentiment, US tape, NVDA restored.
- India search "infosys": INFY NSE, HCL-INSYS NSE, SLONE NSE, 530801 BSE, 511597 BSE.
- Mobile 375×812: `scrollWidth 375` in both markets; mode pills fit (103 px); India 1D chart
  rendered once (IST axis 10:00 AM–2:00 PM) — exposed the 4-digit y-label clip → gutter fix.
- Console: one "unknown error occurred when fetching the script" (service-worker fetch on
  localhost; pre-existing, unrelated to TWINCORE — verify on production).
