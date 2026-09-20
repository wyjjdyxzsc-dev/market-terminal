'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const atlas = require('../shared/atlas-core.js');

const WD = { source: 'Wikidata', sourceUrl: 'https://www.wikidata.org/wiki/Q9439', confidence: 'HIGH', lastVerified: '2026-09-21T00:00:00Z' };

// ───────────────────────── GeoEntity ─────────────────────────

test('a sourced entity with valid coordinates is created, frozen and authoritative', () => {
  const e = atlas.createGeoEntity({ type: 'EXCHANGE', name: 'Bombay Stock Exchange', lat: 18.9296, lon: 72.8337, country: 'India', countryCode: 'IN', layer: 'exchanges', sourceEvidence: [WD] });
  assert.equal(e.id, 'exchange:bombay-stock-exchange:18.9296,72.8337');
  assert.equal(e.confidence, 'HIGH');
  assert.equal(e.authoritative, true);
  assert.equal(e.lastVerified, '2026-09-21T00:00:00.000Z');
  assert.ok(Object.isFrozen(e));
});

test('NEGATIVE CONTROL: impossible latitude / longitude is rejected', () => {
  for (const [lat, lon] of [[91, 0], [-90.5, 10], [0, 181], [10, -180.1], ['x', 0], [NaN, 0], [null, null]]) {
    const v = atlas.validateGeoEntity({ type: 'PORT', name: 'Nowhere', lat, lon, sourceEvidence: [WD] });
    assert.equal(v.ok, false, `${lat},${lon}`);
    assert.ok(v.errors.some((m) => /impossible coordinate/.test(m)));
    assert.throws(() => atlas.createGeoEntity({ type: 'PORT', name: 'Nowhere', lat, lon, sourceEvidence: [WD] }), /impossible coordinate/);
  }
  assert.equal(atlas.validateGeoEntity({ type: 'PORT', name: 'Edge', lat: 90, lon: -180, sourceEvidence: [WD] }).ok, true);
});

test('NEGATIVE CONTROL: an unsourced entity is rejected, and UNVERIFIED evidence is never authoritative', () => {
  assert.equal(atlas.validateGeoEntity({ type: 'PORT', name: 'Port X', lat: 1, lon: 1 }).ok, false);
  assert.equal(atlas.validateGeoEntity({ type: 'PORT', name: 'Port X', lat: 1, lon: 1, sourceEvidence: [{ source: 'someone said' }] }).ok, false, 'a name without url/datasetId is not a source');
  assert.equal(atlas.validateGeoEntity({ type: 'PORT', name: 'Port X', lat: 1, lon: 1, sourceEvidence: [{ source: 'x', sourceUrl: 'javascript:alert(1)' }] }).ok, false, 'non-http url is not a source');
  const unverified = atlas.createGeoEntity({ type: 'DATA_CENTER', name: 'Ashburn', lat: 39.04, lon: -77.49, sourceEvidence: [{ source: 'Project-curated', datasetId: 'curated:ashburn', confidence: 'UNVERIFIED' }] });
  assert.equal(unverified.authoritative, false);
  assert.equal(unverified.confidence, 'UNVERIFIED');
  const { entities } = atlas.filterEntities([unverified]);
  assert.equal(entities.length, 0, 'hidden by default');
  assert.equal(atlas.filterEntities([unverified], { includeUnverified: true }).entities.length, 1);
});

test('type must come from the taxonomy', () => {
  assert.equal(atlas.validateGeoEntity({ type: 'CASTLE', name: 'x', lat: 0, lon: 0, sourceEvidence: [WD] }).ok, false);
  assert.ok(atlas.GEO_ENTITY_TYPES.includes('SUBSEA_CABLE') && atlas.GEO_ENTITY_TYPES.includes('SHIPPING_CHOKEPOINT') && atlas.GEO_ENTITY_TYPES.includes('FAB'));
});

// ───────────────────────── CompanyGeoLink ─────────────────────────

