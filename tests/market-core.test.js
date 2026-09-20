'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../shared/market-core.js');

const { parseInstrument, cacheKey, sessionState, sessionBoundsUTC, formatMoney, classifyDataTruth,
  providerTruth, isForeignBenchmark, MARKETS, DATA_TRUTH, catalog, freshKey } = core;

// ───────────────────────── instrument identity ─────────────────────────

test('US symbol without hint resolves to the US consolidated identity', () => {
  const id = parseInstrument('aapl');
  assert.equal(id.canonical, 'US:US:AAPL');
  assert.equal(id.currency, 'USD');
  assert.equal(id.provider.yahoo, 'AAPL');
  assert.equal(id.provider.nasdaq, 'AAPL');
});

test('India hint resolves to NSE and the provider symbol carries the suffix, the canonical does not', () => {
  const id = parseInstrument('reliance', 'IN');
  assert.equal(id.canonical, 'IN:NSE:RELIANCE');
  assert.equal(id.symbol, 'RELIANCE');
  assert.equal(id.provider.yahoo, 'RELIANCE.NS');
  assert.equal(id.provider.finnhub, 'RELIANCE.NS');
  assert.equal(id.provider.nasdaq, null, 'Nasdaq never serves Indian instruments');
  assert.equal(id.currency, 'INR');
});

test('NEGATIVE CONTROL: a provider suffix never leaks into the canonical identity', () => {
  for (const raw of ['RELIANCE.NS', 'reliance.ns', 'TCS.BO', 'NSE:INFY', 'IN:BSE:ITC']) {
    const id = parseInstrument(raw);
    assert.equal(id.market, 'IN', raw);
    assert.doesNotMatch(id.symbol, /\.(NS|BO)$/, `${raw} → ${id.symbol}`);
    assert.doesNotMatch(id.canonical, /\.(NS|BO)/, `${raw} → ${id.canonical}`);
  }
  assert.equal(parseInstrument('TCS.BO').exchange, 'BSE');
  assert.equal(parseInstrument('TCS.BO').provider.yahoo, 'TCS.BO');
});

test('suffix wins over a wrong market hint (an Indian symbol can never be filed under US)', () => {
  const id = parseInstrument('RELIANCE.NS', 'US');
  assert.equal(id.market, 'IN');
  assert.equal(id.canonical, 'IN:NSE:RELIANCE');
});

test('indices resolve to their own market', () => {
  assert.equal(parseInstrument('^NSEI').canonical, 'IN:NSE:^NSEI');
  assert.equal(parseInstrument('^NSEI').kind, 'index');
  assert.equal(parseInstrument('^NSEI').provider.yahoo, '^NSEI', 'indices take no exchange suffix');
  assert.equal(parseInstrument('^VIX').market, 'US');
  assert.equal(parseInstrument('^INDIAVIX', 'US').market, 'IN', 'known Indian index is not re-filed under the hint');
});

test('empty and junk inputs return null', () => {
  assert.equal(parseInstrument(''), null);
  assert.equal(parseInstrument('   '), null);
  assert.equal(parseInstrument('.NS'), null);
});

// ───────────────────────── cache identity ─────────────────────────

test('cache keys carry market and exchange so US and India can never collide', () => {
  const us = cacheKey('quote', parseInstrument('RELIANCE'));
  const ind = cacheKey('quote', parseInstrument('RELIANCE', 'IN'));
  assert.notEqual(us, ind);
  assert.equal(ind, 'quote:IN:NSE:RELIANCE');
  assert.equal(cacheKey('chart', parseInstrument('TCS.BO'), '1D'), 'chart:IN:BSE:TCS:1D');
});

test('NEGATIVE CONTROL: a market-less identity cannot produce a cache key', () => {
  assert.throws(() => cacheKey('quote', { symbol: 'RELIANCE', exchange: 'NSE' }), /market is required/);
  assert.throws(() => cacheKey('quote', { market: 'XX', exchange: 'NSE', symbol: 'RELIANCE' }), /market is required/);
  assert.throws(() => cacheKey('quote', null), /market is required/);
});

// ───────────────────────── calendars / sessions ─────────────────────────

