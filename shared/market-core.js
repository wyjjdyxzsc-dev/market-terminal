(() => {
  'use strict';

  // ─────────────────────────────────────────────────────────────────────────
  // MT2-3 TWINCORE — canonical market context shared by Express, the Worker
  // and the browser. Pure: no I/O, no DOM. Everything market-specific that
  // used to be implicit ("ET", "$", "SPY", "9:30–16:00", NYSE holidays)
  // lives here so US and India are first-class and never leak into each other.
  // ─────────────────────────────────────────────────────────────────────────

  const MARKET_SCHEMA_VERSION = '2026-09-20a';

  /** Explicit data-truth vocabulary. Order = precedence when several apply. */
  const DATA_TRUTH = Object.freeze({
    UNAVAILABLE: 'UNAVAILABLE',
    LAST_GOOD: 'LAST_GOOD',
    CACHED: 'CACHED',
    EOD: 'EOD',
    SNAPSHOT: 'SNAPSHOT',
    DELAYED: 'DELAYED',
    REALTIME: 'REALTIME',
  });

  /** data truth → QUARTZ `.fresh[data-fresh]` vocabulary (public/style.css). */
  const TRUTH_TO_FRESH = Object.freeze({
    REALTIME: 'live', DELAYED: 'delayed', SNAPSHOT: 'snapshot', EOD: 'eod',
    CACHED: 'cached', LAST_GOOD: 'last-good', UNAVAILABLE: 'unavailable',
  });

  // Calendars are embedded for 2025–2027 (US, from the pre-TWINCORE app.js list) and
  // 2026 (India). They are data, so their provenance is stated in the payload.
  const US_HOLIDAYS = Object.freeze([
    '2025-01-01', '2025-01-09', '2025-01-20', '2025-02-17', '2025-04-18', '2025-05-26', '2025-06-19',
    '2025-07-04', '2025-09-01', '2025-11-27', '2025-12-25',
    '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25', '2026-06-19', '2026-07-03',
    '2026-09-07', '2026-11-26', '2026-12-25',
    '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31', '2027-06-18', '2027-07-05',
    '2027-09-06', '2027-11-25', '2027-12-24',
  ]);
  const US_EARLY_CLOSE = Object.freeze(['2025-07-03', '2025-11-28', '2025-12-24', '2026-11-27', '2026-12-24', '2027-11-26']);
  const IN_HOLIDAYS = Object.freeze([
    // NSE/BSE 2026 trading holidays (weekday entries only; Sunday observances omitted).
    ['2026-01-26', 'Republic Day'], ['2026-03-03', 'Holi'], ['2026-03-26', 'Shri Ram Navami'],
    ['2026-03-31', 'Shri Mahavir Jayanti'], ['2026-04-03', 'Good Friday'], ['2026-04-14', 'Dr. Ambedkar Jayanti'],
    ['2026-05-01', 'Maharashtra Day'], ['2026-05-28', 'Bakri Id'], ['2026-06-26', 'Muharram'],
    ['2026-09-14', 'Ganesh Chaturthi'], ['2026-10-02', 'Mahatma Gandhi Jayanti'], ['2026-10-20', 'Dussehra'],
    ['2026-11-09', 'Diwali Balipratipada'], ['2026-11-24', 'Guru Nanak Jayanti'], ['2026-12-25', 'Christmas'],
  ]);

  const MARKETS = Object.freeze({
    US: Object.freeze({
      id: 'US',
      label: 'US',
      name: 'United States',
      currency: 'USD',
      currencySymbol: '$',
      locale: 'en-US',
      timezone: 'America/New_York',
      tzLabel: 'ET',
      // MT2-5A CENSUS: SEC EDGAR's company_tickers_exchange.json classifies every
      // US-listed issuer's exchange field as one of Nasdaq | NYSE | OTC | CBOE | null
      // (unclassified). OTC and CBOE are real, distinct listing venues — folding them
      // into the NYSE/NASDAQ fallback marker would misrepresent a known fact as
      // "unknown". Only a genuinely null SEC exchange field falls through to
      // `defaultExchange` ('US', the consolidated-tape marker) below.
      exchanges: Object.freeze(['NYSE', 'NASDAQ', 'OTC', 'CBOE']),
      // US quotes come from the consolidated tape; the listing venue is only known once a
      // profile is loaded, so the canonical exchange segment is the consolidated marker.
      defaultExchange: 'US',
      exchangeLabel: 'NYSE · Nasdaq',
      sessionLabel: 'NYSE · Nasdaq · ET',
      session: Object.freeze({ open: '09:30', close: '16:00', preOpen: '04:00', postClose: '20:00', earlyClose: '13:00' }),
      calendar: Object.freeze({ holidays: US_HOLIDAYS, earlyClose: US_EARLY_CLOSE, source: 'embedded NYSE 2025–2027 list' }),
      defaultSymbol: 'AAPL',
      tape: Object.freeze(['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA']),
      benchmarks: Object.freeze([
        { symbol: 'SPY', name: 'S&P 500 · SPDR' },
        { symbol: 'QQQ', name: 'Nasdaq-100 · Invesco' },
        { symbol: 'DIA', name: 'Dow Jones · SPDR' },
        { symbol: 'IWM', name: 'Russell 2000 · iShares' },
      ]),
      sentimentBenchmarks: Object.freeze([
        { symbol: 'SPY' }, { symbol: 'QQQ' }, { symbol: 'DIA' }, { symbol: 'IWM' }, { symbol: '^VIX', inverse: true },
      ]),
      quantBenchmark: Object.freeze({ symbol: 'SPY', label: 'SPY' }),
      indexSymbols: Object.freeze(['^VIX', '^GSPC', '^DJI', '^IXIC', '^RUT']),
      providerSuffix: Object.freeze({}),
      sentimentFeeds: Object.freeze([
        'https://finance.yahoo.com/news/rssindex',
        'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258',
        'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10000664',
        'https://feeds.content.dowjones.io/public/rss/mw_topstories',
        'https://feeds.content.dowjones.io/public/rss/mw_marketpulse',
        'https://www.bing.com/news/search?q=stocks+earnings+markets&format=rss',
      ]),
    }),
    IN: Object.freeze({
      id: 'IN',
      label: 'India',
      name: 'India',
      currency: 'INR',
      currencySymbol: '₹',
      locale: 'en-IN',
      timezone: 'Asia/Kolkata',
      tzLabel: 'IST',
      exchanges: Object.freeze(['NSE', 'BSE']),
      defaultExchange: 'NSE',
      exchangeLabel: 'NSE · BSE',
      sessionLabel: 'NSE · BSE · IST',
      session: Object.freeze({ open: '09:15', close: '15:30', preOpen: '09:00', postClose: '16:00', earlyClose: null }),
      calendar: Object.freeze({
        holidays: Object.freeze(IN_HOLIDAYS.map((h) => h[0])),
        holidayNames: Object.freeze(Object.fromEntries(IN_HOLIDAYS)),
        earlyClose: Object.freeze([]),
        source: 'embedded NSE 2026 list — verify against the current NSE trading-holiday circular',
      }),
      defaultSymbol: 'RELIANCE',
      tape: Object.freeze(['RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK', 'SBIN', 'ITC']),
      benchmarks: Object.freeze([
        { symbol: '^NSEI', name: 'NIFTY 50 · NSE' },
        { symbol: '^BSESN', name: 'SENSEX · BSE' },
        { symbol: '^NSEBANK', name: 'NIFTY Bank · NSE' },
        { symbol: '^INDIAVIX', name: 'India VIX · NSE' },
      ]),
      sentimentBenchmarks: Object.freeze([
        { symbol: '^NSEI' }, { symbol: '^BSESN' }, { symbol: '^NSEBANK' }, { symbol: '^INDIAVIX', inverse: true },
      ]),
      quantBenchmark: Object.freeze({ symbol: '^NSEI', label: 'NIFTY 50' }),
      indexSymbols: Object.freeze(['^NSEI', '^BSESN', '^NSEBANK', '^INDIAVIX', '^CNXIT', '^NSEMDCP50']),
      providerSuffix: Object.freeze({ NSE: '.NS', BSE: '.BO' }),
      sentimentFeeds: Object.freeze([
        'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms',
        'https://www.moneycontrol.com/rss/marketreports.xml',
        'https://www.bing.com/news/search?q=nifty+sensex+stocks+markets&format=rss',
        'https://news.google.com/rss/search?q=nifty+OR+sensex+OR+%22NSE%22+stocks&hl=en-IN&gl=IN&ceid=IN:en',
      ]),
    }),
  });

  const MARKET_IDS = Object.freeze(Object.keys(MARKETS));
  const DEFAULT_MARKET = 'US';

  /**
   * Provider capability matrix — verified 2026-09-20 (EVIDENCE.md MT2-3):
   * Finnhub free tier: NSE/BSE quote → "You don't have access to this resource";
   * /search does return `.NS` listings. Yahoo (keyless, from Cloudflare): NSE/BSE quotes,
   * INR 5-minute bars, ^NSEI/^BSESN/^INDIAVIX. Nasdaq chart API is US-only. Keyed
   * fallbacks (TwelveData/FMP/AlphaVantage/Polygon) are US-only as configured here; India
   * support on paid plans is unverified and therefore not claimed.
   * Truth values are the BEST a provider can deliver for that market; runtime state
   * (cache, last-good, closed session) only ever downgrades them.
   */
  const PROVIDER_CAPABILITIES = Object.freeze({
    finnhub:      { US: { quote: 'REALTIME', stream: 'REALTIME', search: true, profile: true, metrics: true, news: true }, IN: { quote: null, stream: null, search: true, profile: false, metrics: false, news: false } },
    yahoo:        { US: { quote: 'DELAYED', chart: 'DELAYED' }, IN: { quote: 'DELAYED', chart: 'DELAYED' } },
    nasdaq:       { US: { chart: 'DELAYED', options: 'DELAYED' }, IN: {} },
    twelvedata:   { US: { quote: 'DELAYED' }, IN: {} },
    fmp:          { US: { quote: 'DELAYED' }, IN: {} },
    alphavantage: { US: { quote: 'DELAYED' }, IN: {} },
    polygon:      { US: { quote: 'DELAYED' }, IN: {} },
  });

  function market(id) {
    const key = String(id || '').trim().toUpperCase();
    return MARKETS[key] || null;
  }

  function resolveMarketId(id, fallback = DEFAULT_MARKET) {
    const m = market(id);
    return m ? m.id : fallback;
  }

  function listMarkets() {
    return MARKET_IDS.map((id) => MARKETS[id]);
  }

  // ───────────────────────── instrument identity ─────────────────────────

  const SUFFIX_TO_EXCHANGE = Object.freeze({ '.NS': ['IN', 'NSE'], '.BO': ['IN', 'BSE'] });
  const PREFIX_TO_EXCHANGE = Object.freeze({ 'NSE:': ['IN', 'NSE'], 'BSE:': ['IN', 'BSE'], 'NASDAQ:': ['US', 'NASDAQ'], 'NYSE:': ['US', 'NYSE'] });

  function isIndexSymbol(symbol) {
    return String(symbol || '').startsWith('^');
  }

  function marketOfIndex(symbol) {
    for (const id of MARKET_IDS) if (MARKETS[id].indexSymbols.includes(symbol)) return id;
    return null;
  }

  /**
   * Parse any user/provider spelling into one canonical identity. The canonical symbol
   * NEVER carries a provider suffix (`.NS`, `.BO`) — that only appears in `provider.*`.
   *   'AAPL'              → US:US:AAPL
   *   'RELIANCE.NS'       → IN:NSE:RELIANCE (suffix wins over the hint)
   *   'NSE:RELIANCE'      → IN:NSE:RELIANCE
   *   'IN:BSE:RELIANCE'   → IN:BSE:RELIANCE
   *   'RELIANCE' + hint IN→ IN:NSE:RELIANCE
   *   '^NSEI'             → IN:NSE:^NSEI (index)
   */
  function parseInstrument(raw, marketHint) {
    let text = String(raw || '').trim().toUpperCase();
    if (!text) return null;
    let marketId = null;
    let exchange = null;

    const canonical = text.match(/^([A-Z]{2}):([A-Z]+):(.+)$/);
    if (canonical && MARKETS[canonical[1]]) {
      marketId = canonical[1];
      exchange = canonical[2];
      text = canonical[3];
    } else {
      for (const [prefix, [mkt, exch]] of Object.entries(PREFIX_TO_EXCHANGE)) {
        if (text.startsWith(prefix)) { marketId = mkt; exchange = exch; text = text.slice(prefix.length); break; }
      }
    }
    for (const [suffix, [mkt, exch]] of Object.entries(SUFFIX_TO_EXCHANGE)) {
      if (text.endsWith(suffix) && text.length > suffix.length) {
        marketId = mkt; exchange = exch; text = text.slice(0, -suffix.length); break;
      }
    }
    if (!text) return null;

    const kind = isIndexSymbol(text) ? 'index' : 'equity';
    if (!marketId && kind === 'index') marketId = marketOfIndex(text);
    if (!marketId) marketId = resolveMarketId(marketHint, DEFAULT_MARKET);
    const m = MARKETS[marketId];
    if (!exchange || (!m.exchanges.includes(exchange) && exchange !== m.defaultExchange)) exchange = m.defaultExchange;

    const symbol = text.replace(/[^A-Z0-9.&^-]/g, '');
    if (!/^[A-Z0-9^][A-Z0-9.&-]*$/.test(symbol)) return null;
    const suffix = kind === 'index' ? '' : (m.providerSuffix[exchange] || '');
    return Object.freeze({
      market: marketId,
      exchange,
      symbol,
      kind,
      canonical: `${marketId}:${exchange}:${symbol}`,
      display: symbol,
      currency: m.currency,
      provider: Object.freeze({
        yahoo: symbol + suffix,
        finnhub: symbol + suffix,
        nasdaq: marketId === 'US' && kind === 'equity' ? symbol : null,
      }),
    });
  }

  /**
   * Cache identity. A market-less identity is a programming error (it is how SPY/AAPL data
   * could shadow an Indian symbol), so it throws instead of producing a key.
   */
  function cacheKey(kind, identity, ...extra) {
    if (!kind) throw new Error('cacheKey: kind is required');
    if (!identity || !identity.market || !MARKETS[identity.market]) throw new Error('cacheKey: identity.market is required');
    if (!identity.exchange || !identity.symbol) throw new Error('cacheKey: identity.exchange and identity.symbol are required');
    const parts = [kind, identity.market, identity.exchange, identity.symbol, ...extra.map((e) => String(e))];
    return parts.join(':');
  }

  // ───────────────────────── session / calendar ─────────────────────────

  function wallClock(timezone, date) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
      hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false,
    }).formatToParts(date);
    const get = (t) => parts.find((p) => p.type === t)?.value;
    let hour = parseInt(get('hour'), 10);
    if (hour === 24) hour = 0;
    return {
      date: `${get('year')}-${get('month')}-${get('day')}`,
      weekday: get('weekday'),
      hour,
      minute: parseInt(get('minute'), 10),
      second: parseInt(get('second'), 10),
    };
  }

  function hm(text) {
    const [h, m] = String(text).split(':').map(Number);
    return h * 60 + m;
  }

  /** Session phase for a market at `date` (default now). Pure given the embedded calendar. */
  function sessionState(marketId, date = new Date()) {
    const m = market(marketId);
    if (!m) throw new Error(`sessionState: unknown market ${marketId}`);
    const wc = wallClock(m.timezone, date);
    const mins = wc.hour * 60 + wc.minute;
    const isWeekend = wc.weekday === 'Sat' || wc.weekday === 'Sun';
    const isHoliday = m.calendar.holidays.includes(wc.date);
    const holidayName = isHoliday ? ((m.calendar.holidayNames && m.calendar.holidayNames[wc.date]) || 'Market holiday') : null;
    const isEarlyClose = m.calendar.earlyClose.includes(wc.date);
    const open = hm(m.session.open);
    const close = isEarlyClose && m.session.earlyClose ? hm(m.session.earlyClose) : hm(m.session.close);
    const pre = hm(m.session.preOpen);
    const post = hm(m.session.postClose);

    let phase = 'CLOSED';
    if (!isWeekend && !isHoliday) {
      if (mins >= open && mins < close) phase = 'OPEN';
      else if (mins >= pre && mins < open) phase = 'PRE';
      else if (mins >= close && mins < post) phase = 'POST';
    }
    const labels = { OPEN: isEarlyClose ? 'OPEN (EARLY CLOSE)' : 'OPEN', PRE: 'PRE-MKT', POST: 'AFTER-HRS', CLOSED: 'CLOSED' };
    return {
      market: m.id,
      timezone: m.timezone,
      tzLabel: m.tzLabel,
      localDate: wc.date,
      localTime: `${String(wc.hour).padStart(2, '0')}:${String(wc.minute).padStart(2, '0')}`,
      phase,
      label: labels[phase],
      isWeekend,
      isHoliday,
      holidayName,
      isEarlyClose,
      open: m.session.open,
      close: isEarlyClose && m.session.earlyClose ? m.session.earlyClose : m.session.close,
      calendarSource: m.calendar.source,
    };
  }

  /** UTC epoch (ms) of the market's wall-clock `HH:MM` on the local calendar day of `sampleMs`. */
  function sessionBoundsUTC(marketId, sampleMs) {
    const m = market(marketId);
    if (!m) throw new Error(`sessionBoundsUTC: unknown market ${marketId}`);
    const sample = new Date(sampleMs);
    const wc = wallClock(m.timezone, sample);
    const [y, mo, d] = wc.date.split('-').map(Number);
    // Offset between the market wall clock and UTC at the sample instant.
    const asUTC = Date.UTC(y, mo - 1, d, wc.hour, wc.minute, wc.second);
    const offsetMs = asUTC - Math.floor(sampleMs / 1000) * 1000;
    const at = (text) => { const [h, mn] = text.split(':').map(Number); return Date.UTC(y, mo - 1, d, h, mn) - offsetMs; };
    const state = sessionState(marketId, sample);
    return { openUTC: at(m.session.open), closeUTC: at(state.close), timezone: m.timezone, tzLabel: m.tzLabel, localDate: wc.date, hourUTC: (h) => at(`${h}:00`) };
  }

  // ───────────────────────── money ─────────────────────────

  function formatMoney(value, marketId, options = {}) {
    const m = market(marketId) || MARKETS[DEFAULT_MARKET];
    if (value === null || value === undefined || value === '') return '—';
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    const digits = options.digits ?? 2;
    const body = n.toLocaleString(m.locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
    return options.symbol === false ? body : `${m.currencySymbol}${body}`;
  }

  // ───────────────────────── data truth ─────────────────────────

  function providerTruth(provider, marketId, capability = 'quote') {
    const p = PROVIDER_CAPABILITIES[String(provider || '').toLowerCase().replace(/\d+$/, '')];
    const caps = p && p[resolveMarketId(marketId)];
    const value = caps ? caps[capability] : null;
    return value && DATA_TRUTH[value] ? value : null;
  }

  /**
   * Classify what a served value truthfully is. Inputs describe runtime state; the
   * provider matrix supplies the ceiling. Never returns REALTIME for a provider/market pair
   * the matrix does not mark REALTIME (e.g. Yahoo for India).
   */
  function classifyDataTruth(input = {}) {
    const marketId = resolveMarketId(input.market);
    const hasValue = input.hasValue !== undefined ? Boolean(input.hasValue) : Number(input.price) > 0;
    if (!hasValue) return DATA_TRUTH.UNAVAILABLE;
    if (input.lastGood) return DATA_TRUTH.LAST_GOOD;
    const ceiling = providerTruth(input.provider, marketId, input.capability || 'quote');
    if (!ceiling) return DATA_TRUTH.SNAPSHOT;
    const now = input.now ?? Date.now();
    const asOf = Number(input.asOf);
    const ageMs = Number.isFinite(asOf) ? now - asOf : null;
    if (input.fromCache && ageMs !== null && ageMs > 60_000) return DATA_TRUTH.CACHED;
    const session = input.session || sessionState(marketId, new Date(now));
    if (session.phase === 'CLOSED') return DATA_TRUTH.EOD;
    if (ageMs !== null && ageMs > 20 * 60_000) return DATA_TRUTH.SNAPSHOT;
    return ceiling;
  }

  function freshKey(truth) {
    return TRUTH_TO_FRESH[truth] || 'unavailable';
  }

  // ───────────────────────── invariants (used by tests + runtime guards) ─────────────────────────

  /** True when `symbol` belongs to another market's benchmark/index universe. */
  function isForeignBenchmark(marketId, symbol) {
    const me = resolveMarketId(marketId);
    const s = String(symbol || '').toUpperCase();
    for (const id of MARKET_IDS) {
      if (id === me) continue;
      const other = MARKETS[id];
      if (other.benchmarks.some((b) => b.symbol === s) || other.sentimentBenchmarks.some((b) => b.symbol === s) || other.quantBenchmark.symbol === s || other.indexSymbols.includes(s)) return true;
    }
    return false;
  }

  /** Public catalog for `/api/market` and the browser (no functions, serializable). */
  function catalog(now = new Date()) {
    return {
      marketSchemaVersion: MARKET_SCHEMA_VERSION,
      defaultMarket: DEFAULT_MARKET,
      markets: listMarkets().map((m) => ({
        id: m.id, label: m.label, name: m.name, currency: m.currency, currencySymbol: m.currencySymbol,
        locale: m.locale, timezone: m.timezone, tzLabel: m.tzLabel, exchanges: m.exchanges,
        defaultExchange: m.defaultExchange, exchangeLabel: m.exchangeLabel, sessionLabel: m.sessionLabel,
        session: m.session, calendar: { holidays: m.calendar.holidays, earlyClose: m.calendar.earlyClose, source: m.calendar.source },
        defaultSymbol: m.defaultSymbol, tape: m.tape, benchmarks: m.benchmarks, quantBenchmark: m.quantBenchmark,
        indexSymbols: m.indexSymbols, providerSuffix: m.providerSuffix,
        state: sessionState(m.id, now),
      })),
      providers: PROVIDER_CAPABILITIES,
      dataTruth: Object.keys(DATA_TRUTH),
      generatedAt: now.toISOString(),
    };
  }

  const api = {
    MARKET_SCHEMA_VERSION, DATA_TRUTH, TRUTH_TO_FRESH, MARKETS, MARKET_IDS, DEFAULT_MARKET, PROVIDER_CAPABILITIES,
    market, resolveMarketId, listMarkets, parseInstrument, cacheKey, sessionState, sessionBoundsUTC,
    formatMoney, providerTruth, classifyDataTruth, freshKey, isForeignBenchmark, isIndexSymbol, catalog,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalThis.MarketTerminalMarket = api;
})();