test('company links require the TWINCORE canonical identity', () => {
  const ok = atlas.validateCompanyGeoLink({ companyId: 'company:Q1', instrumentIdentity: 'IN:NSE:RELIANCE', locationId: 'x', relationType: 'HEADQUARTERS', source: 'Wikidata', confidence: 'HIGH' });
  assert.equal(ok.ok, true, ok.errors.join(';'));
});

test('NEGATIVE CONTROL: a provider ticker is not a canonical company identity', () => {
  for (const bad of ['RELIANCE.NS', 'NSE:RELIANCE', 'reliance', 'AAPL']) {
    const v = atlas.validateCompanyGeoLink({ companyId: 'c', instrumentIdentity: bad, locationId: 'l', relationType: 'HEADQUARTERS', source: 's', confidence: 'HIGH' });
    assert.equal(v.ok, false, bad);
    assert.ok(v.errors.some((m) => /canonical MARKET:EXCHANGE:SYMBOL/.test(m)), bad);
  }
});

test('NEGATIVE CONTROL: a wrong-market company association is detected', () => {
  const v = atlas.validateCompanyGeoLink({ companyId: 'c', instrumentIdentity: 'US:NASDAQ:AAPL', locationId: 'l', relationType: 'HEADQUARTERS', source: 's', confidence: 'HIGH' }, { expectedMarket: 'IN' });
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((m) => /belongs to US, not IN/.test(m)));
  assert.equal(atlas.validateCompanyGeoLink({ companyId: 'c', instrumentIdentity: 'IN:BSE:RELIANCE', locationId: 'l', relationType: 'REFINERY', source: 's', confidence: 'MEDIUM' }, { expectedMarket: 'IN' }).ok, true);
});

test('relation type and confidence are constrained', () => {
  assert.equal(atlas.validateCompanyGeoLink({ companyId: 'c', locationId: 'l', relationType: 'FRIENDS', source: 's', confidence: 'HIGH' }).ok, false);
  assert.equal(atlas.validateCompanyGeoLink({ companyId: 'c', locationId: 'l', relationType: 'OFFICE', source: 's', confidence: 'PROBABLY' }).ok, false);
});

// ───────────────────────── GeoEvent ─────────────────────────

test('events are classified by category freshness; stale data never reads as active', () => {
  const now = Date.parse('2026-09-21T12:00:00Z');
  const fresh = atlas.createGeoEvent({ type: 'EARTHQUAKE', title: 'M5.1', location: { lat: 36, lon: 140 }, startedAt: '2026-09-21T10:00:00Z', severity: 'M5.1', sourceEvidence: [{ source: 'USGS', sourceUrl: 'https://earthquake.usgs.gov/x', confidence: 'HIGH' }] }, now);
  assert.equal(fresh.status, 'active');
  const stale = atlas.createGeoEvent({ type: 'EARTHQUAKE', title: 'M6.0', location: { lat: 36, lon: 140 }, startedAt: '2026-09-01T10:00:00Z', sourceEvidence: [{ source: 'USGS', sourceUrl: 'https://earthquake.usgs.gov/x', confidence: 'HIGH' }] }, now);
  assert.equal(stale.status, 'stale', 'NEGATIVE CONTROL: 20-day-old quake is not live');
  const war = atlas.createGeoEvent({ type: 'WAR', title: 'Front update', location: { lat: 48, lon: 37 }, updatedAt: '2026-09-17T00:00:00Z', sourceEvidence: [{ source: 'GDELT', sourceUrl: 'https://api.gdeltproject.org', confidence: 'MEDIUM' }] }, now);
  assert.equal(war.status, 'stale');
  const resolved = atlas.createGeoEvent({ type: 'STORM', title: 'x', location: { lat: 1, lon: 1 }, updatedAt: '2026-09-21T11:00:00Z', closed: true, sourceEvidence: [{ source: 'EONET', sourceUrl: 'https://eonet.gsfc.nasa.gov', confidence: 'HIGH' }] }, now);
  assert.equal(resolved.status, 'resolved');
  assert.throws(() => atlas.createGeoEvent({ type: 'EARTHQUAKE', title: 'x', location: { lat: 95, lon: 0 }, sourceEvidence: [WD] }), /impossible/);
  assert.throws(() => atlas.createGeoEvent({ type: 'PARTY', title: 'x', location: { lat: 0, lon: 0 }, sourceEvidence: [WD] }), /type must be/);
  assert.throws(() => atlas.createGeoEvent({ type: 'FLOOD', title: 'x', location: { lat: 0, lon: 0 } }), /source evidence/);
});

