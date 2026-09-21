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
 *   node tools/nexus-build-registry.js --dedupe-relationships  # collapse duplicate edges in place (no network)
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

// ───────────────────────── Task 3: relationship edges ─────────────────────────

function normalizeCompanyName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\b(inc|incorporated|corp|corporation|co|company|ltd|limited|plc|llc)\b\.?/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Fix (review round 2): buildNameIndex was a plain Map<normalizedName, id> —
// when two distinct real companies across different markets share a bare name
// after suffix-stripping (e.g. "Pfizer Inc" (US) and "Pfizer Limited" (India)
// both normalize to "pfizer"), the second one inserted silently overwrote the
// first for every future lookup. Confirmed live: a tier-3 edge attributed
// IN:NSE:PFIZER as the parent of US:NYSE:COTY — almost certainly a real
// Wikidata fact about the US Pfizer Inc. (Coty's actual historical parent)
// misattributed to the unrelated India-listed Pfizer Limited purely because
// of insertion order. Fixed by indexing an ARRAY of {id, market} candidates
// per normalized name, and disambiguating by market at lookup time
// (matchCompanyByName's marketHint) rather than by whichever happened to be
// inserted last.
function buildNameIndex(companies) {
  const index = new Map();
  for (const c of companies) {
    const key = normalizeCompanyName(c.name);
    if (!key) continue;
    if (!index.has(key)) index.set(key, []);
    index.get(key).push({ id: c.id, market: c.market });
  }
  return index;
}

// Picks a single unambiguous id from a list of same-normalized-name candidates.
// A market hint resolves a cross-market name collision (the common case); with
// no hint, or a collision that survives the hint (two candidates in the same
// market), there is no confident way to pick one — return null (drop the
// match) rather than guess by insertion order or list position.
function pickCandidate(candidates, marketHint) {
  if (!candidates || !candidates.length) return null;
  if (marketHint) {
    const sameMarket = candidates.filter((c) => c.market === marketHint);
    if (sameMarket.length === 1) return sameMarket[0].id;
    if (sameMarket.length > 1) return null; // still ambiguous even within the hinted market
    // no same-market candidate — fall through and only trust a single global candidate
  }
  return candidates.length === 1 ? candidates[0].id : null;
}

function tokenizeName(normalized) {
  return String(normalized || '').split(' ').filter(Boolean);
}

// Fix (review round 1): the original substring-containment fuzzy match had no
// minimum length floor on the QUERY side (only `indexed.length > 4`), and even
// with a floor, plain word-containment is too permissive for a short/common
// word shared by two unrelated real companies. Two confirmed-fabricated edges
// from the first run:
//   - "CMS" (from a UnitedHealth 10-K — almost certainly the Centers for
//     Medicare & Medicaid Services, a federal agency, not a company at all)
//     substring-matched "cms energy" -> CMS Energy Corp, an unrelated utility.
//   - "Aditya Birla Group" (real Wikidata parent of Hindalco/Vodafone
//     Idea/Indus Towers) substring/word-matched "birla" -> Birla Corporation
//     Limited, a separate, unrelated NSE-listed cement company that merely
//     shares a founder-family name.
// Fix: (1) require BOTH the query and the indexed name to exceed 4 normalized
// characters — a bare 3-4 letter label (like "CMS") is exactly the shape SEC
// XBRL customer-axis members and short ticker-style abbreviations take, and is
// too ambiguous to trust without more context; (2) replace substring
// containment with word-level containment (all significant words of the
// shorter name must appear as *whole words* in the longer name, not as a
// character substring); (3) additionally require the shorter name's words to
// cover a substantial share (>=60%) of the longer name's words — this is what
// actually rejects "birla" (1 of 3 words in "aditya birla group" = 33%
// coverage), since word-containment alone still accepts a single word buried
// inside an unrelated multi-word name; (4) require at least TWO significant
// words to agree — a single shared word, even a distinctive-looking one, is
// not enough on its own. This fourth rule was added after the >=60%-coverage
// rule alone let a *different* false positive through in testing: "3i GROUP
// PLC" (an unrelated investment firm) matched "Aditya Birla Group" purely
// because both contain the generic corporate word "group" — the only
// "significant" (>2-char) token "3i" itself is 2 characters and gets filtered
// out, leaving "group" as the sole word compared, which is far too generic
// to trust alone.
const MIN_MATCH_LEN = 4; // normalized strings of this length or shorter are never matched (exact or fuzzy)
const MIN_WORD_COVERAGE = 0.6;
const MIN_SIGNIFICANT_WORDS = 2; // a single shared word is never sufficient for a fuzzy match

