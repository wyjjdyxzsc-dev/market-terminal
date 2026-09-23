'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../shared/launchpad-core.js');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const feed = { ipoCalendar: [
  { date: '2026-09-30', exchange: 'NASDAQ Global Select', name: 'Example One', symbol: 'EXM', status: 'expected', price: '18-20', numberOfShares: 2000000, totalSharesValue: 38000000 },
  { date: '2026-10-02', exchange: 'NASDAQ Capital', name: 'Example Two', symbol: 'TWO', status: 'expected', numberOfShares: 0, totalSharesValue: 0 },
  { date: '2026-10-02', exchange: 'NYSE', name: 'Example Three', symbol: 'THR', status: 'filed' },
  { date: 'bad', exchange: 'NASDAQ', name: 'Invalid', symbol: 'BAD' },
] };

test('IPO normalization preserves observed fields and rejects missing values rather than zero-filling', () => {
  const events = core.normalizeCalendar(feed, { asOf: '2026-09-23T00:00:00Z' });
  assert.equal(events.length, 3);
  const exm = events.find(e => e.symbol === 'EXM');
  assert.equal(exm.exchange, 'NASDAQ');
  assert.equal(exm.totalSharesValue, 38000000);
  assert.equal(exm.source.retrievedAt, '2026-09-23T00:00:00Z');
  assert.equal(events.find(e => e.symbol === 'TWO').totalSharesValue, null);
});

test('impact graph uses measured shared venue/window and sourced NEXUS edges without inferred impact', () => {
  const events = core.normalizeCalendar(feed);
  const exm = events.find(e => e.symbol === 'EXM');
  const graph = core.buildImpactGraph(events, exm.id,
    [{ id: 'US:NASDAQ:EXM', market: 'US', exchange: 'NASDAQ', symbol: 'EXM' }, { id: 'US:NASDAQ:SUP', market: 'US', exchange: 'NASDAQ', symbol: 'SUP' }],
    [{ sourceId: 'US:NASDAQ:EXM', targetId: 'US:NASDAQ:SUP', relation: 'supplier', evidence: [{ sourceUrl: 'https://www.sec.gov/example' }] }]);
  assert.ok(graph.edges.some(e => e.type === 'shared_venue_window' && e.targetId.includes('TWO')));
  assert.ok(!graph.edges.some(e => e.targetId.includes('THR')));
  assert.ok(graph.edges.some(e => e.type === 'supplier'));
  assert.match(graph.limits.join(' '), /no price impact/);
});

test('unsupported India calendar never re-labels US records as India', () => {
  const events = core.normalizeCalendar(feed, { market: 'IN' });
  assert.deepEqual(events, []);
});

function sebiRow(title, date, slug) {
  return `<tr><td>${date}</td><td><a href="https://www.sebi.gov.in/filings/public-issues/sep-2026/${slug}.html" title="${title}" class="points">${title}</a></td></tr>`;
}
function listing(rows) { return `<table id="sample_1"><thead><tr><th>Date</th><th>Title</th></tr></thead><tbody>${rows.join('')}</tbody></table>`; }
const at = '2026-09-23T10:00:00Z';

test('SEBI parser validates live table shape, count and source URLs', () => {
  const html = listing([sebiRow('Example Industries Limited - DRHP', 'Sep 20, 2026', 'example-drhp')]);
  const records = core.parseSeBIListing(html, 10, at);
  assert.equal(records.length, 1);
  assert.equal(records[0].sourceType, 'DRAFT_OFFER_DOCUMENT');
  assert.equal(records[0].url, 'https://www.sebi.gov.in/filings/public-issues/sep-2026/example-drhp.html');
  assert.throws(() => core.parseSeBIListing('<html>Error</html>', 10, at), /structure invalid/);
  assert.throws(() => core.parseSeBIListing(listing([]), 10, at), /zero records/);
});

