# Project Meridian — DECISIONS

Lightweight decision records. STATUS: PROPOSED / ACCEPTED / SUPERSEDED / REJECTED.
Do not pre-decide future architecture; add records only when a real decision is made.

---

## D-001 · 2026-09-20 · MT2-0 · Identity of the "original Deep Research" to restore in MT2-1
- DECISION (PROPOSED, needs OWNER confirmation): treat the original DEEP DIVE analyst report at
  commit `42af0f6` (2026-06-27), as enriched by `6fafe78` (2026-07-03, level chips), as the
  "first complete and usable Claude Deep Research implementation" that MT2-1 REWIND restores.
- WHY: no commit, file, or doc in the repository's 74-commit history ever names "Deep Research".
  The OWNER's brief describes an original Claude implementation later degraded; the DEEP DIVE
  surface is the only one with that history (complete at 42af0f6 → four stacked suppressors
  07-16→08-04 → partial restoration 08-11 that still falls back in production).
- ALTERNATIVES CONSIDERED: (a) the "AI RESEARCH" chat panel from `6fafe78` — single-turn Q&A,
  never a research report; (b) the Investment Report sub-panel (`c7ae4c4`) — market-wide, not
  per-subject; (c) a feature that exists outside this repository (unknown to ground truth).
- CONSEQUENCES: MT2-1 scope becomes "restore the 42af0f6 Deep Dive experience on top of the
  current evidence model", not a blind revert.
- OWNER CLARIFICATION (2026-09-20): the owner's earlier phrase "restore Deep Research to how
  Claude made it in the first go" is interpreted from repository evidence as the original
  first-complete Claude-created DEEP DIVE analyst experience.
  Canonical restoration reference: `42af0f6` "Add DEEP DIVE tab: AI analyst report with invest +
  options ratings". `6fafe78` may be used only for additions that clearly extend the same original
  experience (e.g. richer level chips) without replacing its fundamental first-go product
  structure. The later Investment Report is NOT the restoration target. No separate historical
  "Deep Research" implementation is to be invented. MT2-1 restores the first-go DEEP DIVE
  product experience while preserving newer safety, evidence, security, and data-integrity
  infrastructure. Restoration was NOT performed during MT2-0 closure.
- STATUS: CONFIRMED by OWNER 2026-09-20

## D-002 · 2026-09-20 · MT2-0 · node_modules reinstalled instead of iCloud-materialised
- DECISION: reinstall git-ignored `node_modules` with `npm ci` from the committed lockfile
  rather than wait for iCloud to re-download 1,672 evicted files.
- WHY: serial materialisation stalled at ~1 file/10 s; `npm ci` is deterministic and touched no
  tracked file.
- ALTERNATIVES: `brctl download` (requested; no visible progress in 2 min), manual waiting.
- CONSEQUENCES: none for the repo; root cause remains (BACKLOG B-001).
- STATUS: ACCEPTED (environment-only)

## D-003 · 2026-09-20 · MT2-1 · Deep Dive report rendered by a pure, unit-tested module
- DECISION: extract the Deep Dive report body from `public/intel.js` into `public/deepdive.js`, a
  DOM-free HTML-string renderer with a pinned render contract (`2026-09-20a`), dual-exported for
  Node tests and the browser. `intel.js` keeps mount, click wiring, refresh model, and QUANT LAB.
- WHY: the REWIND done-contract requires proving the 42af0f6 analyst-report hierarchy exists when
  analysis is available, but B-002 means no live generation is observable locally or in
  production. A pure renderer makes both product states (analysis / fallback), ordering, measured-
  data authority, and URL safety testable in Node, and lets the browser pass verify the same code.
- ALTERNATIVES: (a) keep the render inline and rely on browser-only checks — cannot test the
  analysis state; (b) run `intel.js` under a DOM stub — 2,000+ lines of DOM coupling, brittle.
- CONSEQUENCES: one more static asset (shell contract = eight synchronized `?v=` refs); no
  backend or shared-core change; the shared core's merge rules remain the data authority.
