# Market Terminal

Real-time financial terminal w/ AI market intel, global hazard map, quant engine.

## Build & Run

**Local dev** (Node.js w/ Express):
```bash
npm install
cp .env.example .env  # add keys: FINNHUB_API_KEY, GROQ_API_KEY, VAPID_*
npm start            # http://localhost:3000
```

**Prod** (Cloudflare Workers via GitHub integration):
```bash
git add -A
git commit -m "your message"
git push origin main
```
Deploys to `https://market-terminal.wyjjdyxzsc.workers.dev`

**Tests:** `npm test` now runs unit coverage plus the local smoke suite (server must be running). `npm run test:prod` exercises the deployed Worker contract.

## Core Stack

- **Backend**: Cloudflare Workers (edge) | Node 18+ (local dev)
  - `worker.js` (prod): fetch router, KV cache, AI pool, WebSocket proxies
  - `server.js` (local): Express, same API surface as worker.js
- **Frontend**: Vanilla JS, canvas (no frameworks)
  - `app.js`: UI, chart renderer, panel logic
  - `quant.js`: Pure math IIFE (30+ functions, no DOM)
  - `intel.js`: Deep Dive + QUANT LAB UI
  - `index.html`: Layout, tabs
- **APIs**: Finnhub (quotes), Yahoo/Nasdaq (charts), Google News RSS, GDELT (conflict), NASA (fires/events), USGS (quakes), Groq (AI), Windy (webcams)
- **Key npm deps** (local only):
  - `express`, `dotenv`, `groq-sdk`, `rss-parser`, `web-push`

## Rules & Conventions

- **No frameworks, no bundler.** Cache-busting via `?v=X` in index.html — **bump `?v=` on EVERY deploy** (format: `YYYYMMDDX` where X is a letter a/b/c…). Never skip this; browsers and Cloudflare edge will serve stale JS/CSS otherwise.
- **Backend**: All errors → 502 JSON + console log. Rate limit: 30 req/min per IP.
- **Quant**: Pure JS, no DOM dependencies. Exported as IIFE singleton `Quant`.
- **Naming**: 
  - Route handlers: `/api/quote`, `/api/intel/news` (keyless prefix if free)
  - Env vars: SCREAMING_SNAKE (API keys), lowercase (internal config)
  - Functions: camelCase; async fns return { data, fresh } (KV SWR pattern)
- **Chart data**: Always OHLC shape `{ t, c, o, h, l }` (ms, USD). 1D clipped to 9:30–16:00 ET.
- **AI routing**: `shared/ai-provider-registry.js` is canonical. Lower-risk tasks may use a bounded first-valid race across speed/eligible medium providers. Generated current-market/high-risk tasks use a bounded generator followed by a different-provider/different-canonical-model verifier; failures and rejections abstain. OpenRouter/Hugging Face cannot independently verify high-risk output; legacy Nebius/OctoAI routes are disabled. Park rate-limited providers: 429 → 1 min, quota → 30 min.
- **Quote pool**: 10 providers serial fallback (Finnhub×5, TwelveData, FMP, AlphaVantage, Polygon, Yahoo keyless). Round-robin Finnhub keys.

## Current State

**Implemented** (v5):
- Live quotes (10-provider pool w/ round-robin Finnhub piggyback)
- Charts (Yahoo/Nasdaq, 1D–5Y, candlestick support)
- News desk, sector analysis, company deep-dive, supply-chain map
- Geopolitical instability, situation room (AI synthesized)
- **Quant (Module 2 complete)**: Full 40-indicator suite in `quant.js` (Float64Array):
  - Trend: SMA/EMA, MACD, ADX, Ichimoku, Parabolic SAR, Hull MA, ZigZag
  - Momentum: RSI, Stochastic, Williams %R, CCI, CMO, MFI, Awesome Oscillator, ROC
  - Volatility: Bollinger Bands, ATR, Keltner, Donchian, Chaikin Volatility, StdDev, Ulcer Index, Historical Vol
  - Volume: OBV, CMF, VWAP, A/D Line, Volume Profile (50 bins), Force Index
  - Risk: Monte Carlo (GBM), Sharpe, Sortino, Calmar, Kelly, Max Drawdown, Tracking Error, Info Ratio, Beta, Treynor
- **Advanced stochastic (Module 2.2)**: Rough Jump-Diffusion MC (Hurst H<0.5 + Poisson jumps), Heston MC + calibrator (Lewis 2001 CF), Malliavin Greeks (Delta/Gamma/Vega via integration-by-parts), Roll Model spread decomposition
- **QUANT LAB UI** (`intel.js`): Full indicator grid (40 indicators across 5 groups), volume profile canvas, model switcher (GBM/RJD/Heston), RJD sub-params (Hurst, lambda, jump μ/σ), Heston sub-params (v0/κ/θ/ξ/ρ), Malliavin Greeks panel, all wired to chart data
- Candlestick pattern detector (18 patterns) + AI analysis endpoint
- Map: 30+ layers — earthquakes, events, weather, conflict, fires, webcams, aircraft, chokepoints, nuclear, military bases, critical minerals, tech HQs, cloud regions, startup hubs, financial centers, commodity ports, trade routes, cables, pipelines, and more
- **Map data architecture**: All curated reference layers now served from `/api/map/layers` with 24h TTL. Live augmentation: IAEA PRIS (nuclear operational status), UNHCR refugee data, Wikidata SPARQL (military installations). Conflict, disease, GPS jamming layers have live API overlays on top (GDELT, ProMED/WHO, gpsjam.org). Frontend `ensureLayerData()` fetches once per page load, falls back to embedded `DATA` if server unavailable.
- **Map provenance/freshness (2026-07-15, production verified)**: `shared/map-provenance-core.js` classifies every map layer and supplies source, cache, refresh-target, snapshot, and served-time metadata. `/api/map/layers` exposes the versioned catalog; live map responses preserve their payloads while adding provenance. The layer panel safely shows class/status/source/cache cadence and a truthful snapshot or served time. Local earthquake and fire routes now match the Worker point contract and refresh targets.
- Alerts: Web Push + breaking-news detection

