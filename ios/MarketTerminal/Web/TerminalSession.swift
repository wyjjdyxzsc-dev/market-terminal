import Foundation
import UIKit
import WebKit
import Combine

/// A link the shell will present in the in-app secure browser.
struct ExternalLink: Identifiable, Equatable {
    let id = UUID()
    let url: URL
}

/// Owns the single `WKWebView` that hosts the canonical Market Terminal web application, and
/// exposes its lifecycle to SwiftUI. The web view is created once and survives SwiftUI
/// re-renders, so terminal state (selected symbol, workspace, scroll) is never thrown away by
/// the native side.
@MainActor
final class TerminalSession: NSObject, ObservableObject {
    enum Phase: Equatable {
        /// First load in progress (or a retry after failure); the loading treatment is shown.
        case loading
        /// The terminal has rendered at least once.
        case ready
        /// The service could not be reached; the retry treatment is shown.
        case failed(message: String)
        /// The build is misconfigured (no valid production URL). Not recoverable at runtime.
        case misconfigured(message: String)
    }

    @Published private(set) var phase: Phase = .loading
    @Published private(set) var progress: Double = 0
    @Published var externalLink: ExternalLink?

    let config: AppConfig?
    let policy: NavigationPolicy
    let webView: WKWebView

    private var hasRenderedOnce = false
    private var progressObservation: NSKeyValueObservation?
    private var pendingDeepLink: URL?

    override convenience init() {
        self.init(configResult: AppConfig.load())
    }

    init(configResult: Result<AppConfig, AppConfig.ConfigError>) {
        let config: AppConfig?
        switch configResult {
        case .success(let c): config = c
        case .failure: config = nil
        }
        self.config = config
        self.policy = NavigationPolicy(internalHosts: config?.internalHosts ?? [])
        self.webView = TerminalSession.makeWebView(config: config)
        super.init()

        webView.navigationDelegate = self
        webView.uiDelegate = self
        progressObservation = webView.observe(\.estimatedProgress, options: [.new]) { [weak self] wv, _ in
            let value = wv.estimatedProgress
            Task { @MainActor in self?.progress = value }
        }

        if case .failure(let error) = configResult {
            phase = .misconfigured(message: error.description)
        }
    }

    // MARK: - Web view configuration

    private static func makeWebView(config: AppConfig?) -> WKWebView {
        let wkConfig = WKWebViewConfiguration()
        // Persistent store: cookies, localStorage (mt:lastSymbol, watchlist, alert prefs),
        // IndexedDB and HTTP cache survive backgrounding, force-quit and relaunch.
        wkConfig.websiteDataStore = .default()
        wkConfig.defaultWebpagePreferences.allowsContentJavaScript = true
        wkConfig.allowsInlineMediaPlayback = true
        wkConfig.mediaTypesRequiringUserActionForPlayback = []
        // Financial data is full of numbers; never let WebKit turn them into phone-number links.
        wkConfig.dataDetectorTypes = []
        if let suffix = config?.userAgentSuffix {
            wkConfig.applicationNameForUserAgent = suffix
        }

        let wv = WKWebView(frame: .zero, configuration: wkConfig)
        wv.isOpaque = false
        wv.backgroundColor = Theme.uiBackground
        wv.scrollView.backgroundColor = Theme.uiBackground
        wv.scrollView.contentInsetAdjustmentBehavior = .never
        wv.scrollView.keyboardDismissMode = .interactive
        // The QUARTZ shell keeps hash history for workspaces; edge swipes map onto it.
        wv.allowsBackForwardNavigationGestures = true
        wv.allowsLinkPreview = false
        #if DEBUG
        if #available(iOS 16.4, *) { wv.isInspectable = true }
        #endif
        return wv
    }

    // MARK: - Lifecycle

    /// Starts the first load. Idempotent.
    func start() {
        guard case .loading = phase, webView.url == nil, !webView.isLoading, let config else { return }
        load(config.startURL)
    }

    func retry() {
        guard let config else { return }
        phase = .loading
        if webView.url != nil, hasRenderedOnce {
            webView.reload()
        } else {
            load(pendingDeepLink ?? config.startURL)
        }
    }