- ALSO DECIDED: Deep Dive is exempt from the focus/visibility auto-refresh (42af0f6 refreshed only
  on submit, first open, and REFRESH; the 15-minute timer from later evolution is kept). The
  fallback keeps truthful observation labels (not "BULL CASE") because those bullets are
  deterministic counts, not analyst judgement; the original four-quadrant colour/icon flow is kept.
- STATUS: ACCEPTED

## D-004 · 2026-09-20 · MT2-2 · Navigation architecture and reserved surfaces
- DECISION: the primary navigation is the eight-workspace hierarchy MARKETS · TERMINAL · PORTFOLIO ·
  WATCHLIST · RESEARCH · INTELLIGENCE · QUANT · ALERTS, defined once in `public/shell.js` and rendered
  by `app.js`. RESEARCH groups Deep Dive + Sectors; INTELLIGENCE groups Briefing, Situation Room,
  Investment Report, Supply Chain, Global Map as a contextual subnav. Legacy view ids and their
  lifecycles in `app.js`/`intel.js` are unchanged; the shell maps targets onto them.
- RESERVED SURFACES: PORTFOLIO is rendered as a disabled tab marked "Soon" and resolves to no view
  (`resolve().enabled === false`, note "MT2-4 LEDGER"); clicking it only writes the note to the
  status line. The nav item is kept (rather than omitted) so the hierarchy is visible, but it can
  never masquerade as implemented — enforced by `tests/shell-nav.test.js`.
- WHY: the flat seven-tab row could not absorb Markets/Portfolio/Quant without overload; a pure
  registry makes the hierarchy, deep links (`#/workspace/item`, legacy `?tab=`) and the "disabled
  cannot open" rule testable in Node.
- ALTERNATIVES: (a) keep flat tabs and add three more — rejected (overload); (b) sidebar navigation —
  rejected for a desktop-first data terminal where vertical space matters more than horizontal.
- STATUS: ACCEPTED

## D-005 · 2026-09-20 · MT2-2 · Market-mode control placement and India behaviour
- DECISION: the global market mode lives in the application chrome between the brand and the
  command bar as a compact segmented control (`#marketMode`), rendered from `shell.js` `MARKETS`.
  US is the only active entry; India is present, `aria-disabled`, marked "Soon", has no click
  handler and no data path. MARKETS shows a market-context table that states this explicitly.
- WHY: the control must exist in the shell before TWINCORE so TWINCORE adds market identity without
  a navigation rewrite, while never faking a switch. Placement in the chrome (not inside MARKETS)
  because the mode will scope every workspace, not one.
- STATUS: ACCEPTED (TWINCORE owns the actual context switch; not authorized here)

## D-006 · 2026-09-20 · MT2-2 · Design-token architecture, typography, and the Quant workspace
- DECISION: `public/style.css` is organised in ten layers with semantic CSS-variable tokens on
  `:root` (surfaces, separators, text tiers, accent, positive/negative/warning/critical/info,
  spacing 4–32, radius by hierarchy 3/5/8, control heights, durations, z-index). Legacy aliases
  (`--panel`, `--panel-2`, `--border`, `--amber`, `--mono` …) are kept as a strangler seam so
  JS-rendered markup that still uses them continues to work. Body type is the system UI stack
  (SF Pro / Segoe / Inter fallback); every numeric surface uses the monospace data stack with
  tabular numerals. No framework, no bundler, no new runtime dependency.
