'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEEP_DIVE_SCHEMA_VERSION,
  buildDeterministicDeepDive,
  buildOptionsChainPromptBlock,
  mergeAnalysisWithDossier,
  mergeFallbackWithDossier,
  formatMarketCap,
} = require('../shared/deep-dive-core.js');

test('deterministic deep dive turns observed provider data into a useful safe dossier', () => {
  const dossier = buildDeterministicDeepDive({
    ticker: 'AAPL',
    profile: {
      name: 'Apple Inc',
      marketCapitalization: 4_460_000,
      finnhubIndustry: 'Technology',
    },
    quote: {
      c: 303,
      d: -5,
      dp: -1.62,
      o: 307,
      h: 309,
      l: 301,
      pc: 308,
      src: 'yahoo',
    },
    metrics: {
      '52WeekHigh': 350,
      '52WeekLow': 200,
      '52WeekPriceReturnDaily': 31.4,
      peTTM: 34.5,
      pbAnnual: 52.1,
      beta: 1.08,
    },
    recommendation: {
      strongBuy: 13,
      buy: 24,
      hold: 14,
      sell: 3,
      strongSell: 0,
      period: '2026-08-01',
    },
    evidence: [
      {
        id: 'ev_generic',
        title: 'Markets open higher before a busy session',
        publisher: 'Reuters',
        publisherDomain: 'reuters.com',
        sourceTier: 'reputable-secondary',
        publishedAt: '2026-08-03T11:00:00Z',
      },
      {
        id: 'ev_one',
        title: 'Apple reports a product update',
        publisher: 'Reuters',
        publisherDomain: 'reuters.com',
        sourceTier: 'reputable-secondary',
        publishedAt: '2026-08-03T10:00:00Z',
      },
      {
        id: 'ev_two',
        title: 'Apple supply chain changes are reported',
        publisher: 'MarketWatch',
        publisherDomain: 'marketwatch.com',
        sourceTier: 'reputable-secondary',
        publishedAt: '2026-08-03T09:00:00Z',
      },
    ],
    optionsChain: {
      status: 'available',
      source: 'Nasdaq',
      sourceUrl: 'https://www.nasdaq.com/market-activity/stocks/aapl/option-chain',
      retrievedAt: '2026-08-04T00:00:00Z',
      contractCount: 50,
      expiryCount: 3,
      nearestExpiry: 'August 5, 2026',
      atTheMoney: {
        strike: 302.5,
        callLast: 4.5,
        callBid: 4.4,
        callAsk: 4.6,
        putLast: 3.9,
        putBid: 3.8,
        putAsk: 4,
      },
      activity: { putCallVolumeRatio: 0.875 },
    },
    generatedAt: '2026-08-04T00:00:00Z',
  });

  assert.equal(DEEP_DIVE_SCHEMA_VERSION, '2026-08-11a');
  assert.equal(dossier.deepDiveSchemaVersion, DEEP_DIVE_SCHEMA_VERSION);
  assert.equal(dossier.dataMode, 'deterministic-dossier');
  assert.equal(dossier.deterministic, true);
  assert.equal(dossier.quote.source, 'yahoo');
  assert.equal(dossier.stats.marketCap, '$4.46T');
  assert.equal(dossier.stats.rangePosition, 68.7);
  assert.equal(dossier.analystConsensus.total, 54);
  assert.match(dossier.summary, /latest pooled quote of \$303\.00/);
  assert.match(dossier.summary, /54 ratings/);
  assert.ok(dossier.bullCase.length > 0);
  assert.ok(dossier.bearCase.length > 0);
  assert.ok(dossier.catalysts.length > 0);
  assert.ok(dossier.catalysts.every((item) => !item.includes('Markets open higher')));
  assert.ok(dossier.risks.length > 0);
  assert.equal(dossier.dataSources.news.sourceCount, 2);
  assert.equal(dossier.dataSources.news.status, 'corroborated');
  assert.equal(dossier.equityData.status, 'available');
  assert.equal(dossier.equityData.coverageScore, 100);
  assert.equal(dossier.dataSources.options.status, 'available');
  assert.equal(dossier.options.bias, 'Data Only');
  assert.match(dossier.options.rationale, /302\.50/);
  assert.match(dossier.options.rationale, /AI options view did not complete/i);

  // The dossier is the fallback shown when the AI analysis does not complete, so it
  // reports the gap plainly instead of inventing a rating or trade levels.
  assert.equal(dossier.investment.rating, 'Not Rated');
  assert.equal(dossier.investment.score, null);
  assert.match(dossier.investment.thesis, /AI analyst narrative did not complete/i);
  assert.match(dossier.entryZone, /^N\/A/);
  assert.match(dossier.stopLoss, /^N\/A/);
  assert.match(dossier.priceTarget, /^N\/A/);
});

