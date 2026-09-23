'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../shared/launchpad-core.js');

const feed = { ipoCalendar: [
  { date: '2026-09-30', exchange: 'NASDAQ Global Select', name: 'Example One', symbol: 'EXM', status: 'expected', price: '18-20', numberOfShares: 2000000, totalSharesValue: 38000000 },
  { date: '2026-10-02', exchange: 'NASDAQ Capital', name: 'Example Two', symbol: 'TWO', status: 'expected', numberOfShares: 0, totalSharesValue: 0 },
  { date: '2026-10-02', exchange: 'NYSE', name: 'Example Three', symbol: 'THR', status: 'filed' },
  { date: 'bad', exchange: 'NASDAQ', name: 'Invalid', symbol: 'BAD' },
] };

test('IPO normalization preserves observed fields and rejects missing values rather than zero-filling', () => {
  const events = core.normalizeCalendar(feed, { asOf: '2026-09-23T00:00:00Z' });
  assert.equal(events.length, 3);
  const exm = events.find(e => e.symbol === 'EXM');
  assert.equal(exm.exchange, 'NASDAQ');
  assert.equal(exm.totalSharesValue, 38000000);
  assert.equal(exm.source.retrievedAt, '2026-09-23T00:00:00Z');
  assert.equal(events.find(e => e.symbol === 'TWO').totalSharesValue, null);
});

test('impact graph uses measured shared venue/window and sourced NEXUS edges without inferred impact', () => {
  const events = core.normalizeCalendar(feed);
  const exm = events.find(e => e.symbol === 'EXM');
  const graph = core.buildImpactGraph(events, exm.id,
    [{ id: 'US:NASDAQ:EXM', market: 'US', exchange: 'NASDAQ', symbol: 'EXM' }, { id: 'US:NASDAQ:SUP', market: 'US', exchange: 'NASDAQ', symbol: 'SUP' }],
    [{ sourceId: 'US:NASDAQ:EXM', targetId: 'US:NASDAQ:SUP', relation: 'supplier', evidence: [{ sourceUrl: 'https://www.sec.gov/example' }] }]);
  assert.ok(graph.edges.some(e => e.type === 'shared_venue_window' && e.targetId.includes('TWO')));
  assert.ok(!graph.edges.some(e => e.targetId.includes('THR')));
  assert.ok(graph.edges.some(e => e.type === 'supplier'));
  assert.match(graph.limits.join(' '), /no price impact/);
});

test('unsupported India calendar never re-labels US records as India', () => {
  const events = core.normalizeCalendar(feed, { market: 'IN' });
  assert.deepEqual(events, []);
});
