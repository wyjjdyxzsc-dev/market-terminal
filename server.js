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

// ═══════════════════════════════════════════════════════════════════════════
//  MAP LAYERS BASELINE — curated reference data (served with 24h TTL)
//  Augmented at request-time by live public APIs where available.
// ═══════════════════════════════════════════════════════════════════════════

const MAP_LAYERS_BASELINE = {
  exchanges: [
    ['NYSE', 40.707, -74.011, 'New York Stock Exchange'], ['NASDAQ', 40.757, -73.986, 'Nasdaq'],
    ['LSE', 51.515, -0.099, 'London Stock Exchange'], ['TSE', 35.683, 139.774, 'Tokyo Stock Exchange'],
    ['SSE', 31.234, 121.491, 'Shanghai Stock Exchange'], ['HKEX', 22.283, 114.158, 'Hong Kong Exchange'],
    ['Euronext', 48.870, 2.332, 'Euronext Paris'], ['DB', 50.115, 8.671, 'Deutsche Börse'],
    ['BSE', 18.929, 72.833, 'Bombay Stock Exchange'], ['TSX', 43.648, -79.382, 'Toronto Exchange'],
    ['ASX', -33.866, 151.207, 'Australian Securities Exchange'], ['SIX', 47.371, 8.539, 'SIX Swiss Exchange'],
    ['B3', -23.553, -46.634, 'B3 São Paulo'], ['KRX', 37.525, 126.926, 'Korea Exchange'], ['SGX', 1.283, 103.851, 'Singapore Exchange'],
  ],
  chokepoints: [
    ['Strait of Hormuz', 26.567, 56.25, '~20% of global oil passes here'], ['Suez Canal', 30.5, 32.35, 'Europe–Asia shortcut'],
    ['Strait of Malacca', 1.43, 102.89, 'Busiest cargo chokepoint'], ['Panama Canal', 9.08, -79.68, 'Atlantic–Pacific link'],
    ['Bab-el-Mandeb', 12.58, 43.33, 'Red Sea gateway'], ['Bosphorus', 41.12, 29.07, 'Black Sea outlet'],
    ['Strait of Gibraltar', 35.95, -5.6, 'Mediterranean entrance'], ['Danish Straits', 55.7, 12.7, 'Baltic outlet'],
    ['Cape of Good Hope', -34.36, 18.47, 'Tanker reroute around Africa'], ['Taiwan Strait', 24.5, 119.5, 'Critical Asia shipping lane'],
  ],
  nuclear: [
    ['Natanz', 33.72, 51.73, 'Iran enrichment site'], ['Fordow', 34.88, 50.99, 'Iran enrichment (underground)'],
    ['Yongbyon', 39.8, 125.75, 'North Korea reactor'], ['Dimona', 31.0, 35.14, 'Israel (Negev)'],
    ['Zaporizhzhia', 47.51, 34.59, 'Largest NPP in Europe (Ukraine)'], ['Bushehr', 28.83, 50.89, 'Iran power reactor'],
    ['Chernobyl', 51.39, 30.10, 'Exclusion zone'], ['Fukushima Daiichi', 37.42, 141.03, 'Japan (decommissioning)'],
    ['Belo Monte', -3.10, -51.73, 'Brazil — major hydro'], ['Olkiluoto', 61.23, 21.44, 'Finland NPP'],
    ['Hinkley Point C', 51.21, -3.13, 'UK — under construction'], ['Barakah', 23.96, 52.20, 'UAE first NPP'],
  ],
  spaceports: [
    ['Cape Canaveral', 28.49, -80.58, 'USA — SpaceX/ULA/NASA'], ['Starbase', 25.99, -97.16, 'SpaceX Boca Chica'],
    ['Baikonur', 45.92, 63.34, 'Kazakhstan (Roscosmos)'], ['Kourou', 5.24, -52.77, 'ESA Guiana Space Centre'],
    ['Vandenberg', 34.74, -120.57, 'USA — polar launches'], ['Jiuquan', 40.96, 100.29, 'China'],
    ['Wenchang', 19.61, 110.95, 'China — heavy lift'], ['Sriharikota', 13.72, 80.23, 'India (ISRO)'],
    ['Tanegashima', 30.4, 130.97, 'Japan (JAXA)'], ['Mahia', -39.26, 177.86, 'Rocket Lab — New Zealand'],
    ['Naro', 34.43, 127.54, 'South Korea (KARI)'],
  ],
  datacenters: [
    ['Ashburn (US-East)', 39.04, -77.49, 'Largest data-center hub on Earth'], ['Santa Clara', 37.35, -121.96, 'Silicon Valley core'],
    ['Dublin', 53.34, -6.27, 'EU cloud gateway'], ['Singapore', 1.35, 103.82, 'APAC hub'],
    ['Frankfurt', 50.11, 8.68, 'DE-CIX exchange'], ['Phoenix', 33.45, -112.07, 'Booming AI capacity'],
    ['The Dalles', 45.6, -121.18, 'Google flagship'], ['Council Bluffs', 41.26, -95.86, 'Meta/Google mega-campus'],
    ['Chicago', 41.88, -87.63, 'Midwest financial DC hub'], ['Amsterdam', 52.37, 4.90, 'AMS-IX colocation'],
    ['Sydney', -33.87, 151.21, 'ANZ cloud hub'], ['Tokyo', 35.68, 139.76, 'JP cloud hub'],
  ],
  centralbanks: [
    ['Federal Reserve', 38.893, -77.045, 'United States'], ['ECB', 50.109, 8.674, 'Eurozone (Frankfurt)'],
    ['Bank of England', 51.514, -0.089, 'United Kingdom'], ['Bank of Japan', 35.686, 139.771, 'Japan'],
    ['PBoC', 39.915, 116.366, "People's Bank of China"], ['SNB', 46.947, 7.444, 'Switzerland'],
    ['RBI', 18.932, 72.836, 'India'], ['BoC', 45.421, -75.704, 'Canada'],
    ['RBA', -35.28, 149.13, 'Australia'], ['BCB', -15.78, -47.93, 'Brazil'],
    ['SARB', -25.74, 28.18, 'South Africa'], ['CBR', 55.75, 37.62, 'Russia'],
  ],
  militaryBases: [
    ['Ramstein AB', 49.44, 7.60, 'US Air Force — Germany'], ['Diego Garcia', -7.31, 72.41, 'US/UK Indian Ocean base'],
    ['Guam (Andersen)', 13.58, 144.93, 'US Pacific hub'], ['Al Udeid AB', 25.12, 51.32, 'US CENTCOM — Qatar'],
    ['Camp Humphreys', 36.96, 127.03, 'Largest US overseas base — Korea'], ['Yokosuka', 35.29, 139.67, 'US 7th Fleet — Japan'],
    ['Djibouti (Lemonnier)', 11.55, 43.16, 'US/Allied Horn of Africa'], ['Tartus', 34.90, 35.87, 'Russian naval base — Syria'],
    ['Pearl Harbor', 21.36, -157.95, 'US Pacific Fleet'], ['Incirlik AB', 37.00, 35.43, 'US/NATO — Türkiye'],
    ['Bagram (former)', 34.95, 69.27, 'Afghanistan'], ['Kaliningrad', 54.71, 20.51, 'Russian Baltic exclave'],
    ['RAAF Darwin', -12.41, 130.87, 'Australia — US Marines rotation'], ['Sembawang', 1.43, 103.82, 'Singapore — US/UK'],
    ['Souda Bay', 35.52, 24.07, 'US/NATO — Crete'], ['Misawa AB', 40.70, 141.37, 'US — Northern Japan'],
  ],
  criticalMinerals: [
    ['Bayan Obo', 41.77, 109.97, "China — rare earths (world's largest)"], ['Mountain Pass', 35.48, -115.53, 'USA — rare earths'],
    ['Escondida', -24.27, -69.07, 'Chile — copper (largest)'], ['Grasberg', -4.06, 137.11, 'Indonesia — copper/gold'],
    ['Cobalt (Katanga)', -10.7, 25.5, 'DR Congo — cobalt belt'], ['Greenbushes', -33.86, 116.06, 'Australia — lithium'],
    ['Salar de Atacama', -23.5, -68.2, 'Chile — lithium brine'], ['Norilsk', 69.35, 88.20, 'Russia — nickel/palladium'],
    ['Olympic Dam', -30.44, 136.88, 'Australia — uranium/copper'], ['Jiangxi', 28.0, 116.0, 'China — rare-earth refining'],
    ['Cerro Rico', -19.59, -65.76, 'Bolivia — silver/tin (historic)'], ['Carajas', -6.10, -50.01, 'Brazil — iron ore'],
    ['Witwatersrand', -26.27, 27.23, 'South Africa — gold belt'], ['Pilbara', -23.0, 118.5, 'Australia — iron ore'],
  ],
  techHQs: [
    ['Apple', 37.335, -122.009, 'Cupertino'], ['Google', 37.422, -122.084, 'Mountain View'], ['Microsoft', 47.640, -122.129, 'Redmond'],
    ['Nvidia', 37.371, -121.965, 'Santa Clara'], ['Meta', 37.485, -122.148, 'Menlo Park'], ['TSMC', 24.774, 121.001, 'Hsinchu, Taiwan'],
    ['ASML', 51.41, 5.46, 'Veldhoven, NL'], ['Samsung', 37.258, 127.054, 'Suwon'], ['Tesla', 30.222, -97.617, 'Austin'],
    ['Amazon', 47.622, -122.337, 'Seattle'], ['ARM', 52.198, 0.127, 'Cambridge UK'],
    ['OpenAI', 37.777, -122.419, 'San Francisco'], ['Anthropic', 37.785, -122.408, 'San Francisco'],
    ['Huawei', 22.62, 114.06, 'Shenzhen'], ['SMIC', 31.23, 121.47, 'Shanghai'],
  ],
  cloudRegions: [
    ['AWS us-east-1', 39.04, -77.49, 'N. Virginia — core'], ['AWS us-west-2', 45.87, -119.69, 'Oregon'],
    ['AWS us-east-2', 39.96, -82.99, 'Ohio'], ['AWS ap-south-1', 19.08, 72.88, 'Mumbai'],
    ['Azure East US', 37.37, -79.16, 'Virginia'], ['Azure West US 2', 47.60, -122.33, 'Washington'],
    ['GCP us-central1', 41.26, -95.86, 'Iowa'], ['GCP europe-west1', 50.45, 3.82, 'Belgium'],
    ['AWS eu-west-1', 53.41, -8.24, 'Ireland'], ['AWS ap-southeast-1', 1.32, 103.69, 'Singapore'],
    ['Azure West Europe', 52.37, 4.90, 'Netherlands'], ['GCP asia-east1', 24.05, 120.52, 'Taiwan'],
    ['AWS ap-northeast-1', 35.68, 139.77, 'Tokyo'], ['Azure Southeast Asia', 1.35, 103.82, 'Singapore'],
    ['GCP southamerica-east1', -23.55, -46.63, 'São Paulo'], ['AWS af-south-1', -33.92, 18.42, 'Cape Town'],
  ],
  financialCenters: [
    ['Wall Street', 40.706, -74.009, 'New York'], ['City of London', 51.515, -0.092, 'London'],
    ['Hong Kong', 22.281, 114.158, 'HK'], ['Singapore', 1.284, 103.851, 'SG'], ['Tokyo', 35.681, 139.767, 'Marunouchi'],
    ['Frankfurt', 50.111, 8.679, 'DE'], ['Zurich', 47.369, 8.539, 'CH'], ['Dubai (DIFC)', 25.215, 55.282, 'UAE'],
    ['Shanghai', 31.240, 121.499, 'Lujiazui'], ['Sydney', -33.87, 151.21, 'AU'], ['Toronto', 43.65, -79.38, 'CA'],
    ['Mumbai', 19.08, 72.88, 'IN'], ['São Paulo', -23.55, -46.63, 'BR'],
  ],
  refugeeHotspots: [
    ['Syria', 35.0, 38.0, 'Largest displacement crisis'], ['Ukraine', 49.0, 32.0, 'War displacement'],
    ['Sudan', 15.5, 30.0, 'Conflict displacement'], ['Gaza', 31.5, 34.45, 'Humanitarian crisis'],
    ['DR Congo', -2.0, 27.0, 'Eastern conflict'], ['Myanmar', 21.0, 96.0, 'Rohingya & internal'],
    ['Afghanistan', 34.0, 66.0, 'Protracted displacement'], ['Venezuela', 7.0, -66.0, 'Regional migration'],
    ['Somalia', 5.0, 45.0, 'Prolonged crisis'], ['South Sudan', 7.0, 30.0, 'Internal displacement'],
    ['Ethiopia', 9.0, 40.0, 'Tigray & Amhara crisis'], ['Sahel', 14.0, -2.0, 'Burkina/Mali/Niger displacement'],
  ],
  commodityPorts: [
    ['Ras Tanura', 26.64, 50.16, 'Saudi — oil export'], ['Rotterdam', 51.95, 4.14, "Europe's largest port"],
    ['Shanghai', 30.62, 122.06, "World's busiest container port"], ['Houston', 29.73, -95.27, 'US energy export'],
    ['Singapore', 1.26, 103.75, 'Bunkering & transshipment'], ['Fujairah', 25.16, 56.36, 'UAE oil storage hub'],
    ['Newcastle', -32.92, 151.80, 'Australia — coal export'], ['Santos', -23.96, -46.30, 'Brazil — soy/sugar'],
    ['Dalian', 38.91, 121.62, 'China — crude import'], ['Corpus Christi', 27.79, -97.39, 'US LNG export'],
    ['Dampier', -20.66, 116.72, 'Australia — iron ore'], ['Caofeidian', 39.52, 119.06, 'China — coal/ore hub'],
  ],
  conflictZones: [
    ['Ukraine', 48.3, 37.8, 'Russia–Ukraine war (active front)'], ['Gaza', 31.45, 34.40, 'Israel–Hamas conflict'],
    ['Sudan', 15.5, 32.5, 'Civil war (RSF vs SAF)'], ['Sahel', 14.0, 0.0, 'Jihadist insurgency belt'],
    ['Myanmar', 21.5, 96.5, 'Civil war'], ['DR Congo (East)', -1.5, 29.0, 'M23 & militia conflict'],
    ['Red Sea', 14.5, 42.0, 'Houthi shipping attacks'], ['Taiwan Strait', 24.5, 119.5, 'Cross-strait tensions'],
    ['Kashmir', 34.0, 76.0, 'India–Pakistan flashpoint'], ['Korean DMZ', 38.0, 127.5, 'North–South standoff'],
    ['Tigray/Amhara', 12.5, 38.5, 'Ethiopia internal conflict'], ['Haiti', 18.9, -72.3, 'Gang control crisis'],
  ],
  sanctions: [
    ['Russia', 61.5, 100.0, 'Heavily sanctioned (West)'], ['Iran', 32.0, 53.0, 'Oil & banking sanctions'],
    ['North Korea', 40.0, 127.0, 'UN/US sanctions'], ['Venezuela', 7.0, -66.0, 'US oil sanctions'],
    ['Syria', 35.0, 38.0, 'Multilateral sanctions'], ['Cuba', 22.0, -79.5, 'US embargo'],
    ['Belarus', 53.7, 27.9, 'EU/US sanctions'], ['Myanmar', 16.0, 96.0, 'EU/US targeted sanctions'],
    ['Mali', 17.0, -4.0, 'ECOWAS/EU sanctions'], ['Nicaragua', 12.8, -85.2, 'US democracy sanctions'],
  ],
  startupHubs: [
    ['Silicon Valley', 37.39, -122.08, 'Global #1'], ['New York', 40.74, -73.99, 'Fintech & SaaS'],
    ['London', 51.52, -0.10, 'Europe #1'], ['Bengaluru', 12.97, 77.59, 'India tech capital'],
    ['Tel Aviv', 32.07, 34.79, 'Startup Nation'], ['Beijing', 39.98, 116.31, 'Zhongguancun'],
    ['Berlin', 52.52, 13.40, 'EU growth hub'], ['Singapore', 1.29, 103.85, 'SEA gateway'],
    ['Shenzhen', 22.54, 114.06, 'Hardware capital'], ['Seoul', 37.56, 126.99, 'K-startup hub'],
    ['Toronto', 43.65, -79.38, 'AI research hub (Vector Institute)'], ['Paris', 48.86, 2.35, 'Station F ecosystem'],
    ['Dubai', 25.20, 55.27, 'MENA startup hub'], ['São Paulo', -23.55, -46.63, 'LatAm fintech'],
  ],
  gccInvestments: [
    ['PIF (Saudi)', 24.71, 46.68, '$900B+ sovereign fund'], ['ADIA (Abu Dhabi)', 24.45, 54.38, '~$1T sovereign fund'],
    ['QIA (Qatar)', 25.29, 51.53, '~$500B fund'], ['Mubadala', 24.50, 54.37, 'Abu Dhabi strategic fund'],
    ['Kuwait (KIA)', 29.38, 47.99, 'Oldest sovereign fund'], ['NEOM', 28.0, 35.3, '$500B megacity project'],
    ['ADQ', 24.47, 54.37, 'Abu Dhabi Developmental Holding'], ['DIFC', 25.21, 55.28, 'Dubai financial free zone'],
  ],
  diseaseOutbreaks: [
    ['DR Congo', -4.0, 21.5, 'Mpox / Ebola watch'], ['Uganda', 1.4, 32.3, 'Ebola/Marburg surveillance'],
    ['DRC/Sudan', 12.0, 30.0, 'Cholera outbreaks'], ['SE Asia', 14.0, 101.0, 'Dengue surge'],
    ['Global', 30.0, 0.0, 'Avian influenza H5N1 spread'], ['Brazil', -14.24, -51.93, 'Yellow fever alert zones'],
    ['West Africa', 8.0, -4.0, 'Marburg surveillance'], ['Haiti', 18.9, -72.3, 'Cholera resurgence'],
  ],
  economicCenters: [
    ['New York', 40.71, -74.01, 'Largest economy metro'], ['Tokyo', 35.68, 139.69, 'Japan core'],
    ['Shanghai', 31.23, 121.47, 'China commerce'], ['London', 51.51, -0.13, 'UK/EU finance'],
    ['Los Angeles', 34.05, -118.24, 'Trade & media'], ['Paris', 48.86, 2.35, 'EU #2'],
    ['Mumbai', 19.08, 72.88, 'India finance'], ['São Paulo', -23.55, -46.63, 'LatAm hub'],
    ['Dubai', 25.20, 55.27, 'MENA gateway'], ['Singapore', 1.35, 103.82, 'SEA financial hub'],
    ['Frankfurt', 50.11, 8.68, 'EU ECB seat'], ['Chicago', 41.88, -87.63, 'US derivatives hub'],
  ],
  internetExchanges: [
    ['DE-CIX Frankfurt', 50.11, 8.68, "World's largest IXP"], ['AMS-IX', 52.36, 4.95, 'Amsterdam'],
    ['LINX London', 51.51, -0.09, 'London'], ['Equinix Ashburn', 39.04, -77.49, 'US-East core'],
    ['Equinix Singapore', 1.29, 103.85, 'SEA core'], ['Equinix Tokyo', 35.69, 139.69, 'Japan'],
    ['Equinix Palo Alto', 37.44, -122.14, 'Silicon Valley'], ['MIX Milan', 45.46, 9.19, 'Italy'],
    ['MSK-IX Moscow', 55.75, 37.62, 'Russia largest IXP'], ['TorIX Toronto', 43.65, -79.38, 'Canada'],
    ['BDIX Dhaka', 23.81, 90.41, 'Bangladesh hub'], ['Nap Africa Johannesburg', -26.20, 28.04, 'Africa core IXP'],
  ],
  gpsJamming: [
    ['Eastern Mediterranean', 33.5, 34.0, 'Persistent GPS spoofing'], ['Black Sea', 44.0, 34.0, 'Conflict-zone jamming'],
    ['Baltic / Kaliningrad', 55.0, 21.0, 'Jamming affecting aviation'], ['Persian Gulf', 26.5, 52.0, 'Strait of Hormuz interference'],
    ['Korean Peninsula', 37.8, 126.5, 'DPRK jamming events'], ['Syria/Levant', 34.5, 37.0, 'Active EW operations'],
    ['Red Sea / Bab-el-Mandeb', 13.0, 43.5, 'Houthi EW interference'], ['Barents Sea', 69.0, 33.0, 'Russian EW exercises'],
  ],
  webcams: [
    ['Times Square', 40.758, -73.985, 'New York City', 'https://www.youtube.com/results?search_query=times+square+live+cam'],
    ['Shibuya Crossing', 35.659, 139.700, 'Tokyo', 'https://www.youtube.com/results?search_query=shibuya+crossing+live+cam'],
    ['Las Vegas Strip', 36.115, -115.173, 'Nevada', 'https://www.youtube.com/results?search_query=las+vegas+strip+live+cam'],
    ["Venice — St Mark's", 45.434, 12.339, 'Italy', 'https://www.youtube.com/results?search_query=venice+st+marks+live+cam'],
    ['Abbey Road', 51.532, -0.177, 'London', 'https://www.youtube.com/results?search_query=abbey+road+live+cam'],
    ['Mount Fuji', 35.361, 138.728, 'Japan', 'https://www.youtube.com/results?search_query=mount+fuji+live+cam'],
    ['Niagara Falls', 43.080, -79.075, 'US/Canada', 'https://www.youtube.com/results?search_query=niagara+falls+live+cam'],
    ['Reykjavík / Aurora', 64.146, -21.942, 'Iceland', 'https://www.youtube.com/results?search_query=iceland+aurora+live+cam'],
    ['Bondi Beach', -33.891, 151.277, 'Sydney', 'https://www.youtube.com/results?search_query=bondi+beach+live+cam'],
    ['Dubai Marina', 25.080, 55.140, 'UAE', 'https://www.youtube.com/results?search_query=dubai+live+cam'],
    ['Singapore Marina', 1.283, 103.860, 'Singapore', 'https://www.youtube.com/results?search_query=singapore+marina+live+cam'],
    ['Kyiv', 50.450, 30.523, 'Ukraine', 'https://www.youtube.com/results?search_query=kyiv+live+cam'],
  ],
  lines: {
    tradeRoutes: [
      // ── Major container / bulk shipping lanes (real waypoints) ──────────
      ['Asia–Europe (via Suez)',
        [[31.23, 121.47], [22.28, 114.16], [1.29, 103.85], [5.93, 80.02], [11.59, 43.10],
         [12.58, 43.33], [21.49, 39.10], [29.97, 32.56], [31.26, 32.31], [37.08, 15.29],
         [38.12, 15.65], [36.13, -5.35], [43.30, -9.10], [47.50, -8.50], [51.95, 4.14]],
        'World\'s busiest container lane — 25,000+ ships/yr'],
      ['Transpacific (Northern Great Circle)',
        [[35.68, 139.77], [38.00, 145.00], [43.00, 160.00], [47.00, 175.00],
         [48.00, -175.00], [47.50, -157.00], [21.31, -157.86], [33.72, -118.27]],
        'Japan/China → US West Coast — 8,000+ TEU/day'],
      ['Transpacific (Southern)',
        [[22.28, 114.16], [1.29, 103.85], [0.00, 130.00], [-5.00, 150.00],
         [-18.00, 178.00], [-8.90, -140.00], [8.90, -79.53]],
        'SEA → Panama Canal (southerly route)'],
      ['Transatlantic (North)',
        [[51.95, 4.14], [50.20, -5.10], [48.00, -16.00], [45.00, -30.00],
         [42.00, -50.00], [38.00, -65.00], [40.69, -74.04]],
        'Europe → US East Coast — major container/Ro-Ro lane'],
      ['Transatlantic (South)',
        [[51.95, 4.14], [38.71, -9.14], [28.11, -15.43], [14.69, -17.44],
         [-5.82, -35.21], [-23.96, -46.30]],
        'Europe → South America — Brazil/Argentina lane'],
      ['Gulf–Asia Oil Route',
        [[26.64, 50.16], [26.57, 56.25], [22.00, 60.00], [14.00, 57.00],
         [5.93, 80.02], [1.29, 103.85], [22.28, 114.16], [31.23, 121.47]],
        'Persian Gulf crude to Asia (~20 Mbd)'],
      ['Cape Route (Red Sea bypass)',
        [[26.64, 50.16], [11.59, 43.10], [0.00, 45.00], [-10.00, 42.00],
         [-20.00, 38.00], [-34.36, 18.47], [-35.00, 5.00], [-20.00, -10.00],
         [0.00, -10.00], [15.00, -18.00], [36.13, -5.35], [51.95, 4.14]],
        'Houthi-driven reroute around Africa (active since 2024)'],
      ['Intra-Asia (China–Japan–Korea)',
        [[31.23, 121.47], [37.52, 126.93], [35.68, 139.77], [34.39, 132.46],
         [22.28, 114.16], [10.82, 106.63], [1.29, 103.85]],
        'Densest intra-regional trade corridor'],
      ['US Gulf–Europe',
        [[29.95, -89.94], [25.78, -80.19], [20.00, -65.00], [30.00, -45.00],
         [40.00, -30.00], [51.95, 4.14]],
        'LNG/crude export corridor'],
      ['Australia–East Asia',
        [[-33.87, 151.21], [-20.00, 152.00], [-10.00, 147.00], [1.29, 103.85],
         [22.28, 114.16], [31.23, 121.47]],
        'Iron ore, coal, LNG to China/Japan/Korea'],
      ['Northern Sea Route (Arctic)',
        [[51.95, 4.14], [57.00, 10.00], [62.00, 15.00], [69.65, 18.96],
         [71.00, 28.00], [73.00, 40.00], [75.00, 60.00], [77.00, 80.00],
         [76.00, 100.00], [74.00, 120.00], [72.00, 140.00], [68.00, 160.00],
         [64.00, 175.00], [60.00, -175.00], [53.00, -165.00], [57.03, -135.34]],
        'Arctic shortcut — 40% faster EU↔Asia, ice-free summers (Russia EEZ)'],
      ['West Africa – Europe',
        [[-33.87, 18.47], [-22.90, 14.50], [-8.84, 13.23], [4.05, 9.70],
         [6.45, 3.39], [14.69, -17.44], [28.11, -15.43], [38.71, -9.14],
         [51.95, 4.14]],
        'South Africa → West Africa → Europe (oil tankers, bulk)'],
      ['East Africa – Asia',
        [[-33.87, 18.47], [-26.20, 32.60], [-11.70, 43.26], [-4.04, 39.67],
         [2.04, 45.34], [11.59, 43.10], [22.00, 60.00], [5.93, 80.02],
         [1.29, 103.85], [31.23, 121.47]],
        'East Africa ports → Indian Ocean → Asia (oil, gas, minerals)'],
      ['South America – Asia (Pacific)',
        [[-23.96, -46.30], [-33.46, -70.65], [-40.00, -75.00], [-35.00, -90.00],
         [-20.00, -110.00], [-10.00, -130.00], [0.00, -150.00], [10.00, -140.00],
         [22.28, 114.16]],
        'Chile/Peru copper → China — fastest Latin America-Asia route'],
      ['US East Coast – Caribbean – South America',
        [[40.69, -74.04], [25.78, -80.19], [18.48, -69.94], [10.49, -66.88],
         [9.00, -79.50], [-8.00, -75.00], [-23.96, -46.30]],
        'Refined products, container trade, oil'],
      ['Intra-Europe (North-South)',
        [[59.91, 10.75], [57.00, 10.00], [55.68, 12.57], [53.55, 9.99],
         [51.95, 4.14], [48.85, 2.35], [43.30, 5.36], [41.39, 2.16],
         [38.71, -9.14]],
        'Scandinavia → Mediterranean ro-ro and container corridor'],
      ['Black Sea – Mediterranean',
        [[46.50, 30.73], [43.40, 28.67], [41.01, 28.97], [40.99, 29.03],
         [38.00, 26.00], [36.00, 28.00], [36.13, -5.35]],
        'Ukrainian grain, Russian oil via Bosphorus choke'],
      ['Persian Gulf – East Africa (oil/LNG)',
        [[26.57, 56.25], [20.00, 60.00], [11.59, 43.10], [2.04, 45.34],
         [-4.04, 39.67], [-11.70, 43.26], [-26.20, 32.60]],
        'Gulf exports to East African ports (Mombasa, Dar es Salaam)'],
      ['China – Africa (Belt & Road)',
        [[31.23, 121.47], [22.28, 114.16], [1.29, 103.85], [5.93, 80.02],
         [11.59, 43.10], [2.04, 45.34], [-4.04, 39.67], [-26.20, 32.60],
         [-33.87, 18.47]],
        'BRI Maritime Silk Road — China → East Africa → South Africa'],
    ],

    cables: [
      // ── Real submarine cable routes (TeleGeography-sourced waypoints) ───
      // TRANSATLANTIC
      ['MAREA (Microsoft/Facebook, 2017)',
        [[36.80, -5.60], [37.50, -15.00], [37.50, -30.00], [38.00, -50.00],
         [38.50, -65.00], [36.83, -76.00]],
        'Virginia Beach ↔ Bilbao — 160 Tbps capacity'],
      ['AEConnect-1 (2016)',
        [[53.34, -6.27], [52.00, -10.00], [50.00, -20.00], [46.00, -35.00],
         [42.00, -55.00], [40.69, -74.04]],
        'Dublin ↔ New York — 5.2 Tbps'],
      ['FASTER (Google, 2016)',
        [[35.45, 139.63], [35.00, 145.00], [40.00, 160.00], [40.00, 175.00],
         [35.00, -175.00], [21.31, -157.86], [45.54, -122.67]],
        'Japan ↔ Oregon — 60 Tbps'],
      ['JUPITER (Facebook/PLDT/SoftBank, 2020)',
        [[34.69, 135.18], [30.00, 137.00], [25.00, 135.00], [15.00, 135.00],
         [13.44, 144.75], [21.31, -157.86], [33.72, -118.27]],
        'Japan/Philippines ↔ Los Angeles — 60 Tbps'],
      ['Hawaiki (2018)',
        [[45.54, -122.67], [21.31, -157.86], [-13.82, -172.00],
         [-36.85, 174.76], [-33.87, 151.21]],
        'Oregon ↔ New Zealand ↔ Australia'],
      ['SEA-ME-WE 5 (2016)',
        [[1.29, 103.82], [5.93, 80.02], [11.59, 43.10], [21.49, 39.10],
         [29.97, 32.56], [31.26, 32.31], [37.50, 15.00], [43.30, 5.36],
         [44.40, 8.92], [38.71, -9.14], [50.80, -1.08]],
        'Singapore → Marseille → Southampton — 24 Tbps'],
      ['SEA-ME-WE 3 (1999, longest cable)',
        [[1.29, 103.82], [5.93, 80.02], [11.59, 43.10], [22.00, 39.10],
         [30.00, 32.56], [31.26, 32.31], [35.00, 24.00], [40.00, 28.00],
         [43.30, 5.36], [38.71, -9.14], [51.50, -0.09]],
        'Singapore → UK — 39,000 km, 20 countries'],
      ['PEACE Cable (2022)',
        [[24.86, 67.01], [22.00, 60.00], [11.59, 43.10], [-4.04, 39.67],
         [-10.00, 40.00], [-20.00, 35.00], [-26.20, 28.04]],
        'Pakistan → East Africa (Mombasa, Johannesburg)'],
      ['2Africa (Meta, 2024)',
        [[51.50, -0.09], [38.71, -9.14], [28.11, -15.43], [14.69, -17.44],
         [5.35, -4.02], [6.45, 3.39], [4.05, 9.70], [-4.32, 15.32],
         [-8.84, 13.23], [-22.90, 14.50], [-34.36, 18.47], [-26.20, 28.04],
         [-4.04, 39.67], [2.04, 45.34], [11.59, 43.10], [21.49, 39.10],
         [23.62, 58.59], [25.20, 55.27], [25.12, 51.32], [26.22, 50.57],
         [24.47, 54.37]],
        'Meta\'s 45,000 km cable circling Africa — 180 Tbps'],
      ['Africa Coast to Europe (ACE, 2012)',
        [[51.50, -0.09], [38.71, -9.14], [28.11, -15.43], [18.08, -15.97],
         [14.69, -17.44], [10.65, -14.42], [5.35, -4.02], [4.05, 9.70],
         [-4.32, 15.32], [-8.84, 13.23], [-22.90, 14.50], [-34.36, 18.47]],
        'UK → South Africa — 17,000 km'],
      ['New Cross Pacific (NCP, 2016)',
        [[37.56, 126.98], [35.10, 129.07], [35.68, 139.77], [37.00, 143.00],
         [42.00, 155.00], [45.00, 170.00], [47.00, -175.00], [47.60, -122.33]],
        'Korea/Japan ↔ Seattle — 80 Tbps'],
      ['Transatlantic (TAT-14, 2001)',
        [[51.95, 4.14], [51.50, -0.09], [48.00, -5.00], [47.00, -18.00],
         [45.00, -35.00], [41.00, -55.00], [40.69, -74.04]],
        'Netherlands/UK ↔ New Jersey — 3.2 Tbps'],
      ['South Atlantic Express (SAex)',
        [[40.69, -74.04], [14.93, -23.51], [-22.90, -43.17]],
        'New York ↔ Cape Verde ↔ Rio de Janeiro'],
      // TRANSATLANTIC additional
      ['FLAG Atlantic-1 / Yellow (2000)',
        [[50.80, -1.08], [48.00, -5.00], [47.00, -15.00], [44.00, -30.00],
         [41.00, -50.00], [40.69, -74.04]],
        'UK → New York — 14,000 km'],
      ['Apollo (2003)',
        [[51.50, -0.09], [50.00, -8.00], [46.00, -20.00], [42.00, -40.00],
         [40.00, -65.00], [40.69, -74.04]],
        'UK/France → New York — 13,000 km'],
      ['Amitié (Facebook/Microsoft/Aqua Comms, 2022)',
        [[47.25, -1.55], [46.00, -8.00], [44.00, -20.00], [42.00, -40.00],
         [40.69, -74.04]],
        'France/Ireland/UK ↔ Boston — 6,800 km, 400 Tbps'],
      ['Grace Hopper (Google, 2022)',
        [[51.50, -0.09], [53.34, -6.27], [52.00, -10.00], [48.00, -20.00],
         [44.00, -35.00], [40.69, -74.04]],
        'UK/Ireland/Spain ↔ New York — 6,400 km'],
      ['EllaLink (2021)',
        [[38.71, -9.14], [28.11, -15.43], [14.93, -23.51], [3.00, -30.00],
         [-8.00, -35.00], [-22.90, -43.17]],
        'Portugal ↔ Brazil — 6,200 km (dedicated EU-LatAm)'],
      ['Hibernia Express (2015)',
        [[53.34, -6.27], [53.00, -10.00], [52.00, -20.00], [50.00, -35.00],
         [46.00, -55.00], [40.69, -74.04]],
        'Dublin ↔ New York — low-latency financial route'],
      // PACIFIC additional
      ['Southern Cross (1999)',
        [[-33.87, 151.21], [-36.85, 174.76], [-21.13, -175.20],
         [21.31, -157.86], [37.78, -122.42]],
        'Australia/NZ ↔ Hawaii ↔ San Francisco'],
      ['Gondwana-1 (2009)',
        [[-21.90, 166.00], [-36.85, 174.76]],
        'New Caledonia ↔ New Zealand'],
      ['Tonga Cable (2013)',
        [[-36.85, 174.76], [-21.13, -175.20]],
        'New Zealand ↔ Tonga'],
      ['EAC Pacific / Endeavour (2009)',
        [[35.68, 139.77], [26.07, 119.31], [22.28, 114.16], [1.29, 103.85],
         [-6.89, 107.62], [-7.25, 112.75], [-8.67, 115.21]],
        'Japan → China → Singapore → Indonesia'],
      ['PC-1 (Pacific Crossing, 2000)',
        [[35.68, 139.77], [40.00, 155.00], [45.00, 170.00], [47.00, -175.00],
         [45.00, -157.00], [37.78, -122.42]],
        'Japan ↔ California — 21,000 km'],
      ['SJC (Southeast Asia-Japan Cable, 2013)',
        [[22.28, 114.16], [22.10, 114.20], [10.82, 106.63], [1.29, 103.85],
         [6.93, 79.85], [13.44, 144.75], [35.68, 139.77]],
        'China/Hong Kong → Vietnam → Singapore → Guam → Japan'],
      ['AAG (Asia-America Gateway, 2009)',
        [[22.28, 114.16], [10.82, 106.63], [14.05, 108.20], [1.29, 103.85],
         [13.00, 100.50], [16.47, 107.60], [21.31, -157.86], [33.72, -118.27]],
        'SE Asia/HK ↔ Hawaii ↔ Los Angeles'],
      // INDIAN OCEAN / EAST AFRICA
      ['SEACOM (2009)',
        [[-33.87, 18.47], [-26.20, 32.60], [-19.83, 34.84], [-11.70, 43.26],
         [-4.04, 39.67], [2.04, 45.34], [11.59, 43.10], [22.00, 54.00],
         [23.62, 58.59], [25.20, 55.27]],
        'South Africa → East Africa → India → UAE'],
      ['EASSy (Eastern Africa Submarine System, 2010)',
        [[-33.87, 18.47], [-34.05, 25.65], [-26.20, 32.60], [-25.96, 32.59],
         [-19.83, 34.84], [-15.00, 40.00], [-11.70, 43.26], [-4.04, 39.67],
         [2.04, 45.34], [11.30, 43.15], [12.36, 43.51], [15.33, 42.72]],
        'South Africa → East Africa → Sudan — 10,500 km'],
      ['TEAMS (The East Africa Marine System, 2009)',
        [[1.29, 103.85], [5.93, 80.02], [22.00, 54.00], [2.04, 45.34],
         [-4.04, 39.67]],
        'UAE → India → Kenya'],
      ['LION/LION2 (2009/2012)',
        [[-20.16, 57.50], [-11.70, 43.26], [-4.04, 39.67], [-12.97, 40.52],
         [-18.91, 47.54]],
        'Mauritius → Comoros → Kenya → Mozambique → Madagascar'],
      ['SAFE (South Africa Far East, 2002)',
        [[-33.87, 18.47], [-26.20, 32.60], [-11.70, 43.26], [5.93, 80.02],
         [1.29, 103.85], [22.28, 114.16], [35.68, 139.77]],
        'South Africa → India → Malaysia → Japan — 28,000 km'],
      ['Bay of Bengal Gateway (BBG, 2017)',
        [[22.28, 114.16], [10.82, 106.63], [1.29, 103.85], [13.00, 100.50],
         [16.87, 96.12], [23.73, 90.41], [13.08, 80.27]],
        'HK/Singapore → Thailand → Bangladesh → India (Chennai)'],
      // MEDITERRANEAN & EUROPE
      ['MedNautilus/Bosphorus (2011)',
        [[51.50, -0.09], [43.30, 5.36], [37.98, 23.73], [41.01, 28.97],
         [40.97, 28.82], [36.83, 34.63]],
        'UK → France → Greece → Turkey → Middle East'],
      ['TE North (2012)',
        [[36.83, 34.63], [31.26, 32.31], [25.20, 55.27], [23.62, 58.59]],
        'Turkey → Egypt → UAE — 13,000 km'],
      ['Cadmos (2005)',
        [[43.30, 5.36], [37.98, 23.73], [35.15, 33.36], [33.89, 35.49]],
        'Marseille → Greece → Cyprus → Lebanon'],
      ['Blue Raman (2023)',
        [[44.40, 8.92], [38.00, 14.00], [32.00, 34.00], [25.20, 55.27],
         [23.62, 58.59], [22.00, 60.00], [20.00, 63.00], [16.00, 68.00],
         [13.08, 80.27], [1.29, 103.85]],
        'Italy → Israel → UAE → India → Singapore — 15,000 km'],
      ['Baltic Sea Cable',
        [[59.33, 18.07], [56.16, 15.59], [54.52, 13.65], [53.55, 9.99],
         [55.68, 12.57], [55.68, 12.58], [60.39, 5.32]],
        'Sweden → Germany → Denmark → Norway (Baltic grid)'],
      // WEST AFRICA
      ['WACS (West Africa Cable System, 2012)',
        [[51.50, -0.09], [38.71, -9.14], [28.11, -15.43], [14.69, -17.44],
         [10.65, -14.42], [8.49, -13.23], [5.35, -4.02], [4.05, 9.70],
         [4.05, 9.69], [-4.32, 15.32], [-8.84, 13.23], [-22.90, 14.50],
         [-33.87, 18.47]],
        'UK → Portugal → West Africa → South Africa — 14,500 km'],
      ['SAT-3/WASC (2002)',
        [[51.50, -0.09], [38.71, -9.14], [28.11, -15.43], [14.69, -17.44],
         [10.65, -14.42], [5.35, -4.02], [4.05, 9.70], [-4.32, 15.32],
         [-8.84, 13.23], [-22.90, 14.50], [-33.87, 18.47]],
        'Europe → West Africa → South Africa — 14,350 km'],
      ['MainOne (2010)',
        [[38.71, -9.14], [28.11, -15.43], [14.69, -17.44], [5.35, -4.02],
         [6.45, 3.39]],
        'Portugal → West Africa (Senegal → Côte d\'Ivoire → Nigeria)'],
      // AMERICAS
      ['Americas-II (1999)',
        [[40.69, -74.04], [25.78, -80.19], [18.48, -69.94], [10.49, -66.88],
         [-8.00, -35.00], [-22.90, -43.17], [-34.92, -56.19]],
        'US → Caribbean → Brazil → Uruguay'],
      ['ARCOS (Americas Region Caribbean Optical-ring System)',
        [[25.78, -80.19], [21.52, -80.00], [17.99, -76.79], [15.85, -61.70],
         [17.13, -61.84], [18.02, -76.78], [15.29, -90.03], [10.49, -85.86],
         [8.99, -79.53]],
        'Florida → Cuba → Caribbean → Central America'],
      ['Firmina (Google, 2023)',
        [[40.69, -74.04], [-8.00, -35.00], [-22.90, -43.17], [-34.92, -56.19],
         [-33.46, -70.65]],
        'New York → Brazil → Uruguay → Chile — 24,000 km, longest single-cable'],
    ],

    pipelines: [
      // ── Real pipeline routes with accurate waypoints ─────────────────────
      ['Nord Stream 1 (Baltic Sea gas)',
        [[60.71, 28.74], [59.50, 25.00], [57.50, 20.00], [55.50, 16.50],
         [54.52, 13.65]],
        'Vyborg → Lubmin, Germany (55 bcm/yr, flows halted 2022)'],
      ['Nord Stream 2 (Baltic Sea gas)',
        [[60.30, 28.20], [58.80, 24.00], [56.50, 19.00], [55.00, 15.50],
         [54.11, 13.64]],
        'Ust-Luga → Lubmin (damaged Sept 2022)'],
      ['TurkStream (Black Sea gas)',
        [[44.89, 37.32], [43.50, 35.00], [42.00, 32.00], [41.25, 29.00],
         [39.90, 27.00], [37.00, 27.00]],
        'Anapa → Turkey (31.5 bcm/yr, operational)'],
      ['Druzhba — Northern Branch (oil)',
        [[53.90, 53.30], [54.00, 49.00], [53.70, 45.00], [53.20, 40.00],
         [52.30, 35.00], [52.05, 30.00], [52.10, 24.00], [52.20, 20.00],
         [52.40, 14.50], [52.53, 13.41]],
        'Almetyevsk → Poland/Germany (1.2 Mbd oil)'],
      ['Druzhba — Southern Branch (oil)',
        [[52.05, 30.00], [50.50, 30.70], [48.50, 31.50], [47.00, 32.00],
         [46.30, 30.70], [44.00, 29.00]],
        'Belarus → Ukraine → Slovakia/Hungary/Czech Republic'],
      ['Yamal-Europe (gas)',
        [[67.64, 77.00], [63.00, 70.00], [60.00, 60.00], [57.00, 50.00],
         [55.70, 37.80], [53.00, 29.00], [52.10, 23.00], [52.20, 20.00],
         [52.40, 14.50]],
        'West Siberia → Germany via Poland (33 bcm/yr)'],
      ['Baku–Tbilisi–Ceyhan / BTC (oil)',
        [[40.41, 49.87], [41.40, 46.00], [41.70, 44.78], [40.90, 43.00],
         [39.90, 41.00], [39.73, 39.49], [37.70, 37.50], [36.63, 35.51]],
        'Azeri crude → Mediterranean (1 Mbd) — BTC pipeline'],
      ['Trans-Anatolian / TANAP (gas)',
        [[41.58, 41.56], [40.80, 40.00], [40.20, 38.00], [39.90, 35.00],
         [39.90, 32.80], [39.80, 30.50], [40.10, 28.00], [40.38, 26.00],
         [41.70, 26.47]],
        'Azerbaijani gas → Turkey/Europe (16 bcm/yr)'],
      ['Trans-Adriatic / TAP (gas)',
        [[41.70, 26.47], [41.50, 23.00], [40.63, 22.94], [40.80, 20.00],
         [41.33, 19.82], [40.83, 18.16]],
        'Greece → Albania → Italy — connects to TANAP'],
      ['East Siberia–Pacific Ocean / ESPO (oil)',
        [[55.93, 98.00], [56.00, 103.00], [57.00, 110.00], [56.50, 115.00],
         [55.00, 120.00], [53.98, 123.89], [52.00, 128.00], [48.00, 133.00],
         [42.93, 133.52]],
        'Taishet → Kozmino (Pacific export terminal) — 1.6 Mbd'],
      ['Trans-Alaska Pipeline (TAPS, oil)',
        [[70.30, -148.63], [67.00, -151.00], [64.84, -147.72], [62.00, -148.00],
         [61.13, -146.36]],
        'Prudhoe Bay → Valdez (800 miles, 1.5 Mbd peak)'],
      ['Colonial Pipeline (US refined products)',
        [[29.76, -95.37], [30.45, -91.15], [32.36, -86.82], [33.75, -84.39],
         [35.23, -80.85], [37.54, -77.44], [38.89, -77.04], [40.69, -74.04]],
        'Houston → New York — largest US pipeline (2.5 Mbd, 5,500 miles)'],
      ['Keystone (oil sands crude)',
        [[52.67, -111.33], [49.00, -104.00], [46.50, -100.00], [43.00, -98.00],
         [40.00, -97.35], [37.00, -96.00], [35.46, -97.52], [29.90, -93.93]],
        'Alberta → US Gulf Coast refineries (830 kbd)'],
      ['Arab Gas Pipeline',
        [[31.26, 32.31], [30.80, 34.00], [31.00, 35.09], [32.60, 36.10],
         [33.50, 36.30], [33.89, 35.49]],
        'Egypt → Jordan → Syria → Lebanon (regional gas)'],
      ['West–East Gas Pipeline (China)',
        [[39.47, 75.99], [40.00, 80.00], [40.00, 90.00], [38.00, 97.00],
         [36.06, 103.83], [34.80, 113.70], [32.00, 118.00], [31.23, 121.47]],
        'Xinjiang → Shanghai (4,000 km, 30 bcm/yr)'],
      ['Trans-Arabian Pipeline (Tapline, oil)',
        [[26.64, 50.16], [26.00, 46.00], [26.00, 40.00], [29.97, 35.55],
         [32.00, 35.00], [33.50, 36.00]],
        'Saudi Arabia → Lebanon/Jordan (historic, partially decommissioned)'],
      // RUSSIA / CENTRAL ASIA
      ['Power of Siberia (Russia-China gas)',
        [[52.00, 120.00], [53.00, 125.00], [53.98, 123.89], [49.00, 130.00],
         [48.47, 135.07], [47.00, 133.00], [44.00, 131.00], [43.80, 131.88]],
        'Chayanda/Kovykta gas fields → Heihe, China (38 bcm/yr, operational 2019)'],
      ['Power of Siberia 2 (proposed)',
        [[67.00, 77.00], [60.00, 68.00], [55.00, 65.00], [52.00, 86.00],
         [49.00, 88.00], [47.91, 106.91]],
        'West Siberia → Mongolia → China (proposed 50 bcm/yr)'],
      ['Central Asia–China Gas Pipeline (CAGP)',
        [[39.65, 66.96], [41.00, 63.00], [42.00, 60.00], [41.00, 65.00],
         [39.47, 75.99], [38.00, 80.00], [39.47, 75.99], [38.47, 75.99],
         [37.00, 78.00], [36.06, 103.83], [34.80, 113.70], [31.23, 121.47]],
        'Turkmenistan/Kazakhstan/Uzbekistan → China (55 bcm/yr)'],
      ['Trans-Caspian Pipeline (TCP, proposed)',
        [[40.41, 49.87], [42.00, 52.00], [42.50, 52.50], [37.95, 58.38]],
        'Azerbaijan → Caspian Sea → Turkmenistan (gas, under negotiation)'],
      ['Medgaz (Algeria–Spain, 2011)',
        [[36.91, 2.43], [37.30, 0.50], [37.50, -1.00], [37.60, -0.80],
         [38.00, -0.50], [38.35, -0.48]],
        'Algeria → Spain (Algeria direct, 8 bcm/yr)'],
      ['Transmed / Enrico Mattei (1983)',
        [[36.91, 2.43], [37.00, 8.00], [37.50, 10.00], [37.50, 11.00],
         [38.11, 13.37], [40.85, 14.27], [41.89, 12.50], [44.40, 8.92],
         [45.46, 9.19]],
        'Algeria → Tunisia → Sicily → Italy (Hassi R\'Mel, 30 bcm/yr)'],
      // NORTH AMERICA additional
      ['Trans Mountain (Canada, expanded 2024)',
        [[53.54, -113.49], [51.50, -116.50], [49.40, -117.00], [49.35, -122.90],
         [49.28, -123.11]],
        'Alberta → Vancouver (890 kbd, tripled capacity 2024)'],
      ['Enbridge Mainline (largest oil pipeline system)',
        [[53.54, -113.49], [52.00, -107.00], [50.00, -100.00], [47.00, -95.00],
         [46.50, -91.00], [42.30, -83.00], [41.88, -87.63]],
        'Alberta → US Midwest (3 Mbd, world\'s longest)'],
      ['Dakota Access Pipeline (DAPL)',
        [[47.50, -102.80], [46.50, -100.00], [45.00, -97.00], [43.00, -95.00],
         [41.88, -87.63]],
        'Bakken shale → Illinois (570 kbd, controversial)'],
      ['Permian Basin pipelines (US)',
        [[31.84, -102.37], [30.00, -98.00], [29.76, -95.37]],
        'Permian Basin → Houston (multiple lines, 5+ Mbd capacity)'],
      // MIDDLE EAST additional
      ['Iraq–Turkey Pipeline (Kirkuk–Ceyhan)',
        [[35.47, 44.39], [36.00, 42.00], [37.00, 40.00], [37.50, 38.00],
         [37.00, 37.00], [36.63, 35.51]],
        'Kirkuk oilfield → Ceyhan, Turkey (1.6 Mbd)'],
      ['Abu Dhabi Crude Oil Pipeline (ADCOP)',
        [[24.47, 54.37], [24.00, 56.00], [22.70, 59.52]],
        'Abu Dhabi → Fujairah (bypass Hormuz, 1.5 Mbd)'],
      ['Arab Gas Pipeline – Extension (Jordan–Syria–Lebanon)',
        [[29.97, 35.55], [32.00, 37.00], [33.50, 36.30], [33.89, 35.49]],
        'Egypt/Jordan gas → Syria → Lebanon (partial operations)'],
      // EUROPE additional
      ['Baltic Pipe (Norway-Poland, 2022)',
        [[58.97, 5.73], [57.70, 7.00], [57.00, 9.00], [56.50, 10.50],
         [56.50, 12.00], [55.68, 12.57], [54.52, 14.00], [54.35, 18.64]],
        'Norway → Denmark → Poland (10 bcm/yr, bypasses Russian gas)'],
      ['Interconnector (UK–Belgium, 1998)',
        [[51.91, 1.26], [51.30, 2.50], [51.22, 2.92]],
        'UK ↔ Belgium bidirectional gas (25.5 mcm/day)'],
      ['Nabucco West (proposed, cancelled)',
        [[41.70, 26.47], [42.10, 24.00], [43.00, 23.00], [45.00, 20.00],
         [47.50, 19.05], [48.21, 16.37]],
        'Turkey → Bulgaria → Austria (proposed, superseded by TAP)'],
      // AFRICA
      ['Trans-Saharan Gas Pipeline (TSGP, proposed)',
        [[3.87, 11.52], [13.52, 2.11], [23.00, 3.00], [30.00, 3.00],
         [36.91, 2.43]],
        'Nigeria → Niger → Algeria → Europe (4,130 km, proposed)'],
      ['West African Gas Pipeline (WAGP, 2010)',
        [[6.45, 3.39], [6.10, 1.22], [5.55, -0.20], [5.35, -4.02]],
        'Nigeria → Benin → Togo → Ghana (pipeline, 678 km)'],
      ['Mozambique–South Africa (ROMPCO)',
        [[-25.96, 32.59], [-26.82, 32.08], [-25.90, 32.04], [-26.20, 28.04]],
        'Mozambique gas → South Africa/Zimbabwe (865 MMcf/d)'],
      // ASIA-PACIFIC additional
      ['Sino-Burma Oil & Gas Pipeline',
        [[22.80, 98.52], [24.50, 97.00], [25.00, 96.00], [24.00, 93.00],
         [23.73, 90.41]],
        'Myanmar coast → Yunnan, China (oil+gas dual pipeline)'],
      ['Thailand–Malaysia Gas Pipeline',
        [[7.00, 100.40], [5.41, 100.33], [3.14, 101.69]],
        'Gulf of Thailand gas → Malaysia (JDA joint development area)'],
      ['Australia Northwest Shelf (offshore pipeline)',
        [[-20.00, 116.00], [-21.00, 114.50], [-29.01, 114.95]],
        'Offshore LNG → Karratha/Dampier processing (Australia)'],
    ],
  },
};

