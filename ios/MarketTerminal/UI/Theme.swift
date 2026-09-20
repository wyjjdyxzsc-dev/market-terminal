import SwiftUI
import UIKit

/// Native mirror of the QUARTZ tokens in `public/style.css` (layer 1 · TOKENS). Only the handful
/// the shell paints itself — the terminal's own surfaces come from the web application.
enum Theme {
    static let uiBackground = UIColor(red: 0x0b / 255, green: 0x0c / 255, blue: 0x0f / 255, alpha: 1)   // --bg
    static let background = Color(uiBackground)
    static let surface = Color(red: 0x11 / 255, green: 0x13 / 255, blue: 0x17 / 255)                    // --surface
    static let separator = Color.white.opacity(0.08)
    static let accent = Color(red: 0xe8 / 255, green: 0xb2 / 255, blue: 0x5c / 255)                     // --accent (amber)
    static let textPrimary = Color(red: 0xe6 / 255, green: 0xe8 / 255, blue: 0xec / 255)
    static let textSecondary = Color(red: 0x9a / 255, green: 0xa0 / 255, blue: 0xab / 255)
    static let textMuted = Color(red: 0x6b / 255, green: 0x71 / 255, blue: 0x7c / 255)

    static func label(_ size: CGFloat = 11) -> Font { .system(size: size, weight: .semibold, design: .monospaced) }
    static func body(_ size: CGFloat = 14) -> Font { .system(size: size, weight: .regular, design: .default) }
}

/// The brand mark from the web favicon (`index.html`), drawn as a vector so the native loading
/// state and the Home Screen icon share one identity.
struct BrandMark: View {
    var body: some View {
        GeometryReader { geo in
            let s = min(geo.size.width, geo.size.height) / 16
            Path { p in
                p.move(to: CGPoint(x: 3 * s, y: 12 * s))
                p.addLine(to: CGPoint(x: 3 * s, y: 4 * s))
                p.addLine(to: CGPoint(x: 5.5 * s, y: 8 * s))
                p.addLine(to: CGPoint(x: 8 * s, y: 4 * s))
                p.addLine(to: CGPoint(x: 10.5 * s, y: 8 * s))
                p.addLine(to: CGPoint(x: 13 * s, y: 4 * s))
                p.addLine(to: CGPoint(x: 13 * s, y: 12 * s))
            }
            .stroke(Theme.accent, style: StrokeStyle(lineWidth: 1.6 * s, lineCap: .round, lineJoin: .round))
        }
        .aspectRatio(1, contentMode: .fit)
        .accessibilityHidden(true)
    }
}
