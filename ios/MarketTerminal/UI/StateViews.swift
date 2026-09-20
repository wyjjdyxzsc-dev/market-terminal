import SwiftUI

/// Native loading treatment shown until the terminal has rendered once.
struct LoadingStateView: View {
    let progress: Double

    var body: some View {
        VStack(spacing: 18) {
            BrandMark().frame(width: 56, height: 56)
            Text("MARKET TERMINAL")
                .font(Theme.label(12))
                .tracking(2)
                .foregroundStyle(Theme.textPrimary)
            Text("Connecting to the market service")
                .font(Theme.body(13))
                .foregroundStyle(Theme.textSecondary)
            ProgressView(value: max(0.02, min(progress, 1)))
                .progressViewStyle(.linear)
                .tint(Theme.accent)
                .frame(width: 160)
        }
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.background)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Market Terminal is loading")
    }
}

/// Native failure treatment. Deliberately does not show any market data: nothing here is live.
struct FailureStateView: View {
    let message: String
    let recoverable: Bool
    let retry: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 10) {
                BrandMark().frame(width: 22, height: 22)
                Text("MARKET TERMINAL")
                    .font(Theme.label(12))
                    .tracking(2)
                    .foregroundStyle(Theme.textPrimary)
            }
            Rectangle().fill(Theme.separator).frame(height: 1)
            Text(recoverable ? "Unable to reach the market service." : "This build is misconfigured.")
                .font(Theme.body(16))
                .foregroundStyle(Theme.textPrimary)
            Text(recoverable ? "Live market data is currently unavailable." : "The production URL is missing or not HTTPS.")
                .font(Theme.body(14))
                .foregroundStyle(Theme.textSecondary)
            Text(message)
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(Theme.textMuted)
                .lineLimit(3)
            if recoverable {
                Button(action: retry) {
                    Text("RETRY")
                        .font(Theme.label(12))
                        .tracking(1.5)
                        .foregroundStyle(Theme.background)
                        .padding(.horizontal, 18)
                        .padding(.vertical, 10)
                        .background(Theme.accent, in: RoundedRectangle(cornerRadius: 4))
                }
                .buttonStyle(.plain)
                .padding(.top, 6)
                .accessibilityHint("Reconnects to Market Terminal")
            }
        }
        .padding(24)
        .frame(maxWidth: 420, alignment: .leading)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 6))
        .overlay(RoundedRectangle(cornerRadius: 6).stroke(Theme.separator))
        .padding(20)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.background)
    }
}
