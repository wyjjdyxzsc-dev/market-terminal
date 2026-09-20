# Project Meridian — STATE (recovery capsule)

PROJECT: Market Terminal 2.0 — Project Meridian
CHECKPOINT: POCKET — iPhone delivery (SIDE-TRACK; does not renumber MT2-3…; MT2-1A remains the
  last main-roadmap checkpoint, PASS)
STATUS: READY FOR DEVICE INSTALL — exceeded: DEVICE INSTALLED + DEVICE LAUNCHED + RESTART VERIFIED
  (process level) on the OWNER's iPhone 17 Pro (2026-09-20T09:50Z). NOT PUSHED (OWNER rule).
  Remaining: OWNER visual acceptance on the phone (REAL DEVICE TESTED / OWNER ACCEPTED), then
  "push POCKET" → push main → test:prod → closure.
PREVIOUS: MT2-1A REWIND RECONCILIATION — PASS (D-007); MT2-2 QUARTZ — PASS; B-002 still open.
ROUTE: claude-opus-5 / bypass-permissions / SERIAL — verified from the live session.
GIT: branch main; start HEAD bd51724; POCKET commits 2eb8a84 (shell) + Xcode-phase commit
  (bundle id, module-name fix, README, seam). ios/, .gitignore, docs/mt2 only — no web asset, no
  `?v=` bump, no backend change. NOT PUSHED. Untracked owner files preserved,
  untouched: MARKET_TERMINAL_TOTAL_PLATFORM_CODEX_MASTER_PROMPT.md/.txt, worker-startup.cpuprofile.
OBJECTIVE: Mac → native Market Terminal iOS app (WKWebView shell around production) → signed
  → installed on the OWNER's iPhone → physical-device acceptance.
DONE: ground truth; ios/ project (XcodeGen spec + committed .xcodeproj; app + XCTest targets;
  Debug/Release=production, Development=local with scoped ATS plist); AppConfig (https-only,
  no URL literals in Swift); NavigationPolicy; DeepLinkRouter (workspace routes only; entity
  routes reserved); TerminalSession (persistent WKWebsiteDataStore, delegates, MIME gate,
  process-termination reload, foreground retry); ContentView + QUARTZ-styled loading/failure
  states; SFSafariViewController reader; vector brand-mark icon (1024, opaque); README;
  .gitignore; D-008; B-016…B-020; EVIDENCE "POCKET"; pure-logic 28/28 on macOS; web 75/75 +
  ai-eval; production iPhone-dimension browser audit (portrait + landscape, no overflow).
EVIDENCE LEVEL REACHED: IMPLEMENTED · UNIT TESTED (XCTest 17/17 on simulator; macOS pure 28/28)
  · IOS BUILD TESTED (arm64 iphoneos26.5) · SIGNED (Apple Development, team S9HRQZG54C) ·
  DEVICE INSTALLED (devicectl lists com.krishivjain.marketterminal 1.0.0) · DEVICE LAUNCHED
  (process alive, no crash logs) · RESTART VERIFIED (terminate → relaunch, new pid, no crash) ·
  REAL BROWSER TESTED (production at iPhone sizes). NOT reached: REAL DEVICE TESTED (visual
  28-point checklist — OWNER has the phone), OWNER ACCEPTED.
ENVIRONMENT NOW: Xcode 26.6 (17F113) selected; iOS 26.5 SDK + simulator runtime; Apple ID with
  Personal Team S9HRQZG54C (pinned in git-ignored ios/Config/Local.xcconfig); iPhone 17 Pro
  iOS 27.0 UDID 00008150-000A6C923CC0401C, paired, Developer Mode on, profile trusted.
  Build ONLY into ~/Library/Developer/Xcode/DerivedData (B-021; in-repo paths break codesign).
BLOCKERS: none engineering. Visual acceptance requires the OWNER's eyes on the phone.
FAILED APPROACHES: `mas get 497799835` (needs sudo; 27.0 incompatible with 26.5.2). Bundle id
  com.marketterminal.app (owned by another team → com.krishivjain.marketterminal). In-repo
  DerivedData (iCloud xattrs → codesign failure; also swamped the 8 GB Mac). PRODUCT_MODULE_NAME
  in a project-level xcconfig (leaks into the test target). Xcode UI via computer-use for team
  selection (window on another Space, Claude full-screen) — team id read from
  com.apple.dt.Xcode.plist instead.
  xcconfig gotcha: `//` is a comment, so URLs are written `https:/$()/host` (Base.xcconfig).
  xcodegen sets INFOPLIST_FILE at target level (overrides xcconfig) → per-config settings in
  project.yml instead.
OPEN: B-001, B-002, B-003, B-004/B-013, B-010, B-012, B-014, B-015 (as before); B-016
  (landscape chrome), B-017 (server binds all interfaces), B-018 (no Web Push in WKWebView),
  B-019 (Face ID), B-021 (in-repo build output vs iCloud), B-022 (visual device acceptance /
  iOS 27 SDK). B-020 CLOSED.
RUNNING PROCESSES: none required (simulators shut down; Xcode GUI may be open on the project).
NEXT EXACT ACTION:
  1. OWNER runs the 28-point visual checklist on the phone (ios/README.md + POCKET brief) and
     reports; record the result in EVIDENCE.md as REAL DEVICE TESTED / HUMAN ACCEPTED or as
     wrapper defects (fix in place, rebuild into ~/Library DerivedData, reinstall via devicectl).
  2. On "push POCKET": git push origin main (no ?v= bump — public/ untouched); npm run test:prod;
     record in EVIDENCE/COMMS; STATE → PASS.
  Reinstall recipe (phone connected): see ios/README.md INSTALL; profile expires in 7 days.