- ALSO DECIDED: the Quant Lab becomes its own QUANT workspace with a single mounted instance
  (subject = Deep Dive subject if a report ran, else the Terminal symbol, or an explicit "Use
  Terminal symbol" override). The Deep Dive report keeps its full 42af0f6 hierarchy and gains a
  one-line "Open … in Quant Lab" action instead of embedding the lab. Market sentiment moves from
  the Terminal to MARKETS because it is market-wide, not security-scoped.
- WHY: the all-monospace, amber-everywhere, rounded-card presentation read as a generic AI
  dashboard; a two-stack type system with restrained accent, tonal surfaces and hierarchy-based
  radius gives a quieter professional workstation while keeping the amber identity for selection.
- ALTERNATIVES: (a) restyle in place without tokens — rejected (drift continues); (b) full CSS
  rewrite without aliases — rejected (would require touching every JS template in one checkpoint).
- CONSEQUENCES: shell contract is nine synchronized assets; D-003's "intel.js appends QUANT LAB"
  is superseded for the lab's location only — the report renderer and its tests are untouched.
- STATUS: ACCEPTED

## D-007 · 2026-09-20 · MT2-1A · "Deep Research" and "Deep Dive" are the same surface
- DECISION: the OWNER's phrase "Deep Research tab" refers to the per-stock analyst surface whose
  only name in this repository has ever been **DEEP DIVE** (tab `analyze`, route
  `/api/intel/deepdive`, renderer `public/deepdive.js`, core `shared/deep-dive-core.js`). There is
  no separate Deep Research surface, past or present, and nothing was renamed.
- EVIDENCE (git, 80 commits, all refs):
  - `git log --all -i --grep="deep.\?research"` → no commits. `git log --all -i -S"deep research"`
    (and `deepresearch`, `deep-research`, `deep_research`) → only the docs/mt2 seam commits from
    `fa52e1a` onward, i.e. Claude's own records of the OWNER's phrase. No file ever named
    `*research*` was added, deleted, or renamed.
  - Every `.ttab` label that ever existed: TERMINAL, NEWS→GLOBAL INTEL, SECTORS, DEEP DIVE
    (`analyze`), SUPPLY CHAIN, WATCHLIST, ALERTS. Every `/api/intel/*` route that ever existed:
    alerts, analysis, candle(s), chat, company, deepdive, instability, news, priceaction, report,
    situation, supplychain. Nothing research-named.
  - The `analyze` tab and `/api/intel/deepdive` both first appear in `42af0f6` and exist
    unchanged in identity through HEAD (QUARTZ registers `{ id: 'analyze', label: 'Deep Dive' }`).
  - The OWNER's own master prompt (`MARKET_TERMINAL_TOTAL_PLATFORM_CODEX_MASTER_PROMPT.md`,
    untracked) has no "Deep Research" section; §8.4 is titled **Deep Dive** and asks to
    "upgrade the deep dive … to a structured research report" — the OWNER describes Deep Dive
    as the research surface.
  - Historical "research" strings are incidental: system-prompt wording ("equity research
    analyst", initial commit), a GS "research" comment, a map label ("AI research hub"). The
    `6fafe78` chat panel was labelled "ASK AI / AI ANALYST" (D-001's alternative (a) said
    "AI RESEARCH" — corrected here; it is single-turn chat, not a research surface). The QUARTZ
    shell's "Research" *workspace* (b46bbb2) is a new grouping that contains Sectors and Deep
    Dive; it post-dates MT2-1 and is not a historical surface.
- CONSEQUENCES: MT2-1 REWIND remains PASS and satisfied the OWNER requirement. Future
  documents use "Deep Dive" for the surface and may say "(the OWNER's 'Deep Research')" once
  when quoting. D-001 stands, with the label correction above.
- STATUS: ACCEPTED

## D-008 · 2026-09-20 · POCKET (side-track) · iPhone delivery is a native WKWebView shell around the canonical web app
- DECISION: `ios/` holds a Swift/SwiftUI application (`Market Terminal`, `com.marketterminal.app`,
  iOS 16+) whose only content is a persistent `WKWebView` pointed at the production Worker
  origin. No financial, provider, AI, Deep Dive, map, quant, watchlist or portfolio logic is
  duplicated natively. Production URL is a single xcconfig value (`MARKET_TERMINAL_BASE_URL`)
  surfaced through Info.plist; Swift carries no service URL literal and enforces https.
- EXTERNAL LINKS: Market Terminal hosts stay in the shell (including `target=_blank`); external
  http(s) sources open in `SFSafariViewController` (Safari process, own cookies, content
  blockers), which returns to the untouched terminal on dismissal; `mailto:`/`tel:` go to the
  system; `javascript:` and self-scheme bounces are dropped; third-party iframes render in place.
- DEEP LINKS: the `marketterminal://` scheme is registered; only workspace routes that map onto
  the QUARTZ `#/workspace/item` hash contract resolve. `stock/…`, `deepdive/<symbol>`,
  `portfolio`, `ipo/…`, `event/…` are reserved and explicitly unsupported until the web
  application exposes an entity URL contract (it has none today — only `?tab=` and the hash).
- WHY: the OWNER's brief requires the web application to remain canonical; a wrapper is the
  lowest-complexity path that still gives a Home Screen icon, no browser chrome, persistent
  session, native loading/failure states and clean extension seams. Capacitor was not adopted:
  the repository has no bundler or plugin needs that would justify it.
- ALTERNATIVES: (a) PWA "Add to Home Screen" — already possible but gives no native seams
  (push, Face ID, deep links) and no install artefact; (b) Capacitor — rejected as above;
  (c) native rewrite — out of scope by the brief.
- CONSEQUENCES: `ios/` is generated from `project.yml` by XcodeGen and the `.xcodeproj` is
  committed; a `Development` configuration carries the only ATS exception (loopback/local
  network) in a separate Info.plist; the production plist has none. Web Push cannot work inside
  `WKWebView` (B-018), so SENTINEL/WORLDWIRE/ORACLE notifications will need a native push seam.
- AMENDMENT 2026-09-20 (Xcode phase): `com.marketterminal.app` is registered to another Apple
  team ("cannot be registered to your development team because it is not available"), so the
  tracked default bundle id is **`com.krishivjain.marketterminal`** (tests:
  `com.krishivjain.marketterminal.tests`). The Personal Team id lives only in the git-ignored
  `Config/Local.xcconfig`.
- STATUS: ACCEPTED (engineering default under the POCKET authorization; OWNER may override the
  bundle id via `Config/Local.xcconfig`).

## D-009 · 2026-09-20 · MT2-3 · Market identity architecture (US / India)
- DECISION: one canonical market core (`shared/market-core.js`, schema `2026-09-20a`) shared by
  Express, the Worker and the browser (via `/api/market`). A market is `{ id, currency, locale,
  timezone, exchanges, defaultExchange, session, calendar, tape, benchmarks, sentimentBenchmarks,
  quantBenchmark, indexSymbols, providerSuffix, sentimentFeeds }`. An instrument identity is
  `{ market, exchange, symbol, kind, canonical: 'MKT:EXCH:SYMBOL', currency, provider: { yahoo,
  finnhub, nasdaq } }`; provider suffixes (`.NS`, `.BO`) exist only in `provider.*`, never in
  `symbol`/`canonical`. US uses the consolidated-tape marker `US` as its exchange segment
  (`US:US:AAPL`) because listing venue is only known after a profile loads; India defaults to NSE
  (`IN:NSE:RELIANCE`, `IN:BSE:…` when `.BO`/`BSE:` is given).
- DATA TRUTH: `REALTIME | DELAYED | SNAPSHOT | EOD | CACHED | LAST_GOOD | UNAVAILABLE` with fixed
  precedence; the provider capability matrix gives the ceiling per provider × market and runtime
  state only downgrades. Verified matrix: Finnhub = US quotes/stream/profile/metrics/news + global
  search; Yahoo (keyless) = DELAYED quotes/charts for both markets incl. ^NSEI/^BSESN/^NSEBANK/
  ^INDIAVIX; Nasdaq = US charts/options only; keyed fallbacks = US only as configured.
- CACHE IDENTITY: every quote/chart/ticker/sentiment/deep-dive key carries the market
  (`quote:IN:NSE:RELIANCE`, `chart:IN:BSE:TCS:1D`, `ticker:<schema>:IN`, `sentiment:market:IN`,
  `deepdive:…:IN:<q>`); `cacheKey()` throws on a market-less identity.
- API CONTRACT: `?market=US|IN` on quote/chart/search/ticker/profile/metrics/news/sentiment/
  deepdive; omitted → US (backward compatible); a suffixed symbol infers its market. New
  `/api/market` (catalog + live session state + matrix). Capabilities a market lacks return
  `200 { unavailable: true, truth: 'UNAVAILABLE', reason }` instead of a provider error.
- CALENDARS: embedded NYSE 2025–2027 (moved from app.js) and NSE 2026 weekday holidays; the
  NSE list is marked "verify against the current NSE circular" in the payload (B-024).
- WHY: the brief's invariants (no SPY under India, INR never as USD, no NYSE holidays for NSE,
  no market-less cache keys, no suffix leakage, no delayed-as-realtime) are only enforceable
  from one shared definition with negative-control tests, not from per-runtime strings.
