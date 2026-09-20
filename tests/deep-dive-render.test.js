'use strict';

// MT2-1 REWIND: the Deep Dive report render contract. The analyst-report hierarchy from
// 42af0f6 (+ 6fafe78 level chips) must exist when analysis is available, and the fallback
// under B-002 must keep the same structure while never inventing a rating, level, or IV.

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildDeterministicDeepDive, mergeAnalysisWithDossier, mergeFallbackWithDossier } = require('../shared/deep-dive-core.js');
const { DEEP_DIVE_RENDER_CONTRACT, renderDeepDiveReport } = require('../public/deepdive.js');

const EVIDENCE = [
  { id: 'ev_one', title: 'Apple reports a product update', publisher: 'Reuters', publisherDomain: 'reuters.com', sourceTier: 'reputable-secondary', publishedAt: '2026-09-19T10:00:00Z', sourceUrl: 'https://www.reuters.com/apple-update' },
  { id: 'ev_two', title: 'Apple supply chain <b>changes</b>', publisher: 'MarketWatch', publisherDomain: 'marketwatch.com', sourceTier: 'reputable-secondary', publishedAt: '2026-09-19T09:00:00Z', sourceUrl: 'javascript:alert(1)' },
];

function baseline(extra = {}) {
  return buildDeterministicDeepDive({
    ticker: 'AAPL',
    profile: { name: 'Apple Inc', marketCapitalization: 4_910_000, finnhubIndustry: 'Technology', logo: 'https://static.finnhub.io/logo/aapl.png' },
    quote: { c: 336.13, d: -0.87, dp: -0.26, o: 337, h: 339, l: 335, pc: 337, src: 'finnhub' },
    metrics: { '52WeekHigh': 344.57, '52WeekLow': 236.65, '52WeekPriceReturnDaily': 41.3, peTTM: 38, pbAnnual: 51, beta: 1.09 },
    recommendation: { strongBuy: 12, buy: 22, hold: 15, sell: 3, strongSell: 1, period: '2026-09-01' },
    evidence: EVIDENCE,
    optionsChain: {
      status: 'available', source: 'Nasdaq',
      sourceUrl: 'https://www.nasdaq.com/market-activity/stocks/aapl/option-chain',
      retrievedAt: '2026-09-20T03:00:00Z', contractCount: 48, expiryCount: 2, nearestExpiry: 'September 26, 2026',
      atTheMoney: { strike: 335, callBid: 2.27, callAsk: 2.56, callLast: 2.4, putBid: 1.29, putAsk: 1.7, putLast: 1.5, callVolume: 1200, putVolume: 800, callOpenInterest: 5000, putOpenInterest: 4000 },
      activity: { callVolume: 20000, putVolume: 9100, putCallVolumeRatio: 0.455 },
    },
    generatedAt: '2026-09-20T03:00:00Z',
    ...extra,
  });
}

const ANALYSIS = {
  company: 'Apple Inc.',
  summary: 'Apple is holding near highs into the iPhone cycle.',
  newsSentiment: 'positive',
  keyDrivers: 'iPhone demand commentary and a bullish Wall Street call.',
  investment: { rating: 'Buy', score: 74, conviction: 'Medium', horizon: '6-12 months', fairValue: '$350-370', thesis: 'Services mix keeps margins rising.' },
  options: { recommendation: 'Bull call spread, Sep 26 expiry, 335/345 strikes', bias: 'Calls', score: 61, impliedVolatility: 'Medium', timeframe: 'Monthly', rationale: 'Premiums are moderate relative to spot.' },
  technicalBias: 'Bullish',
  entryZone: '$330-336',
  stopLoss: '$318',
  priceTarget: '$365',
  bullCase: ['Services growth', 'Buybacks', 'iPhone upgrade cycle'],
  bearCase: ['China exposure', 'Valuation', 'Regulatory pressure'],
  catalysts: ['Earnings', 'Product event'],
  risks: ['Tariffs', 'FX'],
  evidenceIds: ['ev_one'],
  policy: { status: 'grounded', evidenceCount: 2, dataAsOf: '2026-09-20T03:00:00Z', verifier: 'deterministic-evidence-and-citation-check', runtime: { generator: { provider: 'gemini', servedModel: 'gemini-2.5-pro' } } },
  evidence: EVIDENCE,
};

const orderOf = (html, markers) => markers.map((m) => { const i = html.indexOf(m); assert.notEqual(i, -1, `missing marker ${m}`); return i; });
const isAscending = (arr) => arr.every((v, i) => i === 0 || v > arr[i - 1]);

test('render contract version is pinned', () => {
  assert.equal(DEEP_DIVE_RENDER_CONTRACT, '2026-09-20a');
});

