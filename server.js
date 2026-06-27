'use strict';

/**
 * Market Terminal — backend
 *
 * Responsibilities:
 *   1. Serve the static frontend from /public.
 *   2. Act as a proxy to the data providers (Finnhub + Yahoo Finance) so the
 *      Finnhub API key stays server-side and the browser never hits a
 *      cross-origin API directly (no CORS headaches, no leaked key).
 *
 * Dependencies: express + dotenv ONLY. Node 18+ for the built-in global fetch.
 */

const path = require('path');
const fs = require('fs');
// Load .env from next to this file, so `npm start` works regardless of the
// directory it's launched from.
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const Groq = require('groq-sdk');
const RssParser = require('rss-parser');
const webpush = require('web-push');

const app = express();
app.set('trust proxy', 1);                // correct client IP behind a proxy
app.use(express.json({ limit: '16kb' })); // parse JSON bodies (push subscribe)
const PORT = process.env.PORT || 3000;
const FINNHUB_KEY = process.env.FINNHUB_API_KEY;
const FINNHUB_BASE = 'https://finnhub.io/api/v1';
const GROQ_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

// Yahoo rejects requests that don't look like a browser. A realistic
// User-Agent is required or the chart endpoint returns errors / empty bodies.
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

if (!FINNHUB_KEY) {
  console.warn(
    '\n\x1b[33m⚠  FINNHUB_API_KEY is not set.\x1b[0m\n' +
      '   Copy .env.example to .env and paste a free key from https://finnhub.io\n' +
      '   Quotes, profile, metrics, news and search will not work until you do.\n'
  );
}

// ───────────────────────── helpers ─────────────────────────

/** Fetch JSON from Finnhub, appending the API token. Throws on non-2xx. */
async function finnhub(endpoint, params = {}) {
  const url = new URL(FINNHUB_BASE + endpoint);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  }
  url.searchParams.set('token', FINNHUB_KEY || '');

  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (res.status === 429) {
    throw new Error('Rate limit reached (Finnhub free tier). Wait a moment and retry.');
  }
  if (!res.ok) {
    throw new Error(`Finnhub responded ${res.status} for ${endpoint}`);
  }
  return res.json();
}

/** fetch() with an abort timeout so a hung upstream can't hang our request. */
async function fetchWithTimeout(url, opts = {}, timeoutMs = 9000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** YYYY-MM-DD for a date `days` ago from now (UTC-safe enough for news windows). */
function isoDaysAgo(days) {
  const d = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

/** Wrap an async route so any throw becomes a clean JSON error (server never crashes). */
function route(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      console.error(`[${req.method} ${req.path}]`, err.message);
      res.status(502).json({ error: err.message || 'Upstream request failed' });
    }
  };
}

function requireKey(res) {
  if (!FINNHUB_KEY) {
    res.status(500).json({ error: 'Server is missing FINNHUB_API_KEY. See README / .env.example.' });
    return false;
  }
  return true;
}

// ───────────────────────── API routes ─────────────────────────

// Current quote.
app.get('/api/quote', route(async (req, res) => {
  if (!requireKey(res)) return;
  const symbol = String(req.query.symbol || '').toUpperCase();
  if (!symbol) return res.status(400).json({ error: 'symbol is required' });
  const q = await finnhub('/quote', { symbol });
  res.json(q); // { c, d, dp, h, l, o, pc, t }
}));

// Company profile.
app.get('/api/profile', route(async (req, res) => {
  if (!requireKey(res)) return;
  const symbol = String(req.query.symbol || '').toUpperCase();
  if (!symbol) return res.status(400).json({ error: 'symbol is required' });
  const p = await finnhub('/stock/profile2', { symbol });
  res.json(p);
}));

// Key metrics (52-week range, P/E).
app.get('/api/metrics', route(async (req, res) => {
  if (!requireKey(res)) return;
  const symbol = String(req.query.symbol || '').toUpperCase();
  if (!symbol) return res.status(400).json({ error: 'symbol is required' });
  const data = await finnhub('/stock/metric', { symbol, metric: 'all' });
  const m = (data && data.metric) || {};
  res.json({
    high52: m['52WeekHigh'] ?? null,
    low52: m['52WeekLow'] ?? null,
    pe: m.peTTM ?? m.peNormalizedAnnual ?? m.peBasicExclExtraTTM ?? null,
  });
}));

