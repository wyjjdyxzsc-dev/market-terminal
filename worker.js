/**
 * Market Terminal — Cloudflare Worker backend.
 *
 * A faithful edge port of server.js. Same API surface, same data sources
 * (Finnhub + Yahoo/Nasdaq + Google News RSS + Groq), but adapted to the
 * Workers runtime:
 *   • Express routing            -> a small fetch() router (handle() below)
 *   • groq-sdk                   -> plain REST call to the Groq API
 *   • rss-parser                 -> a tiny regex RSS reader (parseRss)
 *   • fs subscriptions.json      -> KV (env.MT_KV, "sub:" prefix)
 *   • in-memory SWR cache        -> KV ("cache:" prefix) + ctx.waitUntil refresh
 *   • web-push npm package       -> WebCrypto VAPID (ES256) + RFC 8291 payload
 *                                   encryption (aes128gcm), all in sendPush()
 *   • setInterval news warmer    -> a Cron Trigger (scheduled() handler)
 *
 * Static frontend is served by the [assets] binding; the Worker only owns /api/*.
 */

const FINNHUB_BASE = 'https://finnhub.io/api/v1';
const CACHE_MS = 60 * 60 * 1000;
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// ───────────────────────── small helpers ─────────────────────────

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

const isoDaysAgo = (days) =>
  new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

async function fetchWithTimeout(url, opts = {}, timeoutMs = 9000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function finnhub(env, endpoint, params = {}) {
  const url = new URL(FINNHUB_BASE + endpoint);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  }
  url.searchParams.set('token', env.FINNHUB_API_KEY || '');
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (res.status === 429) throw new Error('Rate limit reached (Finnhub free tier). Wait a moment and retry.');
  if (!res.ok) throw new Error(`Finnhub responded ${res.status} for ${endpoint}`);
  return res.json();
}

// ───────────────────────── chart (Yahoo -> Nasdaq) ─────────────────────────

const YAHOO_RANGE = {
  '1D': { range: '1d', interval: '5m' },
  '5D': { range: '5d', interval: '15m' },
  '1M': { range: '1mo', interval: '1d' },
  '6M': { range: '6mo', interval: '1d' },
  '1Y': { range: '1y', interval: '1d' },
  '5Y': { range: '5y', interval: '1wk' },
};
const NASDAQ_DAYS = { '5D': 9, '1M': 35, '6M': 190, '1Y': 370, '5Y': 1835 };
const num = (s) => parseFloat(String(s).replace(/[$,]/g, ''));

async function chartFromYahoo(symbol, rangeKey) {
  const cfg = YAHOO_RANGE[rangeKey] || YAHOO_RANGE['1D'];
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?range=${cfg.range}&interval=${cfg.interval}`;
  const res = await fetchWithTimeout(url, { headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json' } }, 9000);
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

async function chartFromNasdaq(symbol, rangeKey) {
  if (rangeKey === '1D') {
    const url = `https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/chart?assetclass=stocks`;
    const res = await fetchWithTimeout(url, { headers: NASDAQ_HEADERS }, 12000);
    if (!res.ok) throw new Error(`Nasdaq responded ${res.status}`);
    const data = await res.json();
    const rows = data?.data?.chart || [];
    const points = rows.filter((r) => r && r.y != null).map((r) => ({ t: r.x, c: Number(r.y) }));
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
  const days = NASDAQ_DAYS[rangeKey] || 35;
  const url =
    `https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/historical` +
    `?assetclass=stocks&fromdate=${isoDaysAgo(days)}&todate=${isoDaysAgo(0)}&limit=9999`;
  const res = await fetchWithTimeout(url, { headers: NASDAQ_HEADERS }, 12000);
  if (!res.ok) throw new Error(`Nasdaq responded ${res.status}`);
  const data = await res.json();
  const rows = data?.data?.tradesTable?.rows || [];
  const toMs = (mdy) => { const [m, d, y] = mdy.split('/').map(Number); return Date.UTC(y, m - 1, d); };
  let points = rows
    .filter((r) => r && r.date && r.close)
    .map((r) => ({ t: toMs(r.date), c: num(r.close) }))
    .sort((a, b) => a.t - b.t);
  if (!points.length) throw new Error('Nasdaq returned no historical data');
  if (rangeKey === '5Y' && points.length > 400) {
    points = points.filter((_, i) => i % 5 === 0 || i === points.length - 1);
  }
  return { points, meta: { prevClose: null, currency: 'USD', price: points[points.length - 1].c } };
}

// Worker isolates are short-lived, so the self-tuning source preference lives in
// KV (best-effort) instead of a module variable.
async function getChart(env, ctx, symbol, rangeKey) {
  let preferred = 'yahoo';
  try { preferred = (await env.MT_KV.get('chartsrc')) || 'yahoo'; } catch {}
  const order = preferred === 'nasdaq' ? ['nasdaq', 'yahoo'] : ['yahoo', 'nasdaq'];
  let lastErr;
  for (const src of order) {
    try {
      const data = src === 'yahoo' ? await chartFromYahoo(symbol, rangeKey) : await chartFromNasdaq(symbol, rangeKey);
      if (data.points && data.points.length >= 2) {
        if (src !== preferred) ctx.waitUntil(env.MT_KV.put('chartsrc', src).catch(() => {}));
        return { ...data, source: src };
      }
      lastErr = new Error(`${src} returned too few points`);
    } catch (err) { lastErr = err; }
  }
  throw lastErr || new Error('No chart data available');
}

// ───────────────────────── Google News RSS ─────────────────────────

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
  const items = [];
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>/g) || [];
  for (const b of blocks) {
    const pick = (tag) => {
      const m = b.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
      return m ? decodeEntities(m[1]) : '';
    };
    const link = pick('link');
    // <source> (publisher feeds) or <News:Source> (Bing) or the link's domain.
    const source = pick('source') || pick('News:Source') || domainOf(link);
    items.push({ title: pick('title'), source, published: pick('pubDate') });
  }
  return items;
}

async function fetchFeed(url, limit = 20) {
  try {
    const res = await fetchWithTimeout(url, { headers: { 'User-Agent': BROWSER_UA, Accept: 'application/rss+xml, application/xml, text/xml, */*' } }, 11000);
    if (!res.ok) return [];
    return parseRss(await res.text()).slice(0, limit).filter((h) => h.title);
  } catch { return []; }
}

function mergeHeadlines(lists) {
  const seen = new Set();
  const merged = [];
  for (const list of lists) {
    for (const h of list) {
      const k = (h.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      merged.push(h);
    }
  }
  return merged;
}

// General market news — a basket of publisher RSS feeds that, unlike Google
// News RSS, serve Cloudflare's edge IPs without a bot-block.
const MARKET_FEEDS = [
  'https://finance.yahoo.com/news/rssindex',
  'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258', // markets
  'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258&page=2',
  'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10000664', // top news
  'https://feeds.content.dowjones.io/public/rss/mw_topstories',
  'https://feeds.content.dowjones.io/public/rss/mw_marketpulse',
];

// World / geopolitical / energy / shipping feeds for the GLOBAL INTEL desk.
const WORLD_FEEDS = [
  'https://feeds.bbci.co.uk/news/world/rss.xml',
  'https://feeds.bbci.co.uk/news/business/rss.xml',
  'https://www.aljazeera.com/xml/rss/all.xml',
  'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100727362', // energy
  'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=15839135', // politics
];

async function fetchMarketHeadlines() {
  const lists = await Promise.all(MARKET_FEEDS.map((u) => fetchFeed(u, 18)));
  return mergeHeadlines(lists).slice(0, 32);
}

// Wider net: market + world/geopolitical headlines, for GLOBAL INTEL & the report.
async function fetchWorldHeadlines() {
  const lists = await Promise.all([...MARKET_FEEDS, ...WORLD_FEEDS].map((u) => fetchFeed(u, 14)));
  return mergeHeadlines(lists).slice(0, 44);
}

// Per-company headlines — Bing News RSS search (allows datacenter IPs).
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
    : headlines.map((h, i) => `${i + 1}. ${h.title}${h.source ? ` — ${h.source}` : ''}${h.published ? ` (${h.published})` : ''}`).join('\n');

// ════════════════════════════════════════════════════════════════════════
//  MULTI-PROVIDER AI POOL
//  Several free LLM providers pooled together. For each task we fire TWO at
//  once (rotating which two, to spread load), take the first that returns
//  valid JSON, and abort the loser to save its tokens. Any provider that hits
//  a rate/quota limit is parked in a KV cooldown and skipped until it recovers,
//  so one exhausted free tier never takes the app down. A provider is "active"
//  only when its key is present — add a key (secret) and it joins the pool
//  automatically; no code change needed.
// ════════════════════════════════════════════════════════════════════════

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One OpenAI-compatible chat call (Groq, Cerebras, Together, OpenRouter, Mistral…).
async function openaiCompatCall({ url, key, model, extraHeaders }, system, user, signal) {
  const res = await fetch(url, {
    method: 'POST',
    signal,
    headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json', ...(extraHeaders || {}) },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      temperature: 0.4,
      max_tokens: 8000,
      response_format: { type: 'json_object' },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`${model} ${res.status}: ${body.slice(0, 160)}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('Empty response.');
  return text;
}

