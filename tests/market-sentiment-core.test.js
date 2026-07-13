'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { analyzeMarketSentiment, headlineSignal, labelForScore } = require('../shared/market-sentiment-core.js');

test('headline sentiment uses deterministic financial terms', () => {
  assert.ok(headlineSignal('Stocks rally as inflation falls') > 0);
  assert.ok(headlineSignal('Shares slump after earnings miss') < 0);
  assert.equal(headlineSignal('Company schedules annual meeting'), 0);
});

test('market sentiment combines benchmark breadth and news evidence', () => {
  const result = analyzeMarketSentiment({
    generatedAt: '2026-07-13T12:00:00Z',
    benchmarks: [
      { symbol: 'SPY', changePercent: 1.2, source: 'yahoo' },
      { symbol: 'QQQ', changePercent: 0.9, source: 'finnhub' },
      { symbol: 'DIA', changePercent: 0.5, source: 'yahoo' },
      { symbol: 'IWM', changePercent: -0.1, source: 'finnhub' },
    ],
    headlines: Array.from({ length: 8 }, (_, index) => ({
      title: `Markets rally on growth optimism ${index}`,
      source: index % 2 ? 'Reuters' : 'CNBC',
      sourceUrl: `https://example.com/${index}`,
      evidence: { id: `ev-${index}` },
    })),
  });

  assert.equal(result.status, 'live');
  assert.equal(result.dataMode, 'deterministic');
  assert.equal(result.benchmarkCount, 4);
  assert.equal(result.headlineCount, 8);
  assert.equal(result.evidence.length, 8);
  assert.ok(result.score > 0.15);
  assert.match(result.summary, /tracked benchmarks/);
});

test('market sentiment discloses degraded coverage', () => {
  const result = analyzeMarketSentiment({
    benchmarks: [{ symbol: 'SPY', changePercent: -1.5, source: 'yahoo' }],
    headlines: [],
  });

  assert.equal(result.status, 'degraded');
  assert.equal(result.label, 'Strongly Bearish');
  assert.equal(result.sourceCount, 1);
  assert.equal(labelForScore(0), 'Neutral');
});
