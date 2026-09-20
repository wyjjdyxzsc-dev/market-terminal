(() => {
  'use strict';

  // MT2-5 NEXUS — canonical public-company registry + evidence-backed relationship
  // graph, shared by Express, the Worker and the browser. Pure: no I/O, no DOM.
  // Mirrors shared/atlas-core.js's conventions (frozen records, required evidence,
  // canonical TWINCORE ids). The generated dataset lives in shared/nexus-snapshot.js.

  const NEXUS_SCHEMA_VERSION = '2026-09-20a';

  const marketCore = (typeof module !== 'undefined' && module.exports)
    ? require('./market-core.js')
    : globalThis.MarketTerminalMarket;

  const RELATION_TYPES = Object.freeze(['supplier', 'customer', 'competitor', 'ownership']);
  const ENRICHMENT_TIERS = Object.freeze(['geo-linked', 'node-only']);
  const TIERS = Object.freeze([1, 2, 3]);

  const TIER_WEIGHT = Object.freeze({ 1: 0.55, 2: 0.3, 3: 0.45 });
  const SOURCE_BONUS_CAP = 0.3;
  const SOURCE_BONUS_PER = 0.1;
  const RECENCY_HALF_LIFE_DAYS = 365;

  function isoOrNull(value) {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.valueOf()) ? null : d.toISOString();
  }

  function normalizeEvidence(input) {
    if (!input || typeof input !== 'object') return null;
    const source = String(input.source || '').trim();
    const sourceUrl = String(input.sourceUrl || '').trim();
    const datasetId = String(input.datasetId || '').trim();
    if (!source || (!sourceUrl && !datasetId)) return null;
    if (sourceUrl && !/^https?:\/\//i.test(sourceUrl)) return null;
    return Object.freeze({
      source, sourceUrl, datasetId,
      observedAt: isoOrNull(input.observedAt),
      note: String(input.note || ''),
    });
  }

  // ───────────────────────── CompanyNode ─────────────────────────

  function validateCompanyNode(input) {
    const errors = [];
    const c = input && typeof input === 'object' ? input : {};
    const parsed = marketCore.parseInstrument(String(c.id || ''), c.market);
    if (!parsed || parsed.canonical !== String(c.id || '').toUpperCase()) {
      errors.push(`id must be a canonical MARKET:EXCHANGE:SYMBOL (got ${c.id})`);
    }
    if (!String(c.name || '').trim()) errors.push('name is required');
    if (!ENRICHMENT_TIERS.includes(c.enrichment)) errors.push(`enrichment must be one of ${ENRICHMENT_TIERS.join('|')}`);
    const evidence = (Array.isArray(c.sourceEvidence) ? c.sourceEvidence : []).map(normalizeEvidence).filter(Boolean);
    if (!evidence.length) errors.push('at least one sourceEvidence entry (source + url or datasetId) is required');
    return { ok: errors.length === 0, errors, evidence, parsed };
  }

  function createCompanyNode(input) {
    const v = validateCompanyNode(input);
    if (!v.ok) throw new Error(`CompanyNode rejected: ${v.errors.join('; ')}`);
    return Object.freeze({
      id: v.parsed.canonical,
      market: v.parsed.market,
      exchange: v.parsed.exchange,
      symbol: v.parsed.symbol,
      name: String(input.name).trim(),
      enrichment: input.enrichment,
      sector: String(input.sector || ''),
      cik: String(input.cik || ''),
      isin: String(input.isin || ''),
      geoEntityId: String(input.geoEntityId || ''),
      sourceEvidence: Object.freeze(v.evidence),
    });
  }

  // ───────────────────────── RelationshipEdge ─────────────────────────

  function validateRelationshipEdge(input) {
    const errors = [];
    const e = input && typeof input === 'object' ? input : {};
    const source = marketCore.parseInstrument(String(e.sourceId || ''));
    const target = marketCore.parseInstrument(String(e.targetId || ''));
    if (!source || source.canonical !== String(e.sourceId || '').toUpperCase()) errors.push(`sourceId must be canonical (got ${e.sourceId})`);
    if (!target || target.canonical !== String(e.targetId || '').toUpperCase()) errors.push(`targetId must be canonical (got ${e.targetId})`);
    if (!RELATION_TYPES.includes(e.relation)) errors.push(`relation must be one of ${RELATION_TYPES.join('|')}`);
    if (!TIERS.includes(e.tier)) errors.push(`tier must be one of ${TIERS.join('|')}`);
    const evidence = (Array.isArray(e.evidence) ? e.evidence : []).map(normalizeEvidence).filter(Boolean);
    if (!evidence.length) errors.push('at least one evidence entry (source + url or datasetId) is required');
    return { ok: errors.length === 0, errors, evidence, source, target };
  }

  function createRelationshipEdge(input) {
    const v = validateRelationshipEdge(input);
    if (!v.ok) throw new Error(`RelationshipEdge rejected: ${v.errors.join('; ')}`);
    const mostRecent = v.evidence.map((ev) => ev.observedAt).filter(Boolean).sort().pop() || null;
    const rating = computeConfidence({ tier: input.tier, sourceCount: v.evidence.length, recency: mostRecent });
    return Object.freeze({
      sourceId: v.source.canonical,
      targetId: v.target.canonical,
      relation: input.relation,
      tier: input.tier,
      evidence: Object.freeze(v.evidence),
      confidence: rating.confidence,
      strength: rating.strength,
    });
  }

  // ───────────────────────── rating ─────────────────────────

  function computeConfidence({ tier, sourceCount, recency }) {
    const base = TIER_WEIGHT[tier] || 0.2;
    const sourceBonus = Math.min(SOURCE_BONUS_CAP, Math.max(0, (Number(sourceCount) || 0) - 1) * SOURCE_BONUS_PER);
    let recencyFactor = 0.7; // unknown recency: mild penalty, not zero
    const observed = Date.parse(recency || '');
    if (Number.isFinite(observed)) {
      const ageDays = Math.max(0, (Date.now() - observed) / 86_400_000);
      recencyFactor = Math.pow(0.5, ageDays / RECENCY_HALF_LIFE_DAYS);
    }
    const confidence = Math.max(0, Math.min(1, (base + sourceBonus) * (0.5 + 0.5 * recencyFactor)));
    const strength = confidence >= 0.65 ? 'confirmed' : confidence >= 0.35 ? 'reported' : 'inferred';
    return { confidence: Math.round(confidence * 1000) / 1000, strength };
  }

  // ───────────────────────── coverage ─────────────────────────

  function registryCoverage(companies) {
    const byMarket = {};
    let geoLinked = 0;
    let nodeOnly = 0;
    for (const c of companies || []) {
      byMarket[c.market] = byMarket[c.market] || { total: 0, geoLinked: 0, nodeOnly: 0 };
      byMarket[c.market].total += 1;
      if (c.enrichment === 'geo-linked') { byMarket[c.market].geoLinked += 1; geoLinked += 1; }
      else { byMarket[c.market].nodeOnly += 1; nodeOnly += 1; }
    }
    const totalCompanies = (companies || []).length;
    return {
      totalCompanies,
      geoLinked,
      nodeOnly,
      pctGeoLinked: totalCompanies ? Math.round((geoLinked / totalCompanies) * 1000) / 10 : 0,
      byMarket,
    };
  }

  // ───────────────────────── graph traversal ─────────────────────────

  function filterGraph(companies, edges, { rootId, depth = 1, maxNodes = 50 } = {}) {
    const byId = new Map((companies || []).map((c) => [c.id, c]));
    if (!rootId || !byId.has(rootId)) return { nodes: [], edges: [] };
    const adjacency = new Map();
    for (const e of edges || []) {
      if (!adjacency.has(e.sourceId)) adjacency.set(e.sourceId, []);
      if (!adjacency.has(e.targetId)) adjacency.set(e.targetId, []);
      adjacency.get(e.sourceId).push(e);
      adjacency.get(e.targetId).push(e);
    }
    const visited = new Set([rootId]);
    const includedEdges = [];
    let frontier = [rootId];
    for (let d = 0; d < Math.max(1, depth) && visited.size < maxNodes; d += 1) {
      const next = [];
      for (const nodeId of frontier) {
        for (const edge of adjacency.get(nodeId) || []) {
          const neighbor = edge.sourceId === nodeId ? edge.targetId : edge.sourceId;
          if (!includedEdges.includes(edge)) includedEdges.push(edge);
          if (!visited.has(neighbor) && visited.size < maxNodes && byId.has(neighbor)) {
            visited.add(neighbor);
            next.push(neighbor);
          }
        }
      }
      frontier = next;
    }
    return {
      nodes: [...visited].map((id) => byId.get(id)).filter(Boolean),
      edges: includedEdges.filter((e) => visited.has(e.sourceId) && visited.has(e.targetId)),
    };
  }

  function nexusCacheKey(...parts) {
    return 'nexus:' + parts.map((p) => String(p)).join(':');
  }

  const api = {
    NEXUS_SCHEMA_VERSION, RELATION_TYPES, ENRICHMENT_TIERS, TIERS,
    createCompanyNode, createRelationshipEdge, computeConfidence,
    registryCoverage, filterGraph, nexusCacheKey,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalThis.MarketTerminalNexus = api;
})();
