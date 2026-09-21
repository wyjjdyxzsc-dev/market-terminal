'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const render = require('../public/nexus.js');

const TIER1_EDGE = {
  sourceId: 'US:NASDAQ:QCOM', targetId: 'US:NASDAQ:AAPL', relation: 'supplier', tier: 1,
  confidence: 0.7, strength: 'confirmed',
  evidence: [{ source: 'SEC XBRL companyfacts', sourceUrl: 'https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json' }],
};

// Shaped exactly like a live tier-2 edge: it goes through the same
// nexusCore.createRelationshipEdge() as tier-1/tier-3, plus counterpartyName.
const TIER2_EDGE = {
  sourceId: 'US:NASDAQ:AAPL', targetId: 'US:NASDAQ:AVGO', relation: 'supplier', tier: 2,
  confidence: 0.42, strength: 'reported', counterpartyName: 'Broadcom Inc.',
  evidence: [{ source: 'Reuters', sourceUrl: 'https://www.reuters.com/technology/apple-broadcom-deal', observedAt: '2026-09-18T12:00:00.000Z', note: 'Apple expands Broadcom chip agreement' }],
};

const APPLE = { id: 'US:NASDAQ:AAPL', name: 'Apple Inc.', market: 'US', exchange: 'NASDAQ', symbol: 'AAPL', enrichment: 'geo-linked', sector: 'Technology' };

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
    company: APPLE,
    relationships: [TIER1_EDGE],
    relationshipCount: 1,
    tier2: { abstained: false, relationships: [] },
  });
  assert.match(html, /QCOM/);
  assert.match(html, /confirmed/i);
  assert.match(html, /data\.sec\.gov/);
});

// C1 regression: the live AI-extracted layer must actually reach the rendered list.
test('renderNexusCompany merges tier-2 AI-extracted edges into the relationship list', () => {
  const html = render.renderNexusCompany({
    company: APPLE,
    relationships: [TIER1_EDGE],
    relationshipCount: 1,
    tier2: { abstained: false, relationships: [TIER2_EDGE] },
  });
  assert.match(html, /US:NASDAQ:AVGO/, 'tier-2 counterparty id is rendered');
  assert.match(html, /Broadcom Inc\./, 'tier-2 counterparty name is rendered');
  assert.match(html, /reuters\.com/, 'tier-2 citation is rendered');
  assert.match(html, /tier 2/, 'tier-2 provenance is labelled');
  assert.match(html, /AI-extracted/, 'the AI provenance is explicit, not implied');
  // The snapshot edge is still there — tier-2 augments, never replaces.
  assert.match(html, /QCOM/);
  assert.doesNotMatch(html, /No relationship evidence/i);
});

test('renderNexusCompany renders tier-2 edges even when the registry has no snapshot edges', () => {
  const html = render.renderNexusCompany({
    company: APPLE, relationships: [], relationshipCount: 0,
    tier2: { abstained: false, relationships: [TIER2_EDGE] },
  });
  assert.match(html, /US:NASDAQ:AVGO/);
  assert.doesNotMatch(html, /No relationship evidence/i);
});

test('renderNexusCompany does not render tier-2 edges when the policy abstained', () => {
  const html = render.renderNexusCompany({
    company: APPLE, relationships: [], relationshipCount: 0,
    tier2: { abstained: true, reason: 'no provider', relationships: [TIER2_EDGE] },
  });
  assert.doesNotMatch(html, /US:NASDAQ:AVGO/);
  assert.match(html, /No relationship evidence/i);
});

test('renderNexusCompany does not show the same relationship twice', () => {
  const dup = { ...TIER2_EDGE, sourceId: TIER1_EDGE.sourceId, targetId: TIER1_EDGE.targetId, relation: TIER1_EDGE.relation };
  const html = render.renderNexusCompany({
    company: APPLE, relationships: [TIER1_EDGE], relationshipCount: 1,
    tier2: { abstained: false, relationships: [dup] },
  });
  assert.equal((html.match(/nexus-edge-counterparty/g) || []).length, 1);
});

// I4 regression: the policy path puts the reason at policy.reason, not top-level.
test('abstention reason is read from policy.reason when there is no top-level reason', () => {
  const html = render.renderNexusCompany({
    company: APPLE, relationships: [], relationshipCount: 0,
    tier2: {
      abstained: true,
      degraded: true,
      policy: { taskId: 'intel.supply-chain', status: 'abstained', reason: 'No policy-approved AI provider is currently available for this task.', blockers: [] },
    },
  });
  assert.match(html, /No policy-approved AI provider is currently available/);
  assert.doesNotMatch(html, /policy abstained/);
});

