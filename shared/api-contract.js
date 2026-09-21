(() => {
  'use strict';

  const ROUTES = [
    { path: '/api/market', methods: ['GET'], category: 'market', frontend: true },
    { path: '/api/quote', methods: ['GET'], category: 'market', frontend: true },
    { path: '/api/profile', methods: ['GET'], category: 'market', frontend: true },
    { path: '/api/metrics', methods: ['GET'], category: 'market', frontend: true },
    { path: '/api/news', methods: ['GET'], category: 'market', frontend: true },
    { path: '/api/search', methods: ['GET'], category: 'market', frontend: true },
    { path: '/api/ticker', methods: ['GET'], category: 'market', frontend: true },
    { path: '/api/chart', methods: ['GET'], category: 'market', frontend: true },
    { path: '/api/stocks/stream', methods: ['GET'], category: 'market', frontend: true, upgradeRequired: true },
    { path: '/api/intel/news', methods: ['GET'], category: 'intel', frontend: true },
    { path: '/api/intel/analysis', methods: ['GET'], category: 'intel', frontend: true },
    { path: '/api/intel/company', methods: ['GET'], category: 'intel', frontend: true },
    { path: '/api/intel/supplychain', methods: ['GET'], category: 'intel', frontend: true }, // deprecated, see DEPRECATED_ALIASES
    { path: '/api/nexus/registry', methods: ['GET'], category: 'nexus', frontend: true },
    { path: '/api/nexus/company', methods: ['GET'], category: 'nexus', frontend: true },
    { path: '/api/nexus/relationships', methods: ['GET'], category: 'nexus', frontend: true },
    { path: '/api/nexus/graph', methods: ['GET'], category: 'nexus', frontend: true },
    { path: '/api/intel/deepdive', methods: ['GET'], category: 'intel', frontend: true },
    { path: '/api/intel/chat', methods: ['POST'], category: 'intel', frontend: true },
    { path: '/api/intel/report', methods: ['GET'], category: 'intel', frontend: true },
    { path: '/api/intel/situation', methods: ['GET'], category: 'intel', frontend: true },
    { path: '/api/intel/instability', methods: ['GET'], category: 'intel', frontend: true },
    { path: '/api/intel/candles', methods: ['GET'], category: 'intel', frontend: true },
    { path: '/api/intel/alerts', methods: ['GET'], category: 'intel', frontend: true },
    { path: '/api/intel/priceaction', methods: ['GET'], category: 'intel', frontend: true },
    { path: '/api/map/layers', methods: ['GET'], category: 'map', frontend: true },
    { path: '/api/map/atlas', methods: ['GET'], category: 'map', frontend: true },
    { path: '/api/map/entities', methods: ['GET'], category: 'map', frontend: true },
    { path: '/api/map/entity', methods: ['GET'], category: 'map', frontend: true },
    { path: '/api/map/search', methods: ['GET'], category: 'map', frontend: true },
    { path: '/api/map/geoevents', methods: ['GET'], category: 'map', frontend: true },
    { path: '/api/map/conflict', methods: ['GET'], category: 'map', frontend: true },
    { path: '/api/map/disease', methods: ['GET'], category: 'map', frontend: true },
    { path: '/api/map/gpsjam', methods: ['GET'], category: 'map', frontend: true },
    { path: '/api/map/earthquakes', methods: ['GET'], category: 'map', frontend: true },
    { path: '/api/map/events', methods: ['GET'], category: 'map', frontend: true },
    { path: '/api/map/weather', methods: ['GET'], category: 'map', frontend: true },
    { path: '/api/map/fires', methods: ['GET'], category: 'map', frontend: true },
    { path: '/api/map/webcams-live', methods: ['GET'], category: 'map', frontend: true },
    { path: '/api/map/flights', methods: ['GET'], category: 'map', frontend: true },
    { path: '/api/map/overpass', methods: ['GET'], category: 'map' },
    { path: '/api/map/infrastructure', methods: ['GET'], category: 'map', frontend: true },
    { path: '/api/sentiment/market', methods: ['GET'], category: 'intel', frontend: true },
    { path: '/api/macro/shock', methods: ['GET'], category: 'intel', frontend: true },
    { path: '/api/vapid-public-key', methods: ['GET'], category: 'push', frontend: true },
    { path: '/api/subscribe', methods: ['POST'], category: 'push', frontend: true },
    { path: '/api/unsubscribe', methods: ['POST'], category: 'push', frontend: true },
    { path: '/api/test-push', methods: ['POST'], category: 'push', protected: true },
    { path: '/api/ai-status', methods: ['GET'], category: 'diagnostics', protected: true },
    { path: '/api/data-status', methods: ['GET'], category: 'diagnostics', protected: true },
    { path: '/api/debug/providers', methods: ['GET'], category: 'diagnostics', protected: true },
  ];

  const DEPRECATED_ALIASES = {
    '/api/intel/candle': '/api/intel/candles',
    '/api/sentiment/twitter': '/api/sentiment/market',
    '/api/intel/supplychain': '/api/nexus/company',
  };

  const routeMap = new Map(ROUTES.map((route) => [route.path, route]));

  function normalizePathname(pathname) {
    if (!pathname) return '/';
    const trimmed = String(pathname).trim();
    if (trimmed.length > 1 && trimmed.endsWith('/')) return trimmed.slice(0, -1);
    return trimmed || '/';
  }

  function canonicalPath(pathname) {
    const normalized = normalizePathname(pathname);
    return DEPRECATED_ALIASES[normalized] || normalized;
  }

  function getRoute(pathname) {
    return routeMap.get(canonicalPath(pathname)) || null;
  }

  function isKnownApiPath(pathname) {
    return Boolean(getRoute(pathname));
  }

  function getAllowedMethods(pathname) {
    const route = getRoute(pathname);
    return route ? route.methods.slice() : [];
  }

  function isProtectedRoute(pathname) {
    const route = getRoute(pathname);
    return Boolean(route && route.protected);
  }

  function isFrontendRoute(pathname) {
    const route = getRoute(pathname);
    return Boolean(route && route.frontend);
  }

  function isDeprecatedAlias(pathname) {
    return Object.prototype.hasOwnProperty.call(DEPRECATED_ALIASES, normalizePathname(pathname));
  }

  function buildError(status, code, message, extras) {
    const payload = {
      error: true,
      code,
      status,
      message,
    };
    return extras ? Object.assign(payload, extras) : payload;
  }

  const api = {
    ROUTES,
    DEPRECATED_ALIASES,
    normalizePathname,
    canonicalPath,
    getRoute,
    isKnownApiPath,
    getAllowedMethods,
    isProtectedRoute,
    isFrontendRoute,
    isDeprecatedAlias,
    buildError,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalThis.MarketTerminalContract = api;
})();
