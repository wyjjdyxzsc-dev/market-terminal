import Foundation

/// `marketterminal://` route seam.
///
/// Only routes the web application can actually honour today resolve — the QUARTZ shell
/// navigates by `#/workspace/item` hashes (see `public/shell.js`). Entity routes such as
/// `stock/US/NASDAQ/AAPL`, `deepdive/<symbol>`, `portfolio`, `ipo/…` and `event/…` are reserved:
/// the web application has no URL seam for them yet, so they are reported as unsupported rather
/// than pretended to work. Add them here when the web side gains a query/hash contract.
enum DeepLinkResolution: Equatable {
    /// Resolved to a shell hash such as `#/research/analyze`.
    case route(fragment: String)
    case unsupported(reason: String)
}

struct DeepLinkRouter {
    static let scheme = "marketterminal"

    /// host → shell hash. Keys are the first path element of `marketterminal://<key>`.
    static let workspaceRoutes: [String: String] = [
        "terminal":  "/terminal",
        "markets":   "/markets",
        "watchlist": "/watchlist",
        "alerts":    "/alerts",
        "quant":     "/quant",
        "sectors":   "/research/sectors",
        "deepdive":  "/research/analyze",
        "briefing":  "/intelligence/briefing",
        "situation": "/intelligence/situation",
        "report":    "/intelligence/report",
        "supply":    "/intelligence/supply",
        "map":       "/intelligence/map",
    ]

    /// Reserved entity routes. Present so the reservation is explicit and testable.
    static let reservedRoutes: Set<String> = ["stock", "portfolio", "ipo", "event"]

    static func resolve(_ url: URL) -> DeepLinkResolution {
        guard url.scheme?.lowercased() == scheme else {
            return .unsupported(reason: "scheme is not \(scheme)://")
        }
        // marketterminal://terminal → host "terminal"; marketterminal:///terminal → path "/terminal".
        var parts: [String] = []
        if let host = url.host, !host.isEmpty { parts.append(host) }
        parts.append(contentsOf: url.pathComponents.filter { $0 != "/" })
        parts = parts.map { $0.lowercased() }

        guard let head = parts.first else {
            return .route(fragment: "#/terminal")
        }
        if reservedRoutes.contains(head) {
            return .unsupported(reason: "\(head) routes are reserved until the web application exposes an entity URL contract")
        }
        guard let hash = workspaceRoutes[head] else {
            return .unsupported(reason: "unknown route \(head)")
        }
        if parts.count > 1 {
            // e.g. deepdive/AAPL — the workspace exists but per-entity addressing does not.
            return .unsupported(reason: "\(head) does not accept parameters yet")
        }
        return .route(fragment: "#" + hash)
    }

    /// The in-shell URL for a resolvable deep link, or nil when unsupported.
    static func destination(for url: URL, base: URL) -> URL? {
        guard case .route(let fragment) = resolve(url),
              var comps = URLComponents(url: base, resolvingAgainstBaseURL: false) else { return nil }
        comps.fragment = String(fragment.dropFirst())   // strip the leading '#'
        return comps.url
    }
}
