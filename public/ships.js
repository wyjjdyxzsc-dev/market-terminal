'use strict';

/* ════════════════════════════════════════════════════════════════
   Market Terminal — Leaflet base map for GLOBAL INTEL · LIVE DATA
   Initialises the Leaflet map on #liveMap and fires 'mapready'
   so mapintel.js can attach its overlay layers (earthquakes,
   conflict zones, fires, GPS jamming, flights, webcams, etc.).
   Ships have been removed; this file is now a pure map bootstrap.
   ════════════════════════════════════════════════════════════════ */
(() => {
  let map = null;
  let initialized = false;

  function init() {
    if (initialized) return;
    const el = document.getElementById('liveMap');
    if (!el || typeof L === 'undefined') return;
    initialized = true;

    map = L.map(el, {
      center: [20, 10],
      zoom: 2,
      minZoom: 1,
      maxZoom: 12,
      zoomControl: true,
      attributionControl: true,
      tap: true,
    });

    // MT2-4 ATLAS: keyless OpenStreetMap tiles (ODbL; attribution required and shown) with a
    // CSS dark treatment in the QUARTZ palette. The previous CARTO dark tiles now require an
    // API key and rendered an "API KEY REQUIRED" watermark (B-015).
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      className: 'map-tiles-dark',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
    }).addTo(map);

    // Let mapintel.js attach its overlay layers
    document.dispatchEvent(new CustomEvent('mapready', { detail: { map } }));
  }

  // Open / show the map (called by intel.js)
  window.LiveMap = {
    open() {
      init();
      if (map) setTimeout(() => map.invalidateSize(), 60);
    },
  };
})();
