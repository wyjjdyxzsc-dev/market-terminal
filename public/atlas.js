'use strict';

/* ════════════════════════════════════════════════════════════════
   Market Terminal — ATLAS (MT2-4) geographic market-intelligence layers
   Sits on the Leaflet map (`mapready` from ships.js). Every drawn object comes
   from /api/map/entities, /api/map/geoevents (canonical, sourced GeoEntity /
   GeoEvent payloads); nothing is embedded here. Rendering is bounded: the server
   clusters below zoom 7 and caps entity responses, the client draws canvas
   circle markers and a bounded number of cluster badges. Selection opens the
   intelligence drawer (PLACE → ENTITY → COMPANY → SECURITY). Market mode changes
   emphasis and ordering only. No hover is required anywhere.
   ════════════════════════════════════════════════════════════════ */
(() => {
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const safeHttpUrl = (v) => { try { const u = new URL(String(v || ''), location.href); return /^https?:$/i.test(u.protocol) ? u.toString() : ''; } catch { return ''; } };
  const getJSON = async (url) => { const r = await fetch(url, { headers: { Accept: 'application/json' } }); const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.message || d.error || `HTTP ${r.status}`); return d; };
  const css = (name, fallback) => (getComputedStyle(document.documentElement).getPropertyValue(name) || '').trim() || fallback;

  const CATEGORY_COLOR = () => ({
    MARKETS: css('--accent', '#e8b25c'), INDUSTRY: css('--info', '#5ec1e8'), ENERGY: css('--warning', '#e8b25c'),
    MARITIME: '#7fd1c5', EVENTS: css('--negative', '#f0554e'),
  });
  const TYPE_LABEL = (t) => String(t || '').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

  let map = null, catalog = null, panelCtrl = null, drawerEl = null, searchEl = null;
  const enabled = {};      // layerId → bool
  const groups = {};       // layerId → L.layerGroup
  let canvas = null;
  const renderer = () => (canvas || (canvas = L.canvas({ padding: 0.4 })));
  let moveTimer = null, eventsTimer = null, selectedId = null, selectedMarker = null;
  let requestSeq = 0;

  const marketId = () => (window.MarketTerminal && window.MarketTerminal.getMarketContext ? window.MarketTerminal.getMarketContext().id : 'US');
  // Gate on the Global Map panel being shown (document.hidden is unreliable in embedded panes).
  const mapVisible = () => { const p = document.getElementById('gi-map'); return Boolean(p && p.classList.contains('active')); };
  const bboxParam = () => { const b = map.getBounds(); const w = Math.max(-180, b.getWest()), e = Math.min(180, b.getEast()); return `${w.toFixed(2)},${Math.max(-85, b.getSouth()).toFixed(2)},${e.toFixed(2)},${Math.min(85, b.getNorth()).toFixed(2)}`; };

  // ── panel ──
  function buildPanel() {
    const Ctrl = L.Control.extend({
      options: { position: 'topleft' },
      onAdd() {
        const div = L.DomUtil.create('div', 'atlas-panel');
        const cats = ['MARKETS', 'INDUSTRY', 'ENERGY', 'MARITIME', 'EVENTS'];
        div.innerHTML =
          `<div class="atlas-head"><span>ATLAS</span><span class="atlas-count"></span><button type="button" class="atlas-collapse" aria-label="Collapse layers">▾</button></div>` +
          `<div class="atlas-search"><input type="search" class="atlas-q" placeholder="Company, place, infrastructure" aria-label="Search the map" autocomplete="off"><ul class="atlas-results" hidden></ul></div>` +
          `<div class="atlas-body">` + cats.map((cat) => {
            const layers = catalog.layers.filter((l) => l.category === cat);
            if (!layers.length) return '';
            return `<div class="atlas-group"><div class="atlas-gname">${cat}</div>` + layers.map((l) => {
              const c = l.counts || {};
              const off = !l.renders;
              const meta = off ? 'no sourced data yet' : `${c.authoritative.toLocaleString()} sourced${c.unverified ? ` · ${c.unverified} unverified hidden` : ''}${l.freshness === 'live' ? ' · live' : ''}`;
              return `<label class="atlas-row${off ? ' is-off' : ''}" data-id="${l.id}" title="${esc(l.coverage.note)}">` +
                `<input type="checkbox" data-layer="${l.id}" ${off ? 'disabled' : ''} ${l.enabledByDefault && !off ? 'checked' : ''}>` +
                `<span class="atlas-swatch" style="--sw:${CATEGORY_COLOR()[cat]}"></span>` +
                `<span class="atlas-copy"><span class="atlas-label">${esc(l.name)}</span><span class="atlas-meta" data-base="${esc(meta)}">${esc(meta)}</span></span></label>`;
            }).join('') + `</div>`;
          }).join('') +
          `<div class="atlas-foot">Snapshot ${esc(catalog.snapshot.version)} · Wikidata CC0 · Natural Earth PD · WRI GPPD CC BY 4.0</div></div>`;
        L.DomEvent.disableClickPropagation(div);
        L.DomEvent.disableScrollPropagation(div);
        // Phones: start collapsed so the map itself is the first thing on screen.
        if (window.innerWidth < 720) { div.classList.add('collapsed'); div.querySelector('.atlas-collapse').textContent = '▸'; }
        div.querySelector('.atlas-collapse').addEventListener('click', (ev) => { ev.preventDefault(); div.classList.toggle('collapsed'); ev.target.textContent = div.classList.contains('collapsed') ? '▸' : '▾'; });
        div.querySelectorAll('input[data-layer]').forEach((cb) => {
          enabled[cb.dataset.layer] = cb.checked;
          cb.addEventListener('change', () => { enabled[cb.dataset.layer] = cb.checked; refreshLayer(cb.dataset.layer); updateCount(); });
        });
        searchEl = div.querySelector('.atlas-q');
        wireSearch(div);
        return div;
      },
    });
    panelCtrl = new Ctrl();
    panelCtrl.addTo(map);
    updateCount();
  }

  function updateCount() {
    const el = $('.atlas-count');
    if (!el) return;
    const n = Object.values(enabled).filter(Boolean).length;
    el.textContent = `${n} on · ${marketId()} emphasis`;
  }

  // ── search ──
  function wireSearch(div) {
    const list = div.querySelector('.atlas-results');
    let t = null;
    const hide = () => { list.hidden = true; list.innerHTML = ''; };
    searchEl.addEventListener('input', () => {
      clearTimeout(t);
      const q = searchEl.value.trim();
      if (q.length < 2) return hide();
      t = setTimeout(async () => {
        try {
          const d = await getJSON(`/api/map/search?q=${encodeURIComponent(q)}&market=${encodeURIComponent(marketId())}&limit=8`);
          if (searchEl.value.trim() !== q) return;
          if (!d.results.length) { list.innerHTML = '<li class="atlas-empty">No sourced match</li>'; list.hidden = false; return; }
          list.innerHTML = d.results.map((r) => `<li role="option" data-id="${esc(r.id)}" data-lat="${r.lat}" data-lon="${r.lon}"><span class="atlas-r-name">${esc(r.name)}</span><span class="atlas-r-sub">${esc(TYPE_LABEL(r.type))}${r.subtitle ? ' · ' + esc(r.subtitle) : ''}</span></li>`).join('');
          list.hidden = false;
          list.querySelectorAll('li[data-id]').forEach((li) => li.addEventListener('click', (ev) => {
            // Stop before Leaflet sees it: emptying the list mid-bubble detaches the <li>, which
            // would make the map treat this as a map click and close the drawer we just opened.
            L.DomEvent.stop(ev);
            const { id, lat, lon } = li.dataset;
            searchEl.value = '';
            setTimeout(hide, 0);
            map.flyTo([Number(lat), Number(lon)], Math.max(map.getZoom(), 8), { duration: 0.6 });
            openEntity(id);
          }));
        } catch { hide(); }
      }, 220);
    });
    searchEl.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
  }

  // ── drawing ──
  function layerColor(layerId) {
    const def = catalog.layers.find((l) => l.id === layerId);
    return CATEGORY_COLOR()[def ? def.category : 'INDUSTRY'];
  }

  function entityMarker(e, color) {
    const primary = e.relevance === 'primary';
    const m = L.circleMarker([e.lat, e.lon], {
      renderer: renderer(), radius: primary ? 5.5 : 4, weight: primary ? 1.6 : 1, color,
      fillColor: color, fillOpacity: primary ? 0.9 : 0.5, opacity: primary ? 1 : 0.7, bubblingMouseEvents: false,
    });
    m.on('click', () => openEntity(e.id, m));
    m.bindTooltip(e.name, { direction: 'top', offset: [0, -6], opacity: 0.95, className: 'atlas-tip' });
    return m;
  }

  function clusterMarker(c, layerId, color) {
    const size = c.count >= 500 ? 40 : c.count >= 50 ? 34 : 28;
    const icon = L.divIcon({ className: 'atlas-cluster', html: `<span style="--sw:${color};width:${size}px;height:${size}px">${c.count >= 1000 ? (c.count / 1000).toFixed(1) + 'k' : c.count}</span>`, iconSize: [size, size] });
    const m = L.marker([c.lat, c.lon], { icon, keyboard: false });
    m.on('click', () => map.flyTo([c.lat, c.lon], Math.min(map.getZoom() + 2, 12), { duration: 0.5 }));
    return m;
  }

  async function refreshLayer(layerId) {
    const def = catalog.layers.find((l) => l.id === layerId);
    if (!def || !map) return;
    if (!groups[layerId]) groups[layerId] = L.layerGroup();
    const lg = groups[layerId];
    if (!enabled[layerId]) { map.removeLayer(lg); lg.clearLayers(); return; }
    if (!map.hasLayer(lg)) lg.addTo(map);
    if (!def.renders) return;
    if (layerId === 'events') return refreshEvents();
    const seq = ++requestSeq;
    const zoom = Math.round(map.getZoom());
    try {
      const d = await getJSON(`/api/map/entities?layer=${encodeURIComponent(layerId)}&market=${encodeURIComponent(marketId())}&bbox=${bboxParam()}&zoom=${zoom}`);
      if (seq !== requestSeq && !enabled[layerId]) return;
      lg.clearLayers();
      const color = layerColor(layerId);
      if (d.mode === 'clusters') {
        for (const c of d.clusters) (c.count === 1 && c.entity ? entityMarker(c.entity, color) : clusterMarker(c, layerId, color)).addTo(lg);
      } else {
        for (const e of d.entities) entityMarker(e, color).addTo(lg);
      }
      setLayerNote(layerId, d.mode === 'clusters' ? `${d.total.toLocaleString()} in view · ${d.clusters.length} clusters` : d.truncated ? `${d.total.toLocaleString()} in view · showing ${d.entities.length}` : `${d.total.toLocaleString()} in view`);
    } catch (err) {
      setLayerNote(layerId, `unavailable — ${err.message}`);
    }
  }

  function setLayerNote(layerId, text) {
    const row = document.querySelector(`.atlas-row[data-id="${layerId}"] .atlas-meta`);
    if (!row) return;
    row.textContent = text || row.dataset.base || '';
  }

  const EVENT_COLOR = { EARTHQUAKE: '#f0554e', STORM: '#5ec1e8', FLOOD: '#4a90d9', WILDFIRE: '#ff8c42', VOLCANO: '#ff453a', WAR: '#ff453a', MILITARY: '#ff453a', DROUGHT: '#d8a657', INDUSTRIAL_ACCIDENT: '#ff8c00', OTHER: '#9aa0ab' };
  async function refreshEvents() {
    const lg = groups.events;
    if (!lg || !enabled.events) return;
    try {
      const d = await getJSON(`/api/map/geoevents?bbox=${bboxParam()}`);
      lg.clearLayers();
      for (const ev of d.events) {
        const color = EVENT_COLOR[ev.type] || EVENT_COLOR.OTHER;
        const active = ev.status === 'active';
        const mag = ev.attributes && ev.attributes.magnitude;
        const m = L.circleMarker([ev.location.lat, ev.location.lon], {
          renderer: renderer(), radius: mag ? Math.max(4, Math.min(12, mag * 1.6)) : 5, weight: 1.4, color,
          fillColor: color, fillOpacity: active ? 0.55 : 0.08, opacity: active ? 0.95 : 0.45, dashArray: active ? null : '2 3', bubblingMouseEvents: false,
        });
        m.bindTooltip(`${esc(ev.title)}${active ? '' : ' · ' + ev.status}`, { direction: 'top', offset: [0, -6], className: 'atlas-tip' });
        m.on('click', () => openEvent(ev, m));
        m.addTo(lg);
      }
      setLayerNote('events', `${d.total} events${d.truncated ? ' (bounded)' : ''}`);
    } catch (err) { setLayerNote('events', `unavailable — ${err.message}`); }
  }

  function refreshAll() {
    if (!map || !catalog || !mapVisible()) return;
    for (const l of catalog.layers) if (enabled[l.id]) refreshLayer(l.id);
  }

  // ── drawer (PLACE → ENTITY → COMPANY → SECURITY) ──
  function ensureDrawer() {
    if (drawerEl) return drawerEl;
    const host = document.getElementById('gi-map') || document.body;
    drawerEl = document.createElement('aside');
    drawerEl.className = 'atlas-drawer';
    drawerEl.hidden = true;
    drawerEl.setAttribute('role', 'dialog');
    drawerEl.setAttribute('aria-label', 'Map intelligence');
    host.appendChild(drawerEl);
    return drawerEl;
  }
  function closeDrawer() {
    if (drawerEl) drawerEl.hidden = true;
    if (selectedMarker && selectedMarker.setStyle) selectedMarker.setStyle({ weight: selectedMarker.__w || 1.4 });
    selectedMarker = null; selectedId = null;
  }
  function highlight(marker) {
    if (selectedMarker && selectedMarker.setStyle) selectedMarker.setStyle({ weight: selectedMarker.__w || 1.4 });
    selectedMarker = marker || null;
    if (marker && marker.setStyle) { marker.__w = marker.options.weight; marker.setStyle({ weight: 3 }); }
  }
  const fmtDate = (iso) => { const d = new Date(iso || ''); return Number.isNaN(d.valueOf()) ? '—' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); };
  const evidenceHtml = (list) => (list || []).map((e) => {
    const url = safeHttpUrl(e.sourceUrl);
    return `<li><span class="fresh" data-fresh="${e.confidence === 'HIGH' ? 'live' : e.confidence === 'MEDIUM' ? 'delayed' : e.confidence === 'LOW' ? 'snapshot' : 'unavailable'}">${esc(e.confidence)}</span> ${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(e.source)}</a>` : esc(e.source)}${e.license ? ` <small>${esc(e.license)}</small>` : ''}${e.note ? `<div class="atlas-ev-note">${esc(e.note)}</div>` : ''}${e.lastVerified ? `<div class="atlas-ev-note">verified ${esc(fmtDate(e.lastVerified))}</div>` : ''}</li>`;
  }).join('');

  async function openEntity(id, marker) {
    const drawer = ensureDrawer();
    selectedId = id; highlight(marker);
    drawer.hidden = false;
    drawer.innerHTML = '<div class="atlas-d-head"><span class="spinner"></span> Loading…</div>';
    let d;
    try { d = await getJSON(`/api/map/entity?id=${encodeURIComponent(id)}`); }
    catch (err) { drawer.innerHTML = `<div class="atlas-d-head"><strong>Unavailable</strong><button type="button" class="atlas-close" aria-label="Close">×</button></div><p class="status error">${esc(err.message)}</p>`; wireClose(); return; }
    if (selectedId !== id) return;
    const e = d.entity, a = e.attributes || {};
    const securities = (d.securities || []);
    const market = marketId();
    const rows = [
      ['Type', TYPE_LABEL(e.type)],
      ['Location', `${e.lat.toFixed(4)}, ${e.lon.toFixed(4)}`],
      ['Country / region', [e.country, e.region].filter(Boolean).join(' · ') || '—'],
      a.hq ? ['Headquarters', a.hq] : null,
      a.capacityMw ? ['Capacity', `${Number(a.capacityMw).toLocaleString()} MW · ${esc(a.fuel || '')}`] : null,
      a.owner ? ['Owner (as published)', a.owner] : null,
      a.iata ? ['IATA / ICAO', `${a.iata}${a.icao ? ' / ' + a.icao : ''}`] : null,
      ['Layer', d.layer ? d.layer.name : e.layer],
      ['Evidence', `${e.confidence}${e.authoritative ? '' : ' · not authoritative'}`],
      ['Last verified', fmtDate(e.lastVerified)],
    ].filter(Boolean);
    drawer.innerHTML =
      `<div class="atlas-d-head"><div><div class="atlas-d-kicker">${esc(TYPE_LABEL(e.type))}${e.relevance === 'primary' ? ` · <span class="atlas-primary">${esc(market)} context</span>` : ''}</div><strong>${esc(e.name)}</strong></div><button type="button" class="atlas-close" aria-label="Close">×</button></div>` +
      `<dl class="atlas-d-rows">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join('')}</dl>` +
      (securities.length ? `<div class="atlas-d-sec"><div class="atlas-d-label">SECURITY</div>${securities.map((s) => {
        const [mkt, exch, sym] = s.split(':');
        return `<div class="atlas-sec-row"><span class="num">${esc(exch)}:${esc(sym)}</span><span class="atlas-sec-mkt">${esc(mkt)}</span><button type="button" class="btn-sm" data-open="${esc(s)}" data-view="terminal">Terminal</button><button type="button" class="btn-sm" data-open="${esc(s)}" data-view="deepdive">Deep Dive</button><button type="button" class="btn-sm" data-open="${esc(s)}" data-view="nexus">NEXUS</button></div>`;
      }).join('')}</div>` : (e.type === 'COMPANY_HQ' ? '<div class="atlas-d-sec"><div class="atlas-d-label">SECURITY</div><p class="atlas-ev-note">Listed on an exchange Wikidata records without a ticker symbol — no canonical security identity available.</p></div>' : '')) +
      `<div class="atlas-d-label">CURRENT EVENTS (≤250 km, active)</div>` +
      (d.nearbyEvents && d.nearbyEvents.length ? `<ul class="atlas-events">${d.nearbyEvents.map((ev) => `<li><span class="atlas-ev-type" style="--sw:${EVENT_COLOR[ev.type] || EVENT_COLOR.OTHER}">${esc(ev.type)}</span> ${esc(ev.title)} <small>${ev.distanceKm} km</small></li>`).join('')}</ul>` : d.nearbyEventsState === 'pending' ? '<p class="atlas-ev-note">Event feed still loading — reopen in a moment.</p>' : d.nearbyEventsState === 'unavailable' ? '<p class="atlas-ev-note">Event feed unavailable.</p>' : '<p class="atlas-ev-note">No active sourced event within 250 km.</p>') +
      `<div class="atlas-d-label">EVIDENCE / SOURCE</div><ul class="atlas-evidence">${evidenceHtml(e.sourceEvidence)}</ul>` +
      `<div class="atlas-d-ext">Supply chain · IPO · Portfolio · Watchlist · WORLDWIRE · ORACLE · SENTINEL — reserved for later checkpoints; nothing is inferred here.</div>`;
    wireClose();
    drawer.querySelectorAll('button[data-open]').forEach((b) => b.addEventListener('click', () => {
      if (window.MarketTerminal && window.MarketTerminal.openSecurity) window.MarketTerminal.openSecurity(b.dataset.open, b.dataset.view);
    }));
  }

  // NEXUS → ATLAS entry point (mirror of the drawer's ATLAS → NEXUS buttons).
  // Centres the map on a sourced GeoEntity, then opens its drawer. The coordinates come
  // from /api/map/entity — nothing is inferred client-side.
  async function focusEntity(id) {
    if (!map || !id) return false;
    try {
      const d = await getJSON(`/api/map/entity?id=${encodeURIComponent(id)}`);
      const e = d && d.entity;
      if (!e || !Number.isFinite(Number(e.lat)) || !Number.isFinite(Number(e.lon))) return false;
      map.flyTo([Number(e.lat), Number(e.lon)], Math.max(map.getZoom(), 8), { duration: 0.6 });
    } catch (err) {
      console.warn('[atlas] focusEntity:', err.message);
      return false;
    }
    openEntity(id);
    return true;
  }

  function openEvent(ev, marker) {
    const drawer = ensureDrawer();
    selectedId = ev.id; highlight(marker);
    drawer.hidden = false;
    drawer.innerHTML =
      `<div class="atlas-d-head"><div><div class="atlas-d-kicker">${esc(ev.type)} · <span class="fresh" data-fresh="${ev.status === 'active' ? 'live' : ev.status === 'stale' ? 'snapshot' : 'eod'}">${esc(ev.status)}</span></div><strong>${esc(ev.title)}</strong></div><button type="button" class="atlas-close" aria-label="Close">×</button></div>` +
      `<dl class="atlas-d-rows"><div><dt>Location</dt><dd>${ev.location.lat.toFixed(3)}, ${ev.location.lon.toFixed(3)}${ev.location.name ? ' · ' + esc(ev.location.name) : ''}</dd></div><div><dt>Severity</dt><dd>${esc(ev.severity)}</dd></div><div><dt>Started</dt><dd>${esc(fmtDate(ev.startedAt))}</dd></div><div><dt>Updated</dt><dd>${esc(fmtDate(ev.updatedAt))}</dd></div><div><dt>Evidence</dt><dd>${esc(ev.confidence)}</dd></div></dl>` +
      `<div class="atlas-d-label">EVIDENCE / SOURCE</div><ul class="atlas-evidence">${evidenceHtml(ev.sourceEvidence)}</ul>` +
      `<div class="atlas-d-ext">Affected entities and materiality arrive with WORLDWIRE / SENTINEL; none are inferred here.</div>`;
    wireClose();
  }
  function wireClose() { const b = drawerEl.querySelector('.atlas-close'); if (b) b.addEventListener('click', closeDrawer); }

  // ── lifecycle ──
  document.addEventListener('mapready', async (e) => {
    map = e.detail.map;
    if (!map || panelCtrl) return;
    try { catalog = await getJSON('/api/map/atlas'); }
    catch (err) { console.error('[atlas] catalog unavailable:', err.message); return; }
    buildPanel();
    ensureDrawer();
    map.on('moveend zoomend', () => { clearTimeout(moveTimer); moveTimer = setTimeout(refreshAll, 250); });
    map.on('click', closeDrawer);
    refreshAll();
    eventsTimer = setInterval(() => { if (enabled.events && mapVisible()) refreshEvents(); }, 300000);
    document.addEventListener('mt:market', () => { updateCount(); refreshAll(); });
    document.addEventListener('mt:gisub', (ev) => { if (ev.detail && ev.detail.sub === 'map') setTimeout(refreshAll, 200); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshAll(); });
    window.MarketTerminalAtlas = { refreshAll, openEntity, focusEntity, get map() { return map; }, get catalog() { return catalog; }, get enabled() { return { ...enabled }; } };
  });
})();
