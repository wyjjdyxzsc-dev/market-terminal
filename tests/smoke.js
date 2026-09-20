#!/usr/bin/env node
/**
 * Market Terminal — smoke test suite
 * Usage:  node tests/smoke.js [--base http://localhost:3000]
 *
 * Hits every public /api/* endpoint and asserts:
 *   • HTTP 200 (or 503 for keyed routes if env var is missing)
 *   • Content-Type: application/json
 *   • Response body is valid JSON with no top-level `error: true`
 *
 * Run after `npm start` (or against the Render URL for staging).
 */

'use strict';

const BASE = (() => {
  const idx = process.argv.indexOf('--base');
  return idx !== -1 ? process.argv[idx + 1] : 'http://localhost:3000';
})();

let pass = 0, fail = 0;

const hasPolicy = (data, taskId) =>
  data && data.policy && data.policy.taskId === taskId &&
  typeof data.policy.schemaVersion === 'string' &&
  (data.policy.status === 'grounded' || data.policy.status === 'abstained' || data.policy.status === 'deterministic') &&
  Array.isArray(data.evidenceIds) && Array.isArray(data.policy.availableEvidenceIds) &&
  data.policy.runtime && typeof data.policy.runtime.schemaVersion === 'string' &&
  data.policy.runtime.totals && Number.isFinite(Number(data.policy.runtime.totals.providerCalls)) &&
  data.policy.runtime.verifier && typeof data.policy.runtime.verifier.status === 'string' &&
  (
    data.policy.status !== 'grounded' ||
    !data.policy.requiresIndependentVerifier ||
    (data.policy.runtime.status === 'verified' && data.policy.runtime.verifier.status === 'passed')
  );

async function check(label, url, opts = {}) {
  const {
    allowStatuses = [200],
    validate = () => true,
    skipError = false,   // set true for routes that need keys (may return 502/503)
    allowErrorPayload = false,
    fetchOpts = undefined, // e.g. { method: 'POST', headers, body } for non-GET routes
    validateHeaders = () => true,
  } = opts;

  let res, text;
  try {
    res  = await fetch(url, fetchOpts);
    text = await res.text();
  } catch (e) {
    console.error(`  ✗ ${label} — fetch failed: ${e.message}`);
    fail++;
    return;
  }

  if (skipError && (res.status === 500 || res.status === 502 || res.status === 503)) {
    console.log(`  ⚠  ${label} — ${res.status} (key/network not available — skipped)`);
    return;
  }

  if (!allowStatuses.includes(res.status)) {
    console.error(`  ✗ ${label} — HTTP ${res.status}`);
    fail++; return;
  }

  let json;
  try { json = JSON.parse(text); }
  catch {
    console.error(`  ✗ ${label} — non-JSON body`);
    fail++; return;
  }

  if (!skipError && !allowErrorPayload && json.error === true) {
    console.error(`  ✗ ${label} — error: ${json.message}`);
    fail++; return;
  }

  if (!validate(json)) {
    console.error(`  ✗ ${label} — validation failed: ${JSON.stringify(json).slice(0, 120)}`);
    fail++; return;
  }

  if (!validateHeaders(res.headers)) {
    console.error(`  ✗ ${label} — response headers failed validation`);
    fail++; return;
  }

  console.log(`  ✓ ${label}`);
  pass++;
}

// ─── static asset ───────────────────────────────────────────────────────────
async function checkHtml(label, url) {
  let res;
  try { res = await fetch(url); } catch (e) { console.error(`  ✗ ${label}: ${e.message}`); fail++; return; }
  if (res.status !== 200) { console.error(`  ✗ ${label} — HTTP ${res.status}`); fail++; return; }
  const t = await res.text();
  if (!t.includes('chartCanvas')) { console.error(`  ✗ ${label} — missing #chartCanvas`); fail++; return; }
  const versions = [...t.matchAll(/\?v=([0-9]{8}[a-z])/g)].map((match) => match[1]);
  if (versions.length !== 8 || new Set(versions).size !== 1) {
    console.error(`  ✗ ${label} — expected eight synchronized asset versions`);
    fail++; return;
  }
  console.log(`  ✓ ${label}`);
  pass++;
}

