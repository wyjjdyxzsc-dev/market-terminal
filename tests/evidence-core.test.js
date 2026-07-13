'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const evidence = require('../shared/evidence-core.js');

test('safeExternalUrl strips tracking params and rejects unsafe schemes', () => {
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
