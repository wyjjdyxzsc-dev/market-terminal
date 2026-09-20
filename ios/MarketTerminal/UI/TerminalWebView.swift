import SwiftUI
import WebKit

/// Hosts the session's single `WKWebView`. Intentionally stateless: the view is owned by
/// `TerminalSession`, so SwiftUI re-renders never recreate it.
struct TerminalWebView: UIViewRepresentable {
    let session: TerminalSession

    func makeUIView(context: Context) -> WKWebView {
        session.webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {
        // Nothing to push: navigation and state live on the web side.
    }
}