// Google Gemini (different API shape; native JSON mode).
async function geminiCall(env, system, user, signal) {
  const model = env.GEMINI_MODEL || 'gemini-2.0-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 8192, responseMimeType: 'application/json' },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`gemini ${res.status}: ${body.slice(0, 160)}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
  if (!text) throw new Error('Empty response from Gemini.');
  return text;
}

// Cloudflare Workers AI — runs on this account, no key, always available.
async function cfAICall(env, system, user, _signal) {
  const out = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    max_tokens: 8000,
    temperature: 0.4,
  });
  const text = typeof out === 'string' ? out : out.response;
  if (!text) throw new Error('Empty response from Workers AI.');
  return text;
}

// The pool. Order is the default priority; rotation spreads real load across it.
function providerPool(env) {
  const pool = [];
  if (env.GROQ_API_KEY)
    pool.push({ name: 'groq', call: (e, s, u, sig) => openaiCompatCall({ url: 'https://api.groq.com/openai/v1/chat/completions', key: e.GROQ_API_KEY, model: e.GROQ_MODEL || 'llama-3.3-70b-versatile' }, s, u, sig) });
  if (env.GEMINI_API_KEY)
    pool.push({ name: 'gemini', call: geminiCall });
  if (env.CEREBRAS_API_KEY)
    pool.push({ name: 'cerebras', call: (e, s, u, sig) => openaiCompatCall({ url: 'https://api.cerebras.ai/v1/chat/completions', key: e.CEREBRAS_API_KEY, model: e.CEREBRAS_MODEL || 'gpt-oss-120b' }, s, u, sig) });
  if (env.TOGETHER_API_KEY)
    pool.push({ name: 'together', call: (e, s, u, sig) => openaiCompatCall({ url: 'https://api.together.xyz/v1/chat/completions', key: e.TOGETHER_API_KEY, model: e.TOGETHER_MODEL || 'meta-llama/Llama-3.3-70B-Instruct-Turbo-Free' }, s, u, sig) });
  if (env.OPENROUTER_API_KEY)
    pool.push({ name: 'openrouter', call: (e, s, u, sig) => openaiCompatCall({ url: 'https://openrouter.ai/api/v1/chat/completions', key: e.OPENROUTER_API_KEY, model: e.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct:free', extraHeaders: { 'HTTP-Referer': 'https://market-terminal.workers.dev', 'X-Title': 'Market Terminal' } }, s, u, sig) });
  if (env.MISTRAL_API_KEY)
    pool.push({ name: 'mistral', call: (e, s, u, sig) => openaiCompatCall({ url: 'https://api.mistral.ai/v1/chat/completions', key: e.MISTRAL_API_KEY, model: e.MISTRAL_MODEL || 'mistral-large-latest' }, s, u, sig) });
  if (env.SAMBANOVA_API_KEY)
    pool.push({ name: 'sambanova', call: (e, s, u, sig) => openaiCompatCall({ url: 'https://api.sambanova.ai/v1/chat/completions', key: e.SAMBANOVA_API_KEY, model: e.SAMBANOVA_MODEL || 'Meta-Llama-3.3-70B-Instruct' }, s, u, sig) });
  if (env.NEBIUS_API_KEY)
    pool.push({ name: 'nebius', call: (e, s, u, sig) => openaiCompatCall({ url: 'https://api.studio.nebius.com/v1/chat/completions', key: e.NEBIUS_API_KEY, model: e.NEBIUS_MODEL || 'meta-llama/Llama-3.3-70B-Instruct' }, s, u, sig) });
  if (env.HF_API_KEY)
    pool.push({ name: 'huggingface', call: (e, s, u, sig) => openaiCompatCall({ url: 'https://router.huggingface.co/v1/chat/completions', key: e.HF_API_KEY, model: e.HF_MODEL || 'meta-llama/Llama-3.3-70B-Instruct' }, s, u, sig) });
  if (env.GITHUB_MODELS_TOKEN)
    pool.push({ name: 'github', call: (e, s, u, sig) => openaiCompatCall({ url: 'https://models.github.ai/inference/chat/completions', key: e.GITHUB_MODELS_TOKEN, model: e.GITHUB_MODEL || 'openai/gpt-4o-mini' }, s, u, sig) });
  if (env.AI)
    pool.push({ name: 'cfai', call: cfAICall });
  return pool;
}

// How many providers to race simultaneously per task (override with AI_PARALLEL).
const raceWidth = (env) => Math.max(2, parseInt(env.AI_PARALLEL || '3', 10) || 3);

const isRateLimited = (err) => {
  const status = err && (err.status || err.statusCode);
  const msg = String((err && err.message) || '');
  return status === 429 || /\b429\b|rate limit|quota|too many requests|exhausted|resource_exhausted/i.test(msg);
};
// Daily/quota limits park a provider longer than a brief per-minute throttle.
const cooldownMs = (err) =>
  /per day|daily|tpd|quota|exhausted|resource_exhausted/i.test(String((err && err.message) || '')) ? 30 * 60 * 1000 : 60 * 1000;

async function readCooldowns(env) {
  try { return JSON.parse((await env.MT_KV.get('ai:cooldowns')) || '{}'); } catch { return {}; }
}
async function parkProvider(env, name, ms) {
  const cd = await readCooldowns(env);
  cd[name] = Date.now() + ms;
  await env.MT_KV.put('ai:cooldowns', JSON.stringify(cd)).catch(() => {});
}

let rrCounter = 0; // per-isolate rotation offset (spreads which providers lead)

// Fire one batch of providers in parallel; resolve with the first response that
// is valid JSON AND passes `validate`, aborting the rest. A provider that
// returns junk or an empty/unusable answer is treated as a miss — so a weak
// model can't win the race with `{"items":[]}`. Resolves null if all miss.
function raceBatch(env, batch, system, user, validate) {
  return new Promise((resolve) => {
    let pending = batch.length;
    const controllers = batch.map(() => new AbortController());
    let settled = false;
    const miss = () => { if (!settled && --pending === 0) resolve(null); };
    batch.forEach((pv, i) => {
      Promise.resolve()
        .then(() => pv.call(env, system, user, controllers[i].signal))
        .then((text) => {
          let data;
          try { data = extractJson(text); } catch (e) { console.log(`[ai] ${pv.name} unparseable (len ${text && text.length})`); return miss(); }
          if (!validate(data)) { console.log(`[ai] ${pv.name} failed validation`); return miss(); }
          if (settled) return;
          settled = true;
          console.log(`[ai] ${pv.name} WON`);
          controllers.forEach((c, j) => { if (j !== i) try { c.abort(); } catch {} });
          resolve({ data, provider: pv.name });
        })
        .catch((err) => {
          if (err && err.name === 'AbortError') return;
          console.log(`[ai] ${pv.name} error: ${String(err && err.message).slice(0, 120)}`);
          if (isRateLimited(err)) parkProvider(env, pv.name, cooldownMs(err)).catch(() => {});
          miss();
        });
    });
  });
}

// Run an AI task across the pool, two providers at a time, and return parsed
// JSON. `validate(data)` decides whether a response is good enough to accept;
// keeps falling through the pool until one passes.
async function runAIJson(env, system, user, validate = () => true) {
  const pool = providerPool(env);
  if (!pool.length) throw new Error('No AI providers configured. Add at least one AI key.');
  const cd = await readCooldowns(env);
  const now = Date.now();
  let active = pool.filter((p) => !(cd[p.name] && cd[p.name] > now));
  if (!active.length) active = pool; // everyone is cooling down — try anyway

  // Rotate the starting point so load spreads round-robin across the pool.
  const off = rrCounter++ % active.length;
  const ordered = active.slice(off).concat(active.slice(0, off));

  const width = raceWidth(env);
  for (let i = 0; i < ordered.length; i += width) {
    const res = await raceBatch(env, ordered.slice(i, i + width), system, user, validate);
    if (res) return res.data;
  }
  throw new Error('All AI providers are busy or rate-limited right now.');
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

// ───────────────────────── prompts ─────────────────────────

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

const DEEPDIVE_SYSTEM = `You are a senior buy-side analyst and derivatives strategist. You will be given a
company's LIVE market data (price, fundamentals, 52-week range, valuation, analyst recommendation
trend) and REAL, current news headlines about it pulled live moments ago. Combine this hard data
with the news flow and your market knowledge to produce a rigorous deep-dive with two distinct,
actionable ratings: (1) whether to INVEST in the stock, and (2) whether/how to trade OPTIONS on it.

Ground every claim in the data and headlines provided. Be decisive but honest about uncertainty.

Return ONE JSON object:
{
  "ticker": primary US ticker in caps,
  "company": official company name,
  "summary": 2-3 sentence executive summary of the situation right now,
  "newsSentiment": "positive" | "negative" | "neutral" | "mixed",
  "keyDrivers": 1-2 sentences on what is actually moving the stock now,
  "investment": {
    "rating": "Strong Buy" | "Buy" | "Hold" | "Sell" | "Strong Sell",
    "score": integer 1-100 (higher = more attractive to BUY/own the stock now),
    "conviction": "High" | "Medium" | "Low",
    "horizon": short string (e.g. "6-12 months"),
    "fairValue": short string price or range (e.g. "$300-330") or "N/A",
    "thesis": 1-2 sentence core investment thesis
  },
  "options": {
    "recommendation": one concrete options idea (e.g. "Bull call spread, 30-45 DTE, slightly OTM"),
    "bias": "Calls" | "Puts" | "Straddle" | "Avoid",
    "score": integer 1-100 (higher = more attractive OPTIONS opportunity now),
    "impliedVolatility": "Low" | "Medium" | "High",
    "timeframe": "Weekly" | "Monthly" | "LEAPS",
    "rationale": 1-2 sentence reason grounded in IV/catalysts/news
  },
  "bullCase": array of EXACTLY 3 short strings,
  "bearCase": array of EXACTLY 3 short strings,
  "catalysts": array of 2-4 short strings (upcoming events/triggers to watch),
  "risks": array of 2-4 short strings
}
Return ONLY the JSON object. No markdown, no commentary.`;

const REPORT_SYSTEM = `You are the chief investment strategist on a global macro desk. You will be given REAL,
current world + market headlines (geopolitics, conflict, trade, energy, central banks, technology,
shipping/supply-chain) pulled live moments ago. Read the whole picture like an intelligence analyst
and produce an ACTIONABLE investment brief: connect world events to specific, real, US-listed stocks
(and where relevant ETFs) that benefit or suffer. Be concrete and decisive; name real tickers.

Ground every claim in the provided headlines + your market knowledge. Prefer liquid, well-known names.

Return ONE JSON object:
{
  "headline": one punchy sentence on the current global market situation,
  "marketRegime": "Risk-on" | "Risk-off" | "Mixed" | "Defensive",
  "summary": 2-3 sentence executive brief tying the top world events to market posture,
  "themes": array of up to 4 {
    "theme": short name (e.g. "Middle East energy risk", "AI capex boom", "China trade friction"),
    "drivers": one sentence on what's driving it from the headlines,
    "winners": array of up to 3 { "ticker": US ticker in caps, "why": short phrase },
    "losers": array of up to 3 { "ticker": US ticker in caps, "why": short phrase }
  },
  "topPicks": array of up to 6 MOST ACTIONABLE ideas, best first {
    "ticker": US ticker in caps,
    "company": company name,
    "action": "Buy" | "Watch" | "Avoid" | "Short",
    "conviction": "High" | "Medium" | "Low",
    "rationale": one sentence grounded in a current event,
    "catalyst": the specific event/trigger,
    "timeframe": short string (e.g. "Days", "Weeks", "Months")
  },
  "risks": array of 2-4 short strings (what could break this view),
  "watchEvents": array of 2-5 short strings (upcoming events to watch)
}
Use only real, currently-traded tickers. Return ONLY the JSON object. No markdown, no commentary.`;

// ───────────────────────── fetchers ─────────────────────────

async function fetchIntelNews(env) {
  const headlines = await fetchWorldHeadlines();
  console.log('[news] headlines fetched:', headlines.length);
  const userPrompt =
    `Current time: ${new Date().toUTCString()}.\n\n` +
    `Real, current world & market headlines pulled live moments ago:\n\n${headlineBlock(headlines)}\n\n` +
    `Produce the JSON object now.`;
  const validate = (d) => { const it = Array.isArray(d) ? d : d && d.items; return Array.isArray(it) && it.length > 0; };
  const data = await runAIJson(env, NEWS_SYSTEM, userPrompt, validate);
  const items = Array.isArray(data) ? data : data && data.items;
  if (!Array.isArray(items)) throw new Error('Expected a JSON array of news items.');
  return items.slice(0, 14);
}

async function fetchInvestmentReport(env) {
  const headlines = await fetchWorldHeadlines();
  const userPrompt =
    `Current time: ${new Date().toUTCString()}.\n\n` +
    `Real, current world & market headlines pulled live moments ago:\n\n${headlineBlock(headlines)}\n\n` +
    `Produce the investment brief JSON now.`;
  const data = await runAIJson(env, REPORT_SYSTEM, userPrompt,
    (d) => d && Array.isArray(d.topPicks) && d.topPicks.length > 0 && Array.isArray(d.themes));

  // Attach live quotes to every ticker named in the report.
  const tickers = [...new Set([
    ...(data.topPicks || []).map((p) => p.ticker),
    ...(data.themes || []).flatMap((t) => [...(t.winners || []), ...(t.losers || [])].map((x) => x.ticker)),
  ].map((t) => String(t || '').toUpperCase()).filter((t) => /^[A-Z.]{1,6}$/.test(t)))];
  const quotes = {};
  await Promise.all(tickers.slice(0, 30).map(async (t) => {
    try { const q = await finnhub(env, '/quote', { symbol: t }); if (q && (q.c || q.pc)) quotes[t] = { price: q.c, change: q.d, percent: q.dp }; } catch {}
  }));
  data.quotes = quotes;
  data.asOf = new Date().toISOString();
  return data;
}

async function fetchAnalysis(env) {
  const headlines = await fetchMarketHeadlines();
  const userPrompt =
    `Current time: ${new Date().toUTCString()}.\n\n` +
    `Real, current US market headlines pulled live moments ago:\n\n${headlineBlock(headlines)}\n\n` +
    `Produce the JSON object now.`;
  const data = await runAIJson(env, ANALYSIS_SYSTEM, userPrompt, (d) => d && Array.isArray(d.industries) && d.industries.length >= 8);
  if (!data || !Array.isArray(data.industries)) throw new Error('Expected an object with an industries array.');
  return data;
}

async function fetchCompany(env, query) {
  const headlines = await fetchCompanyHeadlines(query);
  const userPrompt =
    `Current time: ${new Date().toUTCString()}.\n` +
    `Company to analyze: "${query}".\n\n` +
    `Real, current headlines pulled live moments ago:\n\n${headlineBlock(headlines)}\n\n` +
    `Produce the JSON object now.`;
  const data = await runAIJson(env, COMPANY_SYSTEM, userPrompt, (d) => d && Array.isArray(d.news));
  if (!data || !Array.isArray(data.news)) throw new Error('Expected an object with a news array.');
  return data;
}

async function fetchSupplyChain(env, query) {
  let focalName = query;
  let focalTicker = /^[A-Z.]{1,6}$/.test(query) ? query.toUpperCase() : '';
  if (focalTicker) {
    try { const p = await finnhub(env, '/stock/profile2', { symbol: focalTicker }); if (p && p.name) focalName = p.name; } catch {}
  }
  const userPrompt =
    `Company to map: "${focalName}"${focalTicker ? ` (US ticker ${focalTicker})` : ''}.\n` +
    `Produce the supply-chain JSON now.`;
  const data = await runAIJson(env, SUPPLYCHAIN_SYSTEM, userPrompt, (d) => d && (Array.isArray(d.suppliers) || Array.isArray(d.customers)));
  if (!data || (!Array.isArray(data.suppliers) && !Array.isArray(data.customers))) {
    throw new Error('Expected suppliers/customers arrays.');
  }
  data.suppliers = (Array.isArray(data.suppliers) ? data.suppliers : []).slice(0, 8);
  data.customers = (Array.isArray(data.customers) ? data.customers : []).slice(0, 8);
  const focal = (focalTicker || data.ticker || '').toUpperCase();

  let peers = [];
  if (focal) {
    try {
      const list = await finnhub(env, '/stock/peers', { symbol: focal });
      peers = (Array.isArray(list) ? list : [])
        .filter((t) => t && t.toUpperCase() !== focal).slice(0, 6)
        .map((t) => ({ name: '', ticker: t.toUpperCase(), relationship: 'Industry peer', tier: 'peer' }));
    } catch {}
  }

  const all = [...data.suppliers, ...data.customers, ...peers];
  const tickers = [...new Set([focal, ...all.map((x) => (x.ticker || '').toUpperCase())].filter(Boolean))];
  const quotes = {};
  await Promise.all(tickers.map(async (t) => {
    try {
      const q = await finnhub(env, '/quote', { symbol: t });
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

// Deep-dive: combine live Finnhub fundamentals + analyst consensus + current
// headlines, then have the AI pool produce stock + options ratings.
async function fetchDeepDive(env, query) {
  let ticker = /^[A-Z.]{1,6}$/.test(query) ? query.toUpperCase() : '';
  let profile = null;
  if (!ticker) {
    try {
      const s = await finnhub(env, '/search', { q: query });
      const hit = (s.result || []).find((r) => r.symbol && !r.symbol.includes('.'));
      if (hit) ticker = hit.symbol.toUpperCase();
    } catch {}
  }
  if (!ticker) throw new Error('Could not resolve a US-listed ticker for that company.');

  // Pull everything in parallel.
  const [prof, quote, metricData, recs, headlines] = await Promise.all([
    finnhub(env, '/stock/profile2', { symbol: ticker }).catch(() => ({})),
    finnhub(env, '/quote', { symbol: ticker }).catch(() => ({})),
    finnhub(env, '/stock/metric', { symbol: ticker, metric: 'all' }).catch(() => ({})),
    finnhub(env, '/stock/recommendation', { symbol: ticker }).catch(() => []),
    fetchCompanyHeadlines(query || ticker, 16),
  ]);
  profile = prof || {};
  const m = (metricData && metricData.metric) || {};
  const rec = Array.isArray(recs) && recs.length ? recs[0] : null;

  const fmtCap = (v) => (v ? (v >= 1e6 ? `$${(v / 1e6).toFixed(2)}T` : v >= 1e3 ? `$${(v / 1e3).toFixed(1)}B` : `$${v}M`) : 'N/A');
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

  const data = await runAIJson(env, DEEPDIVE_SYSTEM, userPrompt, (d) => d && d.investment && d.options && Array.isArray(d.bullCase));

  // Attach the hard data so the UI can show real numbers next to the AI view.
  data.ticker = ticker;
  data.company = data.company || profile.name || ticker;
  data.quote = (quote && (quote.c || quote.pc)) ? { price: quote.c, change: quote.d, percent: quote.dp } : null;
  data.stats = {
    high52: m['52WeekHigh'] ?? null, low52: m['52WeekLow'] ?? null,
    pe: m.peTTM ?? m.peNormalizedAnnual ?? null, beta: m.beta ?? null,
    marketCap: fmtCap(profile.marketCapitalization), industry: profile.finnhubIndustry || null,
    logo: profile.logo || null,
  };
  data.analystConsensus = rec ? { strongBuy: rec.strongBuy, buy: rec.buy, hold: rec.hold, sell: rec.sell, strongSell: rec.strongSell, period: rec.period } : null;
  return data;
}

// ───────────────────────── GLOBAL MAP layer data ─────────────────────────
// Each fetcher normalizes a free public feed to a flat list of points the
// frontend can plot directly: { lat, lon, ...layer-specific fields }.

// USGS — earthquakes in the last 24h (GeoJSON, no key).
async function fetchQuakes() {
  const res = await fetchWithTimeout('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson', {}, 12000);
  if (!res.ok) throw new Error('USGS ' + res.status);
  const j = await res.json();
  return (j.features || []).map((f) => {
    const c = f.geometry && f.geometry.coordinates;
    const p = f.properties || {};
    if (!c) return null;
    return { lat: c[1], lon: c[0], depth: c[2], mag: p.mag, place: p.place, time: p.time, url: p.url, tsunami: p.tsunami };
  }).filter(Boolean);
}

// NASA EONET v3 — open natural events: wildfires, storms, volcanoes, ice, etc.
async function fetchNaturalEvents() {
  const res = await fetchWithTimeout('https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=300', {}, 12000);
  if (!res.ok) throw new Error('EONET ' + res.status);
  const j = await res.json();
  return (j.events || []).map((e) => {
    const g = e.geometry && e.geometry[e.geometry.length - 1];
    if (!g || !g.coordinates) return null;
    const cat = (e.categories && e.categories[0]) || {};
    // EONET point geometry is [lon, lat]; polygons we skip to a centroid-ish first vertex.
    let lon, lat;
    if (typeof g.coordinates[0] === 'number') { lon = g.coordinates[0]; lat = g.coordinates[1]; }
    else { const flat = g.coordinates.flat(Infinity); lon = flat[0]; lat = flat[1]; }
    if (lat == null || lon == null) return null;
    return { lat, lon, title: e.title, category: cat.id || cat.title, categoryTitle: cat.title, date: g.date, source: (e.sources && e.sources[0] && e.sources[0].url) || e.link };
  }).filter(Boolean);
}

// Live aircraft from adsb.lol — a free community ADS-B feed (no key, and it
// does NOT IP-block Cloudflare like OpenSky does). Takes a viewport bbox, which
// we convert to the center + radius (nm) form adsb.lol expects.
async function fetchFlights(bbox) {
  const [s, w, n, e] = bbox;
  const lat = (s + n) / 2, lon = (w + e) / 2;
  // Great-circle-ish radius to a corner, in nautical miles, capped at adsb.lol's 250.
  const dLat = (n - s) / 2, dLon = (e - w) / 2;
  const km = Math.sqrt((dLat * 111) ** 2 + (dLon * 111 * Math.cos((lat * Math.PI) / 180)) ** 2);
  const dist = Math.min(250, Math.max(25, Math.round(km / 1.852)));
  const url = `https://api.adsb.lol/v2/lat/${lat.toFixed(3)}/lon/${lon.toFixed(3)}/dist/${dist}`;
  const res = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } }, 12000);
  if (!res.ok) throw new Error('adsb.lol ' + res.status);
  const j = await res.json();
  return (j.ac || []).map((a) => ({
    icao: a.hex, callsign: (a.flight || '').trim(), type: a.t, reg: a.r,
    lat: a.lat, lon: a.lon, alt: typeof a.alt_baro === 'number' ? Math.round(a.alt_baro * 0.3048) : null,
    velocity: a.gs != null ? a.gs * 0.514444 : null, heading: a.track != null ? a.track : a.true_heading,
    onGround: a.alt_baro === 'ground',
  })).filter((a) => a.lat != null && a.lon != null && !a.onGround).slice(0, 1500);
}

// US National Weather Service — active alerts (no key; needs a UA).
async function fetchWeatherAlerts() {
  const res = await fetchWithTimeout('https://api.weather.gov/alerts/active?status=actual&limit=250', {
    headers: { 'User-Agent': 'MarketTerminal/1.0 (contact: alerts@market-terminal)', Accept: 'application/geo+json' },
  }, 12000);
  if (!res.ok) throw new Error('NWS ' + res.status);
  const j = await res.json();
  const out = [];
  for (const f of (j.features || [])) {
    const p = f.properties || {};
    let lat, lon;
    const g = f.geometry;
    if (g && g.type === 'Polygon' && g.coordinates) {
      const ring = g.coordinates[0]; let sx = 0, sy = 0;
      for (const pt of ring) { sx += pt[0]; sy += pt[1]; }
      lon = sx / ring.length; lat = sy / ring.length;
    }
    if (lat == null) continue; // skip zone-only alerts without geometry
    out.push({ lat, lon, event: p.event, severity: p.severity, headline: p.headline, area: p.areaDesc, urgency: p.urgency });
  }
  return out;
}

// ───────────────────────── KV-backed SWR cache ─────────────────────────

// An empty payload is never worth serving from cache — treat it as a miss so a
// legacy/transient empty entry self-heals on the next request.
function isEmptyPayload(d) {
  if (!d) return true;
  if (Array.isArray(d)) return d.length === 0;
  if (Array.isArray(d.items)) return d.items.length === 0;
  if (Array.isArray(d.industries)) return d.industries.length === 0;
  return false;
}

async function getData(env, ctx, key, fetcher, ttl = CACHE_MS) {
  const now = Date.now();
  let hit = null;
  try { const raw = await env.MT_KV.get('cache:' + key); if (raw) hit = JSON.parse(raw); } catch {}
  const store = async () => {
    const data = await fetcher();
    await env.MT_KV.put('cache:' + key, JSON.stringify({ data, freshUntil: Date.now() + ttl }), { expirationTtl: Math.max(60, Math.ceil(ttl / 1000) * 2) }).catch(() => {});
    return data;
  };
  if (hit && !isEmptyPayload(hit.data)) {
    if (hit.freshUntil <= now) ctx.waitUntil(store().catch(() => {}));
    return { data: hit.data, fresh: hit.freshUntil > now };
  }
  return { data: await store(), fresh: true }; // miss or empty cache -> fetch fresh
}

// ───────────────────────── web push (WebCrypto) ─────────────────────────

const b64urlToBytes = (s) => {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
const bytesToB64url = (bytes) => {
  let bin = '';
  const b = new Uint8Array(bytes);
  for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const concat = (...arrs) => {
  const total = arrs.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrs) { out.set(a, off); off += a.length; }
  return out;
};
const utf8 = (s) => new TextEncoder().encode(s);

async function hmac(keyBytes, dataBytes) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, dataBytes));
}
// HKDF (RFC 5869) for the short outputs RFC 8291 needs.
async function hkdf(salt, ikm, info, length) {
  const prk = await hmac(salt, ikm);
  const out = await hmac(prk, concat(info, new Uint8Array([1])));
  return out.slice(0, length);
}

// VAPID JWT (ES256), signed with the raw P-256 private scalar + the public key for x/y.
async function vapidJWT(env, audience) {
  const pub = b64urlToBytes(env.VAPID_PUBLIC_KEY); // 65 bytes: 0x04 || X || Y
  const jwk = {
    kty: 'EC', crv: 'P-256',
    d: env.VAPID_PRIVATE_KEY.replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_'),
    x: bytesToB64url(pub.slice(1, 33)),
    y: bytesToB64url(pub.slice(33, 65)),
    ext: true,
  };
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const header = bytesToB64url(utf8(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = bytesToB64url(utf8(JSON.stringify({
    aud: audience, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT || 'mailto:alerts@example.com',
  })));
  const signingInput = utf8(`${header}.${payload}`);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, signingInput));
  return `${header}.${payload}.${bytesToB64url(sig)}`;
}

// Encrypt + POST one notification (RFC 8291 aes128gcm). Returns the upstream status.
async function pushOne(env, sub, payloadStr) {
  const endpoint = sub.endpoint;
  const audience = new URL(endpoint).origin;
  const uaPublic = b64urlToBytes(sub.keys.p256dh); // 65 bytes
  const authSecret = b64urlToBytes(sub.keys.auth); // 16 bytes

  // Ephemeral ECDH keypair (the "as" / application server key).
  const asKeys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', asKeys.publicKey)); // 65 bytes
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, asKeys.privateKey, 256));

  // RFC 8291 key derivation.
  const ikmInfo = concat(utf8('WebPush: info\0'), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdh, ikmInfo, 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, utf8('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, utf8('Content-Encoding: nonce\0'), 12);

  // Plaintext + 0x02 delimiter (single record), AES-128-GCM.
  const plaintext = concat(utf8(payloadStr), new Uint8Array([2]));
  const aesKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aesKey, plaintext));

  // aes128gcm content-coding header: salt(16) || rs(4) || idlen(1) || keyid(asPublic).
  const rs = new Uint8Array([0, 0, 16, 0]); // 4096
  const idlen = new Uint8Array([asPublic.length]);
  const body = concat(salt, rs, idlen, asPublic, ciphertext);

  const jwt = await vapidJWT(env, audience);
  return fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '86400',
      Urgency: 'high',
    },
    body,
  }, 12000);
}