test('NEGATIVE CONTROL: India does not observe NYSE holidays and the US does not observe NSE holidays', () => {
  // 2026-07-03 (Fri): NYSE closed (Independence Day observed); NSE trades. 06:00 UTC = 11:30 IST / 02:00 ET.
  const jul3 = new Date('2026-07-03T06:00:00Z');
  assert.equal(sessionState('IN', jul3).phase, 'OPEN');
  assert.equal(sessionState('IN', jul3).isHoliday, false);
  assert.equal(sessionState('US', jul3).isHoliday, true);
  // 2026-01-26 (Mon): Republic Day — NSE closed; NYSE trades. 15:00 UTC = 10:00 ET / 20:30 IST.
  const jan26 = new Date('2026-01-26T15:00:00Z');
  assert.equal(sessionState('IN', jan26).isHoliday, true);
  assert.equal(sessionState('IN', jan26).holidayName, 'Republic Day');
  assert.equal(sessionState('IN', jan26).phase, 'CLOSED');
  assert.equal(sessionState('US', jan26).isHoliday, false);
  assert.equal(sessionState('US', jan26).phase, 'OPEN');
});

test('session phases follow each market\'s own clock', () => {
  // Wed 2026-09-16 04:00 UTC = 09:30 IST (NSE open since 09:15) / 00:00 ET (US closed).
  const t = new Date('2026-09-16T04:00:00Z');
  const ind = sessionState('IN', t);
  assert.equal(ind.phase, 'OPEN');
  assert.equal(ind.tzLabel, 'IST');
  assert.equal(ind.localTime, '09:30');
  assert.equal(sessionState('US', t).phase, 'CLOSED');
  // 14:00 UTC = 10:00 ET (open) / 19:30 IST (closed, past 16:00 post window).
  const t2 = new Date('2026-09-16T14:00:00Z');
  assert.equal(sessionState('US', t2).phase, 'OPEN');
  assert.equal(sessionState('IN', t2).phase, 'CLOSED');
  // 03:35 UTC = 09:05 IST → pre-open window (09:00–09:15); 03:45 UTC = 09:15 IST is the open.
  assert.equal(sessionState('IN', new Date('2026-09-16T03:35:00Z')).phase, 'PRE');
  assert.equal(sessionState('IN', new Date('2026-09-16T03:45:00Z')).phase, 'OPEN');
});

test('US early close is honoured only by the US calendar', () => {
  const nov27 = new Date('2026-11-27T19:00:00Z'); // 14:00 ET → after the 13:00 early close
  assert.equal(sessionState('US', nov27).isEarlyClose, true);
  assert.equal(sessionState('US', nov27).phase, 'POST');
  assert.equal(sessionState('IN', nov27).isEarlyClose, false);
});

test('1D session bounds are computed in the market timezone', () => {
  const sample = Date.parse('2026-09-18T05:00:00Z'); // 10:30 IST on Fri 18 Sep
  const b = sessionBoundsUTC('IN', sample);
  assert.equal(new Date(b.openUTC).toISOString(), '2026-09-18T03:45:00.000Z');  // 09:15 IST
  assert.equal(new Date(b.closeUTC).toISOString(), '2026-09-18T10:00:00.000Z'); // 15:30 IST
  const us = sessionBoundsUTC('US', Date.parse('2026-09-18T15:00:00Z'));
  assert.equal(new Date(us.openUTC).toISOString(), '2026-09-18T13:30:00.000Z'); // 09:30 EDT
  assert.equal(new Date(us.closeUTC).toISOString(), '2026-09-18T20:00:00.000Z'); // 16:00 EDT
});

// ───────────────────────── money ─────────────────────────

test('NEGATIVE CONTROL: INR is never rendered with a dollar sign', () => {
  const inr = formatMoney(1226.4, 'IN');
  assert.equal(inr, '₹1,226.40');
  assert.doesNotMatch(inr, /\$/);
  assert.equal(formatMoney(123456.789, 'IN'), '₹1,23,456.79', 'Indian digit grouping');
  assert.equal(formatMoney(1226.4, 'US'), '$1,226.40');
  assert.equal(formatMoney(null, 'IN'), '—');
});

// ───────────────────────── benchmarks ─────────────────────────

