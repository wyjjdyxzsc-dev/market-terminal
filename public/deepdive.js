// Deep Dive report renderer — the analyst-report experience from 42af0f6 (+ 6fafe78 level
// chips) on top of the current deterministic dossier / evidence model. Pure HTML-string
// builder with no DOM dependency, so the render contract is unit-testable in Node and the
// browser (intel.js) only wires clicks. Two intentional product states:
//   analysis → STOCK / OPTIONS ratings, levels, bull/bear/catalysts/risks from the model
//   fallback → same report skeleton, explicit NOT RATED / CHAIN ONLY, measured data only
// Measured fields (quote, stats, consensus, chain, provenance) are rendered from the dossier
// and never from model text; the shared core's merge rules guarantee those keys are measured.
(function () {
  'use strict';

  const DEEP_DIVE_RENDER_CONTRACT = '2026-09-20a';

  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function safeHttpUrl(value) {
    try {
      const url = new URL(String(value || ''));
      return /^https?:$/i.test(url.protocol) ? url.toString() : '';
    } catch {
      return '';
    }
  }

  const num = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
  const money = (v) => (num(v) === null ? null : `$${num(v).toFixed(2)}`);
  const liList = (arr) => (Array.isArray(arr) ? arr : []).map((x) => `<li>${esc(x)}</li>`).join('');
  const usableLevel = (value) => Boolean(value) && !/^(n\/a|unrated|not available)(\s|$)/i.test(String(value));

  function ratingClass(rating, fallback) {
    if (fallback) return 'rate-unrated';
    const k = String(rating || '').toLowerCase();
    if (k.includes('strong buy')) return 'rate-strongbuy';
    if (k.includes('buy')) return 'rate-buy';
    if (k.includes('strong sell')) return 'rate-strongsell';
    if (k.includes('sell')) return 'rate-sell';
    return 'rate-hold';
  }

  function biasClass(bias, fallback, chainAvailable) {
    if (fallback) return chainAvailable ? 'bias-chain' : 'bias-unavailable';
    const k = String(bias || '').toLowerCase();
    if (k === 'calls') return 'bias-calls';
    if (k === 'puts') return 'bias-puts';
    if (k === 'avoid') return 'bias-avoid';
    return 'bias-straddle';
  }

  function quoteHtml(q) {
    if (!q || num(q.price) === null) return '';
    const up = (num(q.change) || 0) >= 0;
    return `<span class="dd-price">$${num(q.price).toFixed(2)}</span>` +
      `<span class="dd-chg ${up ? 'up' : 'down'}">${up ? '▲' : '▼'} ${Math.abs(num(q.change) || 0).toFixed(2)} (${Math.abs(num(q.percent) || 0).toFixed(2)}%)</span>`;
  }

  function consensusBar(c) {
    if (!c) return '';
    const segs = [
      [c.strongBuy || 0, '#16c784'], [c.buy || 0, '#3fb950'], [c.hold || 0, '#d8a657'],
      [c.sell || 0, '#f0883e'], [c.strongSell || 0, '#f85149'],
    ];
    const total = segs.reduce((n, s) => n + s[0], 0) || 1;
    const bars = segs.map(([v, col]) => v ? `<span style="width:${(v / total) * 100}%;background:${col}" title="${v}"></span>` : '').join('');
    return `<div class="dd-consensus"><div class="dd-consensus-label">ANALYST CONSENSUS <span>(${total} ratings · ${esc(c.period || '')})</span></div>` +
      `<div class="dd-consensus-bar">${bars}</div>` +
      `<div class="dd-consensus-legend"><span>${c.strongBuy || 0} Strong Buy</span><span>${c.buy || 0} Buy</span><span>${c.hold || 0} Hold</span><span>${c.sell || 0} Sell</span><span>${c.strongSell || 0} Strong Sell</span></div></div>`;
  }

  const market = (bid, ask, last) => {
    if (num(bid) !== null && num(ask) !== null) return `${num(bid).toFixed(2)}/${num(ask).toFixed(2)} bid/ask`;
    if (num(last) !== null) return `${num(last).toFixed(2)} last`;
    return 'no quoted market';
  };

  // Measured chain context shown under the options view in both states.
  function chainContext(chain) {
    if (!chain || chain.status !== 'available') return '';
    const parts = [`${Number(chain.contractCount || 0)} rows · ${Number(chain.expiryCount || 0)} expiries${chain.nearestExpiry ? ` · nearest ${esc(chain.nearestExpiry)}` : ''}`];
    const atm = chain.atTheMoney;
    if (atm && num(atm.strike) !== null) {
      parts.push(`Nearest strike ${num(atm.strike).toFixed(2)}: call ${market(atm.callBid, atm.callAsk, atm.callLast)} · put ${market(atm.putBid, atm.putAsk, atm.putLast)}`);
    }
    const pc = chain.activity && num(chain.activity.putCallVolumeRatio);
    if (pc !== null && pc !== undefined) parts.push(`put/call volume ${pc.toFixed(3)}`);
    const url = safeHttpUrl(chain.sourceUrl || '');
    return `<div class="dd-chain-ctx">${parts.map((p) => `<span>${p}</span>`).join('')}` +
      `${url ? `<a class="dd-data-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">View source chain →</a>` : ''}</div>`;
  }

  function stockCard(d, fallback) {
    const inv = d.investment || {};
    if (fallback) {
      return `<div class="dd-rating rate-unrated">
        <div class="dd-rating-top"><span class="dd-rating-kind">STOCK</span><span class="dd-rating-score">—<i>/100</i></span></div>
        <div class="dd-rating-badge">NOT RATED</div>
        <div class="dd-rating-meta">Analysis unavailable · live data only</div>
        <div class="dd-rating-thesis">${esc(inv.thesis || 'The analyst rating did not complete on this refresh. The measured data below is unaffected.')}</div>
      </div>`;
    }
    const score = num(inv.score);
    return `<div class="dd-rating ${ratingClass(inv.rating)}">
      <div class="dd-rating-top"><span class="dd-rating-kind">STOCK</span><span class="dd-rating-score">${score !== null ? score : '—'}<i>/100</i></span></div>
      <div class="dd-rating-badge">${esc(inv.rating || '—')}</div>
      <div class="dd-rating-meta">${esc(inv.conviction || '')} conviction · ${esc(inv.horizon || '')}</div>
      <div class="dd-rating-thesis">${esc(inv.thesis || '')}</div>
      ${usableLevel(inv.fairValue) ? `<div class="dd-fair">Fair value: <b>${esc(inv.fairValue)}</b></div>` : ''}
    </div>`;
  }

  function optionsCard(d, fallback) {
    const opt = d.options || {};
    const chain = d.optionsChain || {};
    const chainOk = chain.status === 'available';
    if (fallback) {
      const reason = chainOk ? '' : (chain.reason || opt.rationale || 'No listed options-chain rows were returned for this response.');
      return `<div class="dd-rating ${biasClass(null, true, chainOk)}">
        <div class="dd-rating-top"><span class="dd-rating-kind">OPTIONS</span><span class="dd-rating-score">${chainOk ? `${Number(chain.contractCount || 0)}<i> rows</i>` : '—<i>/100</i>'}</span></div>
        <div class="dd-rating-badge">${chainOk ? 'CHAIN ONLY' : 'NO CHAIN'}</div>
        <div class="dd-rating-meta">${chainOk ? 'IV not supplied by the chain feed · no options view generated' : 'No listed chain returned'}</div>
        <div class="dd-rating-thesis">${chainOk ? `Listed ${esc(chain.source || 'exchange')} chain shown as measured data, not a trade idea.` : esc(reason)}</div>
        ${chainContext(chain)}
      </div>`;
    }
    const score = num(opt.score);
    const iv = opt.impliedVolatility && !/not supplied/i.test(String(opt.impliedVolatility)) ? `IV ${esc(opt.impliedVolatility)} (inferred)` : 'IV not supplied';
    return `<div class="dd-rating ${biasClass(opt.bias)}">
      <div class="dd-rating-top"><span class="dd-rating-kind">OPTIONS</span><span class="dd-rating-score">${score !== null ? score : '—'}<i>/100</i></span></div>
      <div class="dd-rating-badge">${esc(opt.bias || '—')}</div>
      <div class="dd-rating-meta">${iv} · ${esc(opt.timeframe || '')}</div>
      <div class="dd-rating-thesis"><b>${esc(opt.recommendation || '')}</b><br>${esc(opt.rationale || '')}</div>
      ${chainContext(chain)}
    </div>`;
  }

  function levelsHtml(d) {
    const chips = [
      usableLevel(d.technicalBias) ? `<div class="dd-level-bias dd-level-bias--${esc(String(d.technicalBias).toLowerCase())}"><span>TECH BIAS</span><b>${esc(d.technicalBias)}</b></div>` : '',
      usableLevel(d.entryZone) ? `<div class="dd-level-item"><span>ENTRY</span><b>${esc(d.entryZone)}</b></div>` : '',
      usableLevel(d.stopLoss) ? `<div class="dd-level-item dd-level-stop"><span>STOP</span><b>${esc(d.stopLoss)}</b></div>` : '',
      usableLevel(d.priceTarget) ? `<div class="dd-level-item dd-level-target"><span>TARGET</span><b>${esc(d.priceTarget)}</b></div>` : '',
    ].filter(Boolean);
    return chips.length ? `<div class="dd-levels">${chips.join('')}</div>` : '';
  }

  function statsHtml(d) {
    const st = d.stats || {};
    const tone = String(d.newsSentiment || 'unrated').toLowerCase().replace(/[^a-z]/g, '') || 'unrated';
    return `<div class="dd-stats">
      ${st.marketCap ? `<div class="dd-stat"><span>MKT CAP</span><b>${esc(st.marketCap)}</b></div>` : ''}
      ${num(st.pe) !== null ? `<div class="dd-stat"><span>P/E</span><b>${num(st.pe).toFixed(1)}</b></div>` : ''}
      ${num(st.pb) !== null ? `<div class="dd-stat"><span>P/B</span><b>${num(st.pb).toFixed(1)}</b></div>` : ''}
      ${num(st.beta) !== null ? `<div class="dd-stat"><span>BETA</span><b>${num(st.beta).toFixed(2)}</b></div>` : ''}
      ${money(st.high52) ? `<div class="dd-stat"><span>52W HIGH</span><b>${money(st.high52)}</b></div>` : ''}
      ${money(st.low52) ? `<div class="dd-stat"><span>52W LOW</span><b>${money(st.low52)}</b></div>` : ''}
      ${num(st.rangePosition) !== null ? `<div class="dd-stat"><span>52W POSITION</span><b>${num(st.rangePosition).toFixed(1)}%</b></div>` : ''}
      <div class="dd-stat news-tone"><span>NEWS TONE</span><b class="tone-${esc(tone)}">${esc(tone.toUpperCase())}</b></div>
    </div>`;
  }

  function runtimeSummary(policy) {
    const runtime = policy && policy.runtime;
    if (!runtime) return '';
    const generator = runtime.generator;
    const verifier = runtime.verifier;
    const attempts = Array.isArray(runtime.attempts) ? runtime.attempts : [];
    const parts = [];
    if (generator && generator.provider) {
      parts.push(`generated by ${generator.provider}/${generator.servedModel || generator.requestedModel || 'model'}`);
    } else if (attempts.length) {
      const providers = [...new Set(attempts.map((a) => a.provider).filter(Boolean))];
      parts.push(`no model output accepted after ${attempts.length} attempt${attempts.length === 1 ? '' : 's'}${providers.length ? ` (${providers.join(', ')})` : ''}`);
    }
    if (verifier && verifier.status === 'passed') parts.push(`verified by ${verifier.provider}/${verifier.servedModel || verifier.requestedModel || 'model'}`);
    else if (verifier && verifier.status === 'rejected') parts.push(`rejected by ${verifier.provider}/${verifier.servedModel || verifier.requestedModel || 'model'}`);
    return parts.join(' · ');
  }

  // Compact, honest strip for the ANALYSIS UNAVAILABLE state. Sits under the head so the
  // reader knows the state before the summary, but takes three short lines, not a panel.
  function noticeHtml(d) {
    const policy = d.policy || {};
    const runtime = runtimeSummary(policy);
    return `<div class="dd-notice">
      <div class="dd-notice-title">AI ANALYSIS UNAVAILABLE — LIVE DATA SHOWN</div>
      ${policy.reason ? `<div class="dd-notice-reason">${esc(policy.reason)}</div>` : ''}
      <div class="dd-notice-meta">Quote, fundamentals, consensus, chain, and sources below are measured and unaffected.${runtime ? ` · ${esc(runtime)}` : ''}</div>
    </div>`;
  }

  function provenanceHtml(d) {
    const s = (d.dataSources || {});
    const cell = (label, src, detail) => {
      const state = String((src && src.status) || 'unavailable').toLowerCase().replace(/[^a-z-]/g, '');
      return `<div class="dd-source"><div><span>${label}</span><i class="dd-source-state is-${esc(state)}">${esc((src && src.status) || 'unavailable')}</i></div><b>${esc(detail)}</b></div>`;
    };
    const q = s.quote || {}, f = s.fundamentals || {}, a = s.analysts || {}, o = s.options || {}, n = s.news || {};
    return `<div class="dd-provenance">
      ${cell('QUOTE', q, q.provider || 'No usable provider')}
      ${cell('FUNDAMENTALS', f, f.status === 'available' ? `${f.fieldCount || 0} Finnhub metrics` : 'Metrics unavailable')}
      ${cell('ANALYSTS', a, a.status === 'available' ? `${a.ratingCount || 0} ratings${a.period ? `, ${a.period}` : ''}` : 'Consensus unavailable')}
      ${cell('OPTIONS', o, o.status === 'available' ? `${o.contractCount || 0} rows${o.nearestExpiry ? `, ${o.nearestExpiry}` : ''}` : (o.reason || 'Chain unavailable'))}
      ${cell('NEWS', n, n.recordCount ? `${n.recordCount} records, ${n.sourceCount || 0} sources` : 'No qualifying records')}
    </div>`;
  }

  function evidenceHtml(d, fallback) {
    const evidence = Array.isArray(d.evidence) ? d.evidence : [];
    const cited = new Set(Array.isArray(d.evidenceIds) ? d.evidenceIds : []);
    const rows = evidence.slice(0, 6).map((entry) => {
      const url = safeHttpUrl(entry.sourceUrl || '');
      const date = entry.publishedAt && !Number.isNaN(new Date(entry.publishedAt).valueOf()) ? new Date(entry.publishedAt).toLocaleDateString() : 'time unavailable';
      const title = esc(entry.title || 'Untitled source record');
      const headline = url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${title}</a>` : `<span>${title}</span>`;
      const mark = !fallback && cited.has(entry.id) ? '<i class="dd-cited" title="cited by the analysis">●</i> ' : '';
      return `<div class="dd-evidence-row"><div>${mark}${headline}</div><span>${esc(entry.publisher || entry.publisherDomain || 'source')} · ${esc(date)}</span></div>`;
    });
    if (!rows.length) return '';
    return `<div class="dd-evidence"><div class="dd-evidence-title">RECENT SOURCE EVIDENCE</div>${rows.join('')}</div>`;
  }

  function groundingLine(d, fallback) {
    const policy = d.policy;
    if (!policy || fallback) return '';
    const evidence = Array.isArray(d.evidence) ? d.evidence : [];
    const cited = new Set(Array.isArray(d.evidenceIds) ? d.evidenceIds : []);
    const links = evidence.filter((e) => cited.has(e.id)).slice(0, 3).map((e) => {
      const url = safeHttpUrl(e.sourceUrl || '');
      const label = esc(e.publisher || e.publisherDomain || 'source');
      return url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${label}</a>` : `<span>${label}</span>`;
    }).join(' · ');
    const asOf = policy.dataAsOf && !Number.isNaN(new Date(policy.dataAsOf).valueOf()) ? new Date(policy.dataAsOf).toLocaleString() : '';
    const count = Number(policy.evidenceCount || 0);
    const runtime = runtimeSummary(policy);
    return `<div class="dd-grounding">Evidence-grounded analysis · ${count} qualifying source record${count === 1 ? '' : 's'}${asOf ? ` · as of ${esc(asOf)}` : ''}${runtime ? ` · ${esc(runtime)}` : ''}${links ? `<br>Cited: ${links}` : ''}</div>`;
  }

  function renderDeepDiveReport(d) {
    const data = d || {};
    const st = data.stats || {};
    const fallback = data.aiNarrativeStatus !== 'ready';
    const logo = safeHttpUrl(st.logo || '');
    const caseLabels = fallback
      ? ['▲ SUPPORTING OBSERVATIONS', '▼ CAUTION OBSERVATIONS', '⚡ RECENT WATCH ITEMS', '⚠ DATA LIMITS']
      : ['▲ BULL CASE', '▼ BEAR CASE', '⚡ CATALYSTS', '⚠ RISKS'];
    const ticker = esc(data.ticker);
    return `<div class="dd-card" data-dd-state="${fallback ? 'fallback' : 'analysis'}">
      <div class="dd-head">
        ${logo ? `<img class="dd-logo" src="${esc(logo)}" alt="">` : ''}
        <div class="dd-id">
          <div class="dd-ticker" data-ticker="${ticker}">${ticker}</div>
          <div class="dd-name">${esc(data.company)}${st.industry ? ` · ${esc(st.industry)}` : ''}</div>
        </div>
        <div class="dd-quote">${quoteHtml(data.quote)}</div>
      </div>

      ${fallback ? noticeHtml(data) : ''}

      <p class="dd-summary">${esc(data.summary)}</p>

      <div class="dd-ratings">
        ${stockCard(data, fallback)}
        ${optionsCard(data, fallback)}
      </div>

      ${data.keyDrivers ? `<div class="dd-drivers"><span class="dd-drivers-label">${fallback ? 'OBSERVED INPUTS' : "WHAT'S MOVING IT"}</span> ${esc(data.keyDrivers)}</div>` : ''}

      ${fallback ? '' : levelsHtml(data)}

      <div class="dd-cases">
        <div class="dd-case dd-bull"><h4>${caseLabels[0]}</h4><ul>${liList(data.bullCase)}</ul></div>
        <div class="dd-case dd-bear"><h4>${caseLabels[1]}</h4><ul>${liList(data.bearCase)}</ul></div>
      </div>
      <div class="dd-cases">
        <div class="dd-case dd-cat"><h4>${caseLabels[2]}</h4><ul>${liList(data.catalysts)}</ul></div>
        <div class="dd-case dd-risk"><h4>${caseLabels[3]}</h4><ul>${liList(data.risks)}</ul></div>
      </div>

      ${statsHtml(data)}

      ${consensusBar(data.analystConsensus)}

      <div class="dd-sources">
        <div class="dd-sources-title">KEY DATA &amp; SOURCES</div>
        ${provenanceHtml(data)}
        ${evidenceHtml(data, fallback)}
        ${groundingLine(data, fallback)}
      </div>

      <button class="dd-open" data-ticker="${ticker}">Open ${ticker} in Terminal →</button>
      <p class="dd-disclaimer">${fallback
        ? 'Live terminal data — educational only, not investment advice.'
        : 'AI-generated analysis from live quote, fundamental, options-chain, and news data — educational only, not investment advice.'}</p>
    </div>`;
  }

  const api = { DEEP_DIVE_RENDER_CONTRACT, renderDeepDiveReport, ratingClass, biasClass, safeHttpUrl };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalThis.MarketTerminalDeepDiveRender = api;
})();
