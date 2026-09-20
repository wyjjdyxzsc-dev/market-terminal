(() => {
  'use strict';

  // ─────────────────────────────────────────────────────────────────────────
  // MT2-4 ATLAS — canonical geographic market-intelligence objects shared by
  // Express, the Worker and the browser. Pure: no I/O, no DOM, no Leaflet.
  //
  //   GeoEntity      a sourced place/asset/facility (validated; UNVERIFIED never authoritative)
  //   MapLayer       registry entry with data source, licence, freshness, coverage truth
  //   CompanyGeoLink company ↔ location, keyed by the TWINCORE canonical instrument identity
  //   GeoEvent       a time-bounded happening at a location (WORLDWIRE will feed this later)
  //
  // The datasets themselves live in shared/atlas-snapshot.js (generated, sourced) and are
  // turned into entities here. NEXUS attaches relationships to these ids later; nothing in
  // this module assumes the relationship graph exists.
  // ─────────────────────────────────────────────────────────────────────────

  const ATLAS_SCHEMA_VERSION = '2026-09-21a';
  const MAX_ENTITIES_PER_RESPONSE = 2500;

  const marketCore = (typeof module !== 'undefined' && module.exports)
    ? require('./market-core.js')
    : globalThis.MarketTerminalMarket;

  const GEO_ENTITY_TYPES = Object.freeze([
    'COMPANY_HQ', 'OFFICE', 'FACTORY', 'FAB', 'REFINERY', 'MINE', 'PORT', 'AIRPORT', 'DATA_CENTER',
    'POWER_PLANT', 'NUCLEAR_PLANT', 'PIPELINE', 'LNG_TERMINAL', 'WAREHOUSE', 'LOGISTICS_HUB', 'SHIPYARD',
    'MILITARY_EVENT', 'WAR_EVENT', 'NATURAL_DISASTER', 'SHIPPING_CHOKEPOINT', 'SUBSEA_CABLE',
    'ENERGY_INFRASTRUCTURE', 'OTHER_CRITICAL_INFRASTRUCTURE',
    // Market context objects (ATLAS additions to the brief's taxonomy)
    'EXCHANGE', 'CENTRAL_BANK', 'FINANCIAL_CENTER', 'SPACEPORT',
  ]);

  const CONFIDENCE = Object.freeze({ HIGH: 'HIGH', MEDIUM: 'MEDIUM', LOW: 'LOW', UNVERIFIED: 'UNVERIFIED' });
  const CONFIDENCE_RANK = Object.freeze({ HIGH: 3, MEDIUM: 2, LOW: 1, UNVERIFIED: 0 });

  const RELATION_TYPES = Object.freeze([
    'HEADQUARTERS', 'MANUFACTURING', 'WAREHOUSE', 'DATA_CENTER', 'REFINERY', 'MINE', 'PORT_DEPENDENCY', 'OFFICE', 'OTHER_OPERATION',
  ]);

  const EVENT_CATEGORIES = Object.freeze([
    'WAR', 'MILITARY', 'SANCTIONS', 'PORT_DISRUPTION', 'PIPELINE_DISRUPTION', 'CYBER', 'EARTHQUAKE', 'STORM', 'FLOOD',
    'WILDFIRE', 'INDUSTRIAL_ACCIDENT', 'VOLCANO', 'DROUGHT', 'OTHER',
  ]);
  const EVENT_STATUS = Object.freeze({ ACTIVE: 'active', STALE: 'stale', RESOLVED: 'resolved' });

  // ───────────────────────── helpers ─────────────────────────

  // null/''/booleans coerce to 0 via Number(); a coordinate must be an actual number or numeric string.
  const isFiniteNum = (v) => (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '')) && Number.isFinite(Number(v));
  const r4 = (n) => Math.round(Number(n) * 1e4) / 1e4;
  function slug(text) {
    return String(text || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  }
  function isoOrNull(value) {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.valueOf()) ? null : d.toISOString();
  }
  function validCoordinate(lat, lon) {
    return isFiniteNum(lat) && isFiniteNum(lon) && Math.abs(Number(lat)) <= 90 && Math.abs(Number(lon)) <= 180;
  }

  // ───────────────────────── evidence ─────────────────────────

  /** Normalise a source record. A source needs at least a name and a url or datasetId. */
  function normalizeEvidence(input) {
    if (!input || typeof input !== 'object') return null;
    const name = String(input.source || input.name || '').trim();
    const sourceUrl = String(input.sourceUrl || input.url || '').trim();
    const datasetId = String(input.datasetId || '').trim();
    if (!name || (!sourceUrl && !datasetId)) return null;
    if (sourceUrl && !/^https?:\/\//i.test(sourceUrl)) return null;
    const confidence = CONFIDENCE[String(input.confidence || '').toUpperCase()] || CONFIDENCE.UNVERIFIED;
    return Object.freeze({
      source: name,
      sourceUrl,
      datasetId,
      license: String(input.license || ''),
      observedAt: isoOrNull(input.observedAt),
      lastVerified: isoOrNull(input.lastVerified),
      confidence,
      note: String(input.note || ''),
    });
  }

  function bestConfidence(evidence) {
    let best = CONFIDENCE.UNVERIFIED;
    for (const e of evidence || []) if (CONFIDENCE_RANK[e.confidence] > CONFIDENCE_RANK[best]) best = e.confidence;
    return best;
  }

  // ───────────────────────── GeoEntity ─────────────────────────

  function entityId(type, name, lat, lon) {
    return `${String(type).toLowerCase()}:${slug(name)}:${r4(lat)},${r4(lon)}`;
  }

  /**
   * Validate a GeoEntity candidate. Returns { ok, errors }. Rules the brief requires:
   * impossible coordinates fail; a type outside the taxonomy fails; an entity without any
   * source evidence fails (nothing displayed can be unsourced).
   */
  function validateGeoEntity(candidate) {
    const errors = [];
    const c = candidate && typeof candidate === 'object' ? candidate : {};
    if (!GEO_ENTITY_TYPES.includes(c.type)) errors.push(`type must be one of the ATLAS taxonomy (got ${c.type})`);
    if (!String(c.name || '').trim()) errors.push('name is required');
    if (!validCoordinate(c.lat, c.lon)) errors.push(`impossible coordinate lat=${c.lat} lon=${c.lon}`);
    const evidence = (Array.isArray(c.sourceEvidence) ? c.sourceEvidence : []).map(normalizeEvidence).filter(Boolean);
    if (!evidence.length) errors.push('at least one source (name + url or datasetId) is required');
    return { ok: errors.length === 0, errors, evidence };
  }

  /** Build a frozen GeoEntity or throw. `marketContext` is a list of TWINCORE market ids. */
  function createGeoEntity(input) {
    const v = validateGeoEntity(input);
    if (!v.ok) throw new Error(`GeoEntity rejected: ${v.errors.join('; ')}`);
    const confidence = bestConfidence(v.evidence);
    const lastVerified = v.evidence.map((e) => e.lastVerified).filter(Boolean).sort().pop() || null;
    return Object.freeze({
      id: String(input.id || entityId(input.type, input.name, input.lat, input.lon)),
      type: input.type,
      name: String(input.name).trim(),
      lat: r4(input.lat),
      lon: r4(input.lon),
      country: String(input.country || ''),
      countryCode: String(input.countryCode || '').toUpperCase(),
      region: String(input.region || ''),
      layer: String(input.layer || ''),
      marketContext: Object.freeze([...new Set((input.marketContext || []).map((m) => marketCore.resolveMarketId(m, null)).filter(Boolean))]),
      sourceEvidence: Object.freeze(v.evidence),
      confidence,
      authoritative: confidence !== CONFIDENCE.UNVERIFIED,
      lastVerified,
      attributes: Object.freeze({ ...(input.attributes || {}) }),
    });
  }

  // ───────────────────────── CompanyGeoLink ─────────────────────────

  /**
   * A company ↔ location link. `instrumentIdentity` MUST be a TWINCORE canonical id
   * (`IN:NSE:RELIANCE`), never a provider ticker (`RELIANCE.NS`).
   */
  function validateCompanyGeoLink(link, options = {}) {
    const errors = [];
    const l = link && typeof link === 'object' ? link : {};
    if (!String(l.companyId || '').trim()) errors.push('companyId is required');
    if (!String(l.locationId || '').trim()) errors.push('locationId is required');
    if (!RELATION_TYPES.includes(l.relationType)) errors.push(`relationType must be one of ${RELATION_TYPES.join('|')}`);
    const identity = String(l.instrumentIdentity || '').trim();
    if (identity) {
      const parsed = marketCore.parseInstrument(identity);
      if (!parsed || parsed.canonical !== identity.toUpperCase()) {
        errors.push(`instrumentIdentity must be canonical MARKET:EXCHANGE:SYMBOL (got ${identity})`);
      } else if (options.expectedMarket && parsed.market !== marketCore.resolveMarketId(options.expectedMarket)) {
        errors.push(`instrumentIdentity ${identity} belongs to ${parsed.market}, not ${options.expectedMarket}`);
      }
    }
    if (!String(l.source || '').trim()) errors.push('source is required');
    if (!CONFIDENCE[String(l.confidence || '').toUpperCase()]) errors.push('confidence band is required');
    return { ok: errors.length === 0, errors };
  }

  function createCompanyGeoLink(input, options) {
    const v = validateCompanyGeoLink(input, options);
    if (!v.ok) throw new Error(`CompanyGeoLink rejected: ${v.errors.join('; ')}`);
    return Object.freeze({
      companyId: String(input.companyId),
      instrumentIdentity: input.instrumentIdentity ? String(input.instrumentIdentity).toUpperCase() : '',
      locationId: String(input.locationId),
      relationType: input.relationType,
      source: String(input.source),
      sourceUrl: String(input.sourceUrl || ''),
      confidence: String(input.confidence).toUpperCase(),
    });
  }

  // ───────────────────────── GeoEvent ─────────────────────────

  const EVENT_FRESHNESS_MS = Object.freeze({
    EARTHQUAKE: 7 * 86_400_000, STORM: 3 * 86_400_000, FLOOD: 7 * 86_400_000, WILDFIRE: 3 * 86_400_000,
    VOLCANO: 14 * 86_400_000, DROUGHT: 30 * 86_400_000, WAR: 3 * 86_400_000, MILITARY: 3 * 86_400_000,
    SANCTIONS: 30 * 86_400_000, PORT_DISRUPTION: 7 * 86_400_000, PIPELINE_DISRUPTION: 7 * 86_400_000,
    CYBER: 7 * 86_400_000, INDUSTRIAL_ACCIDENT: 7 * 86_400_000, OTHER: 7 * 86_400_000,
  });

  /** An event is ACTIVE only while its `updatedAt` is inside the category freshness window. */
  function classifyEventStatus(event, now = Date.now()) {
    if (event.status === EVENT_STATUS.RESOLVED || event.closed) return EVENT_STATUS.RESOLVED;
    const updated = Date.parse(event.updatedAt || event.startedAt || '');
    if (!Number.isFinite(updated)) return EVENT_STATUS.STALE;
    const window = EVENT_FRESHNESS_MS[event.type] || EVENT_FRESHNESS_MS.OTHER;
    return now - updated <= window ? EVENT_STATUS.ACTIVE : EVENT_STATUS.STALE;
  }

  function createGeoEvent(input, now = Date.now()) {
    const errors = [];
    const type = EVENT_CATEGORIES.includes(input.type) ? input.type : null;
    if (!type) errors.push(`type must be one of ${EVENT_CATEGORIES.join('|')}`);
    if (!String(input.title || '').trim()) errors.push('title is required');
    const loc = input.location || {};
    if (!validCoordinate(loc.lat, loc.lon)) errors.push('impossible event coordinate');
    const evidence = (input.sourceEvidence || []).map(normalizeEvidence).filter(Boolean);
    if (!evidence.length) errors.push('event needs source evidence');
    if (errors.length) throw new Error(`GeoEvent rejected: ${errors.join('; ')}`);
    const startedAt = isoOrNull(input.startedAt);
    const updatedAt = isoOrNull(input.updatedAt) || startedAt;
    const base = { type, startedAt, updatedAt, status: input.status, closed: input.closed };
    return Object.freeze({
      id: String(input.id || `event:${type.toLowerCase()}:${slug(input.title)}:${r4(loc.lat)},${r4(loc.lon)}`),
      type,
      title: String(input.title).trim(),
      location: Object.freeze({ lat: r4(loc.lat), lon: r4(loc.lon), name: String(loc.name || '') }),
      startedAt,
      updatedAt,
      status: classifyEventStatus(base, now),
      severity: String(input.severity || 'unknown'),
      categories: Object.freeze([...new Set([type, ...(input.categories || []).filter((c) => EVENT_CATEGORIES.includes(c))])]),
      sourceEvidence: Object.freeze(evidence),
      confidence: bestConfidence(evidence),
      affectedGeoEntities: Object.freeze([...(input.affectedGeoEntities || [])].map(String)),
      attributes: Object.freeze({ ...(input.attributes || {}) }),
    });
  }

  // ───────────────────────── MapLayer registry ─────────────────────────

  const LAYER_CATEGORIES = Object.freeze(['MARKETS', 'INDUSTRY', 'ENERGY', 'MARITIME', 'EVENTS']);

  const layer = (id, name, category, opts) => Object.freeze({
    id, name, category,
    enabledByDefault: Boolean(opts.enabledByDefault),
    dataSource: Object.freeze(opts.dataSource),
    freshness: opts.freshness,              // 'snapshot' | 'live' | 'none'
    geographicScope: opts.geographicScope,   // 'global' | 'US' | …
    entityTypes: Object.freeze(opts.entityTypes || []),
    coverage: Object.freeze(opts.coverage),  // { complete: boolean, note }
    renders: opts.renders !== false,         // false = registry entry only, nothing drawn
    marketAware: Boolean(opts.marketAware),
  });

  const SRC_WD = { name: 'Wikidata', url: 'https://www.wikidata.org', license: 'CC0 1.0' };
  const SRC_NE = { name: 'Natural Earth 10m', url: 'https://www.naturalearthdata.com', license: 'Public domain' };
  const SRC_GPPD = { name: 'WRI Global Power Plant Database v1.3', url: 'https://datasets.wri.org/dataset/globalpowerplantdatabase', license: 'CC BY 4.0' };

  const LAYERS = Object.freeze([
    layer('companies', 'Public companies', 'MARKETS', { enabledByDefault: true, dataSource: SRC_WD, freshness: 'snapshot', geographicScope: 'global', entityTypes: ['COMPANY_HQ'], marketAware: true,
      coverage: { complete: false, note: 'Headquarters of companies that Wikidata records as listed on NSE, BSE, NYSE or Nasdaq with a located HQ. Coverage is measured per market in the payload; NEXUS will reconcile against the security universe.' } }),
    layer('exchanges', 'Exchanges', 'MARKETS', { enabledByDefault: true, dataSource: SRC_WD, freshness: 'snapshot', geographicScope: 'global', entityTypes: ['EXCHANGE'],
      coverage: { complete: false, note: 'Sixteen major exchanges verified against Wikidata; UNVERIFIED entries are hidden.' } }),
    layer('financial-centres', 'Central banks', 'MARKETS', { enabledByDefault: false, dataSource: SRC_WD, freshness: 'snapshot', geographicScope: 'global', entityTypes: ['CENTRAL_BANK', 'FINANCIAL_CENTER'],
      coverage: { complete: false, note: 'Eight central banks verified against Wikidata.' } }),
    layer('ports', 'Ports', 'INDUSTRY', { enabledByDefault: false, dataSource: SRC_NE, freshness: 'snapshot', geographicScope: 'global', entityTypes: ['PORT'],
      coverage: { complete: false, note: 'Natural Earth 10m port points (~1,100). Not a throughput dataset.' } }),
    layer('airports', 'Airports', 'INDUSTRY', { enabledByDefault: false, dataSource: SRC_NE, freshness: 'snapshot', geographicScope: 'global', entityTypes: ['AIRPORT'],
      coverage: { complete: false, note: 'Natural Earth 10m major/mid airports.' } }),
    layer('industry-sites', 'Factories · fabs · refineries · mines · data centres', 'INDUSTRY', { enabledByDefault: false, dataSource: { name: 'none ingested', url: '', license: '' }, freshness: 'none', geographicScope: 'global', entityTypes: ['FACTORY', 'FAB', 'REFINERY', 'MINE', 'DATA_CENTER', 'WAREHOUSE', 'LOGISTICS_HUB', 'SHIPYARD'], renders: false,
      coverage: { complete: false, note: 'Architecture only. No licence-compatible open dataset with facility coordinates was verified during ATLAS (Global Energy Monitor requires a data-request form; data-centre hubs are towns, not facilities). NEXUS ingests facilities with evidence.' } }),
    layer('power', 'Power plants (≥1 GW)', 'ENERGY', { enabledByDefault: false, dataSource: SRC_GPPD, freshness: 'snapshot', geographicScope: 'global', entityTypes: ['POWER_PLANT'],
      coverage: { complete: false, note: 'WRI GPPD v1.3 (2021) plants ≥1,000 MW. Capacity and ownership are as published; no generation is inferred.' } }),
    layer('nuclear', 'Nuclear plants', 'ENERGY', { enabledByDefault: true, dataSource: SRC_GPPD, freshness: 'snapshot', geographicScope: 'global', entityTypes: ['NUCLEAR_PLANT'],
      coverage: { complete: false, note: 'All 195 nuclear plants in WRI GPPD v1.3. Operational status is not in this dataset.' } }),
    layer('energy-infrastructure', 'Pipelines · LNG · refineries', 'ENERGY', { enabledByDefault: false, dataSource: { name: 'none ingested', url: '', license: '' }, freshness: 'none', geographicScope: 'global', entityTypes: ['PIPELINE', 'LNG_TERMINAL', 'REFINERY', 'ENERGY_INFRASTRUCTURE'], renders: false,
      coverage: { complete: false, note: 'Architecture only. The pre-ATLAS hand-drawn pipeline paths were not sourced and are retired (D-010). Global Energy Monitor trackers (CC BY) need a data request before ingestion.' } }),
    layer('chokepoints', 'Shipping chokepoints', 'MARITIME', { enabledByDefault: true, dataSource: SRC_WD, freshness: 'snapshot', geographicScope: 'global', entityTypes: ['SHIPPING_CHOKEPOINT'],
      coverage: { complete: false, note: 'Ten canonical chokepoints verified against Wikidata. No traffic or exposure values are attached.' } }),
    layer('subsea-cables', 'Subsea cables', 'MARITIME', { enabledByDefault: false, dataSource: { name: 'none ingested', url: '', license: '' }, freshness: 'none', geographicScope: 'global', entityTypes: ['SUBSEA_CABLE'], renders: false,
      coverage: { complete: false, note: 'Architecture only. TeleGeography cable geometry is CC BY-NC-SA (non-commercial) and was not ingested; the pre-ATLAS "-ish" cable paths were invented and are retired (D-010). OSM (ODbL) extraction is deferred.' } }),
    layer('spaceports', 'Spaceports', 'INDUSTRY', { enabledByDefault: false, dataSource: SRC_WD, freshness: 'snapshot', geographicScope: 'global', entityTypes: ['SPACEPORT'],
      coverage: { complete: false, note: 'Nine launch sites verified against Wikidata.' } }),
    layer('events', 'Events', 'EVENTS', { enabledByDefault: true, dataSource: { name: 'USGS · NASA EONET · NWS · GDELT (via /api/map/*)', url: 'https://earthquake.usgs.gov', license: 'Public domain / public feeds' }, freshness: 'live', geographicScope: 'global', entityTypes: ['NATURAL_DISASTER', 'WAR_EVENT', 'MILITARY_EVENT'],
      coverage: { complete: false, note: 'Earthquakes (USGS), natural events (EONET), US weather alerts (NWS) and conflict-news clusters (GDELT). Not a complete incident feed; WORLDWIRE becomes the collector.' } }),
  ]);

  function layerById(id) {
    return LAYERS.find((l) => l.id === id) || null;
  }

  // ───────────────────────── geometry / filtering ─────────────────────────

  /** bbox = [west, south, east, north]; handles antimeridian-crossing boxes (west > east). */
  function parseBbox(input) {
    const parts = Array.isArray(input) ? input : String(input || '').split(',');
    if (parts.length !== 4) return null;
    const [w, s, e, n] = parts.map(Number);
    if (![w, s, e, n].every(Number.isFinite)) return null;
    if (Math.abs(s) > 90 || Math.abs(n) > 90 || Math.abs(w) > 180 || Math.abs(e) > 180 || s > n) return null;
    return { west: w, south: s, east: e, north: n };
  }

  function inBbox(point, bbox) {
    if (!bbox) return true;
    if (point.lat < bbox.south || point.lat > bbox.north) return false;
    if (bbox.west <= bbox.east) return point.lon >= bbox.west && point.lon <= bbox.east;
    return point.lon >= bbox.west || point.lon <= bbox.east; // crosses the antimeridian
  }

  /** Quantise a bbox so cache keys do not explode with every pixel of panning. */
  function quantizeBbox(bbox, step = 5) {
    if (!bbox) return 'world';
    const q = (v) => Math.floor(v / step) * step;
    const qc = (v) => Math.ceil(v / step) * step;
    return `${q(bbox.west)},${q(bbox.south)},${qc(bbox.east)},${qc(bbox.north)}`;
  }

  /**
   * Relevance of an entity to the active market. Market mode changes emphasis, never
   * geography: 'primary' entities are listed first and drawn stronger; nothing is hidden.
   */
  function marketRelevance(entity, marketId) {
    const id = marketCore.resolveMarketId(marketId);
    if (!entity) return 'global';
    if ((entity.marketContext || []).includes(id)) return 'primary';
    const cc = String(entity.countryCode || '').toUpperCase();
    if ((id === 'US' && cc === 'US') || (id === 'IN' && cc === 'IN')) return 'primary';
    return 'global';
  }

  /** Filter + rank + bound entities for one response. Hidden (UNVERIFIED) entities are dropped unless asked for. */
  function filterEntities(entities, options = {}) {
    const bbox = options.bbox ? (typeof options.bbox === 'string' || Array.isArray(options.bbox) ? parseBbox(options.bbox) : options.bbox) : null;
    const types = options.types ? new Set(options.types) : null;
    const layerId = options.layer || null;
    const market = options.market ? marketCore.resolveMarketId(options.market) : null;
    const limit = Math.max(1, Math.min(Number(options.limit) || MAX_ENTITIES_PER_RESPONSE, MAX_ENTITIES_PER_RESPONSE));
    const includeUnverified = Boolean(options.includeUnverified);

    const matched = [];
    for (const e of entities) {
      if (layerId && e.layer !== layerId) continue;
      if (types && !types.has(e.type)) continue;
      if (!includeUnverified && !e.authoritative) continue;
      if (!inBbox(e, bbox)) continue;
      matched.push(e);
    }
    if (market) {
      matched.sort((a, b) => {
        const ra = marketRelevance(a, market) === 'primary' ? 0 : 1;
        const rb = marketRelevance(b, market) === 'primary' ? 0 : 1;
        return ra - rb || (CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence]) || a.name.localeCompare(b.name);
      });
    }
    return {
      total: matched.length,
      truncated: matched.length > limit,
      entities: matched.slice(0, limit).map((e) => (market ? { ...e, relevance: marketRelevance(e, market) } : e)),
    };
  }

  // ───────────────────────── clustering ─────────────────────────

  /**
   * Grid clustering in Web-Mercator pixel space. Pure and cheap: O(n). Returns clusters
   * ({ lat, lon, count, ids[] }) for cells with ≥ 2 points and singletons otherwise, so the
   * renderer never has to place more than (viewport px / cellPx)² markers.
   */
  function clusterPoints(points, zoom, cellPx = 48) {
    const scale = 256 * Math.pow(2, zoom);
    const cells = new Map();
    for (const p of points) {
      const x = ((p.lon + 180) / 360) * scale;
      const s = Math.sin((p.lat * Math.PI) / 180);
      const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale;
      const key = `${Math.floor(x / cellPx)}:${Math.floor(y / cellPx)}`;
      const cell = cells.get(key) || { lat: 0, lon: 0, count: 0, ids: [], types: {} };
      cell.count += 1;
      cell.lat += p.lat; cell.lon += p.lon;
      cell.ids.push(p.id);
      cell.types[p.type] = (cell.types[p.type] || 0) + 1;
      cells.set(key, cell);
    }
    const out = [];
    for (const c of cells.values()) {
      out.push({ lat: r4(c.lat / c.count), lon: r4(c.lon / c.count), count: c.count, ids: c.count <= 25 ? c.ids : c.ids.slice(0, 25), types: c.types });
    }
    return out;
  }

  // ───────────────────────── search ─────────────────────────

  function normalizeQuery(q) {
    return String(q || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').trim();
  }

  /**
   * Rank entities (and events) for a free-text query. Company entities match on name,
   * ticker and canonical identity; places on name/country; events on title. Returns
   * `{ kind, id, name, subtitle, lat, lon, score }` rows, best first.
   */
  function searchEntities(entities, query, options = {}) {
    const q = normalizeQuery(query);
    if (!q) return [];
    const market = options.market ? marketCore.resolveMarketId(options.market) : null;
    const limit = Math.max(1, Math.min(Number(options.limit) || 12, 50));
    const rows = [];
    for (const e of entities) {
      if (!e.authoritative && !options.includeUnverified) continue;
      const name = normalizeQuery(e.name);
      const tickers = (e.attributes && e.attributes.instruments ? e.attributes.instruments : []).map((i) => String(i.symbol || '').toLowerCase());
      const country = normalizeQuery(e.country);
      let score = 0;
      if (name === q) score = 100;
      else if (tickers.includes(q)) score = 95;
      else if (name.startsWith(q)) score = 80;
      else if (name.split(' ').some((w) => w.startsWith(q))) score = 60;
      else if (name.includes(q)) score = 40;
      else if (country && country === q) score = 20;
      if (!score) continue;
      if (market && marketRelevance(e, market) === 'primary') score += 5;
      score += CONFIDENCE_RANK[e.confidence];
      rows.push({
        kind: e.type === 'COMPANY_HQ' ? 'company' : (e.type.endsWith('_EVENT') || e.type === 'NATURAL_DISASTER') ? 'event' : 'place',
        id: e.id, type: e.type, name: e.name, lat: e.lat, lon: e.lon, layer: e.layer, confidence: e.confidence,
        subtitle: [e.attributes && e.attributes.instruments && e.attributes.instruments[0] ? `${e.attributes.instruments[0].exchange}:${e.attributes.instruments[0].symbol}` : '', e.country].filter(Boolean).join(' · '),
        score,
      });
    }
    rows.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    return rows.slice(0, limit);
  }

  // ───────────────────────── cache identity ─────────────────────────

  /** `atlas:<kind>:<version>[:layer][:market][:bbox]` — every dimension that changes the payload is in the key. */
  function atlasCacheKey(kind, options = {}) {
    if (!kind) throw new Error('atlasCacheKey: kind is required');
    const parts = ['atlas', kind, options.datasetVersion || ATLAS_SCHEMA_VERSION];
    if (options.layer) parts.push(`layer=${options.layer}`);
    if (options.market) parts.push(`market=${marketCore.resolveMarketId(options.market)}`);
    if (options.bbox !== undefined) parts.push(`bbox=${quantizeBbox(typeof options.bbox === 'string' ? parseBbox(options.bbox) : options.bbox)}`);
    if (options.category) parts.push(`cat=${options.category}`);
    return parts.join(':');
  }

  // ───────────────────────── snapshot → entities ─────────────────────────

  /** Build the full entity set + company links from the generated snapshot (memoised by caller). */
  function buildFromSnapshot(snapshot) {
    const entities = [];
    const links = [];
    const problems = [];
    if (!snapshot || !snapshot.datasets) return { entities, links, problems, coverage: {} };
    const gen = snapshot.generatedAt;
    const wd = (qid) => ({ source: 'Wikidata', sourceUrl: `https://www.wikidata.org/wiki/${qid}`, license: 'CC0 1.0', observedAt: gen, lastVerified: gen });

    // Companies → COMPANY_HQ entities + HEADQUARTERS links keyed by canonical identity.
    const perMarket = { US: 0, IN: 0 };
    for (const c of snapshot.datasets.companies || []) {
      const instruments = (c.instruments || []).filter((i) => i.symbol);
      const markets = [...new Set((c.instruments || []).map((i) => i.market))];
      try {
        const e = createGeoEntity({
          id: `company:${c.qid}`, type: 'COMPANY_HQ', name: c.name, lat: c.lat, lon: c.lon, country: c.country || '',
          countryCode: c.country === 'United States of America' || c.country === 'United States' ? 'US' : c.country === 'India' ? 'IN' : '',
          region: c.hq || '', layer: 'companies', marketContext: markets,
          sourceEvidence: [{ ...wd(c.qid), confidence: 'HIGH', note: 'Headquarters location (P159) with coordinates (P625)' }],
          attributes: { qid: c.qid, hq: c.hq || '', instruments, exchanges: [...new Set((c.instruments || []).map((i) => i.exchange))] },
        });
        entities.push(e);
        for (const m of markets) if (perMarket[m] !== undefined) perMarket[m] += 1;
        for (const inst of instruments) {
          const identity = marketCore.parseInstrument(inst.symbol, inst.market);
          if (!identity) continue;
          const canonical = `${inst.market}:${inst.exchange}:${identity.symbol}`;
          try {
            links.push(createCompanyGeoLink({
              companyId: `company:${c.qid}`, instrumentIdentity: canonical, locationId: e.id, relationType: 'HEADQUARTERS',
              source: 'Wikidata', sourceUrl: `https://www.wikidata.org/wiki/${c.qid}`, confidence: 'HIGH',
            }));
          } catch (err) { problems.push(`link ${c.qid}/${inst.symbol}: ${err.message}`); }
        }
      } catch (err) { problems.push(`company ${c.qid}: ${err.message}`); }
    }

    for (const p of snapshot.datasets.ports || []) {
      try {
        entities.push(createGeoEntity({
          id: `port:ne:${p.id}`, type: 'PORT', name: p.name, lat: p.lat, lon: p.lon, layer: 'ports',
          sourceEvidence: [{ source: 'Natural Earth 10m ports', sourceUrl: 'https://www.naturalearthdata.com/downloads/10m-cultural-vectors/ports/', datasetId: `ne_10m_ports:${p.id}`, license: 'Public domain', confidence: 'MEDIUM', observedAt: gen, lastVerified: gen }],
          attributes: { scalerank: p.scalerank, website: p.website || '' },
        }));
      } catch (err) { problems.push(`port ${p.id}: ${err.message}`); }
    }
    for (const a of snapshot.datasets.airports || []) {
      try {
        entities.push(createGeoEntity({
          id: `airport:ne:${a.id}`, type: 'AIRPORT', name: a.name, lat: a.lat, lon: a.lon, layer: 'airports',
          sourceEvidence: [{ source: 'Natural Earth 10m airports', sourceUrl: 'https://www.naturalearthdata.com/downloads/10m-cultural-vectors/airports/', datasetId: `ne_10m_airports:${a.id}`, license: 'Public domain', confidence: 'MEDIUM', observedAt: gen, lastVerified: gen }],
          attributes: { iata: a.iata, icao: a.icao, size: a.size },
        }));
      } catch (err) { problems.push(`airport ${a.id}: ${err.message}`); }
    }
    for (const pp of snapshot.datasets.powerplants || []) {
      const nuclear = pp.fuel === 'Nuclear';
      try {
        entities.push(createGeoEntity({
          id: `plant:gppd:${pp.id}`, type: nuclear ? 'NUCLEAR_PLANT' : 'POWER_PLANT', name: pp.name, lat: pp.lat, lon: pp.lon,
          country: pp.countryName || '', countryCode: pp.country === 'USA' ? 'US' : pp.country === 'IND' ? 'IN' : '', layer: nuclear ? 'nuclear' : 'power',
          sourceEvidence: [{ source: 'WRI Global Power Plant Database v1.3', sourceUrl: pp.url && /^https?:/.test(pp.url) ? pp.url : 'https://datasets.wri.org/dataset/globalpowerplantdatabase', datasetId: `gppd:${pp.id}`, license: 'CC BY 4.0', confidence: 'HIGH', observedAt: '2021-06-02T00:00:00.000Z', lastVerified: gen, note: pp.source ? `GPPD source: ${pp.source}` : '' }],
          attributes: { fuel: pp.fuel, capacityMw: pp.mw, owner: pp.owner || '' },
        }));
      } catch (err) { problems.push(`plant ${pp.id}: ${err.message}`); }
    }
    const REF_LAYER = { EXCHANGE: 'exchanges', SHIPPING_CHOKEPOINT: 'chokepoints', CENTRAL_BANK: 'financial-centres', SPACEPORT: 'spaceports', PORT: 'ports', DATA_CENTER: 'industry-sites' };
    for (const r of snapshot.datasets.reference || []) {
      const evidence = r.source
        ? [{ ...r.source, sourceUrl: r.source.url, confidence: r.confidence, observedAt: gen, lastVerified: r.confidence === 'HIGH' ? gen : null, note: r.distanceKm != null ? `Curated point ${r.distanceKm} km from the Wikidata coordinate` : 'Wikidata lookup did not resolve' }]
        : [{ source: 'Project-curated reference (pre-ATLAS)', datasetId: `curated:${slug(r.name)}`, confidence: 'UNVERIFIED', note: 'No independent source resolved; hidden from the map' }];
      try {
        entities.push(createGeoEntity({
          id: `ref:${r.type.toLowerCase()}:${r.qid || slug(r.name)}`, type: r.type, name: r.label || r.name, lat: r.lat, lon: r.lon, country: r.country || '',
          countryCode: r.country === 'United States of America' ? 'US' : r.country === 'India' ? 'IN' : '', layer: REF_LAYER[r.type] || 'industry-sites',
          sourceEvidence: evidence, attributes: { qid: r.qid || '', curatedName: r.name },
        }));
      } catch (err) { problems.push(`reference ${r.name}: ${err.message}`); }
    }

    const coverage = {
      companies: { total: (snapshot.datasets.companies || []).length, perMarket, note: 'Wikidata-located HQs only; not the full listed universe' },
      ports: (snapshot.datasets.ports || []).length,
      airports: (snapshot.datasets.airports || []).length,
      powerplants: (snapshot.datasets.powerplants || []).length,
      reference: { total: (snapshot.datasets.reference || []).length, verified: (snapshot.datasets.reference || []).filter((r) => r.confidence === 'HIGH').length },
      unverifiedHidden: entities.filter((e) => !e.authoritative).length,
    };
    return { entities, links, problems, coverage };
  }

  const api = {
    ATLAS_SCHEMA_VERSION, MAX_ENTITIES_PER_RESPONSE, GEO_ENTITY_TYPES, CONFIDENCE, RELATION_TYPES, EVENT_CATEGORIES, EVENT_STATUS,
    LAYER_CATEGORIES, LAYERS, layerById,
    normalizeEvidence, validateGeoEntity, createGeoEntity, entityId,
    validateCompanyGeoLink, createCompanyGeoLink,
    classifyEventStatus, createGeoEvent,
    parseBbox, inBbox, quantizeBbox, marketRelevance, filterEntities, clusterPoints, searchEntities, atlasCacheKey,
    buildFromSnapshot,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalThis.MarketTerminalAtlas = api;
})();
