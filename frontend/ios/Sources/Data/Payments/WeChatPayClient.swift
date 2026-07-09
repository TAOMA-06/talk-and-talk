import Foundation

struct WeChatAppPayParams: Equatable, Sendable {
    let appId: String
    let partnerId: String
    let prepayId: String
    let package: String
    let nonceStr: String
    let timeStamp: String
    let sign: String
}

enum WeChatPayError: Error, Equatable {
    case notConfigured
    case cancelled
    case failed(String)
}

/// Boundary for WeChat Pay SDK. Real SDK can replace LiveWeChatPayClient without changing callers.
protocol WeChatPaying: Sendable {
    var isConfigured: Bool { get }
    func pay(with params: WeChatAppPayParams) async throws
}

enum WeChatPayConfig {
    static var appId: String? {
        if let env = ProcessInfo.processInfo.environment["WECHAT_APP_ID"], !env.isEmpty {
            return env
        }
        if let plist = Bundle.main.object(forInfoDictionaryKey: "WECHAT_APP_ID") as? String, !plist.isEmpty {
            return plist
        }
        return nil
    }

    static var universalLink: String? {
        if let env = ProcessInfo.processInfo.environment["WECHAT_UNIVERSAL_LINK"], !env.isEmpty {
            return env
        }
        if let plist = Bundle.main.object(forInfoDictionaryKey: "WECHAT_UNIVERSAL_LINK") as? String, !plist.isEmpty {
            return plist
        }
        return nil
    }

    static var isSDKConfigured: Bool { appId != nil }
}

/// Used when WeChat OpenSDK is not linked or WECHAT_APP_ID is missing (Debug only).
struct MockWeChatPayClient: WeChatPaying {
    var isConfigured: Bool { false }

    func pay(with params: WeChatAppPayParams) async throws {
        try await Task.sleep(nanoseconds: 200_000_000)
        _ = params
    }
}

struct LiveWeChatPayClient: WeChatPaying {
    var isConfigured: Bool { WeChatPayConfig.isSDKConfigured }

    func pay(with params: WeChatAppPayParams) async throws {
        guard isConfigured else {
            throw WeChatPayError.notConfigured
        }
        try await WeChatPayCoordinator.shared.pay(with: params)
    }
}

enum WeChatPayClientFactory {
    static func make() -> any WeChatPaying {
        if WeChatPayConfig.isSDKConfigured {
            return LiveWeChatPayClient()
        }
        #if DEBUG
        return MockWeChatPayClient()
        #else
        return LiveWeChatPayClient()
        #endif
    }
}