import Foundation

/// Runtime configuration for the shell.
///
/// Every value comes from Info.plist keys that `Config/*.xcconfig` populate at build time
/// (`MarketTerminalBaseURL`, `MarketTerminalDevURL`, `MarketTerminalEnvironment`). Swift never
/// carries a service URL literal, so changing the origin is a one-line xcconfig edit.
struct AppConfig: Equatable {
    enum Environment: String, Equatable {
        case production
        case development
    }

    enum ConfigError: Error, Equatable, CustomStringConvertible {
        case missingBaseURL
        case invalidBaseURL(String)
        case insecureBaseURL(String)

        var description: String {
            switch self {
            case .missingBaseURL: return "MarketTerminalBaseURL is missing from Info.plist"
            case .invalidBaseURL(let raw): return "MarketTerminalBaseURL is not a URL: \(raw)"
            case .insecureBaseURL(let raw): return "MarketTerminalBaseURL must use https: \(raw)"
            }
        }
    }

    static let baseURLKey = "MarketTerminalBaseURL"
    static let devURLKey = "MarketTerminalDevURL"
    static let environmentKey = "MarketTerminalEnvironment"

    let environment: Environment
    let productionURL: URL
    let developmentURL: URL?
    let appVersion: String
    let buildNumber: String

    /// The origin the web view boots into for this build.
    var startURL: URL {
        if environment == .development, let dev = developmentURL { return dev }
        return productionURL
    }

    /// Hosts that are "Market Terminal" for navigation purposes (production always; the
    /// development origin only when this build targets it).
    var internalHosts: Set<String> {
        var hosts = Set<String>()
        if let h = productionURL.host?.lowercased() { hosts.insert(h) }
        if environment == .development, let h = developmentURL?.host?.lowercased() { hosts.insert(h) }
        return hosts
    }

    /// Appended to the WebKit user agent so the web application can recognise the shell
    /// (`MarketTerminalIOS/1.0.0`). This is the whole "platform / appVersion" bridge: no
    /// JavaScript is injected.
    var userAgentSuffix: String { "MarketTerminalIOS/\(appVersion)" }

    init(environment: Environment, productionURL: URL, developmentURL: URL?, appVersion: String, buildNumber: String) {
        self.environment = environment
        self.productionURL = productionURL
        self.developmentURL = developmentURL
        self.appVersion = appVersion
        self.buildNumber = buildNumber
    }

    /// Parses an Info.plist dictionary. Production must be an absolute https URL with a host;
    /// the development URL is optional and may be plain http (it is only honoured by the
    /// Development configuration, whose Info.plist carries the scoped ATS exception).
    init(info: [String: Any]) throws {
        guard let rawBase = (info[Self.baseURLKey] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
              !rawBase.isEmpty else {
            throw ConfigError.missingBaseURL
        }
        guard let base = URL(string: rawBase), base.host != nil else {
            throw ConfigError.invalidBaseURL(rawBase)
        }
        guard base.scheme?.lowercased() == "https" else {
            throw ConfigError.insecureBaseURL(rawBase)
        }

        var dev: URL? = nil
        if let rawDev = (info[Self.devURLKey] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
           !rawDev.isEmpty, let parsed = URL(string: rawDev), parsed.host != nil,
           let scheme = parsed.scheme?.lowercased(), scheme == "http" || scheme == "https" {
            dev = parsed
        }

        let envRaw = (info[Self.environmentKey] as? String)?.lowercased() ?? "production"
        let env = Environment(rawValue: envRaw) ?? .production

        self.init(
            environment: env,
            productionURL: base,
            developmentURL: dev,
            appVersion: (info["CFBundleShortVersionString"] as? String) ?? "0",
            buildNumber: (info["CFBundleVersion"] as? String) ?? "0"
        )
    }

    /// Loads from the running bundle. A misconfigured build is a programming error that must be
    /// visible immediately, not a blank screen, so this fails loudly.
    static func load(from bundle: Bundle = .main) -> Result<AppConfig, ConfigError> {
        do {
            return .success(try AppConfig(info: bundle.infoDictionary ?? [:]))
        } catch let error as ConfigError {
            return .failure(error)
        } catch {
            return .failure(.missingBaseURL)
        }
    }
}