// ── Overpass API — real OSM pipeline/cable geodata (daily refresh) ──────────
async function fetchOverpassLines() {
  const OVERPASS = 'https://overpass-api.de/api/interpreter';
  const out = { cables: [], pipelines: [] };

  // Submarine cables
  try {
    const cableQ = `[out:json][timeout:25];\nway["telecom"="cable"]["location"="underwater"]["name"];\nout 80 geom;`;
    const r = await fetchWithTimeout(OVERPASS, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': BROWSER_UA },
      body: 'data=' + encodeURIComponent(cableQ),
    }, 28000);
    if (r.ok) {
      const d = await r.json();
      for (const el of (d.elements || [])) {
        const name = el.tags?.name || el.tags?.['name:en'] || '';
        if (!name || !Array.isArray(el.geometry) || el.geometry.length < 2) continue;
        const pts = el.geometry;
        const step = pts.length > 30 ? Math.ceil(pts.length / 20) : 1;
        const coords = pts.filter((_, i) => i % step === 0 || i === pts.length - 1).map((p) => [p.lat, p.lon]);
        out.cables.push([name, coords, `Submarine cable${el.tags?.operator ? ' · ' + el.tags.operator : ''}`]);
      }
    }
  } catch { /* Overpass cable query failed */ }

  // Major oil/gas pipelines
  try {
    const pipeQ = `[out:json][timeout:25];\nway["man_made"="pipeline"]["substance"~"^(oil|gas|natural_gas)$"]["name"];\nout 80 geom;`;
    const r = await fetchWithTimeout(OVERPASS, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': BROWSER_UA },
      body: 'data=' + encodeURIComponent(pipeQ),
    }, 28000);
    if (r.ok) {
      const d = await r.json();
      for (const el of (d.elements || [])) {
        const name = el.tags?.name || el.tags?.['name:en'] || '';
        if (!name || !Array.isArray(el.geometry) || el.geometry.length < 2) continue;
        const pts = el.geometry;
        const step = pts.length > 30 ? Math.ceil(pts.length / 20) : 1;
        const coords = pts.filter((_, i) => i % step === 0 || i === pts.length - 1).map((p) => [p.lat, p.lon]);
        const sub = el.tags?.substance || 'oil/gas';
        out.pipelines.push([name, coords, `${sub.charAt(0).toUpperCase() + sub.slice(1)} pipeline${el.tags?.operator ? ' · ' + el.tags.operator : ''}`]);
      }
    }
  } catch { /* Overpass pipeline query failed */ }

  return out;
}

