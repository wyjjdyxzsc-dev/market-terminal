import XCTest
@testable import MarketTerminal

final class DeepLinkRouterTests: XCTestCase {
    let base = URL(string: "https://market-terminal.example.workers.dev/")!

    func testWorkspaceRoutesResolveToShellHashes() {
        XCTAssertEqual(DeepLinkRouter.resolve(URL(string: "marketterminal://terminal")!), .route(fragment: "#/terminal"))
        XCTAssertEqual(DeepLinkRouter.resolve(URL(string: "marketterminal://deepdive")!), .route(fragment: "#/research/analyze"))
        XCTAssertEqual(DeepLinkRouter.resolve(URL(string: "marketterminal://map")!), .route(fragment: "#/intelligence/map"))
        XCTAssertEqual(DeepLinkRouter.resolve(URL(string: "marketterminal://Quant")!), .route(fragment: "#/quant"))
    }

    func testBareSchemeLandsOnTerminal() {
        XCTAssertEqual(DeepLinkRouter.resolve(URL(string: "marketterminal://")!), .route(fragment: "#/terminal"))
    }

    func testReservedEntityRoutesAreUnsupported() {
        for raw in ["marketterminal://stock/US/NASDAQ/AAPL", "marketterminal://stock/IN/NSE/RELIANCE",
                    "marketterminal://portfolio", "marketterminal://ipo/2026-01", "marketterminal://event/x"] {
            guard case .unsupported = DeepLinkRouter.resolve(URL(string: raw)!) else {
                return XCTFail("\(raw) must be unsupported until the web app has an entity URL contract")
            }
        }
    }

    func testParameterisedWorkspaceRouteIsUnsupported() {
        guard case .unsupported = DeepLinkRouter.resolve(URL(string: "marketterminal://deepdive/AAPL")!) else {
            return XCTFail("deepdive/<symbol> is not addressable yet")
        }
    }

    func testDestinationBuildsOnBase() {
        let dest = DeepLinkRouter.destination(for: URL(string: "marketterminal://watchlist")!, base: base)
        XCTAssertEqual(dest?.absoluteString, "https://market-terminal.example.workers.dev/#/watchlist")
        XCTAssertNil(DeepLinkRouter.destination(for: URL(string: "marketterminal://portfolio")!, base: base))
        XCTAssertNil(DeepLinkRouter.destination(for: URL(string: "https://evil.example/")!, base: base))
    }
}
