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

**Test suite**: `tests/smoke.js` — run `npm test` (requires local server running) or `npm run test:prod` (hits the deployed worker — run after deploys to catch server.js/worker.js drift). The suite has 34 checks including the shell/version contract, POST `/api/intel/chat`, sector/company/candle policy contracts, and alert-state authority; optional keyed/network routes are skipped locally when unavailable. `npm run test:ai-eval` runs the versioned offline AI policy-safety fixtures.

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
- Supply-chain relationships, investment picks, and country risk scores are withheld until verified input adapters exist. Deep-dive, situation, price-action, and current-market chat outputs must pass their evidence/citation gate; deep-dive trade levels, valuation, and options construction remain disabled.
- Generic educational chat uses the speed tier; current-market and high-risk tasks require policy-approved heavy providers and abstain when unavailable.
- Source commit `5a10b79` is production verified: `24/24` unit tests, `28/28` local smoke contracts, `31/31` production smoke contracts, targeted policy-envelope probes, and an interactive browser pass completed. Independent verification was still open at that checkpoint and is superseded by the checkpoint 6 section below.

**AI authority extension (2026-07-22 checkpoint, production verified)**:
- Schema `2026-07-22a` adds sector analysis and company-news evidence gates plus deterministic authority for candle commentary and alert eligibility.
- Sector ranks/picks/options are withheld, company items bind to canonical evidence, candle output comes only from the OHLC engine, and model-proposed alert priority is ignored unless the deterministic corroboration gate marks it eligible.
- Source commit `20c9252` is production verified: `29/29` unit tests, all 28 keyless-available local smoke contracts, `33/33` deployed contracts, zero dependency vulnerabilities, Wrangler dry-run bundling, targeted probes, and local/production browser passes.

**AI provider verification (2026-07-28 checkpoint, local verified / production pending)**:
- Provider/verifier schema `2026-07-26a` and task-policy/cache schema `2026-07-28a` add a current-model provider registry, lifecycle/health state, bounded calls/tokens/latency/cost, actual runtime telemetry, and independent different-provider/different-model verification for every generated current-market/high-risk task. The policy/cache revision prevents incompatible pre-final envelopes from being reused.
- `shared/ai-evaluation-core.js` and `tests/fixtures/ai-eval-2026-07-26a.json` provide 10 versioned offline safety cases. They are regression evidence, not a live-provider benchmark or proof of factual accuracy.
- Local evidence: `44/44` unit tests, all evaluation thresholds, all 28 keyless-available smoke contracts, zero dependency vulnerabilities, Wrangler `4.114.0` dry-run bundling, targeted probes, and desktop/mobile browser checks passed. Do not call this production verified until managed deployment evidence is recorded.

**Branches**: All work on `main` (no feature branches yet).

## Key Files

| File | Purpose |
|---|---|
| `worker.js` | Prod handler, API routes, KV cache, AI pool, WebSocket proxies |
| `server.js` | Local dev (Express), same routes as worker.js |
| `public/app.js` | UI, drawChart(), loadSymbol(), panel logic |
| `public/quant.js` | Math lib (no DOM), IIFE export |
| `public/intel.js` | Deep Dive UI + QUANT LAB |
| `public/index.html` | Layout, cache-buster versioning |
| `shared/ai-provider-registry.js` | Current provider/model lifecycle, eligibility, pricing, and health metadata |
| `shared/ai-verification-core.js` | Bounded generation, independent verification, runtime usage/cost telemetry |
| `shared/ai-evaluation-core.js` | Versioned offline AI safety metrics |
| `.env` (git-ignored) | FINNHUB_API_KEY, GROQ_API_KEY, POLYGON_KEY, FIRMS_MAP_KEY, WINDY_KEY, VAPID_* |

## Env vars (all optional except noted)

**Market data** (≥1 required):
- `FINNHUB_API_KEY` (**required** for quotes)
- `FINNHUB_API_KEY_2..5` (piggyback)
- `TWELVEDATA_KEY`, `FMP_KEY`, `ALPHAVANTAGE_KEY`, `POLYGON_KEY` (fallback)

**AI** (≥1 required for news/analysis):
- `GROQ_API_KEY` (recommended speed-tier default; any eligible configured provider can serve its permitted tasks)
- `GEMINI_API_KEY`, `CEREBRAS_API_KEY`, `TOGETHER_API_KEY`, `OPENROUTER_API_KEY`, etc. (race pool)
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
