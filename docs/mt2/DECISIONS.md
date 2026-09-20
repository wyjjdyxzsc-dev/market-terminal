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