// marketHint (optional 'US'|'IN'), when the caller knows it, disambiguates a
// cross-market name collision via pickCandidate. An exact normalized-name hit
// never falls through to the fuzzy loop below, even when pickCandidate returns
// null for it (ambiguous/no market match) — falling through risks a *worse*,
// less-related fuzzy match under a different indexed name entirely.
function matchCompanyByName(rawLabel, nameIndex, marketHint) {
  const key = normalizeCompanyName(rawLabel);
  if (!key || key.length <= MIN_MATCH_LEN) return null;
  if (nameIndex.has(key)) return pickCandidate(nameIndex.get(key), marketHint);
  const keyTokens = tokenizeName(key);
  for (const [indexed, candidates] of nameIndex) {
    if (!indexed || indexed.length <= MIN_MATCH_LEN) continue;
    const indexedTokens = tokenizeName(indexed);
    const shorterTokens = keyTokens.length <= indexedTokens.length ? keyTokens : indexedTokens;
    const longerTokens = keyTokens.length <= indexedTokens.length ? indexedTokens : keyTokens;
    const significant = shorterTokens.filter((t) => t.length > 2);
    if (significant.length < MIN_SIGNIFICANT_WORDS) continue;
    const longerSet = new Set(longerTokens);
    if (!significant.every((t) => longerSet.has(t))) continue;
    if (shorterTokens.length / longerTokens.length < MIN_WORD_COVERAGE) continue;
    const picked = pickCandidate(candidates, marketHint);
    if (picked) return picked; // else keep scanning other indexed names rather than giving up on the whole label
  }
  return null;
}

const CONCENTRATION_CONCEPTS = [
  'ConcentrationRiskPercentage1',
  'ConcentrationRiskPercentage',
];

// Optional env cap on how many CIK-bearing US companies to process in this run
// (SEC XBRL fetch is a small number of HTTPS requests per company, rate-limited to
// SEC's fair-use policy). Unset/0 means "no cap" — the full registry — so the
// generator itself carries no baked-in permanent limit; NEXUS_TIER1_LIMIT is a
// run-time choice only.
const TIER1_LIMIT = Number(process.env.NEXUS_TIER1_LIMIT || 0) || Infinity;

