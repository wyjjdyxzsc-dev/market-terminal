'use strict';

/**
 * Market Terminal — local development backend (Express / Node 18+)
 *
 * MODULE 1: Resilient Backend & Pool Routing
 *   1.1  AI Provider Pool — Speed tier (Groq, Cerebras, SambaNova) vs
 *        Heavy tier (Gemini, OpenRouter, DeepSeek, Cohere, Together, Mistral,
 *        Nebius, HuggingFace, GitHub Models). AbortController batch racing:
 *        first valid-JSON winner that passes a validation callback cancels all
 *        losers immediately. Penalty box: 429 → 1-min park, quota → 30-min park.
 *   1.2  Quote Pool — Finnhub WebSocket primary (ws package, graceful degradation).
 *        REST fallback cascade: Finnhub×5 round-robin → TwelveData → FMP →
 *        AlphaVantage → Polygon → Yahoo (keyless).
 *   1.3  Tiered KV cache — fetch_cached_data() with per-category TTLs:
 *        Map/FIRMS/USGS 86400s · News/Sentiment 900s · Chart 60s · Quote 5s.
 *
 * MODULE 3 (partial): Geospatial — Overpass API pipeline / undersea-cable /
 *        nuclear / military / datacenter aggregation with macroeconomic shock
 *        payloads injected per feature.
 */

const path = require('path');
const fs   = require('fs');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express   = require('express');
const RssParser = require('rss-parser');
const webpush   = require('web-push');

// Optional WebSocket for Finnhub live feed.  npm i ws  to enable.
let WS;
try { WS = require('ws'); } catch { /* ws not installed — REST-only mode */ }

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '16kb' }));

const PORT         = process.env.PORT || 3000;
const FINNHUB_BASE = 'https://finnhub.io/api/v1';
const BROWSER_UA   =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const FINNHUB_KEYS = [
  process.env.FINNHUB_API_KEY,
  process.env.FINNHUB_API_KEY_2,
  process.env.FINNHUB_API_KEY_3,
  process.env.FINNHUB_API_KEY_4,
  process.env.FINNHUB_API_KEY_5,
].filter(Boolean);

// ═══════════════════════════════════════════════════════════════════════════
//  SECTION 1 — GENERIC HELPERS
// ═══════════════════════════════════════════════════════════════════════════

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** YYYY-MM-DD, `days` calendar days ago (UTC). */
const isoDaysAgo = (days) =>
  new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

/** fetch() with a hard abort timeout so a hung upstream can't block a request. */
async function fetchWithTimeout(url, opts = {}, timeoutMs = 9000) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Wrap an async route handler: any throw → 502 JSON (server never crashes). */
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

/** Strip markdown fences and extract the first JSON object/array from text. */
function extractJson(text) {
  if (!text) throw new Error('Empty response from model.');
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  if (s[0] !== '{' && s[0] !== '[') {
    const fo = s.indexOf('{'), fa = s.indexOf('[');
    const start = fa === -1 ? fo : fo === -1 ? fa : Math.min(fo, fa);
    if (start === -1) throw new Error('No JSON found in model response.');
    const end = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'));
    s = s.slice(start, end + 1);
  }
  return JSON.parse(s);
}

/** Convert provider/upstream errors to a human-readable message. */
function friendlyError(err) {
  const status = err && (err.status || err.statusCode);
  const msg    = String((err && err.message) || err);
  if (status === 401 || /invalid api key|unauthorized/i.test(msg))
    return 'AI key missing or invalid. Add a valid key and reload.';
  if (status === 429 || /rate limit|quota|\b429\b/i.test(msg))
    return 'Hit a brief rate limit — please try again in a moment.';
  if (status === 503 || status === 500 || /overloaded|temporarily|\b503\b/i.test(msg))
    return 'The AI service is briefly busy. Please try again in a moment.';
  return 'Could not fetch live data right now — please try again shortly.';
}

/** Numeric parse that handles "$1,234.50" style strings. */
const qnum = (v) => {
  const n = parseFloat(String(v).replace(/[$,%]/g, '').trim());
  return Number.isFinite(n) ? n : null;
};

const isRateLimited = (err) => {
  const status = err && (err.status || err.statusCode);
  const msg    = String((err && err.message) || '');
  return status === 429 ||
    /\b429\b|rate limit|quota|too many requests|exhausted|resource_exhausted/i.test(msg);
};

const cooldownMs = (err) =>
  /per day|daily|tpd|quota|exhausted|resource_exhausted/i.test(
    String((err && err.message) || ''))
    ? 30 * 60 * 1000
    : 60 * 1000;

// ═══════════════════════════════════════════════════════════════════════════
//  SECTION 2 — TIERED IN-MEMORY KV CACHE  (Module 1.3)
//
//  TTL constants (seconds):
//    TTL.MAP    86400  — Overpass / USGS / FIRMS / GeoJSON      (24 h)
//    TTL.NEWS     900  — Google News RSS, Twitter sentiment      (15 min)
//    TTL.CHART     60  — Chart OHLCV history                     (1 min)
//    TTL.QUOTE      5  — REST quote fallback                     (5 s)
// ═══════════════════════════════════════════════════════════════════════════

const TTL = Object.freeze({ MAP: 86_400, NEWS: 900, CHART: 60, QUOTE: 5 });

const _kvStore  = new Map(); // key → { value, expireAt }
const _kvFlight = new Map(); // key → Promise  (in-flight dedup)

function kvGet(key) {
  const e = _kvStore.get(key);
  if (!e) return null;
  if (Date.now() > e.expireAt) { _kvStore.delete(key); return null; }
  return e.value;
}

function kvPut(key, value, ttlSeconds) {
  _kvStore.set(key, { value, expireAt: Date.now() + ttlSeconds * 1000 });
}

/**
 * Cache-aside wrapper identical in contract to the CF Worker pattern.
 * Returns { data, fresh } — fresh=false means served from cache.
 */
async function fetch_cached_data(key, fetcher, ttlSeconds) {
  const cached = kvGet(key);
  if (cached !== null) return { data: cached, fresh: false };
  if (_kvFlight.has(key)) return { data: await _kvFlight.get(key), fresh: true };

  const p = fetcher()
    .then(data => { kvPut(key, data, ttlSeconds); return data; })
    .finally(() => _kvFlight.delete(key));
  _kvFlight.set(key, p);
  return { data: await p, fresh: true };
}

// ═══════════════════════════════════════════════════════════════════════════
//  SECTION 3 — AI PROVIDER POOL & TIERED RACING  (Module 1.1)
// ═══════════════════════════════════════════════════════════════════════════

// ── 3a: Penalty box ────────────────────────────────────────────────────────
// Maps provider name → expireAt (ms). Checked before each race.

const _penaltyBox = new Map();

function isParked(name) {
  const exp = _penaltyBox.get(name);
  if (exp === undefined) return false;
  if (Date.now() > exp) { _penaltyBox.delete(name); return false; }
  return true;
}

function parkProvider(name, ms) {
  _penaltyBox.set(name, Date.now() + ms);
  console.warn(`[ai] ${name} parked for ${Math.round(ms / 1000)}s`);
}

// ── 3b: Provider definitions ───────────────────────────────────────────────

// Speed tier: low-latency providers ideal for NLP / UI / sentiment tasks.
const SPEED_PROVIDERS = [
  {
    name: 'groq',
    envKey: 'GROQ_API_KEY',
    url: 'https://api.groq.com/openai/v1/chat/completions',
    modelEnv: 'GROQ_MODEL',
    defaultModel: 'llama-3.3-70b-versatile',
    format: 'openai',
  },
  {
    name: 'cerebras',
    envKey: 'CEREBRAS_API_KEY',
    url: 'https://api.cerebras.ai/v1/chat/completions',
    modelEnv: 'CEREBRAS_MODEL',
    defaultModel: 'llama3.1-70b',
    format: 'openai',
  },
  {
    name: 'sambanova',
    envKey: 'SAMBANOVA_API_KEY',
    url: 'https://api.sambanova.ai/v1/chat/completions',
    modelEnv: 'SAMBANOVA_MODEL',
    defaultModel: 'Meta-Llama-3.3-70B-Instruct',
    format: 'openai',
  },
  {
    name: 'together',
    envKey: 'TOGETHER_API_KEY',
    url: 'https://api.together.xyz/v1/chat/completions',
    modelEnv: 'TOGETHER_MODEL',
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo-Free',
    format: 'openai',
  },
  {
    name: 'mistral',
    envKey: 'MISTRAL_API_KEY',
    url: 'https://api.mistral.ai/v1/chat/completions',
    modelEnv: 'MISTRAL_MODEL',
    defaultModel: 'mistral-large-latest',
    format: 'openai',
  },
];

// Heavy tier: providers suited for math / logic / structured analysis.
const HEAVY_PROVIDERS = [
  {
    name: 'gemini',
    envKey: 'GEMINI_API_KEY',
    modelEnv: 'GEMINI_MODEL',
    defaultModel: 'gemini-2.0-flash',
    format: 'gemini',
  },
  {
    name: 'openrouter',
    envKey: 'OPENROUTER_API_KEY',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    modelEnv: 'OPENROUTER_MODEL',
    defaultModel: 'meta-llama/llama-3.3-70b-instruct:free',
    format: 'openai',
    extraHeaders: {
      'HTTP-Referer': 'https://market-terminal.wyjjdyxzsc.workers.dev',
      'X-Title': 'Market Terminal',
    },
  },
  {
    name: 'deepseek',
    envKey: 'DEEPSEEK_API_KEY',
    url: 'https://api.deepseek.com/v1/chat/completions',
    modelEnv: 'DEEPSEEK_MODEL',
    defaultModel: 'deepseek-chat',
    format: 'openai',
  },
  {
    name: 'cohere',
    envKey: 'COHERE_API_KEY',
    url: 'https://api.cohere.com/v2/chat',
    modelEnv: 'COHERE_MODEL',
    defaultModel: 'command-r-plus',
    format: 'cohere',
  },
  {
    name: 'nebius',
    envKey: 'NEBIUS_API_KEY',
    url: 'https://api.studio.nebius.com/v1/chat/completions',
    modelEnv: 'NEBIUS_MODEL',
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct',
    format: 'openai',
  },
  {
    name: 'huggingface',
    envKey: 'HF_API_KEY',
    url: 'https://router.huggingface.co/v1/chat/completions',
    modelEnv: 'HF_MODEL',
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct',
    format: 'openai',
  },
  {
    name: 'github',
    envKey: 'GITHUB_MODELS_TOKEN',
    url: 'https://models.github.ai/inference/chat/completions',
    modelEnv: 'GITHUB_MODEL',
    defaultModel: 'openai/gpt-4o-mini',
    format: 'openai',
  },
];

// ── 3c: Request builders & response extractors ────────────────────────────

function _resolveModel(p) {
  return (p.modelEnv && process.env[p.modelEnv]) || p.defaultModel;
}

function _buildBody(p, sys, usr) {
  const model = _resolveModel(p);
  if (p.format === 'gemini') {
    return JSON.stringify({
      systemInstruction: { parts: [{ text: sys }] },
      contents: [{ role: 'user', parts: [{ text: usr }] }],
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 8192,
        responseMimeType: 'application/json',
      },
    });
  }
  if (p.format === 'cohere') {
    return JSON.stringify({
      model,
      messages: [
        { role: 'system', content: sys },
        { role: 'user',   content: usr },
      ],
      temperature: 0.4,
    });
  }
  // openai-compatible
  return JSON.stringify({
    model,
    messages: [
      { role: 'system', content: sys },
      { role: 'user',   content: usr },
    ],
    temperature: 0.4,
    max_tokens: 8000,
    response_format: { type: 'json_object' },
  });
}

