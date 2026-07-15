'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  SCHEMA_VERSION,
  annotateMapPayload,
  buildLayerCatalog,
  getLayerProvenance,
} = require('../shared/map-provenance-core.js');

test('map provenance distinguishes live, curated, and model-derived layers', () => {
  const live = getLayerProvenance('earthquakes', { servedAt: '2026-07-15T12:00:00Z' });
  const curated = getLayerProvenance('chokepoints', { cached: true, servedAt: '2026-07-15T12:00:00Z' });
  const derived = getLayerProvenance('instability', { servedAt: '2026-07-15T12:00:00Z' });

  assert.equal(live.dataClass, 'live');
  assert.equal(live.status, 'live');
  assert.equal(live.sources[0].authority, 'official');
  assert.equal(curated.dataClass, 'curated');
  assert.equal(curated.status, 'reference');
  assert.equal(curated.cacheState, 'cached');
  assert.equal(derived.dataClass, 'model-derived');
  assert.equal(derived.status, 'derived');
});

test('catalog exposes source metadata for every implemented Leaflet layer', () => {
  const catalog = buildLayerCatalog({ servedAt: '2026-07-15T12:00:00Z' });
  const mapScript = fs.readFileSync(path.join(__dirname, '..', 'public', 'mapintel.js'), 'utf8');
  const leafletLayerIds = Array.from(mapScript.matchAll(/\{ id: '([^']+)'/g), (match) => match[1]);

  assert.ok(leafletLayerIds.length > 0, 'expected map layer definitions');
  for (const layerId of leafletLayerIds) {
    assert.ok(catalog[layerId], `${layerId} must be present`);
    assert.ok(catalog[layerId].sources.length > 0, `${layerId} must list at least one source`);
    assert.ok(catalog[layerId].note.length > 0, `${layerId} must disclose a usage note`);
  }
});

test('map payload annotation preserves existing response shape and adds a catalog', () => {
  const annotated = annotateMapPayload({ points: [{ lat: 1, lon: 2 }], cached: true }, 'earthquakes', {
    cached: true,
    servedAt: '2026-07-15T12:00:00Z',
  });
  const catalog = annotateMapPayload({ _updated: '2026-07-15T11:00:00Z', nuclear: [] }, 'layers', {
    cached: true,
    servedAt: '2026-07-15T12:00:00Z',
  });

  assert.deepEqual(annotated.points, [{ lat: 1, lon: 2 }]);
  assert.equal(annotated.provenance.schemaVersion, SCHEMA_VERSION);
  assert.equal(annotated.provenance.layer.layerId, 'earthquakes');
  assert.equal(catalog.provenance.kind, 'layer-catalog');
  assert.equal(catalog.provenance.sourceUpdatedAt, '2026-07-15T11:00:00.000Z');
  assert.equal(catalog.provenance.catalog.nuclear.dataClass, 'hybrid');
});