**New KV cache key**: `cache:map:layers` (24h TTL) — augmented layer dataset

**Module 4 complete** (`app.js` / `index.html` / `style.css`):
- Lower-pane oscillator strip below chart: MACD (histogram + orange line + blue signal), CCI (with ±100 OB/OS zones), Williams %R (with −20/−80 zones). Toggle via `[MACD] [CCI] [W%R]` buttons.
- Keltner Channel shaded band overlay on main chart (toggle `[KC]` button). Alpha-filled band between upper/lower, dashed midline.
- Monte Carlo forward fan: 500 GBM paths projecting from last price into right margin, RAF-batched in 50-path chunks to avoid jank. Toggle `[MC]` button.
- 1D flatline fix was already implemented (walks backward to `fillEndIdx` — no change needed).
- Canvas layout: `padB` now includes 86px lower pane + 6px gap. `.chart-body` is flex-column; canvas flex-grows.

**Phases 3-5 complete** (`server.js`, `worker.js`, `app.js`, `index.html`, `style.css`):
- **Market Sentiment** (Module 4.1): `/api/sentiment/market` — deterministic composite of SPY, QQQ, DIA, IWM, available VIX data, and source-attributed RSS headlines. The payload includes coverage counts, source evidence, methodology, and an explicit degraded state. `/api/sentiment/twitter` remains a deprecated compatibility alias. 15-min TTL. Ported to `worker.js`.
- **Macro Shock Simulator** (Module 3.2): `/api/macro/shock` — 17 major oil/gas pipelines, live CL=F/NG=F spot prices from quote pool, direct_loss = throughput × price, price_shock = -(1/0.1)×dQ/Q. Risk table in Supply Chain view. 5-min TTL. Ported to worker.js.
- **RJD Monte Carlo** (Module 4 upgrade): `[MC]` fan on chart now defaults to Rough Jump-Diffusion (H=0.45, λ=2) with GBM/RJD switcher pill.
- **Mobile layout** (Module 5): osc bar wraps on narrow screens, buttons resize at ≤860px/≤480px, canvas min-height fixed, shock table hides columns on small screens.

**Test suite**: `tests/smoke.js` — run `npm test` (requires local server running) or `npm run test:prod` (hits the deployed worker — run after deploys to catch server.js/worker.js drift). The unit suite has 58 tests and the smoke suite has 35 checks including the shell/version contract, strict seven-symbol ticker data, POST `/api/intel/chat`, sector/company/candle policy contracts, Deep Dive deterministic/options-data contract, and alert-state authority; optional keyed/network routes are skipped locally when unavailable. `npm run test:ai-eval` runs the versioned offline AI policy-safety fixtures.

**Resilience/UX (2026-07-05)**:
- Terminal auto-loads last viewed symbol (localStorage `mt:lastSymbol`, default AAPL)
- Intel briefing degrades to raw RSS headlines when the AI pool is exhausted (per-item `degraded: true` flag, in both server.js and worker.js); briefing error/degraded states have a Retry button
- Market sentiment stays visible with explicit partial-coverage labeling when benchmark or RSS evidence is incomplete; it refreshes every 15 minutes.

**Platform hardening (2026-07-13 checkpoint)**:
- Shared API contract registry in `shared/api-contract.js` now enforces canonical route parity, structured JSON `404`/`405`, websocket `426`, and admin-only diagnostics/push test routes in both `server.js` and `worker.js`
- Shared evidence pipeline in `shared/evidence-core.js` preserves source URLs, timestamps, source tiers, and newsroom freshness metadata for intelligence/news flows
- Shared deterministic candle engine in `shared/candle-analysis-core.js` keeps `/api/intel/candles` working when intraday OHLC or the AI pool is unavailable; degraded responses explicitly disclose fallback mode
- Frontend rendering now sanitizes provider URLs and removes unsafe `innerHTML` usage in price-action / intel map flows
- Manual browser verification evidence for this checkpoint is recorded in `/Users/krishivjain/Desktop/claude projects/market-terminal/docs/CODEX_HANDOFF_TO_CLAUDE_2026-07-13.md`

**AI evidence policy (2026-07-16 checkpoint, production verified)**:
- `shared/ai-task-policy-core.js` defines task risk, approved provider tiers/names, evidence thresholds, citation validation, output constraints, and structured abstentions shared by Express and the Worker.
- Supply-chain relationships, investment picks, and country risk scores are withheld until verified input adapters exist. Deep-dive, situation, price-action, and current-market chat outputs must pass their evidence/citation gate. (Deep-dive trade levels, valuation, and options construction were disabled at this checkpoint; see the 2026-08-11 entry below, which supersedes that.)
- Generic educational chat uses the speed tier; current-market and high-risk tasks require policy-approved heavy providers and abstain when unavailable.
- Source commit `5a10b79` is production verified: `24/24` unit tests, `28/28` local smoke contracts, `31/31` production smoke contracts, targeted policy-envelope probes, and an interactive browser pass completed. Independent verification was still open at that checkpoint and is superseded by the checkpoint 6 section below.

**AI authority extension (2026-07-22 checkpoint, production verified)**:
- Schema `2026-07-22a` adds sector analysis and company-news evidence gates plus deterministic authority for candle commentary and alert eligibility.
- Sector ranks/picks/options are withheld, company items bind to canonical evidence, candle output comes only from the OHLC engine, and model-proposed alert priority is ignored unless the deterministic corroboration gate marks it eligible.
- Source commit `20c9252` is production verified: `29/29` unit tests, all 28 keyless-available local smoke contracts, `33/33` deployed contracts, zero dependency vulnerabilities, Wrangler dry-run bundling, targeted probes, and local/production browser passes.

