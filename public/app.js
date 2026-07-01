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
};

// ───────────────────────── tiny helpers ─────────────────────────
const $ = (id) => document.getElementById(id);

async function getJSON(url) {
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function fmtPrice(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return Number(n).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
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
    timeZone: 'America/New_York',
    hour12: false,
  });
  $('clock').textContent = `${timeStr} ET`;
  updateMarketStatus(now);
}

function updateMarketStatus(now) {
  // Work in America/New_York wall-clock time.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(now);

  const get = (t) => parts.find((p) => p.type === t)?.value;
  const weekday = get('weekday');
  let hour = parseInt(get('hour'), 10);
  if (hour === 24) hour = 0;
  const minute = parseInt(get('minute'), 10);
  const mins = hour * 60 + minute;

  const isWeekday = !['Sat', 'Sun'].includes(weekday);
  const open = 9 * 60 + 30; // 09:30
  const close = 16 * 60;    // 16:00
  const preStart = 4 * 60;  // 04:00
  const afterEnd = 20 * 60; // 20:00

  const el = $('marketStatus');
  let cls = 'closed', text = 'CLOSED';

  if (isWeekday) {
    if (mins >= open && mins < close) { cls = 'open'; text = 'OPEN'; }
    else if (mins >= preStart && mins < open) { cls = 'ext'; text = 'PRE-MKT'; }
    else if (mins >= close && mins < afterEnd) { cls = 'ext'; text = 'AFTER-HRS'; }
  }

  el.className = 'market-status ' + cls;
  $('statusText').textContent = text;
}

// ───────────────────────── ticker tape ─────────────────────────
async function loadTape() {
  try {
    const items = await getJSON('/api/ticker');
    const track = $('tapeTrack');
    const html = items.map(renderTapeItem).join('');
    // Duplicate the content so the -50% keyframe loops seamlessly.
    track.innerHTML = html + html;
  } catch (err) {
    $('tapeTrack').innerHTML = `<span class="tape-loading">Ticker unavailable — ${err.message}</span>`;
  }
}

function renderTapeItem(it) {
  const noData = it.price === 0 && it.change === 0;
  if (noData) {
    return `<span class="tape-item"><span class="t-sym">${it.symbol}</span><span class="t-price">No data</span></span>`;
  }
  const cls = colorClass(it.percent);
  const arrow = it.percent > 0 ? '▲' : it.percent < 0 ? '▼' : '';
  return (
    `<span class="tape-item">` +
    `<span class="t-sym">${it.symbol}</span>` +
    `<span class="t-price">${fmtPrice(it.price)}</span>` +
    `<span class="t-pct ${cls}">${arrow} ${fmtSigned(it.percent)}%</span>` +
    `</span>`
  );
}

// ───────────────────────── symbol loading ─────────────────────────
async function loadSymbol(rawSymbol) {
  const symbol = String(rawSymbol || '').trim().toUpperCase();
  if (!symbol) return;
  state.symbol = symbol;
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
  subscribeLive(symbol); // real-time trade ticks via Finnhub WS
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
    const q = await getJSON('/api/quote?symbol=' + encodeURIComponent(symbol));
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

    const t = q.t ? new Date(q.t * 1000).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false }) : '';
    setStatus(`● LIVE · ${symbol} ${t ? t + ' ET' : ''}`);
  } catch (err) {
    if (state.symbol !== symbol) return;
    $('qChange').textContent = 'Quote error: ' + err.message;
    $('qChange').className = 'quote-change down';
    setStatus('Quote failed: ' + err.message);
  }
}

