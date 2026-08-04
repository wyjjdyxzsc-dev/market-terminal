'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  OPTIONS_CHAIN_SCHEMA_VERSION,
  normalizeNasdaqOptionChain,
} = require('../shared/options-chain-core.js');

test('Nasdaq options rows become a bounded at-the-money snapshot', () => {
  const payload = {
    data: {
      totalRecord: 120,
      lastTrade: 'LAST TRADE: $101.00',
      table: {
        rows: [
          { expirygroup: 'August 7, 2026', strike: null },
          { expiryDate: 'Aug 7', strike: '95.00', c_Bid: '6.00', c_Ask: '6.40', c_Volume: '100', c_Openinterest: '1,200', p_Bid: '0.20', p_Ask: '0.30', p_Volume: '80', p_Openinterest: '900' },
          { expiryDate: 'Aug 7', strike: '100.00', c_Bid: '2.20', c_Ask: '2.40', c_Volume: '200', c_Openinterest: '2,000', p_Bid: '1.10', p_Ask: '1.20', p_Volume: '150', p_Openinterest: '1,500' },
          { expirygroup: 'August 14, 2026', strike: null },
          { expiryDate: 'Aug 14', strike: '100.00', c_Bid: '3.20', c_Ask: '3.50', c_Volume: '50', c_Openinterest: '500', p_Bid: '2.00', p_Ask: '2.20', p_Volume: '70', p_Openinterest: '600' },
        ],
      },
    },
  };
  const chain = normalizeNasdaqOptionChain(payload, {
    ticker: 'TEST',
    spot: 101,
    retrievedAt: '2026-08-04T00:00:00Z',
  });

  assert.equal(chain.schemaVersion, OPTIONS_CHAIN_SCHEMA_VERSION);
  assert.equal(chain.status, 'available');
  assert.equal(chain.contractCount, 3);
  assert.equal(chain.expiryCount, 2);
  assert.equal(chain.nearestExpiry, 'August 7, 2026');
  assert.equal(chain.atTheMoney.strike, 100);
  assert.equal(chain.activity.callVolume, 350);
  assert.equal(chain.activity.putVolume, 300);
  assert.equal(chain.activity.putCallVolumeRatio, 0.857);
  assert.equal(chain.impliedVolatility, null);
  assert.equal(chain.greeksAvailable, false);
  assert.match(chain.sourceUrl, /\/test\/option-chain$/);
});

test('missing option rows return an explicit unavailable state', () => {
  const chain = normalizeNasdaqOptionChain({ data: { table: { rows: [] } } }, { ticker: 'NONE' });
  assert.equal(chain.status, 'unavailable');
  assert.equal(chain.contractCount, 0);
  assert.match(chain.reason, /No listed options-chain rows/);
});
