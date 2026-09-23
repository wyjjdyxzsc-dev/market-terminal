# Project Meridian — STATE (recovery capsule)

PROJECT: Market Terminal 2.0 — Project Meridian
CHECKPOINT: MT2-6A PADLOCK — India IPO Feed Completion
STATUS: IMPLEMENTED LOCALLY — production verification pending. MT2-6 LAUNCHPAD remains PASS.
CURRENT: main baseline 0f573ea (verified against origin/main). A validated SEBI public-issues metadata adapter builds one combined US+India LAUNCHPAD snapshot. Local source reconciliation: 100 fetched, 57 accepted current issuers, 18 duplicate/amendment rows, 25 excluded ambiguous Other Documents, zero unresolved/errors; 58 India registry objects including one prior historical record. Existing US live Finnhub route remains in place; source snapshot contains 33 US records. Unit, AI evaluation, local smoke and browser checks in progress. Owner untracked files preserved.
NEXT EXACT ACTION: finish local acceptance, deploy via GitHub main, verify Cloudflare runtime and browser, then close PADLOCK seam. MT2-7 WORLDWIRE remains NOT AUTHORIZED.
PREVIOUS: MT2-5 NEXUS — PASS (source commit `59a7bba`, closure commit `173a979`; production-
  verified per CLAUDE.md — this file's own STATE/COMMS/DECISIONS entries for NEXUS were never
  written at the time, only CLAUDE.md was updated; ROADMAP.md corrected retroactively this
  checkpoint). MT2-4 ATLAS — PASS.
CANONICAL LOCAL PATH: /Users/krishivjain/Developer/market-terminal (unchanged from MT2-4/MT2-5;
  non-iCloud). The Desktop iCloud copy remains frozen and untouched (B-001/B-023, owner action).
GIT: branch main; start HEAD 173a979 (verified = origin/main, no rollback); CENSUS commit(s) on
  top. Assets bumped 20260923a (eleven synchronized refs — nexus.js already present since NEXUS;
  no new asset file this checkpoint, only content changes to existing ones + the version bump
  itself). Untracked owner files preserved.
OBJECTIVE: hardening checkpoint (NOT a NEXUS rebuild) — complete US listed-security
  reconciliation, BSE onboarding, NSE/BSE cross-listing deduplication, Company vs ListedSecurity
  separation, 100% security-accounting coverage, 100% company-identity coverage, zero silent
  drops, zero unresolved records. UNKNOWN relationships stay UNKNOWN — no relationship-coverage
  expansion.
DONE: ground truth verified (no rollback); seam catch-up for NEXUS's un-recorded closure
  (ROADMAP.md); three field-mapping bugs found and fixed (BSE scrip_cd/scrip_name casing + UA
  403 + Node strict-header-parser trip; NSE `ISIN NUMBER` casing; SEC OTC/CBOE folded into the
  US fallback marker) — see D-011; shared/nexus-core.js buildCompanyIndex()/
  companyIdentityKey()/reconcileAccounting(); shared/market-core.js US exchanges extended with
  OTC/CBOE; tools/nexus-build-registry.js full per-source accounting + Company-layer build +
  relationship-orphan reconciliation; registry rebuilt (18,087 securities: US 10,459/IN 7,628 —
  NSE 2,583 + BSE 5,045 real onboarding; 13,219 companies, 3,903 cross-listed; 0 uncovered; 2 of
  78 relationships correctly dropped as orphaned by the exchange reclassification); server.js/
  worker.js companyIdentity + accounting response fields (additive, byte-identical parity);
  public/nexus.js "Also listed as" cross-listing UI; 10 new tests + a committed-snapshot
  integrity test; unit 151/151; ai-eval pass; local smoke 66/66; Wrangler dry-run 16.4 MB/1.41
  MB gzip; browser pass (India-mode RELIANCE → NSE+BSE cross-listing, bidirectional click-through,
  real tier-3 relationship, no console errors beyond expected local keyless skips).
OPEN: B-001/B-023 (owner: iCloud copy), B-002, B-004, B-016…B-019, B-021, B-022, B-024…B-033,
  new B-034 (pre-existing search-ranking ambiguity without market scope — not a CENSUS
  regression), B-035 (snapshot size growth to watch), B-036 (219 genuinely SEC-unclassified
  issuers — documented as expected, not a regression).
NEXT EXACT ACTION: none. MT2-5A is closed. MT2-6 LAUNCHPAD requires explicit OWNER
  authorization (entry: MT2-5A closed — satisfied). Owner-side: archive the frozen iCloud copy
  (B-001/B-023); optional review of B-034 (search-ranking market disambiguation, pre-existing,
  not a CENSUS regression).