test('options-chain prompt block grounds the AI in real listed contracts', () => {
  const block = buildOptionsChainPromptBlock({
    status: 'available',
    source: 'Nasdaq',
    retrievedAt: '2026-08-04T00:00:00Z',
    contractCount: 47,
    expiryCount: 3,
    nearestExpiry: 'August 15, 2026',
    atTheMoney: {
      strike: 302.5,
      callBid: 3.4, callAsk: 3.55, callLast: 3.5, callVolume: 1204, callOpenInterest: 8891,
      putBid: 2.9, putAsk: 3.05, putLast: 3.0, putVolume: 903, putOpenInterest: 7213,
    },
    activity: {
      callVolume: 45201, putVolume: 31022, putCallVolumeRatio: 0.686,
      callOpenInterest: 210331, putOpenInterest: 150223, putCallOpenInterestRatio: 0.714,
    },
  });

  assert.match(block, /47 rows across 3 expiries/);
  assert.match(block, /August 15, 2026/);
  assert.match(block, /Nearest strike 302\.50/);
  assert.match(block, /3\.40\/3\.55 bid\/ask/);
  assert.match(block, /put\/call 0\.686/);
  assert.match(block, /Implied volatility and Greeks are NOT supplied/);

  const missing = buildOptionsChainPromptBlock({ status: 'unavailable', reason: 'Nasdaq was unreachable.' });
  assert.match(missing, /unavailable \(Nasdaq was unreachable\.\)/);
  assert.match(missing, /Do not invent strikes/);
});

test('deterministic deep dive discloses missing inputs without inventing values', () => {
  const dossier = buildDeterministicDeepDive({ ticker: 'TEST', generatedAt: '2026-08-04T00:00:00Z' });

  assert.equal(dossier.quote, null);
  assert.equal(dossier.stats.marketCap, null);
  assert.equal(dossier.analystConsensus, null);
  assert.equal(dossier.dataSources.quote.status, 'unavailable');
  assert.equal(dossier.dataSources.fundamentals.status, 'unavailable');
  assert.equal(dossier.dataSources.news.status, 'unavailable');
  assert.equal(dossier.dataSources.options.status, 'unavailable');
  assert.equal(dossier.equityData.coverageScore, 0);
  assert.equal(dossier.options.bias, 'Unavailable');
  assert.match(dossier.summary, /no usable quote, fundamental metric, or analyst record/i);
  assert.ok(dossier.risks.some((risk) => /No usable pooled quote/.test(risk)));
  assert.doesNotMatch(dossier.summary, /\$0(?:\.00)?/);
});

test('a completed analysis keeps its ratings, levels, and options view', () => {
  const baseline = buildDeterministicDeepDive({
    ticker: 'AAPL',
    profile: { name: 'Apple Inc', marketCapitalization: 4_460_000 },
    quote: { c: 303, d: 2, dp: 0.66, src: 'yahoo' },
    metrics: { peTTM: 31.2 },
    optionsChain: { status: 'available', contractCount: 48, expiryCount: 2, source: 'Nasdaq' },
    generatedAt: '2026-08-11T00:00:00Z',
  });
  const merged = mergeAnalysisWithDossier(baseline, {
    company: 'Apple Inc.',
    summary: 'Analyst summary.',
    investment: { rating: 'Buy', score: 78, conviction: 'Medium', horizon: '6-12 months', fairValue: '$330' },
    options: { recommendation: 'Bull call spread, Aug 15, 300/315', bias: 'Calls', score: 64, impliedVolatility: 'Medium', timeframe: 'Monthly' },
    technicalBias: 'Bullish',
    entryZone: '$298-304',
    stopLoss: '$286',
    priceTarget: '$335',
    bullCase: ['a', 'b', 'c'],
    // A model must never be able to overwrite measured data.
    quote: { price: 999 },
    optionsChain: { contractCount: 1 },
  });

  assert.equal(merged.investment.rating, 'Buy');
  assert.equal(merged.investment.score, 78);
  assert.equal(merged.options.bias, 'Calls');
  assert.match(merged.options.recommendation, /Bull call spread/);
  assert.equal(merged.technicalBias, 'Bullish');
  assert.equal(merged.entryZone, '$298-304');
  assert.equal(merged.priceTarget, '$335');
  assert.equal(merged.aiNarrativeStatus, 'ready');
  assert.equal(merged.deterministic, false);
  assert.equal(merged.dataMode, 'ai-analysis-with-deterministic-data');

  assert.equal(merged.quote.price, 303);
  assert.equal(merged.quote.source, 'yahoo');
  assert.equal(merged.optionsChain.contractCount, 48);
  assert.equal(merged.stats.marketCap, '$4.46T');
  assert.equal(merged.ticker, 'AAPL');
});

test('a failed analysis falls back to the dossier without a half-populated rating', () => {
  const baseline = buildDeterministicDeepDive({
    ticker: 'AAPL',
    profile: { name: 'Apple Inc' },
    quote: { c: 303, src: 'yahoo' },
    generatedAt: '2026-08-11T00:00:00Z',
  });
  const merged = mergeFallbackWithDossier(baseline, {
    abstained: true,
    investment: { rating: 'Strong Buy' },
    priceTarget: '$500',
    policy: { status: 'abstained', reason: 'No provider available.' },
  });

  assert.equal(merged.investment.rating, 'Not Rated');
  assert.equal(merged.priceTarget, 'N/A');
  assert.equal(merged.aiNarrativeStatus, 'unavailable');
  assert.equal(merged.deterministic, true);
  assert.equal(merged.policy.status, 'abstained');
  assert.equal(merged.quote.price, 303);
});

test('market-cap formatting follows the provider million-dollar unit', () => {
  assert.equal(formatMarketCap(4_460_000), '$4.46T');
  assert.equal(formatMarketCap(25_500), '$25.5B');
  assert.equal(formatMarketCap(800), '$800M');
  assert.equal(formatMarketCap(null), null);
});
