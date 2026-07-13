(() => {
  'use strict';

  const POSITIVE_TERMS = [
    'advance', 'advances', 'beat', 'beats', 'bullish', 'cut rates', 'dovish',
    'gain', 'gains', 'growth', 'optimism', 'rally', 'rebound', 'recovery',
    'record high', 'rise', 'rises', 'strong', 'surge', 'upgrade',
  ];
  const NEGATIVE_TERMS = [
    'bearish', 'crisis', 'default', 'downgrade', 'drop', 'drops', 'fall',
    'falls', 'hawkish', 'inflation', 'layoffs', 'miss', 'misses', 'recession',
    'risk-off', 'sanctions', 'selloff', 'slump', 'tariff', 'weak',
  ];

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function round(value, places = 3) {
    const factor = 10 ** places;
    return Math.round(value * factor) / factor;
  }

  function labelForScore(score) {
    if (score >= 0.55) return 'Strongly Bullish';
    if (score >= 0.15) return 'Bullish';
    if (score <= -0.55) return 'Strongly Bearish';
    if (score <= -0.15) return 'Bearish';
    return 'Neutral';
  }

  function headlineSignal(title) {
    const text = String(title || '').toLowerCase().replace(/inflation (falls|eases|cools)/g, 'prices_cooling');
    if (!text) return 0;
    let raw = 0;
    for (const term of POSITIVE_TERMS) if (text.includes(term)) raw++;
    for (const term of NEGATIVE_TERMS) if (text.includes(term)) raw--;
    return clamp(raw / 2, -1, 1);
  }

  function benchmarkSignal(benchmark) {
    const change = Number(benchmark && benchmark.changePercent);
    if (!Number.isFinite(change)) return null;
    const direction = benchmark && benchmark.inverse ? -1 : 1;
    return clamp((change * direction) / 1.5, -1, 1);
  }

  function average(values) {
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  }

  function describeTone(score) {
    if (score >= 0.2) return 'constructive';
    if (score <= -0.2) return 'defensive';
    return 'mixed';
  }

  function analyzeMarketSentiment(input = {}) {
    const generatedAt = input.generatedAt || new Date().toISOString();
    const benchmarks = (input.benchmarks || []).map((benchmark) => {
      const signal = benchmarkSignal(benchmark);
      if (signal === null) return null;
      return {
        symbol: String(benchmark.symbol || ''),
        changePercent: round(Number(benchmark.changePercent), 3),
        source: String(benchmark.source || 'unknown'),
        inverse: Boolean(benchmark.inverse),
        signal: round(signal),
      };
    }).filter(Boolean);
    const headlines = (input.headlines || []).map((headline) => ({
      title: String(headline.title || ''),
      source: String(headline.source || headline.publisher || 'Unknown'),
      sourceUrl: String(headline.sourceUrl || headline.link || ''),
      publishedAt: headline.publishedAt || headline.published || null,
      evidence: headline.evidence || null,
      signal: headlineSignal(headline.title),
    })).filter((headline) => headline.title);

    const quoteScore = average(benchmarks.map((benchmark) => benchmark.signal));
    const newsScore = average(headlines.map((headline) => headline.signal));
    const hasQuotes = benchmarks.length > 0;
    const hasNews = headlines.length > 0;
    const quoteWeight = hasQuotes && hasNews ? 0.7 : (hasQuotes ? 1 : 0);
    const newsWeight = hasQuotes && hasNews ? 0.3 : (hasNews ? 1 : 0);
    const score = round(clamp(quoteScore * quoteWeight + newsScore * newsWeight, -1, 1));
    const upCount = benchmarks.filter((benchmark) => benchmark.signal > 0.03).length;
    const uniqueSources = new Set([
      ...benchmarks.map((benchmark) => benchmark.source),
      ...headlines.map((headline) => headline.source),
    ].filter(Boolean));
    const evidence = headlines.map((headline) => headline.evidence).filter(Boolean).slice(0, 10);
    const coverageReady = benchmarks.length >= 3 && headlines.length >= 8 && uniqueSources.size >= 3;
    const summary = benchmarks.length
      ? `Risk appetite is ${describeTone(score)}: ${upCount} of ${benchmarks.length} tracked benchmarks are higher, while recent news tone is ${describeTone(newsScore)}.`
      : `Market-price breadth is unavailable; recent news tone is ${describeTone(newsScore)} across ${headlines.length} headlines.`;

    return {
      score,
      label: labelForScore(score),
      summary,
      status: coverageReady ? 'live' : 'degraded',
      dataMode: 'deterministic',
      generatedAt,
      benchmarkCount: benchmarks.length,
      headlineCount: headlines.length,
      sourceCount: uniqueSources.size,
      quoteScore: round(quoteScore),
      newsScore: round(newsScore),
      benchmarks,
      evidence,
      methodology: {
        benchmarkWeight: quoteWeight,
        newsWeight,
        benchmarkUniverse: benchmarks.map((benchmark) => benchmark.symbol),
        note: 'Composite uses observed benchmark percentage changes and a deterministic financial-headline lexicon.',
      },
    };
  }

  const api = { analyzeMarketSentiment, benchmarkSignal, headlineSignal, labelForScore };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalThis.MarketTerminalMarketSentiment = api;
})();
