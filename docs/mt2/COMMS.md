# Project Meridian — COMMS (handoff seam)

Compact entries only. Record communication that materially helps another engineer or a future
session resume correctly. Not a command diary.

Actors: OWNER · CLAUDE · CODEX · HUMAN ACCEPTANCE

---
TIMESTAMP: 2026-09-20T03:40Z
FROM: CLAUDE
TO: OWNER
CHECKPOINT: MT2-0 BLACKBOX
MESSAGE TYPE: CHECKPOINT CLOSURE — PARTIAL / HUMAN ACTION REQUIRED
SUMMARY: Baseline established (main @1bf0c64, clean tracked tree, 3 untracked owner files
  preserved). Environment defect (iCloud-evicted repo) repaired for this session. docs/mt2 seam
  created. Four material defects repaired and verified locally: ETF chart fallback (Nasdaq
  assetclass), NWS weather `limit` param (was 502 in prod too), Groq gpt-oss reasoning-token
  overrun (briefing always degraded on the default speed provider), HTML entity decoding.
  Regression 62/62 unit · 34/34 smoke · ai-eval pass · Wrangler dry-run. Browser pass on local
  desktop + mobile. Production observed read-only: all high-risk AI surfaces abstain because the
  only configured heavy provider (`github`) fails instantly and `cfai` times out.
DECISION / REQUEST: (1) Confirm or correct D-001 — "Deep Research" does not exist by that name in
  git history; the proposed original is DEEP DIVE @42af0f6 (+6fafe78). (2) Approve committing the
  five-file repair diff; deploying it requires a `?v=20260920a` bump and `npm run test:prod`
  afterwards. (3) B-001: move the repo out of iCloud sync. (4) B-002: provide working heavy
  provider secrets in the Worker.
EVIDENCE POINTER: docs/mt2/EVIDENCE.md (MT2-0), docs/mt2/BACKLOG.md B-001…B-012.
ACTION REQUIRED: OWNER — decisions (1)–(4). No MT2-1 work started.
---
TIMESTAMP: 2026-09-20T04:20Z
FROM: OWNER
TO: CLAUDE
CHECKPOINT: MT2-0 BLACKBOX
MESSAGE TYPE: DECISION + CLOSURE AUTHORIZATION
SUMMARY: D-001 CONFIRMED (restoration target 42af0f6; 6fafe78 for same-experience extensions
  only; Investment Report not the target; no invented Deep Research history). Authorized bounded
  closure: diff review, local re-verification, version bump, seam update, scoped commit, normal
  push to main via canonical GitHub→Cloudflare path, test:prod, production browser acceptance.
  No MT2-1 work; no secrets; do not weaken safety for B-002; do not relocate repo for B-001.
DECISION / REQUEST: close BLACKBOX and STOP.
EVIDENCE POINTER: DECISIONS.md D-001.
ACTION REQUIRED: CLAUDE — execute closure.
---
TIMESTAMP: 2026-09-20T04:30Z
FROM: CLAUDE
TO: OWNER
CHECKPOINT: MT2-0 BLACKBOX
MESSAGE TYPE: CHECKPOINT CLOSURE — PASS
SUMMARY: Commit fa52e1a pushed (1bf0c64..fa52e1a). Production serves 20260920a; test:prod 36/36;
  weather repair live (71 points, was 502); NEWS fresh 12/0 degraded/0 raw entities; production
  browser pass on Terminal, Briefing, Deep Dive, Watchlist, Alerts with clean console. ETF Nasdaq
  fallback branch is deployed but unexercised in production (Yahoo healthy from Cloudflare).
  B-001 and B-002 remain bounded and documented; no safety weakened; no secrets added.
DECISION / REQUEST: none. MT2-1 REWIND awaits explicit authorization.
EVIDENCE POINTER: EVIDENCE.md "Closure" section.
ACTION REQUIRED: OWNER — authorize MT2-1 when ready.
---
