# Market Terminal — iOS shell (POCKET)

A small native Swift/SwiftUI app that hosts the **existing, canonical Market Terminal web
application** in a `WKWebView`. Nothing financial lives here: no quotes, AI, Deep Dive, maps,
quant or watchlist logic is duplicated. The app is a delivery surface for the production site.

```
MarketTerminal (SwiftUI)  →  WKWebView  →  https://market-terminal.wyjjdyxzsc.workers.dev  →  existing APIs
```

## Layout

```
ios/
  project.yml                      XcodeGen spec (source of truth for the project)
  MarketTerminal.xcodeproj         generated — committed so it opens directly in Xcode
  Config/
    Base.xcconfig                  bundle id, versions, MARKET_TERMINAL_BASE_URL / DEV_URL / ENV
    Debug.xcconfig                 production URL (device installs prove the real service)
    Release.xcconfig               production URL
    Development.xcconfig           local Mac server + scoped ATS exception
    Local.xcconfig.example         copy to Local.xcconfig (git-ignored) to pin DEVELOPMENT_TEAM
  MarketTerminal/
    App/MarketTerminalApp.swift    @main, scene phase, marketterminal:// entry
    App/AppConfig.swift            Info.plist → typed config (https enforced), no URL literals
    Web/TerminalSession.swift      owns the WKWebView; navigation/UI delegates; lifecycle
    Web/NavigationPolicy.swift     pure: internal vs external vs system vs cancel
    Web/DeepLinkRouter.swift       pure: marketterminal:// route seam
    UI/ContentView.swift           web view + loading / failure overlays + secure reader
    UI/StateViews.swift            QUARTZ-styled loading and "Unable to reach" states
    UI/SafariView.swift            SFSafariViewController for external sources
    UI/Theme.swift                 QUARTZ tokens mirrored natively; vector brand mark
    Resources/Info.plist           production plist (no ATS exceptions)
    Resources/Info-Development.plist  + NSAllowsLocalNetworking / localhost exception only
    Resources/Assets.xcassets      AppIcon (1024, opaque), LaunchBackground, AccentColor
  MarketTerminalTests/             XCTest: AppConfig, NavigationPolicy, DeepLinkRouter
```

Identity: **Market Terminal**, bundle id `com.marketterminal.app` (override in `Local.xcconfig`
if your Personal Team already owns a different app with that id), iOS 16.0+, iPhone and iPad,
portrait + landscape.

## Prerequisites (one time)

1. **Xcode** from the Mac App Store (free). Xcode 27 needs macOS 26.6+; on macOS 26.5 install
   the 26.7 update first (`softwareupdate -l` lists it) or use Xcode 26.x from
   <https://developer.apple.com/download/all/>. After installing:
   ```bash
   sudo xcode-select -s /Applications/Xcode.app
   sudo xcodebuild -license accept
   xcodebuild -runFirstLaunch
   xcodebuild -downloadPlatform iOS      # iOS SDK + simulator runtime (Xcode 15+ ships without it)
   ```
2. **Apple ID in Xcode**: Xcode ▸ Settings ▸ Accounts ▸ `+` ▸ Apple ID. A free account gives
   you a *Personal Team*, which is all this app needs. No paid membership is required.
3. **XcodeGen** only if you edit `project.yml`: `brew install xcodegen`.

## BUILD

```bash
cd ios
xcodebuild -list -project MarketTerminal.xcodeproj
xcodebuild -project MarketTerminal.xcodeproj -scheme MarketTerminal -configuration Debug \
  -destination 'generic/platform=iOS' -allowProvisioningUpdates build
```

Or open `ios/MarketTerminal.xcodeproj` in Xcode and press ⌘B.

## SIGN

The project uses `CODE_SIGN_STYLE = Automatic`. Pick your team once:

- **Xcode UI**: select the `MarketTerminal` target ▸ Signing & Capabilities ▸ Team ▸ your
  Personal Team (`Your Name (Personal Team)`). Xcode creates the certificate and the
  development provisioning profile for you.
