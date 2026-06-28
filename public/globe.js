'use strict';

/* ════════════════════════════════════════════════════════════════
   Market Terminal — 3D globe view (GLOBAL MAP · 3D)
   A globe.gl Earth that plots the same intelligence layers as the 2D
   map: live ships, earthquakes, the AI instability index (as spikes),
   conflict zones, curated reference points, and trade/cable/pipeline
   paths. Toggled against the Leaflet 2D map. Written from scratch.
   ════════════════════════════════════════════════════════════════ */
(() => {
  let globe = null, initialized = false, rotTimer = null;
  const active = { ships: true, earthquakes: true, instability: true, conflicts: true, routes: true, nuclear: false, military: false, exchanges: false };
  const cache = {};

  const $ = (s) => document.querySelector(s);
  const SHIP_COL = { cargo: '#2bd97c', cruise: '#d96bff', tanker: '#ffa028', other: '#5a6472' };
  const quakeColor = (m) => (m >= 6 ? '#ff453a' : m >= 4.5 ? '#ff8c00' : m >= 3 ? '#ffd23f' : '#9acd32');
  const cii = (s) => (s >= 75 ? '#ff453a' : s >= 50 ? '#ff8c00' : s >= 30 ? '#ffd23f' : '#2bd97c');

  async function getJSON(url) { const r = await fetch(url, { headers: { Accept: 'application/json' } }); return r.json(); }

  // Each globe layer yields point or path features.
  async function pointsFor(id) {
    const D = (window.MapData && window.MapData.DATA) || {};
    if (id === 'ships') {
      const s = (window.ShipMap && window.ShipMap.getShips) ? window.ShipMap.getShips() : [];
      return s.map((v) => ({ lat: v.lat, lon: v.lon, color: SHIP_COL[v.cls] || SHIP_COL.other, alt: 0.002, r: 0.12, label: `${v.name || 'Vessel'} (${v.cls})` }));
    }
    if (id === 'earthquakes') {
      if (!cache.q) cache.q = (await getJSON('/api/map/earthquakes')).points || [];
      return cache.q.map((q) => ({ lat: q.lat, lon: q.lon, color: quakeColor(q.mag || 0), alt: Math.max(0.01, (q.mag || 1) * 0.012), r: 0.25, label: `M${q.mag} ${q.place || ''}` }));
    }
    if (id === 'instability') {
      if (!cache.cii) cache.cii = (await getJSON('/api/intel/instability')).countries || [];
      return cache.cii.map((c) => ({ lat: c.lat, lon: c.lon, color: cii(c.score || 0), alt: (c.score || 0) / 100 * 0.4, r: 0.55, label: `${c.country}: CII ${c.score}` }));
    }
    const curated = { conflicts: ['conflictZones', '#ff453a'], nuclear: ['nuclear', '#ffd23f'], military: ['militaryBases', '#ff8c5a'], exchanges: ['exchanges', '#ffa028'] };
    if (curated[id]) {
      const [key, col] = curated[id];
      return (D[key] || []).map(([n, la, lo, d]) => ({ lat: la, lon: lo, color: col, alt: 0.04, r: 0.5, label: `${n} — ${d}` }));
    }
    return [];
  }

  function allPaths() {
    if (!active.routes) return [];
    const L = (window.MapData && window.MapData.LINES) || {};
    const out = [];
    const add = (set, color) => (set || []).forEach(([name, path]) => out.push({ coords: path, color }));
    add(L.tradeRoutes, '#45c8dc'); add(L.cables, '#7aa2f7'); add(L.pipelines, '#ffa028');
    return out;
  }

  async function render() {
    if (!globe) return;
    const ids = Object.keys(active).filter((k) => active[k] && k !== 'routes');
    const groups = await Promise.all(ids.map((id) => pointsFor(id).catch(() => [])));
    const pts = groups.flat();
    globe.pointsData(pts).arcsData([]);
    globe.pathsData(allPaths());
    $('#globeStat') && ($('#globeStat').textContent = `${pts.length.toLocaleString()} points · live`);
  }

  function buildToggle(host) {
    const wrap = document.createElement('div');
    wrap.className = 'globe-panel';
    const rows = [['ships', '🚢 Ships'], ['earthquakes', '🌐 Quakes'], ['instability', '⚠ Instability'], ['conflicts', '⚔ Conflicts'], ['routes', '🚢 Routes'], ['nuclear', '☢ Nuclear'], ['military', '🪖 Military'], ['exchanges', '🏛 Exchanges']];
    wrap.innerHTML = `<div class="globe-stat" id="globeStat">Loading…</div>` +
      rows.map(([id, lbl]) => `<label class="globe-row"><input type="checkbox" data-g="${id}" ${active[id] ? 'checked' : ''}><span>${lbl}</span></label>`).join('');
    wrap.querySelectorAll('input[data-g]').forEach((cb) => cb.addEventListener('change', () => { active[cb.dataset.g] = cb.checked; render(); }));
    host.appendChild(wrap);
  }

  function sizeGlobe() {
    const el = $('#globeMap');
    if (globe && el) globe.width(el.clientWidth).height(el.clientHeight);
  }

  function init() {
    if (initialized) return;
    initialized = true;
    const el = $('#globeMap');
    globe = Globe()(el)
      .globeImageUrl('//unpkg.com/three-globe/example/img/earth-night.jpg')
      .bumpImageUrl('//unpkg.com/three-globe/example/img/earth-topology.png')
      .backgroundColor('#0a0a0a')
      .atmosphereColor('#45c8dc').atmosphereAltitude(0.18)
      .pointLat('lat').pointLng('lon').pointColor('color').pointAltitude('alt').pointRadius('r').pointLabel('label').pointsMerge(false)
      .pathPoints('coords').pathPointLat((p) => p[0]).pathPointLng((p) => p[1]).pathColor((d) => [d.color, d.color]).pathStroke(1.2).pathDashLength(0.4).pathDashGap(0.1).pathDashAnimateTime(12000);
    sizeGlobe();
    globe.controls().autoRotate = true;
    globe.controls().autoRotateSpeed = 0.5;
    buildToggle(el);
    window.addEventListener('resize', sizeGlobe);
    render();
    rotTimer = setInterval(render, 20000); // refresh live data
  }

  window.GlobeView = {
    show() {
      const el = $('#globeMap');
      if (!window.Globe) { el && (el.innerHTML = '<div class="globe-stat">3D library failed to load.</div>'); return; }
      init();
      setTimeout(sizeGlobe, 60);
      render();
    },
    hide() { /* keep state; the container is hidden by the toggle */ },
  };

  // 2D / 3D toggle wiring
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.mapmode-btn');
    if (!btn) return;
    const mode = btn.dataset.mode;
    document.querySelectorAll('.mapmode-btn').forEach((b) => b.classList.toggle('active', b === btn));
    const ship = $('#shipMap'), globeEl = $('#globeMap');
    if (mode === '3d') {
      ship.hidden = true; globeEl.hidden = false;
      window.GlobeView.show();
    } else {
      globeEl.hidden = true; ship.hidden = false;
      const m = window.ShipMap && window.ShipMap.getMap && window.ShipMap.getMap();
      if (m) setTimeout(() => m.invalidateSize(), 60);
    }
  });
})();
