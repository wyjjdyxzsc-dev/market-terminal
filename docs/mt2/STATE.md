# Project Meridian — STATE (recovery capsule)

PROJECT: Market Terminal 2.0 — Project Meridian
CHECKPOINT: MT2-0 BLACKBOX
STATUS: PARTIAL — HUMAN ACTION REQUIRED (repairs verified locally but uncommitted; Deep Research
  identity needs OWNER confirmation, D-001; production keys/secrets, B-002)
ROUTE: claude-opus-5 / effort medium / SERIAL / bypass-permissions — change required: NO
GIT: branch main, HEAD 1bf0c64 (= origin/main at last fetch 2026-07-28), worktree main only.
  Modified (uncommitted, BLACKBOX repairs): server.js, worker.js, shared/ai-provider-registry.js,
  tests/ai-provider-registry.test.js, tests/smoke.js. New: docs/mt2/ (7 files).
  Untracked owner files preserved, untouched: MARKET_TERMINAL_TOTAL_PLATFORM_CODEX_MASTER_PROMPT.md,
  MARKET_TERMINAL_TOTAL_PLATFORM_CODEX_MASTER_PROMPT.txt, worker-startup.cpuprofile.
OBJECTIVE: audit, repair material baseline defects, durable seam, identify Deep Research origin.
DONE: repo baseline; routing gate; docs/mt2 seam (PROTOCOL, ROADMAP, STATE, COMMS, DECISIONS,
  EVIDENCE, BACKLOG); product audit (backend parity, AI authority, PWA, data truth, UX);
  4 code repairs (ETF chart fallback, NWS weather param, Groq reasoning overrun, HTML entities)
  + 1 environment repair (iCloud eviction); regression 62/62 unit, 34/34 smoke, ai-eval pass,
  Wrangler dry-run; local browser pass desktop + mobile; Deep Research history investigated.
DECISIONS: D-001 (PROPOSED) Deep Research = original DEEP DIVE @42af0f6/6fafe78; D-002 npm ci.
EVIDENCE: docs/mt2/EVIDENCE.md (MT2-0 section).
FAILED APPROACHES: serial per-file materialisation of evicted node_modules (stalled);
  `brctl download` (no visible progress). Raising Groq max_tokens instead of reasoning_effort
  (Groq free tier 8k TPM makes it non-viable).
OPEN: OWNER confirm D-001; OWNER decide commit of BLACKBOX repairs; production deploy of R1–R4
  (needs `?v=` bump + `npm run test:prod` after push); B-001 iCloud relocation; B-002 secrets.
BLOCKERS: none for closing BLACKBOX as PARTIAL. MT2-1 entry blocked on D-001 confirmation.
RUNNING PROCESSES: none (local preview server stopped at closure).
NEXT EXACT ACTION: OWNER reviews `git diff` (5 files) + docs/mt2; if accepted: commit on main,
  bump all seven `?v=` refs in public/index.html to `20260920a`, push origin main, then run
  `npm run test:prod` and record the result in EVIDENCE.md. Then confirm/deny D-001 before any
  MT2-1 authorization.
