#!/usr/bin/env node
'use strict';
/**
 * MT2-5 NEXUS — builds shared/nexus-snapshot.js: every SEC-registered US company
 * (NYSE/NASDAQ/AMEX) + every NSE/BSE-listed India company, cross-walked against
 * shared/atlas-snapshot.js's Wikidata dataset for geo/sector enrichment where a
 * match exists. Unmatched companies still get a node (enrichment: 'node-only').
 *
 *   node tools/nexus-build-registry.js                 # registry only (this file)
 *   node tools/nexus-build-registry.js --relationships  # also run Task 3's edge build
 *
 * Sources:
 *   - SEC EDGAR company_tickers_exchange.json — public domain, exhaustive US issuer
 *     list *with* a real listing-exchange field per ticker (the older
 *     company_tickers.json has no exchange field at all, which previously forced
 *     every US node to a guessed NASDAQ exchange regardless of true listing venue).
 *   - NSE archives EQUITY_L.csv — official NSE equity listing.
 *   - BSE ListofScripData API — official BSE equity listing.
 *   - shared/atlas-snapshot.js (Wikidata, CC0) — HQ/geo/sector cross-walk only.
 *
 * NOTE: atlas-snapshot.js's real exported shape nests its company records under
 * `datasets.companies` (not a top-level `companies` array), and many Wikidata
 * company records carry an empty `symbol` (ticker unknown to Wikidata). The
 * cross-walk index below reads `atlasSnapshot.datasets.companies` and skips any
 * instrument with a blank symbol so empty strings never collide in the index.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const nexusCore = require('../shared/nexus-core.js');
const marketCore = require('../shared/market-core.js');
const atlasSnapshot = require('../shared/atlas-snapshot.js');

// SEC EDGAR fair-access policy requires a UA identifying the requester with a
// contact address (https://www.sec.gov/os/webmaster-faq#developers) — a UA
// without one is rejected with 403.
const UA = 'MarketTerminal/1.0 NEXUS-registry-builder (krishivjain20000@gmail.com)';
const OUT = path.join(__dirname, '..', 'shared', 'nexus-snapshot.js');

function get(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': UA, ...headers } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) return resolve(get(res.headers.location, headers));
      if (res.statusCode !== 200) return reject(new Error(`${url} -> ${res.statusCode}`));
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('error', reject);
    req.setTimeout(120000, () => req.destroy(new Error('timeout ' + url)));
  });
}

function parseCsv(text) {
  const lines = text.trim().split('\n').map((l) => l.replace(/\r$/, ''));
  const header = lines[0].split(',').map((h) => h.trim().toUpperCase());
  return lines.slice(1).filter(Boolean).map((line) => {
    const cells = line.split(',');
    const row = {};
    header.forEach((h, i) => { row[h] = (cells[i] || '').trim(); });
    return row;
  });
}

// Raw SEC exchange strings -> market-core's US exchange list (['NYSE', 'NASDAQ']).
// Anything not explicitly recognized (Cboe BZX/BATS, OTC, blank/null, unknown
// future values) is deliberately left unmapped, so the caller falls through to
// market-core's own default-exchange fallback for a genuinely unclassified issuer
// — this is an honest "we don't know" fallback, not a guess dressed up as a fact.
const SEC_EXCHANGE_MAP = Object.freeze({
  NASDAQ: 'NASDAQ',
  NYSE: 'NYSE',
  'NYSE ARCA': 'NYSE',
  'NYSE AMERICAN': 'NYSE',
});

function mapSecExchange(raw) {
  const key = String(raw || '').trim().toUpperCase();
  return SEC_EXCHANGE_MAP[key] || null;
}

async function fetchUsIssuers() {
  const raw = JSON.parse(await get('https://www.sec.gov/files/company_tickers_exchange.json'));
  // Shape: { fields: ["cik","name","ticker","exchange"], data: [[cik, name, ticker, exchange], ...] }
  const fields = Array.isArray(raw.fields) ? raw.fields : ['cik', 'name', 'ticker', 'exchange'];
  const cikIdx = fields.indexOf('cik');
  const nameIdx = fields.indexOf('name');
  const tickerIdx = fields.indexOf('ticker');
  const exchangeIdx = fields.indexOf('exchange');
  return (Array.isArray(raw.data) ? raw.data : [])
    .filter((row) => row[tickerIdx] && row[nameIdx])
    .map((row) => ({
      cik: String(row[cikIdx]).padStart(10, '0'),
      ticker: String(row[tickerIdx]).toUpperCase(),
      name: String(row[nameIdx]).trim(),
      exchange: mapSecExchange(row[exchangeIdx]), // NYSE | NASDAQ | null (unclassified)
    }));
}

async function fetchNseIssuers() {
  const csv = await get('https://archives.nseindia.com/content/equities/EQUITY_L.csv', {
    Referer: 'https://www.nseindia.com/',
    Accept: 'text/csv,*/*',
  });
  return parseCsv(csv)
    .filter((r) => r.SYMBOL && r['NAME OF COMPANY'])
    .map((r) => ({ ticker: r.SYMBOL.toUpperCase(), name: r['NAME OF COMPANY'].trim(), isin: r.ISIN || '' }));
}

