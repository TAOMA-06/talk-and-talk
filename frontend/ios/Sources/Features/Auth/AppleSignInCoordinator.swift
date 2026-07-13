import AuthenticationServices
import Foundation
import UIKit

@MainActor
final class AppleSignInCoordinator: NSObject, ObservableObject {
    @Published var errorMessage: String?

    func signIn() {
        errorMessage = nil
        let provider = ASAuthorizationAppleIDProvider()
        let request = provider.createRequest()
        request.requestedScopes = [.fullName, .email]

        let controller = ASAuthorizationController(authorizationRequests: [request])
        controller.delegate = self
        controller.presentationContextProvider = self
        controller.performRequests()
    }

    var onSuccess: ((String) -> Void)?
}

extension AppleSignInCoordinator: ASAuthorizationControllerDelegate {
    nonisolated func authorizationController(
        controller: ASAuthorizationController,
        didCompleteWithAuthorization authorization: ASAuthorization
    ) {
        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
              let tokenData = credential.identityToken,
              let identityToken = String(data: tokenData, encoding: .utf8) else {
            Task { @MainActor in
                self.errorMessage = "无法获取 Apple 登录凭证"
            }
            return
        }

        Task { @MainActor in
            self.onSuccess?(identityToken)
        }
    }

    nonisolated func authorizationController(
        controller: ASAuthorizationController,
        didCompleteWithError error: Error
    ) {
        let nsError = error as NSError
        if nsError.domain == ASAuthorizationError.errorDomain,
           nsError.code == ASAuthorizationError.canceled.rawValue {
            return
        }

        Task { @MainActor in
            self.errorMessage = "Apple 登录失败，请在真机或已登录 iCloud 的模拟器上重试"
        }
    }
}

extension AppleSignInCoordinator: ASAuthorizationControllerPresentationContextProviding {
    nonisolated func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        // AuthenticationServices usually calls this on the main thread; fall back safely if not.
        let resolveAnchor: () -> ASPresentationAnchor = {
            let scenes = UIApplication.shared.connectedScenes
            let windowScene = scenes.first { $0.activationState == .foregroundActive } as? UIWindowScene
            let window = windowScene?.windows.first { $0.isKeyWindow }
            return window ?? ASPresentationAnchor()
        }
        if Thread.isMainThread {
            return MainActor.assumeIsolated(resolveAnchor)
        }
        return DispatchQueue.main.sync {
            MainActor.assumeIsolated(resolveAnchor)
        }
    }
}