// ───────────────────────── layers ─────────────────────────

test('layer registry: every layer has a category, source, freshness and coverage truth; non-rendering layers carry no dataset', () => {
  for (const l of atlas.LAYERS) {
    assert.ok(atlas.LAYER_CATEGORIES.includes(l.category), l.id);
    assert.ok(['snapshot', 'live', 'none'].includes(l.freshness), l.id);
    assert.equal(typeof l.coverage.note, 'string');
    assert.equal(l.coverage.complete, false, 'ATLAS never claims complete coverage');
    if (l.freshness === 'none') assert.equal(l.renders, false, `${l.id} has no data and must not render`);
    if (l.renders) assert.ok(l.dataSource.license, `${l.id} needs a licence`);
  }
  assert.ok(['subsea-cables', 'energy-infrastructure', 'industry-sites'].every((id) => atlas.layerById(id).renders === false));
  assert.equal(atlas.layerById('companies').marketAware, true);
  assert.equal(atlas.layerById('nope'), null);
});

test('NEGATIVE CONTROL: entities of a hidden (non-rendering) layer are never selected for drawing', () => {
  const e = atlas.createGeoEntity({ type: 'PIPELINE', name: 'Somewhere line', lat: 50, lon: 20, layer: 'energy-infrastructure', sourceEvidence: [WD] });
  const drawable = atlas.LAYERS.filter((l) => l.renders).map((l) => l.id);
  const { entities } = atlas.filterEntities([e], { layer: 'energy-infrastructure' });
  assert.equal(entities.length, 1, 'the API can still list it');
  assert.equal(drawable.includes('energy-infrastructure'), false, 'but the renderer skips the layer');
});

// ───────────────────────── bbox / market / filtering ─────────────────────────

test('bbox parsing, containment and antimeridian crossing', () => {
  assert.deepEqual(atlas.parseBbox('68,6,98,36'), { west: 68, south: 6, east: 98, north: 36 });
  assert.equal(atlas.parseBbox('68,6,98'), null);
  assert.equal(atlas.parseBbox('0,50,10,40'), null, 'south > north');
  assert.equal(atlas.parseBbox('0,-91,10,40'), null);
  const india = atlas.parseBbox('68,6,98,36');
  assert.equal(atlas.inBbox({ lat: 19.07, lon: 72.87 }, india), true);
  assert.equal(atlas.inBbox({ lat: 40.7, lon: -74 }, india), false);
  const pacific = atlas.parseBbox('170,-10,-170,10');
  assert.equal(atlas.inBbox({ lat: 0, lon: 178 }, pacific), true);
  assert.equal(atlas.inBbox({ lat: 0, lon: -178 }, pacific), true);
  assert.equal(atlas.inBbox({ lat: 0, lon: 0 }, pacific), false);
});

test('market context changes emphasis and order, never geography', () => {
  const mumbai = atlas.createGeoEntity({ type: 'COMPANY_HQ', name: 'Reliance Industries', lat: 19.07, lon: 72.87, country: 'India', countryCode: 'IN', layer: 'companies', marketContext: ['IN'], sourceEvidence: [WD] });
  const cupertino = atlas.createGeoEntity({ type: 'COMPANY_HQ', name: 'Apple', lat: 37.33, lon: -122.03, country: 'United States of America', countryCode: 'US', layer: 'companies', marketContext: ['US'], sourceEvidence: [WD] });
  const hormuz = atlas.createGeoEntity({ type: 'SHIPPING_CHOKEPOINT', name: 'Strait of Hormuz', lat: 26.57, lon: 56.25, layer: 'chokepoints', sourceEvidence: [WD] });
  assert.equal(atlas.marketRelevance(mumbai, 'IN'), 'primary');
  assert.equal(atlas.marketRelevance(mumbai, 'US'), 'global');
  assert.equal(atlas.marketRelevance(hormuz, 'IN'), 'global');
  const inMode = atlas.filterEntities([cupertino, hormuz, mumbai], { market: 'IN' });
  assert.equal(inMode.entities[0].name, 'Reliance Industries');
  assert.equal(inMode.total, 3, 'global entities are not hidden in India mode');
  const usMode = atlas.filterEntities([mumbai, hormuz, cupertino], { market: 'US' });
  assert.equal(usMode.entities[0].name, 'Apple');
});