test('India DRHP, amendment and RHP reconcile into one IPO with preserved timeline', () => {
  const records = [
    ...core.parseSeBIListing(listing([sebiRow('Example Industries Limited - DRHP', 'Sep 20, 2026', 'example-drhp')]), 10, at),
    ...core.parseSeBIListing(listing([sebiRow('Example Industries Limited - Updated DRHP', 'Sep 21, 2026', 'example-update')]), 10, at),
    ...core.parseSeBIListing(listing([sebiRow('Example Industries Limited - RHP', 'Sep 22, 2026', 'example-rhp')]), 11, at),
    ...core.parseSeBIListing(listing([sebiRow('Other Industries Limited - DRHP', 'Sep 20, 2026', 'other-drhp')]), 10, at),
    ...core.parseSeBIListing(listing([sebiRow('Third Industries Limited - DRHP', 'Sep 20, 2026', 'third-drhp')]), 10, at),
  ];
  const result = core.buildIndiaRegistry(records, { retrievedAt: at });
  assert.equal(result.accounting.fetched, 5);
  assert.equal(result.accounting.accepted, 3);
  assert.equal(result.accounting.duplicates, 2);
  const ipo = result.events.find(e => e.name === 'Example Industries Limited');
  assert.deepEqual(ipo.timeline.map(t => t.state), ['DRAFT_FILED', 'UPDATED_FILING', 'FILED']);
  assert.equal(ipo.market, 'IN'); assert.equal(ipo.currency, 'INR');
  assert.equal(ipo.id, 'IN:IPO:EXAMPLEINDUSTRIESLIMITED');
  assert.equal(ipo.expectedListingDate, null); assert.equal(ipo.confirmedListingDate, null);
  assert.equal(ipo.offer.issueSize, null); assert.equal(ipo.offer.offerForSale, null);
  assert.equal(ipo.offer.priceBand, null); assert.equal(ipo.offer.useOfProceeds, null);
  assert.deepEqual(ipo.offer.brlms, []);
  assert.equal(ipo.evidence.length, 3);
  assert.equal(ipo.evidence[0].sourceOwner, 'SEBI');
  assert.equal(ipo.evidence[0].url, 'https://www.sebi.gov.in/filings/public-issues/sep-2026/example-drhp.html');
  assert.equal(core.searchIpos(result.events, 'Example Industries Limited')[0].id, ipo.id);
  assert.equal(core.buildImpactGraph(result.events, ipo.id, [{ id:'IN:NSE:EXAMPLE', market:'IN', symbol:'EXAMPLE' }], []).edges.length, 0);
});

test('ampersand and AND issuer spelling cannot create a second IPO', () => {
  const rows = [
    { family:11, sourceType:'RED_HERRING_DOCUMENT', title:'Manipal Payment and Identity Solutions Limited - RHP', date:'2026-09-21', url:'https://www.sebi.gov.in/filings/public-issues/sep-2026/manipal-rhp.html' },
    { family:12, sourceType:'FINAL_OFFER_DOCUMENT', title:'Manipal Payment & Identity Solutions Limited - Prospectus', date:'2026-09-22', url:'https://www.sebi.gov.in/filings/public-issues/sep-2026/manipal-final.html' },
    { family:10, sourceType:'DRAFT_OFFER_DOCUMENT', title:'Other Limited - DRHP', date:'2026-09-20', url:'https://www.sebi.gov.in/filings/public-issues/sep-2026/other.html' },
    { family:10, sourceType:'DRAFT_OFFER_DOCUMENT', title:'Third Limited - DRHP', date:'2026-09-20', url:'https://www.sebi.gov.in/filings/public-issues/sep-2026/third.html' },
  ];
  const result = core.buildIndiaRegistry(rows, { retrievedAt:at });
  assert.equal(result.events.length, 3);
  assert.equal(result.accounting.duplicates, 1);
  assert.equal(result.events.find(e => e.name.includes('Manipal')).timeline.length, 2);
});

