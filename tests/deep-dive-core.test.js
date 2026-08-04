'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEEP_DIVE_SCHEMA_VERSION,
  buildDeterministicDeepDive,
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

  assert.equal(DEEP_DIVE_SCHEMA_VERSION, '2026-08-04b');
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
  assert.equal(dossier.options.bias, 'Data Available');
  assert.match(dossier.options.rationale, /302\.50/);
  assert.match(dossier.options.rationale, /no options trade is recommended/i);

  assert.equal(dossier.investment.rating, 'Not Rated');
  assert.equal(dossier.investment.score, null);
  assert.match(dossier.entryZone, /^N\/A/);
  assert.match(dossier.stopLoss, /^N\/A/);
  assert.match(dossier.priceTarget, /^N\/A/);
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

test('market-cap formatting follows the provider million-dollar unit', () => {
  assert.equal(formatMarketCap(4_460_000), '$4.46T');
  assert.equal(formatMarketCap(25_500), '$25.5B');
  assert.equal(formatMarketCap(800), '$800M');
  assert.equal(formatMarketCap(null), null);
});