    /// Called when the scene becomes active again. WebKit may have discarded the content
    /// process while we were in the background; a blank view here would look like a hang.
    func handleForeground() {
        switch phase {
        case .failed:
            retry()
        case .ready:
            if webView.url == nil || (webView.title ?? "").isEmpty, !webView.isLoading {
                webView.reload()
            }
        case .loading, .misconfigured:
            break
        }
    }

    /// `marketterminal://…` entry. Unsupported routes are ignored (and logged) rather than
    /// pretending to work.
    func open(deepLink url: URL) {
        guard let config, let destination = DeepLinkRouter.destination(for: url, base: config.startURL) else {
            if case .unsupported(let reason) = DeepLinkRouter.resolve(url) {
                NSLog("[MarketTerminal] deep link ignored: \(url) — \(reason)")
            }
            return
        }
        if hasRenderedOnce, case .ready = phase {
            load(destination)
        } else {
            pendingDeepLink = destination
            if webView.url == nil { load(destination) }
        }
    }

    private func load(_ url: URL) {
        var request = URLRequest(url: url)
        request.cachePolicy = .useProtocolCachePolicy
        request.timeoutInterval = 30
        webView.load(request)
    }

    private func present(external url: URL) {
        externalLink = ExternalLink(url: url)
    }

    private func openInSystem(_ url: URL) {
        UIApplication.shared.open(url, options: [:]) { ok in
            if !ok { NSLog("[MarketTerminal] no handler for \(url)") }
        }
    }

    private func fail(_ error: Error) {
        let ns = error as NSError
        if ns.domain == NSURLErrorDomain, ns.code == NSURLErrorCancelled { return }
        // A failure after the terminal is already on screen (e.g. a background reload while
        // offline) must not blank a working terminal — the web app shows its own states.
        if hasRenderedOnce, webView.url != nil, case .ready = phase { return }
        phase = .failed(message: ns.localizedDescription)
    }
}

// MARK: - WKNavigationDelegate

extension TerminalSession: WKNavigationDelegate {
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        let isMainFrame = navigationAction.targetFrame?.isMainFrame ?? true
        let opensNewWindow = navigationAction.targetFrame == nil
        switch policy.decision(for: url, isMainFrame: isMainFrame, opensNewWindow: opensNewWindow) {
        case .allowInShell:
            decisionHandler(.allow)
        case .openExternally:
            decisionHandler(.cancel)
            present(external: url)
        case .openInSystem:
            decisionHandler(.cancel)
            openInSystem(url)
        case .cancel:
            decisionHandler(.cancel)
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        // Anything WebKit cannot render inline (a PDF filing, CSV export) goes to the secure
        // browser, which can display or share it. The terminal itself is never replaced.
        if navigationResponse.isForMainFrame, !navigationResponse.canShowMIMEType,
           let url = navigationResponse.response.url {
            decisionHandler(.cancel)
            present(external: url)
            return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        if !hasRenderedOnce { phase = .loading }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        hasRenderedOnce = true
        phase = .ready
        if let pending = pendingDeepLink {
            pendingDeepLink = nil
            if webView.url != pending { load(pending) }
        }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        fail(error)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        fail(error)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        // WebKit killed the content process (memory pressure). Reload in place; the persistent
        // store restores the last symbol and workspace on the web side.
        NSLog("[MarketTerminal] web content process terminated — reloading")
        webView.reload()
    }
}

// MARK: - WKUIDelegate

extension TerminalSession: WKUIDelegate {
    /// `target=_blank` / `window.open`. We never spawn a second web view: internal targets load
    /// in the terminal, external ones go to the secure browser.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        guard let url = navigationAction.request.url else { return nil }
        switch policy.decision(for: url, isMainFrame: true, opensNewWindow: true) {
        case .allowInShell: webView.load(navigationAction.request)
        case .openExternally: present(external: url)
        case .openInSystem: openInSystem(url)
        case .cancel: break
        }
        return nil
    }
}
