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
    militaryBases: [
      ['Ramstein AB', 49.44, 7.60, 'US Air Force — Germany'], ['Diego Garcia', -7.31, 72.41, 'US/UK Indian Ocean base'],
      ['Guam (Andersen)', 13.58, 144.93, 'US Pacific hub'], ['Al Udeid AB', 25.12, 51.32, 'US CENTCOM — Qatar'],
      ['Camp Humphreys', 36.96, 127.03, 'Largest US overseas base — Korea'], ['Yokosuka', 35.29, 139.67, 'US 7th Fleet — Japan'],
      ['Djibouti (Lemonnier)', 11.55, 43.16, 'US/Allied Horn of Africa'], ['Tartus', 34.90, 35.87, 'Russian naval base — Syria'],
      ['Pearl Harbor', 21.36, -157.95, 'US Pacific Fleet'], ['Incirlik AB', 37.00, 35.43, 'US/NATO — Türkiye'],
      ['Bagram (former)', 34.95, 69.27, 'Afghanistan'], ['Kaliningrad', 54.71, 20.51, 'Russian Baltic exclave'],
    ],
    criticalMinerals: [
      ['Bayan Obo', 41.77, 109.97, 'China — rare earths (world\'s largest)'], ['Mountain Pass', 35.48, -115.53, 'USA — rare earths'],
      ['Escondida', -24.27, -69.07, 'Chile — copper (largest)'], ['Grasberg', -4.06, 137.11, 'Indonesia — copper/gold'],
      ['Cobalt (Katanga)', -10.7, 25.5, 'DR Congo — cobalt belt'], ['Greenbushes', -33.86, 116.06, 'Australia — lithium'],
      ['Salar de Atacama', -23.5, -68.2, 'Chile — lithium brine'], ['Norilsk', 69.35, 88.20, 'Russia — nickel/palladium'],
      ['Olympic Dam', -30.44, 136.88, 'Australia — uranium/copper'], ['Jiangxi', 28.0, 116.0, 'China — rare-earth refining'],
    ],
    techHQs: [
      ['Apple', 37.335, -122.009, 'Cupertino'], ['Google', 37.422, -122.084, 'Mountain View'], ['Microsoft', 47.640, -122.129, 'Redmond'],
      ['Nvidia', 37.371, -121.965, 'Santa Clara'], ['Meta', 37.485, -122.148, 'Menlo Park'], ['TSMC', 24.774, 121.001, 'Hsinchu, Taiwan'],
      ['ASML', 51.41, 5.46, 'Veldhoven, NL'], ['Samsung', 37.258, 127.054, 'Suwon'], ['Tesla', 30.222, -97.617, 'Austin'],
      ['Amazon', 47.622, -122.337, 'Seattle'], ['ARM', 52.198, 0.127, 'Cambridge UK'],
    ],
    cloudRegions: [
      ['AWS us-east-1', 39.04, -77.49, 'N. Virginia — core'], ['AWS us-west-2', 45.87, -119.69, 'Oregon'],
      ['Azure East US', 37.37, -79.16, 'Virginia'], ['GCP us-central1', 41.26, -95.86, 'Iowa'],
      ['AWS eu-west-1', 53.41, -8.24, 'Ireland'], ['AWS ap-southeast-1', 1.32, 103.69, 'Singapore'],
      ['Azure West Europe', 52.37, 4.90, 'Netherlands'], ['GCP asia-east1', 24.05, 120.52, 'Taiwan'],
    ],
    financialCenters: [
      ['Wall Street', 40.706, -74.009, 'New York'], ['City of London', 51.515, -0.092, 'London'],
      ['Hong Kong', 22.281, 114.158, 'HK'], ['Singapore', 1.284, 103.851, 'SG'], ['Tokyo', 35.681, 139.767, 'Marunouchi'],
      ['Frankfurt', 50.111, 8.679, 'DE'], ['Zurich', 47.369, 8.539, 'CH'], ['Dubai (DIFC)', 25.215, 55.282, 'UAE'], ['Shanghai', 31.240, 121.499, 'Lujiazui'],
    ],
    refugeeHotspots: [
      ['Syria', 35.0, 38.0, 'Largest displacement crisis'], ['Ukraine', 49.0, 32.0, 'War displacement'],
      ['Sudan', 15.5, 30.0, 'Conflict displacement'], ['Gaza', 31.5, 34.45, 'Humanitarian crisis'],
      ['DR Congo', -2.0, 27.0, 'Eastern conflict'], ['Myanmar', 21.0, 96.0, 'Rohingya & internal'],
      ['Afghanistan', 34.0, 66.0, 'Protracted displacement'], ['Venezuela', 7.0, -66.0, 'Regional migration'],
    ],
    commodityPorts: [
      ['Ras Tanura', 26.64, 50.16, 'Saudi — oil export'], ['Rotterdam', 51.95, 4.14, 'Europe\'s largest port'],
      ['Shanghai', 30.62, 122.06, 'World\'s busiest container port'], ['Houston', 29.73, -95.27, 'US energy export'],
      ['Singapore', 1.26, 103.75, 'Bunkering & transshipment'], ['Fujairah', 25.16, 56.36, 'UAE oil storage hub'],
      ['Newcastle', -32.92, 151.80, 'Australia — coal export'], ['Santos', -23.96, -46.30, 'Brazil — soy/sugar'],
    ],
    conflictZones: [
      ['Ukraine', 48.3, 37.8, 'Russia–Ukraine war (active front)'], ['Gaza', 31.45, 34.40, 'Israel–Hamas conflict'],
      ['Sudan', 15.5, 32.5, 'Civil war (RSF vs SAF)'], ['Sahel', 14.0, 0.0, 'Jihadist insurgency belt'],
      ['Myanmar', 21.5, 96.5, 'Civil war'], ['DR Congo (East)', -1.5, 29.0, 'M23 & militia conflict'],
      ['Red Sea', 14.5, 42.0, 'Houthi shipping attacks'], ['Taiwan Strait', 24.5, 119.5, 'Cross-strait tensions'],
      ['Kashmir', 34.0, 76.0, 'India–Pakistan flashpoint'], ['Korean DMZ', 38.0, 127.5, 'North–South standoff'],
    ],
    sanctions: [
      ['Russia', 61.5, 100.0, 'Heavily sanctioned (West)'], ['Iran', 32.0, 53.0, 'Oil & banking sanctions'],
      ['North Korea', 40.0, 127.0, 'UN/US sanctions'], ['Venezuela', 7.0, -66.0, 'US oil sanctions'],
      ['Syria', 35.0, 38.0, 'Multilateral sanctions'], ['Cuba', 22.0, -79.5, 'US embargo'], ['Belarus', 53.7, 27.9, 'EU/US sanctions'],
    ],
    startupHubs: [
      ['Silicon Valley', 37.39, -122.08, 'Global #1'], ['New York', 40.74, -73.99, 'Fintech & SaaS'],
      ['London', 51.52, -0.10, 'Europe #1'], ['Bengaluru', 12.97, 77.59, 'India tech capital'],
      ['Tel Aviv', 32.07, 34.79, 'Startup Nation'], ['Beijing', 39.98, 116.31, 'Zhongguancun'],
      ['Berlin', 52.52, 13.40, 'EU growth hub'], ['Singapore', 1.29, 103.85, 'SEA gateway'], ['Shenzhen', 22.54, 114.06, 'Hardware capital'],
    ],
    gccInvestments: [
      ['PIF (Saudi)', 24.71, 46.68, '$900B+ sovereign fund'], ['ADIA (Abu Dhabi)', 24.45, 54.38, '~$1T sovereign fund'],
      ['QIA (Qatar)', 25.29, 51.53, '~$500B fund'], ['Mubadala', 24.50, 54.37, 'Abu Dhabi strategic fund'],
      ['Kuwait (KIA)', 29.38, 47.99, 'Oldest sovereign fund'], ['NEOM', 28.0, 35.3, '$500B megacity project'],
    ],
    diseaseOutbreaks: [
      ['DR Congo', -4.0, 21.5, 'Mpox / Ebola watch'], ['Uganda', 1.4, 32.3, 'Ebola/Marburg surveillance'],
      ['DRC/Sudan', 12.0, 30.0, 'Cholera outbreaks'], ['SE Asia', 14.0, 101.0, 'Dengue surge'], ['Global', 30.0, 0.0, 'Avian influenza H5N1 spread'],
    ],
    economicCenters: [
      ['New York', 40.71, -74.01, 'Largest economy metro'], ['Tokyo', 35.68, 139.69, 'Japan core'], ['Shanghai', 31.23, 121.47, 'China commerce'],
      ['London', 51.51, -0.13, 'UK/EU finance'], ['Los Angeles', 34.05, -118.24, 'Trade & media'], ['Paris', 48.86, 2.35, 'EU #2'],
      ['Mumbai', 19.08, 72.88, 'India finance'], ['São Paulo', -23.55, -46.63, 'LatAm hub'], ['Dubai', 25.20, 55.27, 'MENA gateway'],
    ],
    internetExchanges: [
      ['DE-CIX Frankfurt', 50.11, 8.68, 'World\'s largest IXP'], ['AMS-IX', 52.36, 4.95, 'Amsterdam'], ['LINX London', 51.51, -0.09, 'London'],
      ['Equinix Ashburn', 39.04, -77.49, 'US-East core'], ['Equinix Singapore', 1.29, 103.85, 'SEA core'], ['Equinix Tokyo', 35.69, 139.69, 'Japan'],
      ['Equinix Palo Alto', 37.44, -122.14, 'Silicon Valley'], ['MIX Milan', 45.46, 9.19, 'Italy'],
    ],
    gpsJamming: [
      ['Eastern Mediterranean', 33.5, 34.0, 'Persistent GPS spoofing'], ['Black Sea', 44.0, 34.0, 'Conflict-zone jamming'],
      ['Baltic / Kaliningrad', 55.0, 21.0, 'Jamming affecting aviation'], ['Persian Gulf', 26.5, 52.0, 'Strait of Hormuz interference'],
      ['Korean Peninsula', 37.8, 126.5, 'DPRK jamming events'], ['Syria/Levant', 34.5, 37.0, 'Active EW operations'],
    ],
  };

  // Line-based layers (great-circle-ish polylines) — [name, [[lat,lon],...], desc]
  const LINES = {
    tradeRoutes: [
      ['Asia–Europe (via Suez)', [[31.2, 121.5], [1.3, 104.0], [6.9, 79.8], [12.6, 43.3], [30.0, 32.5], [37.0, 15.0], [36.1, -5.3], [51.0, 1.4]], 'Main container artery'],
      ['Transpacific', [[31.2, 121.5], [35.5, 140.0], [40.0, 175.0], [40.0, -150.0], [37.8, -122.4]], 'Asia–US West Coast'],
      ['Transatlantic', [[51.0, 1.4], [50.0, -20.0], [42.0, -50.0], [40.7, -74.0]], 'Europe–US East Coast'],
      ['Gulf–Asia (oil)', [[26.6, 50.2], [26.5, 56.3], [12.6, 60.0], [6.9, 79.8], [1.3, 104.0], [31.2, 121.5]], 'Crude to Asia'],
      ['Cape Route', [[26.6, 50.2], [12.0, 50.0], [-12.0, 45.0], [-34.4, 18.5], [0.0, -15.0], [51.0, 1.4]], 'Around Africa (Red Sea bypass)'],
    ],
    cables: [
      ['Transatlantic (MAREA-ish)', [[36.7, -3.5], [38.0, -30.0], [36.8, -76.0]], 'US–Europe fiber'],
      ['Transpacific (JUPITER-ish)', [[35.3, 139.7], [30.0, 170.0], [21.3, -157.9], [34.0, -118.5]], 'Asia–US fiber'],
      ['SEA-ME-WE (Asia–Europe)', [[1.3, 103.8], [6.9, 79.8], [25.0, 56.0], [30.0, 32.5], [43.3, 5.4], [51.5, -0.1]], 'Asia–Mideast–Europe'],
    ],
    pipelines: [
      ['Nord Stream', [[60.2, 28.0], [59.5, 22.0], [55.4, 15.0], [54.1, 13.6]], 'Russia–Germany (gas)'],
      ['Druzhba', [[52.5, 50.0], [52.0, 35.0], [52.2, 23.0], [51.0, 15.0]], 'Russia–Europe (oil)'],
      ['TurkStream', [[45.0, 37.0], [42.0, 33.0], [41.2, 28.0]], 'Russia–Türkiye (gas)'],
      ['Keystone', [[56.0, -111.0], [49.0, -101.0], [40.0, -97.0], [29.7, -95.3]], 'Canada–US (oil)'],
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
    { id: 'flights', label: 'Aircraft (live)', icon: '✈', group: 'Movement', live: true, refresh: 20000, viewport: true,
      load: async (lg) => {
        const c = map.getCenter();
        const b = map.getBounds();
        const km = c.distanceTo(b.getNorthEast()) / 1000;
        const dist = Math.min(250, Math.max(25, Math.round(km / 1.852)));
        const bbox = [b.getSouth().toFixed(2), b.getWest().toFixed(2), b.getNorth().toFixed(2), b.getEast().toFixed(2)].join(',');
        // Two paths, merged & deduped by hex: airplanes.live straight from the
        // browser (CORS, our IP) + the worker's union of adsb.lol/adsb.fi/OpenSky.
        const [live, merged] = await Promise.all([
          getJSON(`https://api.airplanes.live/v2/point/${c.lat.toFixed(3)}/${c.lng.toFixed(3)}/${dist}`).then((d) => d.ac || []).catch(() => []),
          getJSON('/api/map/flights?bbox=' + bbox).then((d) => d.points || []).catch(() => []),
        ]);
        const seen = new Set();
        const planes = [];
        for (const a of live) {
          const hex = (a.hex || '').toLowerCase();
          if (a.lat == null || a.lon == null || a.alt_baro === 'ground') continue;
          seen.add(hex);
          planes.push({ lat: a.lat, lon: a.lon, cs: (a.flight || a.r || a.hex || '').trim(), t: a.t, alt: typeof a.alt_baro === 'number' ? Math.round(a.alt_baro * 0.3048) : null, gs: a.gs, hdg: a.track != null ? a.track : a.true_heading });
        }
        for (const a of merged) {
          if (a.icao && seen.has(a.icao)) continue;
          planes.push({ lat: a.lat, lon: a.lon, cs: (a.callsign || a.reg || a.icao || '').trim(), t: a.type, alt: a.alt, gs: a.velocity != null ? a.velocity * 1.944 : null, hdg: a.heading });
        }
        planes.forEach((p) => {
          L.marker([p.lat, p.lon], { icon: planeIcon(p.hdg || 0), interactive: true })
            .bindPopup(`<b>${esc(p.cs || 'aircraft')}</b>${p.t ? ' · ' + esc(p.t) : ''}<br><small>${p.alt != null ? p.alt + ' m' : ''}${p.gs != null ? ' · ' + Math.round(p.gs) + ' kn' : ''}${p.hdg != null ? ' · ' + Math.round(p.hdg) + '°' : ''}</small>`).addTo(lg);
        });
        const sc = document.querySelector('.mlp-row[data-id="flights"] .mlp-lbl');
        if (sc) sc.textContent = `Aircraft · ${planes.length}`;
      } },
    { id: 'fires', label: 'Active Fires (NASA)', icon: '🔥', group: 'Hazards', live: true, refresh: 1800000,
      load: async (lg) => {
        const d = await getJSON('/api/map/fires');
        if (d.error) return;
        (d.points || []).forEach((f) => {
          L.circleMarker([f.lat, f.lon], { renderer: r(), radius: 2, weight: 0, fillColor: '#ff6b00', fillOpacity: 0.55 })
            .bindPopup(`<b>🔥 Active fire</b><br><small>${f.bright ? 'Brightness ' + Math.round(f.bright) + 'K · ' : ''}conf ${esc(String(f.conf))}<br>${esc(f.date || '')}</small>`).addTo(lg);
        });
      } },
    { id: 'instability', label: 'Country Instability (AI)', icon: '⚠', group: 'Hazards', live: true, refresh: 1800000,
      load: async (lg) => {
        const d = await getJSON('/api/intel/instability');
        (d.countries || []).forEach((c) => {
          if (typeof c.lat !== 'number' || typeof c.lon !== 'number') return;
          const s = c.score || 0;
          const col = s >= 75 ? '#ff453a' : s >= 50 ? '#ff8c00' : s >= 30 ? '#ffd23f' : '#2bd97c';
          const tr = c.trend === 'rising' ? '▲' : c.trend === 'easing' ? '▼' : '▬';
          L.circleMarker([c.lat, c.lon], { renderer: r(), radius: 6 + s / 10, weight: 1.5, color: col, fillColor: col, fillOpacity: 0.35 })
            .bindPopup(`<b>${esc(c.country)}</b> — <span style="color:${col}">CII ${s}</span> ${tr}<br>${esc(c.drivers || '')}<br><small>📈 ${esc(c.marketAngle || '')}</small>`).addTo(lg);
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
    { id: 'financialCenters', label: 'Financial Centers', icon: '💵', group: 'Markets',
      load: (lg) => DATA.financialCenters.forEach(([n, la, lo, d]) => diamond(la, lo, '#ffd23f', `<b>💵 ${esc(n)}</b><br>${esc(d)}`).addTo(lg)) },
    { id: 'commodityPorts', label: 'Commodity Ports', icon: '⚓', group: 'Markets',
      load: (lg) => DATA.commodityPorts.forEach(([n, la, lo, d]) => diamond(la, lo, '#e8a87c', `<b>⚓ ${esc(n)}</b><br>${esc(d)}`).addTo(lg)) },
    // Geopolitics & defense
    { id: 'militaryBases', label: 'Military Bases', icon: '🪖', group: 'Geopolitics',
      load: (lg) => DATA.militaryBases.forEach(([n, la, lo, d]) => diamond(la, lo, '#ff8c5a', `<b>🪖 ${esc(n)}</b><br>${esc(d)}`).addTo(lg)) },
    { id: 'criticalMinerals', label: 'Critical Minerals', icon: '💎', group: 'Geopolitics',
      load: (lg) => DATA.criticalMinerals.forEach(([n, la, lo, d]) => diamond(la, lo, '#6fd3c9', `<b>💎 ${esc(n)}</b><br>${esc(d)}`).addTo(lg)) },
    { id: 'refugeeHotspots', label: 'Displacement', icon: '👥', group: 'Geopolitics',
      load: (lg) => DATA.refugeeHotspots.forEach(([n, la, lo, d]) => diamond(la, lo, '#ff6b9d', `<b>👥 ${esc(n)}</b><br>${esc(d)}`).addTo(lg)) },
    { id: 'conflictZones', label: 'Conflict Zones', icon: '⚔', group: 'Geopolitics',
      load: (lg) => DATA.conflictZones.forEach(([n, la, lo, d]) => { diamond(la, lo, '#ff453a', `<b>⚔ ${esc(n)}</b><br>${esc(d)}`).addTo(lg); L.circle([la, lo], { radius: 220000, color: '#ff453a', weight: 1, fillColor: '#ff453a', fillOpacity: 0.08, interactive: false }).addTo(lg); }) },
    { id: 'sanctions', label: 'Sanctioned States', icon: '🚫', group: 'Geopolitics',
      load: (lg) => DATA.sanctions.forEach(([n, la, lo, d]) => diamond(la, lo, '#f0883e', `<b>🚫 ${esc(n)}</b><br>${esc(d)}`).addTo(lg)) },
    { id: 'diseaseOutbreaks', label: 'Disease Outbreaks', icon: '🦠', group: 'Hazards',
      load: (lg) => DATA.diseaseOutbreaks.forEach(([n, la, lo, d]) => diamond(la, lo, '#a3e635', `<b>🦠 ${esc(n)}</b><br>${esc(d)}`).addTo(lg)) },
    // Tech & infrastructure
    { id: 'techHQs', label: 'Tech HQs', icon: '🏢', group: 'Infrastructure',
      load: (lg) => DATA.techHQs.forEach(([n, la, lo, d]) => diamond(la, lo, '#7aa2f7', `<b>🏢 ${esc(n)}</b><br>${esc(d)}`).addTo(lg)) },
    { id: 'cloudRegions', label: 'Cloud Regions', icon: '☁', group: 'Infrastructure',
      load: (lg) => DATA.cloudRegions.forEach(([n, la, lo, d]) => diamond(la, lo, '#9ece6a', `<b>☁ ${esc(n)}</b><br>${esc(d)}`).addTo(lg)) },
    { id: 'startupHubs', label: 'Startup Hubs', icon: '🚀', group: 'Markets',
      load: (lg) => DATA.startupHubs.forEach(([n, la, lo, d]) => diamond(la, lo, '#bb9af7', `<b>🚀 ${esc(n)}</b><br>${esc(d)}`).addTo(lg)) },
    { id: 'gccInvestments', label: 'GCC Sovereign Funds', icon: '🛢', group: 'Markets',
      load: (lg) => DATA.gccInvestments.forEach(([n, la, lo, d]) => diamond(la, lo, '#e0af68', `<b>🛢 ${esc(n)}</b><br>${esc(d)}`).addTo(lg)) },
    { id: 'economicCenters', label: 'Economic Centers', icon: '🌆', group: 'Markets',
      load: (lg) => DATA.economicCenters.forEach(([n, la, lo, d]) => diamond(la, lo, '#f7c948', `<b>🌆 ${esc(n)}</b><br>${esc(d)}`).addTo(lg)) },
    { id: 'internetExchanges', label: 'Internet Exchanges', icon: '🌐', group: 'Infrastructure',
      load: (lg) => DATA.internetExchanges.forEach(([n, la, lo, d]) => diamond(la, lo, '#73daca', `<b>🌐 ${esc(n)}</b><br>${esc(d)}`).addTo(lg)) },
    { id: 'gpsJamming', label: 'GPS Jamming', icon: '📡', group: 'Geopolitics',
      load: (lg) => DATA.gpsJamming.forEach(([n, la, lo, d]) => { diamond(la, lo, '#f0883e', `<b>📡 ${esc(n)}</b><br>${esc(d)}`).addTo(lg); L.circle([la, lo], { radius: 300000, color: '#f0883e', weight: 1, fillColor: '#f0883e', fillOpacity: 0.06, interactive: false }).addTo(lg); }) },
    // Line layers
    { id: 'tradeRoutes', label: 'Trade Routes', icon: '🚢', group: 'Routes',
      load: (lg) => lines(lg, LINES.tradeRoutes, '#45c8dc', 2) },
    { id: 'cables', label: 'Undersea Cables', icon: '🔌', group: 'Routes',
      load: (lg) => lines(lg, LINES.cables, '#7aa2f7', 1.5, '4 3') },
    { id: 'pipelines', label: 'Pipelines', icon: '🛢', group: 'Routes',
      load: (lg) => lines(lg, LINES.pipelines, '#ffa028', 2, '1 4') },
  ];

  function lines(lg, set, color, weight, dash) {
    set.forEach(([name, path, desc]) => {
      L.polyline(path, { color, weight, opacity: 0.7, dashArray: dash || null }).bindPopup(`<b>${esc(name)}</b><br>${esc(desc)}`).addTo(lg);
    });
  }

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
        const groupsOrder = ['Hazards', 'Movement', 'Routes', 'Geopolitics', 'Infrastructure', 'Markets', 'Overlays'];
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
