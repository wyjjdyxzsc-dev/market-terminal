'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const render = require('../public/nexus.js');

test('renderNexusCompany shows coverage and an honest empty relationship state', () => {
  const html = render.renderNexusCompany({
    company: { id: 'US:NASDAQ:ZZZZ', name: 'Zzzz Corp', market: 'US', exchange: 'NASDAQ', enrichment: 'node-only', sector: '' },
    relationships: [],
    relationshipCount: 0,
    tier2: { abstained: true, reason: 'AI-extracted relationships are scoped to index-member companies for this checkpoint.' },
  });
  assert.match(html, /Zzzz Corp/);
  assert.match(html, /NODE-ONLY|node-only/i);
  assert.match(html, /No relationship evidence/i);
});

test('renderNexusCompany renders relationship rows with tier/strength/citation', () => {
  const html = render.renderNexusCompany({
    company: { id: 'US:NASDAQ:AAPL', name: 'Apple Inc.', market: 'US', exchange: 'NASDAQ', enrichment: 'geo-linked', sector: 'Technology' },
    relationships: [{
      sourceId: 'US:NASDAQ:QCOM', targetId: 'US:NASDAQ:AAPL', relation: 'supplier', tier: 1,
      confidence: 0.7, strength: 'confirmed',
      evidence: [{ source: 'SEC XBRL companyfacts', sourceUrl: 'https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json' }],
    }],
    relationshipCount: 1,
    tier2: { abstained: false, relationships: [] },
  });
  assert.match(html, /QCOM/);
  assert.match(html, /confirmed/i);
  assert.match(html, /data\.sec\.gov/);
});

test('renderNexusGraphSvg escapes company names and roots on the requested id', () => {
  const svg = render.renderNexusGraphSvg({
    nodes: [{ id: 'US:NASDAQ:AAPL', name: 'Apple <script>' }, { id: 'US:NASDAQ:QCOM', name: 'Qualcomm' }],
    edges: [{ sourceId: 'US:NASDAQ:QCOM', targetId: 'US:NASDAQ:AAPL', relation: 'supplier', strength: 'confirmed' }],
  }, 'US:NASDAQ:AAPL');
  assert.match(svg, /<svg/);
  assert.doesNotMatch(svg, /<script>/);
});