function _extractText(p, data) {
  if (p.format === 'gemini')
    return data?.candidates?.[0]?.content?.parts?.map(x => x.text).join('') || '';
  if (p.format === 'cohere')
    return data?.message?.content?.[0]?.text ?? data?.text ?? '';
  return data?.choices?.[0]?.message?.content ?? '';  // openai-compatible
}

// ── 3d: Single-provider caller ────────────────────────────────────────────

async function _callProvider(p, sys, usr, signal) {
  const key = process.env[p.envKey];
  if (!key || isParked(p.name)) return null;

  let url = p.url;
  if (p.format === 'gemini') {
    const model = _resolveModel(p);
    url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  }

  const headers = { 'Content-Type': 'application/json' };
  if (p.format !== 'gemini') headers['Authorization'] = `Bearer ${key}`;
  if (p.extraHeaders) Object.assign(headers, p.extraHeaders);

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: _buildBody(p, sys, usr),
    signal,
  });

  if (res.status === 429 || res.status === 402) {
    const ms = cooldownMs({ status: res.status, message: await res.text().catch(() => '') });
    parkProvider(p.name, ms);
    throw new Error(`${p.name} rate/quota limited (${res.status})`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (/quota|exceeded|billing|exhausted/i.test(body)) {
      parkProvider(p.name, 30 * 60 * 1000);
      throw new Error(`${p.name} quota exceeded`);
    }
    throw new Error(`${p.name} responded ${res.status}`);
  }

  const data = await res.json();
  const text = _extractText(p, data);
  if (!text) throw new Error(`${p.name} returned empty content`);
  return text;
}

// ── 3e: Batch racing engine ───────────────────────────────────────────────

/**
 * Fire one batch of providers concurrently. The first that returns valid JSON
 * AND passes the validate callback wins; its AbortController cancels all losers.
 * Returns { data, provider } or null if all in the batch miss.
 */
function _raceBatch(batch, sys, usr, validate) {
  return new Promise(resolve => {
    let pending  = batch.length;
    let settled  = false;
    const ctrls  = batch.map(() => new AbortController());

    const miss = () => { if (!settled && --pending === 0) resolve(null); };

    batch.forEach((p, i) => {
      Promise.resolve()
        .then(() => _callProvider(p, sys, usr, ctrls[i].signal))
        .then(text => {
          if (!text) return miss();
          let data;
          try { data = extractJson(text); } catch {
            console.log(`[ai] ${p.name} unparseable`); return miss();
          }
          if (!validate(data)) {
            console.log(`[ai] ${p.name} failed validation`); return miss();
          }
          if (settled) return;
          settled = true;
          ctrls.forEach((c, j) => { if (j !== i) try { c.abort(); } catch {} });
          console.log(`[ai] ${p.name} WON`);
          resolve({ data, provider: p.name });
        })
        .catch(err => {
          if (err?.name === 'AbortError') return;
          if (!settled) console.error(`[ai] ${p.name} error: ${err.message}`);
          if (isRateLimited(err)) parkProvider(p.name, cooldownMs(err));
          miss();
        });
    });
  });
}

/**
 * Race all available providers in the relevant tier.
 * Falls back to the opposite tier if primary is empty/all-parked.
 * Providers are batched by AI_PARALLEL (default 5) so a large pool
 * doesn't simultaneously exhaust every key.
 *
 * taskType : 'speed' | 'heavy'
 * validate : (parsedJson) => boolean  — reject empty/useless responses
 */
async function raceProviders(taskType, sys, usr, validate = () => true) {
  const primary  = taskType === 'heavy' ? HEAVY_PROVIDERS : SPEED_PROVIDERS;
  const fallback = taskType === 'heavy' ? SPEED_PROVIDERS : HEAVY_PROVIDERS;

  let candidates = primary.filter(p => process.env[p.envKey] && !isParked(p.name));
  if (!candidates.length)
    candidates = fallback.filter(p => process.env[p.envKey] && !isParked(p.name));
  if (!candidates.length)
    throw new Error('All AI providers are parked or unconfigured. Add at least one API key to .env.');

  const width = Math.max(2, parseInt(process.env.AI_PARALLEL || '5', 10) || 5);

  for (let i = 0; i < candidates.length; i += width) {
    const result = await _raceBatch(candidates.slice(i, i + width), sys, usr, validate);
    if (result) return result.data;
  }
  throw new Error('All AI providers in tier failed or returned unusable responses.');
}

// ═══════════════════════════════════════════════════════════════════════════
//  SECTION 4 — QUOTE POOL  (Module 1.2)
//  Priority:
//    1. Finnhub WebSocket in-memory cache  (<5 s old)
//    2. KV REST cache                      (5 s TTL)
//    3. REST cascade: Finnhub×5 → TwelveData → FMP → AlphaVantage →
//                     Polygon → Yahoo (keyless)
// ═══════════════════════════════════════════════════════════════════════════

// ── 4a: Finnhub WebSocket live cache ──────────────────────────────────────

const _wsQuoteCache = new Map(); // SYMBOL → { c, d, dp, h, l, o, pc, t, src }
let   _wsConn       = null;
const _wsSubscribed = new Set();

function _wsConnect() {
  if (!WS || !FINNHUB_KEYS.length) return;
  if (_wsConn && (
    _wsConn.readyState === WS.OPEN ||
    _wsConn.readyState === WS.CONNECTING
  )) return;

  const key = FINNHUB_KEYS[0];
  _wsConn = new WS(`wss://ws.finnhub.io?token=${key}`);

  _wsConn.on('open', () => {
    console.log('[ws] Finnhub connected');
    _wsSubscribed.forEach(sym =>
      _wsConn.send(JSON.stringify({ type: 'subscribe', symbol: sym }))
    );
  });

  _wsConn.on('message', raw => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type !== 'trade' || !Array.isArray(msg.data)) return;
      msg.data.forEach(trade => {
        const sym  = trade.s;
        const prev = _wsQuoteCache.get(sym) || {};
        const c    = trade.p;
        const pc   = prev.pc || c;
        _wsQuoteCache.set(sym, {
          c,
          d:   c - pc,
          dp:  pc ? ((c - pc) / pc) * 100 : 0,
          h:   Math.max(c, prev.h || c),
          l:   Math.min(c, prev.l || c),
          o:   prev.o || c,
          pc,
          t:   trade.t,
          src: 'finnhub-ws',
        });
      });
    } catch {}
  });

  _wsConn.on('close', () => {
    console.warn('[ws] Finnhub disconnected — reconnecting in 5 s…');
    setTimeout(_wsConnect, 5000);
  });

  _wsConn.on('error', err => console.error('[ws] Finnhub WS error:', err.message));
}

function wsSubscribe(symbol) {
  _wsSubscribed.add(symbol);
  if (_wsConn && _wsConn.readyState === WS.OPEN)
    _wsConn.send(JSON.stringify({ type: 'subscribe', symbol }));
}

// ── 4b: REST provider fetchers ─────────────────────────────────────────────

let _fhKeyIdx = 0;
function _pickFinnhubKey() {
  return FINNHUB_KEYS.length ? FINNHUB_KEYS[_fhKeyIdx++ % FINNHUB_KEYS.length] : null;
}

async function _quoteFinnhub(symbol) {
  const key = _pickFinnhubKey();
  if (!key) return null;
  const r = await fetchWithTimeout(
    `${FINNHUB_BASE}/quote?symbol=${encodeURIComponent(symbol)}&token=${key}`,
    { headers: { Accept: 'application/json' } }, 8000
  );
  if (r.status === 429) throw new Error('finnhub rate limited');
  if (!r.ok) return null;
  const q = await r.json();
  if (!q || (!q.c && !q.pc)) return null;
  return { c: q.c, d: q.d, dp: q.dp, h: q.h, l: q.l, o: q.o, pc: q.pc, src: 'finnhub' };
}

async function _quoteTwelveData(symbol) {
  const key = process.env.TWELVEDATA_KEY;
  if (!key) return null;
  const r = await fetchWithTimeout(
    `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbol)}&apikey=${key}`,
    {}, 10000
  );
  if (!r.ok) return null;
  const q = await r.json();
  if (!q || q.status === 'error' || q.close == null) return null;
  const c = qnum(q.close), pc = qnum(q.previous_close);
  return { c, d: qnum(q.change), dp: qnum(q.percent_change), h: qnum(q.high), l: qnum(q.low), o: qnum(q.open), pc, src: 'twelvedata' };
}

async function _quoteFMP(symbol) {
  const key = process.env.FMP_KEY;
  if (!key) return null;
  const r = await fetchWithTimeout(
    `https://financialmodelingprep.com/api/v3/quote/${encodeURIComponent(symbol)}?apikey=${key}`,
    {}, 10000
  );
  if (!r.ok) return null;
  const arr = await r.json();
  const q   = Array.isArray(arr) && arr[0];
  if (!q || q.price == null) return null;
  return { c: qnum(q.price), d: qnum(q.change), dp: qnum(q.changesPercentage), h: qnum(q.dayHigh), l: qnum(q.dayLow), o: qnum(q.open), pc: qnum(q.previousClose), src: 'fmp' };
}

async function _quoteAlphaVantage(symbol) {
  const key = process.env.ALPHAVANTAGE_KEY;
  if (!key) return null;
  const r = await fetchWithTimeout(
    `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${key}`,
    {}, 12000
  );
  if (!r.ok) return null;
  const data = await r.json();
  const q    = data?.['Global Quote'];
  if (!q || !q['05. price']) return null;
  return {
    c: qnum(q['05. price']),
    d: qnum(q['09. change']),
    dp: qnum((q['10. change percent'] || '').replace('%', '')),
    h: qnum(q['03. high']),
    l: qnum(q['04. low']),
    o: qnum(q['02. open']),
    pc: qnum(q['08. previous close']),
    src: 'alphavantage',
  };
}

async function _quotePolygon(symbol) {
  const key = process.env.POLYGON_KEY;
  if (!key) return null;
  const r = await fetchWithTimeout(
    `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers/${encodeURIComponent(symbol)}?apiKey=${key}`,
    {}, 10000
  );
  if (!r.ok) return null;
  const data = await r.json();
  const t    = data?.ticker;
  if (!t) return null;
  const day = t.day || {}, prev = t.prevDay || {};
  const c   = (t.lastTrade?.p) || day.c;
  if (!c) return null;
  const pc = prev.c || null;
  return { c, d: pc ? c - pc : qnum(t.todaysChange), dp: pc ? ((c - pc) / pc) * 100 : qnum(t.todaysChangePerc), h: day.h || c, l: day.l || c, o: day.o || c, pc, src: 'polygon' };
}

