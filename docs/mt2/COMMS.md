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
TIMESTAMP: 2026-09-20T05:20Z
FROM: CLAUDE
TO: OWNER
CHECKPOINT: MT2-1 REWIND
MESSAGE TYPE: PROGRESS — LOCAL PASS, DEPLOYING
SUMMARY: 42af0f6 report hierarchy restored via a pure, unit-tested renderer (public/deepdive.js);
  fallback under B-002 is now the same report skeleton with an honest NOT RATED / CHAIN ONLY
  presentation and sources moved below the report. No backend/shared-core change; evidence gate,
  provider safety, merge authority, URL sanitation preserved. Unit 67/67 · smoke 34/34 · ai-eval
  pass · local desktop/mobile browser pass. Assets → 20260920c.
DECISION / REQUEST: none required. Analysis-available state is verified through the real render
  path with a simulated payload only — B-002 still prevents live generation everywhere.
EVIDENCE POINTER: EVIDENCE.md "MT2-1 REWIND"; DECISIONS D-003; BACKLOG B-013.
ACTION REQUIRED: none — proceeding to push, test:prod, production browser acceptance.
---
TIMESTAMP: 2026-09-20T05:50Z
FROM: CLAUDE
TO: OWNER
CHECKPOINT: MT2-1 REWIND
MESSAGE TYPE: CHECKPOINT CLOSURE — PASS
SUMMARY: Commit f4a162a pushed (70bc973..f4a162a); production serves 20260920c (closure bumps to
  20260920d); test:prod 36/36; production Deep Dive AAPL renders the restored 42af0f6 report
  hierarchy in its truthful B-002 fallback state (NOT RATED / CHAIN ONLY with measured Nasdaq
  rows, sources below the report), mobile reflow clean, all tabs load, console clean. Backend,
  shared core, evidence gates, provider safety, and secrets untouched.
DECISION / REQUEST: none. Generated-analysis production acceptance is not claimed (B-002).
  Adding heavy-provider secrets would light up the analysis state with no further code change.
EVIDENCE POINTER: EVIDENCE.md "MT2-1 REWIND" + "Production acceptance"; DECISIONS D-003;
  BACKLOG B-013.
ACTION REQUIRED: OWNER — authorize MT2-2 QUARTZ when ready. STOP.
---
TIMESTAMP: 2026-09-20T10:25Z
FROM: CLAUDE
TO: OWNER
CHECKPOINT: MT2-2 QUARTZ
MESSAGE TYPE: CHECKPOINT CLOSURE — PASS
SUMMARY: Commit b46bbb2 pushed (6ffb81c..b46bbb2); production serves 20260920e (closure bumps to
  20260920f); test:prod 36/36. New design system (ten-layer tokenised CSS, system UI + mono data
  type, restrained accent), application chrome with market mode (US active, India reserved and
  inert), global command bar, eight-workspace navigation with contextual subnav (Portfolio
  reserved/disabled), MARKETS shell on the existing pooled quote route, Terminal security band
  with chart priority, Quant Lab as its own workspace, standardised freshness/status/
  interpretation registers, keyboard roving tabs + `/` shortcut, mobile without overflow. Deep
  Dive renderer untouched and its REWIND order verified in production. Backend, shared core,
  evidence gates, provider safety, secrets untouched; no India data, no Portfolio logic, no
  watcher logic.
DECISION / REQUEST: none. B-002 still bounds AI acceptance; B-003 (aircraft CORS) is the only
  production console noise and predates QUARTZ. Physical-keyboard Enter/`/` remain HUMAN checks.
EVIDENCE POINTER: EVIDENCE.md "MT2-2 QUARTZ" + "Production acceptance"; DECISIONS D-004…D-006;
  BACKLOG B-014, B-015.
ACTION REQUIRED: OWNER — authorize MT2-3 TWINCORE when ready. STOP.
---
TIMESTAMP: 2026-09-20T06:30Z
FROM: CLAUDE
TO: OWNER
CHECKPOINT: MT2-1A REWIND RECONCILIATION
MESSAGE TYPE: CHECKPOINT CLOSURE — PASS (CASE A)
SUMMARY: Full-history search (80 commits, all refs) finds no "Deep Research" tab, route, file,
  prompt, or commit — ever. The only per-stock analyst surface is DEEP DIVE (`analyze`,
  `/api/intel/deepdive`), unrenamed since 42af0f6; the OWNER's own master prompt titles it
  "Deep Dive" (§8.4). MT2-1 restored the surface the OWNER meant; it remains PASS. Deep Dive is
  intact after QUARTZ in repo and production. Baseline drift noted: HEAD was 30bb5eb (QUARTZ
  closed in another session), not 6ffb81c; nothing reset or touched.
DECISION / REQUEST: D-007 records the identity permanently; D-001's "AI RESEARCH" label for the
  6fafe78 chat panel corrected to "ASK AI / AI ANALYST".