**AI provider verification (2026-07-28 checkpoint, production verified)**:
- Provider/verifier schema `2026-07-26a` and task-policy/cache schema `2026-07-28a` add a current-model provider registry, lifecycle/health state, bounded calls/tokens/latency/cost, actual runtime telemetry, and independent different-provider/different-model verification for every generated current-market/high-risk task. The policy/cache revision prevents incompatible pre-final envelopes from being reused.
- `shared/ai-evaluation-core.js` and `tests/fixtures/ai-eval-2026-07-26a.json` provide 10 versioned offline safety cases. They are regression evidence, not a live-provider benchmark or proof of factual accuracy.
- Source commit `919f1b9` is production verified: `45/45` unit tests, all evaluation thresholds, all 28 keyless-available local smoke contracts, zero dependency vulnerabilities, Wrangler `4.114.0` dry-run bundling, `33/33` deployed contracts, targeted authority probes, and desktop/mobile browser checks passed. Available live high-risk verifier attempts failed closed, so no positive high-risk acceptance is claimed.

**AI availability repair (2026-07-30 checkpoint, production verified)**:
- Evidence, task-policy/cache, and verification schemas are `2026-07-30a`. Redirected Finnhub/Bing publisher links retain a canonical publisher domain only for known redirect hosts, and company AI routes combine RSS with normalized Finnhub company news.
- Verified generation reserves an independent verifier inside the remaining call/cost budget. Failure attempts and safe failure codes are exposed in policy metadata and the UI distinguishes missing providers, generation validation, verifier rejection/unavailability, and budget exhaustion.
- Lower-risk provider races use a shared 4,000-token ceiling and distinguish per-minute throttles from daily/quota exhaustion. Source commit `febefb3` served all seven `20260730a` assets and passed `33/33` deployed contracts; available high-risk routes remained fail-closed and no positive high-risk acceptance is claimed.
- The first deployed NEWS probe exposed a one-card model batch that passed the old non-empty validator. Source commit `90c191b` added NEWS schema/cache `2026-07-30b`, requires six enriched items when six inputs exist, and otherwise serves the canonical source-linked degraded fallback. It passed `50/50` unit tests, the 10-case evaluation, `31/31` available local contracts, zero-vulnerability audit, Wrangler `4.115.0` dry-run bundling, `33/33` production contracts, forced-fresh NEWS probes with 12 linked cards, and a production browser pass with no console errors.

**Deep Dive resilience (2026-08-04 checkpoint, production verified)**:
- `shared/deep-dive-core.js` schema `2026-08-04a` builds a deterministic quote, fundamentals, analyst-consensus, relevant-watch-item, and limitation dossier in both runtimes. Unsupported ratings, valuation, trade levels, and options construction remain withheld.
- Company evidence reserves slots for distinct source domains before recency fills the remaining limit. Deep Dive uses the 10-provider quote pool instead of direct Finnhub quote access, and its cache key includes the dossier schema.
- Source commits `9370cc3` and `953c0ea` are production verified. The final source served all seven `20260804b` assets, passed `33/33`, returned fresh AAPL/Apple/MSFT dossiers in 1.06-1.35 seconds, and showed the data-first pending-to-withheld lifecycle on desktop/mobile without overflow or console errors. Optional AAPL verification took 27.7 seconds separately and failed closed because no independent verifier completed; no positive high-risk acceptance is claimed.
- Local Finnhub WebSocket startup is lazy and reconnects with bounded exponential backoff, preventing an idle five-second reconnect storm from competing with quote/fundamental work.

**Market-data completeness (2026-08-04 checkpoint 9, production verified)**:
- `/api/ticker` uses the canonical quote pool in both runtimes and retains source-attributed last-good values for 24 hours, preventing a Finnhub throttle from replacing valid tape prices with zeroes.
- `shared/options-chain-core.js` normalizes a bounded Nasdaq at-the-money chain snapshot. Deep Dive schema `2026-08-04b` exposes returned rows, expiries, nearest strike, bid/ask, volume/open interest, and put/call ratios for optionable US stocks.
- The `EQUITY DATA` coverage card is now the *fallback* left card, shown only when the AI analysis does not complete; the analysis render shows the `STOCK` rating card instead. (Superseded in part by the 2026-08-11 entry below.)
- Source commit `ebacf62` passed `58/58` unit tests, all `32/32` available local contracts, AI fixture thresholds, zero-vulnerability audit, and Wrangler `4.118.0` dry-run. Production served all seven `20260804d` assets, passed `34/34`, returned all seven tape prices from pooled providers, and rendered SPCX with 100/100 coverage and 47 options rows on desktop/mobile without overflow or console errors.

**Deep Dive analysis restored (2026-08-11, local verification only)**:
- The 2026-07-16 → 2026-08-04 checkpoints had stacked four independent suppressors on Deep Dive, so it could never render analysis: `constrainTaskOutput('intel.deep-dive')` overwrote the model's rating/options/levels with placeholders *after* generation; `DEEPDIVE_SYSTEM` instructed the model to emit those placeholders itself; `requiresIndependentVerifier` forced a second-provider check that never completed; and a two-phase `?ai=1` flow defaulted to a data-only dossier. All four are removed.
- Task-policy schema `2026-08-11a` and Deep Dive schema `2026-08-11a`. `intel.deep-dive` keeps its evidence gate, citation requirement, heavy provider tier, and budgets — it just no longer requires a second independent provider, and its output is no longer clamped.
- The analyst prompt is restored (rating, score, conviction, horizon, fair value, options idea, technical bias, entry/stop/target, bull/bear/catalysts/risks) and is now grounded in the **real Nasdaq chain** via `buildOptionsChainPromptBlock()` — strikes, expiries, bid/ask, volume, and open interest. The feed carries no IV or Greeks, so the prompt requires the model to mark IV as inferred.
- `mergeAnalysisWithDossier()` / `mergeFallbackWithDossier()` in `shared/deep-dive-core.js` are shared by both runtimes: measured fields (quote, stats, consensus, chain, provenance) always win, so a model can never overwrite observed data. When generation fails the dossier is shown as an explicit fallback rather than a wall of "withheld".
- Verified locally: `61/61` unit tests, `32/32` available local smoke contracts, AI fixture thresholds, Wrangler dry-run bundling, and a browser pass covering both the analysis and fallback renders with no Deep Dive console errors.
- **Not yet verified in production, and the live AI path is unproven.** The local `.env` has only `GROQ_API_KEY` (speed tier); `intel.deep-dive` requires a heavy provider (`gemini`, `deepseek`, `cohere`, `github`, `cfai`, `ai21`, `openrouter`, or `huggingface`), so locally it always takes the fallback branch. The analysis render and merge were verified against a simulated payload through the real render path, not against a live model response.