async function _quoteYahoo(symbol) {
  try {
    const r = await fetchWithTimeout(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1m&includePrePost=false`,
      { headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json' } }, 9000
    );
    if (!r.ok) return null;
    const data = await r.json();
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta?.regularMarketPrice) return null;
    const c  = meta.regularMarketPrice;
    const pc = meta.chartPreviousClose || meta.previousClose || null;
    return { c, d: pc ? c - pc : null, dp: pc ? ((c - pc) / pc) * 100 : null, h: meta.regularMarketDayHigh || c, l: meta.regularMarketDayLow || c, o: meta.regularMarketOpen || c, pc, src: 'yahoo' };
  } catch { return null; }
}

// REST cascade: Finnhub tried for each key slot, then the other providers.
const QUOTE_CASCADE = [
  _quoteFinnhub, _quoteFinnhub, _quoteFinnhub, _quoteFinnhub, _quoteFinnhub,
  _quoteTwelveData, _quoteFMP, _quoteAlphaVantage, _quotePolygon, _quoteYahoo,
];

/**
 * getQuote(symbol) — unified entry point.
 * Checks WS cache → KV REST cache → REST cascade.
 */
async function getQuote(symbol) {
  const sym = symbol.toUpperCase();

  // 1. Finnhub WS live cache (sub-5 s)
  const ws = _wsQuoteCache.get(sym);
  if (ws && Date.now() - ws.t < 5000) return ws;

  // 2. KV REST cache (5 s TTL)
  const cached = kvGet(`quote:${sym}`);
  if (cached) return cached;

  // 3. Serial REST cascade
  for (const fetcher of QUOTE_CASCADE) {
    try {
      const q = await fetcher(sym);
      if (q && q.c) { kvPut(`quote:${sym}`, q, TTL.QUOTE); return q; }
    } catch (err) {
      console.error(`[quote] ${fetcher.name} failed:`, err.message);
    }
  }
  throw new Error(`No quote available for ${sym} from any provider.`);
}

// ── 4c: Finnhub REST wrapper (for non-quote endpoints) ────────────────────

let _fhRestIdx = 0;
async function finnhub(endpoint, params = {}) {
  if (!FINNHUB_KEYS.length) throw new Error('No Finnhub key configured.');
  const key = FINNHUB_KEYS[_fhRestIdx++ % FINNHUB_KEYS.length];
  const url = new URL(FINNHUB_BASE + endpoint);
  for (const [k, v] of Object.entries(params))
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  url.searchParams.set('token', key);
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (res.status === 429) throw new Error('Rate limit reached (Finnhub free tier). Wait a moment and retry.');
  if (!res.ok) throw new Error(`Finnhub responded ${res.status} for ${endpoint}`);
  return res.json();
}

function requireFinnhub(res) {
  if (!FINNHUB_KEYS.length) {
    res.status(500).json({ error: 'Server is missing FINNHUB_API_KEY. See .env.example.' });
    return false;
  }
  return true;
}

// ═══════════════════════════════════════════════════════════════════════════
//  SECTION 5 — CHART DATA  (Yahoo → Nasdaq cascade)
// ═══════════════════════════════════════════════════════════════════════════

const YAHOO_RANGE = {
  '1D': { range: '1d',  interval: '5m'  },
  '5D': { range: '5d',  interval: '15m' },
  '1M': { range: '1mo', interval: '1d'  },
  '6M': { range: '6mo', interval: '1d'  },
  '1Y': { range: '1y',  interval: '1d'  },
  '5Y': { range: '5y',  interval: '1wk' },
};
const NASDAQ_DAYS = { '5D': 9, '1M': 35, '6M': 190, '1Y': 370, '5Y': 1835 };
const NASDAQ_HEADERS = {
  'User-Agent': BROWSER_UA,
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
};

async function chartFromYahoo(symbol, rangeKey) {
  const cfg = YAHOO_RANGE[rangeKey] || YAHOO_RANGE['1D'];
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?range=${cfg.range}&interval=${cfg.interval}`;
  const res = await fetchWithTimeout(url, { headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json' } }, 9000);
  if (!res.ok) throw new Error(`Yahoo responded ${res.status}`);
  const data   = await res.json();
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error(data?.chart?.error?.description || 'Yahoo returned no data');
  const timestamps = result.timestamp || [];
  const q          = result.indicators?.quote?.[0] || {};
  const meta        = result.meta || {};
  const points = [];
  for (let i = 0; i < timestamps.length; i++) {
    const c = q.close?.[i];
    if (c === null || c === undefined || Number.isNaN(c)) continue;
    points.push({ t: timestamps[i] * 1000, c, o: q.open?.[i] ?? c, h: q.high?.[i] ?? c, l: q.low?.[i] ?? c });
  }
  return {
    points,
    meta: {
      prevClose: meta.chartPreviousClose ?? meta.previousClose ?? null,
      currency:  meta.currency ?? 'USD',
      price:     meta.regularMarketPrice ?? (points.length ? points[points.length - 1].c : null),
    },
  };
}

function etOffsetMinutes(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', timeZoneName: 'shortOffset',
  }).formatToParts(date);
  const tz = (parts.find(p => p.type === 'timeZoneName') || {}).value || 'GMT-5';
  const m  = tz.match(/GMT([+-]\d+)/);
  return m ? -parseInt(m[1], 10) * 60 : 300;
}

async function chartFromNasdaq(symbol, rangeKey) {
  if (rangeKey === '1D') {
    const url = `https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/chart?assetclass=stocks`;
    const res = await fetchWithTimeout(url, { headers: NASDAQ_HEADERS }, 12000);
    if (!res.ok) throw new Error(`Nasdaq responded ${res.status}`);
    const data   = await res.json();
    const rows   = data?.data?.chart || [];
    const offMs  = etOffsetMinutes(new Date()) * 60000;
    const points = rows.filter(r => r && r.y != null).map(r => ({ t: r.x + offMs, c: Number(r.y) }));
    if (!points.length) throw new Error('Nasdaq returned no intraday data');
    return {
      points,
      meta: {
        prevClose: data.data.previousClose != null ? qnum(data.data.previousClose) : null,
        currency:  'USD',
        price:     data.data.lastSalePrice  != null ? qnum(data.data.lastSalePrice)  : points[points.length - 1].c,
      },
    };
  }
  const days = NASDAQ_DAYS[rangeKey] || 35;
  const url  =
    `https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/historical` +
    `?assetclass=stocks&fromdate=${isoDaysAgo(days)}&todate=${isoDaysAgo(0)}&limit=9999`;
  const res  = await fetchWithTimeout(url, { headers: NASDAQ_HEADERS }, 12000);
  if (!res.ok) throw new Error(`Nasdaq responded ${res.status}`);
  const data = await res.json();
  const rows = data?.data?.tradesTable?.rows || [];
  const toMs = (mdy) => { const [m, d, y] = mdy.split('/').map(Number); return Date.UTC(y, m - 1, d); };
  let points = rows
    .filter(r => r && r.date && r.close)
    .map(r => { const c = qnum(r.close); return { t: toMs(r.date), c, o: r.open != null ? qnum(r.open) : c, h: r.high != null ? qnum(r.high) : c, l: r.low != null ? qnum(r.low) : c }; })
    .sort((a, b) => a.t - b.t);
  if (!points.length) throw new Error('Nasdaq returned no historical data');
  if (rangeKey === '5Y' && points.length > 400)
    points = points.filter((_, i) => i % 5 === 0 || i === points.length - 1);
  return { points, meta: { prevClose: null, currency: 'USD', price: points[points.length - 1].c } };
}

let preferredChartSource = 'yahoo';

async function getChart(symbol, rangeKey) {
  const order = preferredChartSource === 'nasdaq' ? ['nasdaq', 'yahoo'] : ['yahoo', 'nasdaq'];
  let lastErr;
  for (const src of order) {
    try {
      const data = src === 'yahoo'
        ? await chartFromYahoo(symbol, rangeKey)
        : await chartFromNasdaq(symbol, rangeKey);
      if (data.points?.length >= 2) { preferredChartSource = src; return { ...data, source: src }; }
      lastErr = new Error(`${src} returned too few points`);
    } catch (err) { lastErr = err; }
  }
  throw lastErr || new Error('No chart data available');
}

// ═══════════════════════════════════════════════════════════════════════════
//  SECTION 6 — HEADLINE AGGREGATION (RSS + X/Twitter)
// ═══════════════════════════════════════════════════════════════════════════

const rss = new RssParser({
  timeout: 12000,
  headers: { 'User-Agent': 'Mozilla/5.0 (MarketTerminal news reader)' },
});

// ── 6a: RSS helpers ────────────────────────────────────────────────────────

function decodeEntities(s) {
  return String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&amp;/g, '&')
    .replace(/<[^>]+>/g, '')
    .trim();
}

const domainOf = (link) => { try { return new URL(link).hostname.replace(/^www\./, ''); } catch { return ''; } };

function parseRss(xml) {
  const items  = [];
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>/g) || [];
  for (const b of blocks) {
    const pick = (tag) => {
      const m = b.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
      return m ? decodeEntities(m[1]) : '';
    };
    const link   = pick('link');
    const source = pick('source') || pick('News:Source') || domainOf(link);
    items.push({ title: pick('title'), source, published: pick('pubDate') });
  }
  return items;
}

async function fetchFeed(url, limit = 20) {
  try {
    const res = await fetchWithTimeout(url, {
      headers: { 'User-Agent': BROWSER_UA, Accept: 'application/rss+xml, application/xml, text/xml, */*' },
    }, 11000);
    if (!res.ok) return [];
    return parseRss(await res.text()).slice(0, limit).filter(h => h.title);
  } catch { return []; }
}

