(() => {
  'use strict';

  const evidenceApi = typeof module !== 'undefined' && module.exports
    ? require('./evidence-core.js')
    : globalThis.MarketTerminalEvidence;

  function isoFromUnixSeconds(value) {
    const seconds = Number(value);
    if (!Number.isFinite(seconds) || seconds <= 0) return '';
    const date = new Date(seconds * 1_000);
    return Number.isFinite(date.getTime()) ? date.toISOString() : '';
  }

  function normalizeFinnhubCompanyNews(items, options = {}) {
    const ticker = String(options.ticker || '').trim().toUpperCase().slice(0, 10);
    const limit = Math.max(1, Math.min(50, Number(options.limit) || 16));
    const fetchedAt = options.fetchedAt || new Date().toISOString();
    const records = evidenceApi.dedupeEvidence(
      (Array.isArray(items) ? items : [])
        .slice(0, limit)
        .map((item) => evidenceApi.normalizeEvidenceRecord({
          title: item && item.headline,
          source: item && item.source,
          published: isoFromUnixSeconds(item && item.datetime),
          link: item && item.url,
          summary: item && item.summary,
        }, {
          feedUrl: `finnhub:company-news:${ticker || 'unknown'}`,
          fetchedAt,
        }))
        .filter((record) => record.title && record.sourceUrl)
    );

    return records.map((record) => {
      const evidence = {
        ...record,
        tickers: ticker ? [ticker] : [],
        rawMetadata: {
          ...record.rawMetadata,
          vendor: 'Finnhub',
          ticker,
        },
      };
      return {
        title: evidence.title,
        source: evidence.publisher,
        published: evidence.publishedAt || '',
        link: evidence.sourceUrl,
        summary: evidence.excerpt,
        evidenceId: evidence.id,
        evidence,
        sourceTier: evidence.sourceTier,
        reliabilityLabel: evidence.reliabilityLabel,
      };
    });
  }

  const api = {
    normalizeFinnhubCompanyNews,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalThis.MarketTerminalCompanyEvidence = api;
})();
