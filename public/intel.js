/* ════════════════════════════════════════════════════════════════
   Market Terminal — Intelligence module (NEWS · SECTORS · WATCHLIST · ALERTS)
   Ported from the standalone Market Intelligence app. Wrapped in an IIFE so its
   helpers ($, esc, …) don't collide with the terminal's app.js globals.
   Talks only to /api/intel/* and the push routes — keys stay server-side.
   Lazy-loads each view the first time it's opened (via the `tabshown` event
   dispatched by app.js), to avoid spending Groq tokens until needed.
   ════════════════════════════════════════════════════════════════ */
(() => {
  'use strict';

  const CATEGORIES = ['political', 'financial', 'federal-reserve', 'earnings', 'macro', 'geopolitical', 'trade'];

  let newsItems = [];
  let analysisData = null;
  let activeFilter = 'all';
  let sortMode = 'invest';

  const $ = (sel) => document.querySelector(sel);
  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---------- "Watch it" helpers ----------
  const WATCHABLE = new Set(['political', 'geopolitical', 'federal-reserve']);
  const hasLiveUrl = (item) => !!item.watchUrl && /^https?:\/\//i.test(item.watchUrl);
  function watchHref(item) {
    if (hasLiveUrl(item)) return item.watchUrl;
    return 'https://www.youtube.com/results?search_query=' + encodeURIComponent(((item.title || '') + ' live').trim());
  }
  function watchBtn(item) {
    if (!hasLiveUrl(item) && !WATCHABLE.has(item.category)) return '';
    const live = hasLiveUrl(item);
    return `<a class="watch-btn ${live ? 'live' : ''}" href="${esc(watchHref(item))}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${live ? '🔴 Watch live' : '▶ Find live video'}</a>`;
  }

  // ---------- robust JSON fetch ----------
  // Returns parsed JSON for any JSON response (incl. 4xx/5xx, so the caller can
  // read {error,message}); only retries when the body isn't JSON (e.g. a proxy /
  // cold-start HTML page) or the network blips.
  async function fetchJSON(url, onWaking) {
    const MAX_TRIES = 4;
    for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
      try {
        const res = await fetch(url, { headers: { Accept: 'application/json' } });
        const ct = res.headers.get('content-type') || '';
        if (ct.includes('application/json')) return res.json();
      } catch (_) { /* retry */ }
      if (attempt < MAX_TRIES) {
        if (onWaking) onWaking(attempt);
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
    throw new Error('Server is taking a moment — please try again.');
  }

  // ---------- News ----------
  function buildChips() {
    const wrap = $('#filterChips');
    const all = ['all', ...CATEGORIES];
    wrap.innerHTML = all
      .map((c) => `<button class="chip ${c === activeFilter ? 'active' : ''}" data-cat="${c}">${c === 'all' ? 'All' : c.replace('-', ' ')}</button>`)
      .join('');
    wrap.querySelectorAll('.chip').forEach((chip) => {
      chip.addEventListener('click', () => { activeFilter = chip.dataset.cat; buildChips(); renderNews(); });
    });
  }

  function newsCard(item, i) {
    const cat = esc(item.category || 'macro');
    const time = item.timestamp
      ? new Date(item.timestamp).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
    return `
      <article class="card" data-i="${i}">
        <div class="card-head">
          <div style="flex:1">
            <div class="card-title">${item.priority === 'high' ? '<span class="priority-dot">● </span>' : ''}${esc(item.title)}</div>
            <div class="card-summary">${esc(item.summary)}</div>
          </div>
        </div>
        <div class="card-meta">
          <span class="tag cat-${cat}">${cat.replace('-', ' ')}</span>
          <span>${esc(item.source || '')}</span>
          ${time ? `<span>· ${time}</span>` : ''}
        </div>
        ${watchBtn(item)}
        ${Array.isArray(item.tickers) && item.tickers.length
          ? `<div class="tickers">${item.tickers.map((t) => `<span class="ticker-tag ${isWatched(t) ? 'watched' : ''}" data-ticker="${esc(t)}" title="Add ${esc(t)} to watchlist">${esc(t)}</span>`).join('')}</div>`
          : ''}
        <div class="card-detail">
          <div class="detail-inner">
            ${esc(item.detail)}
            ${item.marketImpact ? `<div class="impact"><b>Market impact:</b> ${esc(item.marketImpact)}</div>` : ''}
          </div>
        </div>
      </article>`;
  }

  function wireCards(container) {
    container.querySelectorAll('.card').forEach((card) => {
      card.addEventListener('click', () => card.classList.toggle('open'));
    });
    container.querySelectorAll('.ticker-tag, .pick-ticker').forEach((tag) => {
      tag.addEventListener('click', (e) => { e.stopPropagation(); addToWatchlist(tag.dataset.ticker); tag.classList.add('watched'); });
    });
  }

  function renderNews() {
    const breaking = newsItems.filter((n) => n.priority === 'high');
    const breakingSec = $('#breaking');
    if (breaking.length) {
      breakingSec.classList.remove('hidden');
      $('#breakingList').innerHTML = breaking.map((n) => newsCard(n, newsItems.indexOf(n))).join('');
      wireCards($('#breakingList'));
    } else {
      breakingSec.classList.add('hidden');
    }
    const filtered = activeFilter === 'all' ? newsItems : newsItems.filter((n) => n.category === activeFilter);
    $('#newsList').innerHTML = filtered.map((n) => newsCard(n, newsItems.indexOf(n))).join('');
    wireCards($('#newsList'));
  }

  async function loadNews() {
    $('#newsStatus').className = 'status';
    $('#newsStatus').innerHTML = '<span class="spinner"></span>Fetching live market news…';
    $('#newsList').innerHTML = '';
    $('#breaking').classList.add('hidden');
    try {
      const data = await fetchJSON('/api/intel/news');
      if (data.error) throw new Error(data.message);
      newsItems = data.items || [];
      $('#newsStatus').textContent = '';
      buildChips();
      renderNews();
    } catch (err) {
      $('#newsStatus').className = 'status error';
      $('#newsStatus').textContent = 'Could not load news: ' + err.message;
    }
  }

  // ---------- Analysis ----------
  function renderSentiment() {
    if (!analysisData) return;
    const banner = $('#sentimentBanner');
    const s = analysisData.marketSentiment || 'Neutral';
    banner.className = 'sentiment-banner ' + s.toLowerCase();
    banner.innerHTML = `
      <div class="sent-top">
        <span class="sent-label">${esc(s)}</span>
        <span class="sent-score"><b>${esc(analysisData.sentimentScore)}</b>/10</span>
      </div>
      <div class="sent-summary">${esc(analysisData.marketSummary)}</div>
      <div class="themes">${(analysisData.keyThemes || []).map((t) => `<span class="theme">${esc(t)}</span>`).join('')}</div>`;
  }

  function renderTopPicks() {
    const sec = $('#topPicks');
    const picks = (analysisData && analysisData.topInvestPicks) || [];
    if (!picks.length) { sec.classList.add('hidden'); return; }
    sec.classList.remove('hidden');
    $('#topPicksList').innerHTML = picks.map((p, i) => {
      const conv = p.conviction === 'High' ? 'High' : 'Medium';
      return `
      <div class="pick">
        <span class="pick-rank">${i + 1}</span>
        <span class="pick-ticker ${isWatched(p.ticker) ? 'watched' : ''}" data-ticker="${esc(p.ticker)}" title="Add ${esc(p.ticker)} to watchlist">${esc(p.ticker)}</span>
        <div class="pick-body">
          <div class="pick-name">${esc(p.name)}</div>
          <div class="pick-thesis">${esc(p.thesis)}</div>
          <div class="pick-meta">
            <span class="pick-sector">${esc(p.sector || '')}</span>
            <span class="conviction conv-${conv}">${conv} conviction</span>
          </div>
        </div>
      </div>`;
    }).join('');
    $('#topPicksList').querySelectorAll('.pick-ticker').forEach((tag) => {
      tag.addEventListener('click', () => { addToWatchlist(tag.dataset.ticker); tag.classList.add('watched'); });
    });
  }

  function industryCard(ind, i) {
    const rank = sortMode === 'invest' ? ind.investRank : ind.optionsRank;
    const score = sortMode === 'invest' ? ind.investScore : ind.optionsScore;
    return `
      <article class="card" data-i="${i}">
        <div class="card-head">
          <div class="rank-badge">${esc(rank)}</div>
          <span class="ind-icon">${esc(ind.icon || '📊')}</span>
          <div style="flex:1">
            <div class="ind-name">${esc(ind.name)}</div>
            <div class="ind-etf">${esc(ind.etf)}</div>
          </div>
          <span class="score-pill">${sortMode === 'invest' ? 'Invest' : 'Options'} ${esc(score)}</span>
        </div>
        <div class="card-detail">
          <div class="detail-inner">
            ${esc(ind.analysis)}
            ${Array.isArray(ind.topPicks) && ind.topPicks.length
              ? `<div class="sector-picks">
                  <h4 class="sp-label">Top stocks in this sector</h4>
                  ${ind.topPicks.map((p) => `<div class="sp-row">
                        <span class="pick-ticker ${isWatched(p.ticker) ? 'watched' : ''}" data-ticker="${esc(p.ticker)}" title="Add ${esc(p.ticker)} to watchlist">${esc(p.ticker)}</span>
                        <div><span class="sp-name">${esc(p.name)}</span><div class="sp-thesis">${esc(p.thesis)}</div></div>
                      </div>`).join('')}
                </div>`
              : ''}
            <div class="cols">
              <div class="col-up"><h4>Upsides</h4><ul>${(ind.upsides || []).map((u) => `<li>${esc(u)}</li>`).join('')}</ul></div>
              <div class="col-down"><h4>Downsides</h4><ul>${(ind.downsides || []).map((d) => `<li>${esc(d)}</li>`).join('')}</ul></div>
            </div>
            <div class="options-box">
              <div class="ob-label">Options outlook</div>
              <div class="ob-tags">
                <span class="tag bias-${esc(ind.optionsBias)}">${esc(ind.optionsBias)}</span>
                <span class="tag">IV: ${esc(ind.impliedVolatility)}</span>
                <span class="tag">${esc(ind.optionsTimeframe)}</span>
              </div>
              <div class="ob-strategy">${esc(ind.optionsStrategy)}</div>
            </div>
          </div>
        </div>
      </article>`;
  }

  function renderIndustries() {
    if (!analysisData) return;
    const list = [...(analysisData.industries || [])].sort((a, b) =>
      sortMode === 'invest' ? a.investRank - b.investRank : a.optionsRank - b.optionsRank);
    const container = $('#industryList');
    container.innerHTML = list.map((ind, i) => industryCard(ind, i)).join('');
    wireCards(container);
  }

  document.querySelectorAll('.seg').forEach((seg) => {
    seg.addEventListener('click', () => {
      document.querySelectorAll('.seg').forEach((s) => s.classList.remove('active'));
      seg.classList.add('active');
      sortMode = seg.dataset.mode;
      renderIndustries();
    });
  });

  async function loadAnalysis() {
    $('#analysisStatus').className = 'status';
    $('#analysisStatus').innerHTML = '<span class="spinner"></span>Analyzing all 11 sectors…';
    $('#industryList').innerHTML = '';
    $('#sentimentBanner').classList.add('hidden');
    try {
      const data = await fetchJSON('/api/intel/analysis');
      if (data.error) throw new Error(data.message);
      analysisData = data;
      $('#analysisStatus').textContent = '';
      $('#sentimentBanner').classList.remove('hidden');
      renderSentiment();
      renderTopPicks();
      renderIndustries();
    } catch (err) {
      $('#analysisStatus').className = 'status error';
      $('#analysisStatus').textContent = 'Could not load analysis: ' + err.message;
    }
  }

  // ---------- Alerts ----------
  let alertsData = [];

  function alertCard(a, i) {
    const cat = esc(a.category || 'macro');
    const time = a.timestamp
      ? new Date(a.timestamp).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
    return `
      <article class="card alert-card" data-i="${i}">
        <div class="card-head">
          <div style="flex:1">
            <div class="card-title"><span class="priority-dot">● </span>${esc(a.title)}</div>
            <div class="card-summary">${esc(a.summary)}</div>
          </div>
        </div>
        <div class="card-meta">
          <span class="tag cat-${cat}">${cat.replace('-', ' ')}</span>
          <span>${esc(a.source || '')}</span>
          ${time ? `<span>· ${time}</span>` : ''}
        </div>
        ${watchBtn(a)}
        ${Array.isArray(a.tickers) && a.tickers.length
          ? `<div class="tickers">${a.tickers.map((t) => `<span class="ticker-tag ${isWatched(t) ? 'watched' : ''}" data-ticker="${esc(t)}" title="Add ${esc(t)} to watchlist">${esc(t)}</span>`).join('')}</div>`
          : ''}
        ${a.detail || a.marketImpact
          ? `<div class="card-detail"><div class="detail-inner">${esc(a.detail || '')}${a.marketImpact ? `<div class="impact"><b>Market impact:</b> ${esc(a.marketImpact)}</div>` : ''}</div></div>`
          : ''}
      </article>`;
  }

  function renderAlerts() {
    const list = $('#alertsList');
    const status = $('#alertsStatus');
    if (!alertsData.length) {
      status.className = 'status';
      status.textContent = 'No breaking alerts yet. When something major happens it’ll show up here — and notify you if alerts are on.';
      list.innerHTML = '';
      return;
    }
    status.textContent = '';
    list.innerHTML = alertsData.map((a, i) => alertCard(a, i)).join('');
    wireCards(list);
  }

  async function loadAlerts() {
    try {
      const data = await fetchJSON('/api/intel/alerts');
      if (data.error) throw new Error(data.message);
      alertsData = data.alerts || [];
      renderAlerts();
    } catch (err) {
      $('#alertsStatus').className = 'status error';
      $('#alertsStatus').textContent = 'Could not load alerts: ' + err.message;
    }
  }

  // ---------- Push notifications ----------
  let swReg = null;
  const isiOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const pushSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

  async function registerSW() {
    if (!('serviceWorker' in navigator)) return null;
    try { swReg = await navigator.serviceWorker.register('sw.js'); return swReg; }
    catch (e) { console.warn('SW register failed', e); return null; }
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    const arr = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr;
  }

  function setAlertHint(html) {
    const hint = $('#alertHint');
    if (!html) { hint.classList.add('hidden'); hint.innerHTML = ''; return; }
    hint.classList.remove('hidden');
    hint.innerHTML = html;
  }

  function reflectAlertState() {
    const btn = $('#enableAlertsBtn');
    btn.disabled = false;
    if (!pushSupported) {
      if (isiOS && !isStandalone) {
        btn.textContent = 'How to turn on';
        setAlertHint(
          'On iPhone, notifications need the app on your Home Screen first:<br>' +
          '1) In Safari, tap the <b>Share</b> button (the box with an ↑).<br>' +
          '2) Choose <b>Add to Home Screen</b>.<br>' +
          '3) Open <b>Market Terminal</b> from your Home Screen, come back here, and tap <b>Enable Alerts</b>.'
        );
        return;
      }
      btn.textContent = 'Not supported here';
      btn.disabled = true;
      setAlertHint('This browser can’t do push notifications. Use Chrome on Android/desktop, or add this app to your iPhone Home Screen.');
      return;
    }
    if (Notification.permission === 'granted') {
      btn.textContent = '✓ Alerts on — send a test';
      setAlertHint('');
    } else if (Notification.permission === 'denied') {
      btn.textContent = 'Blocked';
      setAlertHint('Notifications are blocked for this site in your browser/phone settings. Re-allow them there, then reload this page.');
    } else {
      btn.textContent = 'Enable Alerts';
      setAlertHint('');
    }
  }

  async function ensureSubscribed(reg) {
    if (!reg) return false;
    const keyRes = await fetch('/api/vapid-public-key').then((r) => r.json());
    if (!keyRes.enabled || !keyRes.key) { setAlertHint('Push isn’t configured on the server yet.'); return false; }
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(keyRes.key) });
    }
    await fetch('/api/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sub) });
    return true;
  }

  async function enableAlerts() {
    if (!pushSupported) { reflectAlertState(); return; }
    const btn = $('#enableAlertsBtn');
    try {
      if (Notification.permission === 'granted') {
        const reg = swReg || (await registerSW());
        await ensureSubscribed(reg);
        await fetch('/api/test-push', { method: 'POST' });
        setAlertHint('Sent a test notification — check your device. 🔔');
        return;
      }
      btn.disabled = true;
      btn.textContent = 'Asking permission…';
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { reflectAlertState(); return; }
      const reg = swReg || (await registerSW());
      if (!reg) { setAlertHint('Could not start the notification worker.'); reflectAlertState(); return; }
      const ok = await ensureSubscribed(reg);
      if (!ok) { reflectAlertState(); return; }
      await fetch('/api/test-push', { method: 'POST' });
      reflectAlertState();
      setAlertHint('You’re all set — a test notification is on its way. 🎉');
    } catch (err) {
      console.error(err);
      setAlertHint('Could not enable alerts: ' + ((err && err.message) || err));
      reflectAlertState();
    }
  }
  $('#enableAlertsBtn').addEventListener('click', enableAlerts);

  // ---------- Watchlist ----------
  let watchlist = [];
  const companyCache = {};

  function loadWatchlistLS() {
    try { watchlist = JSON.parse(localStorage.getItem('mt_watchlist') || '[]'); } catch { watchlist = []; }
  }
  function saveWatchlist() { localStorage.setItem('mt_watchlist', JSON.stringify(watchlist)); }
  function isWatched(query) { return watchlist.some((w) => w.toLowerCase() === String(query).toLowerCase()); }

  function addToWatchlist(query) {
    const q = String(query || '').trim();
    if (!q || isWatched(q)) return;
    watchlist.push(q);
    saveWatchlist();
    renderWatchlist();
    loadCompany(q);
  }
  function removeFromWatchlist(query) {
    watchlist = watchlist.filter((w) => w !== query);
    delete companyCache[query];
    saveWatchlist();
    renderWatchlist();
    document.querySelectorAll(`.ticker-tag[data-ticker="${query}"]`).forEach((t) => t.classList.remove('watched'));
  }

  function companyNewsItem(n) {
    const impact = ['positive', 'negative', 'neutral'].includes(n.impact) ? n.impact : 'neutral';
    const glyph = impact === 'positive' ? '▲' : impact === 'negative' ? '▼' : '–';
    const time = n.timestamp
      ? new Date(n.timestamp).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
    return `
      <div class="cnews">
        <div class="impact-dot impact-${impact}">${glyph}</div>
        <div class="cnews-body">
          <div class="cnews-title">${esc(n.title)}</div>
          <div class="cnews-summary">${esc(n.summary)}</div>
          ${n.impactReason ? `<div class="cnews-reason impact-${impact}">${glyph} ${esc(n.impactReason)}</div>` : ''}
          <div class="cnews-meta">${esc(n.source || '')}${time ? ' · ' + time : ''}</div>
        </div>
      </div>`;
  }

  function companyBlock(query) {
    const data = companyCache[query];
    const safeId = 'co-' + btoa(unescape(encodeURIComponent(query))).replace(/[^a-z0-9]/gi, '');
    let body;
    if (data === undefined) {
      body = `<div class="company-loading"><span class="spinner"></span>Finding news…</div>`;
    } else if (data && data.errorMsg) {
      body = `<div class="company-loading">Couldn't load: ${esc(data.errorMsg)}</div>`;
    } else if (!data.news || !data.news.length) {
      body = `<div class="company-loading">No recent news found.</div>`;
    } else {
      body = (data.summary ? `<div class="company-summary">${esc(data.summary)}</div>` : '') +
        `<div class="company-news">${data.news.map(companyNewsItem).join('')}</div>`;
    }
    const sent = data && data.overallSentiment ? data.overallSentiment.toLowerCase() : null;
    const name = (data && data.companyName) || query;
    const ticker = data && data.ticker ? data.ticker : '';
    return `
      <section class="wl-company" id="${safeId}">
        <div class="company-head">
          <div class="grow">
            <div class="company-name">${esc(name)}</div>
            ${ticker ? `<div class="company-ticker">${esc(ticker)}</div>` : ''}
          </div>
          ${sent ? `<span class="sentiment-pill sent-${sent}">${esc(data.overallSentiment)}</span>` : ''}
          <button class="company-remove" data-q="${esc(query)}" title="Remove">✕</button>
        </div>
        ${body}
      </section>`;
  }

  function renderWatchlist() {
    const wrap = $('#watchList');
    const empty = $('#watchEmpty');
    if (!watchlist.length) { empty.classList.remove('hidden'); wrap.innerHTML = ''; return; }
    empty.classList.add('hidden');
    wrap.innerHTML = watchlist.map(companyBlock).join('');
    wrap.querySelectorAll('.company-remove').forEach((btn) => {
      btn.addEventListener('click', () => removeFromWatchlist(btn.dataset.q));
    });
  }

  async function loadCompany(query) {
    try {
      const data = await fetchJSON('/api/intel/company?q=' + encodeURIComponent(query));
      companyCache[query] = data.error ? { errorMsg: data.message } : data;
    } catch (err) {
      companyCache[query] = { errorMsg: err.message };
    }
    renderWatchlist();
  }
  function loadAllCompanies() {
    watchlist.forEach((q) => { if (companyCache[q] === undefined) loadCompany(q); });
  }
  function refreshAllCompanies() {
    watchlist.forEach((q) => { delete companyCache[q]; });
    renderWatchlist();
    watchlist.forEach((q) => loadCompany(q));
  }

  $('#watchForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#watchInput');
    addToWatchlist(input.value);
    input.value = '';
  });

  // Expose addToWatchlist so the terminal view's tickers could hook in later.
  window.MarketIntel = { addToWatchlist };

  // ---------- Supply chain (SPLC) ----------
  let scLoadedFor = null;
  const money = (n) => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function quoteHtml(q) {
    if (!q) return '<span class="sc-priv">private / non-US</span>';
    const cls = q.percent > 0 ? 'up' : q.percent < 0 ? 'down' : '';
    const pct = (q.percent > 0 ? '+' : '') + Number(q.percent).toFixed(2) + '%';
    return `<span class="sc-q ${cls}">${money(q.price)} <span class="sc-pct">${pct}</span></span>`;
  }

  function scCard(e) {
    const t = e.ticker || '';
    return `
      <div class="sc-card ${t ? 'has-ticker' : ''} tier-${esc(e.tier || 'major')}" ${t ? `data-ticker="${esc(t)}" title="Open ${esc(t)} in the terminal"` : ''}>
        <div class="sc-card-top">
          <span class="sc-ticker">${t ? esc(t) : '—'}</span>
          <span class="sc-name">${esc(e.name || t)}</span>
        </div>
        <div class="sc-rel">${esc(e.relationship || '')}</div>
        <div class="sc-card-q">${quoteHtml(e.quote)}</div>
      </div>`;
  }

  function peerChip(p) {
    const q = p.quote;
    const cls = q ? (q.percent > 0 ? 'up' : q.percent < 0 ? 'down' : '') : '';
    return `<span class="sc-peer ${p.ticker ? 'has-ticker' : ''} ${cls}" ${p.ticker ? `data-ticker="${esc(p.ticker)}" title="Open ${esc(p.ticker)} in the terminal"` : ''}>${esc(p.ticker)}${q ? ` <b>${money(q.price)}</b>` : ''}</span>`;
  }

  // Clicking any ticker drills into the TERMINAL view for that symbol (uses
  // app.js globals showView + loadSymbol).
  function drillTo(ticker) {
    if (!ticker) return;
    if (typeof showView === 'function' && typeof loadSymbol === 'function') { showView('terminal'); loadSymbol(ticker); }
  }
  function wireDrills(container) {
    container.querySelectorAll('[data-ticker]').forEach((el) => el.addEventListener('click', () => drillTo(el.dataset.ticker)));
  }

  let scData = null;
  let scMode = 'graph';
  const trunc = (s, n) => { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

  function renderFocal(d) {
    const focal = $('#scFocal');
    focal.classList.remove('hidden');
    focal.innerHTML = `
      <div class="sc-focal-main">
        <span class="sc-focal-ticker">${esc(d.ticker || '—')}</span>
        <div class="sc-focal-id">
          <div class="sc-focal-name">${esc(d.company || '')}</div>
          <div class="sc-focal-sum">${esc(d.summary || '')}</div>
        </div>
      </div>
      <div class="sc-focal-q">${quoteHtml(d.focalQuote)}</div>`;
  }

  function renderList(d) {
    const col = (label, cls, list) => `
      <div class="sc-col">
        <div class="sc-col-head ${cls}">${label} <span class="sc-count">${list.length}</span></div>
        <div class="sc-list">${list.length ? list.map(scCard).join('') : '<div class="sc-empty">None identified.</div>'}</div>
      </div>`;
    const grid = $('#scGrid');
    grid.innerHTML = col('▲ SUPPLIERS', 'sc-suppliers', d.suppliers || []) + col('▼ CUSTOMERS', 'sc-customers', d.customers || []);
    wireDrills(grid);
    const peersEl = $('#scPeers');
    const peers = d.peers || [];
    peersEl.innerHTML = peers.length
      ? `<div class="sc-peers-head">◆ PEERS / COMPETITORS</div><div class="sc-peers-list">${peers.map(peerChip).join('')}</div>`
      : '';
    wireDrills(peersEl);
  }

  // ----- Network graph (Bloomberg SPLC style), hand-drawn in SVG -----
  function edgePath(a, b, cls) {
    const dx = Math.max(40, Math.abs(b.x - a.x) * 0.45);
    const c1x = a.x + (b.x >= a.x ? dx : -dx);
    const c2x = b.x + (a.x >= b.x ? dx : -dx);
    return `<path class="edge ${cls}" d="M${a.x.toFixed(1)},${a.y.toFixed(1)} C${c1x.toFixed(1)},${a.y.toFixed(1)} ${c2x.toFixed(1)},${b.y.toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)}"/>`;
  }

  function gnode(e, x, y, w, h, cls, small) {
    const t = e.ticker || '';
    const q = e.quote;
    const qcls = q ? (q.percent > 0 ? 'up' : q.percent < 0 ? 'down' : '') : '';
    let inner;
    if (small) {
      inner = `<text class="n-tick" x="${x + 8}" y="${y + h / 2 + 4}">${esc(t || '—')}</text>` +
        (q ? `<text class="n-price ${qcls}" x="${x + w - 8}" y="${y + h / 2 + 4}" text-anchor="end">${money(q.price)}</text>` : '');
    } else {
      inner = `<text class="n-tick" x="${x + 8}" y="${y + 18}">${esc(t || '—')}</text>` +
        (q ? `<text class="n-price ${qcls}" x="${x + w - 8}" y="${y + 18}" text-anchor="end">${money(q.price)}</text>`
           : `<text class="n-priv" x="${x + w - 8}" y="${y + 18}" text-anchor="end">n/a</text>`) +
        `<text class="n-name" x="${x + 8}" y="${y + 34}">${esc(trunc(e.name || t, 24))}</text>`;
    }
    return `<g class="node ${cls} ${t ? 'clickable' : ''}" ${t ? `data-ticker="${esc(t)}"` : ''}>` +
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2"/>${inner}</g>`;
  }

  function supplyGraphSVG(d) {
    const W = 1060, H = 720;
    const NW = 170, NH = 46, FW = 200, FH = 84, PW = 150, PH = 34;
    const cx = W / 2, cy = (H - 110) / 2 + 12;
    const suppliers = (d.suppliers || []).slice(0, 8);
    const customers = (d.customers || []).slice(0, 8);
    const peers = (d.peers || []).slice(0, 6);

    const topPad = 30, bandBot = H - 150;
    const colY = (i, n) => (n <= 1 ? cy - NH / 2 : topPad + (bandBot - topPad - NH) * (i / (n - 1)));
    const Lx = 16, Rx = W - 16 - NW;

    let edges = '', nodes = '';
    const fL = { x: cx - FW / 2, y: cy }, fR = { x: cx + FW / 2, y: cy }, fB = { x: cx, y: cy + FH / 2 };

    suppliers.forEach((e, i) => { const y = colY(i, suppliers.length); edges += edgePath({ x: Lx + NW, y: y + NH / 2 }, fL, 'sup'); nodes += gnode(e, Lx, y, NW, NH, 'sup'); });
    customers.forEach((e, i) => { const y = colY(i, customers.length); edges += edgePath(fR, { x: Rx, y: y + NH / 2 }, 'cust'); nodes += gnode(e, Rx, y, NW, NH, 'cust'); });
    const pY = H - 64, n = peers.length;
    const gap = n > 1 ? (W - 80 - n * PW) / (n - 1) : 0;
    peers.forEach((e, i) => { const x = n === 1 ? (W - PW) / 2 : 40 + i * (PW + gap); edges += edgePath(fB, { x: x + PW / 2, y: pY }, 'peer'); nodes += gnode(e, x, pY, PW, PH, 'peer', true); });

    const fx = cx - FW / 2, fy = cy - FH / 2, fq = d.focalQuote;
    const focal = `<g class="node focal"><rect x="${fx}" y="${fy}" width="${FW}" height="${FH}" rx="3"/>` +
      `<text class="f-tick" x="${cx}" y="${fy + 30}" text-anchor="middle">${esc(d.ticker || '')}</text>` +
      `<text class="f-name" x="${cx}" y="${fy + 50}" text-anchor="middle">${esc(trunc(d.company || '', 28))}</text>` +
      (fq ? `<text class="f-price ${fq.percent >= 0 ? 'up' : 'down'}" x="${cx}" y="${fy + 70}" text-anchor="middle">${money(fq.price)}  ${(fq.percent > 0 ? '+' : '') + Number(fq.percent).toFixed(2)}%</text>` : '') +
      `</g>`;

    const labels = `<text class="cl-label sup" x="${Lx}" y="16">▲ SUPPLIERS · ${suppliers.length}</text>` +
      `<text class="cl-label cust" x="${W - 16}" y="16" text-anchor="end">CUSTOMERS · ${customers.length} ▼</text>` +
      (peers.length ? `<text class="cl-label peer" x="${cx}" y="${H - 86}" text-anchor="middle">◆ PEERS / COMPETITORS</text>` : '');

    return `<svg viewBox="0 0 ${W} ${H}" class="scg" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Supply chain network for ${esc(d.ticker || '')}">` +
      `<g class="edges">${edges}</g>${labels}${nodes}${focal}</svg>`;
  }

  function renderGraph(d) {
    const el = $('#scGraph');
    el.innerHTML = supplyGraphSVG(d);
    el.querySelectorAll('.node.clickable').forEach((g) => g.addEventListener('click', () => drillTo(g.getAttribute('data-ticker'))));
  }

  function renderActiveMode() {
    if (!scData) return;
    const graph = scMode === 'graph';
    $('#scGraph').style.display = graph ? '' : 'none';
    $('#scGrid').style.display = graph ? 'none' : '';
    $('#scPeers').style.display = graph ? 'none' : '';
    if (graph) renderGraph(scData); else renderList(scData);
  }

  function renderSupplyChain(d) {
    scData = d;
    $('#scToggle').hidden = false;
    renderFocal(d);
    renderActiveMode();
  }

  document.querySelectorAll('.sc-mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      scMode = btn.dataset.mode;
      document.querySelectorAll('.sc-mode-btn').forEach((b) => b.classList.toggle('active', b === btn));
      renderActiveMode();
    });
  });

  async function loadSupplyChain(query) {
    const q = String(query || '').trim();
    if (!q) return;
    scLoadedFor = q.toUpperCase();
    $('#scInput').value = q.toUpperCase();
    $('#scStatus').className = 'status';
    $('#scStatus').innerHTML = '<span class="spinner"></span>Mapping supply chain for ' + esc(q.toUpperCase()) + '… (identifying suppliers & customers, fetching live prices)';
    $('#scFocal').classList.add('hidden');
    $('#scToggle').hidden = true;
    $('#scGraph').innerHTML = '';
    $('#scGrid').innerHTML = '';
    $('#scPeers').innerHTML = '';
    try {
      const data = await fetchJSON('/api/intel/supplychain?q=' + encodeURIComponent(q));
      if (data.error) throw new Error(data.message);
      $('#scStatus').textContent = '';
      renderSupplyChain(data);
    } catch (err) {
      $('#scStatus').className = 'status error';
      $('#scStatus').textContent = 'Could not map supply chain: ' + err.message;
    }
  }

  $('#scForm').addEventListener('submit', (e) => { e.preventDefault(); loadSupplyChain($('#scInput').value); });

  // ---------- Deep Dive (full AI analyst report) ----------
  let ddLoadedFor = null;

  const RATING_CLASS = (r) => {
    const k = String(r || '').toLowerCase();
    if (k.includes('strong buy')) return 'rate-strongbuy';
    if (k.includes('buy')) return 'rate-buy';
    if (k.includes('strong sell')) return 'rate-strongsell';
    if (k.includes('sell')) return 'rate-sell';
    return 'rate-hold';
  };
  const BIAS_CLASS = (b) => {
    const k = String(b || '').toLowerCase();
    if (k === 'calls') return 'bias-calls';
    if (k === 'puts') return 'bias-puts';
    if (k === 'avoid') return 'bias-avoid';
    return 'bias-straddle';
  };
  const pctChangeHtml = (q) => {
    if (!q || q.price == null) return '';
    const up = (q.change || 0) >= 0;
    return `<span class="dd-price">$${Number(q.price).toFixed(2)}</span>` +
      `<span class="dd-chg ${up ? 'up' : 'down'}">${up ? '▲' : '▼'} ${Math.abs(q.change || 0).toFixed(2)} (${Math.abs(q.percent || 0).toFixed(2)}%)</span>`;
  };

  function consensusBar(c) {
    if (!c) return '';
    const segs = [
      ['strongBuy', c.strongBuy || 0, '#16c784'], ['buy', c.buy || 0, '#3fb950'],
      ['hold', c.hold || 0, '#d8a657'], ['sell', c.sell || 0, '#f0883e'], ['strongSell', c.strongSell || 0, '#f85149'],
    ];
    const total = segs.reduce((n, s) => n + s[1], 0) || 1;
    const bars = segs.map(([, v, col]) => v ? `<span style="width:${(v / total) * 100}%;background:${col}" title="${v}"></span>` : '').join('');
    return `<div class="dd-consensus"><div class="dd-consensus-label">ANALYST CONSENSUS <span>(${total} ratings · ${esc(c.period || '')})</span></div>` +
      `<div class="dd-consensus-bar">${bars}</div>` +
      `<div class="dd-consensus-legend"><span>${c.strongBuy || 0} Strong Buy</span><span>${c.buy || 0} Buy</span><span>${c.hold || 0} Hold</span><span>${c.sell || 0} Sell</span><span>${c.strongSell || 0} Strong Sell</span></div></div>`;
  }

  const liList = (arr) => (Array.isArray(arr) ? arr : []).map((x) => `<li>${esc(x)}</li>`).join('');

  function renderDeepDive(d) {
    const inv = d.investment || {}, opt = d.options || {}, st = d.stats || {};
    const html = `
      <div class="dd-card">
        <div class="dd-head">
          ${st.logo ? `<img class="dd-logo" src="${esc(st.logo)}" alt="" onerror="this.style.display='none'">` : ''}
          <div class="dd-id">
            <div class="dd-ticker" data-ticker="${esc(d.ticker)}">${esc(d.ticker)}</div>
            <div class="dd-name">${esc(d.company)}${st.industry ? ` · ${esc(st.industry)}` : ''}</div>
          </div>
          <div class="dd-quote">${pctChangeHtml(d.quote)}</div>
        </div>

        <p class="dd-summary">${esc(d.summary)}</p>

        <div class="dd-ratings">
          <div class="dd-rating ${RATING_CLASS(inv.rating)}">
            <div class="dd-rating-top"><span class="dd-rating-kind">STOCK</span><span class="dd-rating-score">${inv.score != null ? inv.score : '—'}<i>/100</i></span></div>
            <div class="dd-rating-badge">${esc(inv.rating || '—')}</div>
            <div class="dd-rating-meta">${esc(inv.conviction || '')} conviction · ${esc(inv.horizon || '')}</div>
            <div class="dd-rating-thesis">${esc(inv.thesis || '')}</div>
            ${inv.fairValue && inv.fairValue !== 'N/A' ? `<div class="dd-fair">Fair value: <b>${esc(inv.fairValue)}</b></div>` : ''}
          </div>
          <div class="dd-rating ${BIAS_CLASS(opt.bias)}">
            <div class="dd-rating-top"><span class="dd-rating-kind">OPTIONS</span><span class="dd-rating-score">${opt.score != null ? opt.score : '—'}<i>/100</i></span></div>
            <div class="dd-rating-badge">${esc(opt.bias || '—')}</div>
            <div class="dd-rating-meta">IV ${esc(opt.impliedVolatility || '?')} · ${esc(opt.timeframe || '')}</div>
            <div class="dd-rating-thesis"><b>${esc(opt.recommendation || '')}</b><br>${esc(opt.rationale || '')}</div>
          </div>
        </div>

        ${d.keyDrivers ? `<div class="dd-drivers"><span class="dd-drivers-label">WHAT'S MOVING IT</span> ${esc(d.keyDrivers)}</div>` : ''}

        <div class="dd-cases">
          <div class="dd-case dd-bull"><h4>▲ BULL CASE</h4><ul>${liList(d.bullCase)}</ul></div>
          <div class="dd-case dd-bear"><h4>▼ BEAR CASE</h4><ul>${liList(d.bearCase)}</ul></div>
        </div>

        <div class="dd-cases">
          <div class="dd-case dd-cat"><h4>⚡ CATALYSTS</h4><ul>${liList(d.catalysts)}</ul></div>
          <div class="dd-case dd-risk"><h4>⚠ RISKS</h4><ul>${liList(d.risks)}</ul></div>
        </div>

        <div class="dd-stats">
          ${st.marketCap ? `<div class="dd-stat"><span>MKT CAP</span><b>${esc(st.marketCap)}</b></div>` : ''}
          ${st.pe != null ? `<div class="dd-stat"><span>P/E</span><b>${Number(st.pe).toFixed(1)}</b></div>` : ''}
          ${st.beta != null ? `<div class="dd-stat"><span>BETA</span><b>${Number(st.beta).toFixed(2)}</b></div>` : ''}
          ${st.high52 != null ? `<div class="dd-stat"><span>52W HIGH</span><b>$${Number(st.high52).toFixed(2)}</b></div>` : ''}
          ${st.low52 != null ? `<div class="dd-stat"><span>52W LOW</span><b>$${Number(st.low52).toFixed(2)}</b></div>` : ''}
          <div class="dd-stat news-tone"><span>NEWS TONE</span><b class="tone-${esc(d.newsSentiment || 'neutral')}">${esc((d.newsSentiment || 'neutral').toUpperCase())}</b></div>
        </div>

        ${consensusBar(d.analystConsensus)}

        <button class="dd-open" data-ticker="${esc(d.ticker)}">Open ${esc(d.ticker)} in Terminal →</button>
        <p class="dd-disclaimer">AI-generated analysis from live data — educational only, not investment advice.</p>
      </div>`;
    const wrap = $('#ddResult');
    wrap.innerHTML = html;
    wrap.querySelectorAll('[data-ticker]').forEach((el) => {
      el.style.cursor = 'pointer';
      el.addEventListener('click', () => drillTo(el.dataset.ticker));
    });
  }

  async function loadDeepDive(query) {
    const q = String(query || '').trim();
    if (!q) return;
    ddLoadedFor = q;
    $('#ddInput').value = q;
    $('#ddStatus').className = 'status';
    $('#ddStatus').innerHTML = '<span class="spinner"></span>Running deep analysis on ' + esc(q.toUpperCase()) + '… (gathering live news, fundamentals & analyst views, then reasoning)';
    $('#ddResult').innerHTML = '';
    try {
      const data = await fetchJSON('/api/intel/deepdive?q=' + encodeURIComponent(q));
      if (data.error) throw new Error(data.message);
      $('#ddStatus').textContent = '';
      renderDeepDive(data);
    } catch (err) {
      $('#ddStatus').className = 'status error';
      $('#ddStatus').textContent = 'Could not analyze that stock: ' + err.message;
    }
  }

  $('#ddForm').addEventListener('submit', (e) => { e.preventDefault(); loadDeepDive($('#ddInput').value); });

  // ---------- GLOBAL INTEL: AI Investment Report ----------
  let reportLoaded = false;

  const ACTION_CLASS = (a) => {
    const k = String(a || '').toLowerCase();
    if (k === 'buy') return 'act-buy';
    if (k === 'short' || k === 'avoid') return 'act-sell';
    return 'act-watch';
  };
  const REGIME_CLASS = (r) => {
    const k = String(r || '').toLowerCase();
    if (k.includes('risk-on')) return 'reg-on';
    if (k.includes('risk-off') || k.includes('defensive')) return 'reg-off';
    return 'reg-mixed';
  };

  function tickerChip(ticker, quotes, why, side) {
    const t = String(ticker || '').toUpperCase();
    const q = quotes && quotes[t];
    const price = q ? `<span class="tc-price">$${Number(q.price).toFixed(2)}</span><span class="tc-chg ${(q.change || 0) >= 0 ? 'up' : 'down'}">${(q.change || 0) >= 0 ? '+' : ''}${(q.percent || 0).toFixed(1)}%</span>` : '';
    return `<button class="ticker-chip ${side || ''}" data-ticker="${esc(t)}" title="${esc(why || '')}"><b>${esc(t)}</b>${price}</button>`;
  }

  function renderReport(d) {
    const picks = (d.topPicks || []).map((p) => `
      <div class="pick-card ${ACTION_CLASS(p.action)}">
        <div class="pick-top">
          <button class="pick-ticker" data-ticker="${esc(p.ticker)}">${esc(p.ticker)}</button>
          <span class="pick-action">${esc(p.action || '')}</span>
        </div>
        <div class="pick-company">${esc(p.company || '')}</div>
        ${(d.quotes && d.quotes[String(p.ticker).toUpperCase()]) ? `<div class="pick-price">$${Number(d.quotes[String(p.ticker).toUpperCase()].price).toFixed(2)} <span class="${(d.quotes[String(p.ticker).toUpperCase()].change || 0) >= 0 ? 'up' : 'down'}">${(d.quotes[String(p.ticker).toUpperCase()].percent || 0).toFixed(2)}%</span></div>` : ''}
        <div class="pick-rationale">${esc(p.rationale || '')}</div>
        <div class="pick-meta"><span>⚡ ${esc(p.catalyst || '')}</span><span class="pick-conv">${esc(p.conviction || '')} · ${esc(p.timeframe || '')}</span></div>
      </div>`).join('');

    const themes = (d.themes || []).map((t) => `
      <div class="theme-card">
        <h4>${esc(t.theme || '')}</h4>
        <p class="theme-drivers">${esc(t.drivers || '')}</p>
        <div class="theme-sides">
          <div class="theme-win"><span class="theme-lbl up">▲ WINNERS</span> ${(t.winners || []).map((w) => tickerChip(w.ticker, d.quotes, w.why, 'win')).join('')}</div>
          <div class="theme-lose"><span class="theme-lbl down">▼ LOSERS</span> ${(t.losers || []).map((w) => tickerChip(w.ticker, d.quotes, w.why, 'lose')).join('')}</div>
        </div>
      </div>`).join('');

    const html = `
      <div class="report-card">
        <div class="report-banner ${REGIME_CLASS(d.marketRegime)}">
          <span class="report-regime">${esc(d.marketRegime || '—')}</span>
          <span class="report-headline">${esc(d.headline || '')}</span>
        </div>
        <p class="report-summary">${esc(d.summary || '')}</p>

        <h3 class="section-label">★ TOP ACTIONABLE IDEAS</h3>
        <div class="picks-grid">${picks}</div>

        <h3 class="section-label">⊞ THEMES IN PLAY</h3>
        <div class="themes-wrap">${themes}</div>

        <div class="report-foot">
          <div class="report-col"><h4>⚠ KEY RISKS</h4><ul>${(d.risks || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
          <div class="report-col"><h4>📅 WATCH NEXT</h4><ul>${(d.watchEvents || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
        </div>
        <p class="dd-disclaimer">AI-generated from live world &amp; market headlines — educational only, not investment advice.</p>
      </div>`;
    const wrap = $('#reportBody');
    wrap.innerHTML = html;
    wrap.querySelectorAll('[data-ticker]').forEach((el) => { el.style.cursor = 'pointer'; el.addEventListener('click', () => drillTo(el.dataset.ticker)); });
  }

  async function loadReport() {
    reportLoaded = true;
    $('#reportStatus').className = 'status';
    $('#reportStatus').innerHTML = '<span class="spinner"></span>Reading the live world-events feed and building your investment report…';
    $('#reportBody').innerHTML = '';
    try {
      const data = await fetchJSON('/api/intel/report');
      if (data.error) throw new Error(data.message);
      $('#reportStatus').textContent = '';
      renderReport(data);
    } catch (err) {
      $('#reportStatus').className = 'status error';
      $('#reportStatus').textContent = 'Could not build report: ' + err.message;
    }
  }

  // ---------- GLOBAL INTEL: sub-navigation (Briefing / Report / Map) ----------
  let giSub = 'briefing';
  function showGiSub(sub) {
    giSub = sub;
    document.querySelectorAll('.gi-subtab').forEach((b) => b.classList.toggle('active', b.dataset.sub === sub));
    document.querySelectorAll('.gi-panel').forEach((pnl) => pnl.classList.toggle('active', pnl.id === 'gi-' + sub));
    if (sub === 'report' && !reportLoaded) loadReport();
    if (sub === 'map' && window.ShipMap) window.ShipMap.open();
  }
  document.querySelectorAll('.gi-subtab').forEach((b) => b.addEventListener('click', () => showGiSub(b.dataset.sub)));

  // ---------- View lifecycle (driven by app.js `tabshown`) ----------
  const loaded = { news: false, sectors: false };
  let currentView = 'terminal';
  const refreshBtn = document.getElementById('intelRefresh');

  function refreshCurrent() {
    if (currentView === 'news') { if (giSub === 'report') loadReport(); else loadNews(); }
    else if (currentView === 'sectors') loadAnalysis();
    else if (currentView === 'watchlist') refreshAllCompanies();
    else if (currentView === 'alerts') loadAlerts();
    else if (currentView === 'supply') { if (scLoadedFor) loadSupplyChain(scLoadedFor); }
    else if (currentView === 'analyze') { if (ddLoadedFor) loadDeepDive(ddLoadedFor); }
  }

  // Auto-refresh intelligence views while they're open.
  let autoRefreshTimer = null;
  function setAutoRefresh() {
    if (autoRefreshTimer) clearInterval(autoRefreshTimer);
    if (currentView === 'news') {
      autoRefreshTimer = setInterval(() => { if (giSub === 'report') loadReport(); else loadNews(); }, 5 * 60_000); // 5 min
    } else if (currentView === 'sectors') {
      autoRefreshTimer = setInterval(() => loadAnalysis(), 10 * 60_000); // 10 min
    } else if (currentView === 'watchlist') {
      autoRefreshTimer = setInterval(() => refreshAllCompanies(), 3 * 60_000); // 3 min
    } else if (currentView === 'analyze') {
      if (ddLoadedFor) autoRefreshTimer = setInterval(() => loadDeepDive(ddLoadedFor), 15 * 60_000); // 15 min
    } else {
      if (autoRefreshTimer) clearInterval(autoRefreshTimer);
    }
  }
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      refreshBtn.classList.add('spinning');
      Promise.resolve(refreshCurrent()).finally(() => setTimeout(() => refreshBtn.classList.remove('spinning'), 600));
    });
  }

  document.addEventListener('tabshown', (e) => {
    const view = e.detail && e.detail.view;
    currentView = view;
    const intelView = view !== 'terminal';
    if (refreshBtn) refreshBtn.hidden = !intelView;

    if (view === 'news') { if (!loaded.news) { loaded.news = true; loadNews(); } setAutoRefresh(); }
    else if (view === 'sectors') { if (!loaded.sectors) { loaded.sectors = true; loadAnalysis(); } setAutoRefresh(); }
    else if (view === 'watchlist') { loadAllCompanies(); setAutoRefresh(); }
    else if (view === 'alerts') { reflectAlertState(); loadAlerts(); if (autoRefreshTimer) clearInterval(autoRefreshTimer); }
    else if (view === 'supply') {
      if (!scLoadedFor) {
        const sym = (typeof state !== 'undefined' && state.symbol) ? state.symbol : 'AAPL';
        loadSupplyChain(sym);
      } else {
        renderActiveMode(); // keep the displayed mode consistent on re-open
      }
      if (autoRefreshTimer) clearInterval(autoRefreshTimer);
    }
    else if (view === 'analyze') {
      if (!ddLoadedFor) {
        const sym = (typeof state !== 'undefined' && state.symbol) ? state.symbol : 'NVDA';
        loadDeepDive(sym);
      }
      setAutoRefresh();
    }
    else if (autoRefreshTimer) clearInterval(autoRefreshTimer); // stop auto-refresh on terminal view
  });

  // ---------- Initial setup ----------
  loadWatchlistLS();
  renderWatchlist();
  buildChips();
  registerSW().then((reg) => {
    if (reg && pushSupported && Notification.permission === 'granted') ensureSubscribed(reg).catch(() => {});
  });
  reflectAlertState();
})();
