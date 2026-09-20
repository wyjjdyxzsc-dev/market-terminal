# Project Meridian — STATE (recovery capsule)

PROJECT: Market Terminal 2.0 — Project Meridian
CHECKPOINT: MT2-2 QUARTZ
STATUS: PASS (closed 2026-09-20; B-002 remains a bounded open item — high-risk AI surfaces still
  abstain in production, so their QUARTZ states are the truthful abstention/fallback states)
ROUTE: claude-opus-5 / effort not observable in-session (medium recorded) / SERIAL /
  bypass-permissions — verified from the live session; change required: NO.
GIT: branch main, HEAD = closure commit on top of b46bbb2 (QUARTZ code + seam). Tracked tree
  clean. Frontend assets 20260920f (QUARTZ deployment was 20260920e).
  Untracked owner files preserved, untouched: MARKET_TERMINAL_TOTAL_PLATFORM_CODEX_MASTER_PROMPT.md,
  MARKET_TERMINAL_TOTAL_PLATFORM_CODEX_MASTER_PROMPT.txt, worker-startup.cpuprofile.
OBJECTIVE: canonical MT2 design system + application shell + navigation architecture with enough
  existing UI migrated to prove it. Achieved with no backend/shared-core change.
DONE: baseline; fresh routing; phase identity; UI inventory; public/shell.js registry + 8 tests;
  index.html shell (chrome, market mode, command, nav, subnav, MARKETS, QUANT workspaces);
  style.css ten-layer token system with legacy aliases; app.js navigateTo/subnav/roving
  tabindex/`/`/hash + MARKETS loader; intel.js mt:gisub + Quant Lab workspace mount; smoke shell
  contract nine assets; CLAUDE.md + AGENTS.md banner; unit 75/75 · smoke 34/34 · ai-eval pass ·
  dry-run; local desktop/mobile browser pass; commit b46bbb2; push; production 20260920e;
  test:prod 36/36; production browser pass (desktop all workspaces, mobile four workspaces).
DECISIONS: D-004 (navigation + reserved surfaces), D-005 (market-mode placement, India inert),
  D-006 (tokens/typography, Quant workspace, sentiment → MARKETS) ACCEPTED.
EVIDENCE: docs/mt2/EVIDENCE.md "MT2-2 QUARTZ" (+ "Production acceptance").
FAILED APPROACHES: none material. Lessons: a container class named `.seg` collided with the
  legacy `.seg` buttons (renamed `.segmented`); `.table td { white-space: nowrap }` needs an
  opt-out for prose cells; the pane's synthetic Enter/`/` keys are unreliable — verify keyboard
  logic with dispatched KeyboardEvents and leave physical keys to HUMAN checks.
OPEN: B-001 (iCloud repo, owner action); B-002 (heavy provider secrets/policy, owner action);
  B-003 (aircraft layer CORS storm, visible in production console when Global Map is opened);
  B-004/B-013 (map timers, double focus refresh — not addressed in QUARTZ); B-010 (AGENTS.md
  banner only); B-012 (physical Enter, human check); B-014 (dead .gi-subtab binding);
  B-015 (local tile watermark); B-005…B-009, B-011 as recorded.
BLOCKERS: none for MT2-2. MT2-3 TWINCORE requires explicit OWNER authorization.
RUNNING PROCESSES: local preview server (port 3000) may still be running from the browser pane;
  safe to stop.
NEXT EXACT ACTION: await OWNER authorization for MT2-3 TWINCORE. TWINCORE entry requires a
  DECISIONS.md record on market identity (exchange, currency, calendar, symbol namespace); the
  shell already exposes `#marketMode` (shell.js MARKETS) and the MARKETS workspace as the
  insertion points. If B-002 secrets are added first, re-run the production Deep Dive AAPL probe
  and record the first LIVE TESTED analysis state without code changes.
