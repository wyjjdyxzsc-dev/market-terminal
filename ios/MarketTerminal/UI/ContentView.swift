import SwiftUI

struct ContentView: View {
    @ObservedObject var session: TerminalSession

    var body: some View {
        ZStack {
            // Paints the safe-area bands (status bar, home indicator, notch) in --bg so the
            // web application's chrome reads as one surface with the device edges.
            Theme.background.ignoresSafeArea()

            TerminalWebView(session: session)
                .opacity(session.phase == .ready ? 1 : 0)

            switch session.phase {
            case .loading:
                LoadingStateView(progress: session.progress)
                    .transition(.opacity)
            case .failed(let message):
                FailureStateView(message: message, recoverable: true) { session.retry() }
            case .misconfigured(let message):
                FailureStateView(message: message, recoverable: false) {}
            case .ready:
                EmptyView()
            }
        }
        // WKWebView manages its own keyboard avoidance; letting SwiftUI shrink the container as
        // well would double-inset the terminal.
        .ignoresSafeArea(.keyboard)
        .animation(.easeOut(duration: 0.2), value: session.phase)
        .fullScreenCover(item: $session.externalLink) { link in
            SafariView(url: link.url).ignoresSafeArea()
        }
        .onAppear { session.start() }
    }
}
