import AuthenticationServices
import SwiftUI

private enum LoginField: Hashable {
    case phone, code
}

struct LoginView: View {
    @EnvironmentObject private var authSession: AuthSession

    @StateObject private var appleSignIn = AppleSignInCoordinator()
    @FocusState private var focusedField: LoginField?

    @State private var phone = ""
    @State private var code = ""
    @State private var isSendingCode = false
    @State private var isLoggingIn = false
    @State private var codeSent = false
    @State private var countdown = 0

    private var canSendCode: Bool {
        phone.filter(\.isNumber).count >= 11 && countdown == 0 && !isSendingCode
    }

    private var canLogin: Bool {
        phone.filter(\.isNumber).count >= 11 && code.count >= 4 && !isLoggingIn
    }

    private var phoneLoginEnabled: Bool { BackendConfig.isPhoneLoginEnabled }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DS.Space.xl) {
                header
                if let message = authSession.errorMessage ?? appleSignIn.errorMessage {
                    errorBanner(message)
                }
                if phoneLoginEnabled {
                    phoneSection
                    codeSection
                    DSPrimaryButton(
                        title: isLoggingIn ? "登录中..." : "登录",
                        systemImage: "arrow.right.circle.fill",
                        isEnabled: canLogin && !isLoggingIn,
                        action: login
                    )
                    .accessibilityIdentifier("loginButton")

                    divider
                }
                appleSection
                retrySection
            }
            .padding(DS.Space.lg)
        }
        .background(Color.dsBackground)
        .onAppear {
            appleSignIn.onSuccess = { token in
                Task { await loginWithApple(token) }
            }
            resumeCountdownIfNeeded()
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: DS.Space.sm) {
            HStack(spacing: DS.Space.md) {
                Image(systemName: "bubble.left.and.bubble.right.fill")
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(Color.dsPrimary)
                    .frame(width: 44, height: 44)
                    .background(Color.dsPrimarySoft.opacity(0.85), in: RoundedRectangle(cornerRadius: DS.Radius.md, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    Text("登录 Talk&Talk")
                        .font(.system(size: DS.TypeScale.title, weight: .semibold))
                        .foregroundStyle(Color.dsTextPrimary)
                    Text(
                        phoneLoginEnabled
                            ? "手机号或 Apple 登录，安全开始陪伴。"
                            : "使用 Apple 登录，安全开始陪伴。"
                    )
                        .font(.system(size: DS.TypeScale.caption))
                        .foregroundStyle(Color.dsTextSecondary)
                }
            }
        }
    }

    private var phoneSection: some View {
        VStack(alignment: .leading, spacing: DS.Space.sm) {
            Text("手机号")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Color.dsTextSecondary)
            HStack(spacing: DS.Space.sm) {
                DSInputField(
                    placeholder: "请输入手机号",
                    text: $phone,
                    keyboardType: .phonePad
                )
                .focused($focusedField, equals: .phone)
                .accessibilityIdentifier("loginPhoneField")

                Button(action: sendCode) {
                    Text(countdown > 0 ? "\(countdown)s" : "获取验证码")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(canSendCode ? Color.dsPrimary : Color.dsTextSecondary)
                        .frame(minWidth: 88)
                        .padding(.vertical, DS.Space.sm)
                }
                .disabled(!canSendCode)
                .accessibilityIdentifier("sendCodeButton")
            }
        }
    }

    private var codeSection: some View {
        VStack(alignment: .leading, spacing: DS.Space.sm) {
            Text("验证码")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Color.dsTextSecondary)
            DSInputField(
                placeholder: "请输入 6 位验证码",
                text: $code,
                keyboardType: .numberPad
            )
            .focused($focusedField, equals: .code)
            .accessibilityIdentifier("loginCodeField")
        }
    }

    private var divider: some View {
        HStack {
            Rectangle().fill(Color.dsBorder).frame(height: 1)
            Text("或")
                .font(.system(size: 13))
                .foregroundStyle(Color.dsTextSecondary)
            Rectangle().fill(Color.dsBorder).frame(height: 1)
        }
    }

    private var appleSection: some View {
        VStack(alignment: .leading, spacing: DS.Space.sm) {
            SignInWithAppleButton(.signIn) { request in
                request.requestedScopes = [.fullName, .email]
            } onCompletion: { result in
                switch result {
                case .success(let authorization):
                    guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
                          let tokenData = credential.identityToken,
                          let identityToken = String(data: tokenData, encoding: .utf8) else {
                        authSession.errorMessage = "无法获取 Apple 登录凭证"
                        return
                    }
                    Task { await loginWithApple(identityToken) }
                case .failure(let error):
                    let nsError = error as NSError
                    if nsError.domain == ASAuthorizationError.errorDomain,
                       nsError.code == ASAuthorizationError.canceled.rawValue {
                        return
                    }
                    authSession.errorMessage = "Apple 登录失败，请在真机或已登录 iCloud 的模拟器上重试"
                }
            }
            .signInWithAppleButtonStyle(.black)
            .frame(height: DS.ControlHeight.lg)
            .accessibilityIdentifier("appleSignInButton")

            Text("模拟器如未登录 Apple ID，请在真机上使用 Apple 登录。")
                .font(.system(size: 12))
                .foregroundStyle(Color.dsTextSecondary)
        }
    }

    private var retrySection: some View {
        VStack(alignment: .leading, spacing: DS.Space.sm) {
            if BackendConfig.baseURL == nil {
                errorBanner("未配置后端地址，请在 Info.plist 或 Scheme 中设置 BACKEND_BASE_URL。")
            }
            DSSecondaryButton(title: "检查连接并重试") {
                authSession.errorMessage = nil
                Task { await authSession.bootstrap() }
            }
            .accessibilityIdentifier("loginRetryButton")
        }
    }

    private func errorBanner(_ message: String) -> some View {
        DSBanner(
            title: "无法完成操作",
            message: message,
            systemImage: "exclamationmark.triangle.fill",
            tone: .warning
        )
    }

    private func sendCode() {
        guard canSendCode else { return }
        isSendingCode = true
        Task {
            defer { isSendingCode = false }
            do {
                try await authSession.sendCode(phone: phone)
                codeSent = true
                countdown = 60
                Task { await runCountdown() }
            } catch {
                // errorMessage set by AuthSession
            }
        }
    }

    private func login() {
        guard canLogin else { return }
        isLoggingIn = true
        Task {
            defer { isLoggingIn = false }
            do {
                try await authSession.loginWithPhone(phone: phone, code: code)
            } catch {
                // errorMessage set by AuthSession
            }
        }
    }

    private func loginWithApple(_ identityToken: String) async {
        isLoggingIn = true
        defer { isLoggingIn = false }
        do {
            try await authSession.loginWithApple(identityToken: identityToken)
        } catch {
            // errorMessage set by AuthSession
        }
    }

    private func runCountdown() async {
        while countdown > 0 {
            try? await Task.sleep(for: .seconds(1))
            countdown -= 1
        }
    }

    private func resumeCountdownIfNeeded() {
        guard codeSent, countdown > 0 else { return }
        Task { await runCountdown() }
    }
}
