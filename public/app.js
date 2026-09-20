'use strict';

/* ════════════════════════════════════════════════════════════════
   Market Terminal — frontend
   Vanilla JS. Talks only to our own /api/* proxy (never to providers
   directly), so the Finnhub key stays server-side.
   ════════════════════════════════════════════════════════════════ */

const DEFAULT_SYMBOL = 'AAPL';
const QUOTE_REFRESH_MS = 2_000;   // fast poll → live-feeling price + chart edge
const TAPE_REFRESH_MS = 30_000;
const CHART_REFRESH_MS = 60_000;  // full chart re-fetch (the live edge is handled by the poll)

let currentView = 'terminal'; // tracked so live refreshers only fire for the visible view

const state = {
  symbol: null,
  range: '1D',
  chartType: 'line', // 'line' | 'candle'
  chart: null,      // last { points, meta } payload
  quote: null,      // last quote payload (for current price reference)
  lowerOsc: 'MACD', // 'MACD' | 'CCI' | 'WR'
  showKC: true,     // Keltner Channel overlay
  showMC: false,    // Monte Carlo forward fan
};

// ───────────────────────── market context (MT2-3 TWINCORE) ─────────────────────────
// The canonical definitions live in shared/market-core.js and arrive via /api/market.
// This fallback only carries what the shell needs to boot offline; holidays and
// benchmarks come from the catalog, so without it the status is weekday-only.
const MARKET_FALLBACK = {
  US: { id: 'US', label: 'US', currency: 'USD', currencySymbol: '$', locale: 'en-US', timezone: 'America/New_York', tzLabel: 'ET', exchangeLabel: 'NYSE · Nasdaq', sessionLabel: 'NYSE · Nasdaq · ET', session: { open: '09:30', close: '16:00', preOpen: '04:00', postClose: '20:00', earlyClose: '13:00' }, calendar: { holidays: [], earlyClose: [] }, defaultSymbol: 'AAPL', benchmarks: [], quantBenchmark: { symbol: 'SPY', label: 'SPY' } },
  IN: { id: 'IN', label: 'India', currency: 'INR', currencySymbol: '₹', locale: 'en-IN', timezone: 'Asia/Kolkata', tzLabel: 'IST', exchangeLabel: 'NSE · BSE', sessionLabel: 'NSE · BSE · IST', session: { open: '09:15', close: '15:30', preOpen: '09:00', postClose: '16:00', earlyClose: null }, calendar: { holidays: [], earlyClose: [] }, defaultSymbol: 'RELIANCE', benchmarks: [], quantBenchmark: { symbol: '^NSEI', label: 'NIFTY 50' } },
};
const Market = {
  id: 'US',
  catalog: null,
  def() {
    const fromCatalog = this.catalog && Array.isArray(this.catalog.markets) && this.catalog.markets.find((m) => m.id === this.id);
    return fromCatalog || MARKET_FALLBACK[this.id] || MARKET_FALLBACK.US;
  },
  qs() { return `&market=${encodeURIComponent(this.id)}`; },
  tz() { return this.def().timezone; },
  tzLabel() { return this.def().tzLabel; },
};
// Truth vocabulary → QUARTZ `.fresh` keys (mirrors market-core TRUTH_TO_FRESH).
const TRUTH_FRESH = { REALTIME: 'live', DELAYED: 'delayed', SNAPSHOT: 'snapshot', EOD: 'eod', CACHED: 'cached', LAST_GOOD: 'last-good', UNAVAILABLE: 'unavailable' };
const TRUTH_LABEL = { REALTIME: 'Live', DELAYED: 'Delayed', SNAPSHOT: 'Snapshot', EOD: 'End of day', CACHED: 'Cached', LAST_GOOD: 'Last good', UNAVAILABLE: 'Unavailable' };
function truthBadge(el, truth) {
  if (!el) return;
  const key = TRUTH_FRESH[truth] || 'unavailable';
  el.dataset.fresh = key;
  el.textContent = TRUTH_LABEL[truth] || 'Unavailable';
}

window.MarketTerminal = window.MarketTerminal || {};
window.MarketTerminal.getMarketContext = () => ({ id: Market.id, ...Market.def() });
/**
 * Canonical map → security path (MT2-4 ATLAS). Accepts a TWINCORE identity
 * ('IN:NSE:RELIANCE') or { market, symbol }; switches market context when needed and lands on
 * the Terminal (default) or Deep Dive. Never accepts provider spellings such as RELIANCE.NS.
 */
window.MarketTerminal.openSecurity = (target, view = 'terminal') => {
  let market = null, symbol = null;
  if (typeof target === 'string') {
    const m = /^([A-Z]{2}):([A-Z]+):([A-Z0-9&.^-]+)$/i.exec(target.trim());
    if (!m || /\.(NS|BO)$/i.test(m[3])) return false;
    market = m[1].toUpperCase(); symbol = m[3].toUpperCase();
  } else if (target && target.symbol) {
    market = String(target.market || Market.id).toUpperCase(); symbol = String(target.symbol).toUpperCase();
  }
  if (!symbol || !Shell || !Shell.market(market)) return false;
  if (market !== Market.id) setMarket(market); // full context switch: tape, benchmarks, sentiment follow
  if (view === 'deepdive') {
    navigateTo('research/analyze');
    document.dispatchEvent(new CustomEvent('mt:deepdive', { detail: { symbol, market } }));
  } else {
    navigateTo('terminal');
    loadSymbol(symbol);
  }
  return true;
};
window.MarketTerminal.getSymbolContext = () => ({
  symbol: state.symbol,
  lastPrice: Number.isFinite(Number(state.quote?.c)) ? Number(state.quote.c) : null,
});

function notifySymbolContext() {
  document.dispatchEvent(new CustomEvent('marketsymbolchange', {
    detail: window.MarketTerminal.getSymbolContext(),
  }));
}

// MC fan state — generated per symbol/range, drawn via RAF
const _mc = { symbol: null, range: null, paths: null, rafId: null, model: 'RJD' };

// ───────────────────────── tiny helpers ─────────────────────────
const $ = (id) => document.getElementById(id);
const escHtml = (value) => String(value == null ? '' : value).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

function safeHttpUrl(value) {
  try {
    const url = new URL(String(value || ''), location.href);
    return /^https?:$/i.test(url.protocol) ? url.toString() : '';
  } catch {
    return '';
  }
}

function clearChildren(node) {
  if (!node) return;
  while (node.firstChild) node.removeChild(node.firstChild);
}

async function getJSON(url) {
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function fmtPrice(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  // Digit grouping follows the active market (en-IN → 1,22,640.40); the currency
  // itself is shown as a code/symbol next to the number, never assumed.
  return Number(n).toLocaleString(Market.def().locale || 'en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtMoney(n) {
  const v = fmtPrice(n);
  return v === '—' ? v : `${Market.def().currencySymbol || ''}${v}`;
}

function fmtSigned(n, decimals = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const sign = n > 0 ? '+' : '';
  return sign + Number(n).toFixed(decimals);
}

/** Market cap arrives in MILLIONS from Finnhub -> T / B / M string. */
function fmtMarketCap(millions) {
  if (!millions || Number.isNaN(millions)) return '—';
  const v = millions * 1e6;
  if (v >= 1e12) return '$' + (v / 1e12).toFixed(2) + 'T';
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M';
  return '$' + v.toFixed(0);
}

function relativeTime(unixSeconds) {
  const diff = Date.now() / 1000 - unixSeconds;
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  return Math.floor(diff / 86400) + 'd ago';
}

function setStatus(msg) {
  $('statusMsg').textContent = msg;
}

function colorClass(n) {
  if (n > 0) return 'up';
  if (n < 0) return 'down';
  return '';
}

// ───────────────────────── clock + market status ─────────────────────────
function tickClock() {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-US', {
    timeZone: Market.tz(),
    hour12: false,
  });
  const clock = $('clock');
  clock.textContent = `${timeStr} ${Market.tzLabel()}`;
  clock.setAttribute('aria-label', Market.tzLabel() === 'IST' ? 'India Standard Time' : 'Eastern time');
  updateMarketStatus(now);
}

// NYSE holidays and early-close days (1:00 PM ET). Covers 2025–2027.
// Early closes: day before Independence Day, Thanksgiving, Christmas (when applicable).
const NYSE_HOLIDAYS = new Set([
  // 2025
  '2025-01-01','2025-01-09','2025-01-20','2025-02-17','2025-04-18',
  '2025-05-26','2025-06-19','2025-07-04','2025-09-01','2025-11-27',
  '2025-12-25',
  // 2026
  '2026-01-01','2026-01-19','2026-02-16','2026-04-03',
  '2026-05-25','2026-06-19','2026-07-03', // Jul 4 falls Sat → observed Fri Jul 3
  '2026-09-07','2026-11-26','2026-12-25',
  // 2027
  '2027-01-01','2027-01-18','2027-02-15','2027-03-26',
  '2027-05-31','2027-06-18', // Jun 19 falls Sat → observed Fri Jun 18
  '2027-07-05', // Jul 4 falls Sun → observed Mon Jul 5
  '2027-09-06','2027-11-25','2027-12-24', // Dec 25 falls Sat → observed Fri Dec 24
]);
// Early close at 1:00 PM ET on these dates.
const NYSE_EARLY_CLOSE = new Set([
  '2025-07-03','2025-11-28','2025-12-24',
  '2026-11-27',
  '2027-11-26',
]);

function updateMarketStatus(now) {
  // Work in the active market's wall-clock time with its own calendar (never the other's).
  const m = Market.def();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: m.timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(now);

  const get = (t) => parts.find((p) => p.type === t)?.value;
  const weekday = get('weekday');
  const localDate = `${get('year')}-${get('month')}-${get('day')}`;
  let hour = parseInt(get('hour'), 10);
  if (hour === 24) hour = 0;
  const minute = parseInt(get('minute'), 10);
  const mins = hour * 60 + minute;
  const hm = (t) => { const [h, mm] = String(t).split(':').map(Number); return h * 60 + mm; };

  const holidays = (m.calendar && m.calendar.holidays) || [];
  const earlyCloses = (m.calendar && m.calendar.earlyClose) || [];
  const isWeekday = !['Sat', 'Sun'].includes(weekday);
  const isHoliday = holidays.includes(localDate);
  const isEarlyClose = earlyCloses.includes(localDate);
  const open = hm(m.session.open);
  const close = isEarlyClose && m.session.earlyClose ? hm(m.session.earlyClose) : hm(m.session.close);
  const preStart = hm(m.session.preOpen);
  const afterEnd = hm(m.session.postClose);

  const el = $('marketStatus');
  let cls = 'closed', text = 'CLOSED';

  if (isWeekday && !isHoliday) {
    if (mins >= open && mins < close) { cls = 'open'; text = isEarlyClose ? 'OPEN (EARLY CLOSE)' : 'OPEN'; }
    else if (mins >= preStart && mins < open) { cls = 'ext'; text = 'PRE-MKT'; }
    else if (mins >= close && mins < afterEnd) { cls = 'ext'; text = 'AFTER-HRS'; }
  }

  el.className = 'market-status ' + cls;
  el.title = `${m.sessionLabel} · ${m.session.open}–${m.session.close} ${m.tzLabel}${isHoliday ? ' · holiday' : ''}`;
  $('statusText').textContent = text;
}

