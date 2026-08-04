(() => {
  'use strict';

  const OPTIONS_CHAIN_SCHEMA_VERSION = '2026-08-04a';

  function finiteNumber(value) {
    if (value === null || value === undefined || value === '' || value === '--') return null;
    const number = Number(String(value).replace(/[$,%\s,]/g, ''));
    return Number.isFinite(number) ? number : null;
  }

  function round(value, places = 2) {
    const factor = 10 ** places;
    return Math.round(value * factor) / factor;
  }

  function total(contracts, key) {
    return contracts.reduce((sum, contract) => sum + (contract[key] || 0), 0);
  }

  function ratio(numerator, denominator) {
    return denominator > 0 ? round(numerator / denominator, 3) : null;
  }

  function sourceUrl(ticker) {
    return `https://www.nasdaq.com/market-activity/stocks/${encodeURIComponent(String(ticker || '').toLowerCase())}/option-chain`;
  }

  function unavailableOptionsChain(ticker, reason, retrievedAt = new Date().toISOString()) {
    return {
      schemaVersion: OPTIONS_CHAIN_SCHEMA_VERSION,
      status: 'unavailable',
      ticker: String(ticker || '').toUpperCase(),
      source: 'Nasdaq',
      sourceUrl: sourceUrl(ticker),
      retrievedAt,
      reason: String(reason || 'No listed options-chain rows were returned for this symbol.'),
      contractCount: 0,
      totalRecord: 0,
      expiryCount: 0,
      nearestExpiry: null,
      atTheMoney: null,
      activity: null,
      impliedVolatility: null,
      greeksAvailable: false,
    };
  }

  function normalizeNasdaqOptionChain(payload, options = {}) {
    const ticker = String(options.ticker || '').toUpperCase();
    const retrievedAt = options.retrievedAt || new Date().toISOString();
    const rows = payload && payload.data && payload.data.table && Array.isArray(payload.data.table.rows)
      ? payload.data.table.rows
      : [];
    const contracts = [];
    let currentExpiry = null;

    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      if (row.expirygroup) currentExpiry = String(row.expirygroup);
      const strike = finiteNumber(row.strike);
      if (strike === null) continue;
      contracts.push({
        expiry: currentExpiry || String(row.expiryDate || '') || null,
        strike,
        callLast: finiteNumber(row.c_Last),
        callBid: finiteNumber(row.c_Bid),
        callAsk: finiteNumber(row.c_Ask),
        callVolume: finiteNumber(row.c_Volume),
        callOpenInterest: finiteNumber(row.c_Openinterest),
        putLast: finiteNumber(row.p_Last),
        putBid: finiteNumber(row.p_Bid),
        putAsk: finiteNumber(row.p_Ask),
        putVolume: finiteNumber(row.p_Volume),
        putOpenInterest: finiteNumber(row.p_Openinterest),
      });
    }

    if (!contracts.length) {
      return unavailableOptionsChain(ticker, 'No listed options-chain rows were returned for this symbol.', retrievedAt);
    }

    const expiries = [...new Set(contracts.map((contract) => contract.expiry).filter(Boolean))];
    const nearestExpiry = expiries[0] || null;
    const nearestContracts = nearestExpiry
      ? contracts.filter((contract) => contract.expiry === nearestExpiry)
      : contracts;
    const spot = finiteNumber(options.spot);
    const atTheMoney = nearestContracts.reduce((nearest, contract) => {
      if (!nearest) return contract;
      if (spot === null) return nearest;
      return Math.abs(contract.strike - spot) < Math.abs(nearest.strike - spot) ? contract : nearest;
    }, null);
    const callVolume = total(contracts, 'callVolume');
    const putVolume = total(contracts, 'putVolume');
    const callOpenInterest = total(contracts, 'callOpenInterest');
    const putOpenInterest = total(contracts, 'putOpenInterest');

    return {
      schemaVersion: OPTIONS_CHAIN_SCHEMA_VERSION,
      status: 'available',
      ticker,
      source: 'Nasdaq',
      sourceUrl: sourceUrl(ticker),
      retrievedAt,
      reason: null,
      contractCount: contracts.length,
      totalRecord: finiteNumber(payload && payload.data && payload.data.totalRecord) || contracts.length,
      expiryCount: expiries.length,
      nearestExpiry,
      atTheMoney,
      activity: {
        callVolume,
        putVolume,
        putCallVolumeRatio: ratio(putVolume, callVolume),
        callOpenInterest,
        putOpenInterest,
        putCallOpenInterestRatio: ratio(putOpenInterest, callOpenInterest),
      },
      lastTrade: String(payload && payload.data && payload.data.lastTrade || '') || null,
      impliedVolatility: null,
      greeksAvailable: false,
    };
  }

  const api = {
    OPTIONS_CHAIN_SCHEMA_VERSION,
    normalizeNasdaqOptionChain,
    unavailableOptionsChain,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalThis.MarketTerminalOptionsChain = api;
})();
