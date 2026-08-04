(() => {
  'use strict';

  const DEEP_DIVE_SCHEMA_VERSION = '2026-08-04b';

  function finiteNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(String(value).replace(/[$,%\s,]/g, ''));
    return Number.isFinite(number) ? number : null;
  }

  function round(value, places = 2) {
    const factor = 10 ** places;
    return Math.round(value * factor) / factor;
  }

  function formatPrice(value) {
    return `$${Number(value).toFixed(2)}`;
  }

  // Finnhub reports company market capitalization in USD millions.
  function formatMarketCap(value) {
    const millions = finiteNumber(value);
    if (millions === null || millions <= 0) return null;
    if (millions >= 1_000_000) return `$${(millions / 1_000_000).toFixed(2)}T`;
    if (millions >= 1_000) return `$${(millions / 1_000).toFixed(1)}B`;
    return `$${millions.toFixed(0)}M`;
  }

  function quoteSnapshot(quote) {
    const price = finiteNumber(quote && quote.c);
    if (price === null || price <= 0) return null;
    return {
      price,
      change: finiteNumber(quote && quote.d),
      percent: finiteNumber(quote && quote.dp),
      open: finiteNumber(quote && quote.o),
      high: finiteNumber(quote && quote.h),
      low: finiteNumber(quote && quote.l),
      previousClose: finiteNumber(quote && quote.pc),
      source: String(quote && (quote.src || quote.source) || 'unknown'),
    };
  }

  function metricValue(metrics, ...keys) {
    for (const key of keys) {
      const value = finiteNumber(metrics && metrics[key]);
      if (value !== null) return value;
    }
    return null;
  }

  function buildStats(profile, metrics, quote) {
    const high52 = metricValue(metrics, '52WeekHigh');
    const low52 = metricValue(metrics, '52WeekLow');
    let rangePosition = null;
    if (quote && high52 !== null && low52 !== null && high52 > low52) {
      rangePosition = round(Math.max(0, Math.min(100, ((quote.price - low52) / (high52 - low52)) * 100)), 1);
    }
    return {
      high52,
      low52,
      rangePosition,
      pe: metricValue(metrics, 'peTTM', 'peNormalizedAnnual'),
      pb: metricValue(metrics, 'pbAnnual'),
      beta: metricValue(metrics, 'beta'),
      return52: metricValue(metrics, '52WeekPriceReturnDaily'),
      dividendYield: metricValue(metrics, 'dividendYieldIndicatedAnnual', 'currentDividendYieldTTM'),
      marketCap: formatMarketCap(profile && profile.marketCapitalization),
      industry: String(profile && profile.finnhubIndustry || '') || null,
      logo: String(profile && profile.logo || '') || null,
    };
  }

  function countRecommendation(value) {
    const number = finiteNumber(value);
    return number === null ? 0 : Math.max(0, Math.round(number));
  }

  function buildAnalystConsensus(recommendation) {
    if (!recommendation || typeof recommendation !== 'object') return null;
    const consensus = {
      strongBuy: countRecommendation(recommendation.strongBuy),
      buy: countRecommendation(recommendation.buy),
      hold: countRecommendation(recommendation.hold),
      sell: countRecommendation(recommendation.sell),
      strongSell: countRecommendation(recommendation.strongSell),
      period: String(recommendation.period || ''),
    };
    consensus.total = consensus.strongBuy + consensus.buy + consensus.hold + consensus.sell + consensus.strongSell;
    if (!consensus.total && !consensus.period) return null;
    consensus.positive = consensus.strongBuy + consensus.buy;
    consensus.negative = consensus.sell + consensus.strongSell;
    consensus.positivePercent = consensus.total ? round(consensus.positive / consensus.total * 100, 1) : null;
    consensus.holdPercent = consensus.total ? round(consensus.hold / consensus.total * 100, 1) : null;
    consensus.negativePercent = consensus.total ? round(consensus.negative / consensus.total * 100, 1) : null;
    return consensus;
  }

  function sourceKey(record) {
    return String(record && (record.publisherDomain || record.publisher) || '').trim().toLowerCase();
  }

  function evidenceCoverage(evidence) {
    const records = Array.isArray(evidence) ? evidence.filter((record) => record && record.title) : [];
    const sources = new Set(records.map(sourceKey).filter(Boolean));
    const trusted = records.filter((record) => record.sourceTier === 'primary' || record.sourceTier === 'reputable-secondary');
    const newestAt = records.reduce((latest, record) => {
      const time = Date.parse(record.publishedAt || '');
      return Number.isFinite(time) && (!latest || time > Date.parse(latest)) ? record.publishedAt : latest;
    }, null);
    return { records, sourceCount: sources.size, trustedCount: trusted.length, newestAt };
  }

  function buildSummary(company, ticker, quote, stats, consensus, optionsChain) {
    const sentences = [];
    if (quote) {
      let sentence = `${company} (${ticker}) has a latest pooled quote of ${formatPrice(quote.price)}`;
      if (quote.percent !== null) {
        const direction = quote.percent > 0 ? 'up' : quote.percent < 0 ? 'down' : 'unchanged';
        sentence += direction === 'unchanged' ? ', unchanged for the session' : `, ${direction} ${Math.abs(quote.percent).toFixed(2)}% for the session`;
      }
      sentences.push(`${sentence}.`);
    }
    if (quote && stats.rangePosition !== null && stats.low52 !== null && stats.high52 !== null) {
      sentences.push(`The quote is ${stats.rangePosition.toFixed(1)}% through the reported 52-week range of ${formatPrice(stats.low52)} to ${formatPrice(stats.high52)}.`);
    }
    const fundamentals = [];
    if (stats.marketCap) fundamentals.push(`market cap ${stats.marketCap}`);
    if (stats.pe !== null) fundamentals.push(`trailing P/E ${stats.pe.toFixed(1)}`);
    if (stats.pb !== null) fundamentals.push(`price-to-book ${stats.pb.toFixed(1)}`);
    if (stats.beta !== null) fundamentals.push(`beta ${stats.beta.toFixed(2)}`);
    if (fundamentals.length) sentences.push(`Reported fundamentals include ${fundamentals.join(', ')}.`);
    if (consensus && consensus.total) {
      sentences.push(`The analyst feed contains ${consensus.total} ratings for ${consensus.period || 'the latest period'}: ${consensus.positive} positive-category, ${consensus.hold} hold, and ${consensus.negative} negative-category.`);
    }
    if (optionsChain && optionsChain.status === 'available') {
      sentences.push(`Nasdaq returned ${optionsChain.contractCount} bounded at-the-money options rows across ${optionsChain.expiryCount} observed expiries; this is chain data, not a trade recommendation.`);
    }
    if (!sentences.length) {
      sentences.push(`${company} (${ticker}) was resolved, but no usable quote, fundamental metric, or analyst record was returned for this refresh.`);
    }
    return sentences.join(' ');
  }

  function relevantWatchRecords(records, company, ticker) {
    const ignored = new Set(['company', 'corporation', 'corp', 'inc', 'incorporated', 'limited', 'ltd', 'holdings', 'group', 'plc', 'the']);
    const terms = [ticker, ...String(company || '').split(/[^a-z0-9]+/i)]
      .map((term) => String(term || '').toLowerCase())
      .filter((term) => term.length >= 4 && !ignored.has(term));
    const matching = records.filter((record) => {
      const text = `${record.title || ''} ${record.excerpt || ''}`.toLowerCase();
      return terms.some((term) => text.includes(term));
    });
    return matching.length ? matching : records;
  }

  function buildObservations(quote, stats, consensus, coverage, company, ticker, optionsChain) {
    const supporting = [];
    const caution = [];
    if (quote && quote.percent !== null) {
      const observation = `The latest session move is ${quote.percent >= 0 ? '+' : ''}${quote.percent.toFixed(2)}% from the pooled quote source.`;
      (quote.percent >= 0 ? supporting : caution).push(observation);
    }
    if (stats.rangePosition !== null) {
      const observation = `The price is ${stats.rangePosition.toFixed(1)}% through its reported 52-week range.`;
      (stats.rangePosition >= 50 ? supporting : caution).push(observation);
    }
    if (stats.return52 !== null) {
      const observation = `The reported 52-week price return is ${stats.return52 >= 0 ? '+' : ''}${stats.return52.toFixed(1)}%.`;
      (stats.return52 >= 0 ? supporting : caution).push(observation);
    }
    if (consensus && consensus.total) {
      supporting.push(`${consensus.positive} of ${consensus.total} reported analyst ratings are in positive categories; this is a count, not a terminal recommendation.`);
      if (consensus.negative) caution.push(`${consensus.negative} of ${consensus.total} reported analyst ratings are in negative categories.`);
    }
    if (stats.pe !== null) caution.push(`The reported trailing P/E is ${stats.pe.toFixed(1)}; no peer or cash-flow valuation model is connected.`);
    if (!supporting.length) supporting.push('No positive directional inference is made from the currently available deterministic inputs.');
    if (!caution.length) caution.push('No negative directional inference is made from the currently available deterministic inputs.');

    const watchItems = relevantWatchRecords(coverage.records, company, ticker).slice(0, 4).map((record) => {
      const publisher = record.publisher || record.publisherDomain || 'source';
      const date = record.publishedAt ? String(record.publishedAt).slice(0, 10) : 'time unavailable';
      return `${record.title} (${publisher}, ${date})`;
    });
    if (!watchItems.length) watchItems.push('No qualifying recent company headline was available for this refresh.');

    const limits = ['Price targets, entries, stops, and fair values are withheld because a dedicated verified valuation model is not connected.'];
    if (optionsChain && optionsChain.status === 'available') {
      limits.push('Options-chain rows are available, but implied volatility, Greeks, and a verified options trade model are not connected.');
    } else {
      limits.push(optionsChain && optionsChain.reason
        ? optionsChain.reason
        : 'No listed options-chain rows were verified for this refresh.');
    }
    if (!quote) limits.push('No usable pooled quote was returned.');
    if (stats.pe === null && stats.marketCap === null && stats.high52 === null) limits.push('Fundamental coverage is unavailable or incomplete.');
    if (!consensus || !consensus.total) limits.push('No current analyst-consensus counts were returned.');
    if (coverage.sourceCount < 2) limits.push(`Headline coverage spans ${coverage.sourceCount} normalized source domain; source concentration limits corroboration.`);

    return { supporting, caution, watchItems, limits };
  }

  function buildEquityData(quote, fundamentalCount, consensus, coverage, generatedAt) {
    const datasets = {
      quote: Boolean(quote),
      fundamentals: fundamentalCount > 0,
      analysts: Boolean(consensus && consensus.total),
      news: coverage.records.length > 0,
    };
    const availableCount = Object.values(datasets).filter(Boolean).length;
    const coverageScore = (datasets.quote ? 30 : 0) +
      (datasets.fundamentals ? 30 : 0) +
      (datasets.analysts ? 20 : 0) +
      (datasets.news ? 20 : 0);
    const details = [];
    if (quote) details.push(`pooled quote from ${quote.source}`);
    if (fundamentalCount) details.push(`${fundamentalCount} numeric fundamentals`);
    if (consensus && consensus.total) details.push(`${consensus.total} analyst ratings`);
    if (coverage.records.length) details.push(`${coverage.records.length} linked news records`);
    return {
      status: availableCount === 4 ? 'available' : availableCount ? 'partial' : 'unavailable',
      coverageScore,
      availableDatasets: availableCount,
      totalDatasets: 4,
      datasets,
      asOf: generatedAt,
      summary: details.length ? details.join(', ') : 'No usable equity dataset was returned for this refresh.',
      disclaimer: 'Coverage measures returned datasets, not investment merit or expected return.',
    };
  }

  function formatOptionMarket(bid, ask, last) {
    if (bid !== null && bid !== undefined && ask !== null && ask !== undefined) return `${bid.toFixed(2)}/${ask.toFixed(2)} bid/ask`;
    if (last !== null && last !== undefined) return `${last.toFixed(2)} last`;
    return 'no quoted market';
  }

  function buildOptionsData(optionsChain) {
    if (!optionsChain || optionsChain.status !== 'available') {
      return {
        recommendation: 'No listed chain returned',
        bias: 'Unavailable',
        score: null,
        impliedVolatility: 'Not supplied',
        timeframe: 'No expiry returned',
        rationale: optionsChain && optionsChain.reason
          ? optionsChain.reason
          : 'No listed options-chain rows were verified for this response.',
      };
    }
    const atm = optionsChain.atTheMoney;
    const activity = optionsChain.activity || {};
    const details = [];
    if (atm) {
      details.push(`Nearest returned strike ${atm.strike.toFixed(2)}: call ${formatOptionMarket(atm.callBid, atm.callAsk, atm.callLast)}; put ${formatOptionMarket(atm.putBid, atm.putAsk, atm.putLast)}.`);
    }
    if (activity.putCallVolumeRatio !== null && activity.putCallVolumeRatio !== undefined) {
      details.push(`Returned-row put/call volume ratio ${activity.putCallVolumeRatio.toFixed(3)}.`);
    }
    details.push('Observed chain data only; no options trade is recommended.');
    return {
      recommendation: 'Listed chain available',
      bias: 'Data Available',
      score: null,
      impliedVolatility: 'Not supplied',
      timeframe: optionsChain.nearestExpiry || 'Nearest listed expiry',
      rationale: details.join(' '),
    };
  }

  function buildDeterministicDeepDive(input = {}) {
    const ticker = String(input.ticker || '').trim().toUpperCase();
    const profile = input.profile && typeof input.profile === 'object' ? input.profile : {};
    const metrics = input.metrics && typeof input.metrics === 'object' ? input.metrics : {};
    const company = String(profile.name || input.company || ticker || 'Unknown company');
    const quote = quoteSnapshot(input.quote);
    const stats = buildStats(profile, metrics, quote);
    const analystConsensus = buildAnalystConsensus(input.recommendation);
    const coverage = evidenceCoverage(input.evidence);
    const generatedAt = input.generatedAt || new Date().toISOString();
    const fundamentalCount = Object.values(metrics).filter((value) => finiteNumber(value) !== null).length;
    const optionsChain = input.optionsChain && typeof input.optionsChain === 'object' ? input.optionsChain : null;
    const observations = buildObservations(quote, stats, analystConsensus, coverage, company, ticker, optionsChain);
    const equityData = buildEquityData(quote, fundamentalCount, analystConsensus, coverage, generatedAt);

    return {
      deepDiveSchemaVersion: DEEP_DIVE_SCHEMA_VERSION,
      dataMode: 'deterministic-dossier',
      deterministic: true,
      aiNarrativeStatus: 'not-attempted',
      generatedAt,
      ticker,
      company,
      quote,
      stats,
      analystConsensus,
      equityData,
      optionsChain,
      summary: buildSummary(company, ticker, quote, stats, analystConsensus, optionsChain),
      newsSentiment: 'unrated',
      keyDrivers: `Observed inputs include ${quote ? `a pooled quote from ${quote.source}` : 'no usable pooled quote'}, ${fundamentalCount} numeric fundamental fields, and ${coverage.records.length} qualifying headline records across ${coverage.sourceCount} normalized sources. No causal driver is inferred automatically.`,
      investment: {
        rating: 'Not Rated',
        score: null,
        conviction: 'Low',
        horizon: 'No verified horizon',
        fairValue: 'N/A - no verified valuation model',
        thesis: 'No investment recommendation is issued without a verified valuation model.',
      },
      options: buildOptionsData(optionsChain),
      technicalBias: 'Unrated',
      entryZone: 'N/A - no verified trade plan',
      stopLoss: 'N/A - no verified trade plan',
      priceTarget: 'N/A - no verified valuation model',
      bullCase: observations.supporting,
      bearCase: observations.caution,
      catalysts: observations.watchItems,
      risks: observations.limits,
      dataSources: {
        quote: {
          status: quote ? 'available' : 'unavailable',
          provider: quote ? quote.source : null,
          retrievedAt: generatedAt,
        },
        fundamentals: {
          status: fundamentalCount ? 'available' : 'unavailable',
          provider: fundamentalCount ? 'Finnhub company metrics' : null,
          fieldCount: fundamentalCount,
          retrievedAt: generatedAt,
        },
        analysts: {
          status: analystConsensus && analystConsensus.total ? 'available' : 'unavailable',
          provider: analystConsensus ? 'Finnhub recommendations' : null,
          ratingCount: analystConsensus ? analystConsensus.total : 0,
          period: analystConsensus ? analystConsensus.period : '',
        },
        options: {
          status: optionsChain && optionsChain.status === 'available' ? 'available' : 'unavailable',
          provider: optionsChain ? optionsChain.source : null,
          contractCount: optionsChain ? optionsChain.contractCount : 0,
          expiryCount: optionsChain ? optionsChain.expiryCount : 0,
          nearestExpiry: optionsChain ? optionsChain.nearestExpiry : null,
          retrievedAt: optionsChain ? optionsChain.retrievedAt : null,
          reason: optionsChain && optionsChain.status !== 'available' ? optionsChain.reason : null,
        },
        news: {
          status: coverage.records.length ? (coverage.sourceCount >= 2 ? 'corroborated' : 'concentrated') : 'unavailable',
          recordCount: coverage.records.length,
          sourceCount: coverage.sourceCount,
          trustedCount: coverage.trustedCount,
          newestAt: coverage.newestAt,
        },
      },
    };
  }

  const api = {
    DEEP_DIVE_SCHEMA_VERSION,
    buildDeterministicDeepDive,
    formatMarketCap,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalThis.MarketTerminalDeepDive = api;
})();
