# Market Terminal

Real-time financial terminal w/ AI market intel, global hazard map, quant engine.

## Build & Run

**Local dev** (Node.js w/ Express):
```bash
npm install
cp .env.example .env  # add keys: FINNHUB_API_KEY, GROQ_API_KEY, VAPID_*
npm start            # http://localhost:3000
```

**Prod** (Cloudflare Workers):
```bash
npx wrangler deploy
```
Deploys to `https://market-terminal.wyjjdyxzsc.workers.dev`

**No tests yet.** Manual browser testing required.

## Core Stack

- **Backend**: Cloudflare Workers (edge) | Node 18+ (local dev)
  - `worker.js` (prod): fetch router, KV cache, AI pool, WebSocket proxies
  - `server.js` (local): Express, same API surface as worker.js
- **Frontend**: Vanilla JS, canvas (no frameworks)
  - `app.js`: UI, chart renderer, panel logic
  - `quant.js`: Pure math IIFE (30+ functions, no DOM)
  - `intel.js`: Deep Dive + QUANT LAB UI
  - `index.html`: Layout, tabs
- **APIs**: Finnhub (quotes), Yahoo/Nasdaq (charts), Google News RSS, GDELT (conflict), NASA (fires/events), USGS (quakes), Groq (AI), Windy (webcams), AIS Stream (ships)
- **Key npm deps** (local only):
  - `express`, `dotenv`, `groq-sdk`, `rss-parser`, `web-push`

## Rules & Conventions

- **No frameworks, no bundler.** Cache-busting via `?v=X` in index.html.
- **Backend**: All errors → 502 JSON + console log. Rate limit: 30 req/min per IP.
- **Quant**: Pure JS, no DOM dependencies. Exported as IIFE singleton `Quant`.
- **Naming**: 
  - Route handlers: `/api/quote`, `/api/intel/news` (keyless prefix if free)
  - Env vars: SCREAMING_SNAKE (API keys), lowercase (internal config)
  - Functions: camelCase; async fns return { data, fresh } (KV SWR pattern)
- **Chart data**: Always OHLC shape `{ t, c, o, h, l }` (ms, USD). 1D clipped to 9:30–16:00 ET.
- **AI pool**: 12 providers split across Speed tier (Groq, Cerebras, SambaNova, Together, Mistral) and Heavy tier (Gemini, OpenRouter, DeepSeek, Cohere, Nebius, HuggingFace, GitHub Models). Batch AbortController racing — first valid JSON that passes validation wins, losers aborted immediately. Park rate-limited providers: 429 → 1 min, quota → 30 min. Batch width controlled by `AI_PARALLEL` (default 5).
- **Quote pool**: 10 providers serial fallback (Finnhub×5, TwelveData, FMP, AlphaVantage, Polygon, Yahoo keyless). Round-robin Finnhub keys.

## Current State

**Implemented** (v4 — Module 1 complete):
- Live quotes (10-provider pool w/ round-robin Finnhub piggyback)
- Charts (Yahoo/Nasdaq, 1D–5Y, candlestick support)
- News desk, sector analysis, company deep-dive, supply-chain map
- Geopolitical instability, situation room (AI synthesized)
- Quant: 30+ metrics (Sharpe, Sortino, Calmar, Kelly, Omega, VaR, Monte Carlo, Black-Scholes)
- 15 indicators (ATR, Stochastic, Keltner, Parabolic SAR, Fibonacci, ROC)
- Candlestick pattern detector (18 patterns) + AI analysis endpoint `/api/intel/candle`
- Map: Earthquakes, events, weather, conflict, fires, webcams, aircraft, ships (7 layers)
- Alerts: Web Push + breaking-news detection
- **NEW (Module 1)**: `server.js` fully refactored — 12-provider tiered AI pool (Speed + Heavy), batch AbortController racing with validation callbacks, X/Twitter syndication ingestion (15 accounts), world headline feeds (BBC, Al Jazeera, Bing, CNBC), 5 new routes (deepdive, report, situation, instability, candle), Overpass geospatial layer (pipelines, undersea cables, nuclear, military, datacenters) with macroeconomic shock payloads, 4 new map routes
- **NEW (Module 1)**: GitHub → Cloudflare Workers auto-deploy connected via dashboard

**Immediate next**:
- Module 2: `quant.js` — 40-indicator suite (Float64Array), Rough Jump-Diffusion Monte Carlo (Hurst + Poisson), Malliavin Greeks, Heston volatility surface, Roll Model spread decomposition
- Module 3: `intel.js` — Overpass GeoJSON map rendering, macroeconomic shock UI
- Module 4: `app.js` / `index.html` — X sentiment gauge, canvas Monte Carlo paths, 1D chart flatline fix

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
| `.env` (git-ignored) | FINNHUB_API_KEY, GROQ_API_KEY, POLYGON_KEY, FIRMS_MAP_KEY, WINDY_KEY, AISSTREAM_API_KEY, VAPID_* |

## Env vars (all optional except noted)

**Market data** (≥1 required):
- `FINNHUB_API_KEY` (**required** for quotes)
- `FINNHUB_API_KEY_2..5` (piggyback)
- `TWELVEDATA_KEY`, `FMP_KEY`, `ALPHAVANTAGE_KEY`, `POLYGON_KEY` (fallback)

**AI** (≥1 required for news/analysis):
- `GROQ_API_KEY` (**required**)
- `GEMINI_API_KEY`, `CEREBRAS_API_KEY`, `TOGETHER_API_KEY`, `OPENROUTER_API_KEY`, etc. (race pool)
- `AI_PARALLEL=5` (default race width)

**Map**:
- `FIRMS_MAP_KEY` (NASA fires)
- `WINDY_KEY` (webcams)
- `AISSTREAM_API_KEY` (ships)

**Push**:
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (breaking alerts)

**Dev**:
- `PORT=3000` (local server)
- `GROQ_MODEL` (default: `llama-3.3-70b-versatile`)

## Logs & Debugging

**Console**:
- `[ai] {provider} WON` → AI race winner
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

**Render.com** (separate — runs `server.js` as a Node.js service): also auto-deploys from `main` via `render.yaml`. This is the Express/local-dev server, not the Cloudflare Worker.

Check `wrangler.toml` for KV binding (`MT_KV`), AI binding, asset serving.