// ───────────────────────── ticker tape ─────────────────────────
async function loadTape() {
  try {
    const items = await getJSON('/api/ticker?market=' + encodeURIComponent(Market.id));
    if (!Array.isArray(items)) throw new Error('Ticker payload was not an array');
    const track = $('tapeTrack');
    const html = items.map(renderTapeItem).join('');
    // Duplicate the content so the -50% keyframe loops seamlessly; the clone is
    // presentational only, so keep it out of the accessibility tree.
    track.innerHTML = html + `<span aria-hidden="true">${html}</span>`;
  } catch (err) {
    $('tapeTrack').innerHTML = `<span class="tape-loading">Ticker unavailable — ${err.message}</span>`;
  }
}

function renderTapeItem(it) {
  const symbol = escHtml(it && it.symbol || '—');
  const price = Number(it && it.price);
  const noData = !it || it.available === false || !Number.isFinite(price) || price <= 0;
  if (noData) {
    return `<span class="tape-item"><span class="t-sym">${symbol}</span><span class="t-price">No quote</span></span>`;
  }
  const cls = colorClass(it.percent);
  const arrow = it.percent > 0 ? '▲' : it.percent < 0 ? '▼' : '';
  const detail = `${it.truth ? (TRUTH_LABEL[it.truth] || it.truth) : (it.stale ? 'Last good' : 'Pooled')} quote${it.currency ? ` · ${it.currency}` : ''}${it.source ? ` from ${it.source}` : ''}${it.asOf ? ` · ${new Date(it.asOf).toLocaleString()}` : ''}`;
  return (
    `<span class="tape-item${it.stale ? ' is-stale' : ''}" title="${escHtml(detail)}">` +
    `<span class="t-sym">${symbol}</span>` +
    `<span class="t-price">${it.stale ? '~' : ''}${fmtPrice(price)}</span>` +
    `<span class="t-pct ${cls}">${arrow} ${fmtSigned(it.percent)}%</span>` +
    `</span>`
  );
}

// ───────────────────────── symbol loading ─────────────────────────
async function loadSymbol(rawSymbol) {
  const symbol = String(rawSymbol || '').trim().toUpperCase();
  if (!symbol) return;
  state.symbol = symbol;
  notifySymbolContext();
  $('symbolInput').value = symbol;
  setStatus(`Loading ${symbol}…`);

  // Reflect the symbol immediately in the header.
  $('qSymbol').textContent = symbol;

  // Fire everything in parallel; each panel handles its own failure.
  loadQuote(symbol);
  loadProfile(symbol);
  loadMetrics(symbol);
  loadNews(symbol);
  loadChart(symbol, state.range);
  loadQuantPanel(symbol);
  if (Market.id === 'US') subscribeLive(symbol); // real-time trade ticks via Finnhub WS (US tape only)
  // Auto-refresh "Why is it moving?" if the panel is already open
  if (whyPanelOpen) loadPriceAction(symbol);
}

/* ───────────────────────── live trade stream ─────────────────────────
   A websocket to our /api/stocks/stream proxy (Finnhub trades, key injected
   server-side) drives the price and the 1D chart tick-by-tick, the way Google
   Finance does. The interval polling above stays as a fallback so the price is
   still correct if the stream is down or the symbol isn't streamable. */
let liveWs = null, liveSym = null, liveReconnect = null, liveRaf = null, liveFails = 0;

function connectLive() {
  if (liveWs && (liveWs.readyState === 0 || liveWs.readyState === 1)) return;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  try { liveWs = new WebSocket(`${proto}//${location.host}/api/stocks/stream`); }
  catch { return scheduleLiveReconnect(); }
  liveWs.addEventListener('open', () => { liveFails = 0; liveSym = null; if (state.symbol) sendSub(state.symbol); });
  liveWs.addEventListener('message', (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.type !== 'trade' || !Array.isArray(m.data)) return;
    let best = null; // newest trade for the symbol we're showing
    for (const t of m.data) { if (t && t.s === state.symbol) best = t; }
    if (best) applyLivePrice(best.p, best.t || Date.now());
  });
  liveWs.addEventListener('close', () => { liveWs = null; scheduleLiveReconnect(); });
  liveWs.addEventListener('error', () => { try { liveWs.close(); } catch {} });
}
function scheduleLiveReconnect() {
  // Back off when the stream keeps failing (e.g. provider doesn't allow it) so we
  // don't spam failed handshakes — the fast quote poll carries liveness regardless.
  liveFails = Math.min(liveFails + 1, 6);
  clearTimeout(liveReconnect);
  liveReconnect = setTimeout(connectLive, Math.min(60000, 5000 * liveFails));
}
function sendSub(symbol) {
  if (!liveWs || liveWs.readyState !== 1) return;
  if (liveSym && liveSym !== symbol) { try { liveWs.send(JSON.stringify({ type: 'unsubscribe', symbol: liveSym })); } catch {} }
  try { liveWs.send(JSON.stringify({ type: 'subscribe', symbol })); liveSym = symbol; } catch {}
}
function subscribeLive(symbol) {
  if (liveWs && liveWs.readyState === 1) sendSub(symbol);
  else connectLive(); // subscribes to state.symbol once open
}
function scheduleLiveDraw() {
  if (liveRaf) return;
  liveRaf = requestAnimationFrame(() => { liveRaf = null; if (hoverX === null) drawChart(); });
}
// Push the latest price onto the live edge of the 1D chart: update the current
// minute's point, or start a new one when the minute rolls over. Fed by both the
// trade stream and the fast quote poll.
function extendLiveChart(price, tms) {
  if (state.range !== '1D' || !state.chart || !Array.isArray(state.chart.points) || !state.chart.points.length) return;
  const pts = state.chart.points;
  const last = pts[pts.length - 1];
  // Only extend within the session being plotted. A quote that arrives while
  // the market is closed (evening/weekend/holiday) carries a timestamp days or
  // hours past the last bar; appending it would drag the 1D x-domain across
  // multiple days and render as a long flat line with no hour labels.
  const b = marketSessionBounds(last.t, state.chart && state.chart.session);
  if (tms < b.openUTC - 60000 || tms > b.closeUTC + 60000) return;
  if (Math.floor(tms / 60000) > Math.floor(last.t / 60000)) pts.push({ t: tms, c: price });
  else last.c = price;
  if (state.chart.meta) state.chart.meta.price = price;
  scheduleLiveDraw();
}
// Apply one real-time trade: move the price, the day high/low, and the chart.
function applyLivePrice(price, tms) {
  if (typeof price !== 'number' || !state.quote) return;
  const q = state.quote;
  const pc = q.pc || 0;
  q.c = price;
  q.d = price - pc;
  q.dp = pc ? (q.d / pc) * 100 : 0;
  const cls = colorClass(q.d);
  $('qPrice').textContent = fmtPrice(price);
  $('qPrice').className = 'quote-price ' + cls;
  $('qChange').textContent = `${fmtSigned(q.d)}  (${fmtSigned(q.dp)}%)`;
  $('qChange').className = 'quote-change ' + cls;
  if (q.h == null || price > q.h) { q.h = price; $('sHigh').textContent = fmtPrice(price); }
  if (q.l == null || price < q.l) { q.l = price; $('sLow').textContent = fmtPrice(price); }
  extendLiveChart(price, tms);
}

async function loadQuote(symbol) {
  try {
    const q = await getJSON('/api/quote?symbol=' + encodeURIComponent(symbol) + Market.qs());
    if (state.symbol !== symbol) return; // user moved on

    // A transient all-providers-failed response (no price) during a fast poll must
    // NOT blank a price we've already shown — just keep the last good one.
    if (q.c == null || (q.c === 0 && q.pc === 0)) {
      if (state.quote && state.quote.c) return; // keep last good price
      $('qPrice').textContent = 'No data';
      $('qPrice').className = 'quote-price';
      $('qChange').textContent = 'Symbol not found or no quote available';
      $('qChange').className = 'quote-change down';
      ['sOpen', 'sPrev', 'sHigh', 'sLow'].forEach((id) => ($(id).textContent = '—'));
      setStatus(`No quote data for ${symbol}.`);
      return;
    }
    state.quote = q;
    notifySymbolContext();
    // Persist only symbols that actually quoted, so a typo (or company name
    // typed as a ticker) is never restored on the next page load.
    try { localStorage.setItem(Shell ? Shell.lastSymbolKey(Market.id) : 'mt:lastSymbol', symbol); } catch { /* private mode */ }

    const cls = colorClass(q.d);
    $('qPrice').textContent = fmtPrice(q.c);
    $('qPrice').className = 'quote-price ' + cls;
    $('qChange').textContent = `${fmtSigned(q.d)}  (${fmtSigned(q.dp)}%)`;
    $('qChange').className = 'quote-change ' + cls;

    $('sOpen').textContent = fmtPrice(q.o);
    $('sPrev').textContent = fmtPrice(q.pc);
    $('sHigh').textContent = fmtPrice(q.h);
    $('sLow').textContent = fmtPrice(q.l);

    // Drive the live edge of the intraday chart from the poll too (backstops the
    // trade stream / carries liveness on its own when the stream is unavailable).
    extendLiveChart(q.c, q.t ? q.t * 1000 : Date.now());

    const t = q.t ? new Date(q.t * 1000).toLocaleTimeString('en-US', { timeZone: Market.tz(), hour12: false }) : '';
    truthBadge($('qFresh'), q.truth || 'SNAPSHOT');
    const curr = $('qCurrency'); if (curr) curr.textContent = q.currency || Market.def().currency;
    setStatus(`● ${TRUTH_LABEL[q.truth] ? TRUTH_LABEL[q.truth].toUpperCase() : 'QUOTE'} · ${symbol} ${t ? t + ' ' + Market.tzLabel() : ''}`);
  } catch (err) {
    if (state.symbol !== symbol) return;
    $('qChange').textContent = 'Quote error: ' + err.message;
    $('qChange').className = 'quote-change down';
    setStatus('Quote failed: ' + err.message);
  }
}

// ─── "Why is it moving?" ──────────────────────────────────────────────────
let whyPanelOpen = false;

