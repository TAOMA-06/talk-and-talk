import Foundation
import Security

protocol TokenStoring: Sendable {
    func save(accessToken: String, refreshToken: String, expiresAt: Date)
    func getAccessToken() -> String?
    func getRefreshToken() -> String?
    func getExpiresAt() -> Date?
    func clear()
}

struct KeychainTokenStore: TokenStoring {
    private let service = "com.talkandtalk.auth"

    func save(accessToken: String, refreshToken: String, expiresAt: Date) {
        set(key: "accessToken", value: accessToken)
        set(key: "refreshToken", value: refreshToken)
        set(key: "expiresAt", value: String(expiresAt.timeIntervalSince1970))
    }

    func getAccessToken() -> String? { get(key: "accessToken") }
    func getRefreshToken() -> String? { get(key: "refreshToken") }

    func getExpiresAt() -> Date? {
        guard let raw = get(key: "expiresAt"), let interval = Double(raw) else { return nil }
        return Date(timeIntervalSince1970: interval)
    }

    func clear() {
        delete(key: "accessToken")
        delete(key: "refreshToken")
        delete(key: "expiresAt")
    }

    private func set(key: String, value: String) {
        let data = Data(value.utf8)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key
        ]
        SecItemDelete(query as CFDictionary)
        var add = query
        add[kSecValueData as String] = data
        SecItemAdd(add as CFDictionary, nil)
    }

    private func get(key: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private func delete(key: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key
        ]
        SecItemDelete(query as CFDictionary)
    }
}

final class InMemoryTokenStore: TokenStoring, @unchecked Sendable {
    private var access: String?
    private var refresh: String?
    private var expires: Date?

    func save(accessToken: String, refreshToken: String, expiresAt: Date) {
        access = accessToken
        refresh = refreshToken
        expires = expiresAt
    }

    func getAccessToken() -> String? { access }
    func getRefreshToken() -> String? { refresh }
    func getExpiresAt() -> Date? { expires }

    func clear() {
        access = nil
        refresh = nil
        expires = nil
    }
}
