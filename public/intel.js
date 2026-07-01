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
    // Sort newest first by timestamp before rendering.
    newsItems.sort((a, b) => {
      const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return tb - ta;
    });
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
    const W = 1060;
    const NW = 170, NH = 46, FW = 200, FH = 84, PW = 150, PH = 34;
    const suppliers = d.suppliers || [];
    const customers = d.customers || [];
    const peers = (d.peers || []).slice(0, 6);
    const maxCol = Math.max(suppliers.length, customers.length, 1);
    const H = Math.max(720, maxCol * (NH + 14) + 200);
    const cx = W / 2, cy = (H - 110) / 2 + 12;

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
      </div>

      <div class="quant-lab" id="quantLab">
        <div class="quant-lab-head">QUANT LAB — ${esc(d.ticker)}</div>
        <div class="quant-lab-body">

          <!-- ── Monte Carlo simulator ── -->
          <div>
            <div class="ql-section-title">Monte Carlo Simulator</div>
            <div class="ql-row">
              <div class="ql-field">
                <label>Model</label>
                <select id="qlMcModel">
                  <option value="gbm">GBM (Classic)</option>
                  <option value="rjd" selected>Rough Jump-Diffusion</option>
                  <option value="heston">Heston Stoch-Vol</option>
                </select>
              </div>
              <div class="ql-field"><label>Horizon (days)</label><input id="qlMcDays" type="number" value="63" min="1" max="2520" /></div>
              <div class="ql-field"><label>Target price</label><input id="qlMcTarget" type="number" step="0.01" placeholder="—" /></div>
              <div class="ql-field"><label>Paths</label><input id="qlMcPaths" type="number" value="2000" min="200" max="10000" step="100" /></div>
              <button class="ql-btn" id="qlMcRun" type="button">Run</button>
            </div>
            <div id="qlRjdParams" class="ql-row ql-sub-row">
              <div class="ql-field"><label>Hurst (H)</label><input id="qlHurst" type="number" step="0.01" value="0.35" min="0.01" max="0.49" /></div>
              <div class="ql-field"><label>Jump λ/yr</label><input id="qlLambda" type="number" step="0.5" value="2" min="0" max="50" /></div>
              <div class="ql-field"><label>Jump μ</label><input id="qlJumpMu" type="number" step="0.01" value="-0.05" /></div>
              <div class="ql-field"><label>Jump σ</label><input id="qlJumpSig" type="number" step="0.01" value="0.08" min="0.001" /></div>
            </div>
            <div id="qlHestonParams" class="ql-row ql-sub-row" style="display:none">
              <div class="ql-field"><label>v₀</label><input id="qlHv0" type="number" step="0.005" value="0.04" min="0.001" /></div>
              <div class="ql-field"><label>κ (reversion)</label><input id="qlHkappa" type="number" step="0.1" value="2.0" min="0.1" /></div>
              <div class="ql-field"><label>θ (long-var)</label><input id="qlHtheta" type="number" step="0.005" value="0.04" min="0.001" /></div>
              <div class="ql-field"><label>ξ (vol-of-vol)</label><input id="qlHxi" type="number" step="0.05" value="0.5" min="0.01" /></div>
              <div class="ql-field"><label>ρ (corr)</label><input id="qlHrho" type="number" step="0.05" value="-0.7" min="-0.99" max="0.99" /></div>
            </div>
            <div id="qlMcStatus" class="status">Loading 1Y price history…</div>
            <canvas id="mcCanvas" hidden></canvas>
            <div class="ql-stat-grid" id="qlMcStats" hidden>
              <div class="stat"><span class="stat-label">EXP. PRICE (MEDIAN)</span><span class="stat-val" id="qlMedian">—</span></div>
              <div class="stat"><span class="stat-label">VaR 95%</span><span class="stat-val" id="qlVar95">—</span></div>
              <div class="stat"><span class="stat-label">CVaR 95%</span><span class="stat-val" id="qlCvar95">—</span></div>
              <div class="stat"><span class="stat-label">PROB ≥ TARGET</span><span class="stat-val" id="qlProbAbove">—</span></div>
              <div class="stat"><span class="stat-label">MODEL</span><span class="stat-val" id="qlModelLabel">—</span></div>
            </div>
            <div class="ql-ai-note" id="qlMcNote" hidden></div>
          </div>

          <!-- ── Options pricer + Greeks ── -->
          <div>
            <div class="ql-section-title">Options Pricer &amp; Greeks</div>
            <div class="ql-row">
              <div class="ql-field"><label>Strike</label><input id="qlBsStrike" type="number" step="0.01" placeholder="—" /></div>
              <div class="ql-field"><label>Expiry (days)</label><input id="qlBsExpiry" type="number" value="30" min="1" max="2520" /></div>
              <div class="ql-field"><label>IV (%)</label><input id="qlBsIv" type="number" step="0.1" placeholder="—" /></div>
              <div class="ql-field"><label>Risk-free (%)</label><input id="qlBsR" type="number" step="0.1" value="4.5" /></div>
              <button class="ql-toggle-btn active" id="qlBsCall" type="button" data-type="call">Call</button>
              <button class="ql-toggle-btn" id="qlBsPut" type="button" data-type="put">Put</button>
              <button class="ql-btn" id="qlBsRun" type="button">Price</button>
            </div>
            <div class="ql-price-out" id="qlBsPrice">—</div>
            <div class="ql-section-title" style="font-size:10px;margin:6px 0 4px">BLACK-SCHOLES GREEKS</div>
            <div class="ql-greeks-grid" id="qlBsGreeks">
              <div class="stat"><span class="stat-label">DELTA</span><span class="stat-val" id="qlDelta">—</span></div>
              <div class="stat"><span class="stat-label">GAMMA</span><span class="stat-val" id="qlGamma">—</span></div>
              <div class="stat"><span class="stat-label">THETA/DAY</span><span class="stat-val" id="qlTheta">—</span></div>
              <div class="stat"><span class="stat-label">VEGA</span><span class="stat-val" id="qlVega">—</span></div>
              <div class="stat"><span class="stat-label">RHO</span><span class="stat-val" id="qlRho">—</span></div>
            </div>
            <div class="ql-section-title" style="font-size:10px;margin:10px 0 4px">MALLIAVIN PATH-GREEKS <span style="font-weight:400;opacity:0.6">(from last MC run)</span></div>
            <div class="ql-greeks-grid" id="qlMalliavinGreeks">
              <div class="stat"><span class="stat-label">Δ (Malliavin)</span><span class="stat-val" id="qlMDelta">—</span></div>
              <div class="stat"><span class="stat-label">Γ (Malliavin)</span><span class="stat-val" id="qlMGamma">—</span></div>
              <div class="stat"><span class="stat-label">ν (Malliavin)</span><span class="stat-val" id="qlMVega">—</span></div>
            </div>
          </div>

          <!-- ── Technical indicator suite ── -->
          <div>
            <div class="ql-section-title">40-Indicator Technical Suite</div>
            <div id="qlMcStatus2" class="status" style="font-size:11px"></div>
            <div class="ql-ind-grid" id="qlIndGrid"></div>
            <div class="ql-section-title" style="margin-top:14px">Volume Profile (50 bins)</div>
            <canvas id="qlVolProfile" height="80" hidden></canvas>
          </div>

        </div>
      </div>`;
    const wrap = $('#ddResult');
    wrap.innerHTML = html;
    wrap.querySelectorAll('[data-ticker]').forEach((el) => {
      el.style.cursor = 'pointer';
      el.addEventListener('click', () => drillTo(el.dataset.ticker));
    });
    setupQuantLab(d.ticker, d.quote && d.quote.price);
  }

  // Plain-English read of a Monte Carlo run — computed instantly from the
  // simulation's own output (no extra AI call, so re-running with different
  // horizon/target/paths updates the note immediately with no added latency).
  function buildMcNote({ ticker, S0, days, paths, target, medianPrice, p5, p95, probAbove, varAtH, cvarAtH }) {
    const pctChg = (medianPrice / S0 - 1) * 100;
    const dir = pctChg >= 0 ? 'up' : 'down';
    const oddsWord = probAbove >= 0.65 ? 'favors' : probAbove <= 0.35 ? 'leans against' : 'is roughly a coin flip on';
    return `Across ${paths.toLocaleString()} simulated paths over ${days} trading days, ${ticker}'s median outcome is `
      + `$${medianPrice.toFixed(2)} (${dir} ${Math.abs(pctChg).toFixed(1)}% from $${S0.toFixed(2)}), with a 90% range of `
      + `$${p5.toFixed(2)}–$${p95.toFixed(2)}. The model ${oddsWord} finishing above your $${target.toFixed(2)} target `
      + `(${(probAbove * 100).toFixed(0)}% of paths). At 95% confidence, downside risk over this horizon is a `
      + `${(varAtH * 100).toFixed(1)}% loss (VaR), averaging ${(cvarAtH * 100).toFixed(1)}% in the worst-case tail (CVaR). `
      + `This is a statistical projection from historical volatility and drift, not a forecast — actual prices can and do break outside these bands.`;
  }

  // ---------- Quant Lab: Monte Carlo (GBM/RJD/Heston) + B-S + Malliavin + 40 indicators ----------
  async function setupQuantLab(ticker, lastPrice) {
    const status = $('#qlMcStatus');
    let points = null, closes = null, highs = null, lows = null, volumes = null;
    let S0 = lastPrice || null, mu = 0.08, sigma = 0.25;
    let lastMcResult = null; // store for Malliavin re-use

    try {
      const data = await fetchJSON(`/api/chart?symbol=${encodeURIComponent(ticker)}&range=1Y`);
      if (data.points && data.points.length > 20) {
        points  = data.points;
        closes  = points.map((p) => p.c);
        highs   = points.map((p) => p.h || p.c * 1.005);
        lows    = points.map((p) => p.l || p.c * 0.995);
        volumes = points.map((p) => p.v || 0);
        if (!S0) S0 = closes[closes.length - 1];
        const rets = Quant.dailyReturns(closes);
        mu    = Quant.annualizedReturn(rets);
        sigma = Quant.annualizedVol(rets);
        status.textContent = '';
        renderIndicatorSuite(closes, highs, lows, volumes, ticker);
      } else {
        status.textContent = 'Not enough history — using rough defaults.';
      }
    } catch {
      status.textContent = 'Could not load price history — using rough defaults.';
    }
    if (!S0) S0 = 100;
    if (!isFinite(mu)) mu = 0.08;
    if (!isFinite(sigma) || sigma <= 0) sigma = 0.25;

    $('#qlMcTarget').value = S0.toFixed(2);
    $('#qlBsStrike').value = S0.toFixed(2);
    $('#qlBsIv').value    = (sigma * 100).toFixed(1);

    // ── Model selector: show/hide sub-param rows ──
    function syncParamRows() {
      const model = $('#qlMcModel').value;
      $('#qlRjdParams').style.display  = model === 'rjd'    ? '' : 'none';
      $('#qlHestonParams').style.display = model === 'heston' ? '' : 'none';
    }
    syncParamRows();
    $('#qlMcModel').addEventListener('change', syncParamRows);

    // ── Monte Carlo runner ──
    function runMonteCarlo() {
      const model  = $('#qlMcModel').value;
      const days   = Math.max(1, Math.min(2520, Number($('#qlMcDays').value) || 63));
      const paths  = Math.max(200, Math.min(10000, Number($('#qlMcPaths').value) || 2000));
      const target = Number($('#qlMcTarget').value) || S0;

      let mc;
      if (model === 'heston') {
        const v0    = Math.max(0.001, Number($('#qlHv0').value)    || 0.04);
        const kappa = Math.max(0.1,   Number($('#qlHkappa').value) || 2.0);
        const theta = Math.max(0.001, Number($('#qlHtheta').value) || 0.04);
        const xi    = Math.max(0.01,  Number($('#qlHxi').value)    || 0.5);
        const rho   = Math.max(-0.99, Math.min(0.99, Number($('#qlHrho').value) || -0.7));
        mc = Quant.hestonMC({ S0, mu, v0, kappa, theta, xi, rho, days, paths });
        $('#qlModelLabel').textContent = 'Heston';
      } else if (model === 'rjd') {
        const H       = Math.max(0.01, Math.min(0.49, Number($('#qlHurst').value)    || 0.35));
        const lambda  = Math.max(0,    Number($('#qlLambda').value)  || 2);
        const muJ     = Number($('#qlJumpMu').value)  || -0.05;
        const sigmaJ  = Math.max(0.001, Number($('#qlJumpSig').value) || 0.08);
        mc = Quant.roughJumpDiffusion({ S0, mu, sigma, days, paths, H, lambda, muJ, sigmaJ });
        $('#qlModelLabel').textContent = `RJD  H=${H}`;
      } else {
        mc = Quant.monteCarloGBM({ S0, mu, sigma, days, paths });
        $('#qlModelLabel').textContent = 'GBM';
      }
      lastMcResult = { mc, sigma, days };
      drawMcFanChart(mc, S0);

      const { var: varAtH, cvar: cvarAtH } = Quant.valueAtRisk(mc.terminalReturns, 0.95);
      const probAbove  = Quant.probAbove(mc.terminal, target);
      const medianPrice = Quant.percentile([...mc.terminal].sort((a, b) => a - b), 0.5);

      $('#qlMedian').textContent   = '$' + medianPrice.toFixed(2);
      $('#qlVar95').textContent    = (varAtH * 100).toFixed(1) + '%';
      $('#qlCvar95').textContent   = (cvarAtH * 100).toFixed(1) + '%';
      $('#qlProbAbove').textContent = (probAbove * 100).toFixed(1) + '%';
      $('#qlMcStats').hidden = false;

      const lastBand = mc.bands[mc.bands.length - 1];
      const noteEl   = $('#qlMcNote');
      noteEl.textContent = buildMcNote({
        ticker, S0, days, paths, target, medianPrice,
        p5: lastBand[0.05] ?? lastBand[0.05], p95: lastBand[0.95],
        probAbove, varAtH, cvarAtH,
      });
      noteEl.hidden = false;

      // Auto-refresh Malliavin Greeks with new MC result
      const K  = Number($('#qlBsStrike').value) || S0;
      const T  = Math.max(1, Number($('#qlBsExpiry').value) || 30) / 365;
      const bsT = (typeof bsType !== 'undefined') ? bsType : 'call';
      updateMalliavin(mc, sigma, T, K, bsT);
    }

    // ── Black-Scholes + Malliavin Greeks ──
    // NOTE: bsType must be declared BEFORE runMonteCarlo() is called below,
    // because runMonteCarlo() closes over it and `typeof` of a TDZ let throws.
    let bsType = 'call';

    $('#qlMcRun').addEventListener('click', runMonteCarlo);
    runMonteCarlo();
    $('#qlBsCall').addEventListener('click', () => { bsType = 'call'; $('#qlBsCall').classList.add('active'); $('#qlBsPut').classList.remove('active'); });
    $('#qlBsPut').addEventListener('click',  () => { bsType = 'put';  $('#qlBsPut').classList.add('active');  $('#qlBsCall').classList.remove('active'); });

    function updateMalliavin(mc, sig, T, K, type) {
      if (!mc || !mc.terminal || mc.terminal.length < 100) return;
      const mg = Quant.malliavinGreeks({ terminal: mc.terminal, S0, sigma: sig, T, K, r: 0.045, type });
      if (!mg) return;
      $('#qlMDelta').textContent = isFinite(mg.delta) ? mg.delta.toFixed(4) : '—';
      $('#qlMGamma').textContent = isFinite(mg.gamma) ? mg.gamma.toFixed(6) : '—';
      $('#qlMVega').textContent  = isFinite(mg.vega)  ? mg.vega.toFixed(4)  : '—';
    }

    function runBlackScholes() {
      const K  = Number($('#qlBsStrike').value) || S0;
      const T  = Math.max(1, Number($('#qlBsExpiry').value) || 30) / 365;
      const iv = Math.max(0.01, Number($('#qlBsIv').value) || sigma * 100) / 100;
      const r  = (Number($('#qlBsR').value) || 4.5) / 100;
      const res = Quant.blackScholes({ S: S0, K, T, r, sigma: iv, type: bsType });
      if (!res) return;
      $('#qlBsPrice').textContent = '$' + res.price.toFixed(2) + ' per share';
      $('#qlDelta').textContent   = res.delta.toFixed(4);
      $('#qlGamma').textContent   = res.gamma.toFixed(6);
      $('#qlTheta').textContent   = res.theta.toFixed(4);
      $('#qlVega').textContent    = res.vega.toFixed(4);
      $('#qlRho').textContent     = res.rho.toFixed(4);
      if (lastMcResult) updateMalliavin(lastMcResult.mc, iv, T, K, bsType);
    }
    $('#qlBsRun').addEventListener('click', runBlackScholes);
    runBlackScholes();
  }

  // ── Indicator suite renderer (40 indicators) ──
  function renderIndicatorSuite(closes, highs, lows, volumes, ticker) {
    const n = closes.length;
    const last = (arr) => { for (let i = arr.length - 1; i >= 0; i--) { if (arr[i] !== null && isFinite(arr[i])) return arr[i]; } return null; };
    const fmt = (v, dp = 2) => v !== null && isFinite(v) ? v.toFixed(dp) : '—';
    const fmtPct = (v) => v !== null && isFinite(v) ? (v * 100).toFixed(1) + '%' : '—';
    const color = (v, lo, hi) => {
      if (v === null || !isFinite(v)) return '';
      if (v > hi) return 'color:#2bd97c';
      if (v < lo) return 'color:#ff453a';
      return 'color:#ffd23f';
    };

    const rets = Quant.dailyReturns(closes);
    const adxR = Quant.adx(highs, lows, closes);
    const ich  = Quant.ichimoku(highs, lows, closes);
    const rsiV = last(Quant.rsi(closes));
    const cmoV = last(Quant.cmo(closes));
    const mfiV = volumes.some(v => v > 0) ? last(Quant.mfi(highs, lows, closes, volumes)) : null;
    const aoV  = last(Quant.awesomeOscillator(highs, lows));
    const adxV = last(adxR.adx);
    const diP  = last(adxR.diPlus);
    const diM  = last(adxR.diMinus);
    const macdR = Quant.macd(closes);
    const macdV  = last(macdR.macdLine);
    const macdSig = last(macdR.signalLine);
    const macdHist = last(macdR.histogram);
    const hmaV  = last(Quant.hullMA(closes));
    const sma20 = last(Quant.sma(closes, 20));
    const sma50 = last(Quant.sma(closes, 50));
    const sma200 = last(Quant.sma(closes, 200));
    const ema12 = last(Quant.ema(closes, 12));
    const ema26 = last(Quant.ema(closes, 26));
    const sarV  = last(Quant.parabolicSar(highs, lows));
    const roc   = last(Quant.rateOfChange(closes));
    const wrV   = last(Quant.williamsR(closes, highs, lows));
    const cciV  = last(Quant.cci(closes, highs, lows));
    const stoch = Quant.stochastic(closes, highs, lows);
    const stochK = last(stoch.k);
    const stochD = last(stoch.d);
    const bb    = Quant.bollingerBands(closes);
    const bbUp  = last(bb.upper), bbLo = last(bb.lower), bbMid = last(bb.mid);
    const atrV  = last(Quant.atr(closes.map((c,i) => ({c, h: highs[i], l: lows[i], o: c})), 14));
    const kcR   = Quant.keltnerChannels(closes, highs, lows);
    const kcUp  = last(kcR.upper), kcLo = last(kcR.lower);
    const dcR   = Quant.donchianChannels(highs, lows);
    const dcUp  = last(dcR.upper), dcLo = last(dcR.lower);
    const cvV   = last(Quant.chaikinVolatility(highs, lows));
    const sdV   = last(Quant.rollingStdDev(closes));
    const hvV   = last(Quant.historicalVolatility(closes));
    const ulcV  = Quant.ulcerIndex(closes);
    const obvV  = volumes.some(v => v > 0) ? last(Quant.obv(closes, volumes)) : null;
    const cmfV  = volumes.some(v => v > 0) ? last(Quant.cmf(highs, lows, closes, volumes)) : null;
    const vwapV = volumes.some(v => v > 0) ? last(Quant.vwap(closes, volumes, highs, lows)) : null;
    const adV   = volumes.some(v => v > 0) ? last(Quant.adLine(highs, lows, closes, volumes)) : null;
    const fiV   = volumes.some(v => v > 0) ? last(Quant.forceIndex(closes, volumes)) : null;
    const sharpe = Quant.sharpeRatio(rets);
    const sortino = Quant.sortinoRatio(rets);
    const mdd   = Quant.maxDrawdown(closes).pct;
    const calmar = Quant.calmarRatio(closes, closes.length / 252);
    const kelly  = Quant.kellyCriterion(rets);
    const hVaR  = Quant.historicalVaR(rets);
    const omega  = Quant.omegaRatio(rets);
    const lastClose = closes[closes.length - 1];

    // Trend signal for Ichimoku
    const tenkanL = last(ich.tenkan), kijunL = last(ich.kijun);
    const senkouAL = ich.senkouA ? last(ich.senkouA.slice(0, n)) : null;
    const senkouBL = ich.senkouB ? last(ich.senkouB.slice(0, n)) : null;
    const ichAboveCloud = senkouAL && senkouBL ? (lastClose > Math.max(senkouAL, senkouBL) ? '☁ Above cloud' : lastClose < Math.min(senkouAL, senkouBL) ? '☁ Below cloud' : '☁ In cloud') : '—';

    const indicators = [
      // Trend
      { g: 'TREND', name: 'SMA 20',          val: fmt(sma20),     note: sma20 ? (lastClose > sma20 ? '▲ Price above' : '▼ Price below') : '' },
      { g: 'TREND', name: 'SMA 50',           val: fmt(sma50),     note: sma50 ? (lastClose > sma50 ? '▲ Price above' : '▼ Price below') : '' },
      { g: 'TREND', name: 'SMA 200',          val: fmt(sma200),    note: sma200 ? (lastClose > sma200 ? '▲ Price above (bull)' : '▼ Price below (bear)') : '' },
      { g: 'TREND', name: 'EMA 12',           val: fmt(ema12),     note: '' },
      { g: 'TREND', name: 'EMA 26',           val: fmt(ema26),     note: '' },
      { g: 'TREND', name: 'Hull MA (20)',      val: fmt(hmaV),      note: hmaV ? (lastClose > hmaV ? '▲ Bullish' : '▼ Bearish') : '' },
      { g: 'TREND', name: 'Parabolic SAR',     val: fmt(sarV),      note: sarV ? (lastClose > sarV ? '▲ Uptrend' : '▼ Downtrend') : '' },
      { g: 'TREND', name: 'ADX (14)',          val: fmt(adxV, 1),   note: adxV ? (adxV > 25 ? (diP > diM ? '▲ Strong up' : '▼ Strong dn') : 'Weak / range') : '' },
      { g: 'TREND', name: '+DI / −DI',         val: `${fmt(diP,1)} / ${fmt(diM,1)}`, note: '' },
      { g: 'TREND', name: 'Ichimoku',          val: ichAboveCloud,  note: `T=${fmt(tenkanL)} K=${fmt(kijunL)}` },
      { g: 'TREND', name: 'MACD Line',         val: fmt(macdV, 3),  note: macdHist ? (macdHist > 0 ? '▲ Bullish' : '▼ Bearish') : '' },
      { g: 'TREND', name: 'MACD Signal',       val: fmt(macdSig, 3), note: '' },
      { g: 'TREND', name: 'MACD Histogram',    val: fmt(macdHist, 3), note: '' },
      // Momentum
      { g: 'MOMENTUM', name: 'RSI (14)',        val: fmt(rsiV, 1),   note: rsiV ? (rsiV > 70 ? 'Overbought' : rsiV < 30 ? 'Oversold' : 'Neutral') : '' },
      { g: 'MOMENTUM', name: 'Williams %R',     val: fmt(wrV, 1),    note: wrV ? (wrV > -20 ? 'Overbought' : wrV < -80 ? 'Oversold' : 'Neutral') : '' },
      { g: 'MOMENTUM', name: 'CCI (20)',        val: fmt(cciV, 0),   note: cciV ? (cciV > 100 ? 'Overbought' : cciV < -100 ? 'Oversold' : 'Neutral') : '' },
      { g: 'MOMENTUM', name: 'CMO (14)',        val: fmt(cmoV, 1),   note: cmoV ? (cmoV > 50 ? 'Bullish' : cmoV < -50 ? 'Bearish' : 'Neutral') : '' },
      { g: 'MOMENTUM', name: 'Stoch %K',       val: fmt(stochK, 1), note: stochK ? (stochK > 80 ? 'Overbought' : stochK < 20 ? 'Oversold' : '') : '' },
      { g: 'MOMENTUM', name: 'Stoch %D',       val: fmt(stochD, 1), note: '' },
      { g: 'MOMENTUM', name: 'ROC (12)',        val: roc !== null ? roc.toFixed(2) + '%' : '—', note: '' },
      { g: 'MOMENTUM', name: 'MFI (14)',        val: fmt(mfiV, 1),   note: mfiV ? (mfiV > 80 ? 'Overbought' : mfiV < 20 ? 'Oversold' : '') : '' },
      { g: 'MOMENTUM', name: 'Awesome Osc',    val: fmt(aoV, 3),    note: aoV ? (aoV > 0 ? '▲ Bullish' : '▼ Bearish') : '' },
      // Volatility
      { g: 'VOLATILITY', name: 'BB Upper',     val: fmt(bbUp),      note: '' },
      { g: 'VOLATILITY', name: 'BB Mid',       val: fmt(bbMid),     note: '' },
      { g: 'VOLATILITY', name: 'BB Lower',     val: fmt(bbLo),      note: '' },
      { g: 'VOLATILITY', name: 'ATR (14)',      val: fmt(atrV, 3),   note: atrV && lastClose ? `${(atrV/lastClose*100).toFixed(1)}% of price` : '' },
      { g: 'VOLATILITY', name: 'Keltner Upper', val: fmt(kcUp),     note: '' },
      { g: 'VOLATILITY', name: 'Keltner Lower', val: fmt(kcLo),     note: '' },
      { g: 'VOLATILITY', name: 'Donchian Upper', val: fmt(dcUp),    note: '' },
      { g: 'VOLATILITY', name: 'Donchian Lower', val: fmt(dcLo),    note: '' },
      { g: 'VOLATILITY', name: 'Chaikin Vol',  val: cvV !== null ? cvV.toFixed(1) + '%' : '—', note: '' },
      { g: 'VOLATILITY', name: 'Std Dev (20)', val: fmt(sdV, 3),    note: '' },
      { g: 'VOLATILITY', name: 'Hist. Vol (30d)', val: hvV !== null ? (hvV*100).toFixed(1)+'%' : '—', note: '' },
      { g: 'VOLATILITY', name: 'Ulcer Index',  val: fmt(ulcV, 2),   note: '' },
      // Volume
      { g: 'VOLUME', name: 'OBV',              val: obvV !== null ? (obvV/1e6).toFixed(1)+'M' : '—', note: '' },
      { g: 'VOLUME', name: 'CMF (21)',          val: fmt(cmfV, 4),   note: cmfV ? (cmfV > 0 ? 'Accumulation' : 'Distribution') : '' },
      { g: 'VOLUME', name: 'VWAP',             val: fmt(vwapV),     note: vwapV ? (lastClose > vwapV ? '▲ Above VWAP' : '▼ Below VWAP') : '' },
      { g: 'VOLUME', name: 'A/D Line',         val: adV !== null ? (adV/1e6).toFixed(1)+'M' : '—', note: '' },
      { g: 'VOLUME', name: 'Force Index (13)',  val: fiV !== null ? fiV.toExponential(2) : '—', note: '' },
      // Risk / Portfolio
      { g: 'RISK', name: 'Sharpe (1Y)',        val: sharpe !== null ? sharpe.toFixed(2) : '—', note: sharpe ? (sharpe > 1 ? '★ Excellent' : sharpe > 0 ? 'Positive' : 'Negative') : '' },
      { g: 'RISK', name: 'Sortino (1Y)',       val: sortino !== null ? sortino.toFixed(2) : '—', note: '' },
      { g: 'RISK', name: 'Max Drawdown',       val: mdd !== null ? (mdd*100).toFixed(1)+'%' : '—', note: '' },
      { g: 'RISK', name: 'Calmar Ratio',       val: calmar !== null ? calmar.toFixed(2) : '—', note: '' },
      { g: 'RISK', name: 'Kelly Fraction',     val: kelly !== null ? (kelly*100).toFixed(1)+'%' : '—', note: '' },
      { g: 'RISK', name: 'Hist VaR 95%',       val: hVaR ? (hVaR.var*100).toFixed(2)+'%' : '—', note: '' },
      { g: 'RISK', name: 'CVaR 95%',          val: hVaR ? (hVaR.cvar*100).toFixed(2)+'%' : '—', note: '' },
      { g: 'RISK', name: 'Omega Ratio',        val: omega !== null ? omega.toFixed(2) : '—', note: '' },
    ];

    const groups = ['TREND', 'MOMENTUM', 'VOLATILITY', 'VOLUME', 'RISK'];
    let html = '';
    for (const g of groups) {
      const rows = indicators.filter(ind => ind.g === g);
      html += `<div class="ql-ind-group"><div class="ql-ind-group-label">${g}</div>`;
      for (const ind of rows) {
        html += `<div class="ql-ind-row"><span class="ql-ind-name">${esc(ind.name)}</span><span class="ql-ind-val">${esc(ind.val)}</span>${ind.note ? `<span class="ql-ind-note">${esc(ind.note)}</span>` : ''}</div>`;
      }
      html += '</div>';
    }
    $('#qlIndGrid').innerHTML = html;
    $('#qlMcStatus2').textContent = `${indicators.length} indicators computed from ${n} trading days`;

    // Volume profile canvas
    if (volumes.some(v => v > 0)) {
      const profile = Quant.volumeProfile(closes, volumes, 50);
      drawVolumeProfile(profile);
    }
  }

  function drawVolumeProfile(profile) {
    const canvas = $('#qlVolProfile');
    if (!canvas || !profile.length) return;
    canvas.hidden = false;
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.offsetWidth || 300, H = 80;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const bins = profile.length;
    const bw = W / bins;
    for (let i = 0; i < bins; i++) {
      const b = profile[i];
      const barH = b.pct * H;
      ctx.fillStyle = `rgba(255,191,46,${0.15 + 0.7 * b.pct})`;
      ctx.fillRect(i * bw, H - barH, bw - 1, barH);
    }
    // Label min / max price
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '9px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('$' + profile[0].priceLow.toFixed(1), 2, H - 2);
    ctx.textAlign = 'right';
    ctx.fillText('$' + profile[bins - 1].priceHigh.toFixed(1), W - 2, H - 2);
  }

  function drawMcFanChart(mc, S0) {
    const canvas = $('#mcCanvas');
    canvas.hidden = false;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const W = rect.width, H = rect.height || 220;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    const ctx2 = canvas.getContext('2d');
    ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx2.clearRect(0, 0, W, H);

    const padL = 50, padR = 10, padT = 10, padB = 18;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const n = mc.bands.length;
    const p5 = mc.bands.map((row) => row[0.05]);
    const p25 = mc.bands.map((row) => row[0.25]);
    const p50 = mc.bands.map((row) => row[0.5]);
    const p75 = mc.bands.map((row) => row[0.75]);
    const p95 = mc.bands.map((row) => row[0.95]);
    const allVals = [...p5, ...p95, S0];
    const min = Math.min(...allVals), max = Math.max(...allVals);
    const xOf = (i) => padL + (i / (n - 1)) * plotW;
    const yOf = (v) => padT + (1 - (v - min) / (max - min || 1)) * plotH;

    function band(lo, hi, fill) {
      ctx2.beginPath();
      for (let i = 0; i < n; i++) ctx2[i === 0 ? 'moveTo' : 'lineTo'](xOf(i), yOf(hi[i]));
      for (let i = n - 1; i >= 0; i--) ctx2.lineTo(xOf(i), yOf(lo[i]));
      ctx2.closePath();
      ctx2.fillStyle = fill;
      ctx2.fill();
    }
    band(p5, p95, 'rgba(255,191,46,0.10)');
    band(p25, p75, 'rgba(255,191,46,0.18)');

    ctx2.beginPath();
    ctx2.strokeStyle = '#ffbf2e';
    ctx2.lineWidth = 1.6;
    for (let i = 0; i < n; i++) ctx2[i === 0 ? 'moveTo' : 'lineTo'](xOf(i), yOf(p50[i]));
    ctx2.stroke();

    // S0 reference line
    ctx2.beginPath();
    ctx2.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx2.lineWidth = 1;
    ctx2.setLineDash([3, 3]);
    ctx2.moveTo(padL, yOf(S0));
    ctx2.lineTo(W - padR, yOf(S0));
    ctx2.stroke();
    ctx2.setLineDash([]);

    ctx2.fillStyle = 'rgba(255,255,255,0.5)';
    ctx2.font = '10px "SF Mono", Menlo, monospace';
    ctx2.textAlign = 'right';
    ctx2.fillText('$' + max.toFixed(2), padL - 6, yOf(max) + 8);
    ctx2.fillText('$' + min.toFixed(2), padL - 6, yOf(min) + 2);
    ctx2.fillText('$' + S0.toFixed(2), padL - 6, yOf(S0) + 3);
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

  // ---------- GLOBAL INTEL: Situation Room (cross-domain AI synthesis) ----------
  let situationLoaded = false;
  const THREAT_CLASS = (t) => {
    const k = String(t || '').toLowerCase();
    if (k === 'severe' || k === 'high') return 'thr-high';
    if (k === 'elevated' || k === 'guarded') return 'thr-mid';
    return 'thr-low';
  };
  const DOMAIN_DOT = (lvl) => {
    const k = String(lvl || '').toLowerCase();
    return k === 'critical' ? '#ff453a' : k === 'active' ? '#ff8c00' : k === 'watch' ? '#ffd23f' : '#2bd97c';
  };
  function renderSituation(d) {
    const domains = (d.domains || []).map((x) => `
      <div class="sit-domain">
        <span class="sit-dot" style="background:${DOMAIN_DOT(x.level)}"></span>
        <div><div class="sit-dom-name">${esc(x.domain)} <span class="sit-lvl">${esc(x.level || '')}</span></div>
        <div class="sit-dom-sum">${esc(x.summary || '')}</div></div>
      </div>`).join('');
    const defcon = Math.min(5, Math.max(1, parseInt(d.defcon, 10) || 5));
    const DEFCON_COL = ['#ff453a', '#ff453a', '#ff8c00', '#ffd23f', '#45c8dc', '#2bd97c'][defcon];
    const pizza = String(d.pizzaIndex || 'Normal');
    const PIZZA_COL = { Quiet: '#2bd97c', Normal: '#45c8dc', Elevated: '#ff8c00', Spiking: '#ff453a' }[pizza] || '#45c8dc';
    const gauges = `
      <div class="gauges">
        <div class="gauge defcon">
          <div class="gauge-lbl">DEFCON</div>
          <div class="gauge-val" style="color:${DEFCON_COL}">${defcon}</div>
          <div class="defcon-pips">${[1, 2, 3, 4, 5].map((n) => `<span class="${n >= defcon ? 'on' : ''}" style="${n >= defcon ? 'background:' + DEFCON_COL : ''}"></span>`).join('')}</div>
          <div class="gauge-sub">${esc(d.defconLabel || '')}</div>
        </div>
        <div class="gauge pizza">
          <div class="gauge-lbl">🍕 PENTAGON PIZZA INDEX</div>
          <div class="gauge-val" style="color:${PIZZA_COL};font-size:20px">${esc(pizza)}</div>
          <div class="gauge-sub">${esc(d.pizzaNote || '')}</div>
        </div>
      </div>`;
    $('#situationBody').innerHTML = `
      <div class="sit-card">
        <div class="sit-head ${THREAT_CLASS(d.threatLevel)}">
          <span class="sit-threat">THREAT: ${esc(d.threatLevel || '—')}</span>
          <span class="sit-over">${esc(d.overview || '')}</span>
        </div>
        ${gauges}
        <div class="sit-domains">${domains}</div>
        <div class="sit-conv"><span class="sit-lbl">⊕ CONVERGENCE</span> ${esc(d.convergence || '')}</div>
        <div class="sit-conv"><span class="sit-lbl">📈 MARKET IMPLICATION</span> ${esc(d.marketImplication || '')}</div>
        <div class="report-col" style="margin-top:12px"><h4>👁 WATCHLIST</h4><ul>${(d.watchlist || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
        <p class="dd-disclaimer">AI synthesis of live world headlines — educational only, not advice.</p>
      </div>`;
  }
  async function loadSituation() {
    situationLoaded = true;
    $('#situationStatus').className = 'status';
    $('#situationStatus').innerHTML = '<span class="spinner"></span>Synthesizing the global situation…';
    $('#situationBody').innerHTML = '';
    try {
      const data = await fetchJSON('/api/intel/situation');
      if (data.error) throw new Error(data.message);
      $('#situationStatus').textContent = '';
      renderSituation(data);
    } catch (err) {
      $('#situationStatus').className = 'status error';
      $('#situationStatus').textContent = 'Could not build situation brief: ' + err.message;
    }
  }

  // ---------- GLOBAL INTEL: sub-navigation (Briefing / Situation / Report / Map) ----------
  let giSub = 'briefing';
  function showGiSub(sub) {
    giSub = sub;
    document.querySelectorAll('.gi-subtab').forEach((b) => b.classList.toggle('active', b.dataset.sub === sub));
    document.querySelectorAll('.gi-panel').forEach((pnl) => pnl.classList.toggle('active', pnl.id === 'gi-' + sub));
    if (sub === 'situation' && !situationLoaded) loadSituation();
    if (sub === 'report' && !reportLoaded) loadReport();
    if (sub === 'map' && window.ShipMap) window.ShipMap.open();
  }
  document.querySelectorAll('.gi-subtab').forEach((b) => b.addEventListener('click', () => showGiSub(b.dataset.sub)));

  // ── Infrastructure / Ships layer toggle ──────────────────────────────
  let activeMapLayer = 'ships';
  function showMapLayer(layer) {
    activeMapLayer = layer;
    document.querySelectorAll('.maplayer-btn').forEach(b => b.classList.toggle('active', b.dataset.layer === layer));
    const shipsEl = document.getElementById('mapLayerShips');
    const infraEl = document.getElementById('mapLayerInfra');
    if (shipsEl) shipsEl.hidden = layer !== 'ships';
    if (infraEl) infraEl.hidden = layer !== 'infra';
    if (layer === 'infra' && window.WorldMap) window.WorldMap.init();
    if (layer === 'ships' && window.ShipMap) window.ShipMap.open();
  }
  document.querySelectorAll('.maplayer-btn').forEach(b => b.addEventListener('click', () => showMapLayer(b.dataset.layer)));

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

  // When the tab regains focus, re-sync the open intelligence view immediately
  // (app.js owns the terminal view). Server-side SWR caching keeps the AI budget
  // safe — a focus refresh usually returns the cached payload and only does real
  // work when it's actually stale.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && currentView && currentView !== 'terminal') refreshCurrent();
  });
  window.addEventListener('focus', () => {
    if (currentView && currentView !== 'terminal') refreshCurrent();
  });

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

