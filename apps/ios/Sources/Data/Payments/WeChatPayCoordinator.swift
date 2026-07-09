import Foundation

#if canImport(WechatOpenSDK)
import WechatOpenSDK
#endif

@MainActor
final class WeChatPayCoordinator: NSObject, ObservableObject {
    static let shared = WeChatPayCoordinator()

    #if canImport(WechatOpenSDK)
    private var payContinuation: CheckedContinuation<Void, Error>?
    #endif

    func registerIfNeeded() {
        #if canImport(WechatOpenSDK)
        guard let appId = WeChatPayConfig.appId, !appId.isEmpty else { return }
        let universalLink = WeChatPayConfig.universalLink ?? ""
        WXApi.registerApp(appId, universalLink: universalLink)
        #endif
    }

    func handleOpenURL(_ url: URL) -> Bool {
        #if canImport(WechatOpenSDK)
        return WXApi.handleOpen(url, delegate: self)
        #else
        return false
        #endif
    }

    func handleUniversalLink(_ userActivity: NSUserActivity) -> Bool {
        #if canImport(WechatOpenSDK)
        return WXApi.handleOpenUniversalLink(userActivity, delegate: self)
        #else
        return false
        #endif
    }

    func pay(with params: WeChatAppPayParams) async throws {
        #if canImport(WechatOpenSDK)
        guard WeChatPayConfig.isSDKConfigured else {
            throw WeChatPayError.notConfigured
        }
        guard WXApi.isWXAppInstalled() else {
            throw WeChatPayError.failed("请先安装微信")
        }
        guard payContinuation == nil else {
            throw WeChatPayError.failed("已有支付正在进行中，请稍后再试")
        }

        let request = PayReq()
        request.partnerId = params.partnerId
        request.prepayId = params.prepayId
        request.package = params.package
        request.nonceStr = params.nonceStr
        request.timeStamp = UInt32(params.timeStamp) ?? 0
        request.sign = params.sign

        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            self.payContinuation = continuation
            WXApi.send(request) { [weak self] success in
                Task { @MainActor in
                    guard let self else { return }
                    guard self.payContinuation != nil else { return }
                    guard success else {
                        self.payContinuation = nil
                        continuation.resume(throwing: WeChatPayError.failed("无法调起微信支付"))
                        return
                    }
                }
            }
        }
        #else
        throw WeChatPayError.failed("WeChat OpenSDK is not linked in this build")
        #endif
    }
}

#if canImport(WechatOpenSDK)
extension WeChatPayCoordinator: WXApiDelegate {
    nonisolated func onResp(_ resp: BaseResp) {
        let isPayResponse = resp is PayResp
        let errCode = (resp as? PayResp)?.errCode ?? -1
        let errMessage = (resp as? PayResp)?.errStr ?? ""

        Task { @MainActor in
            guard let continuation = self.payContinuation else { return }
            self.payContinuation = nil

            guard isPayResponse else {
                continuation.resume(throwing: WeChatPayError.failed("未知微信支付响应"))
                return
            }

            switch errCode {
            case WXSuccess.rawValue:
                continuation.resume()
            case WXErrCodeUserCancel.rawValue:
                continuation.resume(throwing: WeChatPayError.cancelled)
            default:
                let message = errMessage.isEmpty ? "微信支付失败（\(errCode)）" : errMessage
                continuation.resume(throwing: WeChatPayError.failed(message))
            }
        }
    }
}
#endif