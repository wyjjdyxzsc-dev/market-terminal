'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const nexus = require('../shared/nexus-core.js');

test('createCompanyNode accepts a valid canonical id and freezes the node', () => {
  const node = nexus.createCompanyNode({
    id: 'US:NASDAQ:AAPL',
    name: 'Apple Inc.',
    market: 'US',
    exchange: 'NASDAQ',
    enrichment: 'geo-linked',
    sector: 'Technology',
    cik: '0000320193',
    sourceEvidence: [{ source: 'SEC EDGAR', sourceUrl: 'https://www.sec.gov/files/company_tickers.json' }],
  });
  assert.equal(node.id, 'US:NASDAQ:AAPL');
  assert.equal(node.enrichment, 'geo-linked');
  assert.throws(() => { node.name = 'x'; }); // frozen
});

test('createCompanyNode rejects a non-canonical id', () => {
  assert.throws(() => nexus.createCompanyNode({ id: 'AAPL', name: 'Apple Inc.', market: 'US', exchange: 'NASDAQ', enrichment: 'node-only', sourceEvidence: [{ source: 'SEC EDGAR', sourceUrl: 'https://www.sec.gov/files/company_tickers.json' }] }));
});

test('createCompanyNode rejects a node with no source evidence', () => {
  assert.throws(() => nexus.createCompanyNode({ id: 'US:NASDAQ:AAPL', name: 'Apple Inc.', market: 'US', exchange: 'NASDAQ', enrichment: 'node-only', sourceEvidence: [] }));
});

test('createRelationshipEdge accepts a valid tier-1 edge and rejects an unsourced one', () => {
  const edge = nexus.createRelationshipEdge({
    sourceId: 'US:NASDAQ:AAPL',
    targetId: 'US:NASDAQ:QCOM',
    relation: 'supplier',
    tier: 1,
    evidence: [{ source: 'SEC XBRL', sourceUrl: 'https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json', datasetId: 'us-gaap:ConcentrationRiskPercentage1' }],
  });
  assert.equal(edge.sourceId, 'US:NASDAQ:AAPL');
  assert.ok(edge.confidence > 0);
  assert.ok(['confirmed', 'reported', 'inferred'].includes(edge.strength));
  assert.throws(() => nexus.createRelationshipEdge({ sourceId: 'US:NASDAQ:AAPL', targetId: 'US:NASDAQ:QCOM', relation: 'supplier', tier: 1, evidence: [] }));
});

test('createRelationshipEdge rejects an unknown relation type', () => {
  assert.throws(() => nexus.createRelationshipEdge({
    sourceId: 'US:NASDAQ:AAPL', targetId: 'US:NASDAQ:QCOM', relation: 'frenemy', tier: 1,
    evidence: [{ source: 'SEC XBRL', sourceUrl: 'https://data.sec.gov/x.json' }],
  }));
});

test('computeConfidence ranks tier 1 above tier 2, and more sources raise confidence', () => {
  const t1 = nexus.computeConfidence({ tier: 1, sourceCount: 1, recency: '2026-01-01T00:00:00Z' });
  const t2 = nexus.computeConfidence({ tier: 2, sourceCount: 1, recency: '2026-01-01T00:00:00Z' });
  assert.ok(t1.confidence > t2.confidence);
  const t2more = nexus.computeConfidence({ tier: 2, sourceCount: 3, recency: '2026-01-01T00:00:00Z' });
  assert.ok(t2more.confidence > t2.confidence);
});

test('registryCoverage reports per-market enrichment split', () => {
  const companies = [
    nexus.createCompanyNode({ id: 'US:NASDAQ:AAPL', name: 'Apple', market: 'US', exchange: 'NASDAQ', enrichment: 'geo-linked', sourceEvidence: [{ source: 'SEC', sourceUrl: 'https://sec.gov/x' }] }),
    nexus.createCompanyNode({ id: 'US:NYSE:ZZZ', name: 'Zzz Corp', market: 'US', exchange: 'NYSE', enrichment: 'node-only', sourceEvidence: [{ source: 'SEC', sourceUrl: 'https://sec.gov/y' }] }),
  ];
  const coverage = nexus.registryCoverage(companies);
  assert.equal(coverage.totalCompanies, 2);
  assert.equal(coverage.geoLinked, 1);
  assert.equal(coverage.nodeOnly, 1);
  assert.equal(coverage.byMarket.US.total, 2);
});

test('filterGraph bounds traversal depth and node count', () => {
  const companies = ['US:NASDAQ:A', 'US:NASDAQ:B', 'US:NASDAQ:C'].map((id) =>
    nexus.createCompanyNode({ id, name: id, market: 'US', exchange: 'NASDAQ', enrichment: 'node-only', sourceEvidence: [{ source: 'SEC', sourceUrl: 'https://sec.gov/' + id }] }));
  const edges = [
    nexus.createRelationshipEdge({ sourceId: 'US:NASDAQ:A', targetId: 'US:NASDAQ:B', relation: 'supplier', tier: 3, evidence: [{ source: 'Wikidata', sourceUrl: 'https://wikidata.org/x' }] }),
    nexus.createRelationshipEdge({ sourceId: 'US:NASDAQ:B', targetId: 'US:NASDAQ:C', relation: 'supplier', tier: 3, evidence: [{ source: 'Wikidata', sourceUrl: 'https://wikidata.org/y' }] }),
  ];
  const graph = nexus.filterGraph(companies, edges, { rootId: 'US:NASDAQ:A', depth: 1, maxNodes: 50 });
  assert.deepEqual(graph.nodes.map((n) => n.id).sort(), ['US:NASDAQ:A', 'US:NASDAQ:B']);
  assert.equal(graph.edges.length, 1);
});

test('nexus-snapshot.js registry has no orphaned canonical ids and reports coverage', () => {
  const snapshot = require('../shared/nexus-snapshot.js');
  assert.ok(snapshot.companies.length > 1000, 'expected a large registry, not a curated subset');
  for (const c of snapshot.companies.slice(0, 50)) {
    assert.equal(c.id, `${c.market}:${c.exchange}:${c.symbol}`);
  }
  assert.ok(snapshot.coverage.byMarket.US, 'US market must be present in coverage');
});