async function loadPriceAction(symbol) {
  const panel = $('whyPanel');
  const loadingEl = $('whyLoading');
  const textEl = $('whyText');
  const sentEl = $('whySentiment');
  const catsEl = $('whyCatalysts');
  const headsEl = $('whyHeadlines');
  const runtimeEl = $('whyRuntime');
  if (!panel) return;

  panel.hidden = false;
  loadingEl.hidden = false;
  textEl.textContent = '';
  sentEl.textContent = '';
  sentEl.className = 'why-sentiment';
  clearChildren(catsEl);
  clearChildren(headsEl);
  if (runtimeEl) runtimeEl.textContent = '';

  try {
    const d = await getJSON('/api/intel/priceaction?symbol=' + encodeURIComponent(symbol));
    if (state.symbol !== symbol) return;
    loadingEl.hidden = true;

    const pct = d.change != null ? (d.change >= 0 ? '+' : '') + d.change.toFixed(2) + '%' : '';
    sentEl.textContent = (d.abstained ? 'EVIDENCE INSUFFICIENT' : (d.sentiment || 'neutral').toUpperCase()) + (pct ? '  ' + pct : '');
    sentEl.className = 'why-sentiment ' + (d.abstained ? 'neutral' : (d.sentiment || 'neutral'));

    textEl.textContent = [d.explanation || '', d.abstained && d.policy?.reason ? d.policy.reason : ''].filter(Boolean).join(' ');
    if (runtimeEl && d.policy?.runtime) {
      const runtime = d.policy.runtime;
      const generator = runtime.generator;
      const verifier = runtime.verifier;
      const parts = [];
      if (generator?.provider) parts.push(`${generator.provider}/${generator.servedModel || generator.requestedModel || 'model'}`);
      if (verifier?.status === 'passed') parts.push(`verified by ${verifier.provider}/${verifier.servedModel || verifier.requestedModel || 'model'}`);
      else if (d.policy.requiresIndependentVerifier) parts.push('independent verification incomplete');
      if (runtime.totals?.providerCalls) parts.push(`${runtime.totals.totalTokens || 0} tokens`);
      runtimeEl.textContent = parts.join(' · ');
    }

    if (d.catalysts && d.catalysts.length) {
      const frag = document.createDocumentFragment();
      d.catalysts.forEach((catalyst) => {
        const li = document.createElement('li');
        li.textContent = catalyst;
        frag.appendChild(li);
      });
      catsEl.appendChild(frag);
    }

    if (d.headlines && d.headlines.length) {
      const label = document.createElement('strong');
      label.style.color = 'var(--muted)';
      label.style.fontSize = '10px';
      label.textContent = 'RELATED HEADLINES';
      headsEl.appendChild(label);
      d.headlines.forEach((headline) => {
        const row = document.createElement('div');
        row.style.marginTop = '4px';
        const url = safeHttpUrl(headline.sourceUrl || headline.url || '');
        if (url) {
          const link = document.createElement('a');
          link.href = url;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.textContent = `• ${headline.title || headline.headline || ''}`;
          row.appendChild(link);
        } else {
          row.textContent = `• ${headline.title || headline.headline || ''}`;
        }
        headsEl.appendChild(row);
      });
    }
  } catch (err) {
    loadingEl.hidden = true;
    textEl.textContent = 'AI analysis unavailable: ' + err.message;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const btn = $('whyMoveBtn');
  if (btn) {
    btn.addEventListener('click', () => {
      const panel = $('whyPanel');
      if (!whyPanelOpen) {
        whyPanelOpen = true;
        btn.textContent = 'Hide explanation';
        btn.setAttribute('aria-expanded', 'true');
        if (state.symbol) loadPriceAction(state.symbol);
      } else {
        whyPanelOpen = false;
        btn.textContent = 'Explain move';
        btn.setAttribute('aria-expanded', 'false');
        if (panel) panel.hidden = true;
      }
    });
  }
});

