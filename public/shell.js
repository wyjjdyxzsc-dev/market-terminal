/**
 * Market Terminal 2.0 — application shell navigation model (MT2-2 QUARTZ).
 *
 * Pure, DOM-free navigation registry shared by the browser shell and the Node
 * unit tests. It answers three questions the shell needs before it touches the
 * DOM: which workspaces exist, what each navigation target resolves to (a legacy
 * `view` id plus an optional Global Intel `sub`), and which targets are
 * reserved-but-inactive so they can never masquerade as implemented.
 *
 * Legacy view ids (`terminal`, `news`, `sectors`, `analyze`, `supply`, `watchlist`,
 * `alerts`) are preserved on purpose: app.js and intel.js own the lifecycle of
 * those views and this module only maps the new workspace hierarchy onto them.
 *
 * Contract version: 2026-09-20a
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MarketTerminalShell = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SHELL_CONTRACT_VERSION = '2026-09-20a';

  // Reserved surfaces are represented in the shell but have no product logic yet.
  // They are rendered disabled with an honest note and can never resolve to a view.
  const WORKSPACES = Object.freeze([
    { id: 'markets',      label: 'Markets',      view: 'markets' },
    { id: 'terminal',     label: 'Terminal',     view: 'terminal' },
    { id: 'portfolio',    label: 'Portfolio',    reserved: true, note: 'Portfolio arrives with MT2-4 LEDGER. Nothing is tracked yet.' },
    { id: 'watchlist',    label: 'Watchlist',    view: 'watchlist' },
    { id: 'research',     label: 'Research',     items: [
      { id: 'analyze', label: 'Deep Dive', view: 'analyze' },
      { id: 'sectors', label: 'Sectors',   view: 'sectors' },
      { id: 'launchpad', label: 'IPOs', view: 'launchpad' },
    ] },
    { id: 'intelligence', label: 'Intelligence', items: [
      { id: 'worldwire', label: 'Worldwire', view: 'news', sub: 'worldwire' },
      { id: 'briefing',  label: 'Briefing',          view: 'news',   sub: 'briefing' },
      { id: 'situation', label: 'Situation Room',    view: 'news',   sub: 'situation' },
      { id: 'report',    label: 'Investment Report', view: 'news',   sub: 'report' },
      { id: 'supply',    label: 'Supply Chain',      view: 'supply' },
      { id: 'map',       label: 'Global Map',        view: 'news',   sub: 'map' },
    ] },
    { id: 'quant',        label: 'Quant',        view: 'quant' },
    { id: 'alerts',       label: 'Alerts',       view: 'alerts' },
  ]);

  // Global market-mode registry (MT2-3 TWINCORE). Both markets are first-class; the
  // canonical definitions (currency, calendar, benchmarks, provider matrix) live in
  // shared/market-core.js and reach the browser through /api/market. The shell only
  // needs identity, labels and persistence.
  const MARKETS = Object.freeze([
    { id: 'US', label: 'US',    active: true, session: 'NYSE · Nasdaq · ET', currency: 'USD', tzLabel: 'ET',  defaultSymbol: 'AAPL' },
    { id: 'IN', label: 'India', active: true, session: 'NSE · BSE · IST',    currency: 'INR', tzLabel: 'IST', defaultSymbol: 'RELIANCE' },
  ]);
  const DEFAULT_MARKET = 'US';
  const MARKET_STORAGE_KEY = 'mt:market';

  function market(id) {
    const key = String(id || '').trim().toUpperCase();
    return MARKETS.find((m) => m.id === key && m.active) || null;
  }

  /** Persisted selection → market id (falls back to US; never returns an inactive market). */
  function resolveMarketId(stored) {
    const m = market(stored);
    return m ? m.id : DEFAULT_MARKET;
  }

  /** Per-market last-symbol storage key. US keeps the legacy key so existing users keep their symbol. */
  function lastSymbolKey(marketId) {
    return resolveMarketId(marketId) === 'US' ? 'mt:lastSymbol' : `mt:lastSymbol:${resolveMarketId(marketId)}`;
  }

  const DEFAULT_WORKSPACE = 'terminal';

  function workspace(id) {
    return WORKSPACES.find((w) => w.id === id) || null;
  }

  function isEnabled(ws) {
    return Boolean(ws) && !ws.reserved && (Boolean(ws.view) || (Array.isArray(ws.items) && ws.items.length > 0));
  }

  /**
   * Resolve a navigation target to a concrete destination.
   * `target` may be a workspace id (`research`) or `workspace/item` (`research/sectors`).
   * Returns { workspace, item, view, sub, enabled, note }. Disabled targets resolve
   * with enabled:false and no view so callers cannot accidentally show them.
   */
  function resolve(target) {
    const [wsId, itemId] = String(target || '').split('/');
    const ws = workspace(wsId);
    if (!ws) return { workspace: null, item: null, view: null, sub: null, enabled: false, note: 'Unknown destination.' };
    if (!isEnabled(ws)) return { workspace: ws.id, item: null, view: null, sub: null, enabled: false, note: ws.note || 'Not available.' };
    if (Array.isArray(ws.items)) {
      const item = ws.items.find((it) => it.id === itemId) || ws.items[0];
      return { workspace: ws.id, item: item.id, view: item.view, sub: item.sub || null, enabled: true, note: null };
    }
    return { workspace: ws.id, item: null, view: ws.view, sub: null, enabled: true, note: null };
  }

  /** Inverse lookup: which workspace/item currently owns a legacy view (+ Global Intel sub). */
  function locate(view, sub) {
    for (const ws of WORKSPACES) {
      if (ws.reserved) continue;
      if (ws.view === view) return { workspace: ws.id, item: null };
      if (Array.isArray(ws.items)) {
        const exact = ws.items.find((it) => it.view === view && (!it.sub || !sub || it.sub === sub));
        if (exact) return { workspace: ws.id, item: exact.id };
      }
    }
    return { workspace: DEFAULT_WORKSPACE, item: null };
  }

  /** Every enabled destination as `workspace` or `workspace/item` targets (for tests + sitemap). */
  function enabledTargets() {
    const out = [];
    for (const ws of WORKSPACES) {
      if (!isEnabled(ws)) continue;
      if (Array.isArray(ws.items)) ws.items.forEach((it) => out.push(`${ws.id}/${it.id}`));
      else out.push(ws.id);
    }
    return out;
  }

  function reservedWorkspaces() {
    return WORKSPACES.filter((ws) => ws.reserved).map((ws) => ws.id);
  }

  /** Map a legacy `?tab=` deep link (push notifications use `?tab=alerts`) to a target. */
  function targetFromLegacyTab(tab) {
    const t = String(tab || '').trim();
    if (!t) return null;
    if (t === 'analysis') return 'research/sectors';
    if (t === 'news') return 'intelligence/briefing';
    const found = locate(t, null);
    if (!found || (found.workspace === DEFAULT_WORKSPACE && t !== 'terminal')) return null;
    return found.item ? `${found.workspace}/${found.item}` : found.workspace;
  }

  /** Parse `#/research/analyze` style hashes. Returns a target or null. */
  function targetFromHash(hash) {
    const h = String(hash || '').replace(/^#\/?/, '').trim();
    if (!h) return null;
    const parts = h.split('/').filter(Boolean);
    if (!parts.length) return null;
    const target = parts.slice(0, 2).join('/');
    return resolve(target).workspace ? target : null;
  }

  function hashForTarget(target) {
    const r = resolve(target);
    if (!r.enabled) return '';
    return '#/' + (r.item ? `${r.workspace}/${r.item}` : r.workspace);
  }

  return Object.freeze({
    SHELL_CONTRACT_VERSION,
    WORKSPACES,
    MARKETS,
    DEFAULT_MARKET,
    MARKET_STORAGE_KEY,
    market,
    resolveMarketId,
    lastSymbolKey,
    DEFAULT_WORKSPACE,
    workspace,
    isEnabled,
    resolve,
    locate,
    enabledTargets,
    reservedWorkspaces,
    targetFromLegacyTab,
    targetFromHash,
    hashForTarget,
  });
});
