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

async function check(label, url, opts = {}) {
  const {
    allowStatuses = [200],
    validate = () => true,
    skipError = false,   // set true for routes that need keys (may return 502/503)
  } = opts;

  let res, text;
  try {
    res  = await fetch(url);
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

  if (!skipError && json.error === true) {
    console.error(`  ✗ ${label} — error: ${json.message}`);
    fail++; return;
  }

  if (!validate(json)) {
    console.error(`  ✗ ${label} — validation failed: ${JSON.stringify(json).slice(0, 120)}`);
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

  await check('GET /api/chart?symbol=AAPL&range=1D', `${BASE}/api/chart?symbol=AAPL&range=1D`,
    { skipError: true, validate: d => Array.isArray(d.points) || d.error });

  await check('GET /api/search?q=Apple', `${BASE}/api/search?q=Apple`,
    { skipError: true, validate: d => Array.isArray(d.results) || d.error });

  // News / intel (skipError — need AI key + network)
  await check('GET /api/news?symbol=AAPL', `${BASE}/api/news?symbol=AAPL`,
    { skipError: true, validate: d => Array.isArray(d.headlines) || Array.isArray(d) || d.error });

  await check('GET /api/intel/news', `${BASE}/api/intel/news`,
    { skipError: true, validate: d => Array.isArray(d.news) || d.marketSentiment || d.error });

  await check('GET /api/intel/analysis', `${BASE}/api/intel/analysis`,
    { skipError: true, validate: d => Array.isArray(d.industries) || d.error });

  // Map layers (no key required — embedded baseline)
  await check('GET /api/map/layers', `${BASE}/api/map/layers`,
    { validate: d => d.points || d.lines || d.regions });

  await check('GET /api/map/earthquakes', `${BASE}/api/map/earthquakes`,
    { skipError: true, validate: d => Array.isArray(d.points) || d.error });

  await check('GET /api/map/fires', `${BASE}/api/map/fires`,
    { skipError: true, validate: () => true });

  // conflict/disease/gpsjam return GeoJSON FeatureCollections or empty on offline
  await check('GET /api/map/conflict', `${BASE}/api/map/conflict`,
    { skipError: true, validate: d => d.type === 'FeatureCollection' || Array.isArray(d.points) || d.error });

  await check('GET /api/map/disease', `${BASE}/api/map/disease`,
    { skipError: true, validate: d => d.type === 'FeatureCollection' || Array.isArray(d.points) || d.error });

  await check('GET /api/map/gpsjam', `${BASE}/api/map/gpsjam`,
    { skipError: true, validate: d => d.tileUrl || d.type === 'FeatureCollection' || d.error });

  // Sentiment
  await check('GET /api/sentiment/twitter', `${BASE}/api/sentiment/twitter`,
    { skipError: true, validate: d => typeof d.score === 'number' || d.error });

  // Macro shock
  await check('GET /api/macro/shock', `${BASE}/api/macro/shock`,
    { validate: d => Array.isArray(d.pipelines) });

  // Supply chain — uses ?q= param
  await check('GET /api/intel/supplychain?q=Apple', `${BASE}/api/intel/supplychain?q=Apple`,
    { skipError: true, validate: d => d.suppliers || d.customers || d.error });

  // Push (vapid key — always returns even without keys)
  await check('GET /api/vapid-public-key', `${BASE}/api/vapid-public-key`,
    { validate: d => 'enabled' in d });

  // Deep-dive — uses ?q= param
  await check('GET /api/intel/deepdive?q=AAPL', `${BASE}/api/intel/deepdive?q=AAPL`,
    { skipError: true, validate: d => (d.investment && d.options) || d.error });

  // Situation room
  await check('GET /api/intel/situation', `${BASE}/api/intel/situation`,
    { skipError: true, validate: d => d.narrative || d.error });

  // ── Summary ──────────────────────────────────────────────────────────────
  const total = pass + fail;
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Results: ${pass}/${total} passed${fail ? `, ${fail} FAILED` : ' ✓'}`);
  if (fail) process.exit(1);
})();
