// public/nexus.js
// NEXUS graph renderer — pure HTML/SVG-string builder, no DOM dependency, mirroring
// public/deepdive.js's contract so intel.js only mounts it and wires clicks.
(function () {
  'use strict';

  const NEXUS_RENDER_CONTRACT = '2026-09-22a';

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // Belt-and-suspenders SVG paint. The stylesheet's .nexus-graph-* rules use the
  // QUARTZ semantic tokens and win over these presentation attributes; the literals
  // keep the graph legible if the stylesheet ever drifts again (SVG <line> defaults
  // to stroke:none and <text>/<circle> to fill:black on this dark theme).
  const STRENGTH_PAINT = {
    confirmed: '#35c97d', // --positive
    reported: '#e8b25c',  // --warning
    inferred: '#5ec1e8',  // --info
  };
  const paintFor = (strength) => STRENGTH_PAINT[String(strength || '').toLowerCase()] || STRENGTH_PAINT.inferred;
  const NODE_PAINT = '#a6acb6';       // --text-secondary
  const NODE_ROOT_PAINT = '#e8b25c';  // --accent
  const LABEL_PAINT = '#e6e8eb';      // --text-primary

  function safeHttpUrl(value) {
    try {
      const url = new URL(String(value || ''));
      return /^https?:$/i.test(url.protocol) ? url.toString() : '';
    } catch { return ''; }
  }

  // Tier 2 is the live, AI-extracted, citation-gated layer; tiers 1/3 come from the
  // generated registry snapshot (SEC XBRL / Wikidata). The user must be able to tell
  // them apart at a glance, so the provenance is rendered, never implied.
  function tierOrigin(tier) {
    if (Number(tier) === 2) return { label: 'AI-extracted · cited', cls: 'nexus-edge-origin-ai' };
    if (Number(tier) === 3) return { label: 'registry · ownership', cls: 'nexus-edge-origin-registry' };
    return { label: 'registry · filings', cls: 'nexus-edge-origin-registry' };
  }

  function relationshipRow(edge, focalId) {
    const counterpartyId = edge.sourceId === focalId ? edge.targetId : edge.sourceId;
    const counterpartyName = String(edge.counterpartyName || '').trim();
    const direction = edge.sourceId === focalId ? `${edge.relation} to` : `${edge.relation} of`;
    const primaryEvidence = (Array.isArray(edge.evidence) ? edge.evidence : [])[0] || {};
    const url = safeHttpUrl(primaryEvidence.sourceUrl);
    const origin = tierOrigin(edge.tier);
    const confidencePct = Number.isFinite(Number(edge.confidence)) ? `${Math.round(Number(edge.confidence) * 100)}%` : '—';
    return `<div class="nexus-edge nexus-edge-${esc(edge.strength)} ${origin.cls}">
      <div class="nexus-edge-main">
        <span class="nexus-edge-counterparty num" data-nexus-open="${esc(counterpartyId)}" role="button" tabindex="0">${esc(counterpartyId)}</span>
        ${counterpartyName ? `<span class="nexus-edge-cpname">${esc(counterpartyName)}</span>` : ''}
        <span class="nexus-edge-direction">${esc(direction)}</span>
        <span class="nexus-edge-strength">${esc(edge.strength)} <span class="num">(${esc(confidencePct)})</span></span>
      </div>
      <div class="nexus-edge-evidence">
        ${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(primaryEvidence.source)}</a>` : esc(primaryEvidence.source || 'source unavailable')}
        <span class="nexus-edge-tier">tier ${esc(edge.tier)} · ${esc(origin.label)}</span>
      </div>
    </div>`;
  }

  // The real abstention shape: the two hand-built guards in server.js/worker.js set a
  // top-level `reason`, but the policy path (buildAbstention → policyMetadata) puts the
  // human-readable reason at `policy.reason`. Read both, prefer whichever is present.
  function abstentionReason(tier2) {
    const top = tier2 && typeof tier2.reason === 'string' ? tier2.reason.trim() : '';
    if (top) return top;
    const policy = tier2 && tier2.policy && typeof tier2.policy.reason === 'string' ? tier2.policy.reason.trim() : '';
    if (policy) return policy;
    const blockers = tier2 && tier2.policy && Array.isArray(tier2.policy.blockers) ? tier2.policy.blockers.filter(Boolean) : [];
    if (blockers.length) return blockers.join('; ');
    return 'policy abstained';
  }

  function renderNexusCompany(data) {
    const company = data && data.company;
    if (!company) return `<div class="nexus-empty">Company not found in the NEXUS registry.</div>`;
    const snapshotEdges = Array.isArray(data.relationships) ? data.relationships : [];
    const tier2 = data.tier2 || {};
    const tier2Edges = (!tier2.abstained && Array.isArray(tier2.relationships)) ? tier2.relationships : [];

    // Merge snapshot (tier-1/tier-3) and live tier-2 edges into one list. A tier-2 edge
    // that restates an edge the registry already carries is dropped in favour of the
    // sourced registry edge, so the same relationship is never shown twice.
    const seen = new Set(snapshotEdges.map((e) => `${e.sourceId}|${e.targetId}|${e.relation}`));
    const merged = snapshotEdges.slice();
    for (const edge of tier2Edges) {
      if (!edge || !edge.sourceId || !edge.targetId) continue;
      const key = `${edge.sourceId}|${edge.targetId}|${edge.relation}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(edge);
    }
    merged.sort((a, b) => (Number(b.confidence) || 0) - (Number(a.confidence) || 0));

    const relRows = merged.length
      ? merged.map((e) => relationshipRow(e, company.id)).join('')
      : `<div class="nexus-empty">No relationship evidence on record for ${esc(company.name)} yet.</div>`;

    const tier2Note = tier2.abstained
      ? `<div class="nexus-tier2-status">AI-extracted relationships unavailable: ${esc(abstentionReason(tier2))}</div>`
      : (tier2Edges.length
        ? `<div class="nexus-tier2-status nexus-tier2-ok">${tier2Edges.length} AI-extracted relationship${tier2Edges.length === 1 ? '' : 's'} included above, each bound to a cited source. Confidence and strength are computed deterministically, never taken from the model.</div>`
        : '');

    // MT2-5 → MT2-4 drill-through. ~2,155 registry nodes carry a geoEntityId; only those
    // can be shown on the ATLAS map, so the control appears only when one exists.
    const geoLink = company.geoEntityId
      ? `<button type="button" class="nexus-atlas-link" data-geo-entity="${esc(company.geoEntityId)}">View ${esc(company.symbol || company.name)} on the ATLAS map</button>`
      : '';

    return `<div class="nexus-report">
      <div class="nexus-head">
        <div class="nexus-name">${esc(company.name)}</div>
        <div class="nexus-id num">${esc(company.id)} · ${esc(company.sector || 'sector unclassified')}</div>
        <div class="nexus-enrichment nexus-enrichment-${esc(company.enrichment)}">${esc(company.enrichment).toUpperCase()}</div>
      </div>
      ${geoLink}
      <div class="nexus-relationships">${relRows}</div>
      ${tier2Note}
    </div>`;
  }

  function renderNexusGraphSvg(graph, rootId) {
    const nodes = Array.isArray(graph && graph.nodes) ? graph.nodes : [];
    const edges = Array.isArray(graph && graph.edges) ? graph.edges : [];
    const width = 640;
    const height = 360;
    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.min(width, height) / 2 - 60;
    const others = nodes.filter((n) => n.id !== rootId);
    const positions = new Map();
    positions.set(rootId, { x: cx, y: cy });
    others.forEach((n, i) => {
      const angle = (2 * Math.PI * i) / Math.max(1, others.length);
      positions.set(n.id, { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) });
    });
    const edgeLines = edges.map((e) => {
      const a = positions.get(e.sourceId);
      const b = positions.get(e.targetId);
      if (!a || !b) return '';
      const strength = String(e.strength || 'inferred');
      return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${paintFor(strength)}" stroke-width="1.4" stroke-opacity="0.75" class="nexus-graph-edge nexus-graph-edge-${esc(strength)}" />`;
    }).join('');
    const nodeCircles = nodes.map((n) => {
      const p = positions.get(n.id);
      if (!p) return '';
      const isRoot = n.id === rootId;
      return `<g class="nexus-graph-node${isRoot ? ' nexus-graph-node-root' : ''}">
        <circle cx="${p.x}" cy="${p.y}" r="${isRoot ? 10 : 6}" fill="${isRoot ? NODE_ROOT_PAINT : NODE_PAINT}" stroke="${isRoot ? NODE_ROOT_PAINT : NODE_PAINT}" stroke-width="1" />
        <text x="${p.x}" y="${p.y - 12}" text-anchor="middle" fill="${LABEL_PAINT}" font-size="10">${esc(n.name)}</text>
      </g>`;
    }).join('');
    const legend = `<g class="nexus-graph-legend">` + ['confirmed', 'reported', 'inferred'].map((s, i) => {
      const y = 14 + i * 14;
      return `<line x1="10" y1="${y}" x2="26" y2="${y}" stroke="${paintFor(s)}" stroke-width="2" class="nexus-graph-edge nexus-graph-edge-${s}" />` +
        `<text x="32" y="${y + 3.5}" fill="${LABEL_PAINT}" font-size="9">${s}</text>`;
    }).join('') + `</g>`;
    return `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" class="nexus-graph-svg" role="img" aria-label="NEXUS relationship graph">${edgeLines}${nodeCircles}${legend}</svg>`;
  }

  const api = { NEXUS_RENDER_CONTRACT, renderNexusCompany, renderNexusGraphSvg, safeHttpUrl, abstentionReason };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalThis.MarketTerminalNexusRender = api;
})();