test('available analysis renders the original 42af0f6 analyst-report hierarchy', () => {
  const data = mergeAnalysisWithDossier(baseline(), ANALYSIS);
  const html = renderDeepDiveReport(data);

  assert.match(html, /data-dd-state="analysis"/);
  // Ordering: head → summary → ratings → drivers → levels → bull/bear → catalysts/risks → stats → consensus → sources → open
  const order = orderOf(html, [
    'class="dd-head"', 'class="dd-summary"', 'class="dd-ratings"', 'dd-rating-kind">STOCK', 'dd-rating-kind">OPTIONS',
    'class="dd-drivers"', 'class="dd-levels"', '▲ BULL CASE', '▼ BEAR CASE', '⚡ CATALYSTS', '⚠ RISKS',
    'class="dd-stats"', 'class="dd-consensus"', 'class="dd-sources"', 'class="dd-open"', 'class="dd-disclaimer"',
  ]);
  assert.ok(isAscending(order), 'report sections must follow the original hierarchy');

  // The report, not the data desk, comes first: nothing from the sources block precedes the summary.
  assert.ok(html.indexOf('dd-provenance') > html.indexOf('class="dd-summary"'));
  assert.ok(html.indexOf('dd-evidence') > html.indexOf('class="dd-consensus"'));
  assert.doesNotMatch(html, /policy-notice/);
  assert.doesNotMatch(html, /EQUITY DATA/);

  // Stock card
  assert.match(html, /dd-rating rate-buy/);
  assert.match(html, /dd-rating-badge">Buy</);
  assert.match(html, /dd-rating-score">74<i>\/100/);
  assert.match(html, /Medium conviction · 6-12 months/);
  assert.match(html, /Fair value: <b>\$350-370/);
  // Options card, grounded in the measured chain with IV marked as inferred
  assert.match(html, /dd-rating bias-calls/);
  assert.match(html, /dd-rating-badge">Calls</);
  assert.match(html, /dd-rating-score">61<i>\/100/);
  assert.match(html, /IV Medium \(inferred\) · Monthly/);
  assert.match(html, /Bull call spread, Sep 26 expiry, 335\/345 strikes/);
  assert.match(html, /48 rows · 2 expiries · nearest September 26, 2026/);
  assert.match(html, /335\.00.*2\.27\/2\.56/);
  assert.match(html, /href="https:\/\/www\.nasdaq\.com\/market-activity\/stocks\/aapl\/option-chain"/);
  // Levels (6fafe78)
  assert.match(html, /dd-level-bias--bullish/);
  assert.match(html, /ENTRY<\/span><b>\$330-336/);
  assert.match(html, /STOP<\/span><b>\$318/);
  assert.match(html, /TARGET<\/span><b>\$365/);
  // Measured data still wins
  assert.match(html, /\$336\.13/);
  assert.match(html, /MKT CAP<\/span><b>\$4\.91T/);
  assert.match(html, /53 ratings · 2026-09-01/);
  assert.match(html, /NEWS TONE<\/span><b class="tone-positive">POSITIVE/);
  // Sources preserved, compact, at the bottom
  assert.match(html, /KEY DATA &amp; SOURCES/);
  assert.match(html, /generated by gemini\/gemini-2\.5-pro/);
  assert.match(html, /Cited: <a href="https:\/\/www\.reuters\.com\/apple-update"/);
  assert.match(html, /AI-generated analysis/);
});

test('fallback under B-002 keeps the report structure without inventing ratings or levels', () => {
  const data = mergeFallbackWithDossier(baseline(), {
    abstained: true,
    policy: { status: 'abstained', reason: 'No policy-approved AI provider is currently available for this task.', evidenceCount: 2, dataAsOf: '2026-09-20T03:00:00Z', verifier: 'deterministic-evidence-and-citation-check', runtime: { attempts: [{ provider: 'github' }, { provider: 'cfai' }] } },
    evidence: EVIDENCE,
    investment: { rating: 'Strong Buy', score: 99 },
    priceTarget: '$999',
  });
  const html = renderDeepDiveReport(data);

  assert.match(html, /data-dd-state="fallback"/);
  const order = orderOf(html, [
    'class="dd-head"', 'class="dd-notice"', 'AI ANALYSIS UNAVAILABLE — LIVE DATA SHOWN', 'class="dd-summary"',
    'class="dd-ratings"', 'dd-rating-kind">STOCK', 'dd-rating-kind">OPTIONS', 'class="dd-cases"', 'class="dd-stats"',
    'class="dd-consensus"', 'class="dd-sources"', 'class="dd-open"',
  ]);
  assert.ok(isAscending(order));
  assert.match(html, /No policy-approved AI provider is currently available/);
  assert.match(html, /no model output accepted after 2 attempts \(github, cfai\)/);

  // Truthful stock card: same slot, explicit not-rated, no fabricated score or fair value.
  assert.match(html, /dd-rating rate-unrated/);
  assert.match(html, /dd-rating-badge">NOT RATED</);
  assert.match(html, /dd-rating-score">—<i>\/100/);
  assert.doesNotMatch(html, /dd-rating-badge">Strong Buy/);
  assert.doesNotMatch(html, /dd-rating-score">99/);
  assert.doesNotMatch(html, /Fair value/);
  assert.doesNotMatch(html, /\$999/);
  // Options card shows the measured chain only, with no IV claim.
  assert.match(html, /dd-rating bias-chain/);
  assert.match(html, /dd-rating-badge">CHAIN ONLY</);
  assert.match(html, /dd-rating-score">48<i> rows/);
  assert.match(html, /IV not supplied by the chain feed/);
  assert.match(html, /Nearest strike 335\.00: call 2\.27\/2\.56 bid\/ask · put 1\.29\/1\.70 bid\/ask/);
  assert.match(html, /put\/call volume 0\.455/);
  assert.doesNotMatch(html, /AI options view did not complete/);
  // No levels or analyst case labels are implied.
  assert.doesNotMatch(html, /class="dd-levels"/);
  assert.doesNotMatch(html, /BULL CASE/);
  assert.match(html, /SUPPORTING OBSERVATIONS/);
  assert.match(html, /DATA LIMITS/);
  assert.match(html, /NEWS TONE<\/span><b class="tone-unrated">UNRATED/);
  assert.match(html, /Live terminal data/);
  assert.doesNotMatch(html, /EQUITY DATA/);
});

test('fallback without a chain says so instead of showing an empty options view', () => {
  const data = mergeFallbackWithDossier(
    baseline({ optionsChain: { status: 'unavailable', reason: 'Nasdaq returned no rows.', source: 'Nasdaq' } }),
    { abstained: true, policy: { status: 'abstained', reason: 'x' } }
  );
  const html = renderDeepDiveReport(data);
  assert.match(html, /dd-rating bias-unavailable/);
  assert.match(html, /dd-rating-badge">NO CHAIN</);
  assert.match(html, /Nasdaq returned no rows\./);
  assert.doesNotMatch(html, /View source chain/);
});

test('render never emits unsafe provider URLs or unescaped model text', () => {
  const data = mergeAnalysisWithDossier(
    baseline({ profile: { name: 'Apple Inc', logo: 'javascript:alert(1)' } }),
    { ...ANALYSIS, summary: '<img src=x onerror=alert(1)>', evidence: EVIDENCE, evidenceIds: ['ev_two'] }
  );
  const html = renderDeepDiveReport(data);
  assert.doesNotMatch(html, /javascript:/);
  assert.doesNotMatch(html, /<img class="dd-logo"/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /Apple supply chain &lt;b&gt;changes&lt;\/b&gt;/);
  // The evidence row with the unsafe URL still appears, unlinked.
  assert.match(html, /<span>Apple supply chain &lt;b&gt;changes/);

  const chainBad = mergeAnalysisWithDossier(
    baseline({ optionsChain: { status: 'available', source: 'Nasdaq', sourceUrl: 'javascript:alert(2)', contractCount: 3, expiryCount: 1 } }),
    ANALYSIS
  );
  assert.doesNotMatch(renderDeepDiveReport(chainBad), /javascript:/);
});

test('NEGATIVE CONTROL (TWINCORE): an INR dossier never renders a dollar sign, a legacy one still does', () => {
  const ind = buildDeterministicDeepDive({
    ticker: 'RELIANCE', company: 'Reliance Industries', quote: { c: 1226.4, d: -17.5, dp: -1.4, pc: 1243.9, src: 'yahoo' },
    metrics: { '52WeekHigh': 1600, '52WeekLow': 1100 }, evidence: [],
    market: { id: 'IN', exchange: 'NSE', currency: 'INR', currencySymbol: '₹', quoteTruth: 'DELAYED' },
  });
  const html = renderDeepDiveReport(mergeFallbackWithDossier(ind, {}));
  assert.doesNotMatch(html, /\$\d/, 'no $-prefixed number for an INR instrument');
  assert.match(html, /₹1226\.40/);
  assert.match(html, /dd-market-chip">NSE</);
  assert.match(html, /data-fresh="delayed"/);
  const us = buildDeterministicDeepDive({ ticker: 'AAPL', quote: { c: 336.13, d: -0.87, dp: -0.26, pc: 337, src: 'finnhub' }, evidence: [] });
  assert.match(renderDeepDiveReport(mergeFallbackWithDossier(us, {})), /\$336\.13/);
});
