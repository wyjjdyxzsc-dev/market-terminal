# Project Meridian — STATE (recovery capsule)

PROJECT: Market Terminal 2.0 — Project Meridian
CHECKPOINT: POCKET — iPhone delivery (SIDE-TRACK; does not renumber MT2-3…; MT2-1A remains the
  last main-roadmap checkpoint, PASS)
STATUS: HUMAN ACTION REQUIRED (2026-09-20T08:25Z) — engineering complete to the limit of the
  environment; Xcode + signing + physical iPhone are absent. Resume THIS checkpoint after the
  OWNER actions below; do not restart or re-plan.
PREVIOUS: MT2-1A REWIND RECONCILIATION — PASS (D-007); MT2-2 QUARTZ — PASS; B-002 still open.
ROUTE: claude-opus-5 / bypass-permissions / SERIAL — verified from the live session.
GIT: branch main; start HEAD bd51724; POCKET commit on top (ios/, .gitignore, docs/mt2 only —
  no web asset, no `?v=` bump, no backend change). NOT PUSHED. Untracked owner files preserved,
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
EVIDENCE LEVEL REACHED: IMPLEMENTED (shell) · UNIT TESTED (pure logic, macOS) · REAL BROWSER
  TESTED (production at iPhone sizes). NOT reached: IOS BUILD TESTED, SIGNED, DEVICE INSTALLED,
  DEVICE LAUNCHED, REAL DEVICE TESTED, RESTART VERIFIED, OWNER ACCEPTED.
BLOCKERS (all OWNER/environment; none engineering):
  1. Xcode not installed. App Store Xcode 27.0 requires macOS 26.6; Mac is 26.5.2. Either
     Software Update → macOS 26.7 (restart) then App Store Xcode, or Xcode 26.x from
     developer.apple.com (Apple ID). Then: sudo xcode-select -s /Applications/Xcode.app;
     sudo xcodebuild -license accept; xcodebuild -downloadPlatform iOS.
  2. No Apple ID / signing identity in Xcode (`security find-identity` → 0). Xcode ▸ Settings
     ▸ Accounts ▸ add Apple ID (free Personal Team suffices).
  3. No iPhone connected (USB shows none). Cable in, unlock, Trust, Developer Mode on.
FAILED APPROACHES: `mas get 497799835` (needs sudo, and 27.0 is incompatible with 26.5.2 anyway).
  xcconfig gotcha: `//` is a comment, so URLs are written `https:/$()/host` (Base.xcconfig).
  xcodegen sets INFOPLIST_FILE at target level (overrides xcconfig) → per-config settings in
  project.yml instead.
OPEN: B-001, B-002, B-003, B-004/B-013, B-010, B-012, B-014, B-015 (as before); new B-016
  (landscape chrome), B-017 (server binds all interfaces), B-018 (no Web Push in WKWebView),
  B-019 (Face ID), B-020 (XCTest/iOS build not yet executed).
RUNNING PROCESSES: built-in browser tab on production (harmless).
NEXT EXACT ACTION (after the OWNER completes blockers 1–3):
  cd ios && xcodebuild -list -project MarketTerminal.xcodeproj
  xcodebuild test -project MarketTerminal.xcodeproj -scheme MarketTerminal \
    -destination 'platform=iOS Simulator,name=<any iPhone>'          # fix any compile error in place
  xcrun devicectl list devices                                        # confirm the phone
  xcodebuild -project MarketTerminal.xcodeproj -scheme MarketTerminal -configuration Debug \
    -destination 'platform=iOS,name=<phone>' -allowProvisioningUpdates \
    -derivedDataPath build/DerivedData build                          # DEVELOPMENT_TEAM via Local.xcconfig if needed
  xcrun devicectl device install app --device <id> "build/DerivedData/Build/Products/Debug-iphoneos/Market Terminal.app"
  xcrun devicectl device info apps --device <id> | grep marketterminal  # DEVICE REPORTS INSTALLED
  xcrun devicectl device process launch --device <id> com.marketterminal.app
  then the 28-point physical-device acceptance list (README + brief), restart verification,
  EVIDENCE/COMMS/STATE closure, push main (no `?v=` bump unless public/ changes), test:prod.
