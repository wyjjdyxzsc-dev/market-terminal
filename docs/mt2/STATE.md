# Project Meridian — STATE (recovery capsule)

PROJECT: Market Terminal 2.0 — Project Meridian
CHECKPOINT: MT2-0 BLACKBOX
STATUS: PASS (closed 2026-09-20; B-001/B-002 remain bounded open items, not blockers)
ROUTE: claude-opus-5 / effort medium / SERIAL / bypass-permissions — change required: NO
GIT: branch main, HEAD = closure evidence commit on top of fa52e1a (pushed). Tracked tree clean.
  Frontend assets 20260920b (repair deployment was 20260920a).
  Untracked owner files preserved, untouched: MARKET_TERMINAL_TOTAL_PLATFORM_CODEX_MASTER_PROMPT.md,
  MARKET_TERMINAL_TOTAL_PLATFORM_CODEX_MASTER_PROMPT.txt, worker-startup.cpuprofile.
OBJECTIVE: audit, repair material baseline defects, durable seam, identify Deep Research origin.
DONE: repo baseline; routing gate; docs/mt2 seam; product audit; repairs R1–R4 (+R5 environment);
  local regression 62/62 · 34/34 · ai-eval pass; commit fa52e1a; push; Cloudflare deploy serving
  20260920a; test:prod 36/36; production probes; production browser pass (5 views, clean console).
DECISIONS: D-001 CONFIRMED by OWNER — MT2-1 restoration target is the original DEEP DIVE at
  42af0f6; 6fafe78 only for same-experience extensions (level chips); Investment Report is NOT
  the target; no invented "Deep Research" history. D-002 accepted (npm ci).
EVIDENCE: docs/mt2/EVIDENCE.md (MT2-0 + Closure sections).
FAILED APPROACHES: serial iCloud materialisation; brctl download; raising Groq max_tokens
  (8k TPM free tier).
OPEN: B-001 iCloud-synced repo (owner-authorized separate work); B-002 production heavy-provider
  capability (github fails instantly, cfai times out; no secrets added, safety not weakened);
  B-003…B-012 as recorded. ETF Nasdaq fallback branch unexercised in production (Yahoo healthy
  from Cloudflare egress).
BLOCKERS: none for MT2-0. MT2-1 requires explicit OWNER authorization.
RUNNING PROCESSES: none (local preview server stopped at closure).
NEXT EXACT ACTION: await OWNER authorization for MT2-1 REWIND. When authorized, start from
  `git show 42af0f6 -- public/intel.js public/index.html public/style.css worker.js server.js`
  and DECISIONS D-001; keep the 2026-07-16→2026-08-11 evidence/safety infrastructure.