test('responses are bounded and report truncation', () => {
  const many = Array.from({ length: 3000 }, (_, i) => atlas.createGeoEntity({ type: 'PORT', name: `Port ${i}`, lat: (i % 170) - 85, lon: (i % 350) - 175, layer: 'ports', sourceEvidence: [WD] }));
  const r = atlas.filterEntities(many, { layer: 'ports' });
  assert.equal(r.total, 3000);
  assert.equal(r.entities.length, atlas.MAX_ENTITIES_PER_RESPONSE);
  assert.equal(r.truncated, true);
  assert.equal(atlas.filterEntities(many, { layer: 'ports', limit: 10 }).entities.length, 10);
});

// ───────────────────────── clustering ─────────────────────────

test('grid clustering bounds the marker count at low zoom and disaggregates at high zoom', () => {
  const pts = Array.from({ length: 5000 }, (_, i) => ({ id: String(i), type: 'PORT', lat: 18 + (i % 50) * 0.01, lon: 72 + Math.floor(i / 50) * 0.01 }));
  const low = atlas.clusterPoints(pts, 2);
  assert.ok(low.length <= 4, `5,000 points within ~1° collapse to a handful of clusters at z2 (got ${low.length})`);
  assert.equal(low.reduce((s, c) => s + c.count, 0), 5000);
  const high = atlas.clusterPoints(pts, 14);
  assert.ok(high.length > 500, `z14 disaggregates (got ${high.length})`);
  assert.ok(low[0].ids.length <= 25, 'cluster id lists are bounded');
});

// ───────────────────────── search ─────────────────────────

test('search ranks company names, tickers, places and honours market emphasis', () => {
  const rel = atlas.createGeoEntity({ type: 'COMPANY_HQ', name: 'Reliance Industries', lat: 19.07, lon: 72.87, country: 'India', countryCode: 'IN', layer: 'companies', marketContext: ['IN'], sourceEvidence: [WD], attributes: { instruments: [{ market: 'IN', exchange: 'NSE', symbol: 'RELIANCE' }] } });
  const relPower = atlas.createGeoEntity({ type: 'COMPANY_HQ', name: 'Reliance Power', lat: 19.1, lon: 72.9, country: 'India', countryCode: 'IN', layer: 'companies', marketContext: ['IN'], sourceEvidence: [WD], attributes: { instruments: [{ market: 'IN', exchange: 'NSE', symbol: 'RPOWER' }] } });
  const hormuz = atlas.createGeoEntity({ type: 'SHIPPING_CHOKEPOINT', name: 'Strait of Hormuz', lat: 26.57, lon: 56.25, layer: 'chokepoints', sourceEvidence: [WD] });
  const hidden = atlas.createGeoEntity({ type: 'DATA_CENTER', name: 'Reliance Data Centre', lat: 19, lon: 72, sourceEvidence: [{ source: 'x', datasetId: 'y', confidence: 'UNVERIFIED' }] });
  const all = [hormuz, relPower, rel, hidden];
  assert.equal(atlas.searchEntities(all, 'reliance')[0].name, 'Reliance Industries');
  assert.equal(atlas.searchEntities(all, 'RPOWER')[0].name, 'Reliance Power');
  assert.equal(atlas.searchEntities(all, 'RPOWER')[0].subtitle, 'NSE:RPOWER · India');
  assert.equal(atlas.searchEntities(all, 'hormuz')[0].kind, 'place');
  assert.equal(atlas.searchEntities(all, 'reliance').some((r) => r.name === 'Reliance Data Centre'), false, 'UNVERIFIED entities do not surface in search');
  assert.deepEqual(atlas.searchEntities(all, ''), []);
});

