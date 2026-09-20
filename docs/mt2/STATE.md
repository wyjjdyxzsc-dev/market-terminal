# Project Meridian — STATE (recovery capsule)

PROJECT: Market Terminal 2.0 — Project Meridian
CHECKPOINT: MT2-1 REWIND
STATUS: IN PROGRESS — local PASS, deploying to production (this commit); production
  acceptance and closure evidence follow in the next commit.
ROUTE: claude-opus-5 / effort medium / SERIAL / bypass-permissions — verified from the live
  session; change required: NO.
GIT: branch main, starting HEAD 70bc973 (clean). REWIND commit = this one. Frontend assets
  20260920c (production served 20260920b at authorization).
  Untracked owner files preserved, untouched: MARKET_TERMINAL_TOTAL_PLATFORM_CODEX_MASTER_PROMPT.md,
  MARKET_TERMINAL_TOTAL_PLATFORM_CODEX_MASTER_PROMPT.txt, worker-startup.cpuprofile.
OBJECTIVE: restore the 42af0f6 (+6fafe78 levels) Deep Dive analyst-report experience on top of
  the current dossier/evidence/provider-safety infrastructure. No backend change.
DONE: baseline; fresh routing; phase identity; git inspection of 42af0f6/6fafe78/1bf0c64;
  narrow audit; restoration matrix; public/deepdive.js renderer + tests (5); intel.js mount,
  status clearing, focus-refresh exemption, Quant Lab race guard; CSS; index.html copy + eight
  ?v= refs → 20260920c; smoke shell contract → 8; CLAUDE.md entry; unit 67/67 · smoke 34/34 ·
  ai-eval pass · wrangler dry-run; local browser pass (desktop fallback + simulated analysis
  state, mobile, reload, click-through, refresh model).
DECISIONS: D-001 (target) applied; D-003 ACCEPTED (pure renderer, focus exemption, truthful
  fallback labels).
EVIDENCE: docs/mt2/EVIDENCE.md "MT2-1 REWIND".
FAILED APPROACHES: none material. Note: unchanged ?v= let the browser pane run a cached
  intel.js during verification — bump before browser-verifying frontend edits.
OPEN: B-002 unchanged (fallback state is the production-visible state; no secrets added, no
  gate weakened). B-013 new (focus double-refresh on other intel views). B-010 partially
  addressed (CLAUDE.md only).
BLOCKERS: none.
RUNNING PROCESSES: local preview server on :3000 (stop at closure).
NEXT EXACT ACTION: `git push origin main` (normal push) → wait for the Cloudflare build to serve
  20260920c → `npm run test:prod` → production Deep Dive browser pass (desktop + mobile, AAPL,
  fallback truthfulness, sources, console, other tabs) → closure commit updating STATE/COMMS/
  EVIDENCE/ROADMAP → STOP. MT2-2 QUARTZ is NOT authorized.