- ALTERNATIVES: (a) suffix-only routing (`RELIANCE.NS` everywhere) — rejected: leaks provider
  spelling into identity and cache keys; (b) per-market frontend forks — rejected: QUARTZ is one
  shell; (c) an India-specific provider (NSE site API) — rejected: undocumented, cookie-gated,
  unverified; Yahoo from Cloudflare is the only empirically working keyless source today.
- CONSEQUENCES: Deep Dive schema `2026-09-20a` carries a measured `market` block; the renderer
  and dossier summary format prices with the market's currency symbol; the terminal quant panel's
  beta benchmark is per market; the live trade stream is US-only (Finnhub cannot carry NSE/BSE).
- STATUS: ACCEPTED

## D-010 · 2026-09-21 · MT2-4 · ATLAS datasets, licences, and retirement of unsourced geometry
- DECISION: ATLAS serves only geospatial objects that carry a source URL or an established public
  dataset id, from licences compatible with this project (MIT-licensed code, personal/educational
  deployment):
  - **Wikidata** (CC0 1.0) — listed companies via P414 (exchange) + P249 (ticker) + P159 (HQ) +
    P625 (coordinates) for NSE `Q638740`, BSE `Q638398`, NYSE `Q13677`, Nasdaq `Q82059`; and
    verification of the pre-ATLAS curated reference points by label lookup + P625 (HIGH when the
    curated point is within 50 km of the Wikidata coordinate, otherwise UNVERIFIED and hidden).
  - **Natural Earth 10m** ports and airports (public domain; "Made with Natural Earth").
  - **WRI Global Power Plant Database v1.3** (CC BY 4.0; attribution string carried in the
    payload) — all nuclear plants and every plant ≥ 1,000 MW.
  - **Live events** via the existing proxied public feeds (USGS, NASA EONET, NWS, GDELT/ACLED
    report clusters) normalised into GeoEvent with per-category freshness windows.
