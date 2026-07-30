'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const evidence = require('../shared/evidence-core.js');
const companyEvidence = require('../shared/company-evidence-core.js');

test('safeExternalUrl strips tracking params and rejects unsafe schemes', () => {
  assert.equal(evidence.EVIDENCE_SCHEMA_VERSION, '2026-07-30a');
  assert.equal(evidence.NEWS_ENRICHMENT_SCHEMA_VERSION, '2026-07-30b');
  assert.equal(evidence.hasUsefulNewsBatch({ items: Array(6).fill({}) }, 20), true);
  assert.equal(evidence.hasUsefulNewsBatch({ items: Array(5).fill({}) }, 20), false);
  assert.equal(evidence.hasUsefulNewsBatch({ items: Array(3).fill({}) }, 3), true);
  assert.equal(
    evidence.safeExternalUrl('https://example.com/story?utm_source=rss&fbclid=abc&id=42#fragment'),
    'https://example.com/story?id=42'
  );
  assert.equal(evidence.safeExternalUrl('javascript:alert(1)'), '');
});

test('normalizeEvidenceRecord classifies reputable secondary publishers', () => {
  const record = evidence.normalizeEvidenceRecord({
    title: 'Oil slips after inventory surprise',
    source: 'Reuters',
    link: 'https://www.reuters.com/world/oil-slips-after-inventory-surprise/?utm_source=rss',
    published: '2026-07-13T10:30:00Z',
    summary: '<p>Crude eased after a larger inventory build.</p>',
  }, {
    feedUrl: 'https://example.com/feed.xml',
    fetchedAt: '2026-07-13T11:00:00Z',
  });

  assert.equal(record.publisher, 'Reuters');
  assert.equal(record.publisherDomain, 'reuters.com');
  assert.equal(record.sourceTier, 'reputable-secondary');
  assert.equal(record.reliabilityLabel, 'reputable');
  assert.equal(record.sourceUrl, 'https://www.reuters.com/world/oil-slips-after-inventory-surprise/');
  assert.equal(record.excerpt, 'Crude eased after a larger inventory build.');
});

test('redirect links retain the attributed publisher authority', () => {
  const record = evidence.normalizeEvidenceRecord({
    title: 'Apple shares move after product update',
    source: 'Yahoo',
    link: 'https://finnhub.io/api/news?id=example',
    published: '2026-07-29T10:30:00Z',
  }, {
    feedUrl: 'finnhub:company-news:AAPL',
    fetchedAt: '2026-07-29T10:35:00Z',
  });

  assert.equal(record.sourceUrl, 'https://finnhub.io/api/news?id=example');
  assert.equal(record.publisherDomain, 'finance.yahoo.com');
  assert.equal(record.sourceTier, 'reputable-secondary');
  assert.equal(record.reliabilityLabel, 'reputable');
});

test('publisher labels cannot override an unrelated article domain', () => {
  const record = evidence.normalizeEvidenceRecord({
    title: 'Unsupported publisher claim',
    source: 'Reuters',
    link: 'https://example.test/article',
    published: '2026-07-29T10:30:00Z',
  }, {
    feedUrl: 'https://example.test/feed.xml',
    fetchedAt: '2026-07-29T10:35:00Z',
  });

  assert.equal(record.publisherDomain, 'example.test');
  assert.equal(record.sourceTier, 'unknown');
});

test('Finnhub company news becomes policy-ready evidence with ticker identity', () => {
  const headlines = companyEvidence.normalizeFinnhubCompanyNews([{
    headline: 'Apple shares move after product update',
    source: 'Reuters',
    url: 'https://finnhub.io/api/news?id=company-example',
    datetime: Date.parse('2026-07-29T10:30:00Z') / 1000,
    summary: 'The company published a product update.',
  }], {
    ticker: 'aapl',
    fetchedAt: '2026-07-29T10:35:00Z',
  });

  assert.equal(headlines.length, 1);
  assert.equal(headlines[0].sourceTier, 'reputable-secondary');
  assert.equal(headlines[0].evidence.publisherDomain, 'reuters.com');
  assert.deepEqual(headlines[0].evidence.tickers, ['AAPL']);
  assert.equal(headlines[0].evidence.rawMetadata.vendor, 'Finnhub');
});

test('dedupeEvidence keeps first canonical record and marks duplicates', () => {
  const first = evidence.normalizeEvidenceRecord({
    title: 'Fed official comments on rates',
    source: 'CNBC',
    link: 'https://www.cnbc.com/2026/07/13/fed-rates.html?utm_source=rss',
  }, { feedUrl: 'https://example.com/feed-a.xml', fetchedAt: '2026-07-13T11:00:00Z' });
  const second = evidence.normalizeEvidenceRecord({
    title: 'Fed official comments on rates',
    source: 'CNBC',
    link: 'https://www.cnbc.com/2026/07/13/fed-rates.html?utm_medium=email',
  }, { feedUrl: 'https://example.com/feed-b.xml', fetchedAt: '2026-07-13T11:05:00Z' });

  const deduped = evidence.dedupeEvidence([first, second]);
  assert.equal(deduped.length, 1);
  assert.equal(second.duplicateOf, first.id);
});
