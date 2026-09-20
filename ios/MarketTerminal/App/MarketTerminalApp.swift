import SwiftUI

@main
struct MarketTerminalApp: App {
    @StateObject private var session = TerminalSession()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            ContentView(session: session)
                .preferredColorScheme(.dark)
                .statusBarHidden(false)
                .onOpenURL { url in session.open(deepLink: url) }
                .onChange(of: scenePhase) { phase in
                    if phase == .active { session.handleForeground() }
                }
        }
    }
}