- RETIRED (not served any more, both runtimes): the hand-drawn "-ish" undersea-cable, pipeline
  and trade-route polylines (`LINES` in mapintel.js / `MAP_LAYERS_BASELINE.lines`), the
  "Infrastructure" canvas engine's data route, and the Worker's live **TeleGeography** cable
  ingestion — TeleGeography's submarine-cable data is CC BY-NC-SA 3.0 (non-commercial,
  share-alike), which this project does not adopt. Legacy curated point layers that ATLAS now
  covers with verified sources (exchanges, chokepoints, nuclear, spaceports, central banks,
  commodity ports, data-centre hubs) are removed from the legacy overlay panel; the remaining
  curated overlays stay labelled LEGACY / CURATED and off by default (B-028).
- NOT INGESTED (recorded, not silently skipped): Global Energy Monitor trackers (CC BY 4.0 but
  gated behind a data-request form), OSM/Overpass submarine cables (ODbL — compatible, deferred:
  heavy extraction), any semiconductor-fab or refinery facility list (no verified open source
  found). The corresponding layers exist in the registry with `renders: false` and a coverage
  note, so NEXUS can fill them without a redesign.
- WHY: the audit found the map's inaccuracies were structural — coordinates typed from memory
  with no provenance, invented route geometry, two competing engines and two copies of the same
  datasets. Sourcing at the object level (evidence bands, lastVerified) is the only way the
  accuracy contract ("all displayed data is sourced; nothing fabricated") can be true.
- CONSEQUENCES: `shared/atlas-snapshot.js` is generated by `tools/atlas-build-snapshot.js` and
  committed (Wikidata queries take ~35 s each — not a request-path fetch); coverage is measured
  per market in `/api/map/atlas` and never claimed complete; the Worker bundle grows by the
  snapshot size.
- STATUS: ACCEPTED

