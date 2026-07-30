(() => {
  'use strict';

  const EVIDENCE_SCHEMA_VERSION = '2026-07-30a';
  const NEWS_ENRICHMENT_SCHEMA_VERSION = '2026-07-30b';
  const TRACKING_PARAMS = new Set([
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
    'utm_id', 'gclid', 'fbclid', 'mc_cid', 'mc_eid', 'ocid', 'cmpid',
    'guccounter', 'guce_referrer', 'guce_referrer_sig',
  ]);

  const PRIMARY_DOMAINS = new Set([
    'sec.gov', 'fred.stlouisfed.org', 'bls.gov', 'bea.gov', 'treasury.gov', 'eia.gov',
    'federalreserve.gov', 'usgs.gov', 'weather.gov', 'firms.modaps.eosdis.nasa.gov',
    'eonet.gsfc.nasa.gov', 'nasa.gov', 'api.weather.gov', 'who.int',
  ]);

  const REPUTABLE_SECONDARY_DOMAINS = new Set([
    'reuters.com', 'apnews.com', 'bbc.co.uk', 'bbc.com', 'aljazeera.com', 'wsj.com',
    'marketwatch.com', 'cnbc.com', 'bloomberg.com', 'finance.yahoo.com', 'ft.com',
    'economist.com', 'nytimes.com',
  ]);

  const AGGREGATOR_DOMAINS = new Set([
    'bing.com', 'news.search.yahoo.com', 'search.cnbc.com', 'google.com',
  ]);

  const REDIRECT_DOMAINS = new Set([
    ...AGGREGATOR_DOMAINS,
    'finnhub.io',
  ]);

  const PUBLISHER_DOMAIN_ALIASES = new Map([
    ['reuters', 'reuters.com'],
    ['associated press', 'apnews.com'],
    ['ap', 'apnews.com'],
    ['bbc', 'bbc.com'],
    ['cnbc', 'cnbc.com'],
    ['bloomberg', 'bloomberg.com'],
    ['marketwatch', 'marketwatch.com'],
    ['yahoo', 'finance.yahoo.com'],
    ['yahoo finance', 'finance.yahoo.com'],
    ['financial times', 'ft.com'],
    ['ft', 'ft.com'],
    ['the wall street journal', 'wsj.com'],
    ['wall street journal', 'wsj.com'],
    ['wsj', 'wsj.com'],
    ['the new york times', 'nytimes.com'],
    ['new york times', 'nytimes.com'],
    ['the economist', 'economist.com'],
    ['economist', 'economist.com'],
    ['al jazeera', 'aljazeera.com'],
  ]);

  function stripTags(value) {
    return String(value == null ? '' : value).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function normalizeText(value) {
    return stripTags(value)
      .replace(/\u2018|\u2019/g, "'")
      .replace(/\u201c|\u201d/g, '"')
      .trim();
  }

  function domainOf(value) {
    try {
      return new URL(value).hostname.replace(/^www\./i, '').toLowerCase();
    } catch {
      return '';
    }
  }

  function canonicalizeUrl(value) {
    try {
      const url = new URL(String(value || '').trim());
      if (!/^https?:$/i.test(url.protocol)) return '';
      for (const key of [...url.searchParams.keys()]) {
        if (TRACKING_PARAMS.has(key.toLowerCase())) url.searchParams.delete(key);
      }
      url.hash = '';
      return url.toString();
    } catch {
      return '';
    }
  }

  function safeExternalUrl(value) {
    return canonicalizeUrl(value);
  }

  function normalizeTimestamp(value) {
    if (!value) return null;
    const ms = Date.parse(String(value));
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
  }

  function slugify(value) {
    return normalizeText(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  function simpleHash(value) {
    const text = String(value || '');
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  function classifySourceTier(publisherDomain, publisher) {
    const domain = String(publisherDomain || '').toLowerCase();
    const label = String(publisher || '').toLowerCase();
    if (domain && PRIMARY_DOMAINS.has(domain)) return 'primary';
    if (domain && REPUTABLE_SECONDARY_DOMAINS.has(domain)) return 'reputable-secondary';
    if (domain && AGGREGATOR_DOMAINS.has(domain)) return 'aggregator';
    if (label.startsWith('x/@') || domain === 'x.com' || domain === 'twitter.com') return 'social';
    return 'unknown';
  }

  function attributedPublisherDomain(sourceUrl, publisher) {
    const linkDomain = domainOf(sourceUrl);
    const publisherKey = normalizeText(publisher).toLowerCase().replace(/\s+/g, ' ');
    const attributedDomain = PUBLISHER_DOMAIN_ALIASES.get(publisherKey) || '';
    if (!linkDomain) return attributedDomain;
    return REDIRECT_DOMAINS.has(linkDomain) && attributedDomain
      ? attributedDomain
      : linkDomain;
  }

  function classifySourceType(sourceUrl, publisher) {
    const domain = domainOf(sourceUrl);
    const label = String(publisher || '').toLowerCase();
    if (label.startsWith('x/@') || domain === 'x.com' || domain === 'twitter.com') return 'social';
    if (!sourceUrl) return 'rss';
    return 'article';
  }

  function reliabilityLabel(sourceTier) {
    switch (sourceTier) {
      case 'primary': return 'authoritative';
      case 'reputable-secondary': return 'reputable';
      case 'aggregator': return 'aggregated';
      case 'social': return 'signal-only';
      default: return 'unverified';
    }
  }

  function normalizeEvidenceRecord(raw, meta) {
    const fetchedAt = normalizeTimestamp(meta && meta.fetchedAt) || new Date().toISOString();
    const sourceUrl = safeExternalUrl(raw && raw.link);
    const canonicalUrl = sourceUrl || '';
    const title = normalizeText(raw && raw.title);
    const excerpt = normalizeText(raw && (raw.summary || raw.excerpt || raw.desc || ''));
    const publisher = normalizeText(raw && raw.source) || domainOf(sourceUrl);
    const publisherDomain = attributedPublisherDomain(sourceUrl, publisher);
    const publishedAt = normalizeTimestamp(raw && (raw.published || raw.pubDate || raw.publishedAt));
    const sourceTier = classifySourceTier(publisherDomain, publisher);
    const idSeed = [meta && meta.feedUrl, canonicalUrl, title, publishedAt || fetchedAt].filter(Boolean).join('|');
    const id = 'ev_' + simpleHash(idSeed || title || fetchedAt);
    return {
      id,
      eventId: null,
      sourceType: classifySourceType(sourceUrl, publisher),
      publisher,
      publisherDomain,
      sourceUrl,
      canonicalUrl,
      title,
      excerpt,
      publishedAt,
      updatedAt: null,
      fetchedAt,
      language: 'en',
      region: null,
      countries: [],
      entities: [],
      tickers: [],
      assetClasses: [],
      topics: [],
      sourceTier,
      reliabilityLabel: reliabilityLabel(sourceTier),
      corroborationCount: 1,
      contentHash: simpleHash([title, excerpt, publisher].join('|')),
      duplicateOf: null,
      status: 'active',
      rawMetadata: {
        feedUrl: meta && meta.feedUrl ? meta.feedUrl : '',
        schemaVersion: EVIDENCE_SCHEMA_VERSION,
      },
    };
  }

  function dedupeEvidence(records) {
    const seen = new Map();
    const out = [];
    for (const record of records || []) {
      const key = record.canonicalUrl || [record.title, record.publisher].join('|').toLowerCase();
      if (!key) continue;
      if (seen.has(key)) {
        record.duplicateOf = seen.get(key);
        continue;
      }
      seen.set(key, record.id);
      out.push(record);
    }
    return out;
  }

  const STOPWORDS = new Set(['the', 'a', 'an', 'of', 'to', 'and', 'for', 'in', 'on', 'with', 'at', 'from', 'by', 'into', 'as']);

  function titleSignature(title) {
    return normalizeText(title)
      .toLowerCase()
      .split(/[^a-z0-9]+/g)
      .filter((token) => token && !STOPWORDS.has(token))
      .slice(0, 8)
      .join(' ');
  }

  function clusterEvidence(records) {
    const groups = new Map();
    for (const record of records || []) {
      const sig = titleSignature(record.title) || record.id;
      const bucket = groups.get(sig) || [];
      bucket.push(record);
      groups.set(sig, bucket);
    }
    return [...groups.entries()].map(([signature, items], index) => {
      const sorted = items.slice().sort((a, b) => {
        const ta = a.publishedAt ? Date.parse(a.publishedAt) : 0;
        const tb = b.publishedAt ? Date.parse(b.publishedAt) : 0;
        return tb - ta;
      });
      const newest = sorted[0] && sorted[0].publishedAt ? sorted[0].publishedAt : null;
      const oldest = sorted[sorted.length - 1] && sorted[sorted.length - 1].publishedAt ? sorted[sorted.length - 1].publishedAt : null;
      return {
        id: 'cluster_' + simpleHash(signature + ':' + index),
        signature,
        title: sorted[0] ? sorted[0].title : '',
        evidenceIds: sorted.map((item) => item.id),
        sourceCount: new Set(sorted.map((item) => item.publisherDomain || item.publisher)).size,
        newestEvidenceAt: newest,
        oldestEvidenceAt: oldest,
        items: sorted,
      };
    });
  }

  function freshnessMinutes(timestamp) {
    if (!timestamp) return Infinity;
    const ms = Date.parse(timestamp);
    if (!Number.isFinite(ms)) return Infinity;
    return Math.max(0, Math.round((Date.now() - ms) / 60000));
  }

  function freshnessLabel(timestamp) {
    const mins = freshnessMinutes(timestamp);
    if (!Number.isFinite(mins)) return 'unknown';
    if (mins <= 30) return 'live';
    if (mins <= 180) return 'recent';
    if (mins <= 1440) return 'today';
    return 'stale';
  }

  function newsroomStatus(cluster) {
    const sourceCount = cluster && cluster.sourceCount ? cluster.sourceCount : 0;
    const label = freshnessLabel(cluster && cluster.newestEvidenceAt);
    if (label === 'stale') return 'STALE';
    if (sourceCount >= 3) return 'CONFIRMED';
    if (sourceCount === 2) return 'DEVELOPING';
    return 'UNVERIFIED';
  }

  function summarizeEvidence(cluster) {
    if (!cluster || !Array.isArray(cluster.items) || !cluster.items.length) return [];
    return cluster.items.slice(0, 3).map((item) => ({
      id: item.id,
      publisher: item.publisher,
      publisherDomain: item.publisherDomain,
      sourceUrl: item.sourceUrl,
      publishedAt: item.publishedAt,
      sourceTier: item.sourceTier,
      reliabilityLabel: item.reliabilityLabel,
      title: item.title,
    }));
  }

  function tokenSet(value) {
    return new Set(
      normalizeText(value)
        .toLowerCase()
        .split(/[^a-z0-9]+/g)
        .filter((token) => token && token.length > 2 && !STOPWORDS.has(token))
    );
  }

  function overlapScore(a, b) {
    if (!a.size || !b.size) return 0;
    let hits = 0;
    for (const token of a) if (b.has(token)) hits++;
    return hits / Math.max(a.size, b.size);
  }

  function matchEvidence(item, clusters) {
    const itemTokens = tokenSet((item && item.title) || (item && item.summary) || '');
    let best = null;
    let bestScore = 0;
    for (const cluster of clusters || []) {
      const score = overlapScore(itemTokens, tokenSet(cluster.title));
      if (score > bestScore) {
        best = cluster;
        bestScore = score;
      }
    }
    return bestScore >= 0.2 ? best : null;
  }

  function buildHeadlineBlock(records) {
    const items = Array.isArray(records) ? records : [];
    if (!items.length) return '(no headlines retrieved)';
    return items.map((record, index) => {
      const parts = [`${index + 1}. ${record.title}`];
      if (record.publisher) parts.push(`— ${record.publisher}`);
      if (record.publishedAt) parts.push(`(${record.publishedAt})`);
      return parts.join(' ');
    }).join('\n');
  }

  function hasUsefulNewsBatch(data, availableHeadlineCount, minimumItems = 6) {
    const items = Array.isArray(data) ? data : data && data.items;
    const available = Math.max(0, Math.floor(Number(availableHeadlineCount) || 0));
    const minimum = Math.max(1, Math.floor(Number(minimumItems) || 1));
    return Array.isArray(items) && available > 0 && items.length >= Math.min(minimum, available);
  }

  const api = {
    EVIDENCE_SCHEMA_VERSION,
    NEWS_ENRICHMENT_SCHEMA_VERSION,
    canonicalizeUrl,
    safeExternalUrl,
    normalizeTimestamp,
    normalizeEvidenceRecord,
    dedupeEvidence,
    clusterEvidence,
    freshnessLabel,
    newsroomStatus,
    summarizeEvidence,
    matchEvidence,
    buildHeadlineBlock,
    hasUsefulNewsBatch,
    classifySourceTier,
    reliabilityLabel,
    domainOf,
    normalizeText,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalThis.MarketTerminalEvidence = api;
})();