async function loadProfile(symbol) {
  try {
    const p = await getJSON('/api/profile?symbol=' + encodeURIComponent(symbol) + Market.qs());
    if (state.symbol !== symbol) return;

    if (p.unavailable) {
      // Truthful degradation: the market's providers do not serve fundamentals.
      $('qName').textContent = symbol;
      $('qExch').textContent = `${p.exchange || Market.def().exchangeLabel}`;
      ['cIndustry', 'cCountry', 'cIpo'].forEach((id) => ($(id).textContent = '—'));
      $('sCap').textContent = '—';
      $('cIndustry').textContent = `Not available for ${p.exchange || Market.def().exchangeLabel} on current providers`;
      const w = $('cWeb'); w.textContent = '—'; w.removeAttribute('href');
      const lg = $('cLogo'); lg.hidden = true; lg.removeAttribute('src');
      return;
    }
    $('qName').textContent = p.name || symbol;
    $('qExch').textContent = p.exchange || '';
    $('cIndustry').textContent = p.finnhubIndustry || '—';
    $('cCountry').textContent = p.country || '—';
    $('cIpo').textContent = p.ipo || '—';
    $('sCap').textContent = fmtMarketCap(p.marketCapitalization);

    const web = $('cWeb');
    const website = safeHttpUrl(p.weburl);
    if (website) {
      web.textContent = website.replace(/^https?:\/\//, '').replace(/\/$/, '');
      web.href = website;
    } else {
      web.textContent = '—';
      web.removeAttribute('href');
    }

    const logo = $('cLogo');
    if (p.logo) { logo.src = p.logo; logo.hidden = false; logo.alt = (p.name || symbol) + ' logo'; }
    else { logo.hidden = true; logo.removeAttribute('src'); }
  } catch (err) {
    if (state.symbol !== symbol) return;
    $('cIndustry').textContent = 'Profile error';
  }
}

async function loadMetrics(symbol) {
  try {
    const m = await getJSON('/api/metrics?symbol=' + encodeURIComponent(symbol) + Market.qs());
    if (state.symbol !== symbol) return;
    if (m.unavailable) { ['s52h', 's52l', 'sPE'].forEach((id) => ($(id).textContent = '—')); return; }
    $('s52h').textContent = fmtPrice(m.high52);
    $('s52l').textContent = fmtPrice(m.low52);
    $('sPE').textContent = (m.pe === null || m.pe === undefined) ? '—' : Number(m.pe).toFixed(2);
  } catch {
    if (state.symbol !== symbol) return;
    $('s52h').textContent = '—';
    $('s52l').textContent = '—';
    $('sPE').textContent = '—';
  }
}

async function loadNews(symbol) {
  const body = $('newsBody');
  body.innerHTML = '<div class="news-loading">Loading headlines…</div>';
  try {
    const items = await getJSON('/api/news?symbol=' + encodeURIComponent(symbol) + Market.qs());
    if (state.symbol !== symbol) return;
    if (items && items.unavailable) {
      body.innerHTML = `<div class="news-loading">Company news is not available for ${escHtml(items.exchange || Market.def().exchangeLabel)} listings on the current providers.</div>`;
      return;
    }
    if (!items.length) {
      body.innerHTML = '<div class="news-loading">No recent news for this symbol.</div>';
      return;
    }
    body.innerHTML = items.map((n) => {
      const safe = (s) => escHtml(s || '');
      const url = safeHttpUrl(n.url) || '#';
      return (
        `<a class="news-item" href="${url}" target="_blank" rel="noopener noreferrer">` +
        `<div class="news-headline">${safe(n.headline)}</div>` +
        `<div class="news-meta"><span class="news-src">${safe(n.source)}</span>` +
        `<span>${relativeTime(n.datetime)}</span></div>` +
        `</a>`
      );
    }).join('');
  } catch (err) {
    if (state.symbol !== symbol) return;
    body.innerHTML = `<div class="panel-msg error">News error: ${err.message}</div>`;
  }
}

// ───────────────────────── chart ─────────────────────────
async function loadChart(symbol, range) {
  const msg = $('chartMsg');
  // A silent refresh keeps the drawn chart on screen; only a cold load shows the notice.
  if (!state.chart) { msg.hidden = false; msg.textContent = 'Loading chart…'; }
  try {
    const data = await getJSON(
      `/api/chart?symbol=${encodeURIComponent(symbol)}&range=${encodeURIComponent(range)}${Market.qs()}`
    );
    if (state.symbol !== symbol || state.range !== range) return;
    if (!data.points || data.points.length < 2) {
      msg.hidden = false;
      msg.textContent = 'No chart data for this range.';
      state.chart = null;
      clearCanvas();
      return;
    }
    msg.hidden = true;
    state.chart = data;
    drawChart();
  } catch (err) {
    if (state.symbol !== symbol) return;
    msg.hidden = false;
    msg.textContent = 'Chart error: ' + err.message;
    state.chart = null;
    clearCanvas();
  }
}

const canvas = $('chartCanvas');
const ctx = canvas.getContext('2d');
let chartGeom = null;     // cached pixel geometry for hover hit-testing
let hoverX = null;        // device-independent x within canvas, or null

function clearCanvas() {
  const r = canvas.getBoundingClientRect();
  ctx.clearRect(0, 0, r.width, r.height);
  chartGeom = null;
}

function drawChart() {
  const data = state.chart;
  if (!data || !data.points || data.points.length < 2) return;

  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const W = rect.width;
  const H = rect.height;

  // Retina-crisp backing store.
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const range = state.range;
  const prev = data.meta && data.meta.prevClose;

  // 1D renders the regular session on a FIXED canvas (Google style) — 09:30–16:00 ET
  // for US, 09:15–15:30 IST for India: the live line sits in its true position in
  // the day and grows rightward into empty future space, instead of stretching
  // edge-to-edge.
  let points, t0, t1;
  if (range === '1D' && data.points.length) {
    const b = marketSessionBounds(data.points[data.points.length - 1].t, data.session);
    t0 = b.openUTC; t1 = b.closeUTC;
    points = data.points.filter((p) => p.t >= t0 - 60000 && p.t <= t1 + 60000);
    if (points.length < 2) { points = data.points; t0 = points[0].t; t1 = points[points.length - 1].t; }
  } else {
    points = data.points;
    t0 = points[0].t; t1 = points[points.length - 1].t;
  }

  const lowerPaneH = 86;  // height of the lower oscillator pane
  const oscGap = 6;       // gap between main chart and lower pane
  // On narrow canvases the fixed margins would eat most of the plot, so shrink
  // them; the wide right margin only exists for the prev-close label and the
  // MC forward fan, neither of which fits at that size anyway.
  const narrow = W < 420 && !state.showMC;
  // Left gutter scales with the widest price label so four/five-digit prices
  // (INR large caps, BKNG-class US names) never clip on narrow canvases.
  ctx.font = '11px "SF Mono", Menlo, monospace';
  const labelW = Math.max(...data.points.map((p) => p.c)).toFixed(2).length * 6.8 + 10;
  const padL = Math.max(narrow ? 44 : 52, Math.ceil(labelW)), padR = narrow ? 12 : 66, padT = 14;
  const padB = 24 + lowerPaneH + oscGap; // total bottom padding includes lower pane
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  // Candlestick mode needs per-bar OHLC; fall back to line if the data lacks it.
  const candle = state.chartType === 'candle' && points.length > 0 && points[0].o != null;

  // Y domain — include prevClose so the baseline is meaningful on intraday.
  const closes = points.map((p) => p.c);
  let min = candle ? Math.min(...points.map((p) => p.l)) : Math.min(...closes);
  let max = candle ? Math.max(...points.map((p) => p.h)) : Math.max(...closes);
  if ((range === '1D' || range === '5D') && typeof prev === 'number') {
    min = Math.min(min, prev);
    max = Math.max(max, prev);
  }
  // Auto-scale tight to the data (like Google Finance) so intraday ticks are visible.
  if (min === max) { min -= 1; max += 1; }
  const padY = (max - min) * 0.08;
  min -= padY;
  max += padY;

  const xOf = (t) => padL + ((t - t0) / (t1 - t0 || 1)) * plotW;
  const yOf = (c) => padT + (1 - (c - min) / (max - min)) * plotH;

  // Up/down color based on period start vs end (or prevClose on intraday).
  const first = (range === '1D' && typeof prev === 'number') ? prev : closes[0];
  const last = closes[closes.length - 1];
  const upColor = '#2bd97c', downColor = '#ff453a';
  const lineColor = last >= first ? upColor : downColor;

  // ── horizontal grid + price labels (left, Google style) ──
  ctx.font = '10px "SF Mono", Menlo, monospace';
  ctx.textBaseline = 'middle';
  const yTicks = 5;
  for (let i = 0; i <= yTicks; i++) {
    const v = min + (i / yTicks) * (max - min);
    const y = yOf(v);
    ctx.strokeStyle = 'rgba(255,255,255,0.045)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(W - padR, y);
    ctx.stroke();
    ctx.fillStyle = '#7a8290';
    ctx.textAlign = 'right';
    ctx.fillText(v.toFixed(2), padL - 6, y);
  }

  // ── x tick labels — hour-aligned across the full session on 1D ──
  // Skip labels (keeping the gridline) when the canvas is too narrow to fit
  // every candidate tick without overlapping — e.g. all 7 hourly labels on a
  // ~300px-wide mobile chart collide into unreadable mush otherwise.
  ctx.textBaseline = 'top';
  const labelMaxWidth = Math.max(...['10:00 AM', formatTick(t1, range)].map((s) => ctx.measureText(s).width));
  const minGapPx = labelMaxWidth + 14;
  let lastLabelX = -Infinity;
  if (range === '1D') {
    const b = marketSessionBounds(t1, state.chart && state.chart.session);
    for (let h = 10; h <= 16; h++) {
      const tx = b.hourEpoch(h);
      if (tx < t0 || tx > t1) continue;
      const x = xOf(tx);
      ctx.strokeStyle = 'rgba(255,255,255,0.03)';
      ctx.beginPath();
      ctx.moveTo(x, padT);
      ctx.lineTo(x, padT + plotH);
      ctx.stroke();
      if (x - lastLabelX < minGapPx) continue;
      lastLabelX = x;
      ctx.fillStyle = '#7a8290';
      // Right-align the label when a centered one would clip off the canvas.
      ctx.textAlign = x + labelMaxWidth / 2 > W ? 'right' : 'center';
      ctx.fillText(formatTick(tx, range), x, padT + plotH + 6);
    }
  } else {
    const maxFit = Math.max(1, Math.floor(plotW / minGapPx));
    const xTicks = Math.min(6, maxFit, points.length - 1);
    ctx.textAlign = 'center';
    for (let i = 0; i <= xTicks; i++) {
      const idx = Math.round((i / xTicks) * (points.length - 1));
      const p = points[idx];
      const x = xOf(p.t);
      ctx.strokeStyle = 'rgba(255,255,255,0.03)';
      ctx.beginPath();
      ctx.moveTo(x, padT);
      ctx.lineTo(x, padT + plotH);
      ctx.stroke();
      ctx.fillStyle = '#7a8290';
      ctx.fillText(formatTick(p.t, range), x, padT + plotH + 6);
    }
  }

  // ── prevClose dashed baseline + right-margin "Previous close" label ──
  if ((range === '1D' || range === '5D') && typeof prev === 'number') {
    const y = yOf(prev);
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(122,130,144,0.55)';
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(W - padR, y);
    ctx.stroke();
    ctx.restore();
    if (!narrow) { // no right margin to write into on narrow canvases
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.font = '9px "SF Mono", Menlo, monospace';
      ctx.fillStyle = '#7a8290';
      ctx.fillText('Prev close', W - padR + 5, y - 7);
      ctx.fillStyle = '#aeb6c2';
      ctx.fillText(prev.toFixed(2), W - padR + 5, y + 6);
      ctx.font = '10px "SF Mono", Menlo, monospace';
    }
  }

  const lastX = xOf(points[points.length - 1].t);

  // ── Keltner Channel shaded band (drawn UNDER the price line) ──
  if (state.showKC && window.Quant && points.length >= 22) {
    try {
      const highs = new Float64Array(points.map((p) => p.h ?? p.c));
      const lows  = new Float64Array(points.map((p) => p.l ?? p.c));
      const cls   = new Float64Array(closes);
      const kc = Quant.keltnerChannels(cls, highs, lows, 20, 2);
      const warmup = 22;
      ctx.save();
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = lineColor;
      ctx.beginPath();
      let first_valid = true;
      for (let i = warmup; i < points.length; i++) {
        if (kc.upper[i] == null || isNaN(kc.upper[i])) continue;
        const x = xOf(points[i].t), y = yOf(kc.upper[i]);
        if (first_valid) { ctx.moveTo(x, y); first_valid = false; } else ctx.lineTo(x, y);
      }
      for (let i = points.length - 1; i >= warmup; i--) {
        if (kc.lower[i] == null || isNaN(kc.lower[i])) continue;
        ctx.lineTo(xOf(points[i].t), yOf(kc.lower[i]));
      }
      ctx.closePath();
      ctx.fill();
      // Draw KC midline
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      first_valid = true;
      for (let i = warmup; i < points.length; i++) {
        if (kc.middle[i] == null || isNaN(kc.middle[i])) continue;
        const x = xOf(points[i].t), y = yOf(kc.middle[i]);
        if (first_valid) { ctx.moveTo(x, y); first_valid = false; } else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    } catch { /* KC calc failed */ }
  }

  // ── Monte Carlo forward fan (500 paths, drawn AFTER price line via RAF) ──
  if (state.showMC && window.Quant && points.length >= 30) {
    scheduleMcFan(points, lastX, padL, padR, padT, plotH, W, min, max, xOf, yOf, t0, t1);
  }

  if (candle) {
    // ── candlesticks (wick = high→low, body = open→close) ──
    const cw = points.length > 1
      ? Math.max(1.5, Math.min(14, Math.abs(xOf(points[1].t) - xOf(points[0].t)) * 0.7))
      : 6;
    for (const p of points) {
      const x = xOf(p.t);
      const up = p.c >= p.o;
      const col = up ? upColor : downColor;
      ctx.strokeStyle = col;
      ctx.fillStyle = col;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, yOf(p.h));
      ctx.lineTo(x, yOf(p.l));
      ctx.stroke();
      const yo = yOf(p.o), yc = yOf(p.c);
      const top = Math.min(yo, yc);
      const bh = Math.max(1, Math.abs(yc - yo));
      ctx.fillRect(x - cw / 2, top, cw, bh);
    }
  } else {
    // For 1D, find the last bar where price actually moved so the fill area
    // doesn't extend across a flat quiet period (which looks like a frozen chart).
    let fillEndIdx = points.length - 1;
    if (range === '1D') {
      for (let i = points.length - 1; i > 0; i--) {
        if (Math.abs(points[i].c - points[i - 1].c) > 1e-9) { fillEndIdx = i; break; }
      }
    }

    // ── area gradient fill (clipped at last price movement, not the live edge) ──
    const grad = ctx.createLinearGradient(0, padT, 0, padT + plotH);
    const rgb = last >= first ? '43,217,124' : '255,69,58';
    grad.addColorStop(0, `rgba(${rgb},0.22)`);
    grad.addColorStop(1, `rgba(${rgb},0.0)`);
    const fillEndX = xOf(points[fillEndIdx].t);
    ctx.beginPath();
    ctx.moveTo(xOf(points[0].t), yOf(points[0].c));
    for (let i = 0; i <= fillEndIdx; i++) ctx.lineTo(xOf(points[i].t), yOf(points[i].c));
    ctx.lineTo(fillEndX, padT + plotH);
    ctx.lineTo(xOf(points[0].t), padT + plotH);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // ── price line (drawn to the live edge, flat tail shows as a thin line) ──
    ctx.beginPath();
    ctx.moveTo(xOf(points[0].t), yOf(points[0].c));
    for (const p of points) ctx.lineTo(xOf(p.t), yOf(p.c));
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 1.6;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // ── live dot at the leading edge ──
    const lp = points[points.length - 1];
    ctx.beginPath();
    ctx.arc(lastX, yOf(lp.c), 3, 0, Math.PI * 2);
    ctx.fillStyle = lineColor;
    ctx.fill();
    ctx.strokeStyle = '#0a0a0a';
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }

  // cache geometry for hover
  chartGeom = { points, padL, padR, padT, padB, plotW, plotH, W, H, t0, t1, min, max, xOf, yOf, lineColor };

  // ── lower pane oscillator ──
  drawLowerPane(ctx, points, W, H, padL, padR, padT, plotH, lowerPaneH, oscGap, xOf);

  // re-draw crosshair if hovering
  if (hoverX !== null) drawCrosshair();
}

// ─────────────────────────────────────────────────────────────────
// LOWER PANE — MACD / CCI / Williams %R
// ─────────────────────────────────────────────────────────────────
function drawLowerPane(ctx, points, W, H, padL, padR, padT, plotH, lowerH, gap, xOf) {
  if (!window.Quant || points.length < 30) return;
  const oscType = state.lowerOsc;
  const paneTop = padT + plotH + gap;
  const paneBot = paneTop + lowerH;

  // separator line
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padL, paneTop);
  ctx.lineTo(W - padR, paneTop);
  ctx.stroke();

  // label
  ctx.font = '9px "SF Mono", Menlo, monospace';
  ctx.fillStyle = '#5a6472';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(oscType, padL + 3, paneTop + 3);

  const closes = new Float64Array(points.map((p) => p.c));
  const highs  = new Float64Array(points.map((p) => p.h ?? p.c));
  const lows   = new Float64Array(points.map((p) => p.l ?? p.c));
  const n = points.length;

  try {
    if (oscType === 'MACD') {
      const { macdLine, signalLine, histogram } = Quant.macd(closes, 12, 26, 9);
      // find valid range
      let vmin = Infinity, vmax = -Infinity;
      for (let i = 0; i < n; i++) {
        if (histogram[i] == null || isNaN(histogram[i])) continue;
        if (histogram[i] < vmin) vmin = histogram[i];
        if (histogram[i] > vmax) vmax = histogram[i];
        if (macdLine[i] != null && !isNaN(macdLine[i])) {
          if (macdLine[i] < vmin) vmin = macdLine[i];
          if (macdLine[i] > vmax) vmax = macdLine[i];
        }
      }
      if (vmin === Infinity || vmin === vmax) return;
      const pad = (vmax - vmin) * 0.1 || 0.01;
      vmin -= pad; vmax += pad;
      const yP = (v) => paneTop + (1 - (v - vmin) / (vmax - vmin)) * lowerH;
      const zeroY = yP(0);

      // zero line
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(padL, zeroY); ctx.lineTo(W - padR, zeroY); ctx.stroke();

      // histogram bars
      const bw = Math.max(1, (W - padL - padR) / n - 1);
      for (let i = 0; i < n; i++) {
        if (histogram[i] == null || isNaN(histogram[i])) continue;
        const x = xOf(points[i].t);
        const barTop = Math.min(zeroY, yP(histogram[i]));
        const barH = Math.abs(yP(histogram[i]) - zeroY);
        ctx.fillStyle = histogram[i] >= 0 ? 'rgba(43,217,124,0.45)' : 'rgba(255,69,58,0.45)';
        ctx.fillRect(x - bw / 2, barTop, bw, Math.max(1, barH));
      }

      // MACD line (orange)
      ctx.beginPath();
      let mv = false;
      for (let i = 0; i < n; i++) {
        if (macdLine[i] == null || isNaN(macdLine[i])) { mv = false; continue; }
        const x = xOf(points[i].t), y = yP(macdLine[i]);
        if (!mv) { ctx.moveTo(x, y); mv = true; } else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = '#ffa028'; ctx.lineWidth = 1.2; ctx.lineJoin = 'round'; ctx.stroke();

      // Signal line (sky blue)
      ctx.beginPath();
      mv = false;
      for (let i = 0; i < n; i++) {
        if (signalLine[i] == null || isNaN(signalLine[i])) { mv = false; continue; }
        const x = xOf(points[i].t), y = yP(signalLine[i]);
        if (!mv) { ctx.moveTo(x, y); mv = true; } else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = '#5ac8fa'; ctx.lineWidth = 1; ctx.stroke();

    } else if (oscType === 'CCI') {
      const cci = Quant.cci(closes, highs, lows, 20);
      const yP = (v) => paneTop + (1 - (v + 200) / 400) * lowerH;

      // OB/OS zones
      ctx.fillStyle = 'rgba(255,69,58,0.07)';
      ctx.fillRect(padL, paneTop, W - padL - padR, yP(100) - paneTop);
      ctx.fillStyle = 'rgba(43,217,124,0.07)';
      ctx.fillRect(padL, yP(-100), W - padL - padR, paneBot - yP(-100));

      // zone lines
      ctx.strokeStyle = 'rgba(255,255,255,0.1)'; ctx.lineWidth = 1;
      [100, 0, -100].forEach((v) => {
        const y = yP(v);
        ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
      });

      // CCI line
      ctx.beginPath();
      let mv = false;
      for (let i = 0; i < n; i++) {
        if (cci[i] == null || isNaN(cci[i])) { mv = false; continue; }
        const x = xOf(points[i].t), y = yP(Math.max(-200, Math.min(200, cci[i])));
        if (!mv) { ctx.moveTo(x, y); mv = true; } else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = '#d96bff'; ctx.lineWidth = 1.2; ctx.lineJoin = 'round'; ctx.stroke();

    } else if (oscType === 'WR') {
      const wr = Quant.williamsR(closes, highs, lows, 14);
      const yP = (v) => paneTop + (1 - (v + 100) / 100) * lowerH;

      // OB/OS shading (-20 top zone, -80 bottom zone)
      ctx.fillStyle = 'rgba(255,69,58,0.07)';
      ctx.fillRect(padL, paneTop, W - padL - padR, yP(-20) - paneTop);
      ctx.fillStyle = 'rgba(43,217,124,0.07)';
      ctx.fillRect(padL, yP(-80), W - padL - padR, paneBot - yP(-80));

      ctx.strokeStyle = 'rgba(255,255,255,0.1)'; ctx.lineWidth = 1;
      [-20, -50, -80].forEach((v) => {
        const y = yP(v);
        ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
      });

      ctx.beginPath();
      let mv = false;
      for (let i = 0; i < n; i++) {
        if (wr[i] == null || isNaN(wr[i])) { mv = false; continue; }
        const x = xOf(points[i].t), y = yP(Math.max(-100, Math.min(0, wr[i])));
        if (!mv) { ctx.moveTo(x, y); mv = true; } else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = '#5ac8fa'; ctx.lineWidth = 1.2; ctx.lineJoin = 'round'; ctx.stroke();
    }
  } catch { /* osc calc failed — skip lower pane */ }
}

// ─────────────────────────────────────────────────────────────────
// MONTE CARLO FORWARD FAN — 500 paths, RAF-batched in chunks of 50
// Projects from the last price into the right margin area (padR).
// ─────────────────────────────────────────────────────────────────
function scheduleMcFan(points, lastX, padL, padR, padT, plotH, W, min, max, xOf, yOf, t0, t1) {
  if (!window.Quant) return;
  const sym = state.symbol + '|' + state.range;
  if (_mc.rafId) { cancelAnimationFrame(_mc.rafId); _mc.rafId = null; }

  // Only recompute if symbol/range/model changed
  const modelKey = sym + '|' + _mc.model;
  if (_mc.symbol !== modelKey || !_mc.paths) {
    try {
      const closes = new Float64Array(points.map((p) => p.c));
      const rets   = Quant.dailyReturns(closes);
      const mu     = Quant.mean(rets);
      const sigma  = Quant.stdev(rets);
      const S0     = closes[closes.length - 1];
      let rawPaths;
      if (_mc.model === 'RJD' && Quant.roughJumpDiffusion) {
        rawPaths = Quant.roughJumpDiffusion({ S0, mu, sigma, days: 20, paths: 500, H: 0.45, lambda: 2, muJ: -0.03, sigmaJ: 0.06 });
      } else {
        rawPaths = Quant.monteCarloGBM({ S0, mu, sigma, days: 20, paths: 500 });
      }
      _mc.paths = rawPaths;
      _mc.symbol = modelKey;
    } catch { return; }
  }

  const paths = _mc.paths;
  const nDays = paths.length;
  const nPaths = paths[0].length;
  const dt = (t1 - t0) / (points.length - 1); // avg ms per bar
  const S0 = points[points.length - 1].c;
  const tLast = points[points.length - 1].t;

  // Build per-path pixel arrays up front
  const pathCoords = [];
  for (let pi = 0; pi < nPaths; pi++) {
    const coords = [];
    for (let di = 0; di < nDays; di++) {
      const t = tLast + (di + 1) * dt;
      const price = paths[di][pi];
      const x = lastX + (di + 1) * (dt / (t1 - t0) * (W - padL - padR));
      const y = yOf(price);
      if (x > W - 4) break; // clip to canvas right edge
      coords.push([x, y]);
    }
    pathCoords.push(coords);
  }

  let drawn = 0;
  const CHUNK = 50;

  function drawChunk() {
    const end = Math.min(drawn + CHUNK, nPaths);
    for (let pi = drawn; pi < end; pi++) {
      const coords = pathCoords[pi];
      if (!coords.length) continue;
      ctx.beginPath();
      ctx.moveTo(lastX, yOf(S0));
      for (const [x, y] of coords) ctx.lineTo(x, y);
      ctx.strokeStyle = 'rgba(255,160,40,0.04)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    drawn = end;
    if (drawn < nPaths) _mc.rafId = requestAnimationFrame(drawChunk);
    else _mc.rafId = null;
  }

  _mc.rafId = requestAnimationFrame(drawChunk);
}

// Charts always render in the active market's exchange time (like Google Finance),
// not the viewer's local zone — otherwise a user in IST sees a US session shifted
// ~9h, and vice versa.
function marketTZ() { return Market.tz(); }
function formatTick(ms, range) {
  const d = new Date(ms);
  const tz = marketTZ();
  if (range === '1D') return d.toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' });
  if (range === '5D') return d.toLocaleDateString('en-US', { timeZone: tz, month: 'numeric', day: 'numeric' });
  if (range === '5Y' || range === '1Y') return d.toLocaleDateString('en-US', { timeZone: tz, month: 'short', year: '2-digit' });
  return d.toLocaleDateString('en-US', { timeZone: tz, month: 'short', day: 'numeric' });
}

// Minutes the market zone is behind UTC for a given instant (240 EDT / 300 EST / -330 IST).
function marketOffsetMin(date) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: marketTZ(), timeZoneName: 'longOffset' }).formatToParts(date);
  const tz = (parts.find((p) => p.type === 'timeZoneName') || {}).value || 'GMT-05:00';
  const m = tz.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!m) return 300;
  const sign = m[1] === '-' ? 1 : -1;
  return sign * (parseInt(m[2], 10) * 60 + (m[3] ? parseInt(m[3], 10) : 0));
}
// Regular-session bounds for the calendar day of `sampleMs` in the market zone,
// returned as true UTC epochs, plus a builder for hour-aligned tick marks. Prefers the
// server's `session` block (computed by shared/market-core.js) and recomputes locally
// from the market definition otherwise. Lets the 1D chart use a fixed full-day canvas.
function marketSessionBounds(sampleMs, serverSession) {
  const off = marketOffsetMin(new Date(sampleMs));
  const [y, mo, d] = new Intl.DateTimeFormat('en-CA', { timeZone: marketTZ(), year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(sampleMs)).split('-').map(Number);
  const at = (h, mn) => Date.UTC(y, mo - 1, d, h, mn) + off * 60000;
  const sess = Market.def().session;
  const [oh, om] = sess.open.split(':').map(Number);
  const [ch, cm] = sess.close.split(':').map(Number);
  const openUTC = serverSession && Number.isFinite(serverSession.openUTC) ? serverSession.openUTC : at(oh, om);
  const closeUTC = serverSession && Number.isFinite(serverSession.closeUTC) ? serverSession.closeUTC : at(ch, cm);
  return { openUTC, closeUTC, hourEpoch: (h) => at(h, 0) };
}

// Hover crosshair + tooltip (redraws on top of cached chart).
function drawCrosshair() {
  const g = chartGeom;
  if (!g || hoverX === null) return;

  // find nearest point
  let nearest = g.points[0];
  let best = Infinity;
  for (const p of g.points) {
    const dx = Math.abs(g.xOf(p.t) - hoverX);
    if (dx < best) { best = dx; nearest = p; }
  }
  const x = g.xOf(nearest.t);
  const y = g.yOf(nearest.c);

  drawChartBase(); // repaint clean chart first

  // crosshair lines
  ctx.save();
  ctx.setLineDash([3, 3]);
  ctx.strokeStyle = 'rgba(255,160,40,0.55)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, g.padT);
  ctx.lineTo(x, g.padT + g.plotH);
  ctx.moveTo(g.padL, y);
  ctx.lineTo(g.W - g.padR, y);
  ctx.stroke();
  ctx.restore();

  // marker dot
  ctx.beginPath();
  ctx.arc(x, y, 3.2, 0, Math.PI * 2);
  ctx.fillStyle = g.lineColor;
  ctx.fill();
  ctx.strokeStyle = '#0a0a0a';
  ctx.lineWidth = 1.4;
  ctx.stroke();

  // tooltip — market time (ET), with the suffix on intraday ranges
  const intraday = state.range === '1D' || state.range === '5D';
  const dateStr = new Date(nearest.t).toLocaleString('en-US', {
    timeZone: marketTZ(),
    month: 'short', day: 'numeric',
    hour: intraday ? 'numeric' : undefined,
    minute: intraday ? '2-digit' : undefined,
  }) + (intraday ? ' ' + Market.tzLabel() : '');
  const priceStr = fmtMoney(nearest.c);
  ctx.font = '11px "SF Mono", Menlo, monospace';
  const tw = Math.max(ctx.measureText(dateStr).width, ctx.measureText(priceStr).width);
  const boxW = tw + 16;
  const boxH = 34;
  let bx = x + 12;
  if (bx + boxW > g.W - g.padR) bx = x - 12 - boxW;
  let by = g.padT + 4;

  ctx.fillStyle = 'rgba(8,9,11,0.94)';
  ctx.strokeStyle = '#262b33';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.rect(bx, by, boxW, boxH);
  ctx.fill();
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#7a8290';
  ctx.fillText(dateStr, bx + 8, by + 6);
  ctx.fillStyle = g.lineColor;
  ctx.fillText(priceStr, bx + 8, by + 19);
}

// Repaint the base chart without recomputing geometry (used under crosshair).
let _redrawing = false;
function drawChartBase() {
  if (_redrawing) return;
  _redrawing = true;
  const prevHover = hoverX;
  hoverX = null;     // avoid recursion through drawChart -> drawCrosshair
  drawChart();
  hoverX = prevHover;
  _redrawing = false;
}

// pointer handlers
canvas.addEventListener('mousemove', (e) => {
  if (!chartGeom) return;
  const rect = canvas.getBoundingClientRect();
  hoverX = e.clientX - rect.left;
  drawCrosshair();
});
canvas.addEventListener('mouseleave', () => {
  if (hoverX === null) return;
  hoverX = null;
  if (state.chart) drawChart();
});

// ───────────────────────── autocomplete ─────────────────────────
let acTimer = null;
let acIndex = -1;

function setupCommandBar() {
  const input = $('symbolInput');
  const ac = $('autocomplete');

  input.addEventListener('input', () => {
    const q = input.value.trim();
    clearTimeout(acTimer);
    if (q.length < 1) { hideAC(); return; }
    acTimer = setTimeout(() => runSearch(q), 220);
  });

  input.addEventListener('keydown', (e) => {
    const items = [...ac.querySelectorAll('li')];
    if (e.key === 'ArrowDown' && items.length) {
      e.preventDefault();
      acIndex = (acIndex + 1) % items.length;
      highlightAC(items);
    } else if (e.key === 'ArrowUp' && items.length) {
      e.preventDefault();
      acIndex = (acIndex - 1 + items.length) % items.length;
      highlightAC(items);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (acIndex >= 0 && items[acIndex]) {
        chooseSymbol(items[acIndex].dataset.symbol);
      } else {
        chooseSymbol(input.value);
      }
    } else if (e.key === 'Escape') {
      hideAC();
    }
  });

  $('goBtn').addEventListener('click', () => chooseSymbol(input.value));

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.cmd-input-wrap')) hideAC();
  });
}