// IMPORTANT — why this does NOT use /api/xbrl/companyfacts/:
// SEC's companyfacts (and frames) APIs only expose facts reported against a
// filer's *default* (non-dimensional) context. Any concept a filer reports
// exclusively with a dimensional breakdown (e.g. customer concentration tagged
// per named customer via srt:MajorCustomersAxis, which is how essentially every
// filer that names a real customer reports it) is silently ABSENT from
// companyfacts — not null, not zero, just missing, with no "segment"/"dimensions"
// field anywhere in that API's shape. Verified directly against real filings
// (Cirrus Logic CIK 0000772406, Qorvo, Skyworks, Microchip, ON Semi all show zero
// "Concentration*" concepts in companyfacts despite disclosing named customer
// concentration in their actual 10-Ks). The dimensional member identity only
// exists in the filing's own raw XBRL instance document, so tier-1 fetches that
// document directly per company and parses <context>/<xbrldi:explicitMember>
// segments itself.
function camelToWords(s) {
  return String(s || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim();
}

// Finds the most recent 10-K's auto-generated XBRL instance document. EDGAR
// names this <primaryDocumentBasename>_htm.xml for every inline-XBRL filing
// (the standard since inline XBRL became mandatory) — e.g. primaryDocument
// "crus-20240330.htm" -> instance "crus-20240330_htm.xml" alongside it.
async function findLatest10KInstance(cik) {
  const subs = JSON.parse(await get(`https://data.sec.gov/submissions/CIK${cik}.json`));
  const recent = subs.filings && subs.filings.recent;
  if (!recent || !Array.isArray(recent.form)) return null;
  for (let i = 0; i < recent.form.length; i++) {
    if (recent.form[i] !== '10-K') continue;
    const primaryDoc = recent.primaryDocument[i];
    const accessionNumber = recent.accessionNumber[i];
    if (!primaryDoc || !accessionNumber || !primaryDoc.endsWith('.htm')) continue;
    const accnNoDash = accessionNumber.replace(/-/g, '');
    const instanceFile = primaryDoc.replace(/\.htm$/, '_htm.xml');
    return {
      url: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accnNoDash}/${instanceFile}`,
      accessionNumber,
      filed: recent.filingDate[i],
    };
  }
  return null;
}

const CUSTOMER_AXIS_RE = /dimension="[a-z0-9.-]*:(?:MajorCustomersAxis|CustomerAxis)"[^>]*>\s*([A-Za-z0-9.:_-]+?)\s*<\/xbrldi:explicitMember>/gi;
const CONTEXT_BLOCK_RE = /<context id="([^"]+)"[^>]*>([\s\S]*?)<\/context>/g;

// Builds a contextId -> customer-member-localname map for every context whose
// <segment> carries a MajorCustomersAxis/CustomerAxis explicitMember. Contexts
// with no such member (the company-wide default) are simply absent from the map.
function buildCustomerContextMap(xml) {
  const map = new Map();
  let m;
  CONTEXT_BLOCK_RE.lastIndex = 0;
  while ((m = CONTEXT_BLOCK_RE.exec(xml))) {
    const [, contextId, body] = m;
    CUSTOMER_AXIS_RE.lastIndex = 0;
    const memberMatch = CUSTOMER_AXIS_RE.exec(body);
    if (!memberMatch) continue;
    const localName = memberMatch[1].split(':').pop().replace(/Member$/, '');
    map.set(contextId, localName);
  }
  return map;
}

function extractConcentrationFacts(xml, contextMap) {
  const found = [];
  for (const concept of CONCENTRATION_CONCEPTS) {
    // Match the opening tag for this exact concept (not a longer concept that
    // happens to start with the same prefix, e.g. Percentage1 vs Percentage).
    const tagRe = new RegExp(`<[a-z0-9.-]+:${concept}\\b([^>]*)>([^<]*)<`, 'gi');
    let m;
    while ((m = tagRe.exec(xml))) {
      const [, attrs, rawVal] = m;
      const ctxMatch = /contextRef="([^"]+)"/.exec(attrs);
      if (!ctxMatch) continue;
      const member = contextMap.get(ctxMatch[1]);
      if (!member) continue; // default (non-dimensional) context — no customer identity
      const val = Number(rawVal);
      if (!Number.isFinite(val)) continue;
      found.push({ concept, member, val });
    }
  }
  return found;
}

async function fetchConcentrationEdges(usCompanies, nameIndex) {
  const edges = [];
  let processed = 0;
  let withInstance = 0;
  for (const company of usCompanies) {
    if (!company.cik) continue;
    if (processed >= TIER1_LIMIT) break;
    processed += 1;
    if (processed % 8 === 0) await new Promise((r) => setTimeout(r, 1100)); // stay under SEC's ~10 req/sec fair-use limit
    try {
      const filing = await findLatest10KInstance(company.cik);
      if (!filing) continue;
      const xml = await get(filing.url);
      const contextMap = buildCustomerContextMap(xml);
      if (!contextMap.size) continue;
      withInstance += 1;
      const facts = extractConcentrationFacts(xml, contextMap);
      for (const fact of facts) {
        const words = camelToWords(fact.member);
        // marketHint 'US': every company in usCompanies (and hence every id this
        // loop can legitimately target) is a US SEC filer, so a same-name
        // candidate in another market (e.g. an India-listed company sharing a
        // bare name after suffix-stripping) is never the right match here.
        const targetId = matchCompanyByName(words, nameIndex, 'US');
        if (!targetId || targetId === company.id) continue; // no match (anonymized "Customer A", foreign counterparty, etc.) — dropped, never guessed
        edges.push(nexusCore.createRelationshipEdge({
          sourceId: targetId,
          targetId: company.id,
          relation: 'customer',
          tier: 1,
          evidence: [{
            source: 'SEC XBRL instance document (10-K)',
            sourceUrl: filing.url,
            datasetId: `us-gaap:${fact.concept}`,
            observedAt: isoOrNull(filing.filed),
            note: `${words} = ${(fact.val * 100).toFixed(1)}% concentration`,
          }],
        }));
      }
    } catch (err) {
      // Missing/unreachable filing, no 10-K, non-inline-XBRL filer, etc. is expected and not an error worth failing the build over.
    }
  }
  console.log(`[nexus] tier-1: processed ${processed} of ${usCompanies.filter((c) => c.cik).length} CIK-bearing US companies, ` +
    `${withInstance} had a customer-dimensional context` +
    (Number.isFinite(TIER1_LIMIT) ? ` (capped by NEXUS_TIER1_LIMIT=${TIER1_LIMIT})` : ' (full run, no cap)'));
  return edges;
}

function isoOrNull(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.valueOf()) ? null : d.toISOString();
}

async function fetchOwnershipEdges(companies, nameIndex, validIds) {
  // atlas-snapshot.js nests company records under datasets.companies (not a
  // top-level `companies` array) — see the file-header note above.
  const atlasCompanies = (atlasSnapshot && atlasSnapshot.datasets && atlasSnapshot.datasets.companies) || [];
  const qids = atlasCompanies.map((c) => c.qid).filter(Boolean);
  if (!qids.length) return [];
  const edges = [];
  const batchSize = 50;
  for (let i = 0; i < qids.length; i += batchSize) {
    const batch = qids.slice(i, i + batchSize);
    const values = batch.map((q) => `wd:${q}`).join(' ');
    const query = `SELECT ?company ?companyLabel ?parent ?parentLabel WHERE {
      VALUES ?company { ${values} }
      ?company wdt:P749 ?parent .
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }`;
    try {
      const raw = JSON.parse(await get(
        `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`,
        { Accept: 'application/sparql-results+json' }
      ));
      for (const row of raw.results?.bindings || []) {
        const childQid = row.company.value.split('/').pop();
        const parentLabel = row.parentLabel?.value || '';
        const childCompany = atlasCompanies.find((c) => c.qid === childQid);
        if (!childCompany) continue;
        for (const inst of childCompany.instruments || []) {
          if (!inst || !inst.market || !inst.exchange || !inst.symbol) continue; // many Wikidata records lack a known ticker
          const childId = `${inst.market}:${inst.exchange}:${String(inst.symbol).toUpperCase()}`;
          if (!validIds.has(childId)) continue; // atlas-snapshot's Wikidata instruments can list an exchange (e.g. BSE) that this run's own registry fetch didn't capture as a node — never emit an edge whose endpoint has no node
          // marketHint = the child's own market: a parent-organization name that
          // collides across markets (e.g. "Pfizer" -> both US Pfizer Inc. and
          // India's Pfizer Limited) is resolved to the candidate in the SAME
          // market as the child first, rather than picking whichever candidate
          // happened to be inserted into the registry last.
          const parentId = matchCompanyByName(parentLabel, nameIndex, inst.market);
          if (!parentId || parentId === childId || !validIds.has(parentId)) continue;
          edges.push(nexusCore.createRelationshipEdge({
            sourceId: parentId,
            targetId: childId,
            relation: 'ownership',
            tier: 3,
            evidence: [{ source: 'Wikidata', sourceUrl: `https://www.wikidata.org/wiki/${childQid}`, datasetId: 'P749', observedAt: new Date().toISOString() }],
          }));
        }
      }
    } catch (err) {
      console.warn('[nexus] Wikidata ownership batch failed:', err.message);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return edges;
}