**MT2-1 REWIND — Deep Dive analyst-report experience restored (2026-09-20)**:
- Restoration target (DECISIONS D-001): the first-go DEEP DIVE at `42af0f6` (+ `6fafe78` level chips). The report body now lives in `public/deepdive.js` (`MarketTerminalDeepDiveRender.renderDeepDiveReport`), a pure HTML-string renderer loaded before `intel.js` and unit-tested in `tests/deep-dive-render.test.js`; `intel.js` only mounts it, wires clicks, and appends QUANT LAB.
- Original hierarchy restored: head → summary → STOCK / OPTIONS rating cards → drivers → level chips → bull/bear → catalysts/risks → stats → consensus → **KEY DATA & SOURCES** (provenance tiles + evidence rows + grounding line, moved below the report) → open-in-terminal. The status line clears after load, as originally.
- Two intentional states, both from the same skeleton: **analysis** (`aiNarrativeStatus: 'ready'`) shows rating/score/conviction/horizon/fair value, options idea with IV labelled *(inferred)* plus measured chain context; **fallback** (B-002 or evidence gate) shows one compact `AI ANALYSIS UNAVAILABLE — LIVE DATA SHOWN` strip, a neutral `NOT RATED · —/100` stock card, a `CHAIN ONLY` options card built from measured Nasdaq rows (no IV, no idea), and observation quadrants. The old "EQUITY DATA 100/100 coverage" card is gone.
- Deep Dive is exempt from the focus/visibility auto-refresh (it refreshes on submit, first open, REFRESH, and the 15-min timer only); the Quant Lab history fetch tolerates a re-render mid-flight. Shell contract was eight synchronized `?v=` assets at REWIND (nine after QUARTZ).
- Backend, shared core, evidence/policy gates, and provider safety are unchanged; the shared core's measured-data merge remains authoritative.

**MT2-2 QUARTZ — design system + application shell (2026-09-20)**:
- `public/style.css` is rewritten as a layered system (tokens → base → shell → navigation → controls → data display → workspaces → states → responsive → accessibility). Semantic tokens (`--surface*`, `--separator*`, `--text-*`, `--accent`, `--positive/--negative/--warning/--critical/--info`, spacing `--s-1..6`, radius `--r-sm/md/lg`, control heights, durations, z-index) with legacy aliases (`--panel`, `--amber`, `--mono` …) so JS-rendered markup keeps working. Body type is the system UI stack; all numeric data is monospace with tabular numerals (`.num`).
- `public/shell.js` (pure, dual-exported, tested in `tests/shell-nav.test.js`) is the navigation registry: MARKETS · TERMINAL · PORTFOLIO (reserved, disabled) · WATCHLIST · RESEARCH (Deep Dive, Sectors) · INTELLIGENCE (Briefing, Situation Room, Investment Report, Supply Chain, Global Map) · QUANT · ALERTS, plus the market-mode registry (US active; India reserved). Legacy view ids are unchanged; `app.js` `navigateTo()` maps targets onto them, renders the primary nav/subnav, keeps `#/workspace/item` hashes, and dispatches `mt:gisub` for Global Intel sections. `?tab=` push deep links still work.
- Chrome: brand · market mode · global command (`#symbolInput`, `/` focuses it, choosing a symbol lands on the Terminal) · session status · clock · refresh · Ask. Terminal: security band (identity, price, eight stats, Explain move) → chart with priority space + quant snapshot, right rail with company and news. Market sentiment moved to MARKETS. MARKETS shows a US benchmark table (SPY/QQQ/DIA/IWM via the pooled `/api/quote`), the sentiment gauge, and a market-context registry; India is visibly reserved and inert.
- QUANT is its own workspace: the single Quant Lab instance (`#quantLabMount`) is mounted by `intel.js` `mountQuantLab()` for the Deep Dive subject, else the Terminal symbol; the Deep Dive report ends with "Open … in Quant Lab" instead of embedding the lab. Deep Dive renderer and its render contract are untouched (restyle only).
- Standard vocabularies: freshness badge `.fresh[data-fresh=live|delayed|snapshot|eod|cached|last-good|unavailable]`; `.status` line states (`error`, `policy-status`, `empty`, `data-state`); interpretation register (`.interp`, amber left rule) vs measured data vs `.evidence`. No emoji in navigation or labels; SVG icons only where they aid recognition.
- Shell contract is **nine** synchronized `?v=` assets (production 20260920f after closure) (`tests/smoke.js` also checks nav/workspace ids and `shell.js`). Unit suite 75 tests.

