'use strict';

/* ════════════════════════════════════════════════════════════════
   Market Terminal — frontend
   Vanilla JS. Talks only to our own /api/* proxy (never to providers
   directly), so the Finnhub key stays server-side.
   ════════════════════════════════════════════════════════════════ */

const DEFAULT_SYMBOL = 'AAPL';
const QUOTE_REFRESH_MS = 30_000;
const TAPE_REFRESH_MS = 60_000;

const state = {
  symbol: null,
  range: '1D',
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
}

async function loadQuote(symbol) {
  try {
    const q = await getJSON('/api/quote?symbol=' + encodeURIComponent(symbol));
    if (state.symbol !== symbol) return; // user moved on
    state.quote = q;

    const invalid = (q.c === 0 && q.pc === 0);
    if (invalid) {
      $('qPrice').textContent = 'No data';
      $('qPrice').className = 'quote-price';
      $('qChange').textContent = 'Symbol not found or no quote available';
      $('qChange').className = 'quote-change down';
      ['sOpen', 'sPrev', 'sHigh', 'sLow'].forEach((id) => ($(id).textContent = '—'));
      setStatus(`No quote data for ${symbol}.`);
      return;
    }

    const cls = colorClass(q.d);
    $('qPrice').textContent = fmtPrice(q.c);
    $('qPrice').className = 'quote-price ' + cls;
    $('qChange').textContent = `${fmtSigned(q.d)}  (${fmtSigned(q.dp)}%)`;
    $('qChange').className = 'quote-change ' + cls;

    $('sOpen').textContent = fmtPrice(q.o);
    $('sPrev').textContent = fmtPrice(q.pc);
    $('sHigh').textContent = fmtPrice(q.h);
    $('sLow').textContent = fmtPrice(q.l);

    const t = q.t ? new Date(q.t * 1000).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false }) : '';
    setStatus(`${symbol} updated ${t ? t + ' ET' : ''} · ${new Date().toLocaleTimeString()}`);
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

  const points = data.points;
  const padL = 8, padR = 56, padT = 14, padB = 24;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  // Y domain — include prevClose so the baseline is meaningful on 1D.
  const closes = points.map((p) => p.c);
  let min = Math.min(...closes);
  let max = Math.max(...closes);
  const prev = data.meta && data.meta.prevClose;
  const range = state.range;
  if ((range === '1D' || range === '5D') && typeof prev === 'number') {
    min = Math.min(min, prev);
    max = Math.max(max, prev);
  }
  if (min === max) { min -= 1; max += 1; }
  const padY = (max - min) * 0.08;
  min -= padY;
  max += padY;

  const t0 = points[0].t;
  const t1 = points[points.length - 1].t;
  const xOf = (t) => padL + ((t - t0) / (t1 - t0 || 1)) * plotW;
  const yOf = (c) => padT + (1 - (c - min) / (max - min)) * plotH;

  // Up/down color based on period start vs end (or prevClose on intraday).
  const first = (range === '1D' && typeof prev === 'number') ? prev : closes[0];
  const last = closes[closes.length - 1];
  const upColor = '#2bd97c', downColor = '#ff453a';
  const lineColor = last >= first ? upColor : downColor;

  // ── grid + y labels ──
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
    ctx.textAlign = 'left';
    ctx.fillText(v.toFixed(2), W - padR + 6, y);
  }

  // ── x date labels ──
  const xTicks = Math.min(6, points.length - 1);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
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

  // ── prevClose dashed baseline (intraday) ──
  if ((range === '1D' || range === '5D') && typeof prev === 'number') {
    const y = yOf(prev);
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(122,130,144,0.5)';
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(W - padR, y);
    ctx.stroke();
    ctx.restore();
  }

  // ── area gradient fill ──
  const grad = ctx.createLinearGradient(0, padT, 0, padT + plotH);
  const rgb = last >= first ? '43,217,124' : '255,69,58';
  grad.addColorStop(0, `rgba(${rgb},0.22)`);
  grad.addColorStop(1, `rgba(${rgb},0.0)`);
  ctx.beginPath();
  ctx.moveTo(xOf(points[0].t), yOf(points[0].c));
  for (const p of points) ctx.lineTo(xOf(p.t), yOf(p.c));
  ctx.lineTo(xOf(t1), padT + plotH);
  ctx.lineTo(xOf(t0), padT + plotH);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // ── price line ──
  ctx.beginPath();
  ctx.moveTo(xOf(points[0].t), yOf(points[0].c));
  for (const p of points) ctx.lineTo(xOf(p.t), yOf(p.c));
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 1.6;
  ctx.lineJoin = 'round';
  ctx.stroke();

  // cache geometry for hover
  chartGeom = { points, padL, padR, padT, padB, plotW, plotH, W, H, t0, t1, min, max, xOf, yOf, lineColor };

  // re-draw crosshair if hovering
  if (hoverX !== null) drawCrosshair();
}

function formatTick(ms, range) {
  const d = new Date(ms);
  if (range === '1D') return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (range === '5D') return d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });
  if (range === '5Y' || range === '1Y') return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
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

  // tooltip
  const dateStr = new Date(nearest.t).toLocaleString('en-US', {
    month: 'short', day: 'numeric',
    hour: state.range === '1D' || state.range === '5D' ? 'numeric' : undefined,
    minute: state.range === '1D' || state.range === '5D' ? '2-digit' : undefined,
  });
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
  document.querySelectorAll('.ttab').forEach((t) => t.classList.toggle('active', t.dataset.view === name));
  document.dispatchEvent(new CustomEvent('tabshown', { detail: { view: name } }));
}

function setupTabs() {
  document.getElementById('ttabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.ttab');
    if (btn) showView(btn.dataset.view);
  });
}

// ───────────────────────── boot ─────────────────────────
function boot() {
  tickClock();
  setInterval(tickClock, 1000);

  setupTabs();
  setupCommandBar();
  setupRangeButtons();

  loadTape();
  setInterval(loadTape, TAPE_REFRESH_MS);

  loadSymbol(DEFAULT_SYMBOL);
  setInterval(() => {
    if (state.symbol) loadQuote(state.symbol); // auto-refresh quote
  }, QUOTE_REFRESH_MS);

  // Deep-link: /?tab=alerts (used by push notifications) opens that view on load.
  const startTab = new URLSearchParams(location.search).get('tab');
  if (startTab) showView(startTab === 'analysis' ? 'sectors' : startTab);

  // Redraw chart on resize (debounced).
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (state.chart) drawChart(); }, 150);
  });
}

document.addEventListener('DOMContentLoaded', boot);