test('withdrawn filing is retained and an old expected date is never promoted to confirmed', () => {
  const base = 'https://www.sebi.gov.in/filings/public-issues/sep-2026/';
  const rows = [
    { family:10, title:'Example Limited - DRHP', date:'2026-09-01', url:base+'example-draft.html' },
    { family:10, title:'Example Limited - Withdrawal', date:'2026-09-22', url:base+'example-withdrawal.html' },
    { family:10, title:'Other Limited - DRHP', date:'2026-09-20', url:base+'other.html' },
    { family:10, title:'Third Limited - DRHP', date:'2026-09-20', url:base+'third.html' },
  ];
  const { events } = core.buildIndiaRegistry(rows, { retrievedAt:at });
  const ipo = events.find(e => e.name === 'Example Limited');
  assert.equal(ipo.status, 'WITHDRAWN');
  assert.deepEqual(ipo.timeline.map(t => t.state), ['DRAFT_FILED', 'WITHDRAWN']);
  assert.equal(ipo.confirmedListingDate, null);
  assert.equal(ipo.expectedListingDate, null);
  assert.ok(events.includes(ipo));
});

test('search ranks an exact company before a partial company and does not invent sector or banks', () => {
  const events = [
    { name:'Moneyview Limited', date:'2026-09-20', sector:null, leadBanks:[], offer:{brlms:[]} },
    { name:'Moneyview', date:'2026-09-19', sector:'Financials', leadBanks:['Example Bank'], offer:{brlms:[]} },
  ];
  assert.equal(core.searchIpos(events, 'Moneyview')[0].name, 'Moneyview');
  assert.equal(core.searchIpos(events, 'Example Bank')[0].name, 'Moneyview');
  assert.deepEqual(core.searchIpos(events, 'unknown sector'), []);
});

test('official ISIN listing resolves NSE and BSE to one NEXUS company and preserves history', () => {
  const ipo = { id:'IN:IPO:EXAMPLELIMITED', market:'IN', name:'Example Limited', status:'FILED', phase:'upcoming', timeline:[], nexus:{state:'UNKNOWN'}, atlas:{state:'UNKNOWN'} };
  const securities = [
    { id:'IN:NSE:EXAMPLE', market:'IN', exchange:'NSE', isin:'INE123A01010', companyId:'company:in:isin:INE123A01010', geoEntityId:'company:Q123' },
    { id:'IN:BSE:123456', market:'IN', exchange:'BSE', isin:'INE123A01010', companyId:'company:in:isin:INE123A01010' },
  ];
  const listing = { isin:'INE123A01010', confirmedListingDate:'2026-09-23', sourceOwner:'NSE', sourceUrl:'https://www.nseindia.com/companies-listing/example', retrievedAt:at };
  const result = core.applyOfficialListing(ipo, listing, securities);
  assert.equal(result.status, 'LISTED'); assert.equal(result.phase, 'recent');
  assert.equal(result.nexus.companyId, 'company:in:isin:INE123A01010');
  assert.equal(result.nexus.securities.length, 2);
  assert.equal(result.atlas.geoEntityId, 'company:Q123');
  assert.equal(result.timeline.length, 1);
  assert.equal(ipo.status, 'FILED');
  assert.equal(core.applyOfficialListing(ipo, { ...listing, sourceUrl:'https://news.example.com/foo' }, securities), ipo);
  assert.throws(() => core.applyOfficialListing(ipo, listing, securities.map((s,i) => ({...s, companyId:'different:'+i}))), /multiple NEXUS/);
});

test('snapshot build rejects an HTML error page and preserves the prior good bytes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'padlock-'));
  try {
    const output = path.join(dir, 'snapshot.js');
    fs.copyFileSync(path.join(__dirname, '..', 'shared', 'launchpad-snapshot.js'), output);
    const before = fs.readFileSync(output);
    for (const family of [10, 11, 12, 78]) fs.writeFileSync(path.join(dir, family + '.html'), '<html>Service unavailable</html>');
    const result = spawnSync(process.execPath, [path.join(__dirname, '..', 'tools', 'launchpad-build-snapshot.js'), '--fixture-dir', dir, '--output', output], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /structure invalid/);
    assert.ok(before.equals(fs.readFileSync(output)));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
