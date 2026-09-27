# Project Meridian — STATE (recovery capsule)

## Current checkpoint — MT2-7 WORLDWIRE (2026-09-27)
STATUS: PARTIAL — production implementation deployed, checkpoint PASS withheld. OWNER authorized MT2-7 only. Start HEAD `5f0e14be86715f600e6576141ff8bd9514184300` matched `origin/main`, PADLOCK PASS and assets `20260923f`. WORLDWIRE now has shared SourceSignal/WorldEvent logic, four licensed-source adapters, 15-minute GDELT and hourly official-source Cron, batched bounded KV retention, eight bounded APIs, responsive Intelligence UI, and evidence-gated ATLAS/NEXUS/LAUNCHPAD seams. Production serves asset `20260927b`; 181/181 unit and 79/79 production smoke pass, and populated production browser works. A four-hour production ingest gap from 02:35 to 06:50 UTC was observed while Cron heartbeats continued; the 06:50 and 07:05 cycles succeeded, including all four sources HEALTHY at 07:05, but the earlier failure cause and sustained stability remain unverified. The actual Cloudflare plan/CPU entitlement cannot be read because dashboard sign-in and Wrangler authorization are unavailable, so billing-safe schedule fit cannot be asserted. B-040/B-041 hold the remaining acceptance work. Three unrelated owner untracked files remain untouched. MT2-8 ORACLE and MT2-12 SENTINEL are NOT AUTHORIZED.


PROJECT: Market Terminal 2.0 — Project Meridian
CHECKPOINT: MT2-6A PADLOCK — India IPO Feed Completion
STATUS: PASS — CLOSED 2026-09-23. MT2-6 LAUNCHPAD remains PASS. Source commit 7b1fd07 deployed; 72/72 production smoke and desktop/mobile browser pass with clean console. Closure assets 20260923f.
CURRENT: main baseline 0f573ea was verified against origin/main; 7b1fd07 is the PADLOCK implementation source. Validated SEBI public-issue listing metadata populates the canonical combined LAUNCHPAD snapshot: 100 fetched, 57 accepted current issuers, 18 duplicate/amendment, 25 excluded ambiguous Other Documents, zero unresolved/errors; 58 India registry objects including one preserved earlier filing. US live Finnhub route returns 33 records; ALL returns 91 snapshot records. India official filing URLs, dates, lifecycle/timeline, INR and explicit UNKNOWN offer/listing/impact fields are visible. The source-failure build preserves prior good bytes. Local 161/161 unit, AI fixtures, 67/67 local smoke, Wrangler dry-run passed; production 72/72 smoke, desktop and 375x812 / 430x932 / 812x375 browser checks passed. Three unrelated owner untracked files remain untouched.
HISTORICAL NEXT ACTION (superseded): MT2-6A was closed before OWNER authorized MT2-7; current MT2-7 status is above. B-037 remains open only for future exchange/offer enrichment.
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