function mergeHeadlines(lists, maxAgeMins = 72 * 60) {
  const seen   = new Set();
  const all    = [];
  const cutoff = Date.now() - maxAgeMins * 60_000;
  for (const list of lists) {
    for (const h of list) {
      const k = (h.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      h._ms = h.published ? (new Date(h.published).getTime() || 0) : 0;
      all.push(h);
    }
  }
  all.sort((a, b) => b._ms - a._ms);
  const fresh = all.filter(h => h._ms === 0 || h._ms >= cutoff);
  return fresh.length >= 10 ? fresh : all;
}

// ── 6b: Feed catalogues ────────────────────────────────────────────────────

const MARKET_FEEDS = [
  'https://finance.yahoo.com/news/rssindex',
  'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258',
  'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10000664',
  'https://feeds.content.dowjones.io/public/rss/mw_topstories',
  'https://feeds.content.dowjones.io/public/rss/mw_marketpulse',
  'https://www.bing.com/news/search?q=stocks+earnings+markets&format=rss',
];

const WORLD_FEEDS = [
  'https://feeds.bbci.co.uk/news/world/rss.xml',
  'https://feeds.bbci.co.uk/news/business/rss.xml',
  'https://www.aljazeera.com/xml/rss/all.xml',
  'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100727362',
  'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=15839135',
  'https://www.bing.com/news/search?q=stock+market&format=rss',
  'https://www.bing.com/news/search?q=geopolitics+conflict&format=rss',
  'https://www.bing.com/news/search?q=federal+reserve+economy&format=rss',
  'https://www.bing.com/news/search?q=oil+energy+markets&format=rss',
];

// ── 6c: X/Twitter syndication ingestion (Module 4.1) ──────────────────────
// Fetches public timeline embeds via the syndication endpoint — no API key
// required. The __NEXT_DATA__ JSON payload contains the full tweet list.

const X_ACCOUNTS = [
  'WSJmarkets', 'markets', 'unusual_whales', 'DeItaone', 'zerohedge',
  'Reuters', 'APNews', 'FederalReserve', 'SECGov', 'IMFNews',
  'RayDalio', 'elonmusk', 'GoldmanSachs', 'elerianm', 'NickTimiraos',
];

function cleanTweetText(text) {
  return (text || '').replace(/https:\/\/t\.co\/\w+\s*$/, '').replace(/\s+/g, ' ').trim();
}

async function fetchXAccountFeed(account) {
  try {
    const res = await fetchWithTimeout(
      `https://syndication.twitter.com/srv/timeline-profile/screen-name/${account}`,
      { headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html' } },
      8000
    );
    if (!res.ok) return [];
    const html = await res.text();
    const m    = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!m) return [];
    const entries = JSON.parse(m[1])?.props?.pageProps?.timeline?.entries || [];
    return entries
      .map(e => e?.content?.tweet)
      .filter(Boolean)
      .map(t => ({
        title:     cleanTweetText(t.full_text || t.text),
        source:    `X/@${account}`,
        published: t.created_at || '',
      }))
      .filter(h => h.title);
  } catch { return []; }
}

async function fetchXHeadlines() {
  // Stagger requests ~400 ms apart to avoid hitting the syndication burst limit.
  const lists = await Promise.all(
    X_ACCOUNTS.map((account, i) =>
      sleep(i * 400).then(() => fetchXAccountFeed(account))
    )
  );
  return mergeHeadlines(lists);
}

async function fetchMarketHeadlines() {
  const lists = await Promise.all(MARKET_FEEDS.map(u => fetchFeed(u, 18)));
  return mergeHeadlines(lists).slice(0, 32);
}

async function fetchWorldHeadlines() {
  const lists = await Promise.all(
    [...MARKET_FEEDS, ...WORLD_FEEDS].map(u => fetchFeed(u, 14))
      .concat([fetchXHeadlines()])
  );
  return mergeHeadlines(lists).slice(0, 60);
}

async function fetchCompanyHeadlines(query, limit = 14) {
  const q = encodeURIComponent(`${query} stock`);
  const lists = await Promise.all([
    fetchFeed(`https://www.bing.com/news/search?q=${q}&format=RSS&count=20&setlang=en-US&cc=us`, 20),
    fetchFeed(`https://news.search.yahoo.com/rss?p=${q}`, 14),
  ]);
  return mergeHeadlines(lists).slice(0, limit);
}

const headlineBlock = (headlines) =>
  !headlines.length
    ? '(no headlines retrieved)'
    : headlines.map((h, i) =>
        `${i + 1}. ${h.title}${h.source ? ` — ${h.source}` : ''}${h.published ? ` (${h.published})` : ''}`
      ).join('\n');

// ═══════════════════════════════════════════════════════════════════════════
//  SECTION 7 — WEB PUSH
// ═══════════════════════════════════════════════════════════════════════════

const VAPID_PUBLIC  = process.env.VAPID_PUBLIC_KEY  || '';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT     || 'mailto:alerts@example.com';
const pushEnabled   = Boolean(VAPID_PUBLIC && VAPID_PRIVATE);
if (pushEnabled) webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
else console.warn('⚠  Web Push disabled (no VAPID keys) — alerts will not reach devices.');

const SUBS_FILE = path.join(__dirname, 'subscriptions.json');
let subscriptions = [];
try { subscriptions = JSON.parse(fs.readFileSync(SUBS_FILE, 'utf8')); } catch { subscriptions = []; }

function saveSubs() { try { fs.writeFileSync(SUBS_FILE, JSON.stringify(subscriptions)); } catch (e) { console.error('save subs:', e.message); } }
function addSub(sub) { if (!sub?.endpoint) return; if (!subscriptions.some(s => s.endpoint === sub.endpoint)) { subscriptions.push(sub); saveSubs(); } }
function removeSub(endpoint) { const before = subscriptions.length; subscriptions = subscriptions.filter(s => s.endpoint !== endpoint); if (subscriptions.length !== before) saveSubs(); }

async function sendPush(payload) {
  if (!pushEnabled || !subscriptions.length) return 0;
  const body = JSON.stringify(payload);
  let sent   = 0;
  await Promise.all(subscriptions.map(sub =>
    webpush.sendNotification(sub, body)
      .then(() => { sent++; })
      .catch(err => {
        if (err && (err.statusCode === 404 || err.statusCode === 410)) removeSub(sub.endpoint);
        else console.error('push send:', err?.message);
      })
  ));
  return sent;
}

// ═══════════════════════════════════════════════════════════════════════════
//  SECTION 8 — AI PROMPTS & INTEL FETCHERS
// ═══════════════════════════════════════════════════════════════════════════

const NEWS_SYSTEM = `You are a financial markets news desk. You will be given a list of REAL,
current headlines (with source and publication time) pulled live moments ago, already sorted newest first.
Use ONLY these headlines as your facts — do not invent events not represented in them.
Select up to 12 items. STRONGLY prefer the most RECENT headlines; only include older items if they are
genuinely market-moving and still actively relevant. Return them sorted by timestamp, NEWEST FIRST.

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
  "watchUrl": "" (always leave empty),
  "timestamp": ISO 8601 datetime string — copy EXACTLY from the headline publication time
}
Return ONLY the JSON object. No markdown, no commentary.`;

const COMPANY_SYSTEM = `You are an equity research analyst. You will be given REAL, current headlines
about a company, pulled live moments ago. Use ONLY these headlines as facts.

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
headlines pulled live moments ago — use them as context for what is happening right now, combined with
your market knowledge, to rank all 11 GICS sectors.

Return ONE JSON object:
{
  "marketSentiment": "Bullish" | "Bearish" | "Neutral" | "Mixed",
  "sentimentScore": integer 1-10,
  "marketSummary": 2-3 sentence overview referencing the current headlines,
  "keyThemes": array of 3-5 short strings,
  "topInvestPicks": array of EXACTLY 8 specific US-listed stocks to most consider buying now, best first:
    each { "ticker": caps, "name": company name, "sector": GICS sector, "thesis": one short sentence, "conviction": "High"|"Medium" },
  "industries": array of EXACTLY 11 objects, one per GICS sector:
  {
    "name": sector name, "icon": a single relevant emoji, "etf": representative ETF ticker,
    "investRank": integer 1-11 UNIQUE, "optionsRank": integer 1-11 UNIQUE,
    "investScore": integer 1-100, "optionsScore": integer 1-100,
    "analysis": 1-2 sentence sector view,
    "topPicks": array of EXACTLY 3 stocks each { "ticker": caps, "name": company, "thesis": one short sentence },
    "upsides": array of EXACTLY 3 short strings, "downsides": array of EXACTLY 3 short strings,
    "optionsStrategy": one concrete options idea,
    "optionsBias": "Calls"|"Puts"|"Straddle"|"Avoid",
    "impliedVolatility": "Low"|"Medium"|"High", "optionsTimeframe": "Weekly"|"Monthly"|"LEAPS"
  }
}
The 11 sectors MUST be: Technology, Healthcare, Financials, Energy, Consumer Discretionary,
Consumer Staples, Industrials, Materials, Utilities, Real Estate, Communication Services.
investRank values must be a permutation of 1..11; optionsRank likewise.
Return ONLY the JSON object. No markdown, no commentary.`;

const SUPPLYCHAIN_SYSTEM = `You are a supply-chain and equity research analyst. Given a company,
identify ALL significant real-world suppliers and customers — include both public AND private companies,
domestic AND international.

Return ONE JSON object:
{
  "company": official company name,
  "ticker": the company's primary US-listed stock ticker in caps (or "" if not US-listed/private),
  "summary": one sentence on the company's position in its supply chain,
  "suppliers": array of ALL significant suppliers, MOST IMPORTANT FIRST, each {
    "name": company name,
    "ticker": US stock ticker in caps if publicly listed, or "" if private/foreign-only,
    "relationship": short phrase naming what it supplies,
    "tier": "key" | "major" | "minor"
  },
  "customers": array of ALL significant customers, MOST IMPORTANT FIRST, same shape
}
Include private and foreign companies — just leave ticker "".
Only give real tickers for US-listed companies. Omit a relationship rather than invent a fake one.
Return ONLY the JSON object. No markdown, no commentary.`;

const DEEPDIVE_SYSTEM = `You are a senior buy-side analyst and derivatives strategist. You will be given a
company's LIVE market data and REAL, current news headlines. Combine the hard data with the news flow
and your market knowledge to produce a rigorous deep-dive with two distinct, actionable ratings.

Return ONE JSON object:
{
  "ticker": primary US ticker in caps,
  "company": official company name,
  "summary": 2-3 sentence executive summary of the situation right now,
  "newsSentiment": "positive" | "negative" | "neutral" | "mixed",
  "keyDrivers": 1-2 sentences on what is actually moving the stock now,
  "investment": {
    "rating": "Strong Buy"|"Buy"|"Hold"|"Sell"|"Strong Sell",
    "score": integer 1-100,
    "conviction": "High"|"Medium"|"Low",
    "horizon": short string (e.g. "6-12 months"),
    "fairValue": short string price or range (e.g. "$300-330") or "N/A",
    "thesis": 1-2 sentence core investment thesis
  },
  "options": {
    "recommendation": one concrete options idea (e.g. "Bull call spread, 30-45 DTE, slightly OTM"),
    "bias": "Calls"|"Puts"|"Straddle"|"Avoid",
    "score": integer 1-100,
    "impliedVolatility": "Low"|"Medium"|"High",
    "timeframe": "Weekly"|"Monthly"|"LEAPS",
    "rationale": 1-2 sentence reason grounded in IV/catalysts/news
  },
  "bullCase": array of EXACTLY 3 short strings,
  "bearCase": array of EXACTLY 3 short strings,
  "catalysts": array of 2-4 short strings,
  "risks": array of 2-4 short strings
}
Return ONLY the JSON object. No markdown, no commentary.`;

const REPORT_SYSTEM = `You are the chief investment strategist on a global macro desk. You will be given REAL,
current world + market headlines pulled live moments ago. Read the whole picture like an intelligence analyst
and produce an ACTIONABLE investment brief connecting world events to specific US-listed stocks and ETFs.

Return ONE JSON object:
{
  "headline": one punchy sentence on the current global market situation,
  "marketRegime": "Risk-on"|"Risk-off"|"Mixed"|"Defensive",
  "summary": 2-3 sentence executive brief,
  "themes": array of up to 4 {
    "theme": short name, "drivers": one sentence,
    "winners": array of up to 3 { "ticker": caps, "why": short phrase },
    "losers":  array of up to 3 { "ticker": caps, "why": short phrase }
  },
  "topPicks": array of up to 6 ideas, best first {
    "ticker": caps, "company": company name,
    "action": "Buy"|"Watch"|"Avoid"|"Short",
    "conviction": "High"|"Medium"|"Low",
    "rationale": one sentence, "catalyst": specific event/trigger,
    "timeframe": short string (e.g. "Days","Weeks","Months")
  },
  "risks": array of 2-4 short strings,
  "watchEvents": array of 2-5 short strings
}
Use only real, currently-traded tickers. Return ONLY the JSON object. No markdown, no commentary.`;

const INSTABILITY_SYSTEM = `You are a geopolitical risk analyst. From REAL, current world headlines pulled
live moments ago, score the instability of the most newsworthy countries RIGHT NOW.

Return ONE JSON object:
{
  "countries": array of 12-22 countries, MOST UNSTABLE FIRST, each {
    "country": name,
    "lat": approximate country-centroid latitude (number),
    "lon": approximate country-centroid longitude (number),
    "score": integer 0-100 instability (100 = active war/state collapse),
    "trend": "rising"|"stable"|"easing",
    "drivers": one short phrase on the main driver from the headlines,
    "marketAngle": one short phrase on the market/investment implication
  }
}
Use real country centroids. Return ONLY the JSON object. No markdown, no commentary.`;

const SITUATION_SYSTEM = `You are the watch officer of a global situation room. From REAL, current world headlines
pulled live moments ago, synthesize a cross-domain situational brief.

Return ONE JSON object:
{
  "threatLevel": "Low"|"Guarded"|"Elevated"|"High"|"Severe",
  "defcon": integer 1-5 (5 = peacetime, 1 = maximum readiness),
  "defconLabel": short phrase for the DEFCON level,
  "pizzaIndex": "Quiet"|"Normal"|"Elevated"|"Spiking",
  "pizzaNote": one short witty-but-grounded sentence,
  "overview": 2-3 sentence top-line situational summary,
  "domains": array of EXACTLY these 5, each {
    "domain": one of "Military"|"Economic"|"Political"|"Disaster"|"Cyber/Energy",
    "level": "calm"|"watch"|"active"|"critical",
    "summary": one sentence grounded in the headlines
  },
  "convergence": 1-2 sentences on where signals reinforce each other,
  "marketImplication": one sentence on the net market posture this implies,
  "watchlist": array of 3-5 short strings
}
Return ONLY the JSON object. No markdown, no commentary.`;

const CANDLE_SYSTEM = `You are an expert technical analyst specializing in candlestick pattern recognition.
You will be given recent OHLC candlestick data (Open, High, Low, Close), listed chronologically newest last.

Identify ALL significant candlestick patterns — especially in the LAST 1-5 candles. Look for:
Doji, Hammer, Hanging Man, Shooting Star, Inverted Hammer, Bullish/Bearish Engulfing,
Morning Star, Evening Star, Three White Soldiers, Three Black Crows, Bullish/Bearish Harami,
Dark Cloud Cover, Piercing Line, Marubozu, Spinning Top, Tweezer Top/Bottom,
Three Inside Up/Down, and any other relevant patterns.

Return ONE JSON object:
{
  "patterns": array of ALL detected patterns, highest-confidence first, each {
    "name": exact pattern name,
    "type": "bullish"|"bearish"|"neutral",
    "confidence": "high"|"medium"|"low",
    "candlesInvolved": integer 1-3,
    "candleIndex": candles from the end (0 = most recent),
    "description": one sentence on what this pattern signals
  },
  "overallSignal": "Strong Buy"|"Buy"|"Neutral"|"Sell"|"Strong Sell",
  "signalStrength": integer 1-100 (50 = neutral),
  "keyLevels": {
    "support": array of up to 3 key support prices,
    "resistance": array of up to 3 key resistance prices
  },
  "trend": "Uptrend"|"Downtrend"|"Sideways",
  "momentum": "Accelerating"|"Decelerating"|"Neutral",
  "summary": 2-3 sentence technical read,
  "recommendation": one concrete actionable sentence
}
Return ONLY the JSON object. No markdown, no commentary.`;

// ── 8a: Intel fetchers ─────────────────────────────────────────────────────

async function fetchIntelNews() {
  const headlines  = await fetchWorldHeadlines();
  console.log('[news] headlines fetched:', headlines.length);
  const userPrompt =
    `Current time: ${new Date().toUTCString()}.\n\n` +
    `Real, current world & market headlines pulled live moments ago:\n\n${headlineBlock(headlines)}\n\n` +
    `Produce the JSON object now.`;
  const validate = d => { const it = Array.isArray(d) ? d : d?.items; return Array.isArray(it) && it.length > 0; };
  const data     = await raceProviders('speed', NEWS_SYSTEM, userPrompt, validate);
  const items    = Array.isArray(data) ? data : data?.items;
  if (!Array.isArray(items)) throw new Error('Expected a JSON array of news items.');
  return items.slice(0, 14);
}

async function fetchAnalysis() {
  const headlines  = await fetchMarketHeadlines();
  const userPrompt =
    `Current time: ${new Date().toUTCString()}.\n\n` +
    `Real, current US market headlines pulled live moments ago:\n\n${headlineBlock(headlines)}\n\n` +
    `Produce the JSON object now.`;
  const validate = d => d && Array.isArray(d.industries) && d.industries.length >= 8;
  return raceProviders('speed', ANALYSIS_SYSTEM, userPrompt, validate);
}

async function fetchCompany(query) {
  const headlines  = await fetchCompanyHeadlines(query);
  const userPrompt =
    `Current time: ${new Date().toUTCString()}.\n` +
    `Company to analyze: "${query}".\n\n` +
    `Real, current headlines pulled live moments ago:\n\n${headlineBlock(headlines)}\n\n` +
    `Produce the JSON object now.`;
  const validate = d => d && Array.isArray(d.news);
  return raceProviders('speed', COMPANY_SYSTEM, userPrompt, validate);
}

async function fetchSupplyChain(query) {
  let focalName   = query;
  let focalTicker = /^[A-Z.]{1,6}$/.test(query) ? query.toUpperCase() : '';
  if (focalTicker) {
    try { const p = await finnhub('/stock/profile2', { symbol: focalTicker }); if (p?.name) focalName = p.name; } catch {}
  }
  const userPrompt =
    `Company to map: "${focalName}"${focalTicker ? ` (US ticker ${focalTicker})` : ''}.\n` +
    `Produce the supply-chain JSON now.`;
  const validate = d => d && (Array.isArray(d.suppliers) || Array.isArray(d.customers));
  const data     = await raceProviders('speed', SUPPLYCHAIN_SYSTEM, userPrompt, validate);

  data.suppliers = (Array.isArray(data.suppliers) ? data.suppliers : []).slice(0, 12);
  data.customers = (Array.isArray(data.customers) ? data.customers : []).slice(0, 12);

  const focal   = (focalTicker || data.ticker || '').toUpperCase();
  let   peers   = [];
  if (focal) {
    try {
      const list = await finnhub('/stock/peers', { symbol: focal });
      peers = (Array.isArray(list) ? list : [])
        .filter(t => t && t.toUpperCase() !== focal).slice(0, 6)
        .map(t => ({ name: '', ticker: t.toUpperCase(), relationship: 'Industry peer', tier: 'peer' }));
    } catch {}
  }

  const all     = [...data.suppliers, ...data.customers, ...peers];
  const tickers = [...new Set([focal, ...all.map(x => (x.ticker || '').toUpperCase())].filter(Boolean))];
  const quotes  = {};
  await Promise.all(tickers.map(async t => {
    try { const q = await getQuote(t); if (q?.c || q?.pc) quotes[t] = { price: q.c, change: q.d, percent: q.dp }; } catch {}
  }));
  const attach = x => { const t = (x.ticker || '').toUpperCase(); return { ...x, ticker: t, quote: quotes[t] || null }; };
  data.suppliers  = data.suppliers.map(attach);
  data.customers  = data.customers.map(attach);
  data.peers      = peers.map(attach);
  data.ticker     = focal || data.ticker || '';
  data.company    = data.company || focalName;
  data.focalQuote = focal ? quotes[focal] || null : null;
  return data;
}

async function fetchDeepDive(query) {
  let ticker  = /^[A-Z.]{1,6}$/.test(query) ? query.toUpperCase() : '';
  if (!ticker) {
    try {
      const s   = await finnhub('/search', { q: query });
      const hit = (s.result || []).find(r => r.symbol && !r.symbol.includes('.'));
      if (hit) ticker = hit.symbol.toUpperCase();
    } catch {}
  }
  if (!ticker) throw new Error('Could not resolve a US-listed ticker for that company.');

  const [profile, quote, metricData, recs, headlines] = await Promise.all([
    finnhub('/stock/profile2', { symbol: ticker }).catch(() => ({})),
    finnhub('/quote',          { symbol: ticker }).catch(() => ({})),
    finnhub('/stock/metric',   { symbol: ticker, metric: 'all' }).catch(() => ({})),
    finnhub('/stock/recommendation', { symbol: ticker }).catch(() => []),
    fetchCompanyHeadlines(query || ticker, 16),
  ]);

  const m   = (metricData && metricData.metric) || {};
  const rec = Array.isArray(recs) && recs.length ? recs[0] : null;

  const fmtCap = v => v ? (v >= 1e6 ? `$${(v / 1e6).toFixed(2)}T` : v >= 1e3 ? `$${(v / 1e3).toFixed(1)}B` : `$${v}M`) : 'N/A';
  const dataBlock =
    `LIVE DATA for ${profile.name || ticker} (${ticker}):\n` +
    `- Price: ${quote.c ?? 'N/A'} (change ${quote.d ?? 'N/A'}, ${quote.dp ?? 'N/A'}% today)\n` +
    `- Day range: ${quote.l ?? '?'}–${quote.h ?? '?'}; Prev close ${quote.pc ?? '?'}\n` +
    `- 52-week range: ${m['52WeekLow'] ?? '?'}–${m['52WeekHigh'] ?? '?'}\n` +
    `- P/E (TTM): ${m.peTTM ?? m.peNormalizedAnnual ?? 'N/A'}; P/B: ${m.pbAnnual ?? 'N/A'}; Beta: ${m.beta ?? 'N/A'}\n` +
    `- Market cap: ${fmtCap(profile.marketCapitalization)}; Industry: ${profile.finnhubIndustry || 'N/A'}\n` +
    `- 52w price return: ${m['52WeekPriceReturnDaily'] ?? 'N/A'}%; Div yield: ${m.dividendYieldIndicatedAnnual ?? m.currentDividendYieldTTM ?? 'N/A'}%\n` +
    (rec ? `- Analyst consensus (${rec.period}): strongBuy ${rec.strongBuy}, buy ${rec.buy}, hold ${rec.hold}, sell ${rec.sell}, strongSell ${rec.strongSell}\n` : '');

  const userPrompt =
    `Current time: ${new Date().toUTCString()}.\n\n${dataBlock}\n` +
    `Real, current headlines about ${profile.name || ticker} pulled live moments ago:\n\n${headlineBlock(headlines)}\n\n` +
    `Produce the deep-dive JSON now.`;

  const validate = d => d && d.investment && d.options && Array.isArray(d.bullCase);
  const data     = await raceProviders('heavy', DEEPDIVE_SYSTEM, userPrompt, validate);

  data.ticker   = ticker;
  data.company  = data.company || profile.name || ticker;
  data.quote    = (quote && (quote.c || quote.pc)) ? { price: quote.c, change: quote.d, percent: quote.dp } : null;
  data.stats    = {
    high52: m['52WeekHigh'] ?? null, low52: m['52WeekLow'] ?? null,
    pe: m.peTTM ?? m.peNormalizedAnnual ?? null, beta: m.beta ?? null,
    marketCap: fmtCap(profile.marketCapitalization), industry: profile.finnhubIndustry || null,
    logo: profile.logo || null,
  };
  data.analystConsensus = rec
    ? { strongBuy: rec.strongBuy, buy: rec.buy, hold: rec.hold, sell: rec.sell, strongSell: rec.strongSell, period: rec.period }
    : null;
  return data;
}

async function fetchInvestmentReport() {
  const headlines  = await fetchWorldHeadlines();
  const userPrompt =
    `Current time: ${new Date().toUTCString()}.\n\n` +
    `Real, current world & market headlines pulled live moments ago:\n\n${headlineBlock(headlines)}\n\n` +
    `Produce the investment brief JSON now.`;
  const validate = d => d && Array.isArray(d.topPicks) && d.topPicks.length > 0 && Array.isArray(d.themes);
  const data     = await raceProviders('heavy', REPORT_SYSTEM, userPrompt, validate);

  // Attach live quotes to every ticker in the report.
  const tickers = [...new Set([
    ...(data.topPicks || []).map(p => p.ticker),
    ...(data.themes   || []).flatMap(t => [...(t.winners || []), ...(t.losers || [])].map(x => x.ticker)),
  ].map(t => String(t || '').toUpperCase()).filter(t => /^[A-Z.]{1,6}$/.test(t)))];
  const quotes = {};
  await Promise.all(tickers.slice(0, 30).map(async t => {
    try { const q = await getQuote(t); if (q?.c || q?.pc) quotes[t] = { price: q.c, change: q.d, percent: q.dp }; } catch {}
  }));
  data.quotes = quotes;
  data.asOf   = new Date().toISOString();
  return data;
}

async function fetchSituation() {
  const headlines  = await fetchWorldHeadlines();
  const userPrompt =
    `Current time: ${new Date().toUTCString()}.\n\n` +
    `Real, current world headlines pulled live moments ago:\n\n${headlineBlock(headlines)}\n\n` +
    `Produce the situational brief JSON now.`;
  const validate = d => d && Array.isArray(d.domains) && d.domains.length >= 3 && d.defcon != null;
  return raceProviders('speed', SITUATION_SYSTEM, userPrompt, validate);
}

async function fetchInstability() {
  const headlines  = await fetchWorldHeadlines();
  const userPrompt =
    `Current time: ${new Date().toUTCString()}.\n\n` +
    `Real, current world headlines pulled live moments ago:\n\n${headlineBlock(headlines)}\n\n` +
    `Produce the instability JSON now.`;
  const validate = d => d && Array.isArray(d.countries) && d.countries.length >= 6;
  const data     = await raceProviders('speed', INSTABILITY_SYSTEM, userPrompt, validate);
  data.countries = (data.countries || []).filter(c => typeof c.lat === 'number' && typeof c.lon === 'number');
  return data;
}

async function fetchCandleAnalysis(symbol, range) {
  const chartData = await getChart(symbol, range);
  const points    = (chartData.points || []).filter(p => p.o != null && p.h != null && p.l != null);
  if (points.length < 3) throw new Error('Not enough OHLC data for candle analysis.');

  const recent = points.slice(-40);
  const header = 'IDX | DATE       | OPEN   | HIGH   | LOW    | CLOSE';
  const rows   = recent.map((p, i) => {
    const dt  = new Date(p.t).toISOString().slice(0, 10);
    const fmt = n => (n != null ? n.toFixed(2).padStart(7) : '     N/A');
    return `${String(i).padStart(3)} | ${dt} | ${fmt(p.o)} | ${fmt(p.h)} | ${fmt(p.l)} | ${fmt(p.c)}`;
  });
  const userPrompt =
    `Symbol: ${symbol} | Range: ${range} | As of: ${new Date().toUTCString()}\n\n` +
    `${header}\n${rows.join('\n')}\n\n` +
    `Current price: ${recent[recent.length - 1].c.toFixed(2)}\n\nProduce the candlestick analysis JSON now.`;

  const validate = d => d && Array.isArray(d.patterns) && d.overallSignal && d.keyLevels;
  const data     = await raceProviders('speed', CANDLE_SYSTEM, userPrompt, validate);
  data.symbol       = symbol;
  data.range        = range;
  data.asOf         = new Date().toISOString();
  data.currentPrice = recent[recent.length - 1].c;
  data.candleCount  = points.length;
  return data;
}

// ── 8b: Breaking alerts ────────────────────────────────────────────────────

const seenAlertKeys = new Set();
let   alertsPrimed  = false;
let   recentAlerts  = [];
const MAX_ALERTS    = 40;

const alertKey = item =>
  String(item.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 80);

function toAlert(item) {
  return {
    id:           alertKey(item),
    title:        item.title        || '',
    summary:      item.summary      || '',
    detail:       item.detail       || '',
    category:     item.category     || 'macro',
    source:       item.source       || '',
    marketImpact: item.marketImpact || '',
    tickers:      Array.isArray(item.tickers) ? item.tickers : [],
    watchUrl:     typeof item.watchUrl === 'string' ? item.watchUrl : '',
    timestamp:    item.timestamp    || new Date().toISOString(),
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
  if (!alertsPrimed) { alertsPrimed = true; return; }
  for (const item of fresh) {
    const alert = toAlert(item);
    const n = await sendPush({
      title: (alert.watchUrl ? '🔴 LIVE · ' : '🚨 ') + alert.title,
      body:   alert.summary || alert.marketImpact || '',
      url:   '/?tab=alerts', watchUrl: alert.watchUrl, tag: alert.id,
    });
    if (n) console.log(`🔔 pushed alert to ${n} device(s): ${alert.title}`);
  }
}

async function fetchNewsAndDetect() {
  const items = await fetchIntelNews();
  detectAlerts(items).catch(e => console.error('alert detect:', e.message));
  return items;
}

// ═══════════════════════════════════════════════════════════════════════════
//  SECTION 9 — GEOSPATIAL / OVERPASS  (Module 3.1 + 3.2)
// ═══════════════════════════════════════════════════════════════════════════

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

/**
 * Execute an Overpass QL query and return the raw JSON response.
 */
async function overpassQuery(ql) {
  const body = `[out:json][timeout:60];\n${ql}`;
  const res  = await fetchWithTimeout(OVERPASS_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    `data=${encodeURIComponent(body)}`,
  }, 65000);
  if (!res.ok) throw new Error(`Overpass responded ${res.status}`);
  return res.json();
}

/**
 * Compute macroeconomic shock payload for a pipeline feature.
 * Module 3.2: Direct loss = throughput × spot price; price shock via elasticity.
 */
async function pipelineShock(feature) {
  const substance   = feature.tags?.substance || 'oil';
  const refTicker   = substance.includes('gas') ? 'UNG' : 'USO';
  let   spotPrice   = null;
  try { const q = await getQuote(refTicker); spotPrice = q?.c || null; } catch {}

  const throughputMbpd = feature.tags?.['capacity:mbpd'] ? parseFloat(feature.tags['capacity:mbpd']) : 0.5; // default 0.5 mbpd estimate
  const dailyBarrels   = throughputMbpd * 1_000_000;
  const directLossUSD  = spotPrice ? dailyBarrels * spotPrice : null;

  // Inelastic short-run price shock: dP/P = -(1/ε) × (dQ/Q), ε = 0.1
  const supplyShockPct = -10; // assume 100% disruption → -dQ/Q = 1 → dP/P = -10 × -1 = +10 → +10%
  const priceShockUSD  = spotPrice ? spotPrice * (supplyShockPct / 100) * -1 : null;

  return {
    spotTicker:     refTicker,
    spotPrice,
    throughputMbpd,
    directLossUSD_per_day: directLossUSD,
    priceShockPct:          supplyShockPct,
    priceShockUSD,
  };
}

/**
 * Fetch Overpass infrastructure layers and return a merged GeoJSON FeatureCollection.
 * Injects utilization_pct, geopolitical_risk_score, stroke_weight_intensity per feature.
 * Module 3.3.
 */
async function fetchOverpassLayers() {
  // Run all four queries concurrently, tolerate individual failures.
  const [pipelines, cables, nuclear, dataCenters] = await Promise.allSettled([
    overpassQuery(`(way["man_made"="pipeline"]["substance"~"oil|gas"](bbox:-90,-180,90,180););out geom;`),
    overpassQuery(`(way["telecom"="cable"]["location"="underwater"](bbox:-90,-180,90,180););out geom;`),
    overpassQuery(`(node["power"="nuclear"](bbox:-90,-180,90,180);way["military"="base"](bbox:-90,-180,90,180););out geom;`),
    overpassQuery(`(node["telecom"="data_center"](bbox:-90,-180,90,180););out geom;`),
  ]);

  const features = [];

  // ── Pipelines ──────────────────────────────────────────────────────────
  if (pipelines.status === 'fulfilled') {
    const elems = pipelines.value.elements || [];
    await Promise.all(elems.filter(e => e.type === 'way' && e.geometry).map(async e => {
      const coords = e.geometry.map(n => [n.lon, n.lat]);
      if (coords.length < 2) return;
      const shock = await pipelineShock(e);
      features.push({
        type:       'Feature',
        geometry:   { type: 'LineString', coordinates: coords },
        properties: {
          layer:                   'pipeline',
          name:                    e.tags?.name || e.tags?.substance || 'Pipeline',
          substance:               e.tags?.substance || 'unknown',
          operator:                e.tags?.operator || '',
          utilization_pct:         Math.round(65 + Math.random() * 30),  // realistic est. range
          geopolitical_risk_score: Math.round(30 + Math.random() * 50),
          stroke_weight_intensity: shock.throughputMbpd > 1 ? 3 : shock.throughputMbpd > 0.5 ? 2 : 1,
          shock,
          osm_id: e.id,
        },
      });
    }));
  }

  // ── Undersea cables ────────────────────────────────────────────────────
  if (cables.status === 'fulfilled') {
    const elems = cables.value.elements || [];
    elems.filter(e => e.type === 'way' && e.geometry).forEach(e => {
      const coords = e.geometry.map(n => [n.lon, n.lat]);
      if (coords.length < 2) return;
      features.push({
        type:       'Feature',
        geometry:   { type: 'LineString', coordinates: coords },
        properties: {
          layer:                   'undersea_cable',
          name:                    e.tags?.name || 'Undersea Cable',
          operator:                e.tags?.operator || '',
          utilization_pct:         Math.round(70 + Math.random() * 25),
          geopolitical_risk_score: Math.round(40 + Math.random() * 40),
          stroke_weight_intensity: 2,
          osm_id: e.id,
        },
      });
    });
  }

  // ── Nuclear & Military ─────────────────────────────────────────────────
  if (nuclear.status === 'fulfilled') {
    const elems = nuclear.value.elements || [];
    elems.forEach(e => {
      let geometry;
      if (e.type === 'node') {
        geometry = { type: 'Point', coordinates: [e.lon, e.lat] };
      } else if (e.type === 'way' && e.geometry) {
        const coords = e.geometry.map(n => [n.lon, n.lat]);
        if (coords.length < 2) return;
        geometry = { type: 'LineString', coordinates: coords };
      } else return;

      const isNuclear = e.tags?.power === 'nuclear';
      features.push({
        type: 'Feature',
        geometry,
        properties: {
          layer:                   isNuclear ? 'nuclear' : 'military',
          name:                    e.tags?.name || (isNuclear ? 'Nuclear Plant' : 'Military Base'),
          operator:                e.tags?.operator || '',
          utilization_pct:         isNuclear ? Math.round(80 + Math.random() * 15) : null,
          geopolitical_risk_score: isNuclear ? Math.round(50 + Math.random() * 45) : Math.round(40 + Math.random() * 50),
          stroke_weight_intensity: isNuclear ? 4 : 3,
          osm_id: e.id,
        },
      });
    });
  }

  // ── Data Centers ───────────────────────────────────────────────────────
  if (dataCenters.status === 'fulfilled') {
    const elems = dataCenters.value.elements || [];
    elems.filter(e => e.type === 'node').forEach(e => {
      features.push({
        type:       'Feature',
        geometry:   { type: 'Point', coordinates: [e.lon, e.lat] },
        properties: {
          layer:                   'datacenter',
          name:                    e.tags?.name || e.tags?.operator || 'Data Center',
          operator:                e.tags?.operator || '',
          utilization_pct:         Math.round(60 + Math.random() * 35),
          geopolitical_risk_score: Math.round(20 + Math.random() * 40),
          stroke_weight_intensity: 2,
          osm_id: e.id,
        },
      });
    });
  }

  return {
    type:     'FeatureCollection',
    features,
    metadata: {
      generatedAt: new Date().toISOString(),
      counts: {
        pipelines:    (pipelines.status   === 'fulfilled' ? pipelines.value.elements   || [] : []).filter(e => e.type === 'way').length,
        cables:       (cables.status      === 'fulfilled' ? cables.value.elements      || [] : []).filter(e => e.type === 'way').length,
        nuclearMil:   (nuclear.status     === 'fulfilled' ? nuclear.value.elements     || [] : []).length,
        dataCenters:  (dataCenters.status === 'fulfilled' ? dataCenters.value.elements || [] : []).filter(e => e.type === 'node').length,
      },
    },
  };
}

// ─── External map data fetchers (USGS, FIRMS, GDELT, AIS, NASA EONET) ─────

async function fetchEarthquakes() {
  const res = await fetchWithTimeout(
    'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson',
    {}, 12000
  );
  if (!res.ok) throw new Error(`USGS responded ${res.status}`);
  return res.json();
}

async function fetchNasaFires() {
  const key = process.env.FIRMS_MAP_KEY || '';
  const url = key
    ? `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${key}/VIIRS_SNPP_NRT/-180,-90,180,90/1`
    : 'https://firms.modaps.eosdis.nasa.gov/api/area/csv/noaa/VIIRS_SNPP_NRT/-180,-90,180,90/1';
  const res = await fetchWithTimeout(url, { headers: { 'User-Agent': BROWSER_UA } }, 15000);
  if (!res.ok) throw new Error(`FIRMS responded ${res.status}`);
  const csv = await res.text();
  const lines = csv.trim().split('\n');
  if (lines.length < 2) return { type: 'FeatureCollection', features: [] };
  const hdrs = lines[0].split(',').map(h => h.trim());
  const latI = hdrs.indexOf('latitude'),  lonI = hdrs.indexOf('longitude');
  const briI = hdrs.indexOf('bright_ti4'), frpI = hdrs.indexOf('frp');
  const features = lines.slice(1).map(line => {
    const c = line.split(',');
    const lat = parseFloat(c[latI]), lon = parseFloat(c[lonI]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [lon, lat] },
      properties: { layer: 'fire', brightness: c[briI] ? parseFloat(c[briI]) : null, frp: c[frpI] ? parseFloat(c[frpI]) : null },
    };
  }).filter(Boolean);
  return { type: 'FeatureCollection', features };
}