function chooseSymbol(sym) {
  hideAC();
  if (!String(sym || '').trim()) return;
  if (currentView !== 'terminal') navigateTo('terminal');
  loadSymbol(sym);
}

async function runSearch(q) {
  try {
    const data = await getJSON('/api/search?q=' + encodeURIComponent(q) + Market.qs());
    if (data.market && data.market !== Market.id) { hideAC(); return; } // stale response after a mode switch
    const ac = $('autocomplete');
    const results = data.result || [];
    if (!results.length) { hideAC(); return; }
    acIndex = -1;
    ac.innerHTML = results.map((r) =>
      `<li role="option" data-symbol="${escHtml(r.symbol)}">` +
      `<span class="ac-sym">${escHtml(r.symbol)}${r.exchange && r.exchange !== 'US' ? ` <small class="ac-exch">${escHtml(r.exchange)}</small>` : ''}</span>` +
      `<span class="ac-desc">${String(r.description || '').replace(/</g, '&lt;')}</span>` +
      `</li>`
    ).join('');
    ac.hidden = false;
    ac.querySelectorAll('li').forEach((li) => {
      li.addEventListener('click', () => chooseSymbol(li.dataset.symbol));
    });
  } catch {
    hideAC();
  }
}

function highlightAC(items) {
  items.forEach((li, i) => li.classList.toggle('active', i === acIndex));
  if (items[acIndex]) items[acIndex].scrollIntoView({ block: 'nearest' });
}