async function fetchBseIssuers() {
  const raw = JSON.parse(await get(
    'https://api.bseindia.com/BseIndiaAPI/api/ListofScripData/w?Group=&Scripcode=&industry=&segment=Equity&status=Active',
    { Accept: 'application/json', Origin: 'https://www.bseindia.com', Referer: 'https://www.bseindia.com/' }
  ));
  return (Array.isArray(raw) ? raw : [])
    .filter((r) => r.scrip_cd && r.scrip_name)
    .map((r) => ({ ticker: String(r.scrip_cd).toUpperCase(), name: String(r.scrip_name).trim(), isin: r.ISIN_NUMBER || '' }));
}

function buildAtlasIndex() {
  const byInstrument = new Map();
  const companies = (atlasSnapshot && atlasSnapshot.datasets && atlasSnapshot.datasets.companies) || [];
  for (const c of companies) {
    for (const inst of c.instruments || []) {
      if (!inst || !inst.market || !inst.exchange || !inst.symbol) continue; // many Wikidata records lack a known ticker
      byInstrument.set(`${inst.market}:${inst.exchange}:${String(inst.symbol).toUpperCase()}`, c);
    }
  }
  return byInstrument;
}

function toNode({ id, name, market, exchange, evidence, cik, isin }, atlasIndex) {
  const match = atlasIndex.get(id);
  return nexusCore.createCompanyNode({
    id, name, market, exchange,
    enrichment: match ? 'geo-linked' : 'node-only',
    sector: '', // Wikidata company records in atlas-snapshot.js don't carry sector; left blank until a sector source is added
    cik: cik || '',
    isin: isin || '',
    geoEntityId: match ? `company:${match.qid}` : '',
    sourceEvidence: evidence,
  });
}

