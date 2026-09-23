'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
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

// MT2-5 Task 5 regression (fix round 1): tier-2 relationships come from an AI
// provider's JSON output. server.js's/worker.js's fetchNexusTier2Relationships
// post-processing loop must NEVER let a model-proposed confidence/strength reach
// the stored edge — only nexusCore.computeConfidence (tier/sourceCount/recency)
// may set those fields. This locks that invariant at the one function every
// tier-2 edge is required to pass through, so a future refactor that starts
// spreading the raw AI payload into createRelationshipEdge's input fails loudly.
test('createRelationshipEdge ignores a caller/model-supplied confidence and strength and always recomputes them deterministically', () => {
  // Shaped like the AI provider's raw JSON for one proposed relationship, the
  // way fetchNexusTier2Relationships receives it — including a bogus injected
  // rating a compromised or careless model output might carry.
  const fakeModelProposedRelationship = {
    relation: 'supplier',
    counterpartyName: 'Fake Co',
    counterpartyTicker: 'FAKE',
    evidenceIds: ['ev_1'],
    confidence: 0.99,       // bogus / model-injected — must never win
    strength: 'confirmed',  // bogus / model-injected — must never win
  };
  const evidence = [{
    source: 'Reuters', sourceUrl: 'https://www.reuters.com/example-tier2-evidence',
    observedAt: '2020-01-01T00:00:00Z', note: 'old, single-source evidence',
  }];

  // This mirrors fetchNexusTier2Relationships's actual call shape: tier is
  // hardcoded to 2 by the caller, evidence comes from resolved policy records,
  // and — critically — the function still passes through the model's own
  // confidence/strength fields to prove createRelationshipEdge refuses them
  // even when a future refactor accidentally forwards them.
  const edge = nexus.createRelationshipEdge({
    sourceId: 'US:NASDAQ:AAPL',
    targetId: 'US:NASDAQ:FAKE',
    relation: fakeModelProposedRelationship.relation,
    tier: 2,
    evidence,
    confidence: fakeModelProposedRelationship.confidence,
    strength: fakeModelProposedRelationship.strength,
  });

  const expected = nexus.computeConfidence({
    tier: 2,
    sourceCount: evidence.length,
    recency: evidence[0].observedAt,
  });

  assert.notEqual(edge.confidence, fakeModelProposedRelationship.confidence);
  assert.notEqual(edge.strength, fakeModelProposedRelationship.strength);
  assert.equal(edge.confidence, expected.confidence);
  assert.equal(edge.strength, expected.strength);
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

test('nexus-snapshot.js relationships all carry evidence and valid tiers', () => {
  const snapshot = require('../shared/nexus-snapshot.js');
  for (const edge of snapshot.relationships) {
    assert.ok(edge.evidence.length > 0, `edge ${edge.sourceId}->${edge.targetId} has no evidence`);
    assert.ok([1, 2, 3].includes(edge.tier));
    if (edge.relation === 'ownership') assert.equal(edge.tier, 3);
  }
});

// MT2-5 Task 5 regression (fix round 1), targeted at the actual post-processing
// code rather than createRelationshipEdge in isolation: fetchNexusTier2Relationships
// in server.js/worker.js must build each edge's createRelationshipEdge() call from
// individually-named fields (relation/tier/evidence) resolved against the policy's
// own evidence records — never by spreading the AI provider's raw proposed-relationship
// object (which could carry `confidence`/`strength`) into that call. A future
// refactor that starts doing `nexusCore.createRelationshipEdge({ ...rel, ... })`
// would reopen exactly the hole the functional test above guards against at the
// nexus-core level, so this catches it at the call site too.
test('fetchNexusTier2Relationships never spreads the raw AI relationship into createRelationshipEdge, in either runtime', () => {
  for (const file of ['server.js', 'worker.js']) {
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    const start = source.indexOf('async function fetchNexusTier2Relationships');
    assert.ok(start !== -1, `fetchNexusTier2Relationships not found in ${file}`);
    const end = source.indexOf('\n}', source.indexOf('createRelationshipEdge', start));
    const fn = source.slice(start, end + 2);

    assert.match(fn, /nexusCore\.createRelationshipEdge\(\{/, `${file}: expected a createRelationshipEdge call in fetchNexusTier2Relationships`);
    // The call must not spread the model's relationship object into createRelationshipEdge...
    assert.doesNotMatch(fn, /createRelationshipEdge\(\{\s*\.\.\.rel/, `${file}: createRelationshipEdge must not spread the raw AI relationship object`);
    // ...and must never read a confidence/strength field off the model's output.
    assert.doesNotMatch(fn, /rel\.confidence/, `${file}: must never read a model-supplied confidence`);
    assert.doesNotMatch(fn, /rel\.strength/, `${file}: must never read a model-supplied strength`);
    // tier must be the deterministic literal 2, not something taken from the model.
    assert.match(fn, /tier:\s*2\b/, `${file}: tier must be hardcoded to 2 for AI-extracted relationships`);
  }
});

// ───────────────────────── MT2-5A CENSUS: Company / ListedSecurity separation ─────────────────────────

function sec(over) {
  return nexus.createCompanyNode({
    id: over.id, name: over.name, market: over.market, exchange: over.exchange,
    enrichment: over.enrichment || 'node-only', cik: over.cik || '', isin: over.isin || '',
    geoEntityId: over.geoEntityId || '', sector: over.sector || '',
    sourceEvidence: over.sourceEvidence || [{ source: 'SEC EDGAR', sourceUrl: 'https://www.sec.gov/files/company_tickers_exchange.json' }],
  });
}

test('buildCompanyIndex groups a US dual-class pair sharing one CIK into a single crossListed Company', () => {
  const a = sec({ id: 'US:NASDAQ:GOOGL', name: 'Alphabet Inc.', market: 'US', exchange: 'NASDAQ', cik: '0001652044' });
  const b = sec({ id: 'US:NASDAQ:GOOG', name: 'Alphabet Inc.', market: 'US', exchange: 'NASDAQ', cik: '0001652044' });
  const { companies, securities } = nexus.buildCompanyIndex([a, b]);
  assert.equal(companies.length, 1);
  assert.equal(companies[0].id, 'company:us:cik:0001652044');
  assert.equal(companies[0].crossListed, true);
  assert.deepEqual([...companies[0].securityIds].sort(), ['US:NASDAQ:GOOG', 'US:NASDAQ:GOOGL']);
  assert.ok(securities.every((s) => s.companyId === 'company:us:cik:0001652044'));
});

test('buildCompanyIndex merges an NSE+BSE cross-listing by ISIN, preferring the NSE (default-exchange) listing for name/sector', () => {
  const nse = sec({ id: 'IN:NSE:RELIANCE', name: 'RELIANCE INDUSTRIES LIMITED', market: 'IN', exchange: 'NSE', isin: 'INE002A01018', sector: 'Energy', geoEntityId: 'company:Q1215884' });
  const bse = sec({ id: 'IN:BSE:500325', name: 'Reliance Industries Ltd', market: 'IN', exchange: 'BSE', isin: 'INE002A01018' });
  const { companies } = nexus.buildCompanyIndex([bse, nse]); // order-independent: BSE listed first here
  assert.equal(companies.length, 1);
  assert.equal(companies[0].id, 'company:in:isin:INE002A01018');
  assert.equal(companies[0].crossListed, true);
  assert.equal(companies[0].name, 'RELIANCE INDUSTRIES LIMITED', 'NSE (the IN default exchange) wins the display name');
  assert.equal(companies[0].sector, 'Energy');
  assert.equal(companies[0].geoEntityId, 'company:Q1215884');
  assert.deepEqual([...companies[0].securityIds].sort(), ['IN:BSE:500325', 'IN:NSE:RELIANCE']);
});

test('NEGATIVE CONTROL: two real companies that merely share a name are never merged — only CIK/ISIN identity merges', () => {
  const usPfizer = sec({ id: 'US:NYSE:PFE', name: 'Pfizer Inc.', market: 'US', exchange: 'NYSE', cik: '0000078003' });
  const inPfizer = sec({ id: 'IN:NSE:PFIZER', name: 'Pfizer Limited', market: 'IN', exchange: 'NSE', isin: 'INE182A01018' });
  const { companies } = nexus.buildCompanyIndex([usPfizer, inPfizer]);
  assert.equal(companies.length, 2, 'no shared CIK or ISIN => no merge, regardless of name similarity');
  assert.ok(companies.every((c) => c.crossListed === false));
});

test('100% company-identity coverage: every security resolves to a Company, even with neither CIK nor ISIN (never UNKNOWN)', () => {
  const bare = sec({ id: 'US:OTC:SHELLCO', name: 'Shell Co', market: 'US', exchange: 'OTC' }); // no cik supplied
  const { companies, securities } = nexus.buildCompanyIndex([bare]);
  assert.equal(companies.length, 1);
  assert.equal(companies[0].id, 'company:security:us:otc:shellco');
  assert.equal(companies[0].crossListed, false);
  assert.equal(securities[0].companyId, companies[0].id);
});

test('buildCompanyIndex never drops or duplicates an input security', () => {
  const rows = [
    sec({ id: 'US:NASDAQ:A', name: 'A Corp', market: 'US', exchange: 'NASDAQ', cik: '1' }),
    sec({ id: 'US:NYSE:B', name: 'B Corp', market: 'US', exchange: 'NYSE', cik: '2' }),
    sec({ id: 'IN:NSE:C', name: 'C Ltd', market: 'IN', exchange: 'NSE', isin: 'INE000000001' }),
    sec({ id: 'IN:BSE:999', name: 'C Ltd', market: 'IN', exchange: 'BSE', isin: 'INE000000001' }),
  ];
  const { securities, companies } = nexus.buildCompanyIndex(rows);
  assert.equal(securities.length, rows.length, 'every input row appears exactly once in the output');
  assert.deepEqual(securities.map((s) => s.id).sort(), rows.map((r) => r.id).sort());
  const totalSecurityIdsAcrossCompanies = companies.reduce((n, c) => n + c.securityIds.length, 0);
  assert.equal(totalSecurityIdsAcrossCompanies, rows.length, 'every security belongs to exactly one company');
});

test('reconcileAccounting: balanced counts pass, an undercount or overcount fails (zero silent drops)', () => {
  assert.equal(nexus.reconcileAccounting({ source: 'sec', fetched: 100, accepted: 97, duplicate: 2, rejected: 1 }).ok, true);
  assert.equal(nexus.reconcileAccounting({ source: 'sec', fetched: 100, accepted: 97, duplicate: 2, rejected: 0 }).ok, false, 'NEGATIVE CONTROL: an unaccounted-for row must fail reconciliation');
  assert.equal(nexus.reconcileAccounting({ source: 'sec', fetched: 100, accepted: 97, duplicate: 2, rejected: 5 }).ok, false, 'NEGATIVE CONTROL: double-counting must also fail reconciliation');
});

test('OTC and CBOE are real US exchanges now, not silently folded into the consolidated-tape marker', () => {
  const marketCore = require('../shared/market-core.js');
  assert.equal(marketCore.parseInstrument('US:OTC:SHELLCO').exchange, 'OTC');
  assert.equal(marketCore.parseInstrument('US:CBOE:XYZ').exchange, 'CBOE');
  assert.notEqual(marketCore.parseInstrument('US:OTC:SHELLCO').canonical, 'US:US:SHELLCO');
});
