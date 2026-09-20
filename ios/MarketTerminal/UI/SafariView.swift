import SwiftUI
import SafariServices

/// In-app secure browser for external sources. It runs in Safari's own process with Safari's
/// cookies and content blockers, so nothing from a news site or filing can touch the terminal,
/// and dismissing it returns to the terminal exactly as it was.
struct SafariView: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> SFSafariViewController {
        let config = SFSafariViewController.Configuration()
        config.entersReaderIfAvailable = false
        config.barCollapsingEnabled = true
        let vc = SFSafariViewController(url: url, configuration: config)
        vc.preferredBarTintColor = Theme.uiBackground
        vc.preferredControlTintColor = UIColor(Theme.accent)
        vc.dismissButtonStyle = .close
        return vc
    }

    func updateUIViewController(_ uiViewController: SFSafariViewController, context: Context) {}
}