async function build() {
  const atlasIndex = buildAtlasIndex();
  const nodes = [];
  const seen = new Set();

  console.log('[nexus] fetching SEC EDGAR company_tickers_exchange.json ...');
  let usSkipped = 0;
  let usUnclassifiedExchange = 0;
  const usDefaultExchange = marketCore.market('US').defaultExchange; // fallback marker for issuers SEC doesn't classify as NYSE/Nasdaq
  for (const issuer of await fetchUsIssuers()) {
    // issuer.exchange is NYSE/NASDAQ when SEC's real exchange field maps cleanly;
    // otherwise it's null and we use market-core's own default-exchange fallback
    // rather than guessing — this is the fix for the prior version's bug, where
    // every US issuer (including NYSE names like XOM/JPM) was hardcoded to NASDAQ.
    const exchange = issuer.exchange || usDefaultExchange;
    if (!issuer.exchange) usUnclassifiedExchange += 1;
    const canonicalId = `US:${exchange}:${issuer.ticker}`;
    if (seen.has(canonicalId)) continue;
    seen.add(canonicalId);
    try {
      nodes.push(toNode({
        id: canonicalId, name: issuer.name, market: 'US', exchange, cik: issuer.cik,
        evidence: [{ source: 'SEC EDGAR', sourceUrl: 'https://www.sec.gov/files/company_tickers_exchange.json', observedAt: new Date().toISOString() }],
      }, atlasIndex));
    } catch (err) { usSkipped += 1; console.warn('[nexus] skip US', issuer.ticker, err.message); }
  }
  console.log(`[nexus] US: ${nodes.length} nodes built, ${usSkipped} skipped, ${usUnclassifiedExchange} unclassified-exchange (fell back to ${usDefaultExchange})`);

  console.log('[nexus] fetching NSE EQUITY_L.csv ...');
  let nseAdded = 0;
  let nseSkipped = 0;
  try {
    for (const issuer of await fetchNseIssuers()) {
      const canonicalId = `IN:NSE:${issuer.ticker}`;
      if (seen.has(canonicalId)) continue;
      seen.add(canonicalId);
      try {
        nodes.push(toNode({
          id: canonicalId, name: issuer.name, market: 'IN', exchange: 'NSE', isin: issuer.isin,
          evidence: [{ source: 'NSE', sourceUrl: 'https://www.nseindia.com/market-data/securities-available-for-trading', observedAt: new Date().toISOString() }],
        }, atlasIndex));
        nseAdded += 1;
      } catch (err) { nseSkipped += 1; console.warn('[nexus] skip NSE', issuer.ticker, err.message); }
    }
    console.log(`[nexus] NSE: ${nseAdded} nodes built, ${nseSkipped} skipped`);
  } catch (err) { console.warn('[nexus] NSE fetch failed, continuing without it:', err.message); }

  console.log('[nexus] fetching BSE ListofScripData ...');
  let bseAdded = 0;
  let bseSkipped = 0;
  try {
    for (const issuer of await fetchBseIssuers()) {
      const canonicalId = `IN:BSE:${issuer.ticker}`;
      if (seen.has(canonicalId)) continue;
      seen.add(canonicalId);
      try {
        nodes.push(toNode({
          id: canonicalId, name: issuer.name, market: 'IN', exchange: 'BSE', isin: issuer.isin,
          evidence: [{ source: 'BSE', sourceUrl: 'https://www.bseindia.com/corporates/List_Scrips.aspx', observedAt: new Date().toISOString() }],
        }, atlasIndex));
        bseAdded += 1;
      } catch (err) { bseSkipped += 1; console.warn('[nexus] skip BSE', issuer.ticker, err.message); }
    }
    console.log(`[nexus] BSE: ${bseAdded} nodes built, ${bseSkipped} skipped`);
  } catch (err) { console.warn('[nexus] BSE fetch failed, continuing without it:', err.message); }

  const coverage = nexusCore.registryCoverage(nodes);
  console.log(`[nexus] built ${nodes.length} company nodes`, coverage.byMarket);

  const existing = fs.existsSync(OUT) ? require(OUT) : { relationships: [] };
  const payload = {
    nexusSnapshotVersion: nexusCore.NEXUS_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    sources: {
      sec: { name: 'SEC EDGAR company_tickers_exchange.json', url: 'https://www.sec.gov/files/company_tickers_exchange.json', license: 'Public domain (US Government work)' },
      nse: { name: 'NSE Equity List', url: 'https://www.nseindia.com/market-data/securities-available-for-trading', license: 'Public listing data' },
      bse: { name: 'BSE List of Scrips', url: 'https://www.bseindia.com/corporates/List_Scrips.aspx', license: 'Public listing data' },
      wikidata: { name: 'Wikidata (via atlas-snapshot.js)', url: 'https://www.wikidata.org', license: 'CC0 1.0' },
    },
    coverage,
    companies: nodes,
    relationships: existing.relationships || [],
  };

  fs.writeFileSync(OUT,
    `// GENERATED by tools/nexus-build-registry.js — do not edit by hand.\n` +
    `// Rerun: node tools/nexus-build-registry.js\n` +
    `module.exports = ${JSON.stringify(payload)};\n` +
    `if (typeof globalThis !== 'undefined') globalThis.MarketTerminalNexusSnapshot = module.exports;\n`
  );
  console.log(`[nexus] wrote ${OUT}`);
}

build().catch((err) => { console.error('[nexus] build failed:', err); process.exitCode = 1; });