const pushEnabled = (env) => Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);

async function listSubs(env) {
  const subs = [];
  let cursor;
  do {
    const res = await env.MT_KV.list({ prefix: 'sub:', cursor });
    for (const k of res.keys) {
      const raw = await env.MT_KV.get(k.name);
      if (raw) try { subs.push(JSON.parse(raw)); } catch {}
    }
    cursor = res.list_complete ? null : res.cursor;
  } while (cursor);
  return subs;
}
const subKey = async (endpoint) => {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(endpoint)));
  return 'sub:' + bytesToB64url(h).slice(0, 32);
};

async function sendPush(env, payload, opts = {}) {
  if (!pushEnabled(env)) return opts.diag ? { sent: 0, results: [{ error: 'push disabled (no VAPID keys)' }] } : 0;
  const subs = await listSubs(env);
  if (!subs.length) return opts.diag ? { sent: 0, results: [] } : 0;
  const body = JSON.stringify(payload);
  let sent = 0;
  const results = [];
  await Promise.all(subs.map(async (sub) => {
    const host = (() => { try { return new URL(sub.endpoint).host; } catch { return '?'; } })();
    try {
      const res = await pushOne(env, sub, body);
      if (res.ok || res.status === 201) sent++;
      let rbody = '';
      if (opts.diag && !(res.ok || res.status === 201)) rbody = (await res.text().catch(() => '')).slice(0, 200);
      results.push({ host, status: res.status, body: rbody });
      // Purge dead subscriptions (but not while diagnosing, so we can inspect).
      if (!opts.diag && (res.status === 404 || res.status === 410)) await env.MT_KV.delete(await subKey(sub.endpoint));
    } catch (e) {
      results.push({ host, error: String(e && e.message).slice(0, 200) });
    }
  }));
  return opts.diag ? { sent, results } : sent;
}