// Company news — last ~30 days, capped at 15 items.
app.get('/api/news', route(async (req, res) => {
  if (!requireKey(res)) return;
  const symbol = String(req.query.symbol || '').toUpperCase();
  if (!symbol) return res.status(400).json({ error: 'symbol is required' });
  const items = await finnhub('/company-news', {
    symbol,
    from: isoDaysAgo(30),
    to: isoDaysAgo(0),
  });
  const list = Array.isArray(items) ? items : [];
  res.json(
    list.slice(0, 15).map((n) => ({
      headline: n.headline,
      source: n.source,
      url: n.url,
      datetime: n.datetime, // unix seconds
      summary: n.summary,
      image: n.image,
    }))
  );
}));

// Symbol search (autocomplete).
app.get('/api/search', route(async (req, res) => {
  if (!requireKey(res)) return;
  const q = String(req.query.q || '').trim();
  if (!q) return res.json({ result: [] });
  const data = await finnhub('/search', { q });
  const result = (data && Array.isArray(data.result) ? data.result : [])
    .filter((r) => r.symbol && !r.symbol.includes('.')) // skip most foreign listings for clarity
    .slice(0, 12)
    .map((r) => ({
      description: r.description,
      displaySymbol: r.displaySymbol,
      symbol: r.symbol,
      type: r.type,
    }));
  res.json({ result });
}));

// Ticker tape — a fixed basket, fetched in parallel.
const TICKER_BASKET = ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA'];
app.get('/api/ticker', route(async (req, res) => {
  if (!requireKey(res)) return;
  const results = await Promise.all(
    TICKER_BASKET.map(async (symbol) => {
      try {
        const q = await finnhub('/quote', { symbol });
        return { symbol, price: q.c ?? 0, change: q.d ?? 0, percent: q.dp ?? 0 };
      } catch {
        return { symbol, price: 0, change: 0, percent: 0 };
      }
    })
  );
  res.json(results);
}));

/**
 * Historical chart data — keyless, normalized to { points:[{t(ms),c}], meta }.
 *
 * Two sources, tried in order and self-tuning:
 *   • Yahoo Finance  — works on most networks, all symbols/ranges.
 *   • Nasdaq         — reliable fallback when Yahoo's API hosts rate-limit the
 *                      caller's IP (common on shared/CGNAT connections). US stocks.
 * Whichever succeeds becomes the preferred first attempt for the next request,
 * so we don't repeatedly pay for a dead source.
 */

// Yahoo range -> { range, interval }.
const YAHOO_RANGE = {
  '1D': { range: '1d', interval: '5m' },
  '5D': { range: '5d', interval: '15m' },
  '1M': { range: '1mo', interval: '1d' },
  '6M': { range: '6mo', interval: '1d' },
  '1Y': { range: '1y', interval: '1d' },
  '5Y': { range: '5y', interval: '1wk' },
};

// Nasdaq historical lookback per range, in calendar days (intraday handled separately).
const NASDAQ_DAYS = { '5D': 9, '1M': 35, '6M': 190, '1Y': 370, '5Y': 1835 };