EVIDENCE POINTER: EVIDENCE.md "MT2-1A"; DECISIONS D-007.
ACTION REQUIRED: none. Owner requirement satisfied; next checkpoint awaits authorization.
---
---
TIMESTAMP: 2026-09-20T08:25Z
FROM: CLAUDE
TO: OWNER
CHECKPOINT: POCKET (side-track — iPhone delivery; main roadmap numbering untouched)
MESSAGE TYPE: HUMAN ACTION REQUIRED (state preserved; resume this same checkpoint)
SUMMARY: Native shell implemented end-to-end under ios/ (SwiftUI + WKWebView, production URL
  centralized in Config/Base.xcconfig, persistent store, navigation policy, SFSafariViewController
  for external sources, loading/retry states, marketterminal:// seam, XCTest suite, README,
  ignore rules). Pure logic compiled+executed 28/28 on macOS; web suites 75/75 + ai-eval green;
  production audited at iPhone portrait/landscape in the browser (no overflow). The environment
  cannot go further: this Mac has no Xcode (App Store Xcode 27 needs macOS 26.6; the Mac is on
  26.5.2), zero signing identities, and no iPhone is connected. Committed locally; NOT pushed
  (delivery is not verified on a device, and a push deploys production).
DECISION / REQUEST: OWNER actions, in order — (1) install macOS 26.7 (Software Update; admin
  password + restart) then Xcode from the App Store, or install Xcode 26.x from
  developer.apple.com; (2) open Xcode once, sign in with your Apple ID (Settings ▸ Accounts);
  (3) plug the iPhone in, unlock it, tap Trust, enable Developer Mode. Then say "continue
  POCKET" and this checkpoint resumes at BUILD → SIGN → INSTALL → LAUNCH → device acceptance.
EVIDENCE POINTER: EVIDENCE.md "POCKET"; DECISIONS.md D-008; BACKLOG.md B-016…B-020; ios/README.md.
ACTION REQUIRED: OWNER — steps (1)–(3). No other engineering is pending.
---
TIMESTAMP: 2026-09-20T09:50Z
FROM: CLAUDE
TO: OWNER
CHECKPOINT: POCKET (side-track) — Xcode/device phase
MESSAGE TYPE: STATUS — READY FOR DEVICE INSTALL reached and exceeded (installed + launched); NOT PUSHED
SUMMARY: With Xcode 26.6 + your Apple ID + Developer Mode in place: signed Debug build for the
  iPhone 17 Pro succeeded (team S9HRQZG54C, bundle id changed to com.krishivjain.marketterminal
  because com.marketterminal.app belongs to another team); devicectl installed it (device lists
  Market Terminal 1.0.0); after you trusted the profile it launched (pid alive, no crash logs);
  terminate → relaunch produced a fresh process with no crash. XCTest 17/17 on simulator; web
  75/75 + ai-eval green. Two build-config defects fixed (module-name leak; iCloud xattrs on
  in-repo build products → build into ~/Library). Committed locally per your "do not push" rule.
DECISION / REQUEST: (1) run the visual 28-point checklist on the phone and report failures, if
  any — that is the remaining REAL DEVICE TESTED / OWNER ACCEPTED evidence; (2) say "push POCKET"
  when you want main pushed (no web asset changed → no ?v= bump; test:prod afterwards).
EVIDENCE POINTER: EVIDENCE.md "POCKET continuation"; BACKLOG B-020 closed, B-021/B-022 new;
  DECISIONS D-008 amendment; ios/README.md.
ACTION REQUIRED: OWNER — (1) and (2) above. Phone may stay disconnected.
---
TIMESTAMP: 2026-09-20T10:32Z
FROM: OWNER
TO: CLAUDE
CHECKPOINT: POCKET
MESSAGE TYPE: OWNER ACCEPTANCE — PASS + CLOSURE AUTHORIZATION
SUMMARY: Real-device acceptance on the iPhone 17 Pro: PASS. Close POCKET: record OWNER ACCEPTED,
  final secrets/diff/Git check, closure commit, push per repository policy, verify production
  health, STOP. No further Meridian phase.
ACTION REQUIRED: CLAUDE — execute closure.
---
TIMESTAMP: 2026-09-20T10:40Z
FROM: CLAUDE
TO: OWNER
CHECKPOINT: POCKET
MESSAGE TYPE: CHECKPOINT CLOSURE — PASS
SUMMARY: Pushed bd51724..dc5020c to main (2eb8a84 shell, 3d100fe device phase, dc5020c closure).
  Production after deploy: GET / 200 (0.39 s), nine `?v=20260920g` assets unchanged (no web asset
  touched), `npm run test:prod` 36/36. Evidence ladder for POCKET: IMPLEMENTED → UNIT TESTED
  (XCTest 17/17, macOS pure 28/28) → IOS BUILD TESTED → SIGNED → DEVICE INSTALLED → DEVICE
  LAUNCHED → RESTART VERIFIED → REAL DEVICE TESTED / OWNER ACCEPTED (OWNER). Owner files
  preserved; Local.xcconfig and xcuserdata ignored; no secrets committed.
DECISION / REQUEST: none. POCKET closed. No Meridian phase started.
EVIDENCE POINTER: EVIDENCE.md "POCKET closure"; STATE.md PASS capsule.
ACTION REQUIRED: none.