// ───────────────────────── cache identity ─────────────────────────

test('cache identity carries kind, version, layer, market and quantised bbox', () => {
  const a = atlas.atlasCacheKey('entities', { layer: 'companies', market: 'IN', bbox: '68.2,6.1,97.9,35.8' });
  const b = atlas.atlasCacheKey('entities', { layer: 'companies', market: 'IN', bbox: '68.9,6.4,97.1,35.1' });
  assert.equal(a, b, 'small pans share a key');
  assert.equal(a, `atlas:entities:${atlas.ATLAS_SCHEMA_VERSION}:layer=companies:market=IN:bbox=65,5,100,40`);
  assert.notEqual(a, atlas.atlasCacheKey('entities', { layer: 'companies', market: 'US', bbox: '68.2,6.1,97.9,35.8' }));
  assert.notEqual(a, atlas.atlasCacheKey('events', { layer: 'companies', market: 'IN', bbox: '68.2,6.1,97.9,35.8' }));
  assert.throws(() => atlas.atlasCacheKey(''), /kind is required/);
});

// ───────────────────────── snapshot build ─────────────────────────

test('buildFromSnapshot produces entities + canonical links and drops unsourced/unverified rows from the authoritative set', () => {
  const snapshot = {
    generatedAt: '2026-09-21T00:00:00.000Z',
    datasets: {
      companies: [
        { qid: 'Q1', name: 'Reliance Industries', lat: 19.07, lon: 72.87, country: 'India', instruments: [{ market: 'IN', exchange: 'NSE', symbol: 'RELIANCE' }, { market: 'IN', exchange: 'BSE', symbol: 'RELIANCE' }] },
        { qid: 'Q2', name: 'Apple', lat: 37.33, lon: -122.03, country: 'United States of America', instruments: [{ market: 'US', exchange: 'NASDAQ', symbol: 'AAPL' }] },
        { qid: 'Q3', name: 'Broken', lat: 999, lon: 0, country: '', instruments: [] },
      ],
      ports: [{ id: '1', name: 'Port of Singapore', lat: 1.26, lon: 103.83, scalerank: 1 }],
      airports: [],
      powerplants: [{ id: 'WRI1', name: 'Kudankulam', country: 'IND', countryName: 'India', lat: 8.17, lon: 77.71, fuel: 'Nuclear', mw: 2000, owner: 'NPCIL', source: 'x', url: 'https://x' }],
      reference: [
        { type: 'EXCHANGE', name: 'Bombay Stock Exchange', lat: 18.93, lon: 72.83, confidence: 'HIGH', qid: 'Q638398', label: 'Bombay Stock Exchange', country: 'India', distanceKm: 0.2, source: { name: 'Wikidata', url: 'https://www.wikidata.org/wiki/Q638398', license: 'CC0' } },
        { type: 'DATA_CENTER', name: 'Ashburn (US-East)', lat: 39.04, lon: -77.49, confidence: 'UNVERIFIED', source: null },
      ],
    },
  };
  const built = atlas.buildFromSnapshot(snapshot);
  assert.equal(built.problems.length, 1, 'the impossible-coordinate company is reported, not silently mapped');
  assert.match(built.problems[0], /Q3/);
  const ids = built.entities.map((e) => e.id);
  assert.ok(ids.includes('company:Q1') && ids.includes('company:Q2') && ids.includes('port:ne:1') && ids.includes('plant:gppd:WRI1'));
  assert.deepEqual(built.links.map((l) => l.instrumentIdentity).sort(), ['IN:BSE:RELIANCE', 'IN:NSE:RELIANCE', 'US:NASDAQ:AAPL']);
  assert.ok(built.links.every((l) => !/\.(NS|BO)/.test(l.instrumentIdentity)));
  const nuclear = built.entities.find((e) => e.id === 'plant:gppd:WRI1');
  assert.equal(nuclear.type, 'NUCLEAR_PLANT');
  assert.equal(nuclear.countryCode, 'IN');
  assert.equal(atlas.marketRelevance(nuclear, 'IN'), 'primary');
  const ashburn = built.entities.find((e) => e.name === 'Ashburn (US-East)');
  assert.equal(ashburn.authoritative, false);
  assert.equal(built.coverage.unverifiedHidden, 1);
  assert.equal(built.coverage.companies.perMarket.IN, 1);
  assert.equal(built.coverage.reference.verified, 1);
});