**MT2-3 TWINCORE — dual-market architecture (2026-09-20)**:
- `shared/market-core.js` (schema `2026-09-20a`) is the single source of market truth: `MARKETS.US` / `MARKETS.IN`, `parseInstrument()` → `{ market, exchange, symbol, canonical: 'IN:NSE:RELIANCE', currency, provider: { yahoo: 'RELIANCE.NS', … } }` (suffixes never in identity), `cacheKey()` (throws without a market), `sessionState()` / `sessionBoundsUTC()` (ET vs IST, NYSE vs NSE calendars), `formatMoney()`, `classifyDataTruth()` + `PROVIDER_CAPABILITIES` (ceiling per provider × market; runtime only downgrades), `catalog()` served by `/api/market`.
- **Provider truth (verified)**: Finnhub free tier = US quotes/stream/fundamentals/news + global search; Yahoo keyless = DELAYED quotes/charts for US and NSE/BSE (+ ^NSEI/^BSESN/^NSEBANK/^INDIAVIX) — works from Cloudflare, 429-throttled from the dev Mac; Nasdaq = US charts/options only. India fundamentals/news/options are `UNAVAILABLE` (200 payload), never faked.
- **Contract**: `?market=US|IN` on quote/chart/search/ticker/profile/metrics/news/sentiment/deepdive; omitted → US. Responses carry `market, exchange, symbol, canonical, currency, providerSymbol, truth, asOf`; charts add `session { openUTC, closeUTC, timezone, tzLabel }`. Cache keys are market-scoped (`quote:IN:NSE:RELIANCE`, `ticker:<schema>:IN`, `sentiment:market:IN`). Deep Dive dossier has a measured `market` block; renderer/summary use its currency symbol.
- **Frontend**: `shell.js` MARKETS (both active, `mt:market` persisted, `lastSymbolKey(market)`); `app.js` `Market` context + `setMarket()` (dispatches `mt:market`), `fmtPrice` uses the market locale, `Market.qs()` on every market-scoped fetch, clock/status per market calendar, 1D canvas on the market session, quant beta vs `quantBenchmark` (SPY / NIFTY 50); `intel.js` passes `market=` to Deep Dive and Quant Lab. The Finnhub trade stream is US-only.
- **Invariant tests** (`tests/market-core.test.js`, negative controls): no SPY under India, INR never `$`, no NYSE holidays for NSE, no market-less cache key, no suffix in canonical identity, Yahoo India never REALTIME. Keep them green when touching any market-scoped path.
- **Do not build or run inside the repo folder** — it is iCloud-synced and gets evicted under disk pressure (B-001/B-023). Run the local server from a non-iCloud mirror (`~/Library/Developer/market-terminal-run`: rsync + `npm ci` + copy `.env`).

**MT2-4 ATLAS — geographic market-intelligence foundation (2026-09-21)**:
- `shared/atlas-core.js` (schema `2026-09-21a`): `createGeoEntity()` (validated, sourced, frozen; `authoritative === false` for UNVERIFIED and hidden by default), `LAYERS` registry (5 categories; `renders:false` layers exist for cables/pipelines/facilities with a coverage note), `createCompanyGeoLink()` keyed by the TWINCORE canonical identity (never `.NS`), `createGeoEvent()`/`classifyEventStatus()` (per-category freshness → active/stale/resolved), `filterEntities()` (bbox, market emphasis, ≤2,500), `clusterPoints()`, `searchEntities()`, `atlasCacheKey()`, `buildFromSnapshot()`.
- `shared/atlas-snapshot.js` is **generated** by `tools/atlas-build-snapshot.js` (Wikidata CC0 companies + reference verification, Natural Earth PD ports/airports, WRI GPPD CC BY 4.0 plants) — never hand-edit; rerun the tool (≈10 min, `--verify` for reference points only) and commit.
- Routes: `/api/map/atlas` (registry + snapshot + coverage), `/api/map/entities?layer=&market=&bbox=&zoom=` (clusters below z7), `/api/map/entity?id=`, `/api/map/search?q=&market=`, `/api/map/geoevents?bbox=&category=`. Keep server.js ↔ worker.js parity (the block is copied with adapters for `fetch_cached_data`/`getData`).
- Frontend `public/atlas.js` on the Leaflet map (`mapready`); company → security via `window.MarketTerminal.openSecurity('IN:NSE:RELIANCE', 'terminal'|'deepdive')`. Legacy overlays remain in `mapintel.js` (labelled LEGACY, curated, off by default); the "Infrastructure" canvas mode and all hand-drawn line geometry are retired (D-010) — do not reintroduce unsourced coordinates. Base tiles are OpenStreetMap (attribution required; keep the control).
- Shell contract is **ten** synchronized `?v=` assets (atlas.js added).
- **Canonical working path is `~/Developer/market-terminal`** (non-iCloud). The iCloud copy on the Desktop is frozen; do not engineer there.

