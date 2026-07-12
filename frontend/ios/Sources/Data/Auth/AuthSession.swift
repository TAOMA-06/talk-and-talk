import Foundation

enum AuthState: Equatable {
    case loading
    case unauthenticated
    case authenticated(User)

    static func == (lhs: AuthState, rhs: AuthState) -> Bool {
        switch (lhs, rhs) {
        case (.loading, .loading), (.unauthenticated, .unauthenticated): return true
        case (.authenticated(let a), .authenticated(let b)): return a.id == b.id
        default: return false
        }
    }
}

@MainActor
final class AuthSession: ObservableObject {
    @Published var state: AuthState = .loading
    @Published var errorMessage: String?

    private let tokenStore: TokenStoring
    private let clientFactory: (URL) -> any AuthAPIClient
    private let usesOfflineIdentity: Bool
    private var isRefreshing = false

    init(
        tokenStore: TokenStoring = KeychainTokenStore(),
        clientFactory: @escaping (URL) -> any AuthAPIClient = { BackendAuthClient(baseURL: $0) },
        offlineIdentityEnabled: Bool? = nil
    ) {
        self.tokenStore = tokenStore
        self.clientFactory = clientFactory
        #if DEBUG
        self.usesOfflineIdentity = offlineIdentityEnabled ?? FrontendDemoMode.isEnabled
        #else
        self.usesOfflineIdentity = false
        #endif
    }

    var accessToken: String? { usesOfflineIdentity ? nil : tokenStore.getAccessToken() }

    func bootstrap() async {
        guard !usesOfflineIdentity else {
            #if DEBUG
            state = .authenticated(FrontendDemoIdentity.user)
            #endif
            return
        }

        guard tokenStore.getAccessToken() != nil else {
            state = .unauthenticated
            return
        }

        if let expiresAt = tokenStore.getExpiresAt(), expiresAt < Date() {
            await refreshIfNeeded()
            if case .unauthenticated = state { return }
        }

        guard let client = makeClient() else {
            state = .unauthenticated
            return
        }

        do {
            let userResponse = try await client.fetchCurrentUser(accessToken: tokenStore.getAccessToken()!)
            state = .authenticated(AuthDTOMapper.user(from: userResponse))
        } catch {
            await refreshIfNeeded()
            if case .unauthenticated = state { return }
            guard let token = tokenStore.getAccessToken(), let client = makeClient() else {
                state = .unauthenticated
                return
            }
            do {
                let userResponse = try await client.fetchCurrentUser(accessToken: token)
                state = .authenticated(AuthDTOMapper.user(from: userResponse))
            } catch {
                clearAndLogout()
            }
        }
    }

    func sendCode(phone: String) async throws {
        guard let client = makeClient() else {
            throw BackendError.unavailable
        }
        errorMessage = nil
        do {
            _ = try await client.sendVerificationCode(phone: phone)
        } catch let error as BackendError {
            errorMessage = error.userFacingMessage
            throw error
        }
    }

    func loginWithPhone(phone: String, code: String) async throws {
        guard let client = makeClient() else {
            throw BackendError.unavailable
        }
        errorMessage = nil
        do {
            let response = try await client.loginWithPhone(phone: phone, code: code)
            saveTokens(from: response)
            state = .authenticated(AuthDTOMapper.user(from: response.user))
        } catch let error as BackendError {
            errorMessage = error.userFacingMessage
            throw error
        }
    }

    func loginWithApple(identityToken: String) async throws {
        guard let client = makeClient() else {
            throw BackendError.unavailable
        }
        errorMessage = nil
        do {
            let response = try await client.loginWithApple(identityToken: identityToken)
            saveTokens(from: response)
            state = .authenticated(AuthDTOMapper.user(from: response.user))
        } catch let error as BackendError {
            errorMessage = error.userFacingMessage
            throw error
        }
    }

    func logout() async {
        guard !usesOfflineIdentity else {
            #if DEBUG
            state = .authenticated(FrontendDemoIdentity.user)
            #endif
            return
        }

        if let refreshToken = tokenStore.getRefreshToken(),
           let accessToken = tokenStore.getAccessToken(),
           let client = makeClient() {
            try? await client.logout(accessToken: accessToken, refreshToken: refreshToken)
        }
        clearAndLogout()
    }

    func refreshIfNeeded() async {
        guard !usesOfflineIdentity else {
            #if DEBUG
            state = .authenticated(FrontendDemoIdentity.user)
            #endif
            return
        }

        guard !isRefreshing else { return }
        isRefreshing = true
        defer { isRefreshing = false }

        guard let refreshToken = tokenStore.getRefreshToken(), let client = makeClient() else {
            clearAndLogout()
            return
        }

        do {
            let response = try await client.refreshTokens(refreshToken: refreshToken)
            saveTokens(from: response)
        } catch {
            clearAndLogout()
        }
    }

    private func saveTokens(from response: AuthTokensResponse) {
        let expiresAt = Date().addingTimeInterval(TimeInterval(response.expiresIn))
        tokenStore.save(accessToken: response.accessToken, refreshToken: response.refreshToken, expiresAt: expiresAt)
    }

    private func saveTokens(from tokens: RefreshTokensResponse) {
        let expiresAt = Date().addingTimeInterval(TimeInterval(tokens.expiresIn))
        tokenStore.save(accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, expiresAt: expiresAt)
    }

    private func clearAndLogout() {
        tokenStore.clear()
        state = .unauthenticated
    }

    private func makeClient() -> AuthAPIClient? {
        guard let baseURL = BackendConfig.baseURL else { return nil }
        return clientFactory(baseURL)
    }
}