- **Without the UI**: `cp Config/Local.xcconfig.example Config/Local.xcconfig` and set
  `DEVELOPMENT_TEAM = XXXXXXXXXX` (the 10-character team id shown in Accounts). Then pass
  `-allowProvisioningUpdates` to `xcodebuild`.

Personal-Team facts: the profile expires after **7 days** (re-run the install to refresh; your
data on the phone survives), and a free account may hold at most **3 sideloaded apps** and
**10 app ids per week**. If you see "Failed to register bundle identifier", set a different
`PRODUCT_BUNDLE_IDENTIFIER` in `Local.xcconfig`.

## INSTALL — Xcode direct install (primary route)

1. Plug the iPhone in with a cable. Unlock it. If it asks **Trust This Computer**, tap Trust
   and enter the passcode.
2. Enable **Developer Mode** on the phone (iOS 16+): Settings ▸ Privacy & Security ▸ Developer
   Mode ▸ on ▸ restart ▸ confirm. The switch only appears after Xcode has seen the phone once
   (step 1) — if it is missing, plug in again with Xcode open.
3. In Xcode choose the phone in the run destination and press ⌘R. Or from the shell:
   ```bash
   cd ios
   xcrun devicectl list devices                       # note the phone's identifier
   xcodebuild -project MarketTerminal.xcodeproj -scheme MarketTerminal -configuration Debug \
     -destination 'platform=iOS,name=<Your iPhone name>' -allowProvisioningUpdates \
     -derivedDataPath build/DerivedData build
   APP="build/DerivedData/Build/Products/Debug-iphoneos/Market Terminal.app"
   xcrun devicectl device install app --device <identifier> "$APP"
   xcrun devicectl device process launch --device <identifier> com.marketterminal.app
   ```
4. First launch on the phone: iOS shows **"Untrusted Developer"**. Go to Settings ▸ General ▸
   VPN & Device Management ▸ your Apple ID ▸ Trust. Launch again.

Verify it really landed (do not trust "Build Succeeded"):

```bash
xcrun devicectl device info apps --device <identifier> | grep -i marketterminal
```

## REINSTALL / RE-SIGN

- Same steps as INSTALL; the bundle id is stable so the app updates in place and its web data
  (localStorage, cookies) is kept.
- After the 7-day Personal-Team profile expires the icon still exists but the app refuses to
  open. Reinstall (⌘R). Nothing else is needed.
- If the certificate was revoked or you changed Apple ID: Xcode ▸ Settings ▸ Accounts ▸
  Manage Certificates ▸ `+` Apple Development, then reinstall.

## Optional IPA / AltStore fallback

Not needed when a Mac with Xcode and a cable are available. If you want an IPA anyway
(for AltStore / Sideloadly), export a Development archive:

```bash
cd ios
xcodebuild -project MarketTerminal.xcodeproj -scheme MarketTerminal -configuration Release \
  -destination 'generic/platform=iOS' -allowProvisioningUpdates \
  -archivePath dist/MarketTerminal.xcarchive archive
cat > dist/ExportOptions.plist <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>debugging</string>
  <key>signingStyle</key><string>automatic</string>
  <key>compileBitcode</key><false/>
</dict></plist>
EOF
xcodebuild -exportArchive -archivePath dist/MarketTerminal.xcarchive \
  -exportOptionsPlist dist/ExportOptions.plist -exportPath dist -allowProvisioningUpdates
ls dist/*.ipa
```

`ios/dist/` is git-ignored. AltStore re-signs the IPA with your Apple ID on the phone and
refreshes it weekly on its own; the direct Xcode route above is simpler and is the one this
delivery targets.

## Developing against a local server

`Development` boots into `MARKET_TERMINAL_DEV_URL` (`http://localhost:3000`) and uses
`Info-Development.plist`, whose ATS exception is limited to loopback/local-network hosts.
`NSAllowsArbitraryLoads` is never set, and the production plist has no exceptions at all.

