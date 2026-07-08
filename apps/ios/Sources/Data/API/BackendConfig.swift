import Foundation

enum BackendConfig {
    static let supportedCompanionIds: Set<String> = ["c1", "c2", "c3"]
    static let defaultBaseURL = URL(string: "http://127.0.0.1:8787")!

    static var baseURL: URL? {
        if let env = ProcessInfo.processInfo.environment["BACKEND_BASE_URL"],
           !env.isEmpty,
           let url = URL(string: env) {
            return url
        }
        if let plist = Bundle.main.object(forInfoDictionaryKey: "BACKEND_BASE_URL") as? String,
           !plist.isEmpty,
           let url = URL(string: plist) {
            return url
        }
        return defaultBaseURL
    }

    static var isEnabled: Bool { baseURL != nil }

    static func supportsChat(for companionId: String) -> Bool {
        supportedCompanionIds.contains(companionId)
    }

    static func supportsChat(for target: ContactTarget) -> Bool {
        if case .companion(let id) = target {
            return supportsChat(for: id)
        }
        return false
    }
}