test('NEGATIVE CONTROL: no SPY (or any US benchmark) in the India configuration', () => {
  const ind = MARKETS.IN;
  const all = [...ind.benchmarks.map((b) => b.symbol), ...ind.sentimentBenchmarks.map((b) => b.symbol), ind.quantBenchmark.symbol, ...ind.tape];
  for (const s of all) assert.equal(isForeignBenchmark('IN', s), false, `${s} leaks into India`);
  assert.ok(!all.includes('SPY'));
  assert.equal(isForeignBenchmark('IN', 'SPY'), true);
  assert.equal(isForeignBenchmark('IN', '^VIX'), true);
  assert.equal(isForeignBenchmark('US', '^NSEI'), true);
  assert.equal(ind.quantBenchmark.symbol, '^NSEI');
});

test('every Indian tape/benchmark symbol resolves under IN and every US one under US', () => {
  for (const s of MARKETS.IN.tape) assert.equal(parseInstrument(s, 'IN').market, 'IN');
  for (const b of MARKETS.IN.benchmarks) assert.equal(parseInstrument(b.symbol).market, 'IN', b.symbol);
  for (const b of MARKETS.US.benchmarks) assert.equal(parseInstrument(b.symbol).market, 'US', b.symbol);
});

// ───────────────────────── data truth ─────────────────────────

test('NEGATIVE CONTROL: delayed Indian data is never labelled REALTIME', () => {
  const open = { phase: 'OPEN' };
  const now = Date.now();
  const yahooIN = classifyDataTruth({ provider: 'yahoo', market: 'IN', price: 1226.4, asOf: now - 1000, session: open, now });
  assert.equal(yahooIN, DATA_TRUTH.DELAYED);
  assert.notEqual(yahooIN, DATA_TRUTH.REALTIME);
  assert.equal(providerTruth('yahoo', 'IN'), 'DELAYED');
  assert.equal(providerTruth('finnhub', 'IN'), null, 'Finnhub cannot quote NSE/BSE on the free tier');
  // Even a fresh Finnhub value under an India identity must not claim realtime.
  assert.equal(classifyDataTruth({ provider: 'finnhub', market: 'IN', price: 1, asOf: now, session: open, now }), DATA_TRUTH.SNAPSHOT);
  assert.equal(classifyDataTruth({ provider: 'finnhub', market: 'US', price: 1, asOf: now, session: open, now }), DATA_TRUTH.REALTIME);
});

test('runtime state only downgrades the provider ceiling', () => {
  const now = Date.now();
  assert.equal(classifyDataTruth({ provider: 'finnhub', market: 'US', price: 0 }), DATA_TRUTH.UNAVAILABLE);
  assert.equal(classifyDataTruth({ provider: 'finnhub', market: 'US', price: 5, lastGood: true }), DATA_TRUTH.LAST_GOOD);
  assert.equal(classifyDataTruth({ provider: 'finnhub', market: 'US', price: 5, fromCache: true, asOf: now - 120_000, session: { phase: 'OPEN' }, now }), DATA_TRUTH.CACHED);
  assert.equal(classifyDataTruth({ provider: 'yahoo', market: 'IN', price: 5, asOf: now, session: { phase: 'CLOSED' }, now }), DATA_TRUTH.EOD);
  assert.equal(classifyDataTruth({ provider: 'yahoo', market: 'US', price: 5, asOf: now - 30 * 60_000, session: { phase: 'OPEN' }, now }), DATA_TRUTH.SNAPSHOT);
  assert.equal(freshKey('LAST_GOOD'), 'last-good');
  assert.equal(freshKey('nonsense'), 'unavailable');
});

// ───────────────────────── catalog ─────────────────────────

test('catalog is serializable and carries both markets with session state and provenance', () => {
  const c = catalog(new Date('2026-09-16T04:00:00Z'));
  const json = JSON.parse(JSON.stringify(c));
  assert.deepEqual(json.markets.map((m) => m.id), ['US', 'IN']);
  const ind = json.markets[1];
  assert.equal(ind.currency, 'INR');
  assert.equal(ind.state.phase, 'OPEN');
  assert.match(ind.calendar.source, /NSE 2026/);
  assert.equal(json.providers.finnhub.IN.quote, null);
  assert.ok(json.dataTruth.includes('LAST_GOOD'));
});
