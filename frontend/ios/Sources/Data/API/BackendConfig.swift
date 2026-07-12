import Foundation

enum BackendConfig {
    /// Companions verified for backend chat/moderation sync (expand as API coverage grows).
    static let supportedCompanionIds: Set<String> = ["c1", "c2", "c3"]
    #if DEBUG
    static let defaultBaseURL = URL(string: "http://127.0.0.1:3000")!
    #else
    static let defaultBaseURL: URL? = nil
    #endif

    static var baseURL: URL? {
        #if DEBUG
        guard !FrontendDemoMode.isEnabled else { return nil }
        #endif

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

    /// Production Release sets `ENABLE_PHONE_LOGIN=NO` (Apple-only). Debug/Staging keep phone SMS.
    static var isPhoneLoginEnabled: Bool {
        if let env = ProcessInfo.processInfo.environment["ENABLE_PHONE_LOGIN"] {
            return env.compare("YES", options: .caseInsensitive) == .orderedSame
                || env == "1"
                || env.compare("true", options: .caseInsensitive) == .orderedSame
        }
        if let plist = Bundle.main.object(forInfoDictionaryKey: "ENABLE_PHONE_LOGIN") as? String {
            return plist.compare("YES", options: .caseInsensitive) == .orderedSame
                || plist == "1"
                || plist.compare("true", options: .caseInsensitive) == .orderedSame
        }
        #if DEBUG
        return true
        #else
        return false
        #endif
    }

    static func supportsChat(for companionId: String) -> Bool {
        guard isEnabled else { return false }
        #if DEBUG
        return supportedCompanionIds.contains(companionId)
        #else
        return true
        #endif
    }

    static func supportsChat(for target: ContactTarget) -> Bool {
        if case .companion(let id) = target {
            return supportsChat(for: id)
        }
        return false
    }
}