async function loadProfile(symbol) {
  try {
    const p = await getJSON('/api/profile?symbol=' + encodeURIComponent(symbol));
    if (state.symbol !== symbol) return;

    $('qName').textContent = p.name || symbol;
    $('qExch').textContent = p.exchange || '';
    $('cIndustry').textContent = p.finnhubIndustry || '—';
    $('cCountry').textContent = p.country || '—';
    $('cIpo').textContent = p.ipo || '—';
    $('sCap').textContent = fmtMarketCap(p.marketCapitalization);

    const web = $('cWeb');
    if (p.weburl) {
      web.textContent = p.weburl.replace(/^https?:\/\//, '').replace(/\/$/, '');
      web.href = p.weburl;
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
    const m = await getJSON('/api/metrics?symbol=' + encodeURIComponent(symbol));
    if (state.symbol !== symbol) return;
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
    const items = await getJSON('/api/news?symbol=' + encodeURIComponent(symbol));
    if (state.symbol !== symbol) return;
    if (!items.length) {
      body.innerHTML = '<div class="news-loading">No recent news for this symbol.</div>';
      return;
    }
    body.innerHTML = items.map((n) => {
      const safe = (s) => String(s || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return (
        `<a class="news-item" href="${encodeURI(n.url || '#')}" target="_blank" rel="noopener noreferrer">` +
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
  msg.hidden = false;
  msg.textContent = 'Loading chart…';
  try {
    const data = await getJSON(
      `/api/chart?symbol=${encodeURIComponent(symbol)}&range=${encodeURIComponent(range)}`
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

  // 1D renders the regular session on a FIXED 9:30–16:00 ET canvas (Google style):
  // the live line sits in its true position in the day and grows rightward into
  // empty future space, instead of stretching edge-to-edge.
  let points, t0, t1;
  if (range === '1D' && data.points.length) {
    const b = etSessionBounds(data.points[data.points.length - 1].t);
    t0 = b.openUTC; t1 = b.closeUTC;
    points = data.points.filter((p) => p.t >= t0 - 60000 && p.t <= t1 + 60000);
    if (points.length < 2) { points = data.points; t0 = points[0].t; t1 = points[points.length - 1].t; }
  } else {
    points = data.points;
    t0 = points[0].t; t1 = points[points.length - 1].t;
  }

  const padL = 52, padR = 66, padT = 14, padB = 24; // price labels left; prev-close label right
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
    const b = etSessionBounds(t1);
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
      ctx.textAlign = 'center';
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
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = '9px "SF Mono", Menlo, monospace';
    ctx.fillStyle = '#7a8290';
    ctx.fillText('Prev close', W - padR + 5, y - 7);
    ctx.fillStyle = '#aeb6c2';
    ctx.fillText(prev.toFixed(2), W - padR + 5, y + 6);
    ctx.font = '10px "SF Mono", Menlo, monospace';
  }

  const lastX = xOf(points[points.length - 1].t);

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

  // re-draw crosshair if hovering
  if (hoverX !== null) drawCrosshair();
}

// US-market charts always render in Eastern time (like Google Finance), not the
// viewer's local zone — otherwise a user in IST sees the session shifted ~9h.
const MKT_TZ = 'America/New_York';
function formatTick(ms, range) {
  const d = new Date(ms);
  if (range === '1D') return d.toLocaleTimeString('en-US', { timeZone: MKT_TZ, hour: 'numeric', minute: '2-digit' });
  if (range === '5D') return d.toLocaleDateString('en-US', { timeZone: MKT_TZ, month: 'numeric', day: 'numeric' });
  if (range === '5Y' || range === '1Y') return d.toLocaleDateString('en-US', { timeZone: MKT_TZ, month: 'short', year: '2-digit' });
  return d.toLocaleDateString('en-US', { timeZone: MKT_TZ, month: 'short', day: 'numeric' });
}

// Minutes US-Eastern is behind UTC for a given instant (240 EDT / 300 EST).
function etOffsetMin(date) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: MKT_TZ, timeZoneName: 'shortOffset' }).formatToParts(date);
  const tz = (parts.find((p) => p.type === 'timeZoneName') || {}).value || 'GMT-5';
  const m = tz.match(/GMT([+-]\d+)/);
  return m ? -parseInt(m[1], 10) * 60 : 300;
}
// Regular-session bounds (9:30 AM – 4:00 PM ET) for the calendar day of `sampleMs`,
// returned as true UTC epochs, plus a builder for hour-aligned tick marks. Lets the
// 1D chart use a fixed full-day canvas like Google Finance.
function etSessionBounds(sampleMs) {
  const off = etOffsetMin(new Date(sampleMs));
  const [y, mo, d] = new Intl.DateTimeFormat('en-CA', { timeZone: MKT_TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(sampleMs)).split('-').map(Number);
  const at = (h, mn) => Date.UTC(y, mo - 1, d, h, mn) + off * 60000;
  return { openUTC: at(9, 30), closeUTC: at(16, 0), hourEpoch: (h) => at(h, 0) };
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
    timeZone: MKT_TZ,
    month: 'short', day: 'numeric',
    hour: intraday ? 'numeric' : undefined,
    minute: intraday ? '2-digit' : undefined,
  }) + (intraday ? ' ET' : '');
  const priceStr = '$' + fmtPrice(nearest.c);
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
  loadSymbol(sym);
}

async function runSearch(q) {
  try {
    const data = await getJSON('/api/search?q=' + encodeURIComponent(q));
    const ac = $('autocomplete');
    const results = data.result || [];
    if (!results.length) { hideAC(); return; }
    acIndex = -1;
    ac.innerHTML = results.map((r) =>
      `<li role="option" data-symbol="${r.symbol}">` +
      `<span class="ac-sym">${r.symbol}</span>` +
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
    [...$('rangeButtons').children].forEach((b) => b.classList.toggle('active', b === btn));
    loadChart(state.symbol, state.range);
  });
  const tt = $('chartTypeToggle');
  if (tt) tt.addEventListener('click', (e) => {
    const btn = e.target.closest('.ctype-btn');
    if (!btn) return;
    state.chartType = btn.dataset.ctype;
    [...tt.children].forEach((b) => b.classList.toggle('active', b === btn));
    if (state.chart) drawChart(); // re-render from cached data, no refetch
  });
}

// ───────────────────────── view tabs ─────────────────────────
// Top-level navigation between the TERMINAL and the Intelligence views.
// Showing a view dispatches a `tabshown` event so intel.js can lazy-load its data.
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
  document.querySelectorAll('.ttab').forEach((t) => t.classList.toggle('active', t.dataset.view === name));
  document.dispatchEvent(new CustomEvent('tabshown', { detail: { view: name } }));
}

function setupTabs() {
  document.getElementById('ttabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.ttab');
    if (btn) showView(btn.dataset.view);
  });
}

// ───────────────────────── quant lab (terminal panel) ─────────────────────────
// Risk metrics + technical-indicator mini-chart, computed client-side from
// /api/chart 1Y daily closes — no new server endpoints needed.
let spyClosesCache = null; // benchmark series, fetched once per session
let quantDailyPoints = null; // last-loaded 1Y daily points for the active symbol
let quantActiveInd = null;   // 'boll' | 'rsi' | 'macd' | null

async function getSpyCloses() {
  if (spyClosesCache) return spyClosesCache;
  try {
    const data = await getJSON('/api/chart?symbol=SPY&range=1Y');
    if (data.points && data.points.length > 5) spyClosesCache = data.points.map((p) => p.c);
  } catch {}
  return spyClosesCache;
}

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
      getJSON(`/api/chart?symbol=${encodeURIComponent(symbol)}&range=1Y`),
      getSpyCloses(),
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
  tickClock();
  setInterval(tickClock, 1000);

  setupTabs();
  setupCommandBar();
  setupRangeButtons();
  setupQuantPanel();

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
  if (startTab) showView(startTab === 'analysis' ? 'sectors' : startTab);

  // Redraw chart on resize (debounced).
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (state.chart) drawChart(); if (quantActiveInd) drawQuantIndicator(); }, 150);
  });
}

document.addEventListener('DOMContentLoaded', boot);
