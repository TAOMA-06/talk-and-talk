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
    /// Set via scheme env / Info.plist when WeChat OpenSDK is linked.
    static var appId: String? {
        if let env = ProcessInfo.processInfo.environment["WECHAT_APP_ID"], !env.isEmpty {
            return env
        }
        if let plist = Bundle.main.object(forInfoDictionaryKey: "WECHAT_APP_ID") as? String, !plist.isEmpty {
            return plist
        }
        return nil
    }

    static var isSDKConfigured: Bool { appId != nil }
}

/// Used when WeChat OpenSDK is not linked or WECHAT_APP_ID is missing.
struct MockWeChatPayClient: WeChatPaying {
    var isConfigured: Bool { false }

    func pay(with params: WeChatAppPayParams) async throws {
        // Simulate user completing payment in WeChat.
        try await Task.sleep(nanoseconds: 200_000_000)
        _ = params
    }
}

/// Placeholder for real WeChatOpenSDK integration.
/// When SDK + Universal Links + appId are ready, implement registerApp + payReq here.
struct LiveWeChatPayClient: WeChatPaying {
    var isConfigured: Bool { WeChatPayConfig.isSDKConfigured }

    func pay(with params: WeChatAppPayParams) async throws {
        guard isConfigured else {
            throw WeChatPayError.notConfigured
        }
        // TODO: WXApi.send(PayReq) with params when WeChatOpenSDK is added to the project.
        // Until then, fall through is not allowed — callers should use factory mock.
        throw WeChatPayError.failed("WeChat OpenSDK is not linked in this build")
    }
}

enum WeChatPayClientFactory {
    static func make() -> any WeChatPaying {
        if WeChatPayConfig.isSDKConfigured {
            return LiveWeChatPayClient()
        }
        return MockWeChatPayClient()
    }
}
