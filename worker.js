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
const CACHE_MS = 15 * 60 * 1000; // news refreshes every 15 min
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

// Round-robin across up to 5 Finnhub keys (FINNHUB_API_KEY … FINNHUB_API_KEY_5).
// More keys = more rate-limit headroom at zero extra cost.
let _fhKeyIdx = 0;
function pickFinnhubKey(env) {
  const keys = [
    env.FINNHUB_API_KEY,
    env.FINNHUB_API_KEY_2,
    env.FINNHUB_API_KEY_3,
    env.FINNHUB_API_KEY_4,
    env.FINNHUB_API_KEY_5,
  ].filter(Boolean);
  if (!keys.length) return '';
  return keys[_fhKeyIdx++ % keys.length];
}

async function finnhub(env, endpoint, params = {}) {
  const url = new URL(FINNHUB_BASE + endpoint);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  }
  url.searchParams.set('token', pickFinnhubKey(env));
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (res.status === 429) throw new Error('Rate limit reached (Finnhub free tier). Wait a moment and retry.');
  if (!res.ok) throw new Error(`Finnhub responded ${res.status} for ${endpoint}`);
  return res.json();
}

// ───────────────────── market-data quote pool ─────────────────────
// Up to 5 Finnhub keys + 5 third-party providers (Twelve Data, FMP, Alpha
// Vantage, Polygon, Yahoo). Each is a { name, fn } entry; getQuotePooled
// tries them in order and returns the first real price. Yahoo is a keyless
// fallback always at the end. All fns return the canonical shape or null:
//   { c, d, dp, h, l, o, pc, src }
const qnum = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };

// ── Finnhub: one pool entry per key present ──
const _makeFhQuoter = (keyName, label) => async (env, sym) => {
  const key = env[keyName]; if (!key) return null;
  const r = await fetchWithTimeout(`${FINNHUB_BASE}/quote?symbol=${encodeURIComponent(sym)}&token=${key}`, { headers: { Accept: 'application/json' } }, 8000);
  if (r.status === 429) throw new Error(`${label} rate limited`);
  if (!r.ok) return null;
  const q = await r.json();
  if (!q || (!q.c && !q.pc)) return null;
  return { c: q.c, d: q.d, dp: q.dp, h: q.h, l: q.l, o: q.o, pc: q.pc, src: label };
};
const _fhQ1 = _makeFhQuoter('FINNHUB_API_KEY',   'finnhub');
const _fhQ2 = _makeFhQuoter('FINNHUB_API_KEY_2',  'finnhub2');
const _fhQ3 = _makeFhQuoter('FINNHUB_API_KEY_3',  'finnhub3');
const _fhQ4 = _makeFhQuoter('FINNHUB_API_KEY_4',  'finnhub4');
const _fhQ5 = _makeFhQuoter('FINNHUB_API_KEY_5',  'finnhub5');

// ── Third-party providers ──
async function _quoteTwelve(env, sym) {
  if (!env.TWELVEDATA_KEY) return null;
  const r = await fetchWithTimeout(`https://api.twelvedata.com/quote?symbol=${encodeURIComponent(sym)}&apikey=${env.TWELVEDATA_KEY}`, {}, 10000);
  const j = await r.json();
  if (!j || j.status === 'error' || j.close == null) return null;
  const c = qnum(j.close), pc = qnum(j.previous_close);
  return { c, d: qnum(j.change), dp: qnum(j.percent_change), h: qnum(j.high), l: qnum(j.low), o: qnum(j.open), pc, src: 'twelvedata' };
}
async function _quoteFMP(env, sym) {
  if (!env.FMP_KEY) return null;
  const r = await fetchWithTimeout(`https://financialmodelingprep.com/api/v3/quote/${encodeURIComponent(sym)}?apikey=${env.FMP_KEY}`, {}, 10000);
  const j = await r.json();
  const q = Array.isArray(j) && j[0];
  if (!q || q.price == null) return null;
  return { c: qnum(q.price), d: qnum(q.change), dp: qnum(q.changesPercentage), h: qnum(q.dayHigh), l: qnum(q.dayLow), o: qnum(q.open), pc: qnum(q.previousClose), src: 'fmp' };
}
async function _quoteAlpha(env, sym) {
  if (!env.ALPHAVANTAGE_KEY) return null;
  const r = await fetchWithTimeout(`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(sym)}&apikey=${env.ALPHAVANTAGE_KEY}`, {}, 10000);
  const j = await r.json();
  const q = j && j['Global Quote'];
  if (!q || !q['05. price']) return null;
  return { c: qnum(q['05. price']), d: qnum(q['09. change']), dp: qnum((q['10. change percent'] || '').replace('%', '')), h: qnum(q['03. high']), l: qnum(q['04. low']), o: qnum(q['02. open']), pc: qnum(q['08. previous close']), src: 'alphavantage' };
}
async function _quotePolygon(env, sym) {
  if (!env.POLYGON_KEY) return null;
  const r = await fetchWithTimeout(`https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers/${encodeURIComponent(sym)}?apiKey=${env.POLYGON_KEY}`, {}, 10000);
  if (!r.ok) return null;
  const j = await r.json();
  const t = j && j.ticker; if (!t) return null;
  const day = t.day || {}, prev = t.prevDay || {};
  const c = (t.lastTrade && t.lastTrade.p) || day.c; if (!c) return null;
  const pc = prev.c || null;
  return { c, d: pc ? c - pc : qnum(t.todaysChange), dp: pc ? ((c - pc) / pc) * 100 : qnum(t.todaysChangePerc), h: day.h || c, l: day.l || c, o: day.o || c, pc, src: 'polygon' };
}
async function _quoteYahoo(_env, sym) {
  try {
    const r = await fetchWithTimeout(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=1d&interval=1m&includePrePost=false`, { headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json' } }, 9000);
    if (!r.ok) return null;
    const j = await r.json();
    const meta = j?.chart?.result?.[0]?.meta; if (!meta || !meta.regularMarketPrice) return null;
    const c = meta.regularMarketPrice, pc = meta.chartPreviousClose || meta.previousClose || null;
    return { c, d: pc ? c - pc : null, dp: pc ? ((c - pc) / pc) * 100 : null, h: meta.regularMarketDayHigh || c, l: meta.regularMarketDayLow || c, o: meta.regularMarketOpen || c, pc, src: 'yahoo' };
  } catch { return null; }
}

function quotePool(env) {
  const pool = [];
  if (env.FINNHUB_API_KEY)   pool.push({ name: 'finnhub',      fn: _fhQ1 });
  if (env.FINNHUB_API_KEY_2) pool.push({ name: 'finnhub2',     fn: _fhQ2 });
  if (env.FINNHUB_API_KEY_3) pool.push({ name: 'finnhub3',     fn: _fhQ3 });
  if (env.FINNHUB_API_KEY_4) pool.push({ name: 'finnhub4',     fn: _fhQ4 });
  if (env.FINNHUB_API_KEY_5) pool.push({ name: 'finnhub5',     fn: _fhQ5 });
  if (env.TWELVEDATA_KEY)    pool.push({ name: 'twelvedata',   fn: _quoteTwelve });
  if (env.FMP_KEY)           pool.push({ name: 'fmp',          fn: _quoteFMP });
  if (env.ALPHAVANTAGE_KEY)  pool.push({ name: 'alphavantage', fn: _quoteAlpha });
  if (env.POLYGON_KEY)       pool.push({ name: 'polygon',      fn: _quotePolygon });
  pool.push({ name: 'yahoo', fn: _quoteYahoo });
  return pool;
}
async function getQuotePooled(env, sym) {
  let lastErr;
  for (const { fn } of quotePool(env)) {
    try { const q = await fn(env, sym); if (q) return q; } catch (e) { lastErr = e; }
  }
  if (lastErr) throw lastErr;
  return { c: 0, d: 0, dp: 0, h: 0, l: 0, o: 0, pc: 0, src: 'none' };
}

// In-isolate micro-cache for quotes. The terminal polls every ~2s for a live
// feel; without this, fast polling exhausts the free quote providers (they start
// returning nulls) and the displayed price jitters as the pool fails over between
// providers that disagree by a few cents. Caching the first good quote for a few
// seconds coalesces the burst onto one provider and one stable price.
const _quoteMemo = new Map(); // sym -> { data, exp }
const QUOTE_MEMO_MS = 3000;
async function getQuoteCached(env, sym) {
  const now = Date.now();
  const hit = _quoteMemo.get(sym);
  if (hit && hit.exp > now) return hit.data;
  const data = await getQuotePooled(env, sym);
  // Only cache a usable quote — never let a transient all-providers-failed null
  // stick around and blank the price for the next few seconds.
  if (data && data.c) _quoteMemo.set(sym, { data, exp: now + QUOTE_MEMO_MS });
  return data;
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
  const q = result.indicators?.quote?.[0] || {};
  const closes = q.close || [];
  const opens = q.open || [], highs = q.high || [], lows = q.low || [];
  const meta = result.meta || {};
  const points = [];
  for (let i = 0; i < timestamps.length; i++) {
    const c = closes[i];
    if (c === null || c === undefined || Number.isNaN(c)) continue;
    // Include OHLC so the frontend can render candlesticks (falls back to close).
    const o = opens[i], h = highs[i], l = lows[i];
    points.push({ t: timestamps[i] * 1000, c, o: o ?? c, h: h ?? c, l: l ?? c });
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

// Nasdaq's intraday chart "x" field is actually the ET wall-clock time
// mis-encoded as a UTC epoch (e.g. x=...04:00:00Z while z.dateTime says
// "4:00 AM ET") — so any browser outside UTC sees the chart time-shifted.
// Correct it back to a true UTC ms using the real US-Eastern offset for today.
function etOffsetMinutes(date) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'shortOffset' }).formatToParts(date);
  const tz = (parts.find((p) => p.type === 'timeZoneName') || {}).value || 'GMT-5';
  const m = tz.match(/GMT([+-]\d+)/);
  return m ? -parseInt(m[1], 10) * 60 : 300; // minutes ET is BEHIND UTC (240 EDT / 300 EST)
}

async function chartFromNasdaq(symbol, rangeKey) {
  if (rangeKey === '1D') {
    const url = `https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/chart?assetclass=stocks`;
    const res = await fetchWithTimeout(url, { headers: NASDAQ_HEADERS }, 12000);
    if (!res.ok) throw new Error(`Nasdaq responded ${res.status}`);
    const data = await res.json();
    const rows = data?.data?.chart || [];
    const offMs = etOffsetMinutes(new Date()) * 60000;
    const points = rows.filter((r) => r && r.y != null).map((r) => ({ t: r.x + offMs, c: Number(r.y) }));
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
    .map((r) => { const c = num(r.close); return { t: toMs(r.date), c, o: r.open != null ? num(r.open) : c, h: r.high != null ? num(r.high) : c, l: r.low != null ? num(r.low) : c }; })
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

function mergeHeadlines(lists, maxAgeMins = 72 * 60) {
  const seen = new Set();
  const all = [];
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
  // Newest first.
  all.sort((a, b) => b._ms - a._ms);
  // Prefer items within the window; fall back to all if fewer than 10 pass (slow news day / weekend).
  const fresh = all.filter((h) => h._ms === 0 || h._ms >= cutoff);
  return fresh.length >= 10 ? fresh : all;
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
  'https://www.bing.com/news/search?q=stocks+earnings+markets&format=rss',
];

// World / geopolitical / energy / shipping feeds for the GLOBAL INTEL desk.
// Bing News RSS gives Google-News-style aggregation + topic search and — unlike
// Google News, which 503s every datacenter IP and exposes no CORS — it actually
// serves the Cloudflare edge, so it's our stand-in for "Google News".
const WORLD_FEEDS = [
  'https://feeds.bbci.co.uk/news/world/rss.xml',
  'https://feeds.bbci.co.uk/news/business/rss.xml',
  'https://www.aljazeera.com/xml/rss/all.xml',
  'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100727362', // energy
  'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=15839135', // politics
  'https://www.bing.com/news/search?q=stock+market&format=rss',
  'https://www.bing.com/news/search?q=geopolitics+conflict&format=rss',
  'https://www.bing.com/news/search?q=federal+reserve+economy&format=rss',
  'https://www.bing.com/news/search?q=oil+energy+markets&format=rss',
];

// X / Twitter — high-signal financial & news accounts, pulled from the public
// syndication/embed endpoint (the same one X itself serves to render embedded
// timeline widgets anywhere on the web — no API key, no login). Public Nitter
// mirrors stopped serving RSS once X locked them out; this is the unauthenticated
// path that's left. Source tagged as "X/@handle" so the AI and display attribute it.
const X_ACCOUNTS = [
  'WSJmarkets',       // Wall Street Journal markets desk
  'markets',          // Bloomberg Markets
  'unusual_whales',   // options flow / market intel
  'DeItaone',         // breaking financial headlines
  'zerohedge',        // macro / contrarian finance
  'Reuters',          // global news wire
  'APNews',           // Associated Press
  'FederalReserve',   // Fed statements
  'SECGov',           // SEC filings / enforcement
  'IMFNews',          // IMF global outlook
  'RayDalio',         // macro investor commentary
  'elonmusk',         // market-moving tweets
  'GoldmanSachs',     // GS research
  'elerianm',         // Mohamed El-Erian macro
  'NickTimiraos',     // WSJ Fed reporter
];

// Tweet text always ends with a t.co link back to itself/its media — strip that
// and flatten newlines so it reads like a headline.
function cleanTweetText(text) {
  return (text || '').replace(/https:\/\/t\.co\/\w+\s*$/, '').replace(/\s+/g, ' ').trim();
}

async function fetchXAccountFeed(account) {
  try {
    const res = await fetchWithTimeout(
      `https://syndication.twitter.com/srv/timeline-profile/screen-name/${account}`,
      { headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html' } },
      8000,
    );
    if (!res.ok) return [];
    const html = await res.text();
    const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!m) return [];
    const entries = JSON.parse(m[1])?.props?.pageProps?.timeline?.entries || [];
    return entries
      .map((e) => e && e.content && e.content.tweet)
      .filter(Boolean)
      .map((t) => ({ title: cleanTweetText(t.full_text || t.text), source: `X/@${account}`, published: t.created_at || '' }))
      .filter((h) => h.title);
  } catch { return []; }
}

