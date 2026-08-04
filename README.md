# Market Terminal

A **Bloomberg-Terminal-inspired live market dashboard** — real-time stock quotes,
hand-drawn price charts, company fundamentals, and news — **merged with an AI
market-intelligence wing**: a live news wire, AI sector analysis, a per-company
watchlist with sentiment, and breaking-news push alerts.

Authentic amber-on-black terminal aesthetic. One process, one command, **real live
data**. No frontend framework and no build step — just plain HTML/CSS/JS served by a
small Express backend that keeps every API key server-side.

![terminal](https://img.shields.io/badge/style-terminal-ffa028) ![node](https://img.shields.io/badge/node-%3E%3D18-2bd97c)

---

## Repository operational state (2026-08-04)

- Deploy by pushing to `main`. Do not run `wrangler deploy` manually for production; GitHub is wired to Cloudflare Workers and is the canonical deploy path for this repo.
- `npm test` now runs unit coverage plus the local smoke suite. Start the local server first with `npm start`.
- `npm run test:ai-eval` runs the versioned offline AI policy-safety fixtures; it is not a live-provider benchmark.
- `npm run test:prod` hits the deployed Worker at `https://market-terminal.wyjjdyxzsc.workers.dev` and is the required post-deploy parity check.
- High-risk AI routes use a shared evidence/task policy. Unsupported supply-chain edges, investment picks, country scores, trade levels, and options constructions are withheld rather than fabricated.
- AI evidence-policy source checkpoint `5a10b79` is production verified: `24/24` unit tests, `28/28` local smoke contracts, and `31/31` production smoke contracts passed on 2026-07-16.
- Checkpoint 5 source commit `20c9252` extends that authority model to sector analysis, company-news impact, deterministic candle commentary, and corroboration-gated alerts. It is production verified with `29/29` unit tests, all 28 keyless-available local smoke contracts, and `33/33` deployed contracts.
- Checkpoint 6 source commit `919f1b9` adds a current-model provider registry, independent different-provider/different-model verification for generated high-risk tasks, bounded calls/tokens/latency/cost, safe runtime telemetry, and offline safety evaluations. It is production verified with `45/45` unit tests, all 10-case evaluation thresholds, all 28 keyless-available local contracts, `33/33` deployed contracts, targeted authority probes, and desktop/mobile browser checks. Available live high-risk verifier attempts failed closed; no positive high-risk acceptance is claimed.
- Checkpoint 7 source commits `febefb3` and `90c191b` are production verified. The repair restores company evidence attribution/ingestion, reserves verifier budget, aligns provider limits/cooldowns, and exposes safe failure diagnostics. After the first live probe exposed a one-card NEWS batch, schema/cache `2026-07-30b` added useful-batch validation and a truthful source-linked fallback. The final deployment served all seven `20260730b` assets, passed `33/33` production contracts, returned 12 source-linked cards on cached and forced-fresh probes, and rendered all 12 in the browser with no console errors. Current-market chat reached generation and disclosed a verifier-unavailable abstention; no positive high-risk acceptance is claimed.
- Checkpoint 8 source commit `9370cc3` restores Deep Dive as an always-useful deterministic dossier. Schema `2026-08-04a` uses the pooled quote cascade, source-balanced company evidence, fundamentals, analyst counts, explicit provenance, and relevant watch items even when the optional independently verified AI narrative abstains. It served all seven `20260804a` assets, passed `33/33` production contracts, and returned useful AAPL/Apple/MSFT dossiers. Those probes exposed 32-37 second uncached waits for optional AI, so the `20260804b` follow-up returns the deterministic dossier first and runs `ai=1` verification separately; `54/54` unit tests, `31/31` available contracts, offline AI thresholds, zero-vulnerability audit, Wrangler `4.118.0` dry-run, and desktop/mobile checks pass. Follow-up production verification remains pending.
- Current provider evidence and limitations are recorded in [docs/AI_PROVIDER_CAPABILITY_AUDIT_2026-07-28.md](/Users/krishivjain/Desktop/claude projects/market-terminal/docs/AI_PROVIDER_CAPABILITY_AUDIT_2026-07-28.md).
- The latest external-agent checkpoint and evidence log lives in [docs/CODEX_HANDOFF_TO_CLAUDE_2026-07-13.md](/Users/krishivjain/Desktop/claude projects/market-terminal/docs/CODEX_HANDOFF_TO_CLAUDE_2026-07-13.md).

---

## Tabs

| Tab          | What it does                                                                                   |
| ------------ | ---------------------------------------------------------------------------------------------- |
| **TERMINAL** | Live quote, snapshot stats, hand-drawn canvas chart, company profile, and company news.        |
| **NEWS**     | A live "market wire" — real headlines (Google News) structured by AI into categorized, ticker-tagged cards with a breaking section and category filters. |
| **SECTORS**  | Evidence-bounded interpretation across 11 GICS sectors; unsupported ranks, picks, and options strategies are shown as unavailable. |
| **DEEP DIVE** | Deterministic quote/fundamental/analyst/evidence dossier, optionally augmented only after independent AI verification. |
| **WATCHLIST**| Add any company/ticker to see canonical source-linked news with cited impact interpretation or an explicit unrated fallback. Saved in your browser. |
| **ALERTS**   | Corroboration-gated market-moving headlines, optionally **pushed to your device** when deterministic eligibility checks pass. |

---

## Features

- **Live quotes** — price, change, %, open, prev close, day & 52-week ranges, market cap, P/E. Auto-refreshes every 30s.
- **Interactive chart** — drawn by hand on `<canvas>` (no chart library). Retina-crisp, gradient fill, gridlines, axis labels, prev-close baseline, and a **hover crosshair + tooltip**. Ranges: 1D · 5D · 1M · 6M · 1Y · 5Y.
- **Resilient chart data** — uses Yahoo Finance, and **automatically falls back to Nasdaq** when Yahoo's API rate-limits your network (common on shared/CGNAT connections), so the chart always renders.
- **Scrolling ticker tape** of mega-caps, color-coded, refreshed every 60s.
- **Evidence-bound news, sector analysis & watchlist interpretation** — grounded on current source-linked headlines and routed only through task-approved providers; unmet evidence/provider gates produce explicit withheld states. Cached server-side with stale-while-revalidate.
- **Resilient Deep Dive** — always returns a source-backed deterministic company dossier from the pooled quote path, fundamental metrics, analyst counts, and diversified evidence; AI/provider failure withholds only the optional narrative.
- **Breaking-news push alerts** — only deterministic policy-eligible items can enter the high-priority delivery path; installable as a PWA (works on Android/desktop Chrome and, after Add-to-Home-Screen, iOS).
- **Live clock + US market status** (OPEN / CLOSED / PRE-MKT / AFTER-HRS, America/New_York).
- **Fully responsive**, keyboard-accessible, and respects `prefers-reduced-motion`.

---

## Tech stack

| Layer    | Choice                                                                                          |
| -------- | ----------------------------------------------------------------------------------------------- |
| Backend  | Node.js 18+ and Express. Serves the frontend **and** proxies every data API so your keys stay server-side and CORS is avoided. |
| Frontend | Vanilla HTML + CSS + JS. No React, no Tailwind, no chart library.                                |
| Data     | [Finnhub](https://finnhub.io) (quotes, profile, metrics, company news, search) · Yahoo Finance + Nasdaq (chart history, keyless) · source-linked RSS · a server-side registry of supported AI providers. |
| Deps     | `express`, `dotenv`, `groq-sdk`, `rss-parser`, `web-push`.                                       |

The browser only ever talks to this app's own `/api/*` routes — it never sees your keys and never makes a cross-origin request.

---

## Run it (macOS)

You need **Node.js 18 or newer** (this uses the built-in global `fetch`). Check with
`node -v`; if you don't have it, install from <https://nodejs.org>.

**1. Get the free API keys**

   - **Finnhub** (required) — sign up at <https://finnhub.io> and copy your API key.
   - **AI providers** (optional) — Groq is the simplest default for NEWS enrichment and generic educational chat. Generated current-market and high-risk research needs at least two eligible heavy providers from different model families; supported combinations are listed in `.env.example`.

**2. Add your keys**

   ```bash
   cp .env.example .env
   ```

   Open `.env` and paste your keys:

   ```
   FINNHUB_API_KEY=your_finnhub_key
   GROQ_API_KEY=your_groq_key
   GEMINI_API_KEY=
   GITHUB_MODELS_TOKEN=
   PORT=3000
   ```

   With only `GROQ_API_KEY`, NEWS and generic educational chat can run, while
   current-market chat, sector analysis, company impact, price action, situation,
   and deep-dive generation abstain because independent heavy-model verification
   cannot be completed.

   *(Optional — for push ALERTS: run `npx web-push generate-vapid-keys` and paste the
   public/private keys into `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`. Leave them blank
   to just disable push; everything else still works.)*

**3. Install dependencies**

   ```bash
   npm install
   ```

**4. Start the server**

   ```bash
   npm start
   ```

   You'll see `Market Terminal running → http://localhost:3000` plus a line for each
   key (loaded ✓ / missing ✗).

**5. Open it**

   Visit **<http://localhost:3000>**. It opens on **TERMINAL** with **AAPL** loaded —
   type any symbol and press **GO**, or switch tabs along the top.

> `npm run dev` runs it with `node --watch` (auto-restarts when you edit `server.js`).

**Run tests**

```bash
npm test
npm run test:ai-eval
npm run test:prod
```

---

## Project structure

```
market-terminal/
├── package.json
├── .env.example            # FINNHUB_API_KEY · GROQ_API_KEY · VAPID_* · PORT
├── .gitignore
├── README.md
├── server.js               # Express: serves /public + proxies all data sources
├── worker.js               # Cloudflare production runtime
├── shared/                 # API, evidence, policy, provider, verification, and evaluation cores
├── tools/gen-icons.js      # one-off PWA icon generator (pure Node, no deps)
└── public/
    ├── index.html
    ├── style.css
    ├── app.js              # TERMINAL: quote, snapshot, canvas chart, tabs
    ├── intel.js            # NEWS · SECTORS · WATCHLIST · ALERTS (+ push)
    ├── sw.js               # service worker (push notifications)
    ├── manifest.json       # PWA manifest
    └── icon-*.png          # generated app icons
```

### API routes (served by `server.js`)

| Route                                | Returns                                                      |
| ------------------------------------ | ----------------------------------------------------------- |
| `GET /api/quote?symbol=`             | Current quote                                               |
| `GET /api/profile?symbol=`           | Company profile (name, exchange, logo, market cap…)         |
| `GET /api/metrics?symbol=`           | 52-week high/low and P/E                                    |
| `GET /api/news?symbol=`              | Up to 15 recent company headlines (Finnhub)                 |
| `GET /api/search?q=`                 | Symbol search (autocomplete)                                |
| `GET /api/ticker`                    | Quotes for the ticker-tape basket                           |
| `GET /api/chart?symbol=&range=`      | Chart history (Yahoo → Nasdaq fallback)                     |
| `GET /api/intel/news`                | Source-linked structured market news with degraded fallback |
| `GET /api/intel/analysis`            | Evidence-gated interpretation for 11 sectors; unsupported ranks/picks are withheld |
| `GET /api/sentiment/market`          | Deterministic benchmark-breadth and RSS-news sentiment, with evidence coverage |
| `GET /api/intel/company?q=`          | Canonical company news with cited impact interpretation or an unrated fallback |
| `GET /api/intel/deepdive?q=`         | Deterministic company dossier plus an optional independently verified AI narrative |
| `GET /api/intel/alerts`              | Recent breaking alerts                                      |
| push: `vapid-public-key` · `subscribe` · `unsubscribe` · `test-push` | Web Push plumbing                 |

---

## Notes & troubleshooting

- **A tab says a key is missing** — TERMINAL needs a configured quote provider, normally `FINNHUB_API_KEY`. NEWS and educational chat can use one speed provider such as Groq. Generated current-market/high-risk research requires two eligible heavy providers with independent model families. Make sure `.env` sits next to `server.js`, then restart.
- **Rate limits** — provider limits vary by account. Per-minute throttles use a short cooldown; daily/quota exhaustion uses a longer cooldown. AI responses are cached under schema-specific task TTLs, and NEWS degrades to canonical raw headlines if enrichment is unavailable.
- **Deep Dive says the AI narrative was withheld** — the quote, fundamentals, analyst counts, observations, watch items, and source evidence are still live deterministic sections. Generated narrative requires two eligible heavy providers from different model families and safely remains optional.
- **Chart works but quotes don't (or vice-versa)** — the chart is keyless (Yahoo/Nasdaq) while quotes use Finnhub; if only the chart loads, your Finnhub key is missing/invalid.
- **Alerts say "Blocked"** — notifications are blocked for the site in your browser/OS settings. Re-allow and reload. On iPhone, Add to Home Screen first.

---

## Remaining engineering work

- Add live-provider drift canaries, a human-reviewed finance/OSINT claim corpus, calibration metrics, and persistent aggregate AI observability.
- Expand deterministic reference coverage across the full quant indicator/model surface.
- Continue modular decomposition of the large Express and Worker runtime files.
- Add licensed adapters where professional-grade fundamentals, relationships, options, portfolio, or event authority is required.

---

## Data disclaimer

Market data is provided by **Finnhub**, **Yahoo Finance**, **Nasdaq**, and public
news sources, with optional synthesis from configured AI providers, for **educational and demonstration purposes only**. It may be delayed or
inaccurate, the AI-generated summaries can be wrong, and **none of it is investment
advice**. Not affiliated with, endorsed by, or connected to Bloomberg L.P. — the
"terminal" styling is an homage.

MIT License.