## D-011 · 2026-09-23 · MT2-5A CENSUS · Company/ListedSecurity identity model, field-mapping bug fixes, exchange taxonomy
- DECISION: NEXUS's existing canonical `MARKET:EXCHANGE:SYMBOL` id (established in MT2-5, and
  load-bearing across server.js/worker.js routes, 76 relationship edges, and ATLAS's
  `openSecurity()` drill-through) is kept **unchanged** and is now documented as the
  **ListedSecurity** layer — one row per exchange listing. A new, additive **Company** layer sits
  above it: `shared/nexus-core.js` `buildCompanyIndex()` groups ListedSecurity rows by the one
  identifier each regulator actually publishes for this purpose — **CIK** (SEC EDGAR filer id)
  for US, **ISIN** for India — into a canonical `Company` (`company:us:cik:<CIK>` /
  `company:in:isin:<ISIN>`). A row with neither (should not occur for a real SEC/NSE/BSE record)
  becomes its own singleton Company keyed by its own security id, so every security resolves to
  exactly one Company by construction — 100% company-identity coverage without a special case.
- THREE FIELD-MAPPING BUGS FOUND AND FIXED (verified live 2026-09-23), all pre-dating CENSUS:
  1. **BSE returned zero nodes.** `tools/nexus-build-registry.js` read `r.scrip_cd`/`r.scrip_name`
     (lowercase); BSE's live API returns `SCRIP_CD`/`Issuer_Name`/`ISIN_NUMBER`. Every row
     silently failed the `.filter()`. The prior checkpoint's own record ("BSE contributed zero
     nodes — its listing API 403'd") was itself wrong: a direct test showed BSE returns 200 with
     the SEC-mandated identifying `User-Agent` header — the 403 was BSE rejecting that specific
     UA string, not a network/build-environment block; a plain browser UA succeeds. Separately,
     BSE's response intermittently trips Node's strict HTTP header parser
     (`HPE_INVALID_HEADER_TOKEN`, "whitespace after header value") — worked around with
     `insecureHTTPParser: true` on this one call only (TLS validation unaffected).
  2. **NSE cross-listing could never be identified.** `fetchNseIssuers()` read `r.ISIN`; the real
     EQUITY_L.csv column is `ISIN NUMBER`. Every NSE row silently carried an empty ISIN, so
     `buildCompanyIndex()` (or any future equivalent) could never match an NSE listing to its BSE
     counterpart — the exact capability CENSUS exists to deliver was structurally impossible
     before this fix. Confirmed by RELIANCE: 0 cross-listed → correctly merged with `IN:BSE:500325`
     under one Company after the fix; cross-listed-Company count went from 1,448 (US CIK
     dual-class pairs only) to 3,903 once real NSE+BSE ISIN matches were possible.
  3. **~2,579 US securities were mislabeled under a fake "US" exchange.** SEC's raw `exchange`
     field distinguishes Nasdaq/NYSE/**OTC**/**CBOE**/null (verified: 4,360/3,301/2,535/44/219 of
     10,459 rows); the generator's `SEC_EXCHANGE_MAP` only recognized Nasdaq/NYSE and silently
     folded OTC and CBOE into `market-core.js`'s `defaultExchange` fallback (`'US'`, the
     consolidated-tape marker) — collapsing two real, known exchanges into the same bucket used
     for genuinely unclassified issuers. Fixed at both ends: `SEC_EXCHANGE_MAP` now maps OTC and
     CBOE to themselves, and `MARKETS.US.exchanges` in `shared/market-core.js` was extended from
     `['NYSE','NASDAQ']` to `['NYSE','NASDAQ','OTC','CBOE']` (additive; no test asserted the old
     exact list; `parseInstrument()`'s canonical-form branch would otherwise silently coerce any
     `US:OTC:*`/`US:CBOE:*` id back to the fallback marker regardless of what the generator sent
     it). Only the 219 rows SEC itself leaves unclassified still use the fallback — an honest
     "unknown", not a mislabel.