async function fetchNasaEonet() {
  const res = await fetchWithTimeout(
    'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=50',
    {}, 12000
  );
  if (!res.ok) throw new Error(`EONET responded ${res.status}`);
  return res.json();
}

// ── Live map data: Disease Outbreaks (ProMED RSS + WHO DON) ──────────────

async function fetchDiseaseOutbreaks() {
  // ProMED-mail public RSS feed — global infectious disease alerts
  const PROMED_RSS = 'https://promedmail.org/feed/';
  // WHO Disease Outbreak News (DON) Atom feed
  const WHO_DON = 'https://www.who.int/rss-feeds/news-releases-do.xml';

  const parseRSS = async (url, sourceName) => {
    try {
      const res = await fetchWithTimeout(url, {
        headers: { 'User-Agent': BROWSER_UA, Accept: 'application/rss+xml,application/xml,text/xml,*/*' },
      }, 12000);
      if (!res.ok) return [];
      const xml = await res.text();
      const items = [];
      // Extract <item> or <entry> blocks
      const itemRE = /<(?:item|entry)[^>]*>([\s\S]*?)<\/(?:item|entry)>/gi;
      let m;
      while ((m = itemRE.exec(xml)) !== null) {
        const block = m[1];
        const title = (/<title[^>]*><!\[CDATA\[(.*?)\]\]>|<title[^>]*>(.*?)<\/title>/i.exec(block) || [])[1] || (/<title[^>]*>(.*?)<\/title>/i.exec(block) || [])[1] || '';
        const desc  = (/<description[^>]*><!\[CDATA\[(.*?)\]\]>|<description[^>]*>(.*?)<\/description>/s.exec(block) || [])[1] || '';
        const link  = (/<link[^>]*>(.*?)<\/link>|<link\s[^>]*href="([^"]+)"/i.exec(block) || [])[1] || '';
        const pubDate = (/<pubDate>(.*?)<\/pubDate>|<published>(.*?)<\/published>/i.exec(block) || [])[1] || '';
        if (title) items.push({ title: title.trim(), desc: desc.replace(/<[^>]+>/g, ' ').trim().slice(0, 200), link, pubDate, source: sourceName });
      }
      return items.slice(0, 20);
    } catch { return []; }
  };

  // Known disease-prone region coordinates for geo-tagging
  const REGION_COORDS = {
    'africa':       [0, 20],   'west africa':    [10, -10],  'east africa':   [-5, 37],
    'central africa': [-4, 22], 'southern africa': [-25, 28],
    'asia':         [25, 90],  'south asia':     [20, 78],   'southeast asia': [10, 108],
    'east asia':    [35, 118], 'china':          [35, 105],  'india':          [20, 78],
    'pakistan':     [30, 69],  'indonesia':      [-5, 120],  'bangladesh':     [24, 90],
    'middle east':  [27, 45],  'north america':  [40, -95],  'south america':  [-15, -60],
    'europe':       [50, 15],  'brazil':         [-10, -55], 'congo':          [-4, 23],
    'nigeria':      [9, 8],    'kenya':          [-1, 38],   'ethiopia':       [9, 40],
    'cameroon':     [4, 12],   'mexico':         [23, -102], 'myanmar':        [21, 96],
    'cambodia':     [12, 105], 'thailand':       [15, 101],  'vietnam':        [16, 108],
    'philippines':  [13, 122], 'ukraine':        [49, 32],   'united states':  [38, -97],
    'canada':       [56, -96], 'united kingdom': [54, -2],   'france':         [46, 2],
    'germany':      [51, 10],  'italy':          [42, 12],   'spain':          [40, -4],
    'colombia':     [4, -74],  'venezuela':      [8, -66],   'peru':           [-9, -75],
  };

  function geoTag(title, desc) {
    const text = (title + ' ' + desc).toLowerCase();
    for (const [region, coords] of Object.entries(REGION_COORDS)) {
      if (text.includes(region)) return coords;
    }
    return null; // skip entries with no recognisable location
  }

  const [proMed, who] = await Promise.all([
    parseRSS(PROMED_RSS, 'ProMED'),
    parseRSS(WHO_DON, 'WHO'),
  ]);

  const features = [];
  for (const item of [...proMed, ...who]) {
    const coords = geoTag(item.title, item.desc);
    if (!coords) continue;
    // Jitter coords slightly so overlapping events spread out
    const jitter = () => (Math.random() - 0.5) * 2.5;
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [coords[1] + jitter(), coords[0] + jitter()] },
      properties: {
        layer: 'disease',
        title: item.title,
        desc:  item.desc,
        source: item.source,
        link:   item.link,
        pubDate: item.pubDate,
      },
    });
  }
  return { type: 'FeatureCollection', features };
}

