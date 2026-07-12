import Foundation

#if DEBUG
enum FrontendDemoMode {
    static var isEnabled: Bool {
#if DEBUG
        isEnabled(
            environment: ProcessInfo.processInfo.environment,
            plistValue: Bundle.main.object(forInfoDictionaryKey: "FRONTEND_DEMO_MODE")
        )
#else
        false
#endif
    }

    static func isEnabled(environment: [String: String], plistValue: Any?) -> Bool {
        if let environmentValue = environment["FRONTEND_DEMO_MODE"] {
            return boolValue(environmentValue)
        }
        guard let plistValue else { return true }
        return boolValue(plistValue)
    }

    private static func boolValue(_ value: Any?) -> Bool {
        switch value {
        case let bool as Bool:
            return bool
        case let string as String:
            switch string.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
            case "1", "true", "yes", "on": return true
            default: return false
            }
        default:
            return false
        }
    }
}
#endif