async function fetchXHeadlines() {
  // The syndication endpoint rate-limits per a small shared budget (~30
  // requests per window) that a dead-simultaneous burst of 15 trips even when
  // comfortably under budget — stagger the starts so they land as a trickle
  // instead. Any account that still fails or comes back empty is just skipped.
  const lists = await Promise.all(X_ACCOUNTS.map((account, i) => sleep(i * 400).then(() => fetchXAccountFeed(account))));
  return mergeHeadlines(lists);
}

async function fetchMarketHeadlines() {
  const lists = await Promise.all(MARKET_FEEDS.map((u) => fetchFeed(u, 18)));
  return mergeHeadlines(lists).slice(0, 32);
}

// Wider net: market + world headlines for GLOBAL INTEL & the report.
async function fetchWorldHeadlines() {
  const lists = await Promise.all([...MARKET_FEEDS, ...WORLD_FEEDS].map((u) => fetchFeed(u, 14)).concat([fetchXHeadlines()]));
  return mergeHeadlines(lists).slice(0, 60);
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
  if (env.DEEPSEEK_API_KEY)
    pool.push({ name: 'deepseek', call: deepseekCall });
  if (env.COHERE_API_KEY)
    pool.push({ name: 'cohere', call: cohereCall });
  if (env.AI21_API_KEY)
    pool.push({ name: 'ai21', call: ai21Call });
  if (env.OCTOAI_API_KEY)
    pool.push({ name: 'octoai', call: octoadiCall });
  return pool;
}

// How many AI providers to race simultaneously per task (override with AI_PARALLEL).
const raceWidth = (env) => Math.max(2, parseInt(env.AI_PARALLEL || '5', 10) || 5);

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
  "watchUrl": "" (always leave empty — the app finds any live stream itself),
  "timestamp": ISO 8601 datetime string — copy EXACTLY from the headline's publication time; do NOT use "now" unless the source truly has no timestamp
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
identify ALL significant real-world suppliers (vendors it buys parts, components, services or inputs from)
and customers (companies that buy or resell its products/services) — include both public AND private companies,
domestic AND international. Use well-established, factual relationships from your knowledge.

Return ONE JSON object:
{
  "company": official company name,
  "ticker": the company's primary US-listed stock ticker in caps (or "" if not US-listed / private),
  "summary": one sentence on the company's position in its supply chain,
  "suppliers": array of ALL significant suppliers, MOST IMPORTANT FIRST, each {
    "name": company name,
    "ticker": US stock ticker in caps if publicly listed, or "" if private or foreign-only,
    "relationship": short phrase naming what it supplies (e.g. "Chip fabrication", "Seats & interiors"),
    "tier": "key" | "major" | "minor"
  },
  "customers": array of ALL significant customers, MOST IMPORTANT FIRST, same shape (relationship = what they buy / use it for)
}
Include private companies (e.g. Foxconn, Koch Industries, Cargill) and foreign-listed ones — just leave ticker "".
Give real tickers only for US-listed companies; never invent a ticker. Omit a relationship rather than invent a fake one.
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

const INSTABILITY_SYSTEM = `You are a geopolitical risk analyst. From REAL, current world headlines pulled live moments ago,
score the instability of the most newsworthy countries RIGHT NOW. Consider conflict, political crisis,
economic stress, civil unrest, sanctions and disaster signals. Be decisive and grounded in the headlines.

Return ONE JSON object:
{
  "countries": array of 12-22 countries, MOST UNSTABLE FIRST, each {
    "country": name,
    "lat": approximate country-centroid latitude (number),
    "lon": approximate country-centroid longitude (number),
    "score": integer 0-100 instability (100 = active war / state collapse),
    "trend": "rising" | "stable" | "easing",
    "drivers": one short phrase on the main driver from the headlines,
    "marketAngle": one short phrase on the market/investment implication (commodity, FX, equities, defense, energy)
  }
}
Use real country centroids (approximate is fine). Return ONLY the JSON object. No markdown, no commentary.`;

// ────────── More AI providers (DeepSeek, Cohere, AI21, OctoAI) ──────────
async function deepseekCall(env, sys, usr) {
  if (!env.DEEPSEEK_API_KEY) throw new Error('DeepSeek key not set');
  const res = await fetchWithTimeout('https://api.deepseek.com/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.DEEPSEEK_API_KEY}` },
    body: JSON.stringify({ model: 'deepseek-chat', messages: [{ role: 'system', content: sys }, { role: 'user', content: usr }], temperature: 0.7, max_tokens: 2000 }),
  }, 25000);
  const j = await res.json();
  if (j.error) throw new Error('DeepSeek: ' + (j.error.message || JSON.stringify(j.error)));
  const c = j.choices && j.choices[0];
  if (!c) throw new Error('DeepSeek: no choice');
  return { text: c.message.content || '', usage: j.usage };
}
async function cohereCall(env, sys, usr) {
  if (!env.COHERE_API_KEY) throw new Error('Cohere key not set');
  const res = await fetchWithTimeout('https://api.cohere.ai/v2/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.COHERE_API_KEY}` },
    body: JSON.stringify({ model: 'command-r-plus', messages: [{ role: 'user', content: usr }], temperature: 0.7 }),
  }, 25000);
  const j = await res.json();
  if (j.error) throw new Error('Cohere: ' + (j.error.message || JSON.stringify(j.error)));
  return { text: j.text || '', usage: { input_tokens: j.usage?.input_tokens || 0 } };
}
async function ai21Call(env, sys, usr) {
  if (!env.AI21_API_KEY) throw new Error('AI21 key not set');
  const res = await fetchWithTimeout('https://api.ai21.com/studio/v1/j2-ultra/complete', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.AI21_API_KEY}` },
    body: JSON.stringify({ prompt: sys + '\n\n' + usr, temperature: 0.7, maxTokens: 2000 }),
  }, 25000);
  const j = await res.json();
  if (j.error) throw new Error('AI21: ' + (j.error.message || JSON.stringify(j.error)));
  const d = (j.completions && j.completions[0]) || {};
  return { text: (d.data && d.data.text) || '', usage: d.finish_reason ? { output_tokens: 1 } : {} };
}
async function octoadiCall(env, sys, usr) {
  if (!env.OCTOAI_API_KEY) throw new Error('OctoAI key not set');
  const res = await fetchWithTimeout('https://text.octoai.run/v1/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.OCTOAI_API_KEY}` },
    body: JSON.stringify({ model: 'meta-llama-3.1-70b-instruct', messages: [{ role: 'system', content: sys }, { role: 'user', content: usr }], temperature: 0.7, max_tokens: 2000 }),
  }, 25000);
  const j = await res.json();
  if (j.error) throw new Error('OctoAI: ' + (j.error.message || JSON.stringify(j.error)));
  const c = j.choices && j.choices[0];
  if (!c) throw new Error('OctoAI: no choice');
  return { text: c.message.content || '', usage: j.usage };
}

const SITUATION_SYSTEM = `You are the watch officer of a global situation room. From REAL, current world headlines pulled
live moments ago, synthesize a cross-domain situational brief — correlate signals across domains and
flag where they CONVERGE (e.g. a conflict driving an energy spike driving an inflation read).

Return ONE JSON object:
{
  "threatLevel": "Low" | "Guarded" | "Elevated" | "High" | "Severe",
  "defcon": integer 1-5 readiness estimate (5 = peacetime/relaxed, 1 = maximum readiness / imminent conflict), inferred from the geopolitical picture,
  "defconLabel": short phrase for the DEFCON level (e.g. "Heightened readiness"),
  "pizzaIndex": "Quiet" | "Normal" | "Elevated" | "Spiking" — a tongue-in-cheek 'Pentagon Pizza Index' read on how busy national-security decision-makers likely are right now,
  "pizzaNote": one short witty-but-grounded sentence explaining the pizza read,
  "overview": 2-3 sentence top-line situational summary,
  "domains": array of EXACTLY these 5, each {
    "domain": one of "Military","Economic","Political","Disaster","Cyber/Energy",
    "level": "calm" | "watch" | "active" | "critical",
    "summary": one sentence grounded in the headlines
  },
  "convergence": 1-2 sentences on where signals reinforce each other right now,
  "marketImplication": one sentence on the net market posture this implies,
  "watchlist": array of 3-5 short strings (specific things to watch next)
}
Return ONLY the JSON object. No markdown, no commentary.`;

const CANDLE_SYSTEM = `You are an expert technical analyst specializing in candlestick pattern recognition and price action.
You will be given recent OHLC candlestick data for a stock (Open, High, Low, Close), listed chronologically newest last.
Each row: INDEX | DATE | OPEN | HIGH | LOW | CLOSE (USD).

Identify ALL significant candlestick patterns — especially in the LAST 1-5 candles. Look for:
Doji, Hammer, Hanging Man, Shooting Star, Inverted Hammer, Bullish/Bearish Engulfing,
Morning Star, Evening Star, Morning/Evening Doji Star, Three White Soldiers, Three Black Crows,
Bullish/Bearish Harami, Dark Cloud Cover, Piercing Line, Marubozu, Spinning Top,
Tweezer Top/Bottom, Three Inside Up/Down, and any other relevant patterns.

Also identify visible support/resistance levels from the data.

Return ONE JSON object:
{
  "patterns": array of ALL detected patterns, highest-confidence first, each {
    "name": exact pattern name,
    "type": "bullish" | "bearish" | "neutral",
    "confidence": "high" | "medium" | "low",
    "candlesInvolved": integer 1-3,
    "candleIndex": candles from the end (0 = most recent),
    "description": one sentence on what this pattern signals
  },
  "overallSignal": "Strong Buy" | "Buy" | "Neutral" | "Sell" | "Strong Sell",
  "signalStrength": integer 1-100 (50 = neutral, 100 = max bullish, 1 = max bearish),
  "keyLevels": {
    "support": array of up to 3 key support prices (numbers, most relevant first),
    "resistance": array of up to 3 key resistance prices (numbers, most relevant first)
  },
  "trend": "Uptrend" | "Downtrend" | "Sideways",
  "momentum": "Accelerating" | "Decelerating" | "Neutral",
  "summary": 2-3 sentence technical read combining patterns with broader price action,
  "recommendation": one concrete actionable sentence (e.g. "Wait for close above $X before entering long")
}
Return ONLY the JSON object. No markdown, no commentary.`;

// ───────────────────────── fetchers ─────────────────────────

async function fetchCandleAnalysis(env, ctx, symbol, range) {
  const chartData = await getChart(env, ctx, symbol, range);
  const points = (chartData.points || []).filter((p) => p.o != null && p.h != null && p.l != null);
  if (points.length < 3) throw new Error('Not enough OHLC data for candle analysis.');

  // Send the last 40 candles — enough context without overloading the prompt.
  const recent = points.slice(-40);
  const header = 'IDX | DATE       | OPEN   | HIGH   | LOW    | CLOSE';
  const rows = recent.map((p, i) => {
    const dt = new Date(p.t).toISOString().slice(0, 10);
    const fmt = (n) => (n != null ? n.toFixed(2).padStart(7) : '     N/A');
    return `${String(i).padStart(3)} | ${dt} | ${fmt(p.o)} | ${fmt(p.h)} | ${fmt(p.l)} | ${fmt(p.c)}`;
  });
  const userPrompt =
    `Symbol: ${symbol} | Range: ${range} | As of: ${new Date().toUTCString()}\n\n${header}\n${rows.join('\n')}\n\n` +
    `Current price: ${recent[recent.length - 1].c.toFixed(2)}\n\nProduce the candlestick analysis JSON now.`;

  const data = await runAIJson(env, CANDLE_SYSTEM, userPrompt,
    (d) => d && Array.isArray(d.patterns) && d.overallSignal && d.keyLevels);

  data.symbol = symbol;
  data.range = range;
  data.asOf = new Date().toISOString();
  data.currentPrice = recent[recent.length - 1].c;
  data.candleCount = points.length;
  return data;
}

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

