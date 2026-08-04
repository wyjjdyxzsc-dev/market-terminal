'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { mergeTickerBasket } = require('../shared/ticker-core.js');

test('ticker basket prefers fresh pooled quotes and preserves source metadata', () => {
  const items = mergeTickerBasket(['AAPL'], {
    AAPL: { c: 303.42, d: 4.2, dp: 1.4, src: 'yahoo' },
  }, [], '2026-08-04T00:00:00Z');
  assert.deepEqual(items[0], {
    symbol: 'AAPL',
    price: 303.42,
    change: 4.2,
    percent: 1.4,
    source: 'yahoo',
    asOf: '2026-08-04T00:00:00Z',
    available: true,
    stale: false,
  });
});

test('ticker basket uses last-good data instead of replacing a quote with zero', () => {
  const items = mergeTickerBasket(['MSFT', 'NVDA'], { MSFT: null, NVDA: null }, [
    { symbol: 'MSFT', price: 487.65, change: -2, percent: -0.4, source: 'finnhub', asOf: '2026-08-03T00:00:00Z' },
  ]);
  assert.equal(items[0].price, 487.65);
  assert.equal(items[0].stale, true);
  assert.equal(items[0].available, true);
  assert.equal(items[1].price, 0);
  assert.equal(items[1].available, false);
});