// ───────────────────────── the committed snapshot ─────────────────────────

test('the committed snapshot builds with every row sourced, no invented geometry, and measured coverage', () => {
  const snapshot = require('../shared/atlas-snapshot.js');
  const built = atlas.buildFromSnapshot(snapshot);
  assert.deepEqual(built.problems, [], 'no snapshot row is rejected by the validator');
  assert.ok(built.entities.length > 7000, `entities: ${built.entities.length}`);
  assert.ok(built.entities.every((e) => e.sourceEvidence.length > 0 && (e.sourceEvidence[0].sourceUrl || e.sourceEvidence[0].datasetId)));
  assert.ok(built.links.every((l) => /^(US|IN):(NYSE|NASDAQ|NSE|BSE):[A-Z0-9&.-]+$/.test(l.instrumentIdentity)), 'every company link is a canonical TWINCORE identity');
  assert.ok(built.links.some((l) => l.instrumentIdentity === 'IN:NSE:RELIANCE'), 'Reliance Industries is linked under IN:NSE');
  assert.ok(built.coverage.companies.perMarket.IN > 50 && built.coverage.companies.perMarket.US > 1000);
  assert.ok(built.coverage.reference.verified >= 45);
  const hormuz = built.entities.find((e) => e.type === 'SHIPPING_CHOKEPOINT' && /hormuz/i.test(e.name));
  assert.ok(hormuz && hormuz.authoritative && /wikidata\.org\/wiki\/Q\d+/.test(hormuz.sourceEvidence[0].sourceUrl));
  const unverified = built.entities.filter((e) => !e.authoritative);
  assert.equal(unverified.length, built.coverage.unverifiedHidden);
  for (const e of unverified) assert.equal(atlas.filterEntities([e]).entities.length, 0, `${e.name} must stay hidden`);
  assert.equal(snapshot.sources.gppd.license, 'CC BY 4.0');
  assert.match(snapshot.sources.gppd.attribution, /World Resources Institute/);
});

test('PERFORMANCE: 50,000 synthetic points filter + cluster in bounded time and bounded output', () => {
  const pts = [];
  for (let i = 0; i < 50000; i++) pts.push(atlas.createGeoEntity({ type: 'PORT', name: `P${i}`, lat: ((i * 7919) % 17000) / 100 - 85, lon: ((i * 104729) % 36000) / 100 - 180, layer: 'ports', sourceEvidence: [WD] }));
  const t0 = process.hrtime.bigint();
  const world = atlas.filterEntities(pts, { layer: 'ports', bbox: '-180,-85,180,85' });
  const clusters = atlas.clusterPoints(world.entities, 2, 56);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.equal(world.truncated, true);
  assert.equal(world.entities.length, atlas.MAX_ENTITIES_PER_RESPONSE);
  assert.ok(clusters.length <= 400, `z2 world clusters ${clusters.length} (grid ceiling ≈ (1024/56+1)²)`);
  assert.ok(ms < 1500, `filter+cluster took ${ms.toFixed(0)} ms`);
  const t1 = process.hrtime.bigint();
  const all = atlas.clusterPoints(pts, 4, 56);
  const ms2 = Number(process.hrtime.bigint() - t1) / 1e6;
  assert.ok(all.length <= 5500 && ms2 < 1500, `50k cluster at z4: ${all.length} cells in ${ms2.toFixed(0)} ms (grid ceiling ≈ (4096/56+1)²)`);
});
