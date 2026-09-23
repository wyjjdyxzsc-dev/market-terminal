#!/usr/bin/env node
'use strict';
// Bounded SEBI metadata ingestion. Writes only after all four live families pass
// structure, record-count, URL and accounting checks. Existing snapshot survives
// every fetch/parse/build failure.
const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const core = require('../shared/launchpad-core.js');

const OUTPUT = path.join(__dirname, '..', 'shared', 'launchpad-snapshot.js');
const BASE = 'https://www.sebi.gov.in/sebiweb/home/HomeAction.do?doListing=yes&sid=3&ssid=15&smid=';
const args = process.argv.slice(2);
const fixtureAt = args.indexOf('--fixture-dir');
const fixtureDir = fixtureAt >= 0 ? args[fixtureAt + 1] : null;
const outAt = args.indexOf('--output');
const output = outAt >= 0 ? path.resolve(args[outAt + 1]) : OUTPUT;

async function getFamily(family, retrievedAt) {
  let html;
  if (fixtureDir) html = fs.readFileSync(path.join(fixtureDir, `${family}.html`), 'utf8');
  else {
    const response = await fetch(BASE + family, { signal: AbortSignal.timeout(15000), headers: { 'user-agent': 'MarketTerminal/2.0 (public regulatory filing metadata; contact via project repository)' } });
    if (!response.ok) throw new Error(`SEBI family ${family} HTTP ${response.status}`);
    html = await response.text();
  }
  return core.parseSeBIListing(html, family, retrievedAt);
}
function readPrevious() {
  if (!fs.existsSync(output)) return null;
  const resolved = require.resolve(output);
  delete require.cache[resolved];
  return require(resolved);
}
async function main() {
  const retrievedAt = new Date().toISOString();
  const previous = readPrevious();
  const families = await Promise.all([10, 11, 12, 78].map(f => getFamily(f, retrievedAt)));
  const records = families.flat();
  if (records.length < 40 || families.some(f => f.length < 5)) throw new Error('SEBI listing count suspiciously low');
  const india = core.buildIndiaRegistry(records, { previous: previous?.markets?.IN?.records || [], retrievedAt });
  let usRecords = previous?.markets?.US?.records || [];
  if (!fixtureDir && process.env.FINNHUB_API_KEY) {
    const from = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
    const to = new Date(Date.now() + 45 * 86400000).toISOString().slice(0, 10);
    const url = `https://finnhub.io/api/v1/calendar/ipo?from=${from}&to=${to}&token=${encodeURIComponent(process.env.FINNHUB_API_KEY)}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(9000) });
    if (!response.ok) throw new Error(`US calendar HTTP ${response.status}`);
    const raw = await response.json();
    if (!Array.isArray(raw.ipoCalendar) || raw.ipoCalendar.length < 3) throw new Error('US calendar snapshot invalid');
    usRecords = core.normalizeCalendar(raw, { market: 'US', asOf: retrievedAt });
  }
  const snapshot = {
    snapshotVersion: core.SCHEMA_VERSION, generatedAt: retrievedAt,
    markets: {
      US: { mode: 'live Finnhub; snapshot is historical fallback only', records: usRecords },
      IN: { mode: 'SEBI regulatory metadata snapshot', records: india.events, accounting: india.accounting, sources: india.sources },
    },
  };
  if (!snapshot.markets.IN.records.length || !snapshot.markets.US.records.length) throw new Error('Combined LAUNCHPAD registry is incomplete');
  const content = `(function(root){ const snapshot = ${JSON.stringify(snapshot)}; if(typeof module==='object' && module.exports) module.exports=snapshot; root.MarketTerminalLaunchpadSnapshot=snapshot; })(typeof globalThis!=='undefined'?globalThis:this);\n`;
  const temp = `${output}.tmp-${process.pid}`;
  try { fs.writeFileSync(temp, content); fs.renameSync(temp, output); }
  finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
  console.log(JSON.stringify({ generatedAt: retrievedAt, us: usRecords.length, india: india.events.length, accounting: india.accounting }));
}
main().catch(err => { console.error(`LAUNCHPAD snapshot build failed: ${err.message}`); process.exitCode = 1; });
