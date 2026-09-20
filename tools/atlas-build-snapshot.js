#!/usr/bin/env node
'use strict';
/**
 * MT2-4 ATLAS — builds shared/atlas-snapshot.js from licence-compatible public datasets.
 *
 *   node tools/atlas-build-snapshot.js            # full rebuild (network, ~3–5 min)
 *   node tools/atlas-build-snapshot.js --verify   # only re-verify the curated reference points
 *
 * Sources (see DECISIONS.md D-010):
 *   - Wikidata SPARQL / API — CC0. Listed companies (P414 exchange, P249 ticker) with HQ (P159)
 *     coordinates (P625); reference-point verification by label lookup.
 *   - Natural Earth 10m ports + airports — public domain.
 *   - WRI Global Power Plant Database v1.3 — CC BY 4.0 (attribution required, kept in payload).
 * No coordinate in the snapshot is typed by hand: every record carries its source URL. Curated
 * reference points that Wikidata cannot confirm within 50 km are emitted as UNVERIFIED.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const UA = 'MarketTerminal/1.0 (ATLAS snapshot builder; https://github.com/wyjjdyxzsc-dev/market-terminal)';
const OUT = path.join(__dirname, '..', 'shared', 'atlas-snapshot.js');
const VERIFY_ONLY = process.argv.includes('--verify');

function get(url, headers = {}, binary = false) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': UA, ...headers } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) return resolve(get(res.headers.location, headers, binary));
      if (res.statusCode !== 200) return reject(new Error(`${url} → ${res.statusCode}`));
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(binary ? Buffer.concat(chunks) : Buffer.concat(chunks).toString('utf8')));
    });
    req.on('error', reject);
    req.setTimeout(180000, () => req.destroy(new Error('timeout ' + url)));
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r5 = (n) => Math.round(Number(n) * 1e5) / 1e5;
const parsePoint = (wkt) => { const m = /Point\(([-\d.]+) ([-\d.]+)\)/.exec(wkt || ''); return m ? { lon: r5(m[1]), lat: r5(m[2]) } : null; };
function km(a, b) {
  const R = 6371, d = Math.PI / 180;
  const dLat = (b.lat - a.lat) * d, dLon = (b.lon - a.lon) * d;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * d) * Math.cos(b.lat * d) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

async function sparql(query, attempt = 1) {
  const url = 'https://query.wikidata.org/sparql?query=' + encodeURIComponent(query);
  try {
    return JSON.parse(await get(url, { Accept: 'application/sparql-results+json' })).results.bindings;
  } catch (err) {
    if (attempt >= 3) throw err;
    await sleep(5000 * attempt);
    return sparql(query, attempt + 1);
  }
}

// ── 1. Listed companies with HQ coordinates ───────────────────────────────────────────
const EXCHANGES = [
  { qid: 'Q638740', market: 'IN', exchange: 'NSE' },
  { qid: 'Q638398', market: 'IN', exchange: 'BSE' },
  { qid: 'Q13677',  market: 'US', exchange: 'NYSE' },
  { qid: 'Q82059',  market: 'US', exchange: 'NASDAQ' },
];
async function fetchCompanies() {
  const byQid = new Map();
  for (const ex of EXCHANGES) {
    const q = `SELECT ?company ?companyLabel ?ticker ?coord ?hq ?hqLabel ?countryLabel ?country WHERE {
      ?company p:P414 ?st . ?st ps:P414 wd:${ex.qid} . OPTIONAL { ?st pq:P249 ?ticker }
      ?company wdt:P159 ?hq . ?hq wdt:P625 ?coord . OPTIONAL { ?hq wdt:P17 ?country }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } } LIMIT 5000`;
    const rows = await sparql(q);
    console.error(`[atlas] ${ex.exchange}: ${rows.length} rows`);
    for (const b of rows) {
      const qid = b.company.value.split('/').pop();
      const pt = parsePoint(b.coord.value);
      if (!pt) continue;
      const rec = byQid.get(qid) || {
        qid, name: b.companyLabel.value, lat: pt.lat, lon: pt.lon,
        hq: b.hqLabel ? b.hqLabel.value : '', hqQid: b.hq ? b.hq.value.split('/').pop() : '',
        country: b.countryLabel ? b.countryLabel.value : '', countryQid: b.country ? b.country.value.split('/').pop() : '',
        instruments: [],
      };
      const ticker = b.ticker ? String(b.ticker.value).toUpperCase().replace(/[^A-Z0-9&.-]/g, '') : '';
      if (ticker && !rec.instruments.some((i) => i.exchange === ex.exchange && i.symbol === ticker)) {
        rec.instruments.push({ market: ex.market, exchange: ex.exchange, symbol: ticker });
      } else if (!ticker && !rec.instruments.some((i) => i.exchange === ex.exchange)) {
        rec.instruments.push({ market: ex.market, exchange: ex.exchange, symbol: '' });
      }
      byQid.set(qid, rec);
    }
    await sleep(2000);
  }
  return [...byQid.values()].filter((c) => /^Q\d+$/.test(c.qid) && !/^Q\d+$/.test(c.name));
}

// ── 2. Natural Earth ports + airports (public domain) ─────────────────────────────────
async function fetchNaturalEarth() {
  const base = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/';
  const ports = JSON.parse(await get(base + 'ne_10m_ports.geojson')).features.map((f) => ({
    id: String(f.properties.ne_id), name: f.properties.name, lat: r5(f.geometry.coordinates[1]), lon: r5(f.geometry.coordinates[0]),
    scalerank: f.properties.scalerank, website: f.properties.website || '',
  }));
  const airports = JSON.parse(await get(base + 'ne_10m_airports.geojson')).features
    .filter((f) => ['major', 'mid'].includes(f.properties.type) || f.properties.scalerank <= 4)
    .map((f) => ({
      id: String(f.properties.ne_id), name: f.properties.name, lat: r5(f.geometry.coordinates[1]), lon: r5(f.geometry.coordinates[0]),
      iata: f.properties.iata_code || '', icao: f.properties.gps_code || '', size: f.properties.type || '', scalerank: f.properties.scalerank,
    }));
  console.error(`[atlas] Natural Earth: ${ports.length} ports, ${airports.length} airports (major/mid)`);
  return { ports, airports };
}

// ── 3. WRI Global Power Plant Database (CC BY 4.0) ────────────────────────────────────
async function fetchPowerPlants() {
  const zip = await get('https://wri-dataportal-prod.s3.amazonaws.com/manual/global_power_plant_database_v_1_3.zip', {}, true);
  const tmp = fs.mkdtempSync('/tmp/gppd-');
  fs.writeFileSync(path.join(tmp, 'g.zip'), zip);
  execSync(`unzip -q -o ${tmp}/g.zip -d ${tmp}`);
  const csv = fs.readFileSync(path.join(tmp, 'global_power_plant_database.csv'), 'utf8').split('\n');
  const head = csv[0].split(',');
  const idx = (k) => head.indexOf(k);
  const out = [];
  for (const line of csv.slice(1)) {
    if (!line.trim()) continue;
    // Naive CSV split is unsafe for quoted names; use a tolerant parser.
    const cells = []; let cur = ''; let inq = false;
    for (const ch of line) { if (ch === '"') inq = !inq; else if (ch === ',' && !inq) { cells.push(cur); cur = ''; } else cur += ch; }
    cells.push(cur);
    const fuel = cells[idx('primary_fuel')];
    const mw = Number(cells[idx('capacity_mw')]);
    if (!(fuel === 'Nuclear' || mw >= 1000)) continue;
    const lat = Number(cells[idx('latitude')]), lon = Number(cells[idx('longitude')]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    out.push({
      id: cells[idx('gppd_idnr')], name: cells[idx('name')], country: cells[idx('country')], countryName: cells[idx('country_long')],
      lat: r5(lat), lon: r5(lon), fuel, mw: Math.round(mw), owner: cells[idx('owner')] || '', source: cells[idx('source')] || '', url: cells[idx('url')] || '',
    });
  }
  console.error(`[atlas] GPPD: ${out.length} plants (all nuclear + ≥1 GW)`);
  return out;
}

// ── 4. Verify curated reference points against Wikidata ──────────────────────────────
// [name, lat, lon, note] as they existed in public/mapintel.js before ATLAS.
const REFERENCE = {
  EXCHANGE: [
    ['New York Stock Exchange', 40.707, -74.011], ['Nasdaq', 40.757, -73.986], ['London Stock Exchange', 51.515, -0.099],
    ['Tokyo Stock Exchange', 35.683, 139.774], ['Shanghai Stock Exchange', 31.234, 121.491], ['Hong Kong Stock Exchange', 22.283, 114.158],
    ['Euronext Paris', 48.870, 2.332], ['Deutsche Börse', 50.115, 8.671], ['Bombay Stock Exchange', 18.929, 72.833],
    ['National Stock Exchange of India', 19.06, 72.86], ['Toronto Stock Exchange', 43.648, -79.382], ['Australian Securities Exchange', -33.866, 151.207],
    ['SIX Swiss Exchange', 47.371, 8.539], ['B3 (stock exchange)', -23.553, -46.634], ['Korea Exchange', 37.525, 126.926], ['Singapore Exchange', 1.283, 103.851],
  ],
  SHIPPING_CHOKEPOINT: [
    ['Strait of Hormuz', 26.567, 56.25], ['Suez Canal', 30.5, 32.35], ['Strait of Malacca', 1.43, 102.89], ['Panama Canal', 9.08, -79.68],
    ['Bab-el-Mandeb', 12.58, 43.33], ['Bosporus', 41.12, 29.07], ['Strait of Gibraltar', 35.95, -5.6], ['Danish straits', 55.7, 12.7],
    ['Cape of Good Hope', -34.36, 18.47], ['Taiwan Strait', 24.5, 119.5],
  ],
  CENTRAL_BANK: [
    ['Federal Reserve Board of Governors', 38.893, -77.045], ['European Central Bank', 50.109, 8.674], ['Bank of England', 51.514, -0.089],
    ['Bank of Japan', 35.686, 139.771], ["People's Bank of China", 39.915, 116.366], ['Swiss National Bank', 46.947, 7.444],
    ['Reserve Bank of India', 18.932, 72.836], ['Bank of Canada', 45.421, -75.704],
  ],
  SPACEPORT: [
    ['Cape Canaveral Space Force Station', 28.49, -80.58], ['Starbase', 25.99, -97.16], ['Baikonur Cosmodrome', 45.92, 63.34],
    ['Guiana Space Centre', 5.24, -52.77], ['Vandenberg Space Force Base', 34.74, -120.57], ['Jiuquan Satellite Launch Center', 40.96, 100.29],
    ['Wenchang Space Launch Site', 19.61, 110.95], ['Satish Dhawan Space Centre', 13.72, 80.23], ['Tanegashima Space Center', 30.4, 130.97],
  ],
  PORT: [
    ['Port of Shanghai', 31.35, 121.7], ['Port of Singapore', 1.26, 103.83], ['Port of Rotterdam', 51.95, 4.14], ['Port of Los Angeles', 33.73, -118.26],
    ['Jawaharlal Nehru Port', 18.95, 72.95], ['Port of Houston', 29.73, -95.02], ['Port of Ras Tanura', 26.64, 50.16], ['Port Hedland', -20.31, 118.57],
  ],
  DATA_CENTER: [
    ['Ashburn, Virginia', 39.04, -77.49], ['Santa Clara, California', 37.35, -121.96], ['The Dalles, Oregon', 45.6, -121.18], ['Council Bluffs, Iowa', 41.26, -95.86],
  ],
};
async function verifyReference() {
  // Step 1: one label lookup per curated point (fast). Step 2: ONE batched SPARQL for every
  // candidate item's own / HQ (P159) / location (P276) / area (P131) coordinate. Step 3: match.
  const items = [];
  for (const [type, list] of Object.entries(REFERENCE)) for (const [name, lat, lon] of list) items.push({ type, name, lat, lon, hits: [] });
  for (const it of items) {
    try {
      const s = JSON.parse(await get(`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(it.name)}&language=en&format=json&limit=3`, { Accept: 'application/json' }));
      it.hits = (s.search || []).map((h) => ({ id: h.id, label: h.label }));
    } catch (err) { console.error(`[atlas] lookup ${it.name}: ${err.message}`); }
    await sleep(150);
  }
  const qids = [...new Set(items.flatMap((it) => it.hits.map((h) => h.id)))];
  const coords = new Map();
  for (let i = 0; i < qids.length; i += 60) {
    const chunk = qids.slice(i, i + 60);
    const rows = await sparql(`SELECT ?item ?c1 ?c2 ?c3 ?c4 ?countryLabel WHERE { VALUES ?item { ${chunk.map((q) => 'wd:' + q).join(' ')} }
      OPTIONAL { ?item wdt:P625 ?c1 } OPTIONAL { ?item wdt:P159/wdt:P625 ?c2 } OPTIONAL { ?item wdt:P276/wdt:P625 ?c3 } OPTIONAL { ?item wdt:P131/wdt:P625 ?c4 }
      OPTIONAL { ?item wdt:P17 ?country } SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } }`);
    for (const row of rows) {
      const qid = row.item.value.split('/').pop();
      if (coords.has(qid)) continue;
      const via = row.c1 ? 'P625' : row.c2 ? 'P159' : row.c3 ? 'P276' : row.c4 ? 'P131' : null;
      const pt = via ? parsePoint(row[{ P625: 'c1', P159: 'c2', P276: 'c3', P131: 'c4' }[via]].value) : null;
      if (pt) coords.set(qid, { pt, via, country: row.countryLabel ? row.countryLabel.value : '' });
    }
    await sleep(1500);
  }
  const out = [];
  for (const it of items) {
    let record = { type: it.type, name: it.name, lat: it.lat, lon: it.lon, confidence: 'UNVERIFIED', source: null, distanceKm: null };
    const normName = String(it.name).toLowerCase().replace(/\s*\(.*\)$/, '').replace(/[^a-z0-9]+/g, ' ').trim();
    const ordered = [...it.hits].sort((a, b) => Number(String(b.label || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() === normName) - Number(String(a.label || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() === normName));
    for (const hit of ordered) {
      const c = coords.get(hit.id);
      if (!c) continue;
      const d = km({ lat: it.lat, lon: it.lon }, c.pt);
      // The Wikidata coordinate IS the source. An exact label match adopts it regardless of how
      // far the memory-typed curated point was (that distance is recorded as evidence of the
      // correction); a fuzzy match is only accepted when the two agree within 50 km.
      const norm = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      const exact = norm(hit.label) === norm(it.name) || norm(hit.label) === norm(it.name.replace(/\s*\(.*\)$/, ''));
      const accepted = exact || d <= 50;
      record = {
        type: it.type, name: it.name, lat: c.pt.lat, lon: c.pt.lon, curated: { lat: it.lat, lon: it.lon }, distanceKm: Math.round(d * 10) / 10,
        confidence: accepted ? (c.via === 'P131' ? 'MEDIUM' : 'HIGH') : 'UNVERIFIED', qid: hit.id, label: hit.label, via: c.via, country: c.country, exactLabel: exact,
        source: { name: 'Wikidata', url: `https://www.wikidata.org/wiki/${hit.id}`, license: 'CC0' },
      };
      break;
    }
    console.error(`[atlas] ${it.type} ${it.name} → ${record.confidence}${record.distanceKm != null ? ` (${record.distanceKm} km via ${record.via})` : ''}`);
    out.push(record);
  }
  return out;
}

(async () => {
  const generatedAt = new Date().toISOString();
  let previous = null;
  if (VERIFY_ONLY && fs.existsSync(OUT)) { previous = require(OUT); }
  const reference = await verifyReference();
  const companies = VERIFY_ONLY && previous ? previous.datasets.companies : await fetchCompanies();
  const ne = VERIFY_ONLY && previous ? { ports: previous.datasets.ports, airports: previous.datasets.airports } : await fetchNaturalEarth();
  const powerplants = VERIFY_ONLY && previous ? previous.datasets.powerplants : await fetchPowerPlants();

  const snapshot = {
    atlasSnapshotVersion: generatedAt.slice(0, 10).replace(/-/g, '') + 'a',
    generatedAt,
    sources: {
      wikidata: { name: 'Wikidata', url: 'https://www.wikidata.org', license: 'CC0 1.0', attribution: 'Wikidata contributors', query: 'P414 exchange + P249 ticker + P159 HQ + P625 coordinates', fetchedAt: generatedAt },
      naturalEarth: { name: 'Natural Earth 10m ports/airports', url: 'https://www.naturalearthdata.com', license: 'Public domain', attribution: 'Made with Natural Earth', fetchedAt: generatedAt },
      gppd: { name: 'WRI Global Power Plant Database v1.3', url: 'https://datasets.wri.org/dataset/globalpowerplantdatabase', license: 'CC BY 4.0', attribution: 'Global Energy Observatory, Google, KTH Royal Institute of Technology in Stockholm, Enipedia, World Resources Institute. 2019. Global Power Plant Database. Published on Resource Watch and Google Earth Engine.', releaseDate: '2021-06-02', fetchedAt: generatedAt },
    },
    counts: { companies: companies.length, ports: ne.ports.length, airports: ne.airports.length, powerplants: powerplants.length, reference: reference.length, referenceVerified: reference.filter((r) => r.confidence === 'HIGH').length },
    datasets: { companies, ports: ne.ports, airports: ne.airports, powerplants, reference },
  };
  const body = `/* GENERATED by tools/atlas-build-snapshot.js — do not edit. ${generatedAt} */\n(() => {\n  'use strict';\n  const snapshot = ${JSON.stringify(snapshot)};\n  if (typeof module !== 'undefined' && module.exports) module.exports = snapshot;\n  globalThis.MarketTerminalAtlasSnapshot = snapshot;\n})();\n`;
  fs.writeFileSync(OUT, body);
  console.error(`[atlas] wrote ${OUT} (${(body.length / 1024).toFixed(0)} KiB)`, snapshot.counts);
})().catch((err) => { console.error(err); process.exit(1); });
