(function () {
  'use strict';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeUrl = value => { try { const u = new URL(String(value || '')); return /^https?:$/.test(u.protocol) ? u.toString() : ''; } catch { return ''; } };
  const status = document.getElementById('launchpadStatus');
  const list = document.getElementById('launchpadList');
  const detail = document.getElementById('launchpadDetail');
  let payload = null;
  let selectedId = null;
  let loading = false;
  function market() { return window.Market && Market.id ? Market.id : (localStorage.getItem('mt:market') || 'US'); }
  function money(value, currency) {
    return Number.isFinite(value) ? new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value) : 'Not reported';
  }
  function date(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s || '') ? esc(s) : 'Date unconfirmed'; }
  function render() {
    if (!payload) return;
    if (payload.unavailable) { status.textContent = payload.reason || 'IPO calendar unavailable.'; list.innerHTML = ''; detail.innerHTML = ''; return; }
    const events = payload.events || [];
    status.textContent = `${events.length} calendar events · ${payload.market} · ${payload.truth === 'CACHED' ? 'cached snapshot' : 'source snapshot'} · ${payload.from} to ${payload.to}`;
    if (!events.length) { list.innerHTML = '<div class="status empty">No IPO events returned for this window.</div>'; detail.innerHTML = ''; return; }
    if (!events.some(e => e.id === selectedId)) selectedId = payload.selectedId || events[0].id;
    list.innerHTML = events.map(e => `<button type="button" class="launchpad-event${e.id === selectedId ? ' active' : ''}" data-ipo-id="${esc(e.id)}" aria-pressed="${e.id === selectedId}">
      <span class="launchpad-event-date num">${date(e.date)}</span><span class="launchpad-event-name">${esc(e.name)}</span>
      <span class="launchpad-event-meta">${esc(e.symbol || 'Symbol pending')} · ${esc(e.exchangeLabel || 'Venue pending')} · ${esc(e.status)}</span></button>`).join('');
    const e = events.find(x => x.id === selectedId);
    const graph = payload.graph || { nodes: [], edges: [], limits: [] };
    const connections = graph.edges || [];
    detail.innerHTML = `<div class="launchpad-detail-head"><span class="eyebrow">IPO intelligence</span><h3>${esc(e.name)}</h3><span class="num">${esc(e.symbol || 'Symbol pending')} · ${date(e.date)} · ${esc(e.status)}</span></div>
      <div class="launchpad-facts"><div><small>Venue</small><strong>${esc(e.exchangeLabel || 'Not reported')}</strong></div><div><small>Price range</small><strong class="num">${esc(e.priceRange || 'Not reported')}</strong></div><div><small>Shares offered</small><strong class="num">${e.numberOfShares == null ? 'Not reported' : e.numberOfShares.toLocaleString()}</strong></div><div><small>Reported deal value</small><strong class="num">${money(e.totalSharesValue, e.currency)}</strong></div></div>
      <a href="${esc(e.source.url)}" target="_blank" rel="noopener noreferrer" class="launchpad-source">Finnhub IPO Calendar · retrieved ${esc(e.source.retrievedAt)}</a>
      <h4 class="section-label">Market impact graph</h4><div class="launchpad-graph">
      <div class="launchpad-root">${esc(e.symbol || e.name)}<small>Selected offering</small></div>
      ${connections.length ? connections.map(edge => { const id = edge.targetId === e.id ? edge.sourceId : edge.targetId; const node = graph.nodes.find(n => n.id === id); const source = safeUrl(edge.evidence && (edge.evidence.sourceUrl || edge.evidence.url)); return `<div class="launchpad-connection"><span class="launchpad-connector">${esc(edge.label)}</span><span class="launchpad-node">${esc(node ? node.label : id)}</span>${source ? `<a href="${esc(source)}" target="_blank" rel="noopener noreferrer">Evidence</a>` : ''}</div>`; }).join('') : '<p class="status empty">No verified connections or same-venue calendar overlaps in this window.</p>'}</div>
      <div class="launchpad-limits">${(graph.limits || []).map(x => `<p>${esc(x)}</p>`).join('')}</div>`;
  }
  async function load(id) {
    if (loading) return;
    loading = true;
    status.textContent = 'Loading IPO calendar…';
    try {
      const url = '/api/launchpad/ipos?market=' + encodeURIComponent(market()) + (id ? '&id=' + encodeURIComponent(id) : '');
      const response = await fetch(url);
      if (!response.ok) throw new Error('Calendar service unavailable (' + response.status + ')');
      payload = await response.json();
      if (id) selectedId = id;
      render();
    } catch (err) { status.textContent = err.message; }
    finally { loading = false; }
  }
  list.addEventListener('click', e => { const button = e.target.closest('[data-ipo-id]'); if (button) load(button.dataset.ipoId); });
  document.addEventListener('tabshown', e => { if (e.detail && e.detail.view === 'launchpad') load(selectedId); });
  document.addEventListener('mt:launchpad-refresh', () => load(selectedId));
  document.addEventListener('mt:market', () => { selectedId = null; if (document.getElementById('view-launchpad').classList.contains('active')) load(); });
})();