// ─── run ────────────────────────────────────────────────────────────────────
(async () => {
  console.log(`\nMarket Terminal smoke tests → ${BASE}\n`);

  // Static
  await checkHtml('GET /', `${BASE}/`);

  // Quote / market data (skipError — need Finnhub key + network)
  await check('GET /api/quote?symbol=AAPL', `${BASE}/api/quote?symbol=AAPL`,
    { skipError: true, validate: d => typeof d.c === 'number' || typeof d.pc === 'number' || d.error });

  await check('GET /api/ticker', `${BASE}/api/ticker`, {
    validate: d => Array.isArray(d) && d.length === 7 && d.every(item =>
      typeof item.symbol === 'string' && Number(item.price) > 0 &&
      item.available === true && typeof item.source === 'string' && typeof item.stale === 'boolean'),
  });

  await check('GET /api/chart?symbol=AAPL&range=1D', `${BASE}/api/chart?symbol=AAPL&range=1D`,
    { skipError: true, validate: d => Array.isArray(d.points) || d.error });

  // ETF benchmark used by the quant panel (beta/tracking error). Both chart
  // sources must be able to serve an ETF, so a 502 here is a real failure of
  // the Yahoo -> Nasdaq fallback, not a missing key.
  await check('GET /api/chart?symbol=SPY&range=1Y (ETF fallback)', `${BASE}/api/chart?symbol=SPY&range=1Y`,
    { validate: d => Array.isArray(d.points) && d.points.length > 5 && d.points.every(pt => Number.isFinite(pt.c)) });

  await check('GET /api/search?q=Apple', `${BASE}/api/search?q=Apple`,
    { skipError: true, validate: d => Array.isArray(d.result) || Array.isArray(d.results) || d.error });

  // News / intel (skipError — need AI key + network)
  await check('GET /api/news?symbol=AAPL', `${BASE}/api/news?symbol=AAPL`,
    { skipError: true, validate: d => Array.isArray(d.headlines) || Array.isArray(d) || d.error });

  await check('GET /api/intel/news', `${BASE}/api/intel/news`,
    {
      skipError: true,
      validate: d => (Array.isArray(d.items) &&
        (d.items.length >= 6 || (d.items.length > 0 && d.items.every(item => item.degraded === true))) &&
        d.items.every(item =>
          typeof item.sourceUrl === 'string' &&
          /^https?:\/\//.test(item.sourceUrl) &&
          (item.priority !== 'high' ||
            (item.alertPolicy?.taskId === 'intel.alert-prioritization' &&
              item.alertPolicy?.status === 'eligible' &&
              item.sourceCount >= 2))
        )) || d.error,
    });

  await check('GET /api/intel/analysis', `${BASE}/api/intel/analysis`,
    { skipError: true, validate: d => hasPolicy(d, 'intel.sector-analysis') && Array.isArray(d.industries) && d.industries.length === 11 && Array.isArray(d.topInvestPicks) && d.topInvestPicks.length === 0 && d.industries.every(item => item.investRank == null && item.optionsRank == null && item.investScore == null && item.optionsScore == null && item.optionsBias === 'Avoid') });

  await check('GET /api/intel/company?q=AAPL', `${BASE}/api/intel/company?q=AAPL`,
    { skipError: true, validate: d => hasPolicy(d, 'intel.company-news-impact') && Array.isArray(d.news) && d.news.every(item => Array.isArray(item.evidenceIds) && item.evidenceIds.length > 0 && typeof item.sourceUrl === 'string') });

  await check('GET /api/intel/candles?symbol=AAPL&range=1D', `${BASE}/api/intel/candles?symbol=AAPL&range=1D`,
    { skipError: true, validate: d => hasPolicy(d, 'intel.candle-commentary') && d.policy.status === 'deterministic' && d.dataMode === 'deterministic' && Array.isArray(d.patterns) && typeof d.overallSignal === 'string' });

  await check('GET /api/intel/priceaction?symbol=AAPL', `${BASE}/api/intel/priceaction?symbol=AAPL`,
    { skipError: true, validate: d => hasPolicy(d, 'intel.price-action') && typeof d.direction === 'string' });

  // Map layers (no key required — embedded baseline)
  await check('GET /api/map/layers', `${BASE}/api/map/layers`,
    { validate: d => (d.points || d.lines || d.regions) && d.provenance?.kind === 'layer-catalog' });

  await check('GET /api/map/earthquakes', `${BASE}/api/map/earthquakes`,
    { skipError: true, validate: d => Array.isArray(d.points) && d.provenance?.layer?.layerId === 'earthquakes' });

  await check('GET /api/map/fires', `${BASE}/api/map/fires`,
    { skipError: true, validate: () => true });

  // conflict/disease/gpsjam return GeoJSON FeatureCollections or empty on offline
  await check('GET /api/map/conflict', `${BASE}/api/map/conflict`,
    { skipError: true, validate: d => d.type === 'FeatureCollection' || Array.isArray(d.points) || d.error });

  await check('GET /api/map/disease', `${BASE}/api/map/disease`,
    { skipError: true, validate: d => d.type === 'FeatureCollection' || Array.isArray(d.points) || d.error });

  await check('GET /api/map/gpsjam', `${BASE}/api/map/gpsjam`,
    { skipError: true, validate: d => d.tileUrl || d.type === 'FeatureCollection' || d.error });

  await check('GET /api/map/events', `${BASE}/api/map/events`,
    { skipError: true, validate: d => Array.isArray(d.points) || d.error });

  // NWS is keyless, so a 5xx here is a real contract failure (e.g. an upstream
  // query-parameter change), not a missing key — do not skip it.
  await check('GET /api/map/weather', `${BASE}/api/map/weather`,
    { validate: d => Array.isArray(d.points) && d.points.length > 0 && d.provenance });

  await check('GET /api/map/flights?bbox=-10,-10,60,40', `${BASE}/api/map/flights?bbox=-10,-10,60,40`,
    { skipError: true, validate: d => Array.isArray(d.points) || d.error });

  await check('GET /api/map/webcams-live', `${BASE}/api/map/webcams-live`,
    { skipError: true, validate: d => Array.isArray(d.points) || d.error });

  // Market sentiment
  await check('GET /api/sentiment/market', `${BASE}/api/sentiment/market`,
    { skipError: true, validate: d => (typeof d.score === 'number' && d.dataMode === 'deterministic') || d.error });

  await check('GET /api/sentiment/twitter (deprecated)', `${BASE}/api/sentiment/twitter`, {
    skipError: true,
    validate: d => (typeof d.score === 'number' && d.dataMode === 'deterministic') || d.error,
    validateHeaders: headers => headers.get('deprecation') === 'true',
  });

  // Macro shock
  await check('GET /api/macro/shock', `${BASE}/api/macro/shock`,
    { validate: d => Array.isArray(d.pipelines) });

  // Supply chain — uses ?q= param
  await check('GET /api/intel/supplychain?q=Apple', `${BASE}/api/intel/supplychain?q=Apple`,
    { skipError: true, validate: d => hasPolicy(d, 'intel.supply-chain') && d.abstained === true && Array.isArray(d.suppliers) && d.suppliers.length === 0 && Array.isArray(d.customers) && d.customers.length === 0 });

  // Push (vapid key — always returns even without keys)
  await check('GET /api/vapid-public-key', `${BASE}/api/vapid-public-key`,
    { validate: d => 'enabled' in d });

  await check('GET /api/intel/alerts', `${BASE}/api/intel/alerts`,
    { validate: d => typeof d.policySchemaVersion === 'string' && Array.isArray(d.alerts) && d.alerts.every(item => item.alertPolicy?.taskId === 'intel.alert-prioritization' && item.alertPolicy?.status === 'eligible') });

  // Deep-dive — uses ?q= param
  await check('GET /api/intel/deepdive?q=AAPL', `${BASE}/api/intel/deepdive?q=AAPL`,
    { validate: d => hasPolicy(d, 'intel.deep-dive') &&
      d.deepDiveSchemaVersion === '2026-08-11a' &&
      /^(deterministic-dossier|ai-analysis-with-deterministic-data)$/.test(d.dataMode || '') &&
      typeof d.summary === 'string' && d.summary.length > 40 &&
      Number(d.quote?.price) > 0 && typeof d.quote?.source === 'string' &&
      d.dataSources?.quote?.status === 'available' &&
      ['ready', 'unavailable'].includes(d.aiNarrativeStatus) &&
      [d.bullCase, d.bearCase, d.catalysts, d.risks].every(items => Array.isArray(items) && items.length > 0) &&
      d.equityData?.status === 'available' && Number(d.equityData?.coverageScore) > 0 &&
      d.dataSources?.options?.status === 'available' && d.optionsChain?.status === 'available' &&
      Number(d.optionsChain?.contractCount) > 0 &&
      // A completed analysis must carry a real rating and options view; when it does not
      // complete, the deterministic dossier must say so rather than invent one.
      (d.aiNarrativeStatus === 'ready'
        ? d.deterministic === false && typeof d.investment?.rating === 'string' &&
          d.investment.rating !== 'Not Rated' && typeof d.options?.bias === 'string'
        : d.deterministic === true && d.investment?.rating === 'Not Rated' &&
          d.options?.bias === 'Data Only' && /^N\/A/.test(d.priceTarget || '')) });

  // AI chat (skipError — needs a heavy-tier AI key)
  await check('POST /api/intel/chat', `${BASE}/api/intel/chat`, {
    skipError: true,
    fetchOpts: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'In one sentence, what does a P/E ratio measure?' }] }),
    },
    validate: d => hasPolicy(d, 'intel.chat') && typeof d.reply === 'string',
  });

  // Situation room
  await check('GET /api/intel/situation', `${BASE}/api/intel/situation`,
    { skipError: true, validate: d => hasPolicy(d, 'intel.situation') && (d.abstained ? d.defcon == null : Number.isFinite(Number(d.defcon))) });

  await check('GET /api/intel/report', `${BASE}/api/intel/report`,
    { skipError: true, validate: d => hasPolicy(d, 'intel.investment-report') && d.abstained === true && Array.isArray(d.topPicks) && d.topPicks.length === 0 });

  await check('GET /api/intel/instability', `${BASE}/api/intel/instability`,
    { skipError: true, validate: d => hasPolicy(d, 'intel.instability') && d.abstained === true && Array.isArray(d.countries) && d.countries.length === 0 });

  // Contract guards
  await check('POST /api/quote', `${BASE}/api/quote`, {
    allowStatuses: [405],
    allowErrorPayload: true,
    fetchOpts: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    },
    validate: d => d.code === 'method_not_allowed',
  });

  await check('GET /api/stocks/stream (no upgrade)', `${BASE}/api/stocks/stream`,
    { allowStatuses: [426], allowErrorPayload: true, validate: d => d.code === 'upgrade_required' });

  await check('GET /api/does-not-exist', `${BASE}/api/does-not-exist`,
    { allowStatuses: [404], allowErrorPayload: true, validate: d => d.code === 'not_found' || d.code === 'route_not_implemented' });

  // ── Summary ──────────────────────────────────────────────────────────────
  const total = pass + fail;
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Results: ${pass}/${total} passed${fail ? `, ${fail} FAILED` : ' ✓'}`);
  if (fail) process.exit(1);
})();