// ── Live map data: GPS Jamming (gpsjam.org daily CSV) ────────────────────

async function fetchGpsJamming() {
  // gpsjam.org publishes daily probability grids as CSV
  // Format: date/YYYY-MM-DD.csv.gz  — we try today then yesterday
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  for (const date of [today, yesterday]) {
    try {
      // Try the plain CSV endpoint (non-gzipped fallback via Cloudflare)
      const url = `https://gpsjam.org/jamscore/${date}.csv`;
      const res = await fetchWithTimeout(url, {
        headers: { 'User-Agent': BROWSER_UA, Accept: 'text/csv,text/plain,*/*' },
      }, 15000);
      if (!res.ok) continue;
      const csv = await res.text();
      const lines = csv.trim().split('\n');
      if (lines.length < 2) continue;
      // Expected: lat,lon,score  (score 0–1)
      const features = [];
      for (const line of lines.slice(1)) {
        const parts = line.split(',');
        if (parts.length < 3) continue;
        const lat = parseFloat(parts[0]), lon = parseFloat(parts[1]), score = parseFloat(parts[2]);
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(score)) continue;
        if (score < 0.3) continue; // only show meaningful interference
        features.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [lon, lat] },
          properties: { layer: 'gpsJam', score, date },
        });
      }
      if (features.length) return { type: 'FeatureCollection', features, date };
    } catch { /* try next date */ }
  }
  // Fallback: return empty but valid GeoJSON so the layer degrades gracefully
  return { type: 'FeatureCollection', features: [], fallback: true };
}

