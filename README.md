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

## Tabs

| Tab          | What it does                                                                                   |
| ------------ | ---------------------------------------------------------------------------------------------- |
| **TERMINAL** | Live quote, snapshot stats, hand-drawn canvas chart, company profile, and company news.        |
| **NEWS**     | A live "market wire" — real headlines (Google News) structured by AI into categorized, ticker-tagged cards with a breaking section and category filters. |
| **SECTORS**  | All 11 GICS sectors ranked for investing & options, an overall market-sentiment banner, and AI top-stock ideas. |
| **WATCHLIST**| Add any company/ticker (or tap a ticker chip anywhere) to get its recent news with per-headline positive / negative impact. Saved in your browser. |
| **ALERTS**   | Breaking market-moving headlines, optionally **pushed to your device** (installable PWA) even when the app is closed. |

---

## Features

- **Live quotes** — price, change, %, open, prev close, day & 52-week ranges, market cap, P/E. Auto-refreshes every 30s.
- **Interactive chart** — drawn by hand on `<canvas>` (no chart library). Retina-crisp, gradient fill, gridlines, axis labels, prev-close baseline, and a **hover crosshair + tooltip**. Ranges: 1D · 5D · 1M · 6M · 1Y · 5Y.
- **Resilient chart data** — uses Yahoo Finance, and **automatically falls back to Nasdaq** when Yahoo's API rate-limits your network (common on shared/CGNAT connections), so the chart always renders.
- **Scrolling ticker tape** of mega-caps, color-coded, refreshed every 60s.
- **AI news wire, sector analysis & watchlist sentiment** — grounded on *real, current* headlines pulled live from Google News, then structured by **Groq** (Llama 3.3 70B). Cached server-side (stale-while-revalidate) to stay fast and within free limits.
- **Breaking-news push alerts** — high-priority items are delivered via Web Push to subscribed devices; installable as a PWA (works on Android/desktop Chrome and, after Add-to-Home-Screen, iOS).
- **Live clock + US market status** (OPEN / CLOSED / PRE-MKT / AFTER-HRS, America/New_York).
- **Fully responsive**, keyboard-accessible, and respects `prefers-reduced-motion`.

---

## Tech stack

| Layer    | Choice                                                                                          |
| -------- | ----------------------------------------------------------------------------------------------- |
| Backend  | Node.js 18+ and Express. Serves the frontend **and** proxies every data API so your keys stay server-side and CORS is avoided. |
| Frontend | Vanilla HTML + CSS + JS. No React, no Tailwind, no chart library.                                |
| Data     | [Finnhub](https://finnhub.io) (quotes, profile, metrics, company news, search) · Yahoo Finance + Nasdaq (chart history, keyless) · Google News RSS + [Groq](https://groq.com) (AI news / sectors / watchlist). |
| Deps     | `express`, `dotenv`, `groq-sdk`, `rss-parser`, `web-push`.                                       |

The browser only ever talks to this app's own `/api/*` routes — it never sees your keys and never makes a cross-origin request.

---

## Run it (macOS)

You need **Node.js 18 or newer** (this uses the built-in global `fetch`). Check with
`node -v`; if you don't have it, install from <https://nodejs.org>.

**1. Get the free API keys**

   - **Finnhub** (required) — sign up at <https://finnhub.io> and copy your API key.
   - **Groq** (required for NEWS / SECTORS / WATCHLIST) — sign up at <https://console.groq.com/keys> (free, no credit card) and copy your key.

**2. Add your keys**

   ```bash
   cp .env.example .env
   ```

   Open `.env` and paste your keys:

   ```
   FINNHUB_API_KEY=your_finnhub_key
   GROQ_API_KEY=your_groq_key
   PORT=3000
   ```

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

---

## Project structure

```
market-terminal/
├── package.json
├── .env.example            # FINNHUB_API_KEY · GROQ_API_KEY · VAPID_* · PORT
├── .gitignore
├── README.md
├── server.js               # Express: serves /public + proxies all data sources
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
| `GET /api/intel/news`                | AI-structured market news feed (Groq)                       |
| `GET /api/intel/analysis`            | 11-sector ranking + sentiment + top picks (Groq)            |
| `GET /api/intel/company?q=`          | Per-company news with positive/negative impact (Groq)       |
| `GET /api/intel/alerts`              | Recent breaking alerts                                      |
| push: `vapid-public-key` · `subscribe` · `unsubscribe` · `test-push` | Web Push plumbing                 |

---

## Notes & troubleshooting

- **A tab says a key is missing** — TERMINAL needs `FINNHUB_API_KEY`; NEWS/SECTORS/WATCHLIST need `GROQ_API_KEY`. Make sure `.env` sits next to `server.js`, then restart.
- **Rate limits** — Finnhub free tier ≈ 60 req/min; Groq has generous free limits but heavy use can briefly 429. The app caches AI results for 60 min and retries transient errors.
- **Chart works but quotes don't (or vice-versa)** — the chart is keyless (Yahoo/Nasdaq) while quotes use Finnhub; if only the chart loads, your Finnhub key is missing/invalid.
- **Alerts say "Blocked"** — notifications are blocked for the site in your browser/OS settings. Re-allow and reload. On iPhone, Add to Home Screen first.

---

## Possible extensions

- Stream tick-by-tick prices over WebSockets (Finnhub trade stream).
- Candlestick / OHLC chart mode and indicators (SMA, volume).
- Wire the TERMINAL view's current symbol straight into the WATCHLIST and NEWS filters.
- Crypto & FX symbols; a two-symbol compare mode normalized to % change.
- Server-side response caching for quotes to further ease rate limits.

---

## Data disclaimer

Market data is provided by **Finnhub**, **Yahoo Finance**, **Nasdaq**, **Google News**,
and **Groq** for **educational and demonstration purposes only**. It may be delayed or
inaccurate, the AI-generated summaries can be wrong, and **none of it is investment
advice**. Not affiliated with, endorsed by, or connected to Bloomberg L.P. — the
"terminal" styling is an homage.

MIT License.
