(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MarketTerminalLaunchpad = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const SCHEMA_VERSION = '2026-09-23b';
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
  const SEBI_FAMILIES = Object.freeze({
    10: 'DRAFT_OFFER_DOCUMENT', 11: 'RED_HERRING_DOCUMENT',
    12: 'FINAL_OFFER_DOCUMENT', 78: 'OTHER_PUBLIC_ISSUE_DOCUMENT',
  });
  const SEBI_POLICY = 'https://www.sebi.gov.in/website-policy.html';
  function decodeHtml(s) {
    return String(s || '').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_m, x) => {
      const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
      if (x[0] === '#') return String.fromCodePoint(parseInt(x[1].toLowerCase() === 'x' ? x.slice(2) : x.slice(1), x[1].toLowerCase() === 'x' ? 16 : 10));
      return named[x.toLowerCase()] || ' ';
    });
  }
  function validSourceUrl(value, host = 'www.sebi.gov.in') {
    try { const u = new URL(String(value || '')); return u.protocol === 'https:' && u.hostname === host && u.pathname.startsWith('/filings/public-issues/') ? u.toString() : ''; } catch { return ''; }
  }
  function parseSeBIListing(html, family, retrievedAt) {
    const kind = SEBI_FAMILIES[family];
    if (!kind || typeof html !== 'string' || !/<table\b[^>]*id=['"]sample_1['"]/i.test(html) || !/<th[^>]*>\s*Date\s*<\/th>/i.test(html) || !/<th[^>]*>\s*Title\s*<\/th>/i.test(html)) throw new Error('SEBI listing structure invalid');
    const table = html.match(/<table\b[^>]*id=['"]sample_1['"][^>]*>[\s\S]*?<\/table>/i)?.[0];
    const body = table?.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i)?.[1];
    if (body == null) throw new Error('SEBI listing body missing');
    const rows = [...body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
    if (!rows.length) throw new Error('SEBI listing returned suspicious zero records');
    const out = [];
    for (const row of rows) {
      const dateRaw = row[1].match(/<td[^>]*>\s*([^<]+?)\s*<\/td>/i)?.[1]?.trim() || '';
      const a = row[1].match(/<a\b[^>]*href="([^"]+)"[^>]*>/i);
      const href = validSourceUrl(decodeHtml(a?.[1]));
      // SEBI embeds literal <br><a ...> markup inside the title attribute; a
      // tag regex ending at the first '>' truncates it. Anchor on class instead.
      const titleRaw = row[1].match(/\btitle="([\s\S]*?)"\s+class="points"/i)?.[1] || '';
      const title = clean(decodeHtml(titleRaw.split(/<br\s*\/?\s*>/i)[0].replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' '), 200);
      const m = dateRaw.match(/^([A-Za-z]{3})\s+(\d{1,2}),\s+(\d{4})$/);
      const month = m ? ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].indexOf(m[1]) + 1 : 0;
      const date = month ? `${m[3]}-${String(month).padStart(2, '0')}-${m[2].padStart(2, '0')}` : '';
      out.push({ family: Number(family), sourceType: kind, title, date, url: href, retrievedAt });
    }
    if (out.length !== rows.length || out.length > 25 || out.every(x => !x.url)) throw new Error('SEBI listing parse anomaly');
    return out;
  }
  function issuerFromTitle(title) {
    return clean(String(title || '').split(/\s+[–—-]\s+(?:addendum|corrigendum|second addendum|updated|amended|withdrawal|withdrawn|postponed|deferred|drhp|udrhp|rhp|red herring|draft|prospectus|price band|final offer)/i)[0].replace(/\s+/g, ' '), 160);
  }
  function issuerKey(name) {
    return clean(name, 160).toUpperCase().replace(/&|\bAND\b/g, 'AND').replace(/\bLIMITED\b|\bLTD\b/g, 'LIMITED').replace(/[^A-Z0-9]/g, '');
  }
  function filingState(row) {
    const t = row.title.toLowerCase();
    if (/withdrawn|withdrawal/.test(t)) return 'WITHDRAWN';
    if (/postponed|deferred/.test(t)) return 'POSTPONED';
    if (/price\s*band/.test(t)) return 'PRICE_RANGE_ANNOUNCED';
    if (/corrigendum|addendum|amendment|updated/.test(t)) return 'UPDATED_FILING';
    if (row.family === 10) return 'DRAFT_FILED';
    if (row.family === 11 || row.family === 12) return 'FILED';
    return null;
  }
  function blankIndiaIpo(name, key) {
    return {
      id: `IN:IPO:${key}`, market: 'IN', currency: 'INR', name, symbol: null, proposedTicker: null,
      exchange: null, exchangeLabel: null, sector: null, industry: null, leadBanks: [], isin: null,
      date: null, expectedListingDate: null, confirmedListingDate: null,
      reportedIssueWindow: null, officialIssueWindow: null,
      offer: { issueSize: null, freshIssue: null, offerForSale: null, composition: 'UNKNOWN', sharesOffered: null, priceBand: null, finalPrice: null, valuation: null, minimumLot: null, useOfProceeds: null, brlms: [] },
      status: 'UNKNOWN', rawStatus: null, phase: 'upcoming', timeline: [], evidence: [],
      ratings: { dataConfidence: 'UNKNOWN', sectorImpact: 'UNKNOWN', competitiveImpact: 'UNKNOWN', supplyChainImpact: 'UNKNOWN', marketAttention: 'UNKNOWN', executionRisk: 'UNKNOWN' },
      nexus: { state: 'UNKNOWN', securities: [], companyId: null }, atlas: { state: 'UNKNOWN', geoEntityId: null },
      truth: 'SNAPSHOT',
    };
  }
  function buildIndiaRegistry(records, { previous = [], retrievedAt = new Date().toISOString() } = {}) {
    if (!Array.isArray(records) || !records.length) throw new Error('SEBI source returned suspicious zero records');
    const accounting = { fetched: records.length, accepted: 0, duplicates: 0, excluded: 0, unresolved: 0, errors: 0, byFamily: {} };
    const byKey = new Map();
    for (const old of previous) if (old && old.market === 'IN' && old.name && Array.isArray(old.timeline)) {
      const key = issuerKey(old.name), current = byKey.get(key), copy = current || structuredClone(old);
      copy.id = `IN:IPO:${key}`;
      if (current) for (const item of old.timeline) if (!copy.timeline.some(t => t.source.url === item.source.url)) { copy.timeline.push(item); copy.evidence.push(item.source); }
      byKey.set(key, copy);
    }
    const seenThisBuild = new Set();
    for (const row of records.slice().sort((a,b) => String(a.date).localeCompare(String(b.date)))) {
      const group = accounting.byFamily[row.family] ||= { fetched: 0, accepted: 0, duplicates: 0, excluded: 0, unresolved: 0, errors: 0 };
      group.fetched++;
      if (!SEBI_FAMILIES[row.family] || !row.title || !/^\d{4}-\d{2}-\d{2}$/.test(row.date || '') || !validSourceUrl(row.url)) { group.errors++; accounting.errors++; continue; }
      const state = filingState(row);
      if (!state) { group.excluded++; accounting.excluded++; continue; }
      const name = issuerFromTitle(row.title), key = issuerKey(name);
      if (key.length < 5) { group.unresolved++; accounting.unresolved++; continue; }
      const ipo = byKey.get(key) || blankIndiaIpo(name, key);
      const evidence = { sourceOwner: 'SEBI', sourceType: row.sourceType || SEBI_FAMILIES[row.family], market: 'IN', url: row.url, sourceDate: row.date, retrievedAt: row.retrievedAt || retrievedAt, parsingMethod: 'SEBI public-issues listing metadata', usageConstraints: 'Link and factual metadata only; SEBI website material reproduction requires permission.', limitations: 'Filing metadata does not confirm offer terms, issue window or listing date.', policyUrl: SEBI_POLICY };
      if (!ipo.timeline.some(t => t.source.url === row.url)) {
        ipo.timeline.push({ date: row.date, state, rawStatus: row.title, source: evidence });
        ipo.evidence.push(evidence);
      }
      if (seenThisBuild.has(key)) { group.duplicates++; accounting.duplicates++; }
      else { seenThisBuild.add(key); group.accepted++; accounting.accepted++; }
      ipo.name = name;
      ipo.timeline.sort((a,b) => a.date.localeCompare(b.date) || a.source.url.localeCompare(b.source.url));
      const latest = ipo.timeline.at(-1);
      ipo.status = latest.state; ipo.rawStatus = latest.rawStatus; ipo.date = latest.date;
      ipo.source = latest.source; ipo.updatedAt = latest.date; ipo.lastVerified = retrievedAt;
      ipo.ratings.dataConfidence = 'REGULATORY_FILING';
      byKey.set(key, ipo);
    }
    if (accounting.fetched !== accounting.accepted + accounting.duplicates + accounting.excluded + accounting.unresolved + accounting.errors) throw new Error('SEBI record accounting mismatch');
    if (accounting.accepted < 3 || accounting.unresolved || accounting.errors) throw new Error('SEBI registry build failed validation');
    return { events: [...byKey.values()].sort((a,b) => b.date.localeCompare(a.date)), accounting, sources: { sebi: { owner: 'SEBI', url: 'https://www.sebi.gov.in/filings/public-issues.html', sourceType: 'regulatory public-issue listing', market: 'IN', retrievedAt, sourceDate: records.map(r => r.date).filter(Boolean).sort().at(-1) || null, usageConstraints: 'Factual metadata and direct links only; reproduction of site material requires permission.', parsingMethod: 'validated listing table first page per family', limitations: 'First page of each public-issue family; PDFs are linked, not mirrored or text-republished.', policyUrl: SEBI_POLICY } } };
  }
  function searchIpos(events, query) {
    const q = clean(query, 80).toUpperCase(); if (!q) return events;
    return events.map(e => {
      const exact = [e.name, e.symbol, e.proposedTicker].some(v => v && clean(v).toUpperCase() === q);
      const prefix = [e.name, e.symbol, e.proposedTicker].some(v => v && clean(v).toUpperCase().startsWith(q));
      const fields = [e.name, e.sector, e.industry, e.symbol, e.proposedTicker, e.exchange, ...(e.leadBanks || []), ...(e.offer?.brlms || [])];
      return { e, rank: exact ? 0 : prefix ? 1 : fields.some(v => v && clean(v).toUpperCase().includes(q)) ? 2 : 99 };
    }).filter(x => x.rank < 99).sort((a,b) => a.rank-b.rank || b.e.date.localeCompare(a.e.date)).map(x => x.e);
  }
  function indiaResponse(snapshot, { market = 'IN', query = '', id = '', usEvents = [], registry = [], relationships = [] } = {}) {
    const india = snapshot.markets.IN.records;
    const events = searchIpos(market === 'ALL' ? [...india, ...usEvents] : india, query);
    const selected = events.find(e => e.id === id) || events[0] || null;
    return { schemaVersion: SCHEMA_VERSION, market, truth: 'SNAPSHOT', generatedAt: snapshot.generatedAt,
      lastVerified: snapshot.generatedAt, accounting: snapshot.markets.IN.accounting, sources: snapshot.markets.IN.sources,
      events, selectedId: selected?.id || null,
      graph: buildImpactGraph(events, selected?.id, registry, relationships) };
  }
  function applyOfficialListing(ipo, listing, securities) {
    if (!ipo || ipo.market !== 'IN' || !listing || !/^IN[A-Z0-9]{10}$/.test(listing.isin || '') || !listing.confirmedListingDate || !/^https:\/\/(www\.)?(nseindia\.com|bseindia\.com)\//.test(listing.sourceUrl || '')) return ipo;
    const matches = securities.filter(s => s.market === 'IN' && s.isin === listing.isin && ['NSE','BSE'].includes(s.exchange));
    if (!matches.length) return ipo;
    const companyIds = [...new Set(matches.map(s => s.companyId))];
    if (companyIds.length !== 1) throw new Error('Dual listing resolves to multiple NEXUS companies');
    const copy = structuredClone(ipo);
    copy.isin = listing.isin; copy.confirmedListingDate = listing.confirmedListingDate; copy.status = 'LISTED'; copy.phase = 'recent';
    copy.nexus = { state: 'CONFIRMED', securities: matches.map(s => s.id), companyId: companyIds[0] };
    const geo = matches.find(s => s.geoEntityId);
    if (geo) copy.atlas = { state: 'CONFIRMED', geoEntityId: geo.geoEntityId };
    const source = { sourceOwner: listing.sourceOwner, sourceType: 'exchange listing', market: 'IN', url: listing.sourceUrl, sourceDate: listing.confirmedListingDate, retrievedAt: listing.retrievedAt, parsingMethod: 'official exchange listing confirmation', usageConstraints: 'Direct source link and factual identifiers only; exchange data terms require separate review for redistribution.', limitations: 'Only a supplied, verified official listing confirmation is applied.' };
    if (!copy.timeline.some(t => t.state === 'LISTED' && t.source.url === source.url)) { copy.timeline.push({ date: listing.confirmedListingDate, state: 'LISTED', rawStatus: 'Official exchange listing', source }); (copy.evidence ||= []).push(source); }
    return copy;
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
    const matched = selected.market === 'IN'
      ? selected.nexus?.state === 'CONFIRMED' && registry.find(c => c.companyId === selected.nexus.companyId && c.isin === selected.isin)
      : selected.symbol && registry.find((c) => c.market === selected.market && c.symbol === selected.symbol && (!selected.exchange || c.exchange === selected.exchange));
    if (matched) {
      nodes.push({ id: matched.id, label: matched.symbol, type: 'listed_security', canonical: matched.id });
      edges.push({ sourceId: selected.id, targetId: matched.id, type: selected.market === 'IN' ? 'official_listing' : 'ticker_match', label: selected.market === 'IN' ? 'Official ISIN listing' : 'Ticker and venue match · verify issuer identity', evidence: selected.market === 'IN' ? selected.timeline.find(t => t.state === 'LISTED')?.source : null });
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
      matched ? (selected.market === 'IN' ? 'Listed identity is linked by official ISIN evidence.' : 'A ticker and venue match is provisional until issuer identity is confirmed.') : 'No listed-security identity is confirmed for this event.',
    ] };
  }
  return { SCHEMA_VERSION, normalizeCalendar, buildImpactGraph, SEBI_FAMILIES, parseSeBIListing, buildIndiaRegistry, searchIpos, applyOfficialListing, indiaResponse };
});