- ACCOUNTING: `nexusCore.reconcileAccounting()` requires, per source, `fetched === accepted +
  duplicate + rejected`; the build script throws if any source fails to reconcile. Every existing
  relationship edge is re-validated against the rebuilt security-id set after the identity
  rebuild (an edge whose endpoint id changed classification, e.g. a former `US:US:*` fallback id
  now correctly `US:OTC:*`, would otherwise dangle) — 2 of 78 were orphaned by the exchange
  reclassification and dropped, never left as a silent dangling reference. This does **not**
  re-run or expand tier-1/tier-3 relationship discovery (out of scope per the OWNER brief:
  "UNKNOWN relationships remain UNKNOWN") — it only guarantees the *existing* edges still point
  at real nodes.
- WHY NOT rename ListedSecurity.id: a canonical-id rename would break 76 live relationship edges,
  every route contract, `public/nexus.js`, and the NEXUS↔ATLAS drill-through link
  (`geoEntityId`/`openSecurity`) for no completeness gain — the identity gap CENSUS closes is
  "which Company does this security belong to", not "what is this security called".
- CONSEQUENCES: `shared/nexus-snapshot.js` schema `2026-09-23a`; 18,087 securities (US 10,459 /
  IN 7,628: NSE 2,583 + BSE 5,045), 13,219 companies (3,903 cross-listed), coverage/accounting
  exposed via `/api/nexus/registry`, sibling listings exposed via `/api/nexus/company`'s new
  `companyIdentity` field and rendered in `public/nexus.js` ("Also listed as …").
- STATUS: ACCEPTED

## D-012 · MT2-6 LAUNCHPAD source and impact authority (2026-09-23)
US IPO events come from the Finnhub IPO calendar through the existing configured key, cached for 15 minutes and labelled as source snapshots. India has no verified calendar adapter; the API returns explicit `UNAVAILABLE`. The impact graph records only same-venue events within seven calendar days and NEXUS edges with source URLs for provisionally ticker/venue-matched securities. These edges are observations, not forecasts or causal price-impact claims. No MT2-7 event collection is included.

## D-013 · MT2-6A PADLOCK India regulatory source and safe snapshot (2026-09-23)
SEBI's current public-issues listing families 10 (draft), 11 (red herring), 12 (final), and 78 (other) are the authoritative metadata source. The adapter validates the current `sample_1` date/title table, nonzero counts, official detail-page URLs and full row accounting before atomically replacing `shared/launchpad-snapshot.js`. Previous valid records and timelines are retained across refreshes. Family 78 rows without an IPO document type are counted as EXCLUDED instead of claimed as IPOs. Factual names, filing dates, document states and direct links are retained; prospectus text/PDFs are not mirrored. SEBI's website policy permits direct links, while reuse of site material requires permission: https://www.sebi.gov.in/website-policy.html. NSE/BSE were investigated for listing confirmation, but no exchange bulk-data adapter is enabled pending data-sharing/usage review. Official exchange URL plus ISIN can resolve a supplied listing into one CENSUS Company and ATLAS geography; without such evidence listing dates, offer fields, NEXUS links and geography remain UNKNOWN. This checkpoint does not authorize MT2-7.

D-013 STATUS: ACCEPTED after production verification of source commit `7b1fd07` (2026-09-23). SEBI listing metadata is the bounded primary source; exchange bulk-feed onboarding remains a separate usage decision.

## D-014 · MT2-7 WORLDWIRE event and storage authority (2026-09-23)
Use the existing hourly Cloudflare Worker Cron and MT_KV binding. One bounded state value holds at most 600 hot event clusters and 400 metadata-only material warm records for 90 days; one batched KV write per run. No D1, paid feature, or paid source. Shared `worldwire-core` and `worldwire-runtime` define SourceSignal, WorldEvent, clustering, source adapters, health and API responses for Express and Worker. Source signals are attributed discoveries, not independently proven facts; official USGS, NASA EONET and US-only NWS supply structured events. GDELT is a broad article-discovery adapter and must remain health-labelled when unavailable. ACLED stays explicitly disabled pending owner licensing authorization. Scores describe observed scale/connectivity/recency without predicting returns. ARTICLE full text is not retained. ATLAS receives only source-provided coordinates; NEXUS and LAUNCHPAD links require canonical evidence. ORACLE and SENTINEL remain unimplemented.

D-014 STATUS: IMPLEMENTED LOCALLY; production acceptance pending.
