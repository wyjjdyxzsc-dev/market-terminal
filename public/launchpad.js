(function () {
  'use strict';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeUrl = value => { try { const u = new URL(String(value || '')); return /^https?:$/.test(u.protocol) ? u.toString() : ''; } catch { return ''; } };
  const status = document.getElementById('launchpadStatus');
  const list = document.getElementById('launchpadList');
  const detail = document.getElementById('launchpadDetail');
  const marketSelect = document.getElementById('launchpadMarket');
  const search = document.getElementById('launchpadSearch');
  let payload = null;
  let selectedId = null;
  let requestId = 0;
  function market() { return marketSelect.value; }
  function money(value, currency) {
    return Number.isFinite(value) ? new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value) : 'Not reported';
  }
  function date(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s || '') ? esc(s) : 'Date unconfirmed'; }
  function known(v) { return v == null || v === '' ? 'UNKNOWN' : esc(v); }
  function inr(v) { if (!Number.isFinite(v)) return 'UNKNOWN'; if (v >= 1e7) return '₹' + (v / 1e7).toLocaleString('en-IN', { maximumFractionDigits: 2 }) + ' crore'; if (v >= 1e5) return '₹' + (v / 1e5).toLocaleString('en-IN', { maximumFractionDigits: 2 }) + ' lakh'; return money(v, 'INR'); }
  function indiaDetail(e, graph) {
    const offer = e.offer || {};
    const expected = e.expectedListingDate && e.expectedListingDate < new Date().toISOString().slice(0, 10) ? e.expectedListingDate + ' · past expectation, unconfirmed' : e.expectedListingDate;
    const fields = [['Status', e.status], ['Expected listing', expected], ['Confirmed listing', e.confirmedListingDate], ['Sector', e.sector], ['Industry', e.industry], ['Exchange', e.exchangeLabel], ['Updated', e.updatedAt], ['Last verified', e.lastVerified]];
    const offerFields = [['Issue size', inr(offer.issueSize)], ['Fresh issue', inr(offer.freshIssue)], ['Offer for sale', inr(offer.offerForSale)], ['Composition', known(offer.composition)], ['Shares offered', offer.sharesOffered == null ? 'UNKNOWN' : Number(offer.sharesOffered).toLocaleString('en-IN')], ['Price band', known(offer.priceBand)], ['Final price', inr(offer.finalPrice)], ['Valuation', inr(offer.valuation)], ['Minimum lot', known(offer.minimumLot)], ['Use of proceeds', known(offer.useOfProceeds)], ['BRLMs', offer.brlms?.length ? esc(offer.brlms.join(', ')) : 'UNKNOWN']];
    const grid = rows => '<div class="launchpad-facts">' + rows.map(([k, v]) => '<div><small>' + esc(k) + '</small><strong>' + (v == null ? 'UNKNOWN' : esc(v)) + '</strong></div>').join('') + '</div>';
    const timeline = (e.timeline || []).map(t => { const url = safeUrl(t.source?.url); return '<li><strong>' + date(t.date) + ' · ' + esc(t.state) + '</strong> — ' + esc(t.rawStatus) + (url ? ' <a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">Filing</a>' : '') + '</li>'; }).join('');
    const evidence = (e.evidence || []).map(x => { const url = safeUrl(x.url); return url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(x.sourceOwner) + ' · ' + esc(x.sourceType) + ' · ' + date(x.sourceDate) + '</a>' : ''; }).join('');
    const impact = (graph.edges || []).filter(x => x.type !== 'shared_venue_window').map(x => '<p>' + esc(x.label) + ' · ' + esc(x.targetId) + '</p>').join('');
    return '<div class="launchpad-detail-head"><span class="eyebrow">India IPO · SEBI filing</span><h3>' + esc(e.name) + '</h3><span>' + esc(e.status) + ' · INR</span></div><h4 class="section-label">Overview</h4>' + grid(fields) + '<h4 class="section-label">Offer</h4>' + grid(offerFields) + '<h4 class="section-label">Timeline</h4><ol class="launchpad-timeline">' + timeline + '</ol><h4 class="section-label">Impact</h4>' + (impact || '<p class="status empty">UNKNOWN · No evidence-backed NEXUS relationship.</p>') + '<h4 class="section-label">Ratings</h4>' + grid(Object.entries(e.ratings || {}).map(([k, v]) => [k.replace(/([A-Z])/g, ' $1'), v])) + '<h4 class="section-label">Evidence</h4><div class="launchpad-evidence">' + evidence + '</div>';
  }
  function render() {
    if (!payload) return;
    if (payload.unavailable) { status.textContent = payload.reason || 'IPO calendar unavailable.'; list.innerHTML = ''; detail.innerHTML = ''; return; }
    const events = payload.events || [];
    status.textContent = payload.market === 'US'
      ? `${events.length} calendar events · US · ${payload.truth === 'CACHED' ? 'cached snapshot' : 'source snapshot'} · ${payload.from} to ${payload.to}`
      : `${events.length} IPO ${events.length === 1 ? 'record' : 'records'} · ${payload.market} · source snapshot · verified ${payload.lastVerified || 'UNKNOWN'}`;
    if (!events.length) { list.innerHTML = '<div class="status empty">No IPO events returned for this window.</div>'; detail.innerHTML = ''; return; }
    if (!events.some(e => e.id === selectedId)) selectedId = payload.selectedId || events[0].id;
    list.innerHTML = events.map(e => `<button type="button" class="launchpad-event${e.id === selectedId ? ' active' : ''}" data-ipo-id="${esc(e.id)}" aria-pressed="${e.id === selectedId}">
      <span class="launchpad-event-date num">${e.market === 'IN' ? 'Filing · ' : ''}${date(e.date)}</span><span class="launchpad-event-name">${esc(e.name)}</span>
      <span class="launchpad-event-meta">${esc(e.market)} · ${esc(e.symbol || 'Symbol pending')} · ${esc(e.exchangeLabel || 'Venue pending')} · ${esc(e.status)}</span></button>`).join('');
    const e = events.find(x => x.id === selectedId);
    const graph = payload.graph || { nodes: [], edges: [], limits: [] };
    const connections = graph.edges || [];
    if (e.market === 'IN') { detail.innerHTML = indiaDetail(e, graph); return; }
    detail.innerHTML = `<div class="launchpad-detail-head"><span class="eyebrow">IPO intelligence</span><h3>${esc(e.name)}</h3><span class="num">${esc(e.symbol || 'Symbol pending')} · ${date(e.date)} · ${esc(e.status)}</span></div>
      <div class="launchpad-facts"><div><small>Venue</small><strong>${esc(e.exchangeLabel || 'Not reported')}</strong></div><div><small>Price range</small><strong class="num">${esc(e.priceRange || 'Not reported')}</strong></div><div><small>Shares offered</small><strong class="num">${e.numberOfShares == null ? 'Not reported' : e.numberOfShares.toLocaleString()}</strong></div><div><small>Reported deal value</small><strong class="num">${money(e.totalSharesValue, e.currency)}</strong></div></div>
      <a href="${esc(e.source.url)}" target="_blank" rel="noopener noreferrer" class="launchpad-source">Finnhub IPO Calendar · retrieved ${esc(e.source.retrievedAt)}</a>
      <h4 class="section-label">Market impact graph</h4><div class="launchpad-graph">
      <div class="launchpad-root">${esc(e.symbol || e.name)}<small>Selected offering</small></div>
      ${connections.length ? connections.map(edge => { const id = edge.targetId === e.id ? edge.sourceId : edge.targetId; const node = graph.nodes.find(n => n.id === id); const source = safeUrl(edge.evidence && (edge.evidence.sourceUrl || edge.evidence.url)); return `<div class="launchpad-connection"><span class="launchpad-connector">${esc(edge.label)}</span><span class="launchpad-node">${esc(node ? node.label : id)}</span>${source ? `<a href="${esc(source)}" target="_blank" rel="noopener noreferrer">Evidence</a>` : ''}</div>`; }).join('') : '<p class="status empty">No verified connections or same-venue calendar overlaps in this window.</p>'}</div>
      <div class="launchpad-limits">${(graph.limits || []).map(x => `<p>${esc(x)}</p>`).join('')}</div>`;
  }
  async function load(id) {
    const currentRequest = ++requestId;
    status.textContent = 'Loading IPO calendar…';
    try {
      const url = '/api/launchpad/ipos?market=' + encodeURIComponent(market()) + (id ? '&id=' + encodeURIComponent(id) : '') + (search.value.trim() ? '&q=' + encodeURIComponent(search.value.trim()) : '');
      const response = await fetch(url);
      if (!response.ok) throw new Error('Calendar service unavailable (' + response.status + ')');
      const nextPayload = await response.json();
      if (currentRequest !== requestId) return;
      payload = nextPayload;
      if (id) selectedId = id;
      render();
    } catch (err) { if (currentRequest === requestId) status.textContent = err.message; }
  }
  list.addEventListener('click', e => { const button = e.target.closest('[data-ipo-id]'); if (button) load(button.dataset.ipoId); });
  document.addEventListener('tabshown', e => { if (e.detail && e.detail.view === 'launchpad') load(selectedId); });
  document.addEventListener('mt:launchpad-refresh', () => load(selectedId));
  marketSelect.value = window.Market && Market.id === 'IN' ? 'IN' : 'US';
  marketSelect.addEventListener('change', () => { selectedId = null; load(); });
  search.addEventListener('input', () => { clearTimeout(search._timer); search._timer = setTimeout(() => { selectedId = null; load(); }, 250); });
  document.addEventListener('mt:market', () => { marketSelect.value = window.Market && Market.id === 'IN' ? 'IN' : 'US'; selectedId = null; if (document.getElementById('view-launchpad').classList.contains('active')) load(); });
})();
