'use strict';

/* ════════════════════════════════════════════════════════════════
   Market Terminal — GLOBAL MAP intelligence layers
   A toggleable layer system over the Leaflet map owned by ships.js.
   Modeled on worldmonitor's layered situational map but written from
   scratch (no AGPL code) on our own stack, fed by free public sources
   proxied through /api/map/* (USGS, NASA EONET, OpenSky, NWS) plus
   curated reference datasets and a computed day/night terminator.
   ════════════════════════════════════════════════════════════════ */
(() => {
  let map = null, panel = null;
  const groups = {};        // layerId -> L.layerGroup
  const timers = {};        // layerId -> interval
  const loadedOnce = {};    // layerId -> bool
  const active = {};        // layerId -> bool

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  async function getJSON(url) {
    const r = await fetch(url, { headers: { Accept: 'application/json' } });
    return r.json();
  }
  const drill = (t) => { try { window.dispatchEvent(new CustomEvent('mt:drill', { detail: { ticker: t } })); } catch {} };

  // ── EONET category colors ──
  const EONET_COLORS = {
    wildfires: '#ff6b35', severeStorms: '#45c8dc', volcanoes: '#ff453a', seaLakeIce: '#cfe8ff',
    floods: '#4a90d9', drought: '#d8a657', dustHaze: '#c9a227', snow: '#ffffff',
    earthquakes: '#ff453a', manmade: '#ff8c00', landslides: '#b07b4f', tempExtremes: '#ff5e5e', waterColor: '#3fd0c9',
  };
  const quakeColor = (m) => (m >= 6 ? '#ff453a' : m >= 4.5 ? '#ff8c00' : m >= 3 ? '#ffd23f' : '#9acd32');

  // ── Curated reference datasets (factual locations) ──
  const DATA = {
    exchanges: [
      ['NYSE', 40.707, -74.011, 'New York Stock Exchange'], ['NASDAQ', 40.757, -73.986, 'Nasdaq'],
      ['LSE', 51.515, -0.099, 'London Stock Exchange'], ['TSE', 35.683, 139.774, 'Tokyo Stock Exchange'],
      ['SSE', 31.234, 121.491, 'Shanghai Stock Exchange'], ['HKEX', 22.283, 114.158, 'Hong Kong Exchange'],
      ['Euronext', 48.870, 2.332, 'Euronext Paris'], ['DB', 50.115, 8.671, 'Deutsche Börse'],
      ['BSE', 18.929, 72.833, 'Bombay Stock Exchange'], ['TSX', 43.648, -79.382, 'Toronto Exchange'],
      ['ASX', -33.866, 151.207, 'Australian Securities Exchange'], ['SIX', 47.371, 8.539, 'SIX Swiss Exchange'],
      ['B3', -23.553, -46.634, 'B3 São Paulo'], ['KRX', 37.525, 126.926, 'Korea Exchange'], ['SGX', 1.283, 103.851, 'Singapore Exchange'],
    ],
    chokepoints: [
      ['Strait of Hormuz', 26.567, 56.25, '~20% of global oil passes here'], ['Suez Canal', 30.5, 32.35, 'Europe–Asia shortcut'],
      ['Strait of Malacca', 1.43, 102.89, 'Busiest cargo chokepoint'], ['Panama Canal', 9.08, -79.68, 'Atlantic–Pacific link'],
      ['Bab-el-Mandeb', 12.58, 43.33, 'Red Sea gateway'], ['Bosphorus', 41.12, 29.07, 'Black Sea outlet'],
      ['Strait of Gibraltar', 35.95, -5.6, 'Mediterranean entrance'], ['Danish Straits', 55.7, 12.7, 'Baltic outlet'],
      ['Cape of Good Hope', -34.36, 18.47, 'Tanker reroute around Africa'], ['Taiwan Strait', 24.5, 119.5, 'Critical Asia shipping lane'],
    ],
    nuclear: [
      ['Natanz', 33.72, 51.73, 'Iran enrichment site'], ['Fordow', 34.88, 50.99, 'Iran enrichment (underground)'],
      ['Yongbyon', 39.8, 125.75, 'North Korea reactor'], ['Dimona', 31.0, 35.14, 'Israel (Negev)'],
      ['Zaporizhzhia', 47.51, 34.59, 'Largest NPP in Europe (Ukraine)'], ['Bushehr', 28.83, 50.89, 'Iran power reactor'],
      ['Chernobyl', 51.39, 30.10, 'Exclusion zone'], ['Fukushima Daiichi', 37.42, 141.03, 'Japan (decommissioning)'],
    ],
    spaceports: [
      ['Cape Canaveral', 28.49, -80.58, 'USA — SpaceX/ULA/NASA'], ['Starbase', 25.99, -97.16, 'SpaceX Boca Chica'],
      ['Baikonur', 45.92, 63.34, 'Kazakhstan (Roscosmos)'], ['Kourou', 5.24, -52.77, 'ESA Guiana Space Centre'],
      ['Vandenberg', 34.74, -120.57, 'USA — polar launches'], ['Jiuquan', 40.96, 100.29, 'China'],
      ['Wenchang', 19.61, 110.95, 'China — heavy lift'], ['Sriharikota', 13.72, 80.23, 'India (ISRO)'], ['Tanegashima', 30.4, 130.97, 'Japan (JAXA)'],
    ],
    datacenters: [
      ['Ashburn (US-East)', 39.04, -77.49, 'Largest data-center hub on Earth'], ['Santa Clara', 37.35, -121.96, 'Silicon Valley core'],
      ['Dublin', 53.34, -6.27, 'EU cloud gateway'], ['Singapore', 1.35, 103.82, 'APAC hub'],
      ['Frankfurt', 50.11, 8.68, 'DE-CIX exchange'], ['Phoenix', 33.45, -112.07, 'Booming AI capacity'],
      ['The Dalles', 45.6, -121.18, 'Google flagship'], ['Council Bluffs', 41.26, -95.86, 'Meta/Google mega-campus'],
    ],
    centralbanks: [
      ['Federal Reserve', 38.893, -77.045, 'United States'], ['ECB', 50.109, 8.674, 'Eurozone (Frankfurt)'],
      ['Bank of England', 51.514, -0.089, 'United Kingdom'], ['Bank of Japan', 35.686, 139.771, 'Japan'],
      ['PBoC', 39.915, 116.366, "People's Bank of China"], ['SNB', 46.947, 7.444, 'Switzerland'],
      ['RBI', 18.932, 72.836, 'India'], ['BoC', 45.421, -75.704, 'Canada'],
    ],
  };

  function pointLayer(items, makeMarker) {
    const lg = L.layerGroup();
    for (const it of items) { const mk = makeMarker(it); if (mk) mk.addTo(lg); }
    return lg;
  }

  // ── Layer registry ──
  const LAYERS = [
    { id: 'earthquakes', label: 'Earthquakes', icon: '🌐', group: 'Hazards', live: true, refresh: 300000,
      load: async (lg) => {
        const d = await getJSON('/api/map/earthquakes');
        (d.points || []).forEach((q) => {
          if (q.lat == null) return;
          L.circleMarker([q.lat, q.lon], { renderer: r(), radius: Math.max(3, (q.mag || 1) * 2.2), weight: 1, color: quakeColor(q.mag || 0), fillColor: quakeColor(q.mag || 0), fillOpacity: 0.35 })
            .bindPopup(`<b>M ${q.mag}</b> ${q.tsunami ? '🌊' : ''}<br>${esc(q.place || '')}<br><small>${new Date(q.time).toUTCString()}</small>`).addTo(lg);
        });
      } },
    { id: 'events', label: 'Natural Events', icon: '🌋', group: 'Hazards', live: true, refresh: 1800000,
      load: async (lg) => {
        const d = await getJSON('/api/map/events');
        (d.points || []).forEach((e) => {
          const col = EONET_COLORS[e.category] || '#d96bff';
          L.circleMarker([e.lat, e.lon], { renderer: r(), radius: 5, weight: 1, color: col, fillColor: col, fillOpacity: 0.6 })
            .bindPopup(`<b>${esc(e.title || '')}</b><br>${esc(e.categoryTitle || '')}${e.date ? '<br><small>' + new Date(e.date).toUTCString() + '</small>' : ''}`).addTo(lg);
        });
      } },
    { id: 'weather', label: 'US Weather Alerts', icon: '⛈', group: 'Hazards', live: true, refresh: 600000,
      load: async (lg) => {
        const d = await getJSON('/api/map/weather');
        (d.points || []).forEach((w) => {
          const sev = String(w.severity || '').toLowerCase();
          const col = sev === 'extreme' ? '#ff453a' : sev === 'severe' ? '#ff8c00' : '#ffd23f';
          L.circleMarker([w.lat, w.lon], { renderer: r(), radius: 6, weight: 1, color: col, fillColor: col, fillOpacity: 0.4 })
            .bindPopup(`<b>${esc(w.event || '')}</b><br>${esc(w.area || '')}<br><small>${esc(w.severity || '')} · ${esc(w.urgency || '')}</small>`).addTo(lg);
        });
      } },
    { id: 'flights', label: 'Aircraft (live)', icon: '✈', group: 'Movement', live: true, refresh: 45000, viewport: true,
      load: async (lg) => {
        const b = map.getBounds();
        const bbox = [b.getSouth().toFixed(1), b.getWest().toFixed(1), b.getNorth().toFixed(1), b.getEast().toFixed(1)].join(',');
        const d = await getJSON('/api/map/flights?bbox=' + bbox);
        (d.points || []).forEach((a) => {
          L.marker([a.lat, a.lon], { icon: planeIcon(a.heading || 0), interactive: true })
            .bindPopup(`<b>${esc(a.callsign || a.icao)}</b><br>${esc(a.country || '')}<br><small>${a.alt ? Math.round(a.alt) + ' m · ' : ''}${a.velocity ? Math.round(a.velocity * 1.944) + ' kn' : ''}</small>`).addTo(lg);
        });
      } },
    { id: 'daynight', label: 'Day / Night', icon: '🌓', group: 'Overlays', compute: true, refresh: 300000,
      load: (lg) => { drawTerminator(lg); } },
    // Curated reference layers
    { id: 'chokepoints', label: 'Chokepoints', icon: '⚓', group: 'Geopolitics',
      load: (lg) => DATA.chokepoints.forEach(([n, la, lo, d]) => diamond(la, lo, '#45c8dc', `<b>${esc(n)}</b><br>${esc(d)}`).addTo(lg)) },
    { id: 'nuclear', label: 'Nuclear Sites', icon: '☢', group: 'Geopolitics',
      load: (lg) => DATA.nuclear.forEach(([n, la, lo, d]) => diamond(la, lo, '#ffd23f', `<b>☢ ${esc(n)}</b><br>${esc(d)}`).addTo(lg)) },
    { id: 'spaceports', label: 'Spaceports', icon: '🚀', group: 'Infrastructure',
      load: (lg) => DATA.spaceports.forEach(([n, la, lo, d]) => diamond(la, lo, '#d96bff', `<b>🚀 ${esc(n)}</b><br>${esc(d)}`).addTo(lg)) },
    { id: 'datacenters', label: 'AI Data Centers', icon: '🖥', group: 'Infrastructure',
      load: (lg) => DATA.datacenters.forEach(([n, la, lo, d]) => diamond(la, lo, '#2bd97c', `<b>🖥 ${esc(n)}</b><br>${esc(d)}`).addTo(lg)) },
    { id: 'exchanges', label: 'Stock Exchanges', icon: '🏛', group: 'Markets',
      load: (lg) => DATA.exchanges.forEach(([n, la, lo, d]) => diamond(la, lo, '#ffa028', `<b>🏛 ${esc(n)}</b><br>${esc(d)}`).addTo(lg)) },
    { id: 'centralbanks', label: 'Central Banks', icon: '💰', group: 'Markets',
      load: (lg) => DATA.centralbanks.forEach(([n, la, lo, d]) => diamond(la, lo, '#e8c170', `<b>💰 ${esc(n)}</b><br>${esc(d)}`).addTo(lg)) },
  ];

  let _canvas = null;
  const r = () => (_canvas || (_canvas = L.canvas({ padding: 0.5 })));
  function diamond(lat, lon, color, popup) {
    return L.circleMarker([lat, lon], { renderer: r(), radius: 5, weight: 1.5, color, fillColor: color, fillOpacity: 0.85 }).bindPopup(popup);
  }
  function planeIcon(heading) {
    return L.divIcon({ className: 'plane-icon', html: `<div style="transform:rotate(${heading}deg)">✈</div>`, iconSize: [16, 16] });
  }

  // ── Day/night terminator (computed) ──
  function drawTerminator(lg) {
    const now = new Date();
    const jd = now / 86400000 + 2440587.5;
    const T = (jd - 2451545.0) / 36525;
    const L0 = (280.46646 + 36000.76983 * T) % 360;
    const M = (357.52911 + 35999.05029 * T) * Math.PI / 180;
    const C = (1.914602 - 0.004817 * T) * Math.sin(M) + 0.019993 * Math.sin(2 * M);
    const lon = (L0 + C) * Math.PI / 180;
    const e = (23.439 - 0.00013 * T) * Math.PI / 180;
    const dec = Math.asin(Math.sin(e) * Math.sin(lon)); // solar declination
    const gmst = (18.697374558 + 24.06570982441908 * (jd - 2451545.0)) % 24;
    const subLon = -(gmst * 15) % 360; // subsolar longitude (approx)
    const pts = [];
    for (let l = -180; l <= 180; l += 2) {
      const H = ((l - subLon) * Math.PI / 180);
      const lat = Math.atan(-Math.cos(H) / Math.tan(dec)) * 180 / Math.PI;
      pts.push([lat, l]);
    }
    // Close polygon over the night pole.
    const nightNorth = dec < 0;
    const poly = pts.concat([[nightNorth ? 90 : -90, 180], [nightNorth ? 90 : -90, -180]]);
    L.polygon(poly, { stroke: false, fillColor: '#000010', fillOpacity: 0.42, interactive: false }).addTo(lg);
  }

  // ── toggling ──
  async function setLayer(id, on) {
    active[id] = on;
    const def = LAYERS.find((l) => l.id === id);
    if (!def) return;
    if (on) {
      if (!groups[id]) groups[id] = L.layerGroup();
      groups[id].addTo(map);
      await refreshLayer(def);
      if ((def.live || def.compute) && def.refresh) {
        clearInterval(timers[id]);
        timers[id] = setInterval(() => { if (active[id]) refreshLayer(def); }, def.refresh);
      }
      if (def.viewport) map.on('moveend', def._mv || (def._mv = () => { if (active[id]) refreshLayer(def); }));
    } else {
      if (groups[id]) map.removeLayer(groups[id]);
      clearInterval(timers[id]);
      if (def.viewport && def._mv) map.off('moveend', def._mv);
    }
    updateActiveCount();
  }
  async function refreshLayer(def) {
    const lg = groups[def.id];
    if (!lg) return;
    const badge = document.querySelector(`.mlp-row[data-id="${def.id}"] .mlp-spin`);
    if (badge) badge.classList.add('on');
    try { lg.clearLayers(); await def.load(lg); loadedOnce[def.id] = true; }
    catch (e) { /* leave layer empty on error */ }
    finally { if (badge) badge.classList.remove('on'); }
  }

  let countEl = null;
  function updateActiveCount() {
    if (!countEl) return;
    const n = Object.values(active).filter(Boolean).length;
    countEl.textContent = n ? `${n} layer${n > 1 ? 's' : ''} on` : '';
  }

  // ── panel UI (Leaflet control, top-right) ──
  function buildPanel() {
    const Ctrl = L.Control.extend({
      options: { position: 'topright' },
      onAdd() {
        const div = L.DomUtil.create('div', 'map-layer-panel');
        const groupsOrder = ['Hazards', 'Movement', 'Geopolitics', 'Infrastructure', 'Markets', 'Overlays'];
        const byGroup = {};
        LAYERS.forEach((l) => { (byGroup[l.group] = byGroup[l.group] || []).push(l); });
        div.innerHTML =
          `<div class="mlp-head"><span>LAYERS</span><span class="mlp-count"></span><button class="mlp-collapse" title="Collapse">▾</button></div>` +
          `<div class="mlp-body">` +
          groupsOrder.filter((g) => byGroup[g]).map((g) =>
            `<div class="mlp-group"><div class="mlp-gname">${g}</div>` +
            byGroup[g].map((l) =>
              `<label class="mlp-row" data-id="${l.id}"><input type="checkbox" data-layer="${l.id}"><span class="mlp-ico">${l.icon}</span><span class="mlp-lbl">${l.label}</span><span class="mlp-spin"></span></label>`
            ).join('') + `</div>`
          ).join('') + `</div>`;
        L.DomEvent.disableClickPropagation(div);
        L.DomEvent.disableScrollPropagation(div);
        countEl = div.querySelector('.mlp-count');
        div.querySelector('.mlp-collapse').addEventListener('click', (ev) => {
          ev.preventDefault();
          div.classList.toggle('collapsed');
          ev.target.textContent = div.classList.contains('collapsed') ? '▸' : '▾';
        });
        div.querySelectorAll('input[data-layer]').forEach((cb) => {
          cb.addEventListener('change', () => setLayer(cb.dataset.layer, cb.checked));
        });
        return div;
      },
    });
    panel = new Ctrl();
    panel.addTo(map);
  }

  // ── init when the ship map is ready ──
  document.addEventListener('shipmap:ready', (e) => {
    map = e.detail.map;
    if (!map || panel) return;
    buildPanel();
    // Sensible defaults on first open.
    setTimeout(() => {
      document.querySelectorAll('.map-layer-panel input[data-layer="earthquakes"], .map-layer-panel input[data-layer="daynight"]').forEach((cb) => { cb.checked = true; setLayer(cb.dataset.layer, true); });
    }, 300);
  });
})();
