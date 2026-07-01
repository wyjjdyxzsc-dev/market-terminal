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
      maxZoom: 10,
      zoomControl: true,
      attributionControl: false,
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      subdomains: 'abcd',
      maxZoom: 19,
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
