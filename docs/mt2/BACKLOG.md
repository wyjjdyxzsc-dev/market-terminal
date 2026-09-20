# Project Meridian — BACKLOG

Legitimate findings outside the active checkpoint. Discovery is not authorization.
Severity: P0 security/privacy/data corruption/dangerous financial authority · P1 broken primary
functionality, wrong data, major routing/API/update defect · P2 material UX/persistence/
accessibility/degraded-state defect · P3 minor.

---

## B-001 · P1 · ENVIRONMENT · Repository lives in an iCloud-synced folder
- OBSERVATION: `~/Desktop/claude projects/market-terminal` is under iCloud Desktop sync; 1,711
  files (incl. `worker.js` and 196 `.git` objects/packs) were evicted (`dataless`). `git status`
  hung >120 s; reads stalled ~10 s/file. `.git` also carries stale `HEAD.lock.*`, `index.lock.*`,
  `index2..6`, and `rebase-merge-stale-*` artifacts from earlier interrupted operations.
- EVIDENCE: `ls -lO worker.js` → `compressed,dataless`; EVIDENCE.md R5.
- WHY DEFERRED: moving the repo or disabling "Optimize Mac Storage" is an OWNER machine decision.
- SUGGESTED: HUMAN ACTION now (move repo outside iCloud or pin it), before MT2-1.

## B-002 · P1 · AI AUTHORITY / CONFIG · Production high-risk surfaces always abstain
- OBSERVATION: Situation Room, Investment Report, Instability, Sectors, and Deep Dive analysis
  all `abstained` in production. Runtime attempts show only `github` (`openai/gpt-4.1`) failing in
  ~300–800 ms with failureCode `Error`, and `cfai` timing out at ~19 s. No second heavy provider
  is configured, and the policy requires two independent heavy providers for verified tasks.
- EVIDENCE: EVIDENCE.md baseline probes 2026-09-20.
- WHY DEFERRED: needs Worker secrets (e.g. `GEMINI_API_KEY`, a valid `GITHUB_MODELS_TOKEN`)
  and/or a policy decision on provider requirements; not repairable from the repo.
- SUGGESTED: HUMAN ACTION (secrets) now; policy revisit in MT2-1 REWIND (Deep Dive) / MT2-7.
- CLOSURE NOTE (2026-09-20): re-observed on the deployed fa52e1a build; abstention is truthful
  and safe; no verification/evidence/separation was weakened and no secrets were added.

## B-003 · P2 · MAP / FRONTEND · Aircraft layer: dead browser-direct path + empty in production
- OBSERVATION: `public/mapintel.js` fetches up to 12 `api.airplanes.live/v2/point/…` tiles
  directly from the browser every 8 s; the host now returns 403 / no CORS headers, producing
  an error storm (400+ console errors in one session). Server fallback `/api/map/flights` works
  locally (816 points) but returns 0 points in production (datacenter-IP blocks).
- EVIDENCE: browser console; `curl -D - https://api.airplanes.live/v2/point/40/-100/250` → 403.
- WHY DEFERRED: needs a provider decision (OpenSky auth, adsb.lol, or drop) — feature work.
- SUGGESTED: MT2-5 MARKETGRID or a dedicated map-data checkpoint.

## B-004 · P2 · FRONTEND · Live map layer timers run while the map is not visible
- OBSERVATION: `setLayer()` starts `setInterval` refreshers that keep polling (aircraft every
  8 s, quakes/weather every 60 s) after the user leaves Global Map or the tab is hidden.
- EVIDENCE: `public/mapintel.js:589-591`; console shows polling continuing on Watchlist view.
- WHY DEFERRED: behavioural change beyond baseline repair; low risk but not blocking.
- SUGGESTED: MT2-2 QUARTZ (shell lifecycle owns visibility) or earlier as a small fix.

## B-005 · P2 · BACKEND / SECURITY · Unregistered worker route bypasses the rate limiter
- OBSERVATION: `worker.js` serves `/api/map/conflictnews` (not in `shared/api-contract.js`).
  Because `getRoute()` returns null, `requireRateLimit()` is skipped and no provenance envelope
  is attached. It currently returns 502 (GDELT) and nothing in the frontend calls it.