async function fetchSituation(env) {
  const headlines = await fetchWorldHeadlines();
  const userPrompt =
    `Current time: ${new Date().toUTCString()}.\n\n` +
    `Real, current world headlines pulled live moments ago:\n\n${headlineBlock(headlines)}\n\n` +
    `Produce the situational brief JSON now.`;
  return runAIJson(env, SITUATION_SYSTEM, userPrompt,
    (d) => d && Array.isArray(d.domains) && d.domains.length >= 3 && d.defcon != null && d.pizzaIndex != null);
}

async function fetchInstability(env) {
  const headlines = await fetchWorldHeadlines();
  const userPrompt =
    `Current time: ${new Date().toUTCString()}.\n\n` +
    `Real, current world headlines pulled live moments ago:\n\n${headlineBlock(headlines)}\n\n` +
    `Produce the instability JSON now.`;
  const data = await runAIJson(env, INSTABILITY_SYSTEM, userPrompt,
    (d) => d && Array.isArray(d.countries) && d.countries.length >= 6);
  data.countries = (data.countries || []).filter((c) => typeof c.lat === 'number' && typeof c.lon === 'number');
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
  data.suppliers = Array.isArray(data.suppliers) ? data.suppliers : [];
  data.customers = Array.isArray(data.customers) ? data.customers : [];
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

// Live aircraft — MERGED from several free ADS-B networks. airplanes.live is
// fetched browser-side (CORS); here the worker pulls the no-CORS / different
// feeder networks (adsb.lol, adsb.fi, OpenSky) best-effort and dedupes by hex,
// so coverage is the union of every source that answers. Any that rate-limit
// the Cloudflare IP are simply skipped via allSettled.
const normReadsb = (j) => (j.ac || []).map((a) => ({
  icao: (a.hex || '').toLowerCase(), callsign: (a.flight || '').trim(), type: a.t, reg: a.r,
  lat: a.lat, lon: a.lon, alt: typeof a.alt_baro === 'number' ? Math.round(a.alt_baro * 0.3048) : null,
  velocity: a.gs != null ? a.gs * 0.514444 : null, heading: a.track != null ? a.track : a.true_heading,
  onGround: a.alt_baro === 'ground',
}));
const normOpenSky = (j) => (j.states || []).map((a) => ({
  icao: (a[0] || '').toLowerCase(), callsign: (a[1] || '').trim(), type: null, reg: null,
  lat: a[6], lon: a[5], alt: a[7] != null ? Math.round(a[7]) : (a[13] != null ? Math.round(a[13]) : null),
  velocity: a[9], heading: a[10], onGround: a[8],
}));

async function fetchFlights(bbox) {
  const [s, w, n, e] = bbox;
  const lat = (s + n) / 2, lon = (w + e) / 2;
  const dLat = (n - s) / 2, dLon = (e - w) / 2;
  const km = Math.sqrt((dLat * 111) ** 2 + (dLon * 111 * Math.cos((lat * Math.PI) / 180)) ** 2);
  const dist = Math.min(250, Math.max(25, Math.round(km / 1.852)));
  const ll = `lat/${lat.toFixed(3)}/lon/${lon.toFixed(3)}/dist/${dist}`;

  const sources = [
    fetchWithTimeout(`https://api.adsb.lol/v2/${ll}`, { headers: { Accept: 'application/json' } }, 10000).then((r) => r.ok ? r.json().then(normReadsb) : []),
    fetchWithTimeout(`https://opendata.adsb.fi/api/v2/${ll}`, { headers: { Accept: 'application/json' } }, 10000).then((r) => r.ok ? r.json().then(normReadsb) : []),
    fetchWithTimeout(`https://opensky-network.org/api/states/all?lamin=${s}&lomin=${w}&lamax=${n}&lomax=${e}`, {}, 10000).then((r) => r.ok ? r.json().then(normOpenSky) : []),
  ];
  const results = await Promise.allSettled(sources);
  const byIcao = new Map();
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    for (const a of r.value) {
      if (a.lat == null || a.lon == null || a.onGround) continue;
      if (a.icao && byIcao.has(a.icao)) continue; // dedupe across networks
      byIcao.set(a.icao || `${a.lat},${a.lon}`, a);
    }
  }
  return [...byIcao.values()].slice(0, 2500);
}

// GDELT GEO 2.0 — geolocated news mentions for a query (no key; rate-limited,
// so cached long). Great for a live "where the conflict news is" heat layer.
async function fetchGdeltGeo(query) {
  const url = `https://api.gdeltproject.org/api/v2/geo/geo?query=${encodeURIComponent(query)}&format=geojson&timespan=2d`;
  const res = await fetchWithTimeout(url, { headers: { 'User-Agent': 'MarketTerminal/1.0' } }, 12000);
  if (!res.ok) throw new Error('GDELT ' + res.status);
  const j = await res.json();
  return (j.features || []).map((f) => {
    const c = f.geometry && f.geometry.coordinates; const p = f.properties || {};
    if (!c) return null;
    return { lat: c[1], lon: c[0], name: p.name || '', count: p.count || 1, html: (p.html || '').slice(0, 400) };
  }).filter(Boolean).slice(0, 600);
}

// NASA FIRMS — active fire/thermal detections worldwide (free MAP_KEY).
async function fetchFires(env) {
  if (!env.FIRMS_MAP_KEY) throw new Error('FIRMS key not configured');
  const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${env.FIRMS_MAP_KEY}/VIIRS_SNPP_NRT/world/1`;
  const res = await fetchWithTimeout(url, {}, 15000);
  if (!res.ok) throw new Error('FIRMS ' + res.status);
  const text = await res.text();
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const h = lines[0].split(',');
  const iLat = h.indexOf('latitude'), iLon = h.indexOf('longitude');
  const iBr = h.indexOf('bright_ti4') >= 0 ? h.indexOf('bright_ti4') : h.indexOf('brightness');
  const iConf = h.indexOf('confidence'), iDate = h.indexOf('acq_date');
  return lines.slice(1).map((r) => { const f = r.split(','); return { lat: parseFloat(f[iLat]), lon: parseFloat(f[iLon]), bright: iBr >= 0 ? parseFloat(f[iBr]) : null, conf: iConf >= 0 ? f[iConf] : '', date: iDate >= 0 ? f[iDate] : '' }; })
    .filter((x) => !Number.isNaN(x.lat) && !Number.isNaN(x.lon)).slice(0, 5000);
}

// Windy live webcams API (v3) — worldwide public webcam feeds with coordinates,
// a current still image, and an embeddable live player. Header-auth + paginated.
async function fetchWindyWebcams(env) {
  if (!env.WINDY_KEY) throw new Error('Windy key not configured');
  const headers = { 'x-windy-api-key': env.WINDY_KEY, Accept: 'application/json' };
  const out = [];
  // Page through the most-viewed webcams for a broad spread (50/page, v3 max).
  for (let offset = 0; offset < 500; offset += 50) {
    const url = `https://api.windy.com/webcams/api/v3/webcams?limit=50&offset=${offset}&include=location,images,player`;
    const res = await fetchWithTimeout(url, { headers }, 15000);
    if (!res.ok) { if (offset === 0) throw new Error('Windy ' + res.status); break; }
    const j = await res.json();
    const cams = j.webcams || [];
    if (!cams.length) break;
    for (const w of cams) {
      const p = w.location || {};
      const lat = parseFloat(p.latitude), lon = parseFloat(p.longitude);
      if (Number.isNaN(lat) || Number.isNaN(lon)) continue;
      const im = w.images || {};
      const cur = im.current || {}, day = im.daylight || {};
      out.push({
        lat, lon, title: w.title || (p.city || 'Webcam'),
        place: [p.city, p.country].filter(Boolean).join(', '),
        img: cur.preview || day.preview || cur.thumbnail || day.thumbnail || '',
        url: (w.player && (w.player.day || w.player.live || w.player.lifetime)) || '',
      });
    }
  }
  return out;
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

// ───────────── Curated map layer baseline + live augmentation ─────────────