// The XBRL extractor emits one edge per *fact datapoint* — a single 10-K restates the
// same customer concentration across several periods/segments, so the same
// (source, target, relation) tuple arrives many times. Collapse them before writing the
// snapshot, keeping the most recently observed one; on an exact observedAt tie the
// first-seen edge wins, which keeps the build deterministic.
function dedupeRelationships(edges) {
  const observedAt = (e) => (e.evidence || []).map((ev) => ev.observedAt).filter(Boolean).sort().pop() || '';
  const byKey = new Map();
  for (const edge of edges) {
    const key = `${edge.sourceId}|${edge.targetId}|${edge.relation}`;
    const current = byKey.get(key);
    if (!current || observedAt(edge) > observedAt(current)) byKey.set(key, edge);
  }
  return [...byKey.values()];
}

function writeSnapshot(snapshot, relationships) {
  const updated = { ...snapshot, relationships, generatedAt: new Date().toISOString() };
  fs.writeFileSync(OUT,
    `// GENERATED by tools/nexus-build-registry.js — do not edit by hand.\n` +
    `// Rerun: node tools/nexus-build-registry.js --relationships\n` +
    `module.exports = ${JSON.stringify(updated)};\n` +
    `if (typeof globalThis !== 'undefined') globalThis.MarketTerminalNexusSnapshot = module.exports;\n`
  );
}