- EVIDENCE: `worker.js:3136`; prod probe 502.
- WHY DEFERRED: dead route; deletion or registration is a contract decision. Minimal.
- SUGGESTED: MT2-1 or any next backend touch — delete it (or register + rate-limit).

## B-006 · P3 · BACKEND · server.js / worker.js route drift
- OBSERVATION: `server.js` serves `/api/map/eonet` (unregistered, duplicates `/api/map/events`);
  `/api/map/overpass` is in the contract and `server.js` but absent from `worker.js` (prod 404).
  Neither is used by the frontend.
- EVIDENCE: route extraction 2026-09-20; prod probes.
- SUGGESTED: same touch as B-005.

## B-007 · P3 · BACKEND · server.js applies rate limiting inconsistently
- OBSERVATION: 10 Express routes have no rate-limit middleware (`/api/map/{overpass,earthquakes,
  fires,eonet,disease,gpsjam,conflict,layers,infrastructure}`, `/api/macro/shock`), while the
  Worker limits every registered route uniformly. Local-only exposure.
- SUGGESTED: same touch as B-005.

## B-008 · P3 · BACKEND · Chart route error shape breaks the JSON error contract
- OBSERVATION: `/api/chart` failures return `{"error":"Yahoo responded 429"}` (string), while the
  contract elsewhere is `{ error: true, code, message }`; the frontend tolerates it.
- SUGGESTED: MT2-3 TWINCORE when chart contracts are touched for multi-market.

## B-009 · P3 · DEPENDENCY · `qs` moderate advisories via express/body-parser
- OBSERVATION: `npm audit --omit=dev` → 3 moderate (`qs` ≤6.15.3). Fix available.
- SUGGESTED: next dependency touch; verify smoke afterwards.

## B-010 · P3 · DOCS · AGENTS.md has drifted from CLAUDE.md
- OBSERVATION: `AGENTS.md` still states Deep Dive levels/valuation/options are disabled and lacks
  the 2026-08-11 section; CLAUDE.md supersedes it. Both files also say the 08-11 commit is "not
  yet verified in production" while production serves `20260811a`.
- SUGGESTED: fold into the first MT2 doc sync.
- NOTE (MT2-1): CLAUDE.md updated with the REWIND entry; AGENTS.md still not synced (out of
  REWIND scope — documentation-only touch for the next checkpoint that edits docs).
- NOTE (MT2-2): AGENTS.md now carries a superseded-by-CLAUDE.md banner; full rewrite still open.

## B-011 · P3 · AI / SPEED TIER · Cerebras gpt-oss may share the reasoning-token overrun
- OBSERVATION: R3 pinned `reasoning_effort: low` for Groq only (verified). Cerebras
  `gpt-oss-120b` uses `max_completion_tokens` and may need the same parameter; unverified.
- SUGGESTED: verify when a Cerebras key is available.

## B-012 · P3 · UX · Watchlist Enter-key submission unverified
- OBSERVATION: in the built-in browser pane a synthetic Enter in `#watchInput` did not submit,
  while the same synthetic Enter submitted the AI chat input (explicit keydown handler). DOM
  `requestSubmit()` and the ADD button work. May be a pane artifact.
- SUGGESTED: HUMAN check in a real browser; fix in MT2-6 WATCHTOWER if real.

## B-013 · P3 · FRONTEND · Intel views refresh twice on window focus
- OBSERVATION: `public/intel.js` calls `refreshCurrent()` from both `visibilitychange` and
  `focus`; returning to the tab fires both within ~400 ms, so News/Sectors/Watchlist/Supply
  re-fetch twice. MT2-1 exempted Deep Dive (`FOCUS_REFRESH_EXEMPT`) but left the other views.
- EVIDENCE: local resource timing 2026-09-20 (two `/api/intel/deepdive` fetches 0.4 s apart on
  focus before the exemption).
- WHY DEFERRED: behavioural change to views outside REWIND scope; harmless (cached payloads).
- SUGGESTED: a single debounced refresh-on-return in MT2-2 QUARTZ shell lifecycle.