const MAP_LAYERS_BASELINE = {
  chokepoints: [
    ['Strait of Hormuz', 26.57, 56.25, '~20% of global oil — Iran can close'],
    ['Suez Canal', 30.42, 32.35, '~12% of global trade — container lifeline'],
    ['Strait of Malacca', 1.26, 103.74, '~25% of seaborne trade — piracy risk'],
    ['Bab-el-Mandeb', 12.58, 43.33, 'Red Sea → Indian Ocean — Houthi threat'],
    ['Panama Canal', 9.08, -79.68, 'Atlantic ↔ Pacific — drought capacity risk'],
    ['Turkish Straits (Bosphorus)', 41.12, 29.07, 'Black Sea outlet — Russia grain/oil'],
    ['Danish Straits', 55.84, 12.67, 'Baltic → North Sea access'],
    ['Strait of Dover', 51.12, 1.55, 'Busiest shipping lane in the world'],
    ['Lombok Strait', -8.76, 115.74, 'Malacca bypass for deep-draft tankers'],
    ['Strait of Sicily', 37.35, 11.51, 'Mediterranean E–W chokepoint'],
    ['Luzon Strait', 18.84, 121.80, 'South China Sea → Pacific gateway'],
    ['Windward Passage', 19.81, -74.03, 'Caribbean → Atlantic route'],
  ],
  nuclear: [
    ['Bruce NPP', 44.32, -81.60, 'Canada — largest nuclear station (6,384 MWe)'],
    ['Zaporizhzhia NPP', 47.51, 34.59, 'Ukraine — largest in Europe (under Russian control)'],
    ['Palo Verde NPP', 33.39, -112.86, 'Arizona, USA — largest US nuclear plant'],
    ['Kori NPP', 35.33, 129.30, 'South Korea'],
    ['Gravelines NPP', 51.01, 2.14, 'France — coastal, English Channel'],
    ['Tianwan NPP', 34.69, 119.46, 'China — Jiangsu province'],
    ['Kashiwazaki-Kariwa', 37.43, 138.60, 'Japan — world\'s largest capacity plant'],
    ['Kudankulam NPP', 8.17, 77.71, 'India — Russian-built, Tamil Nadu'],
    ['Belene NPP (proposed)', 43.63, 25.18, 'Bulgaria — Russian VVER, stalled'],
    ['Akkuyu NPP', 36.14, 33.54, 'Turkey — first nuclear plant, Russian-built (under construction)'],
    ['Barakah NPP', 23.96, 52.23, 'UAE — first Arab world nuclear plant'],
    ['Olkiluoto NPP', 61.24, 21.44, 'Finland — EPR reactor'],
  ],
  militaryBases: [
    ['Diego Garcia (UK/US)', -7.31, 72.42, 'Indian Ocean — B-52 & carrier staging'],
    ['Guam (Anderson AFB)', 13.58, 144.93, 'Pacific pivot — F-22/B-2 hub'],
    ['Ramstein AB', 49.44, 7.60, 'Germany — NATO Europe HQ'],
    ['Camp Lemonnier', 11.55, 43.15, 'Djibouti — AFRICOM hub, drone base'],
    ['Al Udeid AB', 25.12, 51.32, 'Qatar — CENTCOM forward HQ'],
    ['Kadena AB', 26.36, 127.77, 'Okinawa — largest US base in Asia-Pacific'],
    ['Naval Base Guantanamo', 19.90, -75.15, 'Cuba — US detention facility'],
    ['Fort Campbell', 36.67, -87.47, 'USA — 101st Airborne Division'],
    ['RAF Fairford', 51.68, -1.79, 'UK — B-2 stealth bomber deployments'],
    ['Bagram Airfield', 34.94, 69.26, 'Afghanistan — former NATO hub'],
    ['Sevastopol (Russia)', 44.62, 33.53, 'Crimea — Black Sea Fleet HQ (disputed)'],
    ['Tartus Naval Base', 34.89, 35.87, 'Syria — Russia\'s only Mediterranean base'],
    ['Djibouti China Base', 11.52, 43.03, 'China\'s first overseas military base'],
    ['Camp Darby', 43.67, 10.33, 'Italy — US Army pre-positioned depot'],
    ['Prince Sultan AB', 24.07, 47.58, 'Saudi Arabia — USAF redeployed 2019'],
    ['Yokota AB', 35.75, 139.35, 'Japan — USFJ headquarters'],
  ],
  dataCenters: [
    ['Equinix Ashburn (DC campus)', 39.04, -77.49, 'World\'s largest data center campus'],
    ['QTS Richmond', 37.54, -77.44, 'US East core'],
    ['Switch Las Vegas', 36.23, -115.19, 'Nevada — "The Citadel"'],
    ['CyrusOne Dallas', 32.90, -97.04, 'Texas — largest US campus'],
    ['Equinix Singapore', 1.29, 103.84, 'Asia internet exchange'],
    ['China Telecom Beijing', 39.91, 116.41, 'China backbone hub'],
    ['Interxion Amsterdam', 52.37, 4.89, 'Netherlands — AMS-IX hub'],
    ['Telehouse London', 51.51, -0.00, 'UK — LINX exchange'],
    ['Digital Realty Dublin', 53.33, -6.25, 'EU data hub (low tax)'],
    ['NTT Tokyo', 35.69, 139.69, 'Japan internet backbone'],
    ['Equinix Frankfurt', 50.11, 8.68, 'DE-CIX host — Europe\'s largest IXP'],
    ['Yandex Moscow', 55.73, 37.59, 'Russia internet backbone'],
    ['AIMS Kuala Lumpur', 3.16, 101.71, 'SEA hub'],
    ['Teraco Johannesburg', -26.11, 28.00, 'Africa\'s largest carrier-neutral DC'],
  ],
  exchanges: [
    ['NYSE', 40.706, -74.011, 'New York Stock Exchange — largest by market cap'],
    ['NASDAQ', 40.759, -73.985, 'Tech-heavy US exchange'],
    ['London Stock Exchange', 51.514, -0.098, 'LSE Group — FTSE 100'],
    ['Tokyo Stock Exchange', 35.681, 139.769, 'Japan — Nikkei 225'],
    ['Shanghai SE', 31.232, 121.489, 'China A-shares — SSE Composite'],
    ['Hong Kong Exchanges', 22.279, 114.156, 'Hang Seng — China connect'],
    ['Euronext Paris', 48.869, 2.336, 'Pan-European exchange'],
    ['Shenzhen SE', 22.540, 114.058, 'China tech-heavy'],
    ['Deutsche Börse (Xetra)', 50.118, 8.672, 'DAX — Frankfurt'],
    ['BSE (Bombay)', 18.935, 72.831, 'India — SENSEX'],
    ['Toronto SE', 43.649, -79.380, 'TSX — Canadian equities'],
    ['ASX Sydney', -33.869, 151.208, 'Australia — ASX 200'],
    ['Saudi Tadawul', 24.689, 46.683, 'Largest Arab exchange'],
    ['Korea Exchange', 37.530, 126.921, 'KOSPI — Seoul'],
  ],
  criticalMinerals: [
    ['Pilbara (Iron Ore)', -23.0, 118.5, 'Australia — world\'s largest iron ore region'],
    ['Atacama (Lithium)', -23.5, -68.5, 'Chile/Argentina — lithium triangle, ~55% world supply'],
    ['DRC Copper Belt', -10.5, 25.5, 'Congo — cobalt & copper (#1 world cobalt)'],
    ['Sudbury Basin', 46.5, -81.0, 'Canada — nickel & PGMs'],
    ['Witwatersrand', -26.27, 27.23, 'South Africa — gold belt'],
    ['Rare Earth (Bayan Obo)', 41.8, 109.9, 'Inner Mongolia — world\'s largest REE deposit'],
    ['Grasberg Mine', -4.05, 137.11, 'Papua, Indonesia — gold/copper megamine'],
    ['Escondida (Copper)', -24.27, -69.07, 'Chile — world\'s largest copper mine'],
    ['Norilsk (Nickel/Palladium)', 69.34, 88.20, 'Russia — 40% world palladium supply'],
    ['Western Australia (Spodumene)', -32.0, 119.5, 'Lithium spodumene hard rock'],
    ['Namibia (Uranium)', -22.5, 14.8, 'Rössing & Husab — major uranium export'],
    ['Oyu Tolgoi (Copper/Gold)', 43.00, 106.85, 'Mongolia — world-class copper-gold mine'],
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
      ['WACS (West Africa Cable System, 2012)',
        [[51.50, -0.09], [38.71, -9.14], [28.11, -15.43], [14.69, -17.44],
         [10.65, -14.42], [8.49, -13.23], [5.35, -4.02], [4.05, 9.70],
         [-4.32, 15.32], [-8.84, 13.23], [-22.90, 14.50], [-33.87, 18.47]],
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
      ['Nord Stream 1 (Baltic Sea gas)',
        [[60.71, 28.74], [59.50, 25.00], [57.50, 20.00], [55.50, 16.50], [54.52, 13.65]],
        'Vyborg → Lubmin, Germany (55 bcm/yr, flows halted 2022)'],
      ['Nord Stream 2 (Baltic Sea gas)',
        [[60.30, 28.20], [58.80, 24.00], [56.50, 19.00], [55.00, 15.50], [54.11, 13.64]],
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
         [55.70, 37.80], [53.00, 29.00], [52.10, 23.00], [52.20, 20.00], [52.40, 14.50]],
        'West Siberia → Germany via Poland (33 bcm/yr)'],
      ['Baku–Tbilisi–Ceyhan / BTC (oil)',
        [[40.41, 49.87], [41.40, 46.00], [41.70, 44.78], [40.90, 43.00],
         [39.90, 41.00], [39.73, 39.49], [37.70, 37.50], [36.63, 35.51]],
        'Azeri crude → Mediterranean (1 Mbd) — BTC pipeline'],
      ['Trans-Anatolian / TANAP (gas)',
        [[41.58, 41.56], [40.80, 40.00], [40.20, 38.00], [39.90, 35.00],
         [39.90, 32.80], [39.80, 30.50], [40.10, 28.00], [40.38, 26.00], [41.70, 26.47]],
        'Azerbaijani gas → Turkey/Europe (16 bcm/yr)'],
      ['Trans-Adriatic / TAP (gas)',
        [[41.70, 26.47], [41.50, 23.00], [40.63, 22.94], [40.80, 20.00],
         [41.33, 19.82], [40.83, 18.16]],
        'Greece → Albania → Italy — connects to TANAP'],
      ['East Siberia–Pacific Ocean / ESPO (oil)',
        [[55.93, 98.00], [56.00, 103.00], [57.00, 110.00], [56.50, 115.00],
         [55.00, 120.00], [53.98, 123.89], [52.00, 128.00], [48.00, 133.00], [42.93, 133.52]],
        'Taishet → Kozmino (Pacific export terminal) — 1.6 Mbd'],
      ['Trans-Alaska Pipeline (TAPS, oil)',
        [[70.30, -148.63], [67.00, -151.00], [64.84, -147.72], [62.00, -148.00], [61.13, -146.36]],
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
      ['Power of Siberia (Russia-China gas)',
        [[52.00, 120.00], [53.00, 125.00], [53.98, 123.89], [49.00, 130.00],
         [48.47, 135.07], [47.00, 133.00], [44.00, 131.00], [43.80, 131.88]],
        'Chayanda/Kovykta → Heihe, China (38 bcm/yr, operational 2019)'],
      ['Central Asia–China Gas Pipeline (CAGP)',
        [[39.65, 66.96], [41.00, 63.00], [42.00, 60.00], [41.00, 65.00],
         [39.47, 75.99], [38.00, 80.00], [36.06, 103.83], [34.80, 113.70], [31.23, 121.47]],
        'Turkmenistan/Kazakhstan/Uzbekistan → China (55 bcm/yr)'],
      ['Medgaz (Algeria–Spain, 2011)',
        [[36.91, 2.43], [37.30, 0.50], [37.50, -1.00], [37.60, -0.80], [38.35, -0.48]],
        'Algeria → Spain (8 bcm/yr)'],
      ['Transmed / Enrico Mattei (1983)',
        [[36.91, 2.43], [37.00, 8.00], [37.50, 10.00], [37.50, 11.00],
         [38.11, 13.37], [40.85, 14.27], [44.40, 8.92], [45.46, 9.19]],
        'Algeria → Tunisia → Sicily → Italy (30 bcm/yr)'],
      ['Trans Mountain (Canada, expanded 2024)',
        [[53.54, -113.49], [51.50, -116.50], [49.40, -117.00], [49.35, -122.90], [49.28, -123.11]],
        'Alberta → Vancouver (890 kbd, tripled capacity 2024)'],
      ['Enbridge Mainline (largest oil pipeline system)',
        [[53.54, -113.49], [52.00, -107.00], [50.00, -100.00], [47.00, -95.00],
         [46.50, -91.00], [42.30, -83.00], [41.88, -87.63]],
        'Alberta → US Midwest (3 Mbd, world\'s longest)'],
      ['Baltic Pipe (Norway-Poland, 2022)',
        [[58.97, 5.73], [57.70, 7.00], [57.00, 9.00], [56.50, 10.50],
         [56.50, 12.00], [55.68, 12.57], [54.52, 14.00], [54.35, 18.64]],
        'Norway → Denmark → Poland (10 bcm/yr, bypasses Russian gas)'],
      ['Iraq–Turkey Pipeline (Kirkuk–Ceyhan)',
        [[35.47, 44.39], [36.00, 42.00], [37.00, 40.00], [37.50, 38.00],
         [37.00, 37.00], [36.63, 35.51]],
        'Kirkuk oilfield → Ceyhan, Turkey (1.6 Mbd)'],
      ['Abu Dhabi Crude Oil Pipeline (ADCOP)',
        [[24.47, 54.37], [24.00, 56.00], [22.70, 59.52]],
        'Abu Dhabi → Fujairah (bypass Hormuz, 1.5 Mbd)'],
      ['Sino-Burma Oil & Gas Pipeline',
        [[22.80, 98.52], [24.50, 97.00], [25.00, 96.00], [24.00, 93.00], [23.73, 90.41]],
        'Myanmar coast → Yunnan, China (oil+gas dual pipeline)'],
      ['West African Gas Pipeline (WAGP, 2010)',
        [[6.45, 3.39], [6.10, 1.22], [5.55, -0.20], [5.35, -4.02]],
        'Nigeria → Benin → Togo → Ghana (678 km)'],
      ['Mozambique–South Africa (ROMPCO)',
        [[-25.96, 32.59], [-26.82, 32.08], [-25.90, 32.04], [-26.20, 28.04]],
        'Mozambique gas → South Africa (865 MMcf/d)'],
      ['Trans-Saharan Gas Pipeline (proposed)',
        [[3.87, 11.52], [13.52, 2.11], [23.00, 3.00], [30.00, 3.00], [36.91, 2.43]],
        'Nigeria → Niger → Algeria → Europe (4,130 km, proposed)'],
      ['Dakota Access Pipeline (DAPL)',
        [[47.50, -102.80], [46.50, -100.00], [45.00, -97.00], [43.00, -95.00], [41.88, -87.63]],
        'Bakken shale → Illinois (570 kbd)'],
      ['Permian Basin pipelines (US)',
        [[31.84, -102.37], [30.00, -98.00], [29.76, -95.37]],
        'Permian Basin → Houston (multiple lines, 5+ Mbd capacity)'],
    ],
  },
};

// Query Overpass API for real OSM pipeline/cable geodata (with 25s timeout).
// Returns { cables: [...], pipelines: [...] } in the same [name, coords, desc] format.
async function fetchOverpassLines() {
  const OVERPASS = 'https://overpass-api.de/api/interpreter';
  const out = { cables: [], pipelines: [] };

  // ── Submarine cables ──────────────────────────────────────────────────────
  try {
    const cableQ = `[out:json][timeout:25];
way["telecom"="cable"]["location"="underwater"]["name"];
out 80 geom;`;
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
        const op = el.tags?.operator || '';
        out.cables.push([name, coords, `Submarine cable${op ? ' · ' + op : ''}`]);
      }
    }
  } catch { /* Overpass cable query timed out or failed */ }

  // ── Major oil/gas pipelines ───────────────────────────────────────────────
  try {
    const pipeQ = `[out:json][timeout:25];
way["man_made"="pipeline"]["substance"~"^(oil|gas|natural_gas)$"]["name"];
out 80 geom;`;
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
  } catch { /* Overpass pipeline query timed out or failed */ }

  return out;
}

