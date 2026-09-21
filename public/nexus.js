// public/nexus.js
// NEXUS graph renderer — pure HTML/SVG-string builder, no DOM dependency, mirroring
// public/deepdive.js's contract so intel.js only mounts it and wires clicks.
(function () {
  'use strict';

  const NEXUS_RENDER_CONTRACT = '2026-09-20a';

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function safeHttpUrl(value) {
    try {
      const url = new URL(String(value || ''));
      return /^https?:$/i.test(url.protocol) ? url.toString() : '';
    } catch { return ''; }
  }

  function relationshipRow(edge, focalId) {
    const counterparty = edge.sourceId === focalId ? edge.targetId : edge.sourceId;
    const direction = edge.sourceId === focalId ? `${edge.relation} to` : `${edge.relation} of`;
    const primaryEvidence = edge.evidence[0] || {};
    const url = safeHttpUrl(primaryEvidence.sourceUrl);
    return `<div class="nexus-edge nexus-edge-${esc(edge.strength)}">
      <div class="nexus-edge-main">
        <span class="nexus-edge-counterparty">${esc(counterparty)}</span>
        <span class="nexus-edge-direction">${esc(direction)}</span>
        <span class="nexus-edge-strength">${esc(edge.strength)} (${Math.round(edge.confidence * 100)}%)</span>
      </div>
      <div class="nexus-edge-evidence">
        ${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(primaryEvidence.source)}</a>` : esc(primaryEvidence.source || 'source unavailable')}
        <span class="nexus-edge-tier">tier ${esc(edge.tier)}</span>
      </div>
    </div>`;
  }

  function renderNexusCompany(data) {
    const company = data && data.company;
    if (!company) return `<div class="nexus-empty">Company not found in the NEXUS registry.</div>`;
    const relationships = Array.isArray(data.relationships) ? data.relationships : [];
    const tier2 = data.tier2 || {};
    const relRows = relationships.length
      ? relationships.map((e) => relationshipRow(e, company.id)).join('')
      : `<div class="nexus-empty">No relationship evidence on record for ${esc(company.name)} yet.</div>`;
    const tier2Note = tier2.abstained
      ? `<div class="nexus-tier2-status">AI-extracted relationships unavailable: ${esc(tier2.reason || 'policy abstained')}</div>`
      : '';
    return `<div class="nexus-report">
      <div class="nexus-head">
        <div class="nexus-name">${esc(company.name)}</div>
        <div class="nexus-id">${esc(company.id)} · ${esc(company.sector || 'sector unclassified')}</div>
        <div class="nexus-enrichment nexus-enrichment-${esc(company.enrichment)}">${esc(company.enrichment).toUpperCase()}</div>
      </div>
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
      return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" class="nexus-graph-edge nexus-graph-edge-${esc(e.strength || 'inferred')}" />`;
    }).join('');
    const nodeCircles = nodes.map((n) => {
      const p = positions.get(n.id);
      if (!p) return '';
      return `<g class="nexus-graph-node${n.id === rootId ? ' nexus-graph-node-root' : ''}">
        <circle cx="${p.x}" cy="${p.y}" r="${n.id === rootId ? 10 : 6}" />
        <text x="${p.x}" y="${p.y - 12}" text-anchor="middle">${esc(n.name)}</text>
      </g>`;
    }).join('');
    return `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" class="nexus-graph-svg">${edgeLines}${nodeCircles}</svg>`;
  }

  const api = { NEXUS_RENDER_CONTRACT, renderNexusCompany, renderNexusGraphSvg, safeHttpUrl };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalThis.MarketTerminalNexusRender = api;
})();