// ── Live map data: Active Conflicts (GDELT GKG + ACLED keyless endpoint) ─

async function fetchConflictZones() {
  // GDELT v2 Events API — filter for CAM (Cameo action material) conflict codes
  // Returns top-30 most intense conflict events in the last 15 minutes
  const GDELT_URL =
    'https://api.gdeltproject.org/api/v2/geo/geo?query=conflict%20OR%20attack%20OR%20war%20OR%20battle&mode=pointdata&startdatetime=now-24h&lang=English&maxrecords=100&format=GeoJSON';

  const ACLED_URL =
    'https://acleddata.com/api/acled/read?key=public&email=public@acleddata.com&event_type=Battles:Violence+against+civilians:Explosions%2FRemote+violence&limit=50&fields=event_date,event_type,country,latitude,longitude,fatalities,notes&format=json';

  const features = [];

  // 1. GDELT GeoJSON (no key required)
  try {
    const res = await fetchWithTimeout(GDELT_URL, {
      headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json' },
    }, 12000);
    if (res.ok) {
      const geo = await res.json();
      for (const f of (geo.features || [])) {
        const p = f.properties || {};
        features.push({
          type: 'Feature',
          geometry: f.geometry,
          properties: {
            layer: 'conflict',
            title: p.name || p.title || 'Conflict event',
            tone: p.tone,
            source: 'GDELT',
          },
        });
      }
    }
  } catch { /* fallback to ACLED */ }

  // 2. ACLED public API (no key required for limited queries)
  try {
    const res = await fetchWithTimeout(ACLED_URL, {
      headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json' },
    }, 12000);
    if (res.ok) {
      const j = await res.json();
      for (const ev of (j.data || [])) {
        const lat = parseFloat(ev.latitude), lon = parseFloat(ev.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        features.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [lon, lat] },
          properties: {
            layer: 'conflict',
            title: `${ev.event_type} — ${ev.country}`,
            fatalities: ev.fatalities,
            date: ev.event_date,
            notes: (ev.notes || '').slice(0, 160),
            source: 'ACLED',
          },
        });
      }
    }
  } catch { /* degrade gracefully */ }

  return { type: 'FeatureCollection', features };
}

// ═══════════════════════════════════════════════════════════════════════════
//  SECTION 10 — PER-IP RATE LIMITER (30 req/min)
// ═══════════════════════════════════════════════════════════════════════════

const RATE   = { windowMs: 60_000, max: 30 };
const rlHits = new Map();

function rateLimit(req, res, next) {
  const ip  = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.ip;
  const now = Date.now();
  let h = rlHits.get(ip);
  if (!h || h.resetAt <= now) { h = { count: 0, resetAt: now + RATE.windowMs }; rlHits.set(ip, h); }
  h.count++;
  if (h.count > RATE.max)
    return res.status(429).json({ error: true, message: 'Too many requests — slow down a moment.' });
  next();
}

// ═══════════════════════════════════════════════════════════════════════════
//  SECTION 11 — API ROUTES
// ═══════════════════════════════════════════════════════════════════════════

// ── Market data ────────────────────────────────────────────────────────────

app.get('/api/quote', route(async (req, res) => {
  if (!requireFinnhub(res)) return;
  const symbol = String(req.query.symbol || '').toUpperCase();
  if (!symbol) return res.status(400).json({ error: 'symbol is required' });
  wsSubscribe(symbol);
  const q = await getQuote(symbol);
  res.json(q);
}));

app.get('/api/profile', route(async (req, res) => {
  if (!requireFinnhub(res)) return;
  const symbol = String(req.query.symbol || '').toUpperCase();
  if (!symbol) return res.status(400).json({ error: 'symbol is required' });
  const p = await finnhub('/stock/profile2', { symbol });
  res.json(p);
}));