// ═══════════════════════════════════════════════════════════════════════════
// WORLD INFRASTRUCTURE MAP — Canvas engine (appended after main IIFE)
// ═══════════════════════════════════════════════════════════════════════════
(function WorldMapEngine() {
  'use strict';

  // ── Constants ─────────────────────────────────────────────────────────
  const TILE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}';
  const COLORS = {
    oil: '#e87722', gas: '#ffd23f', water: '#4ecdc4',
    undersea_cable: '#a78bfa', trade_route: '#06b6d4',
    // status alpha
    active: 1.0, operational: 1.0, partial: 0.65,
    planned: 0.35, construction: 0.5, sabotaged: 0.22, mothballed: 0.18,
  };
  const ROUTE_WIDTH = { trade_route: 3.5, undersea_cable: 1.2, oil: 2.5, gas: 2.0, water: 1.8 };
  const DASH = { planned: [6,4], construction: [3,3], sabotaged: [2,6], mothballed: [4,8] };

  // ── Viewport state ────────────────────────────────────────────────────
  const vp = { zoom: 1.5, cx: 0, cy: 0, dragging: false, dragStart: null, vpStart: null, animRaf: null, flowOffset: 0 };

  // ── Data cache ────────────────────────────────────────────────────────
  let infraData = null, landPolys = null;
  let hudFeature = null, hudX = 0, hudY = 0;
  let canvases = {}, ctxs = {}, mapRoot = null;

  // ── Web Mercator projection ────────────────────────────────────────────
  function project(lon, lat, scale) {
    const x = ((lon + 180) / 360) * scale;
    const sinLat = Math.sin(lat * Math.PI / 180);
    const y = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale;
    return [x, y];
  }
  function toScreen(lon, lat, W, H) {
    const scale = 256 * Math.pow(2, vp.zoom);
    const [mx, my] = project(lon, lat, scale);
    return [mx - vp.cx + W / 2, my - vp.cy + H / 2];
  }
  function screenToGeo(sx, sy, W, H) {
    const scale = 256 * Math.pow(2, vp.zoom);
    const mx = sx - W / 2 + vp.cx;
    const my = sy - H / 2 + vp.cy;
    const lon = (mx / scale) * 360 - 180;
    const latRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * my / scale)));
    return [lon, latRad * 180 / Math.PI];
  }

  // ── Douglas-Peucker simplification ────────────────────────────────────
  function perpDist([x1,y1],[x2,y2],[px,py]) {
    const dx = x2-x1, dy = y2-y1;
    if (dx===0 && dy===0) return Math.hypot(px-x1,py-y1);
    const t = ((px-x1)*dx + (py-y1)*dy) / (dx*dx+dy*dy);
    return Math.hypot(px-(x1+t*dx), py-(y1+t*dy));
  }
  function rdp(pts, eps) {
    if (pts.length <= 2) return pts;
    let maxD = 0, maxI = 0;
    for (let i=1;i<pts.length-1;i++) {
      const d = perpDist(pts[0],pts[pts.length-1],pts[i]);
      if (d>maxD) { maxD=d; maxI=i; }
    }
    if (maxD>eps) {
      const l = rdp(pts.slice(0,maxI+1),eps);
      const r = rdp(pts.slice(maxI),eps);
      return [...l.slice(0,-1),...r];
    }
    return [pts[0],pts[pts.length-1]];
  }

  // ── Frustum cull ──────────────────────────────────────────────────────
  function inView(x, y, W, H, margin=80) {
    return x > -margin && x < W+margin && y > -margin && y < H+margin;
  }

  // ── Draw route/cable/pipeline ─────────────────────────────────────────
  // Handles both single coords[] and MultiLineString segments[].
  function drawFeature(ctx, feat, W, H) {
    // Build list of coord-segments to draw
    const segs = feat.segments && feat.segments.length ? feat.segments : [feat.coords];
    if (!segs || !segs.length) return;

    const type   = feat.type;
    const status = (feat.status || 'operational').toLowerCase();
    // TeleGeography supplies per-cable hex colors; fall back to type color
    const baseColor = feat.color || COLORS[type] || COLORS[feat.substance] || '#888';
    const alpha  = COLORS[status] != null ? COLORS[status] : 1.0;
    const width  = (ROUTE_WIDTH[type] || 2) * Math.max(0.4, Math.min(2, vp.zoom / 2));
    const eps    = Math.max(0.3, 2.5 / Math.pow(2, vp.zoom));

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = baseColor;
    ctx.lineWidth   = width;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';

    if (DASH[status]) {
      ctx.setLineDash(DASH[status]);
      ctx.lineDashOffset = -vp.flowOffset;
    } else {
      ctx.setLineDash([]);
      if (type === 'oil' || type === 'gas') ctx.lineDashOffset = -vp.flowOffset;
    }

    if (type === 'trade_route') { ctx.shadowColor = baseColor; ctx.shadowBlur = 6; }

    let drewAny = false;
    for (const coords of segs) {
      if (!coords || coords.length < 2) continue;
      const pts2d     = coords.map(([lon, lat]) => toScreen(lon, lat, W, H));
      const simplified = rdp(pts2d, eps);
      if (simplified.length < 2) continue;
      if (!simplified.some(([x, y]) => inView(x, y, W, H))) continue;

      ctx.beginPath();
      let penDown = false;
      for (const [x, y] of simplified) {
        if (!penDown) { ctx.moveTo(x, y); penDown = true; } else ctx.lineTo(x, y);
      }
      ctx.stroke();
      drewAny = true;
    }
    ctx.restore();
    return drewAny;
  }

  // ── Draw all infrastructure ───────────────────────────────────────────
  function drawInfra(W, H) {
    const ctx = ctxs.infra;
    if (!ctx || !infraData) return;
    ctx.clearRect(0, 0, W, H);
    const all = [
      ...(infraData.routes || []),
      ...(infraData.cables || []),
      ...(infraData.pipelines || []),
    ];
    for (const f of all) drawFeature(ctx, f, W, H);
  }

  // ── Tile-based base map ───────────────────────────────────────────────
  const tileCache = new Map();
  function loadTile(z, x, y) {
    const key = `${z}/${x}/${y}`;
    if (tileCache.has(key)) return tileCache.get(key);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = TILE_URL.replace('{z}',z).replace('{x}',x).replace('{y}',y);
    img.onload = () => requestRender();
    tileCache.set(key, img);
    if (tileCache.size > 512) { const first = tileCache.keys().next().value; tileCache.delete(first); }
    return img;
  }
  function drawTiles(W, H) {
    const ctx = ctxs.base;
    if (!ctx) return;
    ctx.clearRect(0,0,W,H);
    ctx.fillStyle = '#0a0e14';
    ctx.fillRect(0,0,W,H);
    const z = Math.max(0, Math.min(10, Math.round(vp.zoom)));
    const tileSize = 256;
    const scale = 256 * Math.pow(2, vp.zoom);
    const numTiles = Math.pow(2, z);
    const tileWorld = scale / numTiles;
    const ox = W/2 - vp.cx;
    const oy = H/2 - vp.cy;
    const startX = Math.floor(-ox / tileWorld);
    const startY = Math.floor(-oy / tileWorld);
    const endX = Math.ceil((W-ox) / tileWorld);
    const endY = Math.ceil((H-oy) / tileWorld);
    for (let tx=startX; tx<=endX; tx++) {
      for (let ty=startY; ty<=endY; ty++) {
        const wtx = ((tx % numTiles) + numTiles) % numTiles;
        const wty = ((ty % numTiles) + numTiles) % numTiles;
        if (wty >= numTiles) continue;
        const img = loadTile(z, wtx, wty);
        const px = Math.round(tx * tileWorld + ox);
        const py = Math.round(ty * tileWorld + oy);
        const sz = Math.ceil(tileWorld) + 1;
        if (img.complete && img.naturalWidth) ctx.drawImage(img, px, py, sz, sz);
      }
    }
  }

  // ── HUD panel ─────────────────────────────────────────────────────────
  function showHUD(feat, sx, sy, W, H) {
    hudFeature = feat; hudX = sx; hudY = sy;
    const ctx = ctxs.dynamic;
    if (!ctx) return;
    ctx.clearRect(0,0,W,H);

    const pct = feat.capacity_kbd || feat.capacity_tbps || feat.capacity_bcmd || feat.throughput_ships_day;
    const pctLabel = feat.capacity_kbd ? `${feat.capacity_kbd.toLocaleString()} kbd`
      : feat.capacity_tbps ? `${feat.capacity_tbps} Tbps`
      : feat.capacity_bcmd ? `${feat.capacity_bcmd} bcm/d`
      : feat.throughput_ships_day ? `${feat.throughput_ships_day} ships/day` : null;

    // What-If shock: assume 100% disruption
    const disruption = 1.0;
    const priceShockPct = -(1 / 0.1) * disruption * 100;
    // Direct loss (rough estimate for display — server has live prices)
    const dailyLossEst = feat.capacity_kbd ? feat.capacity_kbd * 1000 * 75 : null;

    const lines = [
      feat.name,
      `Type: ${(feat.type||'').replace('_',' ').toUpperCase()}  ·  Status: ${(feat.status||'operational').toUpperCase()}`,
      pctLabel ? `Capacity: ${pctLabel}` : null,
      feat.operator ? `Operator: ${feat.operator}` : null,
      '',
      feat.beneficiaries?.length ? `Beneficiaries: ${feat.beneficiaries.join(', ')}` : null,
      feat.risks?.length ? `Key Risk: ${feat.risks[0]}` : null,
      '',
      '── WHAT-IF: FULL DISRUPTION ──',
      `Price shock: ${priceShockPct.toFixed(0)}% (inelastic model)`,
      dailyLossEst ? `Est. daily loss: $${(dailyLossEst/1e6).toFixed(0)}M (at $75/bbl)` : null,
    ].filter(l => l !== null);

    const padding = 14, lineH = 17, titleH = 22;
    const w = 320, h = padding*2 + titleH + (lines.length-1)*lineH;
    let hx = sx + 16, hy = sy - 10;
    if (hx + w > W - 10) hx = sx - w - 16;
    if (hy + h > H - 10) hy = H - h - 10;
    if (hy < 10) hy = 10;

    // Box
    ctx.fillStyle = 'rgba(10,14,20,0.92)';
    ctx.strokeStyle = COLORS[feat.type] || '#06b6d4';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.roundRect(hx, hy, w, h, 5); ctx.fill(); ctx.stroke();

    // Title
    ctx.fillStyle = COLORS[feat.type] || '#06b6d4';
    ctx.font = 'bold 13px monospace';
    ctx.fillText(lines[0], hx+padding, hy+padding+13);

    // Body
    ctx.font = '11px monospace';
    lines.slice(1).forEach((l,i) => {
      if (!l) return;
      if (l.startsWith('──')) {
        ctx.fillStyle = '#ffd23f';
        ctx.font = 'bold 10px monospace';
      } else if (l.startsWith('Price shock') || l.startsWith('Est.')) {
        ctx.fillStyle = '#ff453a';
        ctx.font = '11px monospace';
      } else if (l.startsWith('Beneficiaries')) {
        ctx.fillStyle = '#2bd97c';
        ctx.font = '11px monospace';
      } else if (l.startsWith('Key Risk')) {
        ctx.fillStyle = '#ffa040';
        ctx.font = '11px monospace';
      } else {
        ctx.fillStyle = '#b0b8c8';
        ctx.font = '11px monospace';
      }
      ctx.fillText(l, hx+padding, hy+titleH+padding + i*lineH);
    });
  }

  // ── Raycasting click detection ────────────────────────────────────────
  function ptSegDist([ax,ay],[bx,by],[px,py]) {
    const dx=bx-ax,dy=by-ay,len2=dx*dx+dy*dy;
    if (len2===0) return Math.hypot(px-ax,py-ay);
    const t=Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/len2));
    return Math.hypot(px-(ax+t*dx), py-(ay+t*dy));
  }
  function hitTest(sx, sy, W, H) {
    if (!infraData) return null;
    const threshold = 10;
    const all = [
      ...(infraData.routes    || []),
      ...(infraData.cables    || []),
      ...(infraData.pipelines || []),
    ];
    let best = null, bestD = threshold;
    for (const f of all) {
      // Support both MultiLineString segments[] and legacy coords[]
      const segs = (f.segments && f.segments.length) ? f.segments : [f.coords];
      for (const seg of segs) {
        if (!seg || seg.length < 2) continue;
        const pts = seg.map(([lon, lat]) => toScreen(lon, lat, W, H));
        for (let i = 0; i < pts.length - 1; i++) {
          const d = ptSegDist(pts[i], pts[i + 1], [sx, sy]);
          if (d < bestD) { bestD = d; best = f; }
        }
      }
    }
    return best;
  }

  // ── Render loop ───────────────────────────────────────────────────────
  let renderPending = false;
  function requestRender() {
    if (renderPending) return;
    renderPending = true;
    requestAnimationFrame(render);
  }
  function render() {
    renderPending = false;
    const el = canvases.base;
    if (!el || !el.isConnected) return;
    const W = el.width, H = el.height;
    drawTiles(W, H);
    drawInfra(W, H);
    if (!hudFeature) { ctxs.dynamic?.clearRect(0,0,W,H); }
  }

  // ── Flow animation ────────────────────────────────────────────────────
  let flowRaf = null;
  function startFlow() {
    if (flowRaf) return;
    function tick() {
      vp.flowOffset = (vp.flowOffset + 0.4) % 40;
      if (infraData && canvases.infra?.isConnected) {
        const W = canvases.infra.width, H = canvases.infra.height;
        drawInfra(W, H);
      }
      flowRaf = requestAnimationFrame(tick);
    }
    flowRaf = requestAnimationFrame(tick);
  }
  function stopFlow() {
    if (flowRaf) { cancelAnimationFrame(flowRaf); flowRaf = null; }
  }

  // ── Canvas setup ──────────────────────────────────────────────────────
  function createLayeredCanvas(container) {
    const layers = ['base','infra','dynamic'];
    layers.forEach(name => {
      const c = document.createElement('canvas');
      c.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:' + (name==='dynamic'?'auto':'none');
      c.style.zIndex = name==='base'?0:name==='infra'?1:2;
      container.appendChild(c);
      canvases[name] = c;
      ctxs[name] = c.getContext('2d');
    });
    // Only dynamic layer gets pointer events
    return canvases.dynamic;
  }

  function resizeCanvases(W, H) {
    Object.values(canvases).forEach(c => { c.width=W; c.height=H; });
    requestRender();
  }

  // ── Map initialization ────────────────────────────────────────────────
  function initWorldMap(container) {
    mapRoot = container;
    container.style.cssText = 'position:relative;width:100%;height:100%;overflow:hidden;background:#0a0e14;min-height:400px;cursor:grab;border-radius:4px;';

    createLayeredCanvas(container);

    // Initial viewport: center on 0,30 (prime meridian, N. Africa)
    const W = container.offsetWidth || 800;
    const H = container.offsetHeight || 500;
    const scale = 256 * Math.pow(2, vp.zoom);
    const [cx,cy] = project(10, 25, scale);
    vp.cx = cx; vp.cy = cy;
    resizeCanvases(W, H);

    // Load infrastructure data — show live count badge once loaded
    const statusBadge = document.createElement('div');
    statusBadge.style.cssText = 'position:absolute;top:10px;left:10px;z-index:10;background:rgba(10,14,20,0.85);border:1px solid #2a3340;color:#b0b8c8;font-family:monospace;font-size:10px;padding:4px 8px;border-radius:3px;pointer-events:none;';
    statusBadge.textContent = 'Loading cable data…';
    container.appendChild(statusBadge);

    fetch('/api/map/infrastructure')
      .then(r => r.json())
      .then(d => {
        infraData = d;
        const src    = d.cable_source === 'telegeography' ? '📡 TeleGeography' : '📋 Curated';
        const cCount = d.cable_count    || (d.cables    || []).length;
        const pCount = d.pipeline_count || (d.pipelines || []).length;
        const rCount = d.route_count    || (d.routes    || []).length;
        statusBadge.textContent = `${src} · ${cCount} cables · ${pCount} pipelines · ${rCount} routes`;
        requestRender();
        startFlow();
      })
      .catch(() => { statusBadge.textContent = 'Offline — cached data'; });

    // Pointer events
    const dynC = canvases.dynamic;
    dynC.addEventListener('mousedown', e => {
      vp.dragging = true;
      vp.dragStart = [e.clientX, e.clientY];
      vp.vpStart = [vp.cx, vp.cy];
      dynC.style.cursor = 'grabbing';
    });
    dynC.addEventListener('mousemove', e => {
      if (vp.dragging) {
        vp.cx = vp.vpStart[0] - (e.clientX - vp.dragStart[0]);
        vp.cy = vp.vpStart[1] - (e.clientY - vp.dragStart[1]);
        requestRender();
        return;
      }
      const rect = dynC.getBoundingClientRect();
      const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
      const W = dynC.width, H = dynC.height;
      const hit = hitTest(sx, sy, W, H);
      if (hit) {
        dynC.style.cursor = 'pointer';
        showHUD(hit, sx, sy, W, H);
      } else {
        dynC.style.cursor = vp.dragging ? 'grabbing' : 'grab';
        hudFeature = null;
        ctxs.dynamic?.clearRect(0,0,W,H);
      }
    });
    dynC.addEventListener('mouseup', () => { vp.dragging = false; dynC.style.cursor = 'grab'; });
    dynC.addEventListener('mouseleave', () => {
      vp.dragging = false;
      hudFeature = null;
      ctxs.dynamic?.clearRect(0,0,dynC.width,dynC.height);
    });
    dynC.addEventListener('wheel', e => {
      e.preventDefault();
      const rect = dynC.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const W = dynC.width, H = dynC.height;
      const [glon, glat] = screenToGeo(mx, my, W, H);
      const delta = e.deltaY > 0 ? -0.25 : 0.25;
      vp.zoom = Math.max(0.5, Math.min(8, vp.zoom + delta));
      // Zoom toward cursor
      const scale = 256 * Math.pow(2, vp.zoom);
      const [nx, ny] = project(glon, glat, scale);
      vp.cx = nx - (mx - W/2);
      vp.cy = ny - (my - H/2);
      requestRender();
    }, { passive: false });

    // Touch support
    let lastTouchDist = null;
    dynC.addEventListener('touchstart', e => {
      if (e.touches.length === 1) {
        vp.dragging = true;
        vp.dragStart = [e.touches[0].clientX, e.touches[0].clientY];
        vp.vpStart = [vp.cx, vp.cy];
      } else if (e.touches.length === 2) {
        vp.dragging = false;
        lastTouchDist = Math.hypot(e.touches[0].clientX-e.touches[1].clientX, e.touches[0].clientY-e.touches[1].clientY);
      }
    }, { passive: true });
    dynC.addEventListener('touchmove', e => {
      e.preventDefault();
      if (e.touches.length === 1 && vp.dragging) {
        vp.cx = vp.vpStart[0] - (e.touches[0].clientX - vp.dragStart[0]);
        vp.cy = vp.vpStart[1] - (e.touches[1-1]?.clientY - vp.dragStart[1]) || vp.cy; // eslint
        vp.cx = vp.vpStart[0] - (e.touches[0].clientX - vp.dragStart[0]);
        vp.cy = vp.vpStart[0] !== undefined ? vp.vpStart[1] - (e.touches[0].clientY - vp.dragStart[1]) : vp.cy;
        requestRender();
      } else if (e.touches.length === 2 && lastTouchDist != null) {
        const d = Math.hypot(e.touches[0].clientX-e.touches[1].clientX, e.touches[0].clientY-e.touches[1].clientY);
        const scale = d / lastTouchDist;
        vp.zoom = Math.max(0.5, Math.min(8, vp.zoom + (scale > 1 ? 0.15 : -0.15)));
        lastTouchDist = d;
        requestRender();
      }
    }, { passive: false });
    dynC.addEventListener('touchend', () => { vp.dragging = false; lastTouchDist = null; });

    // Resize observer
    const ro = new ResizeObserver(() => {
      const w = container.offsetWidth, h = container.offsetHeight;
      if (w > 0 && h > 0) resizeCanvases(w, h);
    });
    ro.observe(container);

    // Zoom controls
    const zoomWrap = document.createElement('div');
    zoomWrap.style.cssText = 'position:absolute;top:10px;right:10px;z-index:10;display:flex;flex-direction:column;gap:4px;';
    [['＋', 0.5], ['－', -0.5]].forEach(([label, delta]) => {
      const btn = document.createElement('button');
      btn.textContent = label;
      btn.style.cssText = 'width:28px;height:28px;background:rgba(10,14,20,0.85);border:1px solid #2a3340;color:#b0b8c8;font-size:16px;cursor:pointer;border-radius:3px;font-family:monospace;';
      btn.addEventListener('click', () => {
        vp.zoom = Math.max(0.5, Math.min(8, vp.zoom + delta));
        requestRender();
      });
      zoomWrap.appendChild(btn);
    });
    container.appendChild(zoomWrap);

    // Legend
    const legend = document.createElement('div');
    legend.style.cssText = 'position:absolute;bottom:10px;left:10px;z-index:10;background:rgba(10,14,20,0.85);border:1px solid #2a3340;padding:8px 12px;font-size:10px;font-family:monospace;color:#b0b8c8;border-radius:3px;line-height:1.8;';
    legend.innerHTML = [
      `<span style="color:#e87722">━━</span> Oil Pipeline`,
      `<span style="color:#ffd23f">━━</span> Gas Pipeline`,
      `<span style="color:#4ecdc4">━━</span> Water Pipeline`,
      `<span style="color:#a78bfa">━━</span> Undersea Cable`,
      `<span style="color:#06b6d4">━━</span> Trade / Shipping Route`,
      `<span style="color:#555">╌╌</span> Planned / Damaged`,
    ].join('<br>');
    container.appendChild(legend);
  }

  // ── Tab integration ───────────────────────────────────────────────────
  // Wait for the Global Intel map subtab to be activated, then inject the canvas
  let mapInitialized = false;
  function tryInitMap() {
    if (mapInitialized) return;
    const container = document.getElementById('worldMapContainer');
    if (!container) return;
    mapInitialized = true;
    initWorldMap(container);
  }

  // Hook into the subtab click system (intel.js fires click on the nav buttons)
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-sub]');
    if (btn && btn.dataset.sub === 'map') {
      setTimeout(tryInitMap, 100);
    }
  });

  // Also try on DOMContentLoaded in case map tab is already open
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tryInitMap);
  } else {
    setTimeout(tryInitMap, 200);
  }

  // Expose for external callers
  window.WorldMap = { init: tryInitMap, refresh: () => { infraData = null; if (mapInitialized) fetch('/api/map/infrastructure').then(r=>r.json()).then(d=>{infraData=d;requestRender();}).catch(()=>{}); } };
})();
