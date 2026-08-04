(() => {
  'use strict';

  const TICKER_SCHEMA_VERSION = '2026-08-04a';
  const DEFAULT_TICKER_BASKET = Object.freeze(['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA']);

  function finiteNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function usablePrice(value) {
    const number = finiteNumber(value);
    return number !== null && number > 0;
  }

  function normalizedCurrent(symbol, quote, asOf) {
    const price = quote && finiteNumber(quote.c);
    if (!usablePrice(price)) return null;
    return {
      symbol,
      price,
      change: finiteNumber(quote.d) || 0,
      percent: finiteNumber(quote.dp) || 0,
      source: String(quote.src || quote.source || 'unknown'),
      asOf,
      available: true,
      stale: false,
    };
  }

  function normalizedPrevious(symbol, item) {
    if (!item || !usablePrice(item.price)) return null;
    return {
      symbol,
      price: finiteNumber(item.price),
      change: finiteNumber(item.change) || 0,
      percent: finiteNumber(item.percent) || 0,
      source: String(item.source || 'last-good cache'),
      asOf: item.asOf || null,
      available: true,
      stale: true,
    };
  }

  function mergeTickerBasket(symbols, currentQuotes, previousItems, asOf = new Date().toISOString()) {
    const current = currentQuotes && typeof currentQuotes === 'object' ? currentQuotes : {};
    const previous = new Map((Array.isArray(previousItems) ? previousItems : [])
      .filter((item) => item && item.symbol)
      .map((item) => [String(item.symbol).toUpperCase(), item]));
    return symbols.map((rawSymbol) => {
      const symbol = String(rawSymbol).toUpperCase();
      return normalizedCurrent(symbol, current[symbol], asOf) ||
        normalizedPrevious(symbol, previous.get(symbol)) || {
          symbol,
          price: 0,
          change: 0,
          percent: 0,
          source: null,
          asOf: null,
          available: false,
          stale: false,
        };
    });
  }

  const api = {
    TICKER_SCHEMA_VERSION,
    DEFAULT_TICKER_BASKET,
    mergeTickerBasket,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalThis.MarketTerminalTicker = api;
})();