// ───────────────────────── breaking-alert detection ─────────────────────────

const MAX_ALERTS = 40;
const alertKey = (item) => String(item.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 80);
const toAlert = (item) => ({
  id: alertKey(item), title: item.title || '', summary: item.summary || '', detail: item.detail || '',
  category: item.category || 'macro', source: item.source || '', marketImpact: item.marketImpact || '',
  tickers: Array.isArray(item.tickers) ? item.tickers : [],
  watchUrl: typeof item.watchUrl === 'string' ? item.watchUrl : '',
  timestamp: item.timestamp || new Date().toISOString(),
});

async function detectAlerts(env, items) {
  if (!Array.isArray(items)) return;
  let state = { seen: [], recent: [], primed: false };
  try { const raw = await env.MT_KV.get('alerts:state'); if (raw) state = JSON.parse(raw); } catch {}
  const seenSet = new Set(state.seen);
  const fresh = [];
  for (const item of items) {
    if (!item || item.priority !== 'high' || !item.title) continue;
    const key = alertKey(item);
    if (!key || seenSet.has(key)) continue;
    seenSet.add(key);
    fresh.push(item);
  }
  if (!fresh.length) return;
  state.recent = [...fresh.map(toAlert), ...state.recent].slice(0, MAX_ALERTS);
  state.seen = [...seenSet].slice(-300);
  const wasPrimed = state.primed;
  state.primed = true;
  await env.MT_KV.put('alerts:state', JSON.stringify(state)).catch(() => {});
  if (!wasPrimed) return; // baseline pass — don't blast pre-existing news
  for (const item of fresh) {
    const alert = toAlert(item);
    await sendPush(env, {
      title: (alert.watchUrl ? '🔴 LIVE · ' : '🚨 ') + alert.title,
      body: alert.summary || alert.marketImpact || '',
      url: '/?tab=alerts', watchUrl: alert.watchUrl, tag: alert.id,
    });
  }
}