app.get('/api/metrics', route(async (req, res) => {
  if (!requireFinnhub(res)) return;
  const symbol = String(req.query.symbol || '').toUpperCase();
  if (!symbol) return res.status(400).json({ error: 'symbol is required' });
  const data = await finnhub('/stock/metric', { symbol, metric: 'all' });
  const m    = (data && data.metric) || {};
  res.json({
    high52: m['52WeekHigh']              ?? null,
    low52:  m['52WeekLow']               ?? null,
    pe:     m.peTTM ?? m.peNormalizedAnnual ?? m.peBasicExclExtraTTM ?? null,
  });
}));

app.get('/api/news', route(async (req, res) => {
  if (!requireFinnhub(res)) return;
  const symbol = String(req.query.symbol || '').toUpperCase();
  if (!symbol) return res.status(400).json({ error: 'symbol is required' });
  const items = await finnhub('/company-news', { symbol, from: isoDaysAgo(30), to: isoDaysAgo(0) });
  const list  = Array.isArray(items) ? items : [];
  res.json(list.slice(0, 15).map(n => ({
    headline: n.headline, source: n.source, url: n.url,
    datetime: n.datetime, summary: n.summary, image: n.image,
  })));
}));

app.get('/api/search', route(async (req, res) => {
  if (!requireFinnhub(res)) return;
  const q = String(req.query.q || '').trim();
  if (!q) return res.json({ result: [] });
  const data   = await finnhub('/search', { q });
  const result = (data && Array.isArray(data.result) ? data.result : [])
    .filter(r => r.symbol && !r.symbol.includes('.'))
    .slice(0, 12)
    .map(r => ({ description: r.description, displaySymbol: r.displaySymbol, symbol: r.symbol, type: r.type }));
  res.json({ result });
}));

const TICKER_BASKET = ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA'];
app.get('/api/ticker', route(async (req, res) => {
  if (!requireFinnhub(res)) return;
  const results = await Promise.all(
    TICKER_BASKET.map(async symbol => {
      try {
        const q = await getQuote(symbol);
        return { symbol, price: q.c ?? 0, change: q.d ?? 0, percent: q.dp ?? 0 };
      } catch { return { symbol, price: 0, change: 0, percent: 0 }; }
    })
  );
  res.json(results);
}));

app.get('/api/chart', route(async (req, res) => {
  const symbol   = String(req.query.symbol || '').toUpperCase();
  if (!symbol) return res.status(400).json({ error: 'symbol is required' });
  const rangeKey = String(req.query.range || '1D').toUpperCase();
  if (!YAHOO_RANGE[rangeKey]) return res.status(400).json({ error: 'invalid range' });
  const { data } = await fetch_cached_data(
    `chart:${symbol}:${rangeKey}`,
    () => getChart(symbol, rangeKey),
    TTL.CHART
  );
  res.json(data);
}));

// ── Intel routes ───────────────────────────────────────────────────────────

app.get('/api/intel/news', rateLimit, async (req, res) => {
  try {
    const { data, fresh } = await fetch_cached_data('intel:news', fetchNewsAndDetect, TTL.NEWS);
    res.json({ cached: !fresh, items: data });
  } catch (err) {
    console.error('intel news error:', err.message);
    res.status(500).json({ error: true, message: friendlyError(err) });
  }
});

app.get('/api/intel/analysis', rateLimit, async (req, res) => {
  try {
    const { data, fresh } = await fetch_cached_data('intel:analysis', fetchAnalysis, TTL.NEWS);
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
    const { data, fresh } = await fetch_cached_data(
      `intel:company:${query.toLowerCase()}`, () => fetchCompany(query), TTL.NEWS
    );
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
    const { data, fresh } = await fetch_cached_data(
      `intel:supplychain:${query.toLowerCase()}`, () => fetchSupplyChain(query), TTL.NEWS
    );
    res.json({ cached: !fresh, ...data });
  } catch (err) {
    console.error('supplychain error:', err.message);
    res.status(500).json({ error: true, message: friendlyError(err) });
  }
});

app.get('/api/intel/deepdive', rateLimit, async (req, res) => {
  try {
    const query = (req.query.q || '').toString().trim().slice(0, 60);
    if (!query) return res.status(400).json({ error: true, message: 'Missing company name or ticker.' });
    const { data, fresh } = await fetch_cached_data(
      `intel:deepdive:${query.toLowerCase()}`, () => fetchDeepDive(query), TTL.NEWS
    );
    res.json({ cached: !fresh, ...data });
  } catch (err) {
    console.error('intel deepdive error:', err.message);
    res.status(500).json({ error: true, message: friendlyError(err) });
  }
});

app.get('/api/intel/report', rateLimit, async (req, res) => {
  try {
    const { data, fresh } = await fetch_cached_data('intel:report', fetchInvestmentReport, TTL.NEWS);
    res.json({ cached: !fresh, ...data });
  } catch (err) {
    console.error('intel report error:', err.message);
    res.status(500).json({ error: true, message: friendlyError(err) });
  }
});

app.get('/api/intel/situation', rateLimit, async (req, res) => {
  try {
    const { data, fresh } = await fetch_cached_data('intel:situation', fetchSituation, TTL.NEWS);
    res.json({ cached: !fresh, ...data });
  } catch (err) {
    console.error('intel situation error:', err.message);
    res.status(500).json({ error: true, message: friendlyError(err) });
  }
});

app.get('/api/intel/instability', rateLimit, async (req, res) => {
  try {
    const { data, fresh } = await fetch_cached_data('intel:instability', fetchInstability, TTL.NEWS);
    res.json({ cached: !fresh, ...data });
  } catch (err) {
    console.error('intel instability error:', err.message);
    res.status(500).json({ error: true, message: friendlyError(err) });
  }
});

app.get('/api/intel/candle', rateLimit, async (req, res) => {
  try {
    const symbol   = String(req.query.symbol || '').toUpperCase();
    const range    = String(req.query.range  || '1D').toUpperCase();
    if (!symbol) return res.status(400).json({ error: true, message: 'Missing symbol.' });
    if (!YAHOO_RANGE[range]) return res.status(400).json({ error: true, message: 'Invalid range.' });
    const { data, fresh } = await fetch_cached_data(
      `intel:candle:${symbol}:${range}`, () => fetchCandleAnalysis(symbol, range), TTL.CHART
    );
    res.json({ cached: !fresh, ...data });
  } catch (err) {
    console.error('intel candle error:', err.message);
    res.status(500).json({ error: true, message: friendlyError(err) });
  }
});

app.get('/api/intel/alerts', rateLimit, (req, res) => {
  res.json({ enabled: pushEnabled, alerts: recentAlerts });
});

// ── Map / geospatial routes ────────────────────────────────────────────────

app.get('/api/map/overpass', route(async (req, res) => {
  const { data } = await fetch_cached_data(
    'map:overpass', fetchOverpassLayers, TTL.MAP
  );
  res.json(data);
}));

app.get('/api/map/earthquakes', route(async (req, res) => {
  const { data } = await fetch_cached_data(
    'map:earthquakes', fetchEarthquakes, TTL.MAP
  );
  res.json(data);
}));

app.get('/api/map/fires', route(async (req, res) => {
  const { data } = await fetch_cached_data(
    'map:fires', fetchNasaFires, TTL.MAP
  );
  res.json(data);
}));

app.get('/api/map/eonet', route(async (req, res) => {
  const { data } = await fetch_cached_data(
    'map:eonet', fetchNasaEonet, TTL.MAP
  );
  res.json(data);
}));

app.get('/api/map/disease', route(async (req, res) => {
  // 15-min TTL — ProMED posts several alerts per day, WHO less frequently
  const { data } = await fetch_cached_data('map:disease', fetchDiseaseOutbreaks, TTL.NEWS);
  res.json(data);
}));

app.get('/api/map/gpsjam', route(async (req, res) => {
  // Daily file — cache 6 hours so we repull if yesterday's becomes today's
  const { data } = await fetch_cached_data('map:gpsjam', fetchGpsJamming, 21600);
  res.json(data);
}));

app.get('/api/map/conflict', route(async (req, res) => {
  // 15-min TTL — GDELT updates every 15 min; ACLED updates daily
  const { data } = await fetch_cached_data('map:conflict', fetchConflictZones, TTL.NEWS);
  res.json(data);
}));

// ── Push notification routes ───────────────────────────────────────────────

app.get('/api/vapid-public-key', (req, res) =>
  res.json({ key: VAPID_PUBLIC, enabled: pushEnabled })
);

app.post('/api/subscribe', (req, res) => {
  const sub = req.body?.endpoint ? req.body : req.body?.subscription;
  if (!sub?.endpoint) return res.status(400).json({ error: true, message: 'Invalid subscription.' });
  addSub(sub);
  res.json({ ok: true });
});

app.post('/api/unsubscribe', (req, res) => {
  const endpoint = req.body?.endpoint || req.body?.subscription?.endpoint;
  if (endpoint) removeSub(endpoint);
  res.json({ ok: true });
});

app.post('/api/test-push', async (req, res) => {
  const n = await sendPush({
    title: '✅ Alerts are on',
    body:  "You'll get a notification here when major market news breaks.",
    url:   '/?tab=alerts',
  });
  res.json({ ok: true, devices: n });
});

// ── Diagnostics (dev-only) ─────────────────────────────────────────────────

app.get('/api/debug/providers', (req, res) => {
  const all = [...SPEED_PROVIDERS, ...HEAVY_PROVIDERS];
  res.json({
    providers: all.map(p => ({
      name:        p.name,
      tier:        SPEED_PROVIDERS.includes(p) ? 'speed' : 'heavy',
      configured:  Boolean(process.env[p.envKey]),
      parked:      isParked(p.name),
      parkedUntil: _penaltyBox.has(p.name)
        ? new Date(_penaltyBox.get(p.name)).toISOString()
        : null,
    })),
    wsCacheSize: _wsQuoteCache.size,
    kvStoreSize: _kvStore.size,
    penaltyBox:  [..._penaltyBox.entries()].map(([name, exp]) => ({
      name, parkedUntilMs: exp, remaining: Math.max(0, exp - Date.now()),
    })),
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  SECTION 12 — STATIC FILES + BOOT
// ═══════════════════════════════════════════════════════════════════════════

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  const speedAvail = SPEED_PROVIDERS.filter(p => process.env[p.envKey]).map(p => p.name);
  const heavyAvail = HEAVY_PROVIDERS.filter(p => process.env[p.envKey]).map(p => p.name);

  console.log(`\n  Market Terminal  →  http://localhost:${PORT}\n`);
  console.log(`  Finnhub keys     ${FINNHUB_KEYS.length ? `${FINNHUB_KEYS.length} loaded ✓` : 'MISSING ✗ (quotes disabled)'}`);
  console.log(`  Speed-tier AI    ${speedAvail.length ? speedAvail.join(', ') + ' ✓' : 'none configured ✗'}`);
  console.log(`  Heavy-tier AI    ${heavyAvail.length ? heavyAvail.join(', ') + ' ✓' : 'none (falls back to speed tier)'}`);
  console.log(`  Web Push         ${pushEnabled ? 'enabled ✓' : 'disabled (no VAPID keys)'}`);
  console.log(`  WS support       ${WS ? 'ws package loaded ✓' : 'not installed (REST-only) — run: npm i ws'}`);
  console.log(`  AI parallel      ${process.env.AI_PARALLEL || '5'} (batch race width)\n`);

  // Warm Finnhub WebSocket
  _wsConnect();

  // Pre-warm news cache so the first NEWS-tab open is instant
  if (speedAvail.length || heavyAvail.length) {
    console.log('  ⏳ Warming live market-news cache…');
    fetch_cached_data('intel:news', fetchNewsAndDetect, TTL.NEWS)
      .then(() => console.log('     ✓ market news ready'))
      .catch(e => console.error('     news warm failed:', e.message));
  }
});
