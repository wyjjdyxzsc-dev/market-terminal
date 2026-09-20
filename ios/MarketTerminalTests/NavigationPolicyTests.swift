import XCTest
@testable import MarketTerminal

final class NavigationPolicyTests: XCTestCase {
    let policy = NavigationPolicy(internalHosts: ["Market-Terminal.Example.workers.dev"])

    func testInternalMainFrameStaysInShell() {
        let url = URL(string: "https://market-terminal.example.workers.dev/#/research/analyze")!
        XCTAssertEqual(policy.decision(for: url, isMainFrame: true, opensNewWindow: false), .allowInShell)
    }

    func testInternalNewWindowStaysInShell() {
        let url = URL(string: "https://market-terminal.example.workers.dev/?tab=alerts")!
        XCTAssertEqual(policy.decision(for: url, isMainFrame: true, opensNewWindow: true), .allowInShell)
    }

    func testExternalMainFrameOpensExternally() {
        let url = URL(string: "https://www.sec.gov/Archives/edgar/data/320193/")!
        XCTAssertEqual(policy.decision(for: url, isMainFrame: true, opensNewWindow: false), .openExternally)
    }

    func testExternalTargetBlankOpensExternally() {
        let url = URL(string: "https://news.google.com/rss/articles/abc")!
        XCTAssertEqual(policy.decision(for: url, isMainFrame: true, opensNewWindow: true), .openExternally)
    }

    func testExternalIframeRendersInPlace() {
        let url = URL(string: "https://embed.windy.com/webcams/123")!
        XCTAssertEqual(policy.decision(for: url, isMainFrame: false, opensNewWindow: false), .allowInShell)
    }

    func testSystemSchemesGoToSystem() {
        XCTAssertEqual(policy.decision(for: URL(string: "mailto:ir@example.com")!, isMainFrame: true, opensNewWindow: false), .openInSystem)
        XCTAssertEqual(policy.decision(for: URL(string: "tel:+15555550100")!, isMainFrame: true, opensNewWindow: false), .openInSystem)
    }

    func testBlockedAndSelfSchemesAreCancelled() {
        XCTAssertEqual(policy.decision(for: URL(string: "javascript:void(0)")!, isMainFrame: true, opensNewWindow: false), .cancel)
        XCTAssertEqual(policy.decision(for: URL(string: "marketterminal://terminal")!, isMainFrame: true, opensNewWindow: false), .cancel)
    }

    func testAboutBlankIsAllowed() {
        XCTAssertEqual(policy.decision(for: URL(string: "about:blank")!, isMainFrame: true, opensNewWindow: false), .allowInShell)
    }
}
