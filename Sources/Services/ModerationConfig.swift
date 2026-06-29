import Foundation

enum ModerationConfig {
    static var apiKey: String? {
        if let env = ProcessInfo.processInfo.environment["MODERATION_API_KEY"], !env.isEmpty {
            return env
        }
        if let plist = Bundle.main.object(forInfoDictionaryKey: "MODERATION_API_KEY") as? String, !plist.isEmpty {
            return plist
        }
        return nil
    }

    static var isAPIEnabled: Bool { apiKey != nil }
}