- **Simulator**: `npm start` on the Mac, then run the `MarketTerminal-Development` scheme.
- **Physical iPhone**: the phone cannot reach the Mac's loopback. `server.js` currently listens
  on all interfaces (`httpServer.listen(PORT)`), so pointing `MARKET_TERMINAL_DEV_URL` at the
  Mac's LAN address (e.g. `http:/$()/192.168.1.20:3000` in `Local.xcconfig`) works on the same
  Wi-Fi with no server change. That path is intentionally not the default and is not needed
  for production acceptance.

Note on xcconfig syntax: `//` starts a comment, so URLs are written `https:/$()/host`.

## What the shell does

- Persistent `WKWebsiteDataStore.default()` — cookies, localStorage (`mt:lastSymbol`,
  watchlist), IndexedDB and HTTP cache survive background, force-quit and relaunch.
- Navigation policy: Market Terminal hosts load in place (including `target=_blank`);
  external http(s) links (news, filings, exchanges, company sites) open in an in-app
  `SFSafariViewController` and the terminal is untouched when it is closed; `mailto:`/`tel:`
  go to the system; `javascript:` and self-scheme bounces are dropped; third-party iframes
  render in place; unrenderable main-frame responses (PDF/CSV) go to the secure reader.
- Native loading state until first render; "Unable to reach the market service" state with
  RETRY; automatic retry when the app returns to the foreground; reload after a WebKit content
  process termination.
- Data detectors off (numbers never become phone links); inline media; dark UI; portrait and
  landscape; safe-area bands painted in `--bg`.
- User agent is suffixed with `MarketTerminalIOS/<version>`; no JavaScript is injected and
  there is no web→native command channel.
- `marketterminal://` URL scheme is registered. Workspace routes (`terminal`, `markets`,
  `watchlist`, `alerts`, `quant`, `sectors`, `deepdive`, `briefing`, `situation`, `report`,
  `supply`, `map`) map to the shell's `#/…` hashes. Entity routes (`stock/…`, `deepdive/<sym>`,
  `portfolio`, `ipo/…`, `event/…`) are reserved and are ignored with a log line until the web
  application exposes an entity URL contract.

Not implemented (seams only): push notifications, Face ID lock, background refresh, share-sheet
ingestion. Web Push via the page's service worker does not work inside `WKWebView`; the Alerts
workspace shows its own unsupported state there.

## Tests

- `MarketTerminalTests` (XCTest) — run with ⌘U or
  `xcodebuild test -project MarketTerminal.xcodeproj -scheme MarketTerminal -destination 'platform=iOS Simulator,name=iPhone 16'`.
- The same pure logic is exercised without Xcode by compiling
  `App/AppConfig.swift Web/NavigationPolicy.swift Web/DeepLinkRouter.swift` against a small
  `main.swift` with the macOS toolchain (28 checks; see docs/mt2/EVIDENCE.md POCKET).
- Web suites are unchanged: `npm test`, `npm run test:ai-eval`, `npm run test:prod`.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `xcodebuild: error: tool 'xcodebuild' requires Xcode` | `sudo xcode-select -s /Applications/Xcode.app` |
| "No signing certificate" / "No profiles for com.marketterminal.app" | Select the team (SIGN above) and keep `-allowProvisioningUpdates` |
| "Failed to register bundle identifier" | Personal-Team id quota; change `PRODUCT_BUNDLE_IDENTIFIER` in `Local.xcconfig` |
| Phone not listed / "not paired" | Cable in, unlocked, tap Trust; `xcrun devicectl list devices` |
| "Developer Mode disabled" | Settings ▸ Privacy & Security ▸ Developer Mode; restart phone |
| "Untrusted Developer" on launch | Settings ▸ General ▸ VPN & Device Management ▸ Trust |
| App opens then closes after a week | Personal-Team profile expired; reinstall |
| Blank screen at launch | See Console.app for `[MarketTerminal]`; the shell reloads on process termination; RETRY state appears when the service is unreachable |
| "This build is misconfigured" | `MarketTerminalBaseURL` is not https or `$()` substitution failed; check `Config/Base.xcconfig` |
| Edited `project.yml` | `xcodegen generate` and commit the regenerated `.xcodeproj` |