function hideAC() {
  const ac = $('autocomplete');
  ac.hidden = true;
  ac.innerHTML = '';
  acIndex = -1;
}

// ───────────────────────── range buttons ─────────────────────────
function setupRangeButtons() {
  $('rangeButtons').addEventListener('click', (e) => {
    const btn = e.target.closest('.range-btn');
    if (!btn) return;
    state.range = btn.dataset.range;
    [...$('rangeButtons').children].forEach((b) => { b.classList.toggle('active', b === btn); b.setAttribute('aria-pressed', String(b === btn)); });
    loadChart(state.symbol, state.range);
  });
  const tt = $('chartTypeToggle');
  if (tt) tt.addEventListener('click', (e) => {
    const btn = e.target.closest('.ctype-btn');
    if (!btn) return;
    state.chartType = btn.dataset.ctype;
    [...tt.children].forEach((b) => { b.classList.toggle('active', b === btn); b.setAttribute('aria-pressed', String(b === btn)); });
    if (state.chart) drawChart(); // re-render from cached data, no refetch
  });
}

// ───────────────────────── oscillator / overlay toggle buttons ─────────────────────────
function setupOscButtons() {
  const bar = $('chartOscBar');
  if (!bar) return;

  bar.addEventListener('click', (e) => {
    const btn = e.target.closest('.osc-btn');
    if (!btn) return;
    const id = btn.id;

    if (id === 'kcToggle') {
      state.showKC = !state.showKC;
      btn.dataset.active = state.showKC ? '1' : '0';
      btn.classList.toggle('active', state.showKC);
      if (state.chart) drawChart();
      return;
    }
    if (id === 'mcToggle') {
      state.showMC = !state.showMC;
      btn.dataset.active = state.showMC ? '1' : '0';
      btn.classList.toggle('active', state.showMC);
      const modelToggle = $('mcModelToggle');
      if (modelToggle) modelToggle.classList.toggle('visible', state.showMC);
      if (_mc.rafId) { cancelAnimationFrame(_mc.rafId); _mc.rafId = null; }
      if (state.chart) drawChart();
      return;
    }

    // Lower-pane oscillator selector (MACD / CCI / WR)
    const osc = btn.dataset.osc;
    if (!osc || osc === 'KC' || osc === 'MC') return;
    state.lowerOsc = osc;
    bar.querySelectorAll('.osc-btn[data-osc]').forEach((b) => {
      if (b.id === 'kcToggle' || b.id === 'mcToggle') return;
      b.classList.toggle('active', b.dataset.osc === osc);
    });
    if (state.chart) drawChart();
  });

  // MC model switcher (RJD / GBM)
  const mcModel = $('mcModelToggle');
  if (mcModel) {
    mcModel.addEventListener('click', (e) => {
      const btn = e.target.closest('.mc-model-btn');
      if (!btn) return;
      _mc.model = btn.dataset.model;
      _mc.paths = null; // force recompute
      [...mcModel.children].forEach(b => b.classList.toggle('active', b === btn));
      if (state.showMC && state.chart) drawChart();
    });
  }

  // Set initial active state visually
  $('kcToggle').classList.toggle('active', state.showKC);
  $('mcToggle').classList.toggle('active', state.showMC);
}

// ───────────────────────── view tabs / application shell ─────────────────────────
// Top-level navigation is the MT2 workspace hierarchy from shell.js (MARKETS ·
// TERMINAL · PORTFOLIO(reserved) · WATCHLIST · RESEARCH · INTELLIGENCE · QUANT ·
// ALERTS). Workspaces map onto the legacy view ids that app.js/intel.js own; the
// shell only decides which view (+ Global Intel sub-panel) a destination shows.
// Showing a view dispatches a `tabshown` event so intel.js can lazy-load its data.
const Shell = window.MarketTerminalShell;
let currentGiSub = 'briefing';

function showView(name) {
  const views = document.querySelectorAll('.view');
  let matched = false;
  views.forEach((v) => {
    const on = v.id === 'view-' + name;
    v.classList.toggle('active', on);
    if (on) matched = true;
  });
  if (!matched) { showView('terminal'); return; }
  currentView = name;
  syncShellNav(name, currentGiSub);
  document.dispatchEvent(new CustomEvent('tabshown', { detail: { view: name } }));
}

// Navigate to a shell target (`research/analyze`, `intelligence/map`, `terminal` …).
function navigateTo(target, { pushHash = true } = {}) {
  if (!Shell) return;
  const r = Shell.resolve(target);
  if (!r.enabled) {
    if (r.note) setStatus(r.note);
    return;
  }
  if (r.sub) currentGiSub = r.sub;
  showView(r.view);
  if (r.sub) document.dispatchEvent(new CustomEvent('mt:gisub', { detail: { sub: r.sub } }));
  if (pushHash) {
    const hash = Shell.hashForTarget(target);
    if (hash && location.hash !== hash) history.replaceState(null, '', hash);
  }
}

function renderShellNav() {
  const nav = document.getElementById('primaryNav');
  if (!nav || !Shell) return;
  nav.innerHTML = Shell.WORKSPACES.map((ws) => {
    const enabled = Shell.isEnabled(ws);
    const attrs = enabled
      ? `aria-selected="false"`
      : `aria-disabled="true" aria-selected="false" title="${escHtml(ws.note || 'Not available')}"`;
    const reserved = ws.reserved ? '<span class="nav-reserved">Soon</span>' : '';
    return `<button class="nav-item" type="button" role="tab" data-target="${ws.id}" ${attrs}>${escHtml(ws.label)}${reserved}</button>`;
  }).join('');
  nav.setAttribute('role', 'tablist');

  renderMarketMode();
}

function renderMarketMode() {
  const mode = document.getElementById('marketMode');
  if (!mode || !Shell) return;
  mode.innerHTML = Shell.MARKETS.map((m) => {
    if (!m.active) return `<button type="button" aria-pressed="false" aria-disabled="true" title="${escHtml(m.note || '')}">${escHtml(m.label)}<span class="mode-note">Soon</span></button>`;
    const on = m.id === Market.id;
    return `<button type="button" data-market="${m.id}" aria-pressed="${on}" title="${escHtml(m.session || '')}">${escHtml(m.label)}</button>`;
  }).join('');
  mode.querySelectorAll('button[data-market]').forEach((btn) => {
    btn.addEventListener('click', () => setMarket(btn.dataset.market));
  });
}

let benchmarkClosesCache = {}; // market id → benchmark closes (quant panel)

/** Switch the global market context. Persisted; every market-scoped surface reloads. */
function setMarket(id, { persist = true, reload = true } = {}) {
  const next = Shell ? Shell.resolveMarketId(id) : 'US';
  if (next === Market.id && reload) return;
  Market.id = next;
  if (persist) { try { localStorage.setItem(Shell.MARKET_STORAGE_KEY, next); } catch { /* private mode */ } }
  document.documentElement.dataset.market = next;
  renderMarketMode();
  tickClock();
  hideAC();
  $('symbolInput').placeholder = next === 'IN'
    ? 'Symbol or company — RELIANCE, TCS, Infosys'
    : 'Symbol or company — AAPL, NVDA, Tesla';
  document.dispatchEvent(new CustomEvent('mt:market', { detail: { id: next, market: Market.def() } }));
  if (!reload) return;
  // Drop the other market's live stream state; the US tape resumes on its own.
  state.quote = null; state.chart = null; clearCanvas();
  loadTape();
  marketsLoadedAt = 0;
  if (currentView === 'markets') { renderMarketRegistry(); loadMarkets(true); }
  loadSentiment();
  let last = null;
  try { last = localStorage.getItem(Shell.lastSymbolKey(next)); } catch { /* private mode */ }
  loadSymbol(last || Market.def().defaultSymbol);
}

function renderSubnav(workspaceId, activeItem) {
  const sub = document.getElementById('subNav');
  if (!sub || !Shell) return;
  const ws = Shell.workspace(workspaceId);
  if (!ws || !Array.isArray(ws.items)) { sub.hidden = true; sub.innerHTML = ''; return; }
  sub.innerHTML = `<span class="subnav-label">${escHtml(ws.label)}</span>` + ws.items.map((it) => {
    const on = it.id === activeItem;
    const dataSub = it.sub ? ` data-sub="${it.sub}"` : '';
    return `<button class="subnav-item" type="button" role="tab" data-target="${ws.id}/${it.id}"${dataSub} aria-selected="${on}" tabindex="${on ? 0 : -1}">${escHtml(it.label)}</button>`;
  }).join('');
  sub.hidden = false;
}

function syncShellNav(view, sub) {
  if (!Shell) return;
  const loc = Shell.locate(view, sub);
  document.querySelectorAll('#primaryNav .nav-item').forEach((b) => {
    const on = b.dataset.target === loc.workspace;
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
  });
  renderSubnav(loc.workspace, loc.item);
}

