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
- STATUS: ACCEPTED (engineering default under the POCKET authorization; OWNER may override the
  bundle id via `Config/Local.xcconfig`).