test('abstention falls back to blockers, then to a generic note', () => {
  assert.equal(render.abstentionReason({ abstained: true, reason: 'top level wins' }), 'top level wins');
  assert.equal(render.abstentionReason({ abstained: true, policy: { reason: '', blockers: ['stale evidence', 'one source'] } }), 'stale evidence; one source');
  assert.equal(render.abstentionReason({ abstained: true }), 'policy abstained');
});

// I9 regression: NEXUS → ATLAS drill-through.
test('renderNexusCompany links to the ATLAS map only when the node carries a geoEntityId', () => {
  const linked = render.renderNexusCompany({
    company: { ...APPLE, geoEntityId: 'company:Q312' }, relationships: [], relationshipCount: 0, tier2: { abstained: false, relationships: [] },
  });
  assert.match(linked, /data-geo-entity="company:Q312"/);
  assert.match(linked, /ATLAS map/);

  const unlinked = render.renderNexusCompany({ company: APPLE, relationships: [], relationshipCount: 0, tier2: {} });
  assert.doesNotMatch(unlinked, /data-geo-entity/);
});

test('renderNexusGraphSvg escapes company names and roots on the requested id', () => {
  const svg = render.renderNexusGraphSvg({
    nodes: [{ id: 'US:NASDAQ:AAPL', name: 'Apple <script>' }, { id: 'US:NASDAQ:QCOM', name: 'Qualcomm' }],
    edges: [{ sourceId: 'US:NASDAQ:QCOM', targetId: 'US:NASDAQ:AAPL', relation: 'supplier', strength: 'confirmed' }],
  }, 'US:NASDAQ:AAPL');
  assert.match(svg, /<svg/);
  assert.doesNotMatch(svg, /<script>/);
});

// C2 regression: SVG primitives default to stroke:none / fill:black, which is invisible
// on this theme. The renderer must paint them inline as well as by class.
test('renderNexusGraphSvg paints edges and nodes inline, colour-coded by strength', () => {
  const svg = render.renderNexusGraphSvg({
    nodes: [{ id: 'A', name: 'Alpha' }, { id: 'B', name: 'Beta' }, { id: 'C', name: 'Gamma' }],
    edges: [
      { sourceId: 'A', targetId: 'B', relation: 'supplier', strength: 'confirmed' },
      { sourceId: 'A', targetId: 'C', relation: 'customer', strength: 'inferred' },
    ],
  }, 'A');
  assert.match(svg, /<line[^>]*stroke="#35c97d"/, 'confirmed edges use the positive token colour');
  assert.match(svg, /<line[^>]*stroke="#5ec1e8"/, 'inferred edges use the info token colour');
  assert.match(svg, /<circle[^>]*fill="#e8b25c"/, 'the root node is painted with the accent colour');
  assert.match(svg, /<text[^>]*fill="#e6e8eb"/, 'labels are painted on the dark theme');
  assert.doesNotMatch(svg, /<line(?![^>]*stroke=)[^>]*\/>/, 'no line is left unpainted');
});

// C2 regression: the panel had zero CSS at the final review — every class the renderer
// emits must have a real rule in the stylesheet, or the report renders unstyled and the
// graph invisible.
test('public/style.css defines a rule for every class public/nexus.js emits', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'nexus.js'), 'utf8');

  // Every literal class token that appears in a class="..." attribute the renderer emits.
  const emitted = new Set();
  for (const m of js.matchAll(/class="([^"$]*?)"/g)) {
    for (const token of m[1].split(/\s+/)) if (token.startsWith('nexus-')) emitted.add(token);
  }
  // Template-interpolated variants the renderer builds at runtime.
  for (const token of [
    'nexus-edge-confirmed', 'nexus-edge-reported', 'nexus-edge-inferred',
    'nexus-enrichment-geo-linked', 'nexus-enrichment-node-only',
    'nexus-graph-edge-confirmed', 'nexus-graph-edge-reported', 'nexus-graph-edge-inferred',
    'nexus-edge-origin-ai', 'nexus-edge-origin-registry', 'nexus-tier2-ok',
  ]) emitted.add(token);
  emitted.add('sc-body'); // the panel container in index.html

  assert.ok(emitted.size >= 18, `expected the renderer's class inventory, got ${emitted.size}`);
  const missing = [...emitted].filter((c) => !css.includes(`.${c}`));
  assert.deepEqual(missing, [], `style.css has no rule for: ${missing.join(', ')}`);
});