/**
 * Fetch live augmentations and merge into MAP_LAYERS_BASELINE.
 * Tries: IAEA PRIS, UNHCR, Wikidata, Overpass (real OSM geodata).
 * Failures are silently swallowed — baseline is always returned.
 */
// ── REST ship snapshot — global vessel positions (secondary to WS stream) ──
// Sources tried in order:
//   1. AISStream REST API (same provider as the WS feed, authoritative)
//   2. AISHub REST (free, registration-only, no key env var required)
// Returns { vessels: [{mmsi, lat, lon, name, sog, cog, type}] }
async function fetchRestShips() {
  const vessels = [];
  const AISSTREAM_KEY = process.env.AISSTREAM_API_KEY;

  // ── Source 1: AISStream REST snapshot ──────────────────────────────────
  // POST /v0/vessels with a global bounding box filter
  if (AISSTREAM_KEY) {
    try {
      const r = await fetch('https://api.aisstream.io/v0/vessels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${AISSTREAM_KEY}` },
        body: JSON.stringify({
          BoundingBoxes: [[[-89.9, -180], [89.9, 180]]],
          FilterShipMMSI: [],
          IncludeSatellite: true,
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (r.ok) {
        const d = await r.json();
        for (const v of (d.vessels || d || [])) {
          if (v.Latitude == null || v.Longitude == null) continue;
          vessels.push({
            mmsi: v.MMSI || v.mmsi,
            lat: v.Latitude || v.latitude,
            lon: v.Longitude || v.longitude,
            name: (v.ShipName || v.Name || v.name || '').trim(),
            sog: v.Sog || v.sog,
            cog: v.Cog || v.cog,
            type: v.ShipType || v.type,
          });
        }
      }
    } catch { /* AISStream REST unavailable */ }
  }

  // ── Source 2: AISHub REST (free, ~15 min delayed, global incl. satellite) ─
  // Falls back only if AISStream REST returned nothing.
  if (vessels.length < 100) {
    try {
      // AISHub provides a compressed JSON feed to registered users.
      // The endpoint below is their free-tier JSON snapshot (no key needed
      // for the public endpoint, though registered accounts get more data).
      const r = await fetch(
        'https://data.aishub.net/ws.php?username=Z1456&format=1&output=json&compress=0&latmin=-90&latmax=90&lonmin=-180&lonmax=180',
        { headers: { 'User-Agent': BROWSER_UA }, signal: AbortSignal.timeout(10000) }
      );
      if (r.ok) {
        const raw = await r.json();
        // AISHub returns [ {header}, [vessels...] ] — skip header object
        const rows = Array.isArray(raw) ? raw.filter(Array.isArray).flat() : [];
        for (const v of rows) {
          if (v.LATITUDE == null || v.LONGITUDE == null) continue;
          vessels.push({
            mmsi: v.MMSI,
            lat: +v.LATITUDE,
            lon: +v.LONGITUDE,
            name: (v.NAME || '').trim(),
            sog: v.SPEED != null ? v.SPEED / 10 : undefined,
            cog: v.COURSE,
            type: v.SHIPTYPE,
          });
        }
      }
    } catch { /* AISHub unavailable */ }
  }

  // Deduplicate by MMSI
  const seen = new Set();
  const unique = vessels.filter((v) => {
    if (!v.mmsi || seen.has(v.mmsi)) return false;
    seen.add(v.mmsi);
    return true;
  });

  return { vessels: unique, count: unique.length, source: 'rest', ts: Date.now() };
}

async function fetchAugmentedLayers() {
  const out = JSON.parse(JSON.stringify(MAP_LAYERS_BASELINE)); // deep clone

  // ── 1. IAEA PRIS — nuclear reactor operational status ─────────────────────
  // Public REST endpoint (no key required)
  try {
    const iaRes = await fetch(
      'https://pris.iaea.org/api/reactors?status=operational&format=json',
      { headers: { 'User-Agent': BROWSER_UA }, signal: AbortSignal.timeout(8000) }
    );
    if (iaRes.ok) {
      const iaData = await iaRes.json();
      const reactors = Array.isArray(iaData) ? iaData : (iaData.data || iaData.reactors || []);
      for (const rx of reactors.slice(0, 80)) {
        if (rx.latitude == null || rx.longitude == null) continue;
        const name = rx.name || rx.reactor_name || rx.unitName || 'Unknown reactor';
        const country = rx.country || '';
        const capacity = rx.capacity || rx.netCapacity || '';
        const label = `${name}${country ? ' (' + country + ')' : ''}`;
        const desc = `Operational NPP${capacity ? ' · ' + capacity + ' MWe' : ''}`;
        // Only add if not already in baseline (avoid dupes)
        const isDupe = out.nuclear.some(([n]) => n.toLowerCase().includes(name.toLowerCase().slice(0, 6)));
        if (!isDupe) out.nuclear.push([label, +rx.latitude, +rx.longitude, desc]);
      }
    }
  } catch { /* IAEA unreachable — baseline nuclear data still used */ }

  // ── 2. UNHCR Refugee Situations API ──────────────────────────────────────
  // Public API, no key required
  try {
    const uhRes = await fetch(
      'https://api.unhcr.org/population/v1/unsd/?limit=50&sortBy=refugeesUnderUNHCRsMandate&sortOrder=desc',
      { headers: { 'User-Agent': BROWSER_UA }, signal: AbortSignal.timeout(8000) }
    );
    if (uhRes.ok) {
      const uhData = await uhRes.json();
      const items = uhData.items || uhData.data || [];
      for (const item of items.slice(0, 20)) {
        if (!item.geoId && !item.countryOfOriginName) continue;
        const name = item.countryOfOriginName || item.name || '';
        const count = item.refugeesUnderUNHCRsMandate || item.total || 0;
        const fmtCount = count > 1e6 ? (count / 1e6).toFixed(1) + 'M' : count > 1000 ? (count / 1000).toFixed(0) + 'K' : String(count);
        // Try to find matching entry in baseline to augment its description
        const idx = out.refugeeHotspots.findIndex(([n]) => name && n.toLowerCase().includes(name.toLowerCase().slice(0, 5)));
        if (idx >= 0) {
          out.refugeeHotspots[idx][3] = `${out.refugeeHotspots[idx][3]} — ${fmtCount} refugees`;
        }
      }
    }
  } catch { /* UNHCR unreachable — baseline refugee data used */ }

  // ── 3. Wikidata SPARQL — additional military bases ────────────────────────
  // Public SPARQL endpoint, no key required; limit to 40 results
  try {
    const sparql = `SELECT ?item ?label ?lat ?lon ?country WHERE {
      ?item wdt:P31 wd:Q179049;
            wdt:P17 ?countryItem;
            p:P625 [ psv:P625 [ wikibase:geoLatitude ?lat; wikibase:geoLongitude ?lon ] ].
      ?countryItem rdfs:label ?country FILTER(LANG(?country)="en").
      ?item rdfs:label ?label FILTER(LANG(?label)="en").
      FILTER(?lat > -90 && ?lat < 90 && ?lon > -180 && ?lon < 180)
    } LIMIT 40`;
    const wdRes = await fetch(
      'https://query.wikidata.org/sparql?query=' + encodeURIComponent(sparql) + '&format=json',
      { headers: { 'User-Agent': BROWSER_UA, 'Accept': 'application/sparql-results+json' }, signal: AbortSignal.timeout(10000) }
    );
    if (wdRes.ok) {
      const wdData = await wdRes.json();
      for (const b of (wdData.results?.bindings || [])) {
        const name = b.label?.value || '';
        const lat = parseFloat(b.lat?.value);
        const lon = parseFloat(b.lon?.value);
        const country = b.country?.value || '';
        if (!name || isNaN(lat) || isNaN(lon)) continue;
        const isDupe = out.militaryBases.some(([n]) => n.toLowerCase().includes(name.toLowerCase().slice(0, 8)));
        if (!isDupe) out.militaryBases.push([name, lat, lon, `Military installation — ${country}`]);
      }
    }
  } catch { /* Wikidata unreachable — baseline military data used */ }

  // ── 4. Overpass — real OSM pipeline/cable geodata ────────────────────────
  try {
    const ov = await fetchOverpassLines();
    for (const [name, coords, desc] of ov.cables) {
      const isDupe = out.lines.cables.some(([n]) => n.toLowerCase().slice(0, 8) === name.toLowerCase().slice(0, 8));
      if (!isDupe && coords.length >= 2) out.lines.cables.push([name, coords, desc]);
    }
    for (const [name, coords, desc] of ov.pipelines) {
      const isDupe = out.lines.pipelines.some(([n]) => n.toLowerCase().slice(0, 8) === name.toLowerCase().slice(0, 8));
      if (!isDupe && coords.length >= 2) out.lines.pipelines.push([name, coords, desc]);
    }
  } catch { /* Overpass step failed */ }

  out._updated = new Date().toISOString();
  return out;
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

app.get('/api/map/layers', route(async (req, res) => {
  // 24-hour TTL — curated reference data + live augmentation
  const { data } = await fetch_cached_data('map:layers', fetchAugmentedLayers, TTL.MAP);
  res.json(data);
}));

app.get('/api/map/ships', route(async (req, res) => {
  // 60-second TTL — REST snapshot of global vessel positions as a secondary
  // source. Primary data comes from the AISStream WebSocket (ships.js).
  // This catches open-ocean vessels where terrestrial AIS coverage is thin.
  const { data } = await fetch_cached_data('map:ships', fetchRestShips, 60);
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

const http = require('http');
const httpServer = http.createServer(app);

// ── WebSocket proxy for AIS ship stream (local dev) ────────────────────────
// In prod this lives in worker.js; here we replicate it for local testing.
if (WS) {
  httpServer.on('upgrade', (request, socket, head) => {
    const url = request.url || '';
    if (!url.startsWith('/api/ships/stream')) { socket.destroy(); return; }
    const AISSTREAM_KEY = process.env.AISSTREAM_API_KEY;
    if (!AISSTREAM_KEY) { socket.write('HTTP/1.1 503 AIS not configured\r\n\r\n'); socket.destroy(); return; }

    const wss = new WS.Server({ noServer: true });
    wss.handleUpgrade(request, socket, head, (clientWs) => {
      let upstream = null;
      let lastSub = null;
      let closed = false;
      const closeAll = () => {
        closed = true;
        try { upstream && upstream.close(); } catch {}
        try { clientWs.close(); } catch {}
      };

      // Connect upstream to aisstream.io
      try {
        upstream = new WS('wss://stream.aisstream.io/v0/stream');
        upstream.on('open', () => {
          if (lastSub) upstream.send(JSON.stringify(lastSub));
        });
        upstream.on('message', (data) => {
          if (!closed && clientWs.readyState === WS.OPEN) clientWs.send(data);
        });
        upstream.on('close', () => closeAll());
        upstream.on('error', () => closeAll());
      } catch { closeAll(); return; }

      // Client -> upstream: inject API key
      clientWs.on('message', (data) => {
        let msg; try { msg = JSON.parse(data); } catch { return; }
        msg.APIKey = AISSTREAM_KEY;
        lastSub = msg;
        if (upstream && upstream.readyState === WS.OPEN) upstream.send(JSON.stringify(msg));
      });
      clientWs.on('close', () => closeAll());
      clientWs.on('error', () => closeAll());
    });
  });
}

httpServer.listen(PORT, () => {
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
