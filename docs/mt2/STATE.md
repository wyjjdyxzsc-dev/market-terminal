# Project Meridian — STATE (recovery capsule)

PROJECT: Market Terminal 2.0 — Project Meridian
CHECKPOINT: MT2-1 REWIND
STATUS: PASS (closed 2026-09-20; B-002 remains a bounded open item — the fallback state is the
  production-visible Deep Dive state until heavy-provider secrets exist)
ROUTE: claude-opus-5 / effort medium / SERIAL / bypass-permissions — verified from the live
  session; change required: NO.
GIT: branch main, HEAD = closure commit on top of f4a162a (REWIND code + seam). Tracked tree
  clean. Frontend assets 20260920d (REWIND deployment was 20260920c).
  Untracked owner files preserved, untouched: MARKET_TERMINAL_TOTAL_PLATFORM_CODEX_MASTER_PROMPT.md,
  MARKET_TERMINAL_TOTAL_PLATFORM_CODEX_MASTER_PROMPT.txt, worker-startup.cpuprofile.
OBJECTIVE: restore the 42af0f6 (+6fafe78 levels) Deep Dive analyst-report experience on top of
  the current dossier/evidence/provider-safety infrastructure. Achieved with no backend change.
DONE: baseline; fresh routing; phase identity; git inspection; narrow audit; restoration
  matrix; public/deepdive.js renderer + 5 tests; intel.js mount/status/focus-exemption/Quant Lab
  guard; CSS; index.html; smoke shell contract 8; CLAUDE.md; unit 67/67 · smoke 34/34 · ai-eval
  pass · dry-run; local browser pass; commit f4a162a; push; production 20260920c; test:prod
  36/36; production browser pass (desktop AAPL/NVDA fallback, mobile, all tabs, clean console).
DECISIONS: D-001 applied; D-003 ACCEPTED.
EVIDENCE: docs/mt2/EVIDENCE.md "MT2-1 REWIND" (+ "Production acceptance").
FAILED APPROACHES: none material. Lesson: unchanged ?v= served a cached bundle to the browser
  pane mid-verification — bump before browser-verifying frontend edits.
OPEN: B-001 (iCloud repo, owner action); B-002 (heavy provider secrets/policy, owner action);
  B-010 (AGENTS.md drift, CLAUDE.md done); B-012 (physical Enter, human check); B-013 (focus
  double-refresh on other intel views); B-003…B-009, B-011 as recorded.
BLOCKERS: none for MT2-1. MT2-2 QUARTZ requires explicit OWNER authorization.
RUNNING PROCESSES: none (local preview server stopped at closure).
NEXT EXACT ACTION: await OWNER authorization for MT2-2 QUARTZ. If B-002 secrets are added first,
  re-run the production Deep Dive AAPL probe and record the first LIVE TESTED analysis state in
  EVIDENCE.md without code changes (the analysis render path is already deployed and tested).