// Merge live augmentations (IAEA, UNHCR, Wikidata, Overpass) into the baseline.
// All failures are swallowed — baseline is always returned.
async function fetchAugmentedLayers() {
  const out = JSON.parse(JSON.stringify(MAP_LAYERS_BASELINE)); // deep clone

  // ── 1. IAEA PRIS — nuclear reactor operational status ────────────────────
  try {
    const iaRes = await fetchWithTimeout(
      'https://pris.iaea.org/api/reactors?status=operational&format=json',
      { headers: { 'User-Agent': BROWSER_UA } }, 8000
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
        const isDupe = out.nuclear.some(([n]) => n.toLowerCase().includes(name.toLowerCase().slice(0, 6)));
        if (!isDupe) out.nuclear.push([label, +rx.latitude, +rx.longitude, desc]);
      }
    }
  } catch { /* IAEA unreachable */ }

  // ── 2. UNHCR Refugee Situations API ──────────────────────────────────────
  try {
    const uhRes = await fetchWithTimeout(
      'https://api.unhcr.org/population/v1/unsd/?limit=50&sortBy=refugeesUnderUNHCRsMandate&sortOrder=desc',
      { headers: { 'User-Agent': BROWSER_UA } }, 8000
    );
    if (uhRes.ok) {
      const uhData = await uhRes.json();
      for (const item of (uhData.items || uhData.data || []).slice(0, 20)) {
        if (!item.countryOfOriginName) continue;
        const name = item.countryOfOriginName;
        const count = item.refugeesUnderUNHCRsMandate || item.total || 0;
        const fmt = count > 1e6 ? (count / 1e6).toFixed(1) + 'M' : count > 1000 ? (count / 1000).toFixed(0) + 'K' : String(count);
        const idx = out.refugeeHotspots.findIndex(([n]) => name && n.toLowerCase().includes(name.toLowerCase().slice(0, 5)));
        if (idx >= 0) out.refugeeHotspots[idx][3] = `${out.refugeeHotspots[idx][3]} — ${fmt} refugees`;
      }
    }
  } catch { /* UNHCR unreachable */ }

  // ── 3. Wikidata SPARQL — additional military bases ────────────────────────
  try {
    const sparql = `SELECT ?item ?label ?lat ?lon ?country WHERE {
      ?item wdt:P31 wd:Q179049;
            wdt:P17 ?countryItem;
            p:P625 [ psv:P625 [ wikibase:geoLatitude ?lat; wikibase:geoLongitude ?lon ] ].
      ?countryItem rdfs:label ?country FILTER(LANG(?country)="en").
      ?item rdfs:label ?label FILTER(LANG(?label)="en").
      FILTER(?lat > -90 && ?lat < 90 && ?lon > -180 && ?lon < 180)
    } LIMIT 40`;
    const wdRes = await fetchWithTimeout(
      'https://query.wikidata.org/sparql?query=' + encodeURIComponent(sparql) + '&format=json',
      { headers: { 'User-Agent': BROWSER_UA, Accept: 'application/sparql-results+json' } }, 10000
    );
    if (wdRes.ok) {
      const wdData = await wdRes.json();
      for (const b of (wdData.results?.bindings || [])) {
        const name = b.label?.value || '';
        const lat = parseFloat(b.lat?.value), lon = parseFloat(b.lon?.value);
        const country = b.country?.value || '';
        if (!name || isNaN(lat) || isNaN(lon)) continue;
        const isDupe = out.militaryBases.some(([n]) => n.toLowerCase().includes(name.toLowerCase().slice(0, 8)));
        if (!isDupe) out.militaryBases.push([name, lat, lon, `Military installation — ${country}`]);
      }
    }
  } catch { /* Wikidata unreachable */ }

  // ── 4. Overpass — real OSM pipeline/cable geodata (daily refresh) ─────────
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

// REST ship snapshot — global vessel positions (secondary to WS stream).
async function fetchRestShips(env) {
  const vessels = [];
  const AISSTREAM_KEY = env.AISSTREAM_API_KEY;

  // Source 1: AISStream REST snapshot
  if (AISSTREAM_KEY) {
    try {
      const r = await fetchWithTimeout('https://api.aisstream.io/v0/vessels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${AISSTREAM_KEY}` },
        body: JSON.stringify({ BoundingBoxes: [[[-89.9, -180], [89.9, 180]]], FilterShipMMSI: [], IncludeSatellite: true }),
      }, 10000);
      if (r.ok) {
        const d = await r.json();
        for (const v of (d.vessels || d || [])) {
          if (v.Latitude == null || v.Longitude == null) continue;
          vessels.push({ mmsi: v.MMSI || v.mmsi, lat: v.Latitude || v.latitude, lon: v.Longitude || v.longitude, name: (v.ShipName || v.Name || v.name || '').trim(), sog: v.Sog || v.sog, cog: v.Cog || v.cog, type: v.ShipType || v.type });
        }
      }
    } catch { /* AISStream REST unavailable */ }
  }

  // Source 2: AISHub REST (free, ~15 min delayed, global)
  if (vessels.length < 100) {
    try {
      const r = await fetchWithTimeout(
        'https://data.aishub.net/ws.php?username=Z1456&format=1&output=json&compress=0&latmin=-90&latmax=90&lonmin=-180&lonmax=180',
        { headers: { 'User-Agent': BROWSER_UA } }, 10000
      );
      if (r.ok) {
        const raw = await r.json();
        const rows = Array.isArray(raw) ? raw.filter(Array.isArray).flat() : [];
        for (const v of rows) {
          if (v.LATITUDE == null || v.LONGITUDE == null) continue;
          vessels.push({ mmsi: v.MMSI, lat: +v.LATITUDE, lon: +v.LONGITUDE, name: (v.NAME || '').trim(), sog: v.SPEED != null ? v.SPEED / 10 : undefined, cog: v.COURSE, type: v.SHIPTYPE });
        }
      }
    } catch { /* AISHub unavailable */ }
  }

  const seen = new Set();
  const unique = vessels.filter((v) => { if (!v.mmsi || seen.has(v.mmsi)) return false; seen.add(v.mmsi); return true; });
  return { vessels: unique, count: unique.length, source: 'rest', ts: Date.now() };
}

// Live map data: Disease Outbreaks (ProMED RSS + WHO DON)
async function fetchDiseaseOutbreaks() {
  const parseRSS = async (url, srcName) => {
    try {
      const res = await fetchWithTimeout(url, { headers: { 'User-Agent': BROWSER_UA, Accept: 'application/rss+xml,application/xml,text/xml,*/*' } }, 12000);
      if (!res.ok) return [];
      const xml = await res.text();
      const items = [];
      const itemRE = /<(?:item|entry)[^>]*>([\s\S]*?)<\/(?:item|entry)>/gi;
      let m;
      while ((m = itemRE.exec(xml)) !== null) {
        const block = m[1];
        const title = (/<title[^>]*><!\[CDATA\[(.*?)\]\]>/i.exec(block) || [])[1] || (/<title[^>]*>(.*?)<\/title>/i.exec(block) || [])[1] || '';
        const desc  = (/<description[^>]*><!\[CDATA\[([\s\S]*?)\]\]>/i.exec(block) || [])[1] || (/<description[^>]*>([\s\S]*?)<\/description>/i.exec(block) || [])[1] || '';
        const link  = (/<link[^>]*>(.*?)<\/link>/i.exec(block) || [])[1] || '';
        const pubDate = (/<pubDate>(.*?)<\/pubDate>|<published>(.*?)<\/published>/i.exec(block) || [])[1] || '';
        if (title) items.push({ title: title.trim(), desc: desc.replace(/<[^>]+>/g, ' ').trim().slice(0, 200), link, pubDate, source: srcName });
      }
      return items.slice(0, 20);
    } catch { return []; }
  };
  const REGION_COORDS = {
    'africa': [0, 20], 'west africa': [10, -10], 'east africa': [-5, 37], 'central africa': [-4, 22],
    'asia': [25, 90], 'south asia': [20, 78], 'southeast asia': [10, 108], 'east asia': [35, 118],
    'china': [35, 105], 'india': [20, 78], 'pakistan': [30, 69], 'indonesia': [-5, 120],
    'middle east': [27, 45], 'north america': [40, -95], 'south america': [-15, -60],
    'europe': [50, 15], 'brazil': [-10, -55], 'congo': [-4, 23], 'nigeria': [9, 8],
    'kenya': [-1, 38], 'ethiopia': [9, 40], 'myanmar': [21, 96], 'philippines': [13, 122],
    'ukraine': [49, 32], 'united states': [38, -97], 'mexico': [23, -102],
  };
  const geoTag = (title, desc) => {
    const text = (title + ' ' + desc).toLowerCase();
    for (const [region, coords] of Object.entries(REGION_COORDS)) { if (text.includes(region)) return coords; }
    return null;
  };
  const [proMed, who] = await Promise.all([
    parseRSS('https://promedmail.org/feed/', 'ProMED'),
    parseRSS('https://www.who.int/rss-feeds/news-releases-do.xml', 'WHO'),
  ]);
  const features = [];
  for (const item of [...proMed, ...who]) {
    const coords = geoTag(item.title, item.desc);
    if (!coords) continue;
    const jitter = () => (Math.random() - 0.5) * 2.5;
    features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [coords[1] + jitter(), coords[0] + jitter()] }, properties: { layer: 'disease', title: item.title, desc: item.desc, source: item.source, link: item.link, pubDate: item.pubDate } });
  }
  return { type: 'FeatureCollection', features };
}

// Live map data: GPS Jamming (gpsjam.org daily CSV)
async function fetchGpsJamming() {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  for (const date of [today, yesterday]) {
    try {
      const res = await fetchWithTimeout(`https://gpsjam.org/jamscore/${date}.csv`, { headers: { 'User-Agent': BROWSER_UA, Accept: 'text/csv,text/plain,*/*' } }, 15000);
      if (!res.ok) continue;
      const csv = await res.text();
      const lines = csv.trim().split('\n');
      if (lines.length < 2) continue;
      const features = [];
      for (const line of lines.slice(1)) {
        const parts = line.split(',');
        if (parts.length < 3) continue;
        const lat = parseFloat(parts[0]), lon = parseFloat(parts[1]), score = parseFloat(parts[2]);
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(score) || score < 0.3) continue;
        features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { layer: 'gpsJam', score, date } });
      }
      if (features.length) return { type: 'FeatureCollection', features, date };
    } catch { /* try next date */ }
  }
  return { type: 'FeatureCollection', features: [], fallback: true };
}

