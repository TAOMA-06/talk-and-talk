import Foundation
import XCTest
@testable import TalkAndTalk

@MainActor
final class AuthSessionTests: XCTestCase {
    func testBootstrapWithoutTokenSetsUnauthenticated() async {
        let store = InMemoryTokenStore()
        let session = AuthSession(tokenStore: store) { _ in
            StubAuthClient()
        }

        await session.bootstrap()

        XCTAssertEqual(session.state, .unauthenticated)
    }

    func testBootstrapWithTokenFetchesCurrentUser() async {
        let store = InMemoryTokenStore()
        store.save(accessToken: "access", refreshToken: "refresh", expiresAt: Date().addingTimeInterval(3600))

        let session = AuthSession(tokenStore: store) { _ in
            StubAuthClient(currentUser: AuthUserResponse(
                id: "user-42",
                role: "user",
                profile: AuthUserProfileResponse(
                    displayName: "测试用户",
                    phone: "138****8000",
                    gender: nil,
                    isVerified: false,
                    safetyScore: 80
                )
            ))
        }

        await session.bootstrap()

        guard case .authenticated(let user) = session.state else {
            return XCTFail("Expected authenticated state")
        }
        XCTAssertEqual(user.id, "user-42")
        XCTAssertEqual(user.name, "测试用户")
    }

    func testLogoutClearsStateAndTokens() async {
        let store = InMemoryTokenStore()
        store.save(accessToken: "access", refreshToken: "refresh", expiresAt: Date().addingTimeInterval(3600))

        let session = AuthSession(tokenStore: store) { _ in StubAuthClient() }
        await session.bootstrap()
        await session.logout()

        XCTAssertEqual(session.state, .unauthenticated)
        XCTAssertNil(store.getAccessToken())
        XCTAssertNil(store.getRefreshToken())
    }
}

private struct StubAuthClient: AuthAPIClient {
    var currentUser: AuthUserResponse = AuthUserResponse(id: "u1", role: "user", profile: nil)

    func sendVerificationCode(phone: String) async throws -> SendCodeResponse {
        SendCodeResponse(expiresInSeconds: 300)
    }

    func loginWithPhone(phone: String, code: String) async throws -> AuthTokensResponse {
        AuthTokensResponse(
            accessToken: "access",
            refreshToken: "refresh",
            expiresIn: 900,
            user: currentUser
        )
    }

    func loginWithApple(identityToken: String) async throws -> AuthTokensResponse {
        try await loginWithPhone(phone: "", code: "")
    }

    func refreshTokens(refreshToken: String) async throws -> RefreshTokensResponse {
        RefreshTokensResponse(accessToken: "access-new", refreshToken: "refresh-new", expiresIn: 900)
    }

    func logout(accessToken: String, refreshToken: String) async throws {}

    func fetchCurrentUser(accessToken: String) async throws -> AuthUserResponse {
        currentUser
    }
}
