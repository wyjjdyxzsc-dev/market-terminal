'use strict';

/* ════════════════════════════════════════════════════════════════
   Market Terminal — live ship map (GLOBAL INTEL · GLOBAL MAP)
   Plots real-time cargo, cruise/passenger and tanker positions from
   aisstream.io. The browser talks to our own /api/ships/stream proxy,
   which injects the AIS key server-side. Leaflet + CARTO dark tiles.
   Exposes window.ShipMap.{open, refilter}.
   ════════════════════════════════════════════════════════════════ */
(() => {
  const COLORS = { cargo: '#2bd97c', cruise: '#d96bff', tanker: '#ffa028', other: '#5a6472' };
  const MAX_SHIPS = 2200;       // hard cap on rendered markers
  const STALE_MS = 8 * 60_000;  // drop ships not heard from in 8 min

  let map = null, renderer = null, ws = null;
  let initialized = false, opened = false;
  let subTimer = null, pruneTimer = null, reconnectTimer = null;
  const ships = new Map();       // MMSI -> { marker, lat, lon, type, name, last }
  const filters = { cargo: true, cruise: true, tanker: true, other: true };

  const $ = (s) => document.querySelector(s);
  const setStat = (t) => { const el = $('#shipStat'); if (el) el.textContent = t; };

  function shipClass(type) {
    if (type >= 60 && type <= 69) return 'cruise';
    if (type >= 70 && type <= 79) return 'cargo';
    if (type >= 80 && type <= 89) return 'tanker';
    return 'other';
  }
  // Cargo/cruise/tanker honor their toggle; everything else (tugs, pilots,
  // fishing, and vessels that haven't broadcast their type yet) shows as a dim
  // dot so the map reflects real traffic density instead of looking empty.
  const visible = (cls) => (cls === 'other' ? filters.other : filters[cls]);

  // ---------- map ----------
  function initMap() {
    if (initialized) return;
    initialized = true;
    map = L.map('shipMap', { worldCopyJump: true, preferCanvas: true, minZoom: 2 }).setView([25, 10], 3);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '© OpenStreetMap · © CARTO · AIS via aisstream.io', subdomains: 'abcd', maxZoom: 16,
    }).addTo(map);
    renderer = L.canvas({ padding: 0.5 });
    map.on('moveend', scheduleSubscribe);
    pruneTimer = setInterval(prune, 30_000);
  }

  // ---------- websocket ----------
  function connect() {
    if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    setStat('Connecting to live AIS feed…');
    try { ws = new WebSocket(`${proto}//${location.host}/api/ships/stream`); }
    catch { return scheduleReconnect(); }
    ws.binaryType = 'arraybuffer'; // aisstream sends JSON as binary frames
    ws.addEventListener('open', () => { setStat('● LIVE · subscribing to this region…'); subscribe(); });
    ws.addEventListener('message', onMessage);
    ws.addEventListener('close', () => { if (opened) scheduleReconnect(); });
    ws.addEventListener('error', () => { try { ws.close(); } catch {} });
  }
  function scheduleReconnect() {
    clearTimeout(reconnectTimer);
    setStat('Reconnecting…');
    reconnectTimer = setTimeout(() => { if (opened) connect(); }, 3500);
  }

  function bbox() {
    const b = map.getBounds();
    const s = Math.max(-89.9, b.getSouth()), n = Math.min(89.9, b.getNorth());
    const w = Math.max(-180, b.getWest()), e = Math.min(180, b.getEast());
    return [[[s, w], [n, e]]];
  }
  function subscribe() {
    if (!ws || ws.readyState !== 1) return;
    // APIKey is injected by the worker proxy.
    ws.send(JSON.stringify({ BoundingBoxes: bbox(), FilterMessageTypes: ['PositionReport', 'ShipStaticData'] }));
  }
  function scheduleSubscribe() { clearTimeout(subTimer); subTimer = setTimeout(subscribe, 600); }

  // ---------- incoming AIS ----------
  function onMessage(ev) {
    let raw = ev.data;
    if (raw instanceof ArrayBuffer) raw = new TextDecoder().decode(raw);
    else if (typeof raw !== 'string') return; // ignore unexpected Blob frames
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.error) { setStat('AIS: ' + m.error); return; }
    const meta = m.MetaData || {};
    const mmsi = meta.MMSI || meta.mmsi;
    if (!mmsi) return;

    if (m.MessageType === 'ShipStaticData') {
      const sd = m.Message && m.Message.ShipStaticData;
      if (!sd) return;
      let s = ships.get(mmsi);
      if (!s) { s = { marker: null, lat: null, lon: null, last: Date.now() }; ships.set(mmsi, s); }
      s.type = sd.Type;
      s.name = (sd.Name || s.name || '').trim();
      if (s.marker) { restyle(mmsi, s); }
      return;
    }
    if (m.MessageType === 'PositionReport') {
      const pr = m.Message && m.Message.PositionReport;
      const lat = (pr && pr.Latitude != null) ? pr.Latitude : meta.latitude;
      const lon = (pr && pr.Longitude != null) ? pr.Longitude : meta.longitude;
      if (lat == null || lon == null || Math.abs(lat) > 90) return;
      let s = ships.get(mmsi);
      if (!s) { s = { marker: null, type: undefined, name: (meta.ShipName || '').trim(), last: 0 }; ships.set(mmsi, s); }
      s.lat = lat; s.lon = lon; s.last = Date.now();
      s.sog = pr && pr.Sog; s.cog = pr && pr.Cog;
      if (!s.name && meta.ShipName) s.name = meta.ShipName.trim();
      upsert(mmsi, s);
    }
  }

  function popupHtml(mmsi, s) {
    const cls = shipClass(s.type);
    const kind = cls === 'other' ? (s.type != null ? 'Type ' + s.type : 'Unknown') : cls[0].toUpperCase() + cls.slice(1);
    return `<div class="ship-pop"><b>${(s.name || 'Vessel ' + mmsi)}</b><br>` +
      `<span style="color:${COLORS[cls]}">${kind}</span> · MMSI ${mmsi}<br>` +
      `${s.sog != null ? 'Speed ' + Number(s.sog).toFixed(1) + ' kn' : ''}${s.cog != null ? ' · Course ' + Math.round(s.cog) + '°' : ''}</div>`;
  }

  const styleFor = (cls) => ({
    renderer, weight: 0, fillColor: COLORS[cls],
    radius: cls === 'other' ? 2.5 : cls === 'cruise' ? 5 : 4,
    fillOpacity: cls === 'other' ? 0.3 : 0.9,
  });

  function upsert(mmsi, s) {
    const cls = shipClass(s.type);
    const show = visible(cls);
    if (!s.marker) {
      if (ships.size > MAX_SHIPS) evictOldest();
      s.marker = L.circleMarker([s.lat, s.lon], styleFor(cls));
      s.marker.bindPopup(() => popupHtml(mmsi, s), { className: 'ship-popup' });
      if (show) s.marker.addTo(map);
    } else {
      s.marker.setLatLng([s.lat, s.lon]);
      if (show && !map.hasLayer(s.marker)) s.marker.addTo(map);
      else if (!show && map.hasLayer(s.marker)) map.removeLayer(s.marker);
    }
    updateCount();
  }

  function restyle(mmsi, s) {
    const cls = shipClass(s.type);
    if (!s.marker) return;
    s.marker.setStyle(styleFor(cls));
    const show = visible(cls);
    if (show && !map.hasLayer(s.marker)) s.marker.addTo(map);
    else if (!show && map.hasLayer(s.marker)) map.removeLayer(s.marker);
    updateCount();
  }

  function evictOldest() {
    let oldest = null, oldT = Infinity;
    for (const [k, v] of ships) { if (v.last < oldT) { oldT = v.last; oldest = k; } }
    if (oldest != null) { const v = ships.get(oldest); if (v && v.marker) map.removeLayer(v.marker); ships.delete(oldest); }
  }
  function prune() {
    const cut = Date.now() - STALE_MS;
    for (const [k, v] of ships) { if (v.last && v.last < cut) { if (v.marker) map.removeLayer(v.marker); ships.delete(k); } }
    updateCount();
  }

  let countTimer = null;
  function updateCount() {
    if (countTimer) return;
    countTimer = setTimeout(() => {
      countTimer = null;
      let cargo = 0, cruise = 0, tanker = 0;
      for (const v of ships.values()) { const c = shipClass(v.type); if (c === 'cargo') cargo++; else if (c === 'cruise') cruise++; else if (c === 'tanker') tanker++; }
      setStat(`● LIVE · ${ships.size} vessels · ${cargo} cargo · ${cruise} cruise · ${tanker} tankers`);
    }, 500);
  }

  function refilter() {
    for (const [k, s] of ships) {
      if (!s.marker) continue;
      const show = visible(shipClass(s.type));
      if (show && !map.hasLayer(s.marker)) s.marker.addTo(map);
      else if (!show && map.hasLayer(s.marker)) map.removeLayer(s.marker);
    }
  }

  // ---------- filter buttons ----------
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.ship-filter');
    if (!btn) return;
    const t = btn.dataset.type;
    filters[t] = !filters[t];
    btn.classList.toggle('active', filters[t]);
    if (initialized) refilter();
  });

  // ---------- public ----------
  window.ShipMap = {
    open() {
      opened = true;
      if (!window.L) { setStat('Map library failed to load.'); return; }
      const firstInit = !initialized;
      initMap();
      setTimeout(() => map && map.invalidateSize(), 60); // fix sizing after un-hide
      connect();
      if (firstInit) document.dispatchEvent(new CustomEvent('shipmap:ready', { detail: { map } }));
    },
    getMap() { return map; },
    getShips() {
      const out = [];
      for (const s of ships.values()) {
        if (s.lat == null || s.lon == null) continue;
        out.push({ lat: s.lat, lon: s.lon, cls: shipClass(s.type), name: s.name });
      }
      return out;
    },
    refilter,
  };
})();
