'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const candleCore = require('../shared/candle-analysis-core.js');

test('detects a bullish engulfing pattern and bullish signal', () => {
  const candles = [
    { o: 105, h: 106, l: 99, c: 100 },
    { o: 99, h: 108, l: 98, c: 107 },
  ];

  const analysis = candleCore.buildDeterministicCandleAnalysis(candles, {
    currentPrice: 107,
  });

  assert.ok(analysis.patterns.some((pattern) => pattern.name === 'Bullish Engulfing'));
  assert.ok(['Buy', 'Strong Buy'].includes(analysis.overallSignal));
  assert.ok(Array.isArray(analysis.keyLevels.support));
  assert.ok(Array.isArray(analysis.keyLevels.resistance));
});

test('carries degradation notes into the summary when fallback metadata is present', () => {
  const candles = [
    { o: 100, h: 101, l: 96, c: 97 },
    { o: 97, h: 98, l: 94, c: 95 },
    { o: 95, h: 96, l: 92, c: 93 },
    { o: 93, h: 94, l: 90, c: 91 },
    { o: 91, h: 92, l: 88, c: 89 },
  ];

  const analysis = candleCore.buildDeterministicCandleAnalysis(candles, {
    currentPrice: 89,
    degraded: true,
    degradeReason: 'Intraday OHLC was unavailable, so the analysis fell back to daily 5D candles.',
  });

  assert.equal(typeof analysis.summary, 'string');
  assert.match(analysis.summary, /fell back to daily 5D candles/i);
  assert.equal(typeof analysis.recommendation, 'string');
});
