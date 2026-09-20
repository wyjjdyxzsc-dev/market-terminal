import XCTest
@testable import MarketTerminal

final class AppConfigTests: XCTestCase {
    func testParsesProductionConfiguration() throws {
        let cfg = try AppConfig(info: [
            "MarketTerminalBaseURL": "https://market-terminal.example.workers.dev",
            "MarketTerminalDevURL": "http://localhost:3000",
            "MarketTerminalEnvironment": "production",
            "CFBundleShortVersionString": "1.2.3",
            "CFBundleVersion": "7",
        ])
        XCTAssertEqual(cfg.environment, .production)
        XCTAssertEqual(cfg.startURL.absoluteString, "https://market-terminal.example.workers.dev")
        XCTAssertEqual(cfg.internalHosts, ["market-terminal.example.workers.dev"])
        XCTAssertEqual(cfg.userAgentSuffix, "MarketTerminalIOS/1.2.3")
        XCTAssertEqual(cfg.buildNumber, "7")
    }

    func testDevelopmentBootsIntoDevURLAndTreatsBothHostsAsInternal() throws {
        let cfg = try AppConfig(info: [
            "MarketTerminalBaseURL": "https://prod.example",
            "MarketTerminalDevURL": "http://localhost:3000",
            "MarketTerminalEnvironment": "development",
        ])
        XCTAssertEqual(cfg.startURL.absoluteString, "http://localhost:3000")
        XCTAssertEqual(cfg.internalHosts, ["prod.example", "localhost"])
    }

    func testRejectsMissingInvalidAndInsecureBaseURL() {
        XCTAssertThrowsError(try AppConfig(info: [:])) { XCTAssertEqual($0 as? AppConfig.ConfigError, .missingBaseURL) }
        XCTAssertThrowsError(try AppConfig(info: ["MarketTerminalBaseURL": "not a url"]))
        XCTAssertThrowsError(try AppConfig(info: ["MarketTerminalBaseURL": "http://prod.example"])) {
            XCTAssertEqual($0 as? AppConfig.ConfigError, .insecureBaseURL("http://prod.example"))
        }
    }

    func testBundleConfigurationIsProductionHTTPS() throws {
        // The built app's Info.plist must resolve; this fails if an xcconfig substitution breaks.
        let cfg = try AppConfig.load(from: Bundle(for: TerminalSession.self)).get()
        XCTAssertEqual(cfg.productionURL.scheme, "https")
        XCTAssertFalse(cfg.productionURL.absoluteString.contains("$("), "xcconfig substitution did not run")
    }
}