// `--dedupe-relationships` reapplies dedupeRelationships() to the already-generated
// snapshot without re-fetching SEC/Wikidata. It is exactly the transform a full
// `--relationships` run now performs, and is the safe way to retire duplicates that a
// previous build already wrote.
function dedupeExistingRelationships() {
  const snapshot = require(OUT);
  const before = snapshot.relationships.length;
  const relationships = dedupeRelationships(snapshot.relationships);
  writeSnapshot(snapshot, relationships);
  console.log(`[nexus] deduped relationships: ${before} → ${relationships.length}`);
}

async function buildRelationships() {
  const snapshot = require(OUT);
  const nameIndex = buildNameIndex(snapshot.companies);
  const validIds = new Set(snapshot.companies.map((c) => c.id));
  const usCompanies = snapshot.companies.filter((c) => c.market === 'US' && c.cik);

  console.log(`[nexus] fetching SEC XBRL concentration facts for ${usCompanies.length} US filers (rate-limited, this takes a while) ...`);
  const tier1 = await fetchConcentrationEdges(usCompanies, nameIndex);
  console.log(`[nexus] tier-1 edges: ${tier1.length}`);

  console.log('[nexus] fetching Wikidata ownership (P749) ...');
  const tier3 = await fetchOwnershipEdges(snapshot.companies, nameIndex, validIds);
  console.log(`[nexus] tier-3 edges: ${tier3.length}`);

  const raw = [...tier1, ...tier3];
  const relationships = dedupeRelationships(raw);
  console.log(`[nexus] deduped ${raw.length} raw edges → ${relationships.length} unique (source, target, relation)`);
  writeSnapshot(snapshot, relationships);
  console.log(`[nexus] wrote ${relationships.length} relationships to ${OUT}`);
}

if (process.argv.includes('--dedupe-relationships')) {
  dedupeExistingRelationships();
} else if (process.argv.includes('--relationships')) {
  buildRelationships().catch((err) => { console.error('[nexus] relationship build failed:', err); process.exitCode = 1; });
} else {
  build().catch((err) => { console.error('[nexus] build failed:', err); process.exitCode = 1; });
}