**MT2-5 NEXUS — public-company universe + supply-chain intelligence graph (2026-09-22, production verified)**:
- Rebuilds "Supply Chain" (previously a permanently-abstaining stub) into a canonical public-company graph. `shared/nexus-core.js` (schema `2026-09-20a`): `createCompanyNode()`/`createRelationshipEdge()` (frozen, requires real source evidence — no citation, no edge), `computeConfidence({tier, sourceCount, recency})` (the **only** place confidence/strength is ever set — a live-verified invariant, never taken from AI output), `registryCoverage()`, `filterGraph()` (bounded traversal, `maxNodes:75`), `nexusCacheKey()`.
- `shared/nexus-snapshot.js` is **generated** by `tools/nexus-build-registry.js` (SEC EDGAR `company_tickers_exchange.json` for every NYSE/NASDAQ/AMEX issuer + NSE `EQUITY_L.csv`, cross-walked against `atlas-snapshot.js`'s Wikidata dataset for geo enrichment) — never hand-edit; rerun the tool and commit. **13,016 company nodes** (US 10,438 / India 2,578 NSE-only), every entry gets a node regardless of enrichment (`enrichment: 'geo-linked'` 2,155 / `'node-only'` 10,861 — 16.6% geo-linked, reported honestly via `coverage`, not claimed uniform). **BSE contributed zero nodes** — its listing API 403'd from the build network; India coverage is NSE-only until rerun from a network where it succeeds.
- Relationships are tiered and evidence-only, **78 total** (deduplicated by `(source, target, relation)` in the generator itself, so reruns stay clean): tier 1 — SEC XBRL 10-K instance-document customer-concentration disclosures (56 edges; the `companyfacts` aggregate API was tried first and found to structurally omit dimensional-only facts, so the generator parses the real filing XBRL instead), scanned **1,000 of 10,438** US filers for this build (env-driven `NEXUS_TIER1_LIMIT`, code itself uncapped — rerun for fuller coverage); tier 3 — Wikidata `P749` corporate ownership (22 edges), market-disambiguated by a `(market, symbol)` candidate index (a same-named cross-market company, e.g. US Pfizer Inc. vs India's Pfizer Limited, no longer collides). Only **112 of 13,016** companies (0.9%) carry any relationship edge yet — most searches correctly show an honest empty state, not withheld data.
- Tier 2 (live, not pre-generated): AI-extracted relationships for `market.tape` companies only (AAPL, MSFT, NVDA, AMZN, GOOGL, META, TSLA — no broader index-membership field exists yet in `market-core.js`, disclosed rather than faked), gated by the existing `TASK_POLICIES['intel.supply-chain']` policy (heavy provider tier, independent verifier, required evidence ids) — no citation, no relationship. Every tier-2 relationship is rebuilt through `createRelationshipEdge()` before being returned, so its confidence/strength is always deterministic, never AI-assigned; counterparty tickers are validated against the real registry via a `(market, symbol)` index (a bare-ticker `parseInstrument` call was found to default every unresolved US exchange to the literal string `'US'`, not a real exchange — this was fixed at the resolution site, not by working around it).
- Routes: `/api/nexus/registry?query=&sector=&market=` (ranked — exact symbol match always outranks a name substring match, both runtimes), `/api/nexus/company?id=` (404 on unknown, never a fabricated node), `/api/nexus/relationships?id=&type=`, `/api/nexus/graph?id=&depth=` (bounded). `GET /api/intel/supplychain?q=` now genuinely delegates to the same NEXUS lookup (the old `fetchSupplyChain`/hardcoded-abstention stub is removed) and returns 404 for an unresolvable query instead of a 200 abstention — a real, disclosed contract break on a route already marked deprecated. Keep server.js ↔ worker.js parity (verified byte-identical for every shared NEXUS helper).
- Frontend `public/nexus.js` (pure renderer, dual-exported like `deepdive.js`) replaces the dead Supply Chain UI in `intel.js`: registry search → company card (enrichment badge, sector) → merged tier-1/tier-3/tier-2 relationship list (tier-2 rows visually distinguished as AI-extracted-and-cited) → bounded force-graph SVG with visible stroke/fill (both CSS-token-driven and inline presentation attributes, so it renders even if the stylesheet drifts). ATLAS integration: NEXUS → ATLAS via `company.geoEntityId` (when present — 2,155 of 13,016 companies), ATLAS → NEXUS via the existing `openSecurity(id, 'nexus')` path. Shell contract is **eleven** synchronized `?v=` assets (`nexus.js` added).
- Process note: this checkpoint ran a 3-Critical/6-Important whole-branch review after all 8 tasks individually passed their own review — the cross-cutting bugs (tier-2 edges computed but never rendered, zero CSS for the new panel, an unranked search returning the wrong company for exact ticker queries) only became visible once the assembled system was reviewed together, not from any single task's diff. All fixed and re-verified against live production data before this entry was written.
- Source commit `59a7bba` is production verified: `142/142` unit tests, `65/65` production smoke contracts (including the new NEXUS routes, the ranked-search fix, and the delegated legacy alias), and an interactive production browser pass (AAPL → real tier-1 SEC-cited relationship, visible colored graph edge, real tier-2 abstention reason surfaced verbatim, NEXUS→ATLAS link present) with no console errors.
- Explicitly out of scope for this checkpoint (owner directive): MT2-6 through MT2-13.

**MT2-5A CENSUS — listed-company universe completeness lock (2026-09-23, production verified)**:
- Hardening checkpoint, not a NEXUS rebuild. Found and fixed three silent field-mapping bugs in `tools/nexus-build-registry.js`, all pre-dating this checkpoint: (1) BSE's listing API returned **zero** nodes because the generator read `scrip_cd`/`scrip_name` (lowercase) while BSE's live API returns `SCRIP_CD`/`Issuer_Name`/`ISIN_NUMBER` — the MT2-5 record's "BSE 403'd" was an incomplete diagnosis; a direct test showed BSE returns 200 to a plain browser UA (it 403s the SEC-mandated identifying UA used everywhere else in the file, which has no bearing on BSE, which has no SEC-style fair-access policy) and intermittently trips Node's strict HTTP header parser (`HPE_INVALID_HEADER_TOKEN`), worked around with `insecureHTTPParser: true` on that one call only. (2) NSE's ISIN column was read as `r.ISIN`, which does not exist — the real EQUITY_L.csv header is `ISIN NUMBER` — so NSE/BSE cross-listing dedup was never structurally possible before this fix (confirmed: RELIANCE's cross-listed-company count went from 1,448, US CIK dual-class pairs only, to 3,903 once real ISIN matches were possible). (3) SEC's real `OTC`/`CBOE` exchange classifications (2,535 + 44 of 10,459 issuers) were silently folded into `market-core.js`'s consolidated-tape fallback marker alongside genuinely unclassified issuers (219) — fixed by extending `MARKETS.US.exchanges` and the generator's exchange map.
- `shared/nexus-core.js` (schema `2026-09-23a`) adds the **Company vs ListedSecurity separation**: `buildCompanyIndex()` groups ListedSecurity rows (the existing, unchanged `MARKET:EXCHANGE:SYMBOL` id — still what every route/relationship/ATLAS-link keys on) into canonical Company identities keyed by **CIK** for US or **ISIN** for India (`company:us:cik:<CIK>` / `company:in:isin:<ISIN>`); a row with neither becomes its own singleton Company, so every security resolves to exactly one Company by construction — 100% company-identity coverage, never "UNKNOWN". `reconcileAccounting()` requires `fetched = accepted + duplicate + rejected` per source; the build throws on any mismatch.
- Registry rebuilt: **18,087 securities** (US 10,459 / India 7,628 — NSE 2,583 + BSE 5,045, BSE genuinely onboarded for the first time), **13,219 companies** (3,903 cross-listed — e.g. `IN:NSE:RELIANCE` + `IN:BSE:500325` under one Company via ISIN `INE002A01018`; `US:NASDAQ:GOOGL`/`GOOG`/`GOOGM`/`GOOGN` under one Company via CIK), **0 uncovered securities**. Every pre-existing relationship edge was re-validated against the rebuilt id set (an edge whose endpoint's exchange classification changed — e.g. a former `US:US:*` fallback id now correctly `US:OTC:*` — would otherwise dangle); 2 of the prior 78 were orphaned by the reclassification and dropped, none carried forward silently broken. No relationship coverage was expanded — UNKNOWN relationships stay UNKNOWN, per the checkpoint's own scope boundary.
- `nexusCompanyDetail()`/`nexusRegistrySearch()` in server.js/worker.js (additive, byte-identical parity) expose the new `companyIdentity` block (sibling securities of a cross-listed Company) and the full per-source `accounting`; `public/nexus.js` renders sibling listings as clickable "Also listed as …" chips, verified with a working bidirectional click-through (`IN:NSE:RELIANCE` ↔ `IN:BSE:500325`) in both local and production browser passes.
- Source commit `13b4cd3` is production verified: `151/151` unit tests (10 new CENSUS tests incl. CIK/ISIN grouping, a name-similarity negative control, 100%-coverage and reconciliation negative controls, OTC/CBOE real-exchange checks, and a committed-snapshot integrity test), ai-eval thresholds pass, `69/69` production smoke contracts (including the new accounting/cross-listing/OTC contracts), Wrangler dry-run bundling (16.4 MB / 1.41 MB gzip), and a production browser pass (India-mode RELIANCE search → NSE+BSE cross-listing shown and clickable, real tier-3 relationship intact, clean console).
- Explicitly out of scope for this checkpoint (owner directive): MT2-6 LAUNCHPAD and later; expanding relationship coverage merely to raise metrics.

**Branches**: All work on `main` (no feature branches yet).

## Key Files

| File | Purpose |
|---|---|
| `worker.js` | Prod handler, API routes, KV cache, AI pool, WebSocket proxies |
| `server.js` | Local dev (Express), same routes as worker.js |
| `public/app.js` | UI, drawChart(), loadSymbol(), panel logic |
| `public/quant.js` | Math lib (no DOM), IIFE export |
| `public/intel.js` | Deep Dive mount, Quant Lab mount (QUANT workspace), intel views, research assistant |
| `public/shell.js` | MT2 navigation/market-mode registry (pure, unit-tested); app.js renders it |
| `public/style.css` | QUARTZ layered design system (tokens, shell, controls, data display, workspaces, states) |
| `public/deepdive.js` | Pure Deep Dive report renderer (analysis + fallback states), unit-tested |
| `shared/deep-dive-core.js` | Deep Dive dossier, options-chain prompt grounding, and the shared analysis/fallback merges |
| `shared/options-chain-core.js` | Bounded Nasdaq options-chain normalization and availability contract |
| `shared/ticker-core.js` | Pooled ticker normalization and last-good fallback contract |
| `shared/market-core.js` | Canonical US/India market definitions, instrument identity, cache keys, sessions, money, data truth, provider matrix |
| `shared/atlas-core.js` | ATLAS GeoEntity / MapLayer / CompanyGeoLink / GeoEvent model, filtering, clustering, search |
| `shared/atlas-snapshot.js` | Generated sourced datasets (Wikidata, Natural Earth, WRI GPPD) — rebuild with `tools/atlas-build-snapshot.js` |
| `public/atlas.js` | ATLAS map layers, search, drawer, company → security path |
| `shared/nexus-core.js` | NEXUS ListedSecurity (CompanyNode) / RelationshipEdge model + Company identity (`buildCompanyIndex`, CIK/ISIN grouping) + `reconcileAccounting()`, deterministic confidence/strength, bounded graph traversal |
| `shared/nexus-snapshot.js` | Generated sourced company registry (18,087 securities / 13,219 companies) + tier-1/tier-3 relationships — rebuild with `tools/nexus-build-registry.js` |
| `tools/nexus-build-registry.js` | Builds shared/nexus-snapshot.js from SEC EDGAR + NSE + BSE + Wikidata, with full per-source accounting; `--relationships`/`--dedupe-relationships` flags |
| `public/nexus.js` | Pure NEXUS company/graph renderer (evidence rows, force-graph SVG), unit-tested |
| `public/index.html` | Application shell, workspace sections, cache-buster versioning |
| `shared/ai-provider-registry.js` | Current provider/model lifecycle, eligibility, pricing, and health metadata |
| `shared/ai-verification-core.js` | Bounded generation, independent verification, runtime usage/cost telemetry |
| `shared/ai-evaluation-core.js` | Versioned offline AI safety metrics |
| `shared/company-evidence-core.js` | Finnhub company-news normalization into policy evidence |
| `.env` (git-ignored) | FINNHUB_API_KEY, GROQ_API_KEY, POLYGON_KEY, FIRMS_MAP_KEY, WINDY_KEY, VAPID_* |

## Env vars (all optional except noted)

**Market data** (≥1 required):
- `FINNHUB_API_KEY` (**required** for quotes)
- `FINNHUB_API_KEY_2..5` (piggyback)
- `TWELVEDATA_KEY`, `FMP_KEY`, `ALPHAVANTAGE_KEY`, `POLYGON_KEY` (fallback)

**AI**:
- `GROQ_API_KEY` (recommended speed-tier default for NEWS and generic educational chat)
- Generated current-market/high-risk tasks require at least two eligible heavy providers serving different canonical model families, for example `GEMINI_API_KEY` plus `GITHUB_MODELS_TOKEN`.
- Other speed/heavy keys are listed in `.env.example`; brokered `OPENROUTER_API_KEY` and `HF_API_KEY` cannot independently verify high-risk output.
- `AI_PARALLEL=5` (default race width)

**Map**:
- `FIRMS_MAP_KEY` (NASA fires)
- `WINDY_KEY` (webcams)

**Push**:
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (breaking alerts)

**Dev**:
- `PORT=3000` (local server)
- `GROQ_MODEL` (default: `openai/gpt-oss-120b`)
- `ADMIN_API_TOKEN` (optional, enables authenticated admin/test-push routes)

## Logs & Debugging

**Console**:
- `[ai] {provider} WON` → bounded lower-risk race winner
- `[ai] {provider} error: {msg}` → provider error
- `[news] headlines fetched: N` → news cache refresh
- `🔔 pushed alert to N device(s)` → alert sent

**KV keys**:
- `cache:{key}` → SWR cache
- `ai:cooldowns` → rate-limited provider park
- `alerts:state` → breaking alerts state
- `sub:*` → Web Push subscriptions
- `chartsrc` → self-tuning source pref (yahoo|nasdaq)

## Deploy

**Always deploy by pushing to GitHub — do NOT run `wrangler deploy` manually.**

```bash
git add -A
git commit -m "your message"
git push origin main
```

**Why:** GitHub is connected to Cloudflare Workers via the dashboard integration (Workers & Pages → market-terminal → Settings → Builds). Every push to `main` auto-triggers a Cloudflare build and deploys `worker.js` to `https://market-terminal.wyjjdyxzsc.workers.dev`. Manual `wrangler deploy` bypasses this and can create version drift.

Check `wrangler.toml` for KV binding (`MT_KV`), AI binding, asset serving.

## Latest external-agent handoff

- `/Users/krishivjain/Desktop/claude projects/market-terminal/docs/CODEX_HANDOFF_TO_CLAUDE_2026-07-13.md`

**MT2-6 LAUNCHPAD (2026-09-23; production verified)**:
- `shared/launchpad-core.js` normalizes Finnhub IPO calendar records and creates bounded, deterministic graph edges only for observed same-venue/seven-day overlap and cited NEXUS relationships behind a provisional ticker/venue match. No predicted price impact.
- `/api/launchpad/ipos?market=US|IN` is in both runtimes. US uses the configured Finnhub key and 15-minute cache; India explicitly returns `UNAVAILABLE` until a verified feed is configured (D-012/B-037).
- `public/launchpad.js` mounts Research → IPOs, source/field disclosures and the graph. Local unit 154/154, smoke 68/68, AI fixtures, Wrangler dry-run, desktop/mobile browser checks passed. Source commit `190e754` deployed assets `20260923b`, returned 33 live-calendar records, passed production smoke 71/71 and production desktop/mobile browser checks with a clean console. Closure assets `20260923c`.

**MT2-6A PADLOCK (2026-09-23; production verified)**:
- `tools/launchpad-build-snapshot.js` validates current SEBI public-issues listing families and atomically writes `shared/launchpad-snapshot.js` only after structure, nonzero record and accounting checks. The combined snapshot preserves US events and India filing history. Run `node tools/launchpad-build-snapshot.js` to refresh before a deployment; inspect the printed reconciliation.
- `/api/launchpad/ipos?market=IN|ALL` serves India regulatory filing objects and the combined view from the same shared core in Express and Worker. India source URLs, filing states, timelines, currency INR and unknown fields are explicit. US Finnhub live route is unchanged. `public/launchpad.js` adds the India workspace detail within the existing Research → IPOs view.
- SEBI listing metadata and direct links only; do not mirror PDF text. SEBI site policy requires permission for reproduction. NSE/BSE bulk feeds are not connected; listing confirmation requires official exchange URL + ISIN and CENSUS identity. See D-013/B-037.

- Source commit `7b1fd07` deployed assets `20260923d`: 58 India IPOs, 33 US IPOs, 91 combined; 161/161 unit, AI fixtures, 67/67 local smoke, Wrangler dry-run, 72/72 production smoke and desktop/mobile/landscape browser checks passed with a clean console. Closure assets `20260923f`. MT2-7 WORLDWIRE is not authorized.

**MT2-7 WORLDWIRE (2026-09-23; authorized, production acceptance pending)**:
- `shared/worldwire-core.js` and `shared/worldwire-runtime.js` are canonical event/signal, deterministic clustering, bounded retention, source health and adapter implementations. Four enabled sources: GDELT article discovery, USGS quakes, NASA EONET v3, US-only NWS alerts. ACLED is disabled for owner licensing. Source metadata and outbound URLs are retained, full articles are not.
- Existing hourly Worker Cron is configured to run isolated adapters into one batched `MT_KV` state value; local Express uses the same runtime and an ignored atomic JSON file. A separate bounded Cron heartbeat exposes whether production scheduling actually fired. Eight `/api/worldwire/*` routes are bounded and registered in `shared/api-contract.js`. WORLDWIRE is the default Global Intelligence subtab and projects source-coordinate events into ATLAS; canonical evidence gates NEXUS/LAUNCHPAD links. ORACLE and SENTINEL remain untouched.
- Local official feeds succeeded; GDELT timed out and is health-labelled DEGRADED. See D-014, B-038/B-039 and EVIDENCE.md. Do not call WORLDWIRE PASS until a production ingestion cycle and all production acceptance gates have been observed.
- 2026-09-26 continuation: production health remained empty after three days. Local Cron succeeded, but a retention churn defect was fixed: hot state now keeps 1,000 currently observed events and a 48-hour/10,000-ID duplicate ledger; a second scheduled run suppressed all 587 repeated signals with zero new clusters. ATLAS/NEXUS candidate indexes reduced a 584-event cold replay from ~18 seconds to ~145 ms ingest CPU with identical link results. The actual Cloudflare plan is still unverified because Wrangler auth expired. Production Cron and broad GDELT discovery are open gates.