## B-014 · P3 · FRONTEND · Legacy in-view sub-tab binding is now dead code
- OBSERVATION: `public/intel.js` still binds `document.querySelectorAll('.gi-subtab')` although the
  QUARTZ shell removed those buttons; `showGiSub()` is driven by the `mt:gisub` event instead. The
  `.maplayer-btn`/`.mapmode-btn` handlers still work because their buttons were kept.
- SUGGESTED: delete the dead binding in the next intel.js touch (MT2-8 CONVERGENCE at the latest).

## B-015 · P3 · UX · Map tile attribution shows "API KEY REQUIRED" watermark locally
- OBSERVATION: the Global Map base tiles render an "API KEY REQUIRED" watermark in the local
  built-in-browser session (2026-09-20). Pre-existing; unrelated to QUARTZ (tile provider config).
- SUGGESTED: verify in production; if reproduced, choose a keyless tile source or add the key —
  map-data checkpoint.

## B-004 / B-013 · NOTE (MT2-2)
- Not addressed in QUARTZ (shell lifecycle work stayed within navigation + presentation). Both
  remain open for the next checkpoint that touches intel.js/mapintel.js lifecycle.

## B-016 · P3 · UX · Landscape iPhone: fixed chrome consumes ~45% of the viewport
- OBSERVATION: at 812×375 (iPhone landscape) production stacks chrome (117 px) + tape + nav +
  subnav ≈ 170 px before content. Every workspace renders, `scrollWidth === 812` (no horizontal
  overflow), content scrolls — usable but cramped. Portrait 375×812 unchanged from QUARTZ.
- EVIDENCE: EVIDENCE.md POCKET "iPhone-dimension audit" (built-in browser, production).
- SUGGESTED: collapse the market-mode row and tape into the chrome below ~420 px height, or
  auto-hide the tape in landscape. Belongs to CONVERGENCE; not a wrapper defect.

## B-017 · P3 · SECURITY-POSTURE · Local dev server binds all interfaces
- OBSERVATION: `server.js` calls `httpServer.listen(PORT)` with no host, so `npm start` is
  reachable from the LAN today. The POCKET brief assumed a 127.0.0.1-only posture; ground truth
  is broader. The iOS `Development` configuration uses `localhost` (Simulator only) and does
  not change this.
- SUGGESTED: bind to `127.0.0.1` by default with an explicit `HOST=0.0.0.0` opt-in for
  physical-device testing. Not changed in POCKET (out of scope; would alter local behaviour).

## B-018 · P2 · MOBILE · Web Push is unavailable inside WKWebView
- OBSERVATION: `public/intel.js` gates Alerts on `serviceWorker` + `PushManager`; WKWebView
  has no push support, so the Alerts workspace shows its own unsupported/blocked state in the
  iOS app. Breaking-news alerts therefore do not reach the phone through the wrapper.
- SUGGESTED: native APNs seam (UNUserNotificationCenter + device-token registration route in
  the Worker) when SENTINEL/WORLDWIRE/ORACLE push is authorized. Seam location:
  `ios/MarketTerminal/App/MarketTerminalApp.swift` (AppDelegate adaptor) + a `/api/push/ios`
  route. Not implemented in POCKET by design.

## B-019 · P3 · MOBILE · Optional Face ID application lock not implemented
- OBSERVATION: POCKET left `LocalAuthentication` out; the app holds no private data beyond the
  web session, so the lock is a preference, not a protection gap.
- SUGGESTED: `LAContext` gate in `ContentView` behind a Settings toggle, in a later mobile
  checkpoint.

## B-020 · P2 · IOS · XCTest suite and iOS build have not been executed
- OBSERVATION: the Mac has only Command Line Tools (no Xcode, no iOS SDK, 0 signing
  identities), so `MarketTerminalTests` and the iOS build could not run in POCKET. The
  Foundation-only logic (AppConfig, NavigationPolicy, DeepLinkRouter) was compiled and executed
  with the macOS toolchain (28/28); the UIKit/WebKit/SwiftUI files are parse-checked only.
- SUGGESTED: first action after Xcode is installed — `xcodebuild test` on a simulator, then the
  device install (ios/README.md). Any compile error there is an IMPLEMENTATION class fix
  inside POCKET, not a new checkpoint.
