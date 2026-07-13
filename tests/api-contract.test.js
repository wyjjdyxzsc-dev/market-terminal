'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const contract = require('../shared/api-contract.js');

test('canonicalizes deprecated candle alias to the canonical route', () => {
  assert.equal(contract.canonicalPath('/api/intel/candle'), '/api/intel/candles');
  assert.equal(contract.isDeprecatedAlias('/api/intel/candle'), true);
  assert.deepEqual(contract.getAllowedMethods('/api/intel/candle'), ['GET']);
});

test('marks admin routes as protected', () => {
  assert.equal(contract.isProtectedRoute('/api/test-push'), true);
  assert.equal(contract.isProtectedRoute('/api/ai-status'), true);
  assert.equal(contract.isProtectedRoute('/api/data-status'), true);
  assert.equal(contract.isProtectedRoute('/api/quote'), false);
});

test('tracks websocket upgrade routes separately from normal GET endpoints', () => {
  const route = contract.getRoute('/api/stocks/stream');
  assert.ok(route);
  assert.equal(route.upgradeRequired, true);
  assert.deepEqual(route.methods, ['GET']);
});

test('builds structured API errors', () => {
  assert.deepEqual(
    contract.buildError(405, 'method_not_allowed', 'Method POST is not allowed for /api/quote.', { allow: ['GET'] }),
    {
      error: true,
      code: 'method_not_allowed',
      status: 405,
      message: 'Method POST is not allowed for /api/quote.',
      allow: ['GET'],
    }
  );
});