function setupTabs() {
  renderShellNav();
  const nav = document.getElementById('primaryNav');
  const sub = document.getElementById('subNav');

  nav.addEventListener('click', (e) => {
    const btn = e.target.closest('.nav-item');
    if (!btn) return;
    if (btn.getAttribute('aria-disabled') === 'true') { setStatus(btn.title || 'Not available yet.'); return; }
    navigateTo(btn.dataset.target);
  });
  sub.addEventListener('click', (e) => {
    const btn = e.target.closest('.subnav-item');
    if (btn) navigateTo(btn.dataset.target);
  });

  // Roving tabindex: ←/→ move between tabs, Home/End jump, Enter/Space activate.
  function rove(container, selector) {
    container.addEventListener('keydown', (e) => {
      const items = [...container.querySelectorAll(selector)];
      const i = items.indexOf(document.activeElement);
      if (i < 0) return;
      let next = null;
      if (e.key === 'ArrowRight') next = items[(i + 1) % items.length];
      else if (e.key === 'ArrowLeft') next = items[(i - 1 + items.length) % items.length];
      else if (e.key === 'Home') next = items[0];
      else if (e.key === 'End') next = items[items.length - 1];
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); items[i].click(); return; }
      if (next) { e.preventDefault(); next.focus(); }
    });
  }
  rove(nav, '.nav-item');
  rove(sub, '.subnav-item');

  // `/` focuses the global command from anywhere outside a text field.
  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    e.preventDefault();
    const input = $('symbolInput');
    if (input) { input.focus(); input.select(); }
  });

  window.addEventListener('hashchange', () => {
    const target = Shell && Shell.targetFromHash(location.hash);
    if (target) navigateTo(target, { pushHash: false });
  });

  syncShellNav('terminal', currentGiSub);
}

// ───────────────────────── MARKETS workspace ─────────────────────────
// Uses the same pooled /api/quote route the Terminal uses — no new data authority.
// The benchmark table is the active market's own universe (shared/market-core.js via
// /api/market); a US benchmark can never appear under India and vice versa.
const US_BENCHMARKS_FALLBACK = [
  { symbol: 'SPY', name: 'S&P 500 · SPDR' },
  { symbol: 'QQQ', name: 'Nasdaq-100 · Invesco' },
  { symbol: 'DIA', name: 'Dow Jones · SPDR' },
  { symbol: 'IWM', name: 'Russell 2000 · iShares' },
];
function marketBenchmarks() {
  const def = Market.def();
  if (Array.isArray(def.benchmarks) && def.benchmarks.length) return def.benchmarks;
  return Market.id === 'US' ? US_BENCHMARKS_FALLBACK : [];
}
let marketsLoadedAt = 0;

function freshnessForQuote(q) {
  // Truthful vocabulary: prefer the server's explicit data truth, else infer from timestamp.
  if (!q || q.c == null || (q.c === 0 && q.pc === 0)) return { key: 'unavailable', label: 'Unavailable' };
  if (q.truth && TRUTH_FRESH[q.truth]) return { key: TRUTH_FRESH[q.truth], label: TRUTH_LABEL[q.truth] };
  const ageMs = q.t ? Date.now() - q.t * 1000 : null;
  const status = $('marketStatus');
  const open = status && status.classList.contains('open');
  if (ageMs != null && ageMs < 5 * 60_000 && open) return { key: 'live', label: 'Live' };
  if (ageMs != null && ageMs < 20 * 60_000) return { key: 'delayed', label: 'Delayed' };
  return { key: 'snapshot', label: q.t ? 'Snapshot · ' + new Date(q.t * 1000).toLocaleTimeString('en-US', { timeZone: Market.tz(), hour: '2-digit', minute: '2-digit' }) + ' ' + Market.tzLabel() : 'Snapshot' };
}

async function loadMarkets(force = false) {
  const body = $('mkTableBody');
  const fresh = $('mkFresh');
  if (!body) return;
  if (!force && Date.now() - marketsLoadedAt < 60_000) return; // cached view; the tape and quote poll carry liveness
  fresh.dataset.fresh = 'loading'; fresh.textContent = 'Loading';
  const marketId = Market.id;
  const title = $('mkBenchTitle'); if (title) title.textContent = `${Market.def().label} benchmarks · ${Market.def().currency}`;

  const rows = await Promise.all(marketBenchmarks().map(async (b) => {
    try { return { ...b, q: await getJSON('/api/quote?symbol=' + encodeURIComponent(b.symbol) + Market.qs()) }; }
    catch (err) { return { ...b, q: null, err: err.message }; }
  }));
  if (marketId !== Market.id) return; // mode switched mid-flight; the new load owns the table
  marketsLoadedAt = Date.now();

  let live = 0, unavailable = 0;
  body.innerHTML = rows.map((r) => {
    const f = freshnessForQuote(r.q);
    if (f.key === 'live') live++;
    if (f.key === 'unavailable') unavailable++;
    const q = r.q || {};
    const cls = colorClass(q.d);
    const cell = (v) => (Number.isFinite(v) ? fmtPrice(v) : '—');
    return `<tr data-symbol="${escHtml(r.symbol)}" data-href="terminal" tabindex="0">
      <td class="sym">${escHtml(r.symbol)}<small>${escHtml(r.name)}</small></td>
      <td class="num">${cell(q.c)}</td>
      <td class="num ${cls}">${Number.isFinite(q.d) ? fmtSigned(q.d) : '—'}</td>
      <td class="num ${cls}">${Number.isFinite(q.dp) ? fmtSigned(q.dp) + '%' : '—'}</td>
      <td class="num opt">${cell(q.o)}</td>
      <td class="num opt">${cell(q.h)}</td>
      <td class="num opt">${cell(q.l)}</td>
      <td class="num opt">${cell(q.pc)}</td>
      <td class="opt"><span class="fresh" data-fresh="${f.key}">${escHtml(f.label)}</span></td>
    </tr>`;
  }).join('');

  // Overall badge = the dominant per-row truth (EOD on a closed day, not "Snapshot").
  const keys = rows.map((r) => freshnessForQuote(r.q).key);
  const dominant = [...new Set(keys)].sort((a, b) => keys.filter((k) => k === b).length - keys.filter((k) => k === a).length)[0] || 'unavailable';
  const overall = unavailable === rows.length ? 'unavailable' : live === rows.length ? 'live' : live > 0 ? 'partial' : dominant;
  const labelFor = { live: 'Live', delayed: 'Delayed', snapshot: 'Snapshot', eod: 'End of day', cached: 'Cached', 'last-good': 'Last good', unavailable: 'Unavailable' };
  fresh.dataset.fresh = overall === 'partial' ? 'delayed' : overall;
  fresh.textContent = overall === 'partial' ? `Partial · ${live}/${rows.length} live` : (labelFor[overall] || 'Snapshot');

  body.querySelectorAll('tr[data-symbol]').forEach((tr) => {
    const open = () => { navigateTo('terminal'); loadSymbol(tr.dataset.symbol); };
    tr.addEventListener('click', open);
    tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
  });
}

function renderMarketRegistry() {
  const body = $('mkRegistryBody');
  if (!body || !Shell) return;
  const status = $('marketStatus');
  const session = status ? ($('statusText').textContent || '—') : '—';
  body.innerHTML = Shell.MARKETS.map((m) => {
    if (!m.active) return `<tr><td class="sym">${escHtml(m.label)}<small>${escHtml(m.note || '')}</small></td><td class="num">—</td><td><span class="mk-status is-reserved">Not yet active</span></td></tr>`;
    const on = m.id === Market.id;
    return `<tr class="${on ? 'is-active' : ''}" data-market="${m.id}" tabindex="0"><td class="sym">${escHtml(m.label)}<small>${escHtml(m.session || '')} · ${escHtml(m.currency || '')}</small></td><td class="num">${on ? escHtml(session) : '—'}</td><td><span class="mk-status ${on ? 'is-active' : 'is-available'}">${on ? 'Active · data context' : 'Available · switch'}</span></td></tr>`;
  }).join('');
  body.querySelectorAll('tr[data-market]').forEach((tr) => {
    const pick = () => setMarket(tr.dataset.market);
    tr.addEventListener('click', pick);
    tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') pick(); });
  });
}

document.addEventListener('tabshown', (e) => {
  const view = e.detail && e.detail.view;
  if (view === 'markets') { renderMarketRegistry(); loadMarkets(); }
});
document.addEventListener('DOMContentLoaded', () => {
  const btn = $('marketsRefresh');
  if (btn) btn.addEventListener('click', () => { renderMarketRegistry(); loadMarkets(true); });
});

// ───────────────────────── quant lab (terminal panel) ─────────────────────────
// Risk metrics + technical-indicator mini-chart, computed client-side from
// /api/chart 1Y daily closes — no new server endpoints needed.
let quantDailyPoints = null; // last-loaded 1Y daily points for the active symbol
let quantActiveInd = null;   // 'boll' | 'rsi' | 'macd' | null

// Benchmark closes for the ACTIVE market (SPY for US, NIFTY 50 for India), cached per
// market so a mode switch can never compute an Indian beta against SPY.
async function getBenchmarkCloses() {
  const marketId = Market.id;
  const bench = Market.def().quantBenchmark;
  const label = $('qrBetaLabel'); if (label) label.textContent = `Beta vs ${bench.label}`;
  if (benchmarkClosesCache[marketId]) return benchmarkClosesCache[marketId];
  try {
    const data = await getJSON(`/api/chart?symbol=${encodeURIComponent(bench.symbol)}&range=1Y&market=${marketId}`);
    if (data.market && data.market !== marketId) return null;
    if (data.points && data.points.length > 5) benchmarkClosesCache[marketId] = data.points.map((p) => p.c);
  } catch {}
  return benchmarkClosesCache[marketId] || null;
}
const getSpyCloses = getBenchmarkCloses; // legacy name

async function loadQuantPanel(symbol) {
  const msg = $('quantMsg');
  const grid = $('quantRiskGrid');
  const indCanvas = $('quantIndCanvas');
  quantDailyPoints = null;
  grid.hidden = true;
  indCanvas.hidden = true;
  msg.hidden = false;
  msg.textContent = 'Computing risk metrics…';

  try {
    const [data, spyCloses] = await Promise.all([
      getJSON(`/api/chart?symbol=${encodeURIComponent(symbol)}&range=1Y${Market.qs()}`),
      getBenchmarkCloses(),
    ]);
    if (state.symbol !== symbol) return;
    if (!data.points || data.points.length < 20) {
      msg.textContent = 'Not enough history for risk metrics.';
      return;
    }
    quantDailyPoints = data.points;
    const closes = data.points.map((p) => p.c);
    const years = data.points.length / Quant.TRADING_DAYS_YEAR;
    const rm = Quant.riskMetrics(closes, spyCloses, years, 0.045);

    $('qrVol').textContent = pct(rm.volatility);
    $('qrSharpe').textContent = rm.sharpe.toFixed(2);
    $('qrSortino').textContent = rm.sortino.toFixed(2);
    $('qrBeta').textContent = rm.beta == null ? '—' : rm.beta.toFixed(2);
    $('qrDD').textContent = pct(rm.maxDrawdown && rm.maxDrawdown.pct);
    $('qrCagr').textContent = pct(rm.cagr);

    msg.hidden = true;
    grid.hidden = false;
    if (quantActiveInd) drawQuantIndicator();
  } catch (err) {
    if (state.symbol !== symbol) return;
    msg.hidden = false;
    msg.textContent = 'Quant error: ' + err.message;
  }
}

function pct(x) {
  if (x == null || !isFinite(x)) return '—';
  return (x * 100).toFixed(1) + '%';
}