async function chartFromYahoo(symbol, rangeKey) {
  const cfg = YAHOO_RANGE[rangeKey] || YAHOO_RANGE['1D'];
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?range=${cfg.range}&interval=${cfg.interval}`;
  const res = await fetchWithTimeout(
    url,
    { headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json' } },
    9000
  );
  if (!res.ok) throw new Error(`Yahoo responded ${res.status}`);
  const data = await res.json();
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error(data?.chart?.error?.description || 'Yahoo returned no data');

  const timestamps = result.timestamp || [];
  const closes = result.indicators?.quote?.[0]?.close || [];
  const meta = result.meta || {};
  const points = [];
  for (let i = 0; i < timestamps.length; i++) {
    const c = closes[i];
    if (c === null || c === undefined || Number.isNaN(c)) continue;
    points.push({ t: timestamps[i] * 1000, c });
  }
  return {
    points,
    meta: {
      prevClose: meta.chartPreviousClose ?? meta.previousClose ?? null,
      currency: meta.currency ?? 'USD',
      price: meta.regularMarketPrice ?? (points.length ? points[points.length - 1].c : null),
    },
  };
}

const NASDAQ_HEADERS = {
  'User-Agent': BROWSER_UA,
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
};
const num = (s) => parseFloat(String(s).replace(/[$,]/g, '')); // "$1,234.50" -> 1234.5

async function chartFromNasdaq(symbol, rangeKey) {
  // 1D -> intraday endpoint (minute bars for today, incl. pre/post market).
  if (rangeKey === '1D') {
    const url = `https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/chart?assetclass=stocks`;
    const res = await fetchWithTimeout(url, { headers: NASDAQ_HEADERS }, 12000);
    if (!res.ok) throw new Error(`Nasdaq responded ${res.status}`);
    const data = await res.json();
    const rows = data?.data?.chart || [];
    const points = rows
      .filter((r) => r && r.y != null)
      .map((r) => ({ t: r.x, c: Number(r.y) }));
    if (!points.length) throw new Error('Nasdaq returned no intraday data');
    return {
      points,
      meta: {
        prevClose: data.data.previousClose != null ? num(data.data.previousClose) : null,
        currency: 'USD',
        price: data.data.lastSalePrice != null ? num(data.data.lastSalePrice) : points[points.length - 1].c,
      },
    };
  }

  // Everything else -> historical daily rows.
  const days = NASDAQ_DAYS[rangeKey] || 35;
  const url =
    `https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/historical` +
    `?assetclass=stocks&fromdate=${isoDaysAgo(days)}&todate=${isoDaysAgo(0)}&limit=9999`;
  const res = await fetchWithTimeout(url, { headers: NASDAQ_HEADERS }, 12000);
  if (!res.ok) throw new Error(`Nasdaq responded ${res.status}`);
  const data = await res.json();
  const rows = data?.data?.tradesTable?.rows || [];
  const toMs = (mdy) => {
    const [m, d, y] = mdy.split('/').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  let points = rows
    .filter((r) => r && r.date && r.close)
    .map((r) => ({ t: toMs(r.date), c: num(r.close) }))
    .sort((a, b) => a.t - b.t);
  if (!points.length) throw new Error('Nasdaq returned no historical data');
  // Thin 5Y to ~weekly so the line stays light.
  if (rangeKey === '5Y' && points.length > 400) {
    points = points.filter((_, i) => i % 5 === 0 || i === points.length - 1);
  }
  return {
    points,
    meta: { prevClose: null, currency: 'USD', price: points[points.length - 1].c },
  };
}

let preferredChartSource = 'yahoo'; // flips to whatever last worked

async function getChart(symbol, rangeKey) {
  const order = preferredChartSource === 'nasdaq' ? ['nasdaq', 'yahoo'] : ['yahoo', 'nasdaq'];
  let lastErr;
  for (const src of order) {
    try {
      const data = src === 'yahoo'
        ? await chartFromYahoo(symbol, rangeKey)
        : await chartFromNasdaq(symbol, rangeKey);
      if (data.points && data.points.length >= 2) {
        preferredChartSource = src;
        return { ...data, source: src };
      }
      lastErr = new Error(`${src} returned too few points`);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('No chart data available');
}

app.get('/api/chart', route(async (req, res) => {
  const symbol = String(req.query.symbol || '').toUpperCase();
  if (!symbol) return res.status(400).json({ error: 'symbol is required' });
  const rangeKey = String(req.query.range || '1D').toUpperCase();
  if (!YAHOO_RANGE[rangeKey]) return res.status(400).json({ error: 'invalid range' });
  const data = await getChart(symbol, rangeKey);
  res.json(data);
}));

// ════════════════════════════════════════════════════════════════════════
//  MARKET INTELLIGENCE (merged from the standalone news app)
//  Live headlines from Google News RSS (keyless) + Groq AI structuring, plus
//  sector analysis, per-company watchlist sentiment, and breaking-news web push.
//  All routes namespaced under /api/intel/* (push routes under /api/*).
// ════════════════════════════════════════════════════════════════════════

const groq = new Groq({ apiKey: GROQ_KEY });
if (!GROQ_KEY) {
  console.warn(
    '\n\x1b[33m⚠  GROQ_API_KEY is not set.\x1b[0m The NEWS / SECTORS / WATCHLIST tabs\n' +
      '   need it. Get a free key at https://console.groq.com/keys and add it to .env.\n'
  );
}

// --- Live news source: Google News RSS (free, no key) -----------------------
const rss = new RssParser({
  timeout: 12000,
  headers: { 'User-Agent': 'Mozilla/5.0 (MarketTerminal news reader)' },
});

// Fetch recent headlines for a query -> [{ title, source, published }]. Never throws.
async function fetchHeadlines(query, limit = 12) {
  const url =
    'https://news.google.com/rss/search?q=' +
    encodeURIComponent(query) + '&hl=en-US&gl=US&ceid=US:en';
  try {
    const feed = await rss.parseURL(url);
    return (feed.items || []).slice(0, limit).map((it) => {
      let title = it.title || '';
      let source = (it.creator || (it.source && it.source.title) || '').trim();
      const dash = title.lastIndexOf(' - ');
      if (!source && dash > 0) { source = title.slice(dash + 3).trim(); title = title.slice(0, dash).trim(); }
      return { title, source, published: it.isoDate || it.pubDate || '' };
    });
  } catch (e) {
    console.error(`RSS "${query}" failed:`, e.message);
    return [];
  }
}

// Pull several feeds in parallel and merge, de-duplicating by headline.
async function gatherHeadlines(queries, perQuery = 10) {
  const lists = await Promise.all(queries.map((q) => fetchHeadlines(q, perQuery)));
  const seen = new Set();
  const merged = [];
  for (const list of lists) {
    for (const h of list) {
      const k = h.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      merged.push(h);
    }
  }
  return merged;
}

function headlineBlock(headlines) {
  if (!headlines.length) return '(no headlines retrieved)';
  return headlines
    .map((h, i) => `${i + 1}. ${h.title}${h.source ? ` — ${h.source}` : ''}${h.published ? ` (${h.published})` : ''}`)
    .join('\n');
}

// --- Web Push ----------------------------------------------------------------
const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:alerts@example.com';
const pushEnabled = Boolean(VAPID_PUBLIC && VAPID_PRIVATE);
if (pushEnabled) webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
else console.warn('⚠  Web Push disabled (no VAPID keys) — alerts won’t be delivered to devices.');

const SUBS_FILE = path.join(__dirname, 'subscriptions.json');
let subscriptions = [];
try { subscriptions = JSON.parse(fs.readFileSync(SUBS_FILE, 'utf8')); } catch { subscriptions = []; }
function saveSubs() {
  try { fs.writeFileSync(SUBS_FILE, JSON.stringify(subscriptions)); }
  catch (e) { console.error('save subs:', e.message); }
}
function addSub(sub) {
  if (!sub || !sub.endpoint) return;
  if (!subscriptions.some((s) => s.endpoint === sub.endpoint)) { subscriptions.push(sub); saveSubs(); }
}
function removeSub(endpoint) {
  const before = subscriptions.length;
  subscriptions = subscriptions.filter((s) => s.endpoint !== endpoint);
  if (subscriptions.length !== before) saveSubs();
}
async function sendPush(payload) {
  if (!pushEnabled || !subscriptions.length) return 0;
  const body = JSON.stringify(payload);
  let sent = 0;
  await Promise.all(subscriptions.map((sub) =>
    webpush.sendNotification(sub, body)
      .then(() => { sent++; })
      .catch((err) => {
        if (err && (err.statusCode === 404 || err.statusCode === 410)) removeSub(sub.endpoint);
        else console.error('push send:', err && err.message);
      })
  ));
  return sent;
}

// --- Stale-while-revalidate cache (60 min) ----------------------------------
const CACHE_MS = 60 * 60 * 1000;
const cache = {};
const inFlight = {};
async function getData(key, fetcher) {
  const hit = cache[key];
  const now = Date.now();
  function refresh() {
    if (inFlight[key]) return inFlight[key];
    inFlight[key] = (async () => {
      try {
        const data = await fetcher();
        cache[key] = { data, freshUntil: Date.now() + CACHE_MS };
        return data;
      } finally { delete inFlight[key]; }
    })();
    return inFlight[key];
  }
  if (hit) {
    if (hit.freshUntil <= now) refresh().catch((e) => console.error(`${key} bg refresh:`, e.message));
    return { data: hit.data, fresh: hit.freshUntil > now };
  }
  const data = await refresh();
  return { data, fresh: true };
}

// --- Groq call (text-only; grounded on the RSS headlines we pass in) --------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function runGroq(systemPrompt, userPrompt) {
  const MAX_TRIES = 4;
  let lastErr;
  for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
    try {
      const completion = await groq.chat.completions.create({
        model: GROQ_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.4,
        max_tokens: 8000,
        response_format: { type: 'json_object' },
      });
      const text = completion.choices?.[0]?.message?.content;
      if (!text) throw new Error('Empty response from Groq.');
      return text;
    } catch (err) {
      lastErr = err;
      const status = err && (err.status || err.statusCode);
      const msg = String((err && err.message) || '');
      const transient = status === 429 || status === 500 || status === 503 ||
        /\b(429|500|503|rate limit|overloaded|temporarily)\b/i.test(msg);
      if (!transient || attempt === MAX_TRIES) throw err;
      const wait = 1500 * Math.pow(2, attempt - 1);
      console.warn(`Groq transient error (try ${attempt}/${MAX_TRIES}), retrying in ${wait}ms…`);
      await sleep(wait);
    }
  }
  throw lastErr;
}

function extractJson(text) {
  if (!text) throw new Error('Empty response from model.');
  let cleaned = text.trim();
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) cleaned = fence[1].trim();
  if (cleaned[0] !== '{' && cleaned[0] !== '[') {
    const firstObj = cleaned.indexOf('{');
    const firstArr = cleaned.indexOf('[');
    const start = firstArr === -1 ? firstObj : firstObj === -1 ? firstArr : Math.min(firstObj, firstArr);
    if (start === -1) throw new Error('No JSON found in model response.');
    const end = Math.max(cleaned.lastIndexOf('}'), cleaned.lastIndexOf(']'));
    cleaned = cleaned.slice(start, end + 1);
  }
  return JSON.parse(cleaned);
}

// --- Prompts ----------------------------------------------------------------
const NEWS_SYSTEM = `You are a financial markets news desk. You will be given a list of REAL,
current US news headlines (with source and time) pulled live from Google News moments ago.
Use ONLY these headlines as your facts — do not invent events not represented in them.
Select and rewrite the 12 most important and market-relevant items.

Return ONE JSON object of the form { "items": [ up to 12 items ] }. Each item:
{
  "title": short clean headline,
  "summary": one-sentence summary,
  "detail": 2-3 sentence explanation grounded in the headline,
  "category": one of "political" | "financial" | "federal-reserve" | "earnings" | "macro" | "geopolitical" | "trade",
  "source": publication name from the headline (e.g. "Reuters"),
  "priority": "high" | "normal" (use "high" for breaking / market-moving items),
  "marketImpact": one sentence on how this could move markets,
  "tickers": array of 0-4 US stock ticker symbols most relevant (e.g. ["AAPL","MSFT"]); [] if none,
  "watchUrl": "" (always leave empty — the app finds any live stream itself),
  "timestamp": ISO 8601 datetime string (use the headline's time if given, else now)
}
Return ONLY the JSON object. No markdown, no commentary.`;

const COMPANY_SYSTEM = `You are an equity research analyst. You will be given REAL, current headlines
about a company, pulled live from Google News moments ago. Use ONLY these headlines as facts.

Return ONE JSON object:
{
  "ticker": best-guess primary US stock ticker in caps (e.g. "AAPL"), or "" if private/unknown,
  "companyName": the official company name,
  "overallSentiment": "positive" | "negative" | "neutral" | "mixed",
  "summary": one sentence on the company's current news situation,
  "news": array of up to 10 items, newest first, each:
  {
    "title": short headline,
    "summary": one-sentence summary,
    "source": publication name from the headline,
    "timestamp": ISO 8601 datetime string,
    "impact": "positive" | "negative" | "neutral" (effect on the STOCK),
    "impactReason": one short sentence on why it's good/bad/neutral for the stock
  }
}
If the headlines are empty or irrelevant, return the object with "news": [] and a brief summary.
Return ONLY the JSON object. No markdown, no commentary.`;

const ANALYSIS_SYSTEM = `You are a sell-side market strategist. You will be given REAL, current US market
headlines pulled live from Google News moments ago — use them as context for what is happening
right now, combined with your market knowledge, to rank all 11 GICS sectors.

Return ONE JSON object:
{
  "marketSentiment": "Bullish" | "Bearish" | "Neutral" | "Mixed",
  "sentimentScore": integer 1-10,
  "marketSummary": 2-3 sentence overview referencing the current headlines,
  "keyThemes": array of 3-5 short strings,
  "topInvestPicks": array of EXACTLY 8 specific US-listed stocks to most consider buying now,
    best first. Each: {
      "ticker": stock ticker in caps (e.g. "NVDA"),
      "name": company name,
      "sector": its GICS sector name,
      "thesis": one short sentence on why it's attractive right now,
      "conviction": "High" | "Medium"
    },
  "industries": array of EXACTLY 11 objects, one per GICS sector:
  {
    "name": sector name,
    "icon": a single relevant emoji,
    "etf": representative ETF ticker (e.g. "XLK"),
    "investRank": integer 1-11, UNIQUE across sectors (1 = best to invest in stocks now),
    "optionsRank": integer 1-11, UNIQUE across sectors (1 = best options opportunity now),
    "investScore": integer 1-100,
    "optionsScore": integer 1-100,
    "analysis": 1-2 sentence sector view,
    "topPicks": array of EXACTLY 3 best stocks in THIS sector to invest in now, each { "ticker": caps, "name": company, "thesis": one short sentence },
    "upsides": array of EXACTLY 3 short strings,
    "downsides": array of EXACTLY 3 short strings,
    "optionsStrategy": one concrete options idea (e.g. "Buy 30-45 DTE call spreads"),
    "optionsBias": "Calls" | "Puts" | "Straddle" | "Avoid",
    "impliedVolatility": "Low" | "Medium" | "High",
    "optionsTimeframe": "Weekly" | "Monthly" | "LEAPS"
  }
}
The 11 sectors MUST be: Technology, Healthcare, Financials, Energy, Consumer Discretionary,
Consumer Staples, Industrials, Materials, Utilities, Real Estate, Communication Services.
investRank values must be a permutation of 1..11; optionsRank likewise.
Return ONLY the JSON object. No markdown, no commentary.`;

// --- Fetchers ---------------------------------------------------------------
const NEWS_QUERIES = [
  'US stock market today', 'Federal Reserve interest rates', 'US president White House',
  'company earnings stock', 'US economy inflation jobs', 'geopolitics oil markets', 'trade tariffs US',
];

async function fetchIntelNews() {
  const headlines = await gatherHeadlines(NEWS_QUERIES, 8);
  const userPrompt =
    `Current time: ${new Date().toUTCString()}.\n\n` +
    `Real, current headlines pulled live moments ago:\n\n${headlineBlock(headlines)}\n\n` +
    `Produce the JSON object now.`;
  const data = extractJson(await runGroq(NEWS_SYSTEM, userPrompt));
  const items = Array.isArray(data) ? data : data && data.items;
  if (!Array.isArray(items)) throw new Error('Expected a JSON array of news items.');
  return items.slice(0, 12);
}

async function fetchAnalysis() {
  const headlines = await gatherHeadlines(
    ['US stock market today', 'S&P 500 sectors performance', 'Federal Reserve interest rates', 'US economy outlook'], 8
  );
  const userPrompt =
    `Current time: ${new Date().toUTCString()}.\n\n` +
    `Real, current US market headlines pulled live moments ago:\n\n${headlineBlock(headlines)}\n\n` +
    `Produce the JSON object now.`;
  const data = extractJson(await runGroq(ANALYSIS_SYSTEM, userPrompt));
  if (!data || !Array.isArray(data.industries)) throw new Error('Expected an object with an industries array.');
  return data;
}

async function fetchCompany(query) {
  const headlines = await gatherHeadlines([`${query} stock`, `${query} news`], 10);
  const userPrompt =
    `Current time: ${new Date().toUTCString()}.\n` +
    `Company to analyze: "${query}".\n\n` +
    `Real, current headlines pulled live moments ago:\n\n${headlineBlock(headlines)}\n\n` +
    `Produce the JSON object now.`;
  const data = extractJson(await runGroq(COMPANY_SYSTEM, userPrompt));
  if (!data || !Array.isArray(data.news)) throw new Error('Expected an object with a news array.');
  return data;
}

// --- Supply chain (SPLC): AI-mapped relationships + live Finnhub quotes ------
// Finnhub's own supply-chain endpoint is premium-only, so we have Groq identify
// the real, publicly-listed suppliers/customers, then attach a LIVE Finnhub quote
// to every ticker (so prices are real) and add real competitors from /stock/peers.
const SUPPLYCHAIN_SYSTEM = `You are a supply-chain and equity research analyst. Given a company,
identify its most important real-world PUBLICLY-LISTED suppliers (vendors it buys parts, components,
services or inputs from) and PUBLICLY-LISTED customers (companies that buy or resell its products/services).
Use well-established, factual relationships from your knowledge.

Return ONE JSON object:
{
  "company": official company name,
  "ticker": the company's primary US-listed stock ticker in caps (or "" if not US-listed),
  "summary": one sentence on the company's position in its supply chain,
  "suppliers": array of up to 8, MOST IMPORTANT FIRST, each {
    "name": company name,
    "ticker": its US stock ticker in caps, or "" if private / foreign-only,
    "relationship": short phrase naming what it supplies (e.g. "Chip fabrication", "Seats & interiors"),
    "tier": "key" | "major" | "minor"
  },
  "customers": array of up to 8, MOST IMPORTANT FIRST, same shape (relationship = what they buy / use it for)
}
Strongly prefer companies listed on US exchanges (NYSE/Nasdaq) and give their correct real tickers.
Only include real, currently-traded companies. Omit a relationship rather than invent a fake ticker.
Return ONLY the JSON object. No markdown, no commentary.`;

async function fetchSupplyChain(query) {
  // If we were handed a ticker, resolve its real name to ground the model better.
  let focalName = query;
  let focalTicker = /^[A-Z.]{1,6}$/.test(query) ? query.toUpperCase() : '';
  if (focalTicker) {
    try { const p = await finnhub('/stock/profile2', { symbol: focalTicker }); if (p && p.name) focalName = p.name; } catch {}
  }

  const userPrompt =
    `Company to map: "${focalName}"${focalTicker ? ` (US ticker ${focalTicker})` : ''}.\n` +
    `Produce the supply-chain JSON now.`;
  const data = extractJson(await runGroq(SUPPLYCHAIN_SYSTEM, userPrompt));
  if (!data || (!Array.isArray(data.suppliers) && !Array.isArray(data.customers))) {
    throw new Error('Expected suppliers/customers arrays.');
  }
  data.suppliers = (Array.isArray(data.suppliers) ? data.suppliers : []).slice(0, 8);
  data.customers = (Array.isArray(data.customers) ? data.customers : []).slice(0, 8);

  const focal = (focalTicker || data.ticker || '').toUpperCase();

  // Real competitors from Finnhub's free peers endpoint (tickers only).
  let peers = [];
  if (focal) {
    try {
      const list = await finnhub('/stock/peers', { symbol: focal });
      peers = (Array.isArray(list) ? list : [])
        .filter((t) => t && t.toUpperCase() !== focal).slice(0, 6)
        .map((t) => ({ name: '', ticker: t.toUpperCase(), relationship: 'Industry peer', tier: 'peer' }));
    } catch {}
  }

  // Attach a LIVE quote to every distinct ticker (incl. the focal company).
  const all = [...data.suppliers, ...data.customers, ...peers];
  const tickers = [...new Set([focal, ...all.map((x) => (x.ticker || '').toUpperCase())].filter(Boolean))];
  const quotes = {};
  await Promise.all(tickers.map(async (t) => {
    try {
      const q = await finnhub('/quote', { symbol: t });
      if (q && (q.c || q.pc)) quotes[t] = { price: q.c, change: q.d, percent: q.dp };
    } catch {}
  }));
  const attach = (x) => { const t = (x.ticker || '').toUpperCase(); return { ...x, ticker: t, quote: quotes[t] || null }; };

  data.suppliers = data.suppliers.map(attach);
  data.customers = data.customers.map(attach);
  data.peers = peers.map(attach);
  data.ticker = focal || data.ticker || '';
  data.company = data.company || focalName;
  data.focalQuote = focal ? quotes[focal] || null : null;
  return data;
}

// --- Breaking alerts (derived from the news refresh; pushed to devices) -----
const seenAlertKeys = new Set();
let alertsPrimed = false;
let recentAlerts = [];
const MAX_ALERTS = 40;
const alertKey = (item) =>
  String(item.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 80);
function toAlert(item) {
  return {
    id: alertKey(item), title: item.title || '', summary: item.summary || '', detail: item.detail || '',
    category: item.category || 'macro', source: item.source || '', marketImpact: item.marketImpact || '',
    tickers: Array.isArray(item.tickers) ? item.tickers : [],
    watchUrl: typeof item.watchUrl === 'string' ? item.watchUrl : '',
    timestamp: item.timestamp || new Date().toISOString(),
  };
}
async function detectAlerts(items) {
  if (!Array.isArray(items)) return;
  const fresh = [];
  for (const item of items) {
    if (!item || item.priority !== 'high' || !item.title) continue;
    const key = alertKey(item);
    if (!key || seenAlertKeys.has(key)) continue;
    seenAlertKeys.add(key);
    fresh.push(item);
  }
  if (!fresh.length) return;
  recentAlerts = [...fresh.map(toAlert), ...recentAlerts].slice(0, MAX_ALERTS);
  if (!alertsPrimed) { alertsPrimed = true; return; } // baseline: don't blast pre-existing news
  for (const item of fresh) {
    const alert = toAlert(item);
    const n = await sendPush({
      title: (alert.watchUrl ? '🔴 LIVE · ' : '🚨 ') + alert.title,
      body: alert.summary || alert.marketImpact || '',
      url: '/?tab=alerts', watchUrl: alert.watchUrl, tag: alert.id,
    });
    if (n) console.log(`🔔 pushed alert to ${n} device(s): ${alert.title}`);
  }
}
async function fetchNewsAndDetect() {
  const items = await fetchIntelNews();
  detectAlerts(items).catch((e) => console.error('alert detect:', e.message));
  return items;
}

function friendlyError(err) {
  const status = err && (err.status || err.statusCode);
  const msg = String((err && err.message) || err);
  if (status === 401 || /invalid api key|unauthorized/i.test(msg)) return 'AI key missing or invalid. Add a valid GROQ_API_KEY and reload.';
  if (status === 429 || /rate limit|quota|\b429\b/i.test(msg)) return 'Hit a brief rate limit — please try again in a moment.';
  if (status === 503 || status === 500 || /overloaded|temporarily|\b503\b/i.test(msg)) return 'The AI service is briefly busy. Please try again in a moment.';
  return 'Could not fetch live data right now — please try again shortly.';
}

// --- Per-IP rate limit (30 req/min) -----------------------------------------
const RATE = { windowMs: 60 * 1000, max: 30 };
const rlHits = new Map();
function rateLimit(req, res, next) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.ip;
  const now = Date.now();
  let h = rlHits.get(ip);
  if (!h || h.resetAt <= now) { h = { count: 0, resetAt: now + RATE.windowMs }; rlHits.set(ip, h); }
  h.count++;
  if (h.count > RATE.max) return res.status(429).json({ error: true, message: 'Too many requests — slow down a moment.' });
  next();
}

// --- Intelligence routes ----------------------------------------------------
app.get('/api/intel/news', rateLimit, async (req, res) => {
  try {
    const { data, fresh } = await getData('news', fetchNewsAndDetect);
    res.json({ cached: !fresh, items: data });
  } catch (err) {
    console.error('intel news error:', err.message);
    res.status(500).json({ error: true, message: friendlyError(err) });
  }
});

app.get('/api/intel/analysis', rateLimit, async (req, res) => {
  try {
    const { data, fresh } = await getData('analysis', fetchAnalysis);
    res.json({ cached: !fresh, ...data });
  } catch (err) {
    console.error('intel analysis error:', err.message);
    res.status(500).json({ error: true, message: friendlyError(err) });
  }
});

app.get('/api/intel/company', rateLimit, async (req, res) => {
  try {
    const query = (req.query.q || '').toString().trim().slice(0, 60);
    if (!query) return res.status(400).json({ error: true, message: 'Missing company name or ticker.' });
    const { data, fresh } = await getData('company:' + query.toLowerCase(), () => fetchCompany(query));
    res.json({ cached: !fresh, ...data });
  } catch (err) {
    console.error('intel company error:', err.message);
    res.status(500).json({ error: true, message: friendlyError(err) });
  }
});

app.get('/api/intel/supplychain', rateLimit, async (req, res) => {
  try {
    const query = (req.query.q || '').toString().trim().slice(0, 60);
    if (!query) return res.status(400).json({ error: true, message: 'Missing company name or ticker.' });
    const { data, fresh } = await getData('supplychain:' + query.toLowerCase(), () => fetchSupplyChain(query));
    res.json({ cached: !fresh, ...data });
  } catch (err) {
    console.error('supplychain error:', err.message);
    res.status(500).json({ error: true, message: friendlyError(err) });
  }
});

app.get('/api/intel/alerts', rateLimit, (req, res) => {
  res.json({ enabled: pushEnabled, alerts: recentAlerts });
});

// --- Push notification routes ----------------------------------------------
app.get('/api/vapid-public-key', (req, res) => res.json({ key: VAPID_PUBLIC, enabled: pushEnabled }));
app.post('/api/subscribe', (req, res) => {
  const sub = req.body && req.body.endpoint ? req.body : req.body && req.body.subscription;
  if (!sub || !sub.endpoint) return res.status(400).json({ error: true, message: 'Invalid subscription.' });
  addSub(sub);
  res.json({ ok: true });
});
app.post('/api/unsubscribe', (req, res) => {
  const endpoint = req.body && (req.body.endpoint || (req.body.subscription && req.body.subscription.endpoint));
  if (endpoint) removeSub(endpoint);
  res.json({ ok: true });
});
app.post('/api/test-push', async (req, res) => {
  const n = await sendPush({
    title: '✅ Alerts are on',
    body: 'You’ll get a notification here when major market news breaks.',
    url: '/?tab=alerts',
  });
  res.json({ ok: true, devices: n });
});

// ───────────────────────── static + boot ─────────────────────────

app.use(express.static(path.join(__dirname, 'public')));

// Anything else falls back to the SPA shell.
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n  Market Terminal running →  http://localhost:${PORT}\n`);
  console.log(`  Finnhub key ${FINNHUB_KEY ? 'loaded ✓' : 'MISSING ✗ (quotes/news/search disabled)'}`);
  console.log(`  Groq key    ${GROQ_KEY ? 'loaded ✓' : 'MISSING ✗ (NEWS/SECTORS/WATCHLIST disabled)'}`);
  console.log(`  Web Push    ${pushEnabled ? 'enabled ✓' : 'disabled (no VAPID keys)'}\n`);

  // Warm the intel news cache so the first NEWS-tab open is instant, and seed the
  // alerts baseline. Analysis is warmed lazily (heavier Groq call) when its tab opens.
  if (GROQ_KEY) {
    console.log('  ⏳ Warming live market-news cache in the background…');
    getData('news', fetchNewsAndDetect)
      .then(() => console.log('     ✓ market news ready'))
      .catch((e) => console.error('     news warm failed:', e.message));
  }
});