// Live map data: Active Conflicts (GDELT GKG + ACLED)
async function fetchConflictZones() {
  const GDELT_URL = 'https://api.gdeltproject.org/api/v2/geo/geo?query=conflict%20OR%20attack%20OR%20war%20OR%20battle&mode=pointdata&startdatetime=now-24h&lang=English&maxrecords=100&format=GeoJSON';
  const ACLED_URL = 'https://acleddata.com/api/acled/read?key=public&email=public@acleddata.com&event_type=Battles:Violence+against+civilians:Explosions%2FRemote+violence&limit=50&fields=event_date,event_type,country,latitude,longitude,fatalities,notes&format=json';
  const features = [];
  try {
    const res = await fetchWithTimeout(GDELT_URL, { headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json' } }, 12000);
    if (res.ok) {
      const geo = await res.json();
      for (const f of (geo.features || [])) {
        const p = f.properties || {};
        features.push({ type: 'Feature', geometry: f.geometry, properties: { layer: 'conflict', title: p.name || p.title || 'Conflict event', tone: p.tone, source: 'GDELT' } });
      }
    }
  } catch { /* fallback to ACLED */ }
  try {
    const res = await fetchWithTimeout(ACLED_URL, { headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json' } }, 12000);
    if (res.ok) {
      const j = await res.json();
      for (const ev of (j.data || [])) {
        const lat = parseFloat(ev.latitude), lon = parseFloat(ev.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { layer: 'conflict', title: `${ev.event_type} — ${ev.country}`, fatalities: ev.fatalities, date: ev.event_date, notes: (ev.notes || '').slice(0, 160), source: 'ACLED' } });
      }
    }
  } catch { /* degrade gracefully */ }
  return { type: 'FeatureCollection', features };
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

  // --- Live stock trade stream: proxy the browser <-> Finnhub's trade
  // websocket, injecting the API key into the upstream URL so it never reaches
  // the client. The browser sends {type:'subscribe'|'unsubscribe',symbol}; we
  // forward verbatim and pipe Finnhub's real-time trade ticks straight back.
  //
  // Finnhub's websocket drops with code 1006 every ~5-10s as routine server
  // behavior — a long-standing, widely-reported issue on their end (see
  // finnhubio/Finnhub-API#520), not something a well-formed client can avoid.
  // So we reconnect to Finnhub transparently here and keep the browser's
  // socket open across the drop, instead of propagating the churn to it. ---
  if (p === '/api/stocks/stream') {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected websocket', { status: 426 });
    if (!env.FINNHUB_API_KEY) return new Response('Live stream not configured', { status: 503 });

    const pair = new WebSocketPair();
    const client = pair[0], server = pair[1];
    server.accept();

    let upstream = null, closed = false, lastSub = null, reconnectAttempts = 0, reconnectTimer = null;
    const pending = [];
    // Cloudflare tears down the request's execution context once nothing is
    // pending on it — a bare setTimeout-driven reconnect loop isn't enough to
    // keep it alive across the gap between Finnhub drops. Anchor it to
    // ctx.waitUntil() with a promise that only resolves once the session ends.
    let resolveSession;
    ctx.waitUntil(new Promise((resolve) => { resolveSession = resolve; }));
    const closeAll = () => {
      closed = true;
      clearTimeout(reconnectTimer);
      try { upstream && upstream.close(); } catch {}
      try { server.close(); } catch {}
      resolveSession();
    };
    const scheduleReconnect = () => {
      if (closed) return;
      upstream = null;
      reconnectAttempts = Math.min(reconnectAttempts + 1, 8);
      // First retry is near-instant (this is Finnhub's routine flake, not an
      // outage); back off only if reconnecting itself keeps failing.
      const delay = reconnectAttempts <= 1 ? 250 : Math.min(15000, 500 * 2 ** (reconnectAttempts - 1));
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connectUpstream, delay);
    };
    const connectUpstream = async () => {
      if (closed) return;
      try {
        const resp = await fetch(`https://ws.finnhub.io?token=${env.FINNHUB_API_KEY}`, { headers: { Upgrade: 'websocket' } });
        const sock = resp.webSocket;
        if (!sock) return scheduleReconnect();
        upstream = sock;
        upstream.accept();
        reconnectAttempts = 0;
        upstream.addEventListener('message', (e) => { if (!closed) try { server.send(e.data); } catch {} });
        upstream.addEventListener('close', () => scheduleReconnect());
        upstream.addEventListener('error', () => scheduleReconnect());
        // Replay whatever subscription the client currently wants, including any
        // that queued up while we were reconnecting.
        const toSend = pending.length ? pending.splice(0) : (lastSub ? [JSON.stringify(lastSub)] : []);
        for (const m of toSend) try { upstream.send(m); } catch {}
      } catch { scheduleReconnect(); }
    };
    connectUpstream();

    server.addEventListener('message', (e) => {
      let msg; try { msg = JSON.parse(e.data); } catch { msg = null; }
      if (msg && msg.type === 'subscribe') lastSub = msg;
      else if (msg && msg.type === 'unsubscribe' && lastSub && lastSub.symbol === msg.symbol) lastSub = null;
      if (upstream) { try { upstream.send(e.data); } catch {} } else { pending.push(e.data); }
    });
    server.addEventListener('close', () => closeAll());
    server.addEventListener('error', () => closeAll());

    return new Response(null, { status: 101, webSocket: client });
  }

  // --- GLOBAL MAP layers (free public feeds, normalized + cached) ---

  if (p === '/api/map/layers') {
    try { const { data, fresh } = await getData(env, ctx, 'map:layers', fetchAugmentedLayers, 86400 * 1000); return json({ cached: !fresh, ...data }); }
    catch (err) { return json({ error: true, message: friendlyError(err) }, 502); }
  }
  if (p === '/api/map/ships') {
    try { const { data, fresh } = await getData(env, ctx, 'map:ships', () => fetchRestShips(env), 60 * 1000); return json({ cached: !fresh, ...data }); }
    catch (err) { return json({ error: true, message: friendlyError(err) }, 502); }
  }
  if (p === '/api/map/conflict') {
    try { const { data, fresh } = await getData(env, ctx, 'map:conflict', fetchConflictZones, 900 * 1000); return json({ cached: !fresh, ...data }); }
    catch (err) { return json({ error: true, message: friendlyError(err) }, 502); }
  }
  if (p === '/api/map/disease') {
    try { const { data, fresh } = await getData(env, ctx, 'map:disease', fetchDiseaseOutbreaks, 900 * 1000); return json({ cached: !fresh, ...data }); }
    catch (err) { return json({ error: true, message: friendlyError(err) }, 502); }
  }
  if (p === '/api/map/gpsjam') {
    try { const { data, fresh } = await getData(env, ctx, 'map:gpsjam', fetchGpsJamming, 21600 * 1000); return json({ cached: !fresh, ...data }); }
    catch (err) { return json({ error: true, message: friendlyError(err) }, 502); }
  }

  // ── X/Twitter sentiment ──────────────────────────────────────────────────
  if (p === '/api/sentiment/twitter') {
    const raw = (qs.get('handle') || '').replace(/[^a-zA-Z0-9_,]/g, '').slice(0, 200);
    const handles = raw ? raw.split(',').filter(Boolean) : X_ACCOUNTS;
    const cacheKey = `sentiment:twitter:${handles.slice(0, 5).join(',')}`;
    try {
      const { data, fresh } = await getData(env, ctx, cacheKey, async () => {
        const lists = await Promise.all(handles.slice(0, 8).map((h, i) =>
          sleep(i * 300).then(() => fetchXAccountFeed(h))
        ));
        const tweets = lists.flat().slice(0, 30);
        if (!tweets.length) return { score: 0, label: 'Neutral', summary: 'No tweets retrieved.', tweetCount: 0 };
        const block = tweets.map((t, i) => `${i + 1}. [${t.source}] ${t.title}`).join('\n');
        const SENT_SYS = `You are a financial sentiment analyst. Given recent market tweets, return JSON: {"score": float -1.0 to 1.0, "label": "Strongly Bullish"|"Bullish"|"Neutral"|"Bearish"|"Strongly Bearish", "summary": one sentence}. Return ONLY the JSON object.`;
        const result = await runAIJson(env, SENT_SYS,
          `Score market sentiment:\n\n${block}`,
          d => typeof d.score === 'number' && d.label && d.summary
        );
        return { ...result, tweetCount: tweets.length };
      }, 900 * 1000);
      return json({ cached: !fresh, ...data });
    } catch (err) { return json({ error: true, message: friendlyError(err) }, 502); }
  }

  // ── Macroeconomic shock simulator ────────────────────────────────────────
  if (p === '/api/macro/shock') {
    try {
      const { data, fresh } = await getData(env, ctx, 'macro:shock', async () => {
        const PIPELINE_META = {
          'Trans-Alaska Pipeline':              { commodity: 'oil', throughput_kbpd: 500   },
          'Keystone Pipeline':                  { commodity: 'oil', throughput_kbpd: 622   },
          'Enbridge Line 5':                    { commodity: 'oil', throughput_kbpd: 540   },
          'Colonial Pipeline':                  { commodity: 'oil', throughput_kbpd: 2500  },
          'Dakota Access Pipeline':             { commodity: 'oil', throughput_kbpd: 570   },
          'BTC Pipeline':                       { commodity: 'oil', throughput_kbpd: 1200  },
          'East Siberia–Pacific Ocean pipeline':{ commodity: 'oil', throughput_kbpd: 1600  },
          'Druzhba Pipeline':                   { commodity: 'oil', throughput_kbpd: 1200  },
          'Kirkuk–Ceyhan Pipeline':             { commodity: 'oil', throughput_kbpd: 600   },
          'Kazakhstan–China Pipeline':          { commodity: 'oil', throughput_kbpd: 400   },
          'SUMED Pipeline':                     { commodity: 'oil', throughput_kbpd: 2500  },
          'Nord Stream 1':                      { commodity: 'gas', throughput_mmcfd: 6000  },
          'Nord Stream 2':                      { commodity: 'gas', throughput_mmcfd: 6000  },
          'TurkStream':                         { commodity: 'gas', throughput_mmcfd: 3200  },
          'Southern Gas Corridor':              { commodity: 'gas', throughput_mmcfd: 900   },
          'Trans-Saharan Gas Pipeline':         { commodity: 'gas', throughput_mmcfd: 1060  },
          'Medgaz Pipeline':                    { commodity: 'gas', throughput_mmcfd: 400   },
        };
        let oilPrice = 75, gasPrice = 3;
        try {
          const [oilQ, gasQ] = await Promise.all([
            getQuoteCached(env, 'CL=F'), getQuoteCached(env, 'NG=F'),
          ]);
          if (oilQ?.c > 0) oilPrice = oilQ.c;
          if (gasQ?.c > 0) gasPrice = gasQ.c;
        } catch { /* use defaults */ }
        const shocks = Object.entries(PIPELINE_META).map(([name, meta]) => {
          let daily_loss_musd, disrupted_fraction;
          if (meta.commodity === 'oil') {
            daily_loss_musd    = (meta.throughput_kbpd * 1000 * oilPrice) / 1e6;
            disrupted_fraction = meta.throughput_kbpd / 100_000;
          } else {
            daily_loss_musd    = (meta.throughput_mmcfd * gasPrice * 1.036) / 1000;
            disrupted_fraction = meta.throughput_mmcfd / 100_000;
          }
          const price_shock_pct = -(1 / 0.1) * disrupted_fraction * 100;
          return {
            name, commodity: meta.commodity,
            throughput: meta.commodity === 'oil' ? `${meta.throughput_kbpd.toLocaleString()} kbpd` : `${meta.throughput_mmcfd.toLocaleString()} MMcfd`,
            spot_price: meta.commodity === 'oil' ? oilPrice : gasPrice,
            spot_unit:  meta.commodity === 'oil' ? 'USD/bbl' : 'USD/MMBtu',
            daily_loss_musd: +daily_loss_musd.toFixed(1),
            price_shock_pct: +price_shock_pct.toFixed(2),
            risk_score: Math.min(100, Math.round(Math.abs(price_shock_pct) * 2 + daily_loss_musd / 10)),
          };
        });
        shocks.sort((a, b) => b.risk_score - a.risk_score);
        return { pipelines: shocks, oil_price: oilPrice, gas_price: gasPrice, updated: Date.now() };
      }, 300 * 1000);
      return json({ cached: !fresh, ...data });
    } catch (err) { return json({ error: true, message: friendlyError(err) }, 502); }
  }

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
  if (p === '/api/map/conflictnews') {
    try { const { data, fresh } = await getData(env, ctx, 'map:gdelt', () => fetchGdeltGeo('(conflict OR war OR airstrike OR military OR protest OR clashes)'), 30 * 60 * 1000); return json({ cached: !fresh, points: data }); }
    catch (err) { return json({ error: true, message: friendlyError(err) }, 502); }
  }
  if (p === '/api/map/fires') {
    if (!env.FIRMS_MAP_KEY) return json({ error: true, message: 'FIRMS key not configured' }, 503);
    try { const { data, fresh } = await getData(env, ctx, 'map:fires', () => fetchFires(env), 30 * 60 * 1000); return json({ cached: !fresh, points: data }); }
    catch (err) { return json({ error: true, message: friendlyError(err) }, 502); }
  }
  if (p === '/api/map/webcams-live') {
    if (!env.WINDY_KEY) return json({ error: true, message: 'Windy key not configured' }, 503);
    try { const { data, fresh } = await getData(env, ctx, 'map:webcams', () => fetchWindyWebcams(env), 60 * 60 * 1000); return json({ cached: !fresh, points: data }); }
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
    if (!sym()) return json({ error: 'symbol is required' }, 400);
    if (!quotePool(env).length) return json({ error: 'No market-data provider configured.' }, 500);
    return json(await getQuoteCached(env, sym()));
  }
  if (p === '/api/data-status') {
    const pool = quotePool(env);
    return json({ providers: pool.map((p) => p.name), count: pool.length });
  }
  if (p === '/api/profile') {
    if (!sym()) return json({ error: 'symbol is required' }, 400);
    const s = sym();
    const fh = await finnhub(env, '/stock/profile2', { symbol: s }).catch(() => ({}));
    // If Finnhub returned empty critical fields (common for ETFs / foreign tickers), enrich
    // with TwelveData profile, then Alpha Vantage OVERVIEW as a second fallback.
    const missing = !fh || (!fh.finnhubIndustry && !fh.country && !fh.weburl);
    if (missing) {
      if (env.TWELVEDATA_KEY) {
        try {
          const td = await fetchWithTimeout(`https://api.twelvedata.com/profile?symbol=${encodeURIComponent(s)}&apikey=${env.TWELVEDATA_KEY}`, {}, 8000).then((r) => r.ok ? r.json() : null);
          if (td && td.name) {
            fh.name = fh.name || td.name;
            fh.finnhubIndustry = fh.finnhubIndustry || td.sector || td.industry || '';
            fh.country = fh.country || td.country || '';
            fh.weburl = fh.weburl || td.website || '';
            fh.description = td.description || '';
          }
        } catch {}
      }
      if (!fh.finnhubIndustry && env.ALPHAVANTAGE_KEY) {
        try {
          const av = await fetchWithTimeout(`https://www.alphavantage.co/query?function=OVERVIEW&symbol=${encodeURIComponent(s)}&apikey=${env.ALPHAVANTAGE_KEY}`, {}, 8000).then((r) => r.ok ? r.json() : null);
          if (av && av.Name) {
            fh.name = fh.name || av.Name;
            fh.finnhubIndustry = fh.finnhubIndustry || av.Industry || av.Sector || '';
            fh.country = fh.country || av.Country || '';
            fh.weburl = fh.weburl || av.OfficialSite || '';
            fh.exchange = fh.exchange || av.Exchange || '';
            fh.ipo = fh.ipo || av.IPODate || '';
          }
        } catch {}
      }
    }
    return json(fh || {});
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
    // 15s stale-while-revalidate: the tape polls often, but the basket only needs
    // to change every few seconds — keeps us comfortably under Finnhub's limit.
    const { data } = await getData(env, ctx, 'ticker', async () => Promise.all(basket.map(async (symbol) => {
      try { const q = await finnhub(env, '/quote', { symbol }); return { symbol, price: q.c ?? 0, change: q.d ?? 0, percent: q.dp ?? 0 }; }
      catch { return { symbol, price: 0, change: 0, percent: 0 }; }
    })), 15 * 1000);
    return json(data);
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
  if (p === '/api/intel/candles') {
    const symbol = (qs.get('symbol') || qs.get('q') || '').trim().toUpperCase().slice(0, 10);
    const range = (qs.get('range') || '1D').toUpperCase();
    if (!symbol) return json({ error: true, message: 'Missing symbol.' }, 400);
    if (!YAHOO_RANGE[range]) return json({ error: true, message: 'Invalid range.' }, 400);
    try {
      const cacheKey = `candles:${symbol.toLowerCase()}:${range.toLowerCase()}`;
      const { data, fresh } = await getData(env, ctx, cacheKey, () => fetchCandleAnalysis(env, ctx, symbol, range), 5 * 60 * 1000);
      return json({ cached: !fresh, ...data });
    } catch (err) { return json({ error: true, message: friendlyError(err) }, 500); }
  }
  if (p === '/api/intel/situation') {
    try {
      if (qs.get('nocache')) return json({ cached: false, ...(await fetchSituation(env)) });
      const { data, fresh } = await getData(env, ctx, 'situation', () => fetchSituation(env)); return json({ cached: !fresh, ...data });
    } catch (err) { return json({ error: true, message: friendlyError(err) }, 500); }
  }
  if (p === '/api/intel/instability') {
    try { const { data, fresh } = await getData(env, ctx, 'instability', () => fetchInstability(env)); return json({ cached: !fresh, ...data }); }
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

  // --- Infrastructure map data ---
  if (p === '/api/map/infrastructure') {
    const cacheKey = 'cache:map:infrastructure';
    const cached = await env.MT_KV.get(cacheKey).catch(() => null);
    if (cached) return json(JSON.parse(cached));
    const data = await buildInfrastructureData(env);
    await env.MT_KV.put(cacheKey, JSON.stringify(data), { expirationTtl: 86400 }).catch(() => {});
    return json(data);
  }

  // --- Price action AI explainer ---
  if (p === '/api/intel/priceaction') {
    const sym = url.searchParams.get('symbol') || '';
    if (!sym) return json({ error: 'symbol required' }, 400);
    const cacheKey = `cache:priceaction:${sym.toUpperCase()}`;
    const cached = await env.MT_KV.get(cacheKey).catch(() => null);
    if (cached) return json(JSON.parse(cached));
    const result = await fetchPriceAction(env, sym.toUpperCase());
    await env.MT_KV.put(cacheKey, JSON.stringify(result), { expirationTtl: 600 }).catch(() => {});
    return json(result);
  }

  return json({ error: 'Not found' }, 404);
}

// ─── Infrastructure Data ───────────────────────────────────────────────────

const INFRA_PIPELINES = [
  { id: 'keystone-xl', name: 'Keystone XL Corridor', type: 'oil', status: 'operational',
    capacity_kbd: 590, substance: 'crude', operator: 'TC Energy',
    beneficiaries: ['Canada', 'USA (Midwest refiners)'], risks: ['Spill risk near Ogallala Aquifer'],
    coords: [[-111.4,49.0],[-104.5,45.5],[-100.8,42.8],[-97.4,39.1],[-94.1,35.9]] },
  { id: 'nord-stream-2', name: 'Nord Stream 2', type: 'gas', status: 'sabotaged',
    capacity_bcmd: 55, substance: 'natural gas', operator: 'Gazprom',
    beneficiaries: ['Germany','EU'], risks: ['Geopolitical weapon; offline since 2022 sabotage'],
    coords: [[28.0,57.5],[18.5,55.8],[14.0,54.5],[12.5,54.8],[13.4,54.1]] },
  { id: 'druzhba', name: 'Druzhba Pipeline', type: 'oil', status: 'operational',
    capacity_kbd: 1200, substance: 'crude', operator: 'Transneft',
    beneficiaries: ['Russia','Poland','Germany','Hungary','Czech Republic'],
    risks: ['Sanctions risk; transit through Ukraine'],
    coords: [[56.0,52.0],[39.0,50.5],[28.5,49.5],[23.0,51.5],[18.0,52.0],[14.0,51.0],[12.5,52.5]] },
  { id: 'tapline', name: 'Trans-Arabian Pipeline', type: 'oil', status: 'mothballed',
    capacity_kbd: 500, substance: 'crude', operator: 'Aramco',
    beneficiaries: ['Saudi Arabia (historical)'], risks: ['Offline; geopolitical legacy asset'],
    coords: [[50.1,26.3],[44.0,29.5],[39.1,32.0],[35.9,33.5],[35.5,34.8]] },
  { id: 'baku-tbilisi-ceyhan', name: 'Baku-Tbilisi-Ceyhan', type: 'oil', status: 'operational',
    capacity_kbd: 1200, substance: 'crude', operator: 'BP',
    beneficiaries: ['Azerbaijan','Georgia','Turkey','EU'],
    risks: ['Conflict zone exposure (Nagorno-Karabakh corridor)'],
    coords: [[50.0,40.4],[46.0,41.7],[44.5,41.7],[41.0,41.0],[36.8,37.0],[35.9,36.8]] },
  { id: 'transcanada-mainline', name: 'TransCanada Mainline', type: 'gas', status: 'operational',
    capacity_bcmd: 157, substance: 'natural gas', operator: 'TC Energy',
    beneficiaries: ['Canada','USA'], risks: ['Aging infrastructure; regulatory pressure'],
    coords: [[-114.1,51.1],[-106.7,52.1],[-96.8,49.9],[-87.6,43.6],[-79.4,43.7],[-73.6,45.5]] },
  { id: 'west-east-gas', name: 'China West-East Gas Pipeline', type: 'gas', status: 'operational',
    capacity_bcmd: 30, substance: 'natural gas', operator: 'PetroChina',
    beneficiaries: ['China (Xinjiang to Shanghai)'], risks: ['Seismic risk; political stability in Xinjiang'],
    coords: [[75.9,39.5],[87.6,41.8],[99.5,38.5],[106.7,34.3],[113.0,32.0],[118.8,32.1],[121.5,31.2]] },
  { id: 'sumed', name: 'SUMED Pipeline', type: 'oil', status: 'operational',
    capacity_kbd: 2500, substance: 'crude', operator: 'SUMED Co.',
    beneficiaries: ['Egypt','Arabian Gulf producers','Europe'],
    risks: ['Suez bypass; critical if canal disrupted'],
    coords: [[32.3,29.9],[31.5,30.5],[29.9,31.2],[29.1,30.8]] },
  { id: 'eastern-siberia-pacific', name: 'ESPO Pipeline', type: 'oil', status: 'operational',
    capacity_kbd: 1600, substance: 'crude', operator: 'Transneft',
    beneficiaries: ['Russia','China','Japan (Kozmino terminal)'],
    risks: ['Sanctions exposure; permafrost ground shift'],
    coords: [[107.5,52.3],[116.5,51.0],[122.0,50.0],[128.5,48.5],[131.9,48.5],[132.9,42.8]] },
  { id: 'colonial-pipeline', name: 'Colonial Pipeline', type: 'oil', status: 'operational',
    capacity_kbd: 2500, substance: 'refined products', operator: 'Colonial Pipeline Co.',
    beneficiaries: ['USA Southeast & East Coast'], risks: ['Cyberattack vector (2021 ransomware)'],
    coords: [[-84.4,33.7],[-83.0,32.1],[-80.9,33.9],[-78.6,35.8],[-77.0,38.9],[-75.1,39.9],[-74.2,40.7]] },
  { id: 'iran-pakistan', name: 'Iran-Pakistan Pipeline', type: 'gas', status: 'partial',
    capacity_bcmd: 21.5, substance: 'natural gas', operator: 'NIGC/SSGC',
    beneficiaries: ['Iran','Pakistan'], risks: ['US sanctions; incomplete on Pakistan side'],
    coords: [[56.3,27.2],[62.3,27.3],[67.0,25.3],[67.5,24.9]] },
  { id: 'transmed', name: 'TransMed (ENI) Pipeline', type: 'gas', status: 'operational',
    capacity_bcmd: 33.5, substance: 'natural gas', operator: 'ENI/SONATRACH',
    beneficiaries: ['Algeria','Tunisia','Italy'],
    risks: ['North Africa instability'],
    coords: [[6.1,36.8],[10.2,37.1],[10.6,37.5],[11.6,37.4],[12.3,37.7],[12.5,38.1],[13.3,38.1],[14.2,40.8]] },
  { id: 'tzpf', name: 'Trans-Saharan Gas Pipeline', type: 'gas', status: 'planned',
    capacity_bcmd: 30, substance: 'natural gas', operator: 'NNPC/SONATRACH',
    beneficiaries: ['Nigeria','Niger','Algeria','Europe'],
    risks: ['Sahel instability; financing gaps'],
    coords: [[7.5,4.0],[7.5,10.0],[8.5,16.0],[5.5,20.0],[2.5,24.0],[6.5,29.0],[6.1,36.8]] },
  { id: 'tapgas', name: 'Trans-Adriatic Pipeline', type: 'gas', status: 'operational',
    capacity_bcmd: 10, substance: 'natural gas', operator: 'TAP AG',
    beneficiaries: ['Azerbaijan','Greece','Albania','Italy'],
    risks: ['Limited capacity; expansion in progress'],
    coords: [[48.9,40.5],[40.0,41.0],[26.5,41.0],[21.0,41.1],[19.8,41.3],[18.8,41.1],[15.8,41.0]] },
  { id: 'turkstream', name: 'TurkStream', type: 'gas', status: 'operational',
    capacity_bcmd: 31.5, substance: 'natural gas', operator: 'Gazprom/BOTAŞ',
    beneficiaries: ['Russia','Turkey','SE Europe'],
    risks: ['Geopolitical leverage tool; sanctions risk'],
    coords: [[37.7,45.4],[37.0,43.0],[36.5,41.5],[32.5,40.9],[28.8,41.0],[26.2,41.7],[22.9,41.1]] },
  { id: 'mopac', name: 'Mozambique LNG Corridor', type: 'gas', status: 'construction',
    capacity_bcmd: 12.9, substance: 'LNG', operator: 'TotalEnergies',
    beneficiaries: ['Mozambique','France','Asia-Pacific buyers'],
    risks: ['Insurgency in Cabo Delgado; force majeure 2021'],
    coords: [[40.5,-10.7],[40.3,-12.2],[40.4,-13.2],[40.7,-14.5]] },
  { id: 'gcc-interconnection', name: 'GCC Gas Interconnection', type: 'gas', status: 'operational',
    capacity_bcmd: 2, substance: 'natural gas', operator: 'GICO',
    beneficiaries: ['Kuwait','Saudi Arabia','Bahrain','UAE','Oman'],
    risks: ['Limited capacity; regional backup only'],
    coords: [[47.9,29.4],[50.6,26.2],[50.5,25.9],[51.5,25.3],[54.4,24.1],[57.6,23.6]] },
  { id: 'southern-gas-corridor', name: 'Southern Gas Corridor', type: 'gas', status: 'operational',
    capacity_bcmd: 16, substance: 'natural gas', operator: 'BP/SOCAR',
    beneficiaries: ['Azerbaijan','Turkey','EU'],
    risks: ['Geopolitical exposure crossing multiple jurisdictions'],
    coords: [[50.0,40.4],[46.0,41.7],[43.3,41.7],[40.0,40.2],[35.0,38.5],[28.8,41.0],[26.5,41.0]] },
  { id: 'alaska-highway', name: 'Alaska Highway Pipeline', type: 'gas', status: 'planned',
    capacity_bcmd: 4.5, substance: 'natural gas', operator: 'AK LNG Project',
    beneficiaries: ['Alaska','Canada','US Pacific Coast'],
    risks: ['Financing uncertainty; permafrost engineering challenges'],
    coords: [[-162.0,60.5],[-149.9,61.2],[-141.0,60.5],[-135.0,59.6],[-129.0,56.8],[-122.8,49.3]] },
  { id: 'midal', name: 'MIDAL Gas Pipeline', type: 'gas', status: 'operational',
    capacity_bcmd: 3.5, substance: 'natural gas', operator: 'Wintershall',
    beneficiaries: ['Germany (North-South distribution)'],
    risks: ['Aging; grid transition pressure'],
    coords: [[10.0,53.5],[9.8,51.0],[9.5,48.8],[10.2,47.5]] },
];

const INFRA_CABLES = [
  { id: 'marea', name: 'MAREA', type: 'undersea_cable', status: 'active',
    capacity_tbps: 200, owner: 'Microsoft/Facebook',
    beneficiaries: ['USA','Spain','EU'], risks: ['Single landing point vulnerability'],
    coords: [[-74.0,40.7],[-40.0,35.0],[-10.0,37.0],[-3.7,40.4]] },
  { id: 'aae-1', name: 'AAE-1', type: 'undersea_cable', status: 'active',
    capacity_tbps: 40, owner: 'Consortium (China Unicom, Telia, etc.)',
    beneficiaries: ['Asia','Africa','Europe'], risks: ['Red Sea chokepoint risk'],
    coords: [[121.5,31.2],[110.4,20.0],[103.8,1.4],[80.3,13.1],[72.8,18.9],[45.3,12.5],[43.1,11.6],[36.8,11.8],[32.5,31.2],[32.3,30.1],[14.0,40.8],[12.5,41.9]] },
  { id: 'sea-me-we-5', name: 'SEA-ME-WE 5', type: 'undersea_cable', status: 'active',
    capacity_tbps: 24, owner: 'Orange/SingTel Consortium',
    beneficiaries: ['Singapore','South Asia','Middle East','Europe'],
    risks: ['Monsoon anchor drags; Gulf of Aden piracy zone'],
    coords: [[103.8,1.4],[82.3,6.9],[73.0,18.9],[55.4,23.6],[43.3,11.5],[32.5,31.0],[14.0,40.8],[2.3,48.9],[-8.7,41.5]] },
  { id: 'dunant', name: 'Dunant (Google)', type: 'undersea_cable', status: 'active',
    capacity_tbps: 250, owner: 'Google',
    beneficiaries: ['USA','France'], risks: ['Sole owner concentration risk'],
    coords: [[-74.0,40.7],[-45.0,36.0],[-10.0,44.0],[-1.6,48.7]] },
  { id: 'jupiter', name: 'Jupiter', type: 'undersea_cable', status: 'active',
    capacity_tbps: 60, owner: 'Facebook/PLDT/SoftBank',
    beneficiaries: ['USA Pacific','Japan','Philippines'],
    risks: ['Pacific seismic zones'],
    coords: [[-122.4,37.8],[-145.0,35.0],[145.0,35.0],[139.7,35.7],[123.9,10.3],[124.0,11.6]] },
  { id: 'apcn-2', name: 'APCN-2', type: 'undersea_cable', status: 'active',
    capacity_tbps: 2.56, owner: 'AT&T/KDD Consortium',
    beneficiaries: ['Asia-Pacific ring'], risks: ['Aging infrastructure; South China Sea dispute zones'],
    coords: [[139.7,35.7],[129.0,35.1],[122.5,31.2],[117.2,39.9],[126.9,37.5],[139.7,35.7]] },
  { id: 'havfrue', name: 'HAVFRUE / AEC-1', type: 'undersea_cable', status: 'active',
    capacity_tbps: 69, owner: 'Google/Facebook/Aqua Comms',
    beneficiaries: ['USA','Denmark','Ireland','Norway'],
    risks: ['Arctic routing; trawl damage risk'],
    coords: [[-74.0,40.7],[-45.0,52.0],[-13.8,53.0],[-8.0,51.9],[10.0,57.9],[10.7,59.9]] },
  { id: 'africa-coast-europe', name: 'Africa Coast to Europe', type: 'undersea_cable', status: 'active',
    capacity_tbps: 5.12, owner: 'Orange/MTN Consortium',
    beneficiaries: ['38 African countries','Europe'],
    risks: ['Multiple landing points near conflict zones (West Africa)'],
    coords: [[2.3,48.9],[0.0,45.0],[-8.0,38.7],[-17.0,28.5],[-17.4,14.7],[-10.8,6.3],[2.4,5.6],[9.4,3.9],[13.7,-4.3],[18.4,-33.9]] },
  { id: 'echo', name: 'Echo (Google/Meta)', type: 'undersea_cable', status: 'active',
    capacity_tbps: 480, owner: 'Google/Meta',
    beneficiaries: ['USA','Singapore','Guam'],
    risks: ['Pacific Ring of Fire; earthquake vulnerability'],
    coords: [[-122.4,37.8],[-165.0,20.0],[144.7,13.5],[103.8,1.4]] },
  { id: 'south-atlantic-express', name: 'SAEx', type: 'undersea_cable', status: 'planned',
    capacity_tbps: 60, owner: 'SAEx International',
    beneficiaries: ['Brazil','South Africa'],
    risks: ['Financing uncertainty; single route redundancy'],
    coords: [[-43.2,-22.9],[-25.0,-30.0],[-5.0,-35.0],[18.4,-33.9]] },
  { id: 'imewe', name: 'IMEWE', type: 'undersea_cable', status: 'active',
    capacity_tbps: 3.84, owner: 'Consortium',
    beneficiaries: ['India','Middle East','West Europe'],
    risks: ['Red Sea/Suez disruption risk (Houthi attacks 2024)'],
    coords: [[72.8,18.9],[60.0,22.0],[45.0,12.0],[32.5,29.5],[32.3,31.2],[14.0,40.8],[2.3,48.9]] },
  { id: 'pacific-light-cable', name: 'Pacific Light Cable Network', type: 'undersea_cable', status: 'partial',
    capacity_tbps: 120, owner: 'Google/Meta (partial; China segment blocked)',
    beneficiaries: ['USA','Taiwan','Philippines'],
    risks: ['Geopolitical: US blocked Hong Kong segment (FCC 2021)'],
    coords: [[-118.2,33.8],[-155.0,25.0],[121.9,25.0],[124.0,11.6],[122.5,31.2]] },
];

const INFRA_ROUTES = [
  { id: 'malacca', name: 'Strait of Malacca', type: 'trade_route',
    throughput_ships_day: 85, cargo_types: ['Oil','LNG','Electronics','Consumer goods'],
    beneficiaries: ['China','Japan','South Korea','EU'],
    risks: ['Piracy; chokepoint—40% of world trade'],
    coords: [[103.8,1.4],[103.4,2.9],[102.9,4.9],[101.5,5.4],[100.3,5.9],[99.0,6.5]] },
  { id: 'suez', name: 'Suez Canal / Red Sea', type: 'trade_route',
    throughput_ships_day: 51, cargo_types: ['Oil','Containers','LNG'],
    beneficiaries: ['Europe','Asia'], risks: ['Houthi attacks (2024); blocking incidents'],
    coords: [[32.3,29.9],[33.0,27.5],[36.0,22.0],[43.0,13.0],[45.3,12.5],[50.5,11.5]] },
  { id: 'hormuz', name: 'Strait of Hormuz', type: 'trade_route',
    throughput_ships_day: 21, cargo_types: ['Crude Oil (21 mbd)','LNG'],
    beneficiaries: ['Gulf producers','Asia-Pacific importers'],
    risks: ['Iran threat; closure = $6T/yr disruption'],
    coords: [[56.5,24.0],[57.0,23.5],[57.5,23.2],[58.5,22.8],[59.5,22.2],[60.5,22.0]] },
  { id: 'bab-el-mandeb', name: 'Bab-el-Mandeb Strait', type: 'trade_route',
    throughput_ships_day: 48, cargo_types: ['Oil','Containers'],
    beneficiaries: ['Europe','Asia'],
    risks: ['Houthi missile attacks (2024); Yemen instability'],
    coords: [[43.1,11.6],[43.3,12.5],[43.5,13.4],[44.0,14.5]] },
  { id: 'panama-canal', name: 'Panama Canal', type: 'trade_route',
    throughput_ships_day: 40, cargo_types: ['LNG','Containers','Grain'],
    beneficiaries: ['USA','Asia'], risks: ['Drought-induced low water (2023); capacity cuts'],
    coords: [[-79.9,9.4],[-79.7,9.1],[-79.5,8.9],[-79.5,8.6],[-79.6,8.4]] },
  { id: 'cape-good-hope', name: 'Cape of Good Hope Route', type: 'trade_route',
    throughput_ships_day: 35, cargo_types: ['VLCC Tankers','Bulk'],
    beneficiaries: ['Diversionary route (Suez alternative)'],
    risks: ['Storms; +2 weeks vs Suez; high operating cost'],
    coords: [[18.4,-33.9],[10.0,-38.0],[0.0,-40.0],[-10.0,-38.0],[-20.0,-32.0]] },
  { id: 'northern-sea-route', name: 'Northern Sea Route', type: 'trade_route',
    throughput_ships_day: 4, cargo_types: ['LNG (Russia)','Bulk'],
    beneficiaries: ['Russia','China (Arctic gateway)'],
    risks: ['Ice conditions; sanctions; icebreaker dependency'],
    coords: [[60.0,68.0],[80.0,72.0],[100.0,73.5],[120.0,73.0],[140.0,72.0],[160.0,70.0],[180.0,68.0]] },
  { id: 'taiwan-strait', name: 'Taiwan Strait', type: 'trade_route',
    throughput_ships_day: 200, cargo_types: ['Semiconductors','Electronics','Oil'],
    beneficiaries: ['East Asia tech supply chain'],
    risks: ['China-Taiwan military tension; semiconductor supply chain'],
    coords: [[120.0,26.0],[120.2,24.5],[120.4,22.5],[120.5,21.0]] },
  { id: 'dover-strait', name: 'English Channel / Dover Strait', type: 'trade_route',
    throughput_ships_day: 500, cargo_types: ['Containers','Oil','Consumer goods'],
    beneficiaries: ['UK','EU'], risks: ['Busiest shipping lane; accident risk; Brexit logistics'],
    coords: [[-4.0,48.5],[0.0,50.5],[1.4,51.0],[2.0,51.3],[3.0,51.5]] },
  { id: 'danish-straits', name: 'Danish Straits (Kattegat/Øresund)', type: 'trade_route',
    throughput_ships_day: 90, cargo_types: ['Oil (Russia→Baltic)','Baltic trade'],
    beneficiaries: ['Baltic states','Nordic countries'],
    risks: ['Russia oil sanctions enforcement; Baltic security'],
    coords: [[12.6,55.7],[12.0,56.3],[11.0,57.5],[10.5,58.5],[10.0,59.0]] },
];

async function buildInfrastructureData(env) {
  // Try live Overpass API for pipeline data, merge with curated sets
  let livePipelines = [];
  try {
    const overpassQuery = `[out:json][timeout:25];(way["man_made"="pipeline"]["substance"~"oil|gas",i](bbox:-60,-170,75,180););out geom 100;`;
    const res = await fetchWithTimeout(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(overpassQuery)}`, {}, 20000);
    if (res.ok) {
      const d = await res.json();
      if (d.elements && d.elements.length > 0) {
        livePipelines = d.elements.slice(0, 30).map(el => ({
          id: `osm_${el.id}`,
          name: el.tags?.name || `${el.tags?.substance || 'Unknown'} Pipeline`,
          type: (el.tags?.substance || '').toLowerCase().includes('gas') ? 'gas' : 'oil',
          status: 'operational',
          capacity_kbd: null,
          substance: el.tags?.substance || 'unknown',
          operator: el.tags?.operator || 'Unknown',
          beneficiaries: [], risks: ['Live OSM data'],
          coords: (el.geometry || []).filter((_, i) => i % 5 === 0).map(n => [n.lon, n.lat]),
          source: 'osm'
        })).filter(p => p.coords.length >= 2);
      }
    }
  } catch (_) { /* use curated only */ }

  return {
    pipelines: [...INFRA_PIPELINES, ...livePipelines],
    cables: INFRA_CABLES,
    routes: INFRA_ROUTES,
    generated: Date.now(),
    ttl: 86400,
  };
}

// ─── Price Action AI Explainer ─────────────────────────────────────────────

async function fetchPriceAction(env, symbol) {
  // Fetch quote + recent news in parallel
  const [quoteResult, newsResult] = await Promise.allSettled([
    getQuoteCached(env, symbol),
    fetchIntelNews(env).catch(() => []),
  ]);

  const quote = quoteResult.status === 'fulfilled' ? quoteResult.value : null;
  const allNews = newsResult.status === 'fulfilled' ? newsResult.value : [];

  // Filter news relevant to this symbol or its company
  const relevant = allNews.filter(n => {
    const text = ((n.title || '') + ' ' + (n.summary || '')).toLowerCase();
    return text.includes(symbol.toLowerCase()) || (quote && quote.name && text.includes((quote.name || '').toLowerCase().split(' ')[0]));
  }).slice(0, 6);

  const priceChange = quote && quote.change != null ? quote.change : 0;
  const pctChange  = quote && quote.changePercent != null ? quote.changePercent : 0;
  const direction  = pctChange >= 0 ? 'rising' : 'falling';

  const prompt = [
    `You are a sell-side equity analyst. Explain concisely in 2-3 sentences why ${symbol} is ${direction} today.`,
    `Price: $${quote?.price?.toFixed(2) ?? 'N/A'} (${pctChange >= 0 ? '+' : ''}${pctChange.toFixed(2)}%, ${priceChange >= 0 ? '+' : ''}${priceChange.toFixed(2)}).`,
    relevant.length > 0
      ? `Recent headlines:\n` + relevant.map(n => `- ${n.title}`).join('\n')
      : 'No directly relevant headlines found.',
    `Be specific. Reference the headlines if they explain the move. If news is absent, cite macro conditions or technicals.`,
  ].join('\n');

  try {
    const explanation = await runAIJson(env, prompt, {
      task_type: 'nlp',
      schema: { type: 'object', properties: { explanation: { type: 'string' }, catalysts: { type: 'array', items: { type: 'string' } }, sentiment: { type: 'string', enum: ['bullish','bearish','neutral'] } }, required: ['explanation','catalysts','sentiment'] },
    });
    return { symbol, quote, direction, change: pctChange, explanation: explanation.explanation, catalysts: explanation.catalysts || [], sentiment: explanation.sentiment || 'neutral', headlines: relevant };
  } catch (_) {
    return { symbol, quote, direction, change: pctChange, explanation: `${symbol} is ${direction} ${Math.abs(pctChange).toFixed(2)}% today. No AI analysis available.`, catalysts: [], sentiment: pctChange >= 0 ? 'bullish' : 'bearish', headlines: relevant };
  }
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