async function fetchNewsAndDetect(env, ctx) {
  const items = await fetchIntelNews(env);
  ctx.waitUntil(detectAlerts(env, items).catch(() => {}));
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

// ───────────────────────── router ─────────────────────────

async function handleApi(request, env, ctx, url) {
  const p = url.pathname;
  const qs = url.searchParams;
  const sym = () => (qs.get('symbol') || '').toUpperCase();

  // --- Live ship AIS stream: proxy the browser <-> aisstream.io, injecting the
  // API key server-side so it never reaches the client. The browser sends its
  // subscription (bounding boxes / filters); we add the key and forward. ---
  if (p === '/api/ships/stream') {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected websocket', { status: 426 });
    if (!env.AISSTREAM_API_KEY) return new Response('AIS not configured', { status: 503 });

    const pair = new WebSocketPair();
    const client = pair[0], server = pair[1];
    server.accept();

    let upstream = null;
    let lastSub = null;
    let closed = false;
    const closeAll = () => { closed = true; try { upstream && upstream.close(); } catch {} try { server.close(); } catch {} };

    // Connect to aisstream.io (Cloudflare outbound WS via fetch upgrade).
    (async () => {
      try {
        const resp = await fetch('https://stream.aisstream.io/v0/stream', { headers: { Upgrade: 'websocket' } });
        upstream = resp.webSocket;
        if (!upstream) { server.send(JSON.stringify({ error: 'AIS upstream unavailable' })); return closeAll(); }
        upstream.accept();
        upstream.addEventListener('message', (e) => { if (!closed) try { server.send(e.data); } catch {} });
        upstream.addEventListener('close', () => closeAll());
        upstream.addEventListener('error', () => closeAll());
        if (lastSub) upstream.send(JSON.stringify(lastSub)); // replay sub that arrived early
      } catch { try { server.send(JSON.stringify({ error: 'AIS connect failed' })); } catch {} closeAll(); }
    })();

    // Client -> upstream: inject the API key into every subscription message.
    server.addEventListener('message', (e) => {
      let msg; try { msg = JSON.parse(e.data); } catch { return; }
      msg.APIKey = env.AISSTREAM_API_KEY;
      lastSub = msg;
      if (upstream) try { upstream.send(JSON.stringify(msg)); } catch {}
    });
    server.addEventListener('close', () => closeAll());
    server.addEventListener('error', () => closeAll());

    return new Response(null, { status: 101, webSocket: client });
  }

  // --- GLOBAL MAP layers (free public feeds, normalized + cached) ---
  if (p === '/api/map/earthquakes') {
    try { const { data, fresh } = await getData(env, ctx, 'map:quakes', fetchQuakes); return json({ cached: !fresh, points: data }); }
    catch (err) { return json({ error: true, message: friendlyError(err) }, 502); }
  }
  if (p === '/api/map/events') {
    try { const { data, fresh } = await getData(env, ctx, 'map:events', fetchNaturalEvents); return json({ cached: !fresh, points: data }); }
    catch (err) { return json({ error: true, message: friendlyError(err) }, 502); }
  }
  if (p === '/api/map/weather') {
    try { const { data, fresh } = await getData(env, ctx, 'map:weather', fetchWeatherAlerts); return json({ cached: !fresh, points: data }); }
    catch (err) { return json({ error: true, message: friendlyError(err) }, 502); }
  }
  if (p === '/api/map/flights') {
    // Live aircraft are viewport-scoped and change fast — short cache keyed by bbox.
    const b = (qs.get('bbox') || '-10,-10,60,40').split(',').map(Number);
    if (b.length !== 4 || b.some(Number.isNaN)) return json({ error: true, message: 'bad bbox' }, 400);
    try {
      const key = 'map:flights:' + b.map((x) => x.toFixed(1)).join('_');
      const { data, fresh } = await getData(env, ctx, key, () => fetchFlights(b), 30 * 1000);
      return json({ cached: !fresh, points: data });
    } catch (err) { return json({ error: true, message: friendlyError(err) }, 502); }
  }

  // --- Terminal (Finnhub) ---
  if (p === '/api/quote') {
    if (!env.FINNHUB_API_KEY) return json({ error: 'Server is missing FINNHUB_API_KEY.' }, 500);
    if (!sym()) return json({ error: 'symbol is required' }, 400);
    return json(await finnhub(env, '/quote', { symbol: sym() }));
  }
  if (p === '/api/profile') {
    if (!sym()) return json({ error: 'symbol is required' }, 400);
    return json(await finnhub(env, '/stock/profile2', { symbol: sym() }));
  }
  if (p === '/api/metrics') {
    if (!sym()) return json({ error: 'symbol is required' }, 400);
    const data = await finnhub(env, '/stock/metric', { symbol: sym(), metric: 'all' });
    const m = (data && data.metric) || {};
    return json({ high52: m['52WeekHigh'] ?? null, low52: m['52WeekLow'] ?? null, pe: m.peTTM ?? m.peNormalizedAnnual ?? m.peBasicExclExtraTTM ?? null });
  }
  if (p === '/api/news') {
    if (!sym()) return json({ error: 'symbol is required' }, 400);
    const items = await finnhub(env, '/company-news', { symbol: sym(), from: isoDaysAgo(30), to: isoDaysAgo(0) });
    const list = Array.isArray(items) ? items : [];
    return json(list.slice(0, 15).map((n) => ({ headline: n.headline, source: n.source, url: n.url, datetime: n.datetime, summary: n.summary, image: n.image })));
  }
  if (p === '/api/search') {
    const q = (qs.get('q') || '').trim();
    if (!q) return json({ result: [] });
    const data = await finnhub(env, '/search', { q });
    const result = (data && Array.isArray(data.result) ? data.result : [])
      .filter((r) => r.symbol && !r.symbol.includes('.')).slice(0, 12)
      .map((r) => ({ description: r.description, displaySymbol: r.displaySymbol, symbol: r.symbol, type: r.type }));
    return json({ result });
  }
  if (p === '/api/ticker') {
    const basket = ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA'];
    const results = await Promise.all(basket.map(async (symbol) => {
      try { const q = await finnhub(env, '/quote', { symbol }); return { symbol, price: q.c ?? 0, change: q.d ?? 0, percent: q.dp ?? 0 }; }
      catch { return { symbol, price: 0, change: 0, percent: 0 }; }
    }));
    return json(results);
  }
  if (p === '/api/chart') {
    if (!sym()) return json({ error: 'symbol is required' }, 400);
    const rangeKey = (qs.get('range') || '1D').toUpperCase();
    if (!YAHOO_RANGE[rangeKey]) return json({ error: 'invalid range' }, 400);
    return json(await getChart(env, ctx, sym(), rangeKey));
  }

  // --- Intelligence (Groq) ---
  if (p === '/api/intel/news') {
    try {
      if (qs.get('nocache')) { const items = await fetchNewsAndDetect(env, ctx); return json({ cached: false, items }); }
      const { data, fresh } = await getData(env, ctx, 'news', () => fetchNewsAndDetect(env, ctx)); return json({ cached: !fresh, items: data });
    } catch (err) { return json({ error: true, message: friendlyError(err) }, 500); }
  }
  if (p === '/api/intel/analysis') {
    try { const { data, fresh } = await getData(env, ctx, 'analysis', () => fetchAnalysis(env)); return json({ cached: !fresh, ...data }); }
    catch (err) { return json({ error: true, message: friendlyError(err) }, 500); }
  }
  if (p === '/api/intel/company') {
    const query = (qs.get('q') || '').trim().slice(0, 60);
    if (!query) return json({ error: true, message: 'Missing company name or ticker.' }, 400);
    try { const { data, fresh } = await getData(env, ctx, 'company:' + query.toLowerCase(), () => fetchCompany(env, query)); return json({ cached: !fresh, ...data }); }
    catch (err) { return json({ error: true, message: friendlyError(err) }, 500); }
  }
  if (p === '/api/intel/supplychain') {
    const query = (qs.get('q') || '').trim().slice(0, 60);
    if (!query) return json({ error: true, message: 'Missing company name or ticker.' }, 400);
    try { const { data, fresh } = await getData(env, ctx, 'supplychain:' + query.toLowerCase(), () => fetchSupplyChain(env, query)); return json({ cached: !fresh, ...data }); }
    catch (err) { return json({ error: true, message: friendlyError(err) }, 500); }
  }
  if (p === '/api/intel/deepdive') {
    const query = (qs.get('q') || '').trim().slice(0, 60);
    if (!query) return json({ error: true, message: 'Missing company name or ticker.' }, 400);
    try { const { data, fresh } = await getData(env, ctx, 'deepdive:' + query.toLowerCase(), () => fetchDeepDive(env, query)); return json({ cached: !fresh, ...data }); }
    catch (err) { return json({ error: true, message: friendlyError(err) }, 500); }
  }
  if (p === '/api/intel/report') {
    try { const { data, fresh } = await getData(env, ctx, 'report', () => fetchInvestmentReport(env)); return json({ cached: !fresh, ...data }); }
    catch (err) { return json({ error: true, message: friendlyError(err) }, 500); }
  }
  if (p === '/api/ai-status') {
    const pool = providerPool(env);
    const cd = await readCooldowns(env);
    const now = Date.now();
    return json({
      providers: pool.map((pv) => ({
        name: pv.name,
        cooling: Boolean(cd[pv.name] && cd[pv.name] > now),
        cooldownSecs: cd[pv.name] && cd[pv.name] > now ? Math.round((cd[pv.name] - now) / 1000) : 0,
      })),
      active: pool.length,
    });
  }
  if (p === '/api/intel/alerts') {
    let recent = [];
    try { const raw = await env.MT_KV.get('alerts:state'); if (raw) recent = JSON.parse(raw).recent || []; } catch {}
    return json({ enabled: pushEnabled(env), alerts: recent });
  }

  // --- Push ---
  if (p === '/api/vapid-public-key') return json({ key: env.VAPID_PUBLIC_KEY || '', enabled: pushEnabled(env) });
  if (p === '/api/subscribe' && request.method === 'POST') {
    const b = await request.json().catch(() => ({}));
    const sub = b && b.endpoint ? b : b && b.subscription;
    if (!sub || !sub.endpoint || !sub.keys) return json({ error: true, message: 'Invalid subscription.' }, 400);
    await env.MT_KV.put(await subKey(sub.endpoint), JSON.stringify(sub));
    return json({ ok: true });
  }
  if (p === '/api/unsubscribe' && request.method === 'POST') {
    const b = await request.json().catch(() => ({}));
    const endpoint = b && (b.endpoint || (b.subscription && b.subscription.endpoint));
    if (endpoint) await env.MT_KV.delete(await subKey(endpoint));
    return json({ ok: true });
  }
  if (p === '/api/test-push' && request.method === 'POST') {
    const diag = await sendPush(env, { title: '✅ Alerts are on', body: 'You’ll get a notification here when major market news breaks.', url: '/?tab=alerts' }, { diag: true });
    return json({ ok: true, devices: diag.sent, results: diag.results });
  }

  return json({ error: 'Not found' }, 404);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        return await handleApi(request, env, ctx, url);
      } catch (err) {
        return json({ error: (err && err.message) || 'Upstream request failed' }, 502);
      }
    }
    // Everything else -> static assets (SPA fallback handled by [assets] config).
    return env.ASSETS.fetch(request);
  },

  // Hourly cron: refresh the news cache and push any new breaking alerts.
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      try {
        const items = await fetchIntelNews(env);
        await env.MT_KV.put('cache:news', JSON.stringify({ data: items, freshUntil: Date.now() + CACHE_MS })).catch(() => {});
        await detectAlerts(env, items);
      } catch (e) { /* swallow — next tick retries */ }
    })());
  },
};
