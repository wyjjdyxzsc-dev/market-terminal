(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MarketTerminalLaunchpad = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const SCHEMA_VERSION = '2026-09-23a';
  const DAY = 86400000;
  const clean = (v, max = 120) => String(v == null ? '' : v).trim().slice(0, max);
  const finitePositive = (v) => Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null;
  function venue(raw) {
    const s = clean(raw, 80).toUpperCase();
    if (s.includes('NASDAQ')) return 'NASDAQ';
    if (s.includes('NYSE')) return 'NYSE';
    if (s.includes('NSE')) return 'NSE';
    if (s.includes('BSE')) return 'BSE';
    return '';
  }
  function normalizeCalendar(raw, { market = 'US', asOf = new Date().toISOString() } = {}) {
    const rows = Array.isArray(raw && raw.ipoCalendar) ? raw.ipoCalendar : [];
    const unique = new Map();
    for (const row of rows) {
      if (!row || !/^\d{4}-\d{2}-\d{2}$/.test(row.date || '') || !Number.isFinite(Date.parse(row.date + 'T00:00:00Z'))) continue;
      const exchange = venue(row.exchange);
      if (market === 'US' && !['NASDAQ', 'NYSE', ''].includes(exchange)) continue;
      if (market === 'IN' && !['NSE', 'BSE'].includes(exchange)) continue;
      const symbol = clean(row.symbol, 24).toUpperCase();
      const name = clean(row.name, 160);
      if (!name) continue;
      const status = clean(row.status, 32).toLowerCase();
      const numberOfShares = finitePositive(row.numberOfShares);
      const totalSharesValue = finitePositive(row.totalSharesValue);
      const event = {
        id: `${market}:${row.date}:${symbol || name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 30)}`,
        market, date: row.date, name, symbol: symbol || null, exchange: exchange || null,
        exchangeLabel: clean(row.exchange, 80) || null,
        status: status || 'unknown', priceRange: clean(row.price, 60) || null,
        numberOfShares, totalSharesValue,
        currency: market === 'IN' ? 'INR' : 'USD',
        source: { name: 'Finnhub IPO Calendar', url: 'https://finnhub.io/docs/api/ipo-calendar', retrievedAt: asOf },
        truth: 'SNAPSHOT',
      };
      unique.set(event.id, event);
    }
    return [...unique.values()].sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name));
  }
  function buildImpactGraph(events, selectedId, registry = [], relationships = []) {
    const selected = events.find((e) => e.id === selectedId);
    if (!selected) return { nodes: [], edges: [], limits: ['Choose a calendar event.'] };
    const nodes = [{ id: selected.id, label: selected.symbol || selected.name, type: 'ipo', event: selected }];
    const edges = [];
    // Co-scheduling is a measured calendar relationship, not a claimed price effect.
    const peers = events.filter((e) => e.id !== selected.id && e.exchange && e.exchange === selected.exchange && Math.abs(Date.parse(e.date) - Date.parse(selected.date)) <= 7 * DAY).slice(0, 8);
    for (const peer of peers) {
      nodes.push({ id: peer.id, label: peer.symbol || peer.name, type: 'calendar', event: peer });
      edges.push({ sourceId: selected.id, targetId: peer.id, type: 'shared_venue_window', label: 'Same venue · within 7 days', evidence: peer.source });
    }
    const matched = selected.symbol && registry.find((c) => c.market === selected.market && c.symbol === selected.symbol && (!selected.exchange || c.exchange === selected.exchange));
    if (matched) {
      nodes.push({ id: matched.id, label: matched.symbol, type: 'listed_security', canonical: matched.id });
      edges.push({ sourceId: selected.id, targetId: matched.id, type: 'ticker_match', label: 'Ticker and venue match · verify issuer identity', evidence: null });
      for (const rel of relationships.filter((r) => r.sourceId === matched.id || r.targetId === matched.id).slice(0, 6)) {
        const id = rel.sourceId === matched.id ? rel.targetId : rel.sourceId;
        const other = registry.find((c) => c.id === id);
        if (!other || !Array.isArray(rel.evidence) || !rel.evidence.some((e) => /^https:\/\//.test(e.sourceUrl || ''))) continue;
        nodes.push({ id, label: other.symbol, type: 'listed_security', canonical: id });
        edges.push({ sourceId: matched.id, targetId: id, type: rel.relation, label: rel.relation, evidence: rel.evidence[0] });
      }
    }
    return { nodes, edges, limits: [
      'Co-scheduled offerings indicate calendar overlap only; no price impact, investor demand, or causal relationship is inferred.',
      matched ? 'A ticker and venue match is provisional until issuer identity is confirmed.' : 'No listed-security identity is confirmed for this event.',
    ] };
  }
  return { SCHEMA_VERSION, normalizeCalendar, buildImpactGraph };
});