function drawQuantIndicator() {
  const canvas = $('quantIndCanvas');
  if (!quantDailyPoints || !quantActiveInd) { canvas.hidden = true; return; }
  canvas.hidden = false;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const W = rect.width, H = rect.height || 90;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  const ctx2 = canvas.getContext('2d');
  ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx2.clearRect(0, 0, W, H);

  const closes = quantDailyPoints.map((p) => p.c);
  const padL = 4, padR = 4, padT = 6, padB = 6;
  const plotW = W - padL - padR, plotH = H - padT - padB;

  function plotLine(series, min, max, color, startIdx) {
    ctx2.beginPath();
    ctx2.strokeStyle = color;
    ctx2.lineWidth = 1.4;
    const n = closes.length;
    let started = false;
    for (let i = 0; i < series.length; i++) {
      const v = series[i];
      if (v == null || !isFinite(v)) continue;
      const idx = (startIdx || 0) + i;
      const x = padL + (idx / (n - 1)) * plotW;
      const y = padT + (1 - (v - min) / (max - min || 1)) * plotH;
      if (!started) { ctx2.moveTo(x, y); started = true; } else ctx2.lineTo(x, y);
    }
    ctx2.stroke();
  }

  if (quantActiveInd === 'boll') {
    const { mid, upper, lower } = Quant.bollingerBands(closes, 20, 2);
    const all = [...upper, ...lower, ...closes].filter((v) => v != null && isFinite(v));
    const min = Math.min(...all), max = Math.max(...all);
    plotLine(closes, min, max, 'rgba(255,255,255,0.55)', 0);
    plotLine(upper, min, max, 'rgba(43,217,124,0.7)', 0);
    plotLine(lower, min, max, 'rgba(255,69,58,0.7)', 0);
    plotLine(mid, min, max, 'rgba(255,191,46,0.6)', 0);
  } else if (quantActiveInd === 'rsi') {
    const rsi = Quant.rsi(closes, 14);
    plotLine(rsi, 0, 100, '#ffbf2e', 0);
    // 30/70 reference lines
    ctx2.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx2.lineWidth = 1;
    [30, 70].forEach((lvl) => {
      const y = padT + (1 - lvl / 100) * plotH;
      ctx2.beginPath(); ctx2.moveTo(padL, y); ctx2.lineTo(W - padR, y); ctx2.stroke();
    });
  } else if (quantActiveInd === 'macd') {
    const { macdLine, signalLine, histogram } = Quant.macd(closes);
    const all = [...macdLine, ...signalLine].filter((v) => v != null && isFinite(v));
    const min = Math.min(...all, 0), max = Math.max(...all, 0);
    // histogram bars
    const n = closes.length;
    for (let i = 0; i < histogram.length; i++) {
      const v = histogram[i];
      if (v == null || !isFinite(v)) continue;
      const x = padL + (i / (n - 1)) * plotW;
      const zeroY = padT + (1 - (0 - min) / (max - min || 1)) * plotH;
      const y = padT + (1 - (v - min) / (max - min || 1)) * plotH;
      ctx2.fillStyle = v >= 0 ? 'rgba(43,217,124,0.5)' : 'rgba(255,69,58,0.5)';
      ctx2.fillRect(x - 1, Math.min(y, zeroY), 2, Math.abs(y - zeroY) || 1);
    }
    plotLine(macdLine, min, max, '#2bd97c', 0);
    plotLine(signalLine, min, max, '#ff453a', 0);
  }
}

function setupQuantPanel() {
  const tt = $('quantTechToggle');
  if (!tt) return;
  tt.addEventListener('click', (e) => {
    const btn = e.target.closest('.qind-btn');
    if (!btn) return;
    const ind = btn.dataset.ind;
    quantActiveInd = quantActiveInd === ind ? null : ind;
    [...tt.children].forEach((b) => b.classList.toggle('active', b.dataset.ind === quantActiveInd));
    drawQuantIndicator();
  });
}

// ───────────────────────── boot ─────────────────────────
function boot() {
  // Market context first: everything below is market-scoped.
  let storedMarket = null;
  try { storedMarket = localStorage.getItem(Shell ? Shell.MARKET_STORAGE_KEY : 'mt:market'); } catch { /* private mode */ }
  const startMarket = new URLSearchParams(location.search).get('market') || storedMarket;
  setMarket(startMarket, { persist: Boolean(startMarket), reload: false });
  getJSON('/api/market').then((cat) => {
    Market.catalog = cat;
    tickClock();
    if (currentView === 'markets') { renderMarketRegistry(); loadMarkets(true); }
  }).catch(() => { /* fallback definitions keep the shell usable */ });

  tickClock();
  setInterval(tickClock, 1000);

  setupTabs();
  setupOscButtons();
  setupCommandBar();
  setupRangeButtons();
  setupQuantPanel();
  setupSentimentPanel();

  loadTape();
  setInterval(() => { if (!document.hidden) loadTape(); }, TAPE_REFRESH_MS);

  connectLive(); // open the real-time trade stream

  // Re-subscribe the stream the moment focus returns (the socket may have been
  // dropped while backgrounded).
  window.addEventListener('focus', () => { if (state.symbol) subscribeLive(state.symbol); });

  // Live terminal: keep the quote and the chart current without any reload.
  setInterval(() => {
    if (document.hidden || currentView !== 'terminal' || !state.symbol) return;
    loadQuote(state.symbol);
  }, QUOTE_REFRESH_MS);
  setInterval(() => {
    if (document.hidden || currentView !== 'terminal' || !state.symbol) return;
    if (hoverX !== null) return; // don't yank the chart out from under an active hover
    loadChart(state.symbol, state.range);
  }, CHART_REFRESH_MS);

  // Background tabs get their timers throttled or paused, so the instant the tab
  // regains focus (or the network reconnects) we re-sync everything immediately
  // instead of leaving stale numbers on screen until the next interval tick.
  function resyncNow() {
    if (document.hidden) return;
    loadTape();
    if (currentView === 'terminal' && state.symbol) {
      loadQuote(state.symbol);
      if (hoverX === null) loadChart(state.symbol, state.range);
    }
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) resyncNow(); });
  window.addEventListener('focus', resyncNow);
  window.addEventListener('online', resyncNow);

  // Deep-link: /?tab=alerts (used by push notifications) opens that view on load.
  const startTab = new URLSearchParams(location.search).get('tab');
  const startTarget = (Shell && Shell.targetFromHash(location.hash)) || (startTab && Shell ? Shell.targetFromLegacyTab(startTab) : null);
  if (startTarget) navigateTo(startTarget, { pushHash: false });
  else if (startTab) showView(startTab === 'analysis' ? 'sectors' : startTab);

  // Auto-load the last viewed symbol for the active market so the terminal never opens empty.
  let lastSym = null;
  try { lastSym = localStorage.getItem(Shell ? Shell.lastSymbolKey(Market.id) : 'mt:lastSymbol'); } catch { /* private mode */ }
  loadSymbol(lastSym || Market.def().defaultSymbol);

  // Redraw chart on resize (debounced).
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (state.chart) drawChart(); if (quantActiveInd) drawQuantIndicator(); }, 150);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// MARKET SENTIMENT GAUGE
// ═══════════════════════════════════════════════════════════════════════════

const SENT_COLORS = {
  'Strongly Bullish': '#2bd97c',
  'Bullish': '#5ac8fa',
  'Neutral': '#ffa028',
  'Bearish': '#ff8c42',
  'Strongly Bearish': '#ff453a',
};

async function loadSentiment() {
  const sentSummary = $('sentSummary');
  const sentLabel   = $('sentLabel');
  const sentScore   = $('sentScore');
  const sentFill    = $('sentFill');
  const sentNeedle  = $('sentNeedle');
  const panel       = $('sentimentPanel');
  if (!sentSummary) return;

  sentSummary.textContent = 'Loading market sentiment…';
  sentLabel.textContent = '—';
  sentScore.textContent = '';

  let d;
  try { d = await getJSON('/api/sentiment/market?market=' + encodeURIComponent(Market.id)); if (d.market && d.market !== Market.id) return; }
  catch {
    sentSummary.textContent = 'Sentiment unavailable.';
    const coverage = $('sentTweets');
    if (coverage) coverage.textContent = 'No composite data returned.';
    return;
  }

  if (panel) panel.hidden = false;

  const score = Math.max(-1, Math.min(1, d.score || 0));
  const pct   = ((score + 1) / 2) * 100; // 0% = -1, 50% = 0, 100% = +1
  const color = SENT_COLORS[d.label] || '#ffa028';

  sentFill.style.width    = pct + '%';
  sentFill.style.background = color;
  sentNeedle.style.left   = pct + '%';
  sentNeedle.style.borderTopColor = color;

  sentLabel.textContent = d.label || 'Neutral';
  sentLabel.style.color = color;
  sentScore.textContent = score >= 0 ? `+${score.toFixed(2)}` : score.toFixed(2);
  sentSummary.textContent = d.summary || '';

  const coverage = $('sentTweets');
  if (coverage) {
    const status = d.status === 'degraded' ? 'partial coverage' : 'live coverage';
    coverage.textContent = `${d.benchmarkCount || 0} benchmarks · ${d.headlineCount || 0} headlines · ${d.sourceCount || 0} sources · ${status}`;
  }
}

function setupSentimentPanel() {
  const btn = $('sentRefreshBtn');
  if (btn) btn.addEventListener('click', () => {
    const panel = $('sentimentPanel');
    if (panel) panel.hidden = false;
    loadSentiment();
  });
  loadSentiment();
  setInterval(loadSentiment, 15 * 60 * 1000);
}

// ═══════════════════════════════════════════════════════════════════════════
// MACRO SHOCK SIMULATOR
// ═══════════════════════════════════════════════════════════════════════════

async function loadMacroShock() {
  const spotEl  = $('shockSpot');
  const tableEl = $('shockTable');
  if (!tableEl) return;

  tableEl.innerHTML = '<div class="status">Loading pipeline shock data…</div>';

  let d;
  try { d = await getJSON('/api/macro/shock'); }
  catch { tableEl.innerHTML = '<div class="status">Shock simulator unavailable.</div>'; return; }

  if (spotEl) {
    spotEl.innerHTML = `
      <span class="shock-price-chip">
        <span class="shock-commodity">WTI Crude</span>
        <span class="shock-price">$${(d.oil_price || 0).toFixed(2)}/bbl</span>
      </span>
      <span class="shock-price-chip">
        <span class="shock-commodity">Nat Gas</span>
        <span class="shock-price">$${(d.gas_price || 0).toFixed(2)}/MMBtu</span>
      </span>
    `;
  }

  const rows = (d.pipelines || []).map(p => {
    const shock = p.price_shock_pct < 0 ? p.price_shock_pct.toFixed(1) : '+' + p.price_shock_pct.toFixed(1);
    const riskColor = p.risk_score >= 70 ? '#ff453a' : p.risk_score >= 40 ? '#ffa028' : '#5ac8fa';
    const bar = `<div class="shock-bar-track"><div class="shock-bar-fill" style="width:${p.risk_score}%;background:${riskColor}"></div></div>`;
    return `<tr>
      <td class="shock-name">${p.name}</td>
      <td class="shock-comm">${p.commodity}</td>
      <td class="shock-tp">${p.throughput}</td>
      <td class="shock-loss">$${p.daily_loss_musd.toLocaleString()}M/day</td>
      <td class="shock-pct" style="color:${riskColor}">${shock}%</td>
      <td class="shock-risk">${bar}<span style="color:${riskColor}">${p.risk_score}</span></td>
    </tr>`;
  }).join('');

  tableEl.innerHTML = `
    <table class="shock-tbl">
      <thead><tr>
        <th>Pipeline</th><th>Commodity</th><th>Throughput</th>
        <th>Daily Loss</th><th>Price Shock</th><th>Risk Score</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

document.addEventListener('tabshown', (e) => {
  if (e.detail && e.detail.view === 'supply') loadMacroShock();
});

document.addEventListener('DOMContentLoaded', boot);
