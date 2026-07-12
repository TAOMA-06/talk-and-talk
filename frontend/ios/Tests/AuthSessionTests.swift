import Foundation
import XCTest
@testable import TalkAndTalk

@MainActor
final class AuthSessionTests: XCTestCase {
    func testBootstrapWithoutTokenSetsUnauthenticated() async {
        let store = InMemoryTokenStore()
        let session = AuthSession(
            tokenStore: store,
            clientFactory: { _ in StubAuthClient() },
            offlineIdentityEnabled: false
        )

        await session.bootstrap()

        XCTAssertEqual(session.state, .unauthenticated)
    }

    func testBootstrapWithTokenFetchesCurrentUser() async {
        let store = InMemoryTokenStore()
        store.save(accessToken: "access", refreshToken: "refresh", expiresAt: Date().addingTimeInterval(3600))

        let session = AuthSession(
            tokenStore: store,
            clientFactory: { _ in
                StubAuthClient(currentUser: AuthUserResponse(
                    id: "user-42",
                    role: "user",
                    profile: AuthUserProfileResponse(
                        displayName: "测试用户",
                        phone: "138****8000",
                        age: 25,
                        gender: nil,
                        isVerified: false,
                        safetyScore: 80
                    )
                ))
            },
            offlineIdentityEnabled: false
        )

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

        let session = AuthSession(
            tokenStore: store,
            clientFactory: { _ in StubAuthClient() },
            offlineIdentityEnabled: false
        )
        await session.bootstrap()
        await session.logout()

        XCTAssertEqual(session.state, .unauthenticated)
        XCTAssertNil(store.getAccessToken())
        XCTAssertNil(store.getRefreshToken())
    }

    func testDemoModeAuthenticatesWithoutReadingTokensOrCreatingClient() async {
        let store = InMemoryTokenStore()
        var clientCreated = false
        let session = AuthSession(
            tokenStore: store,
            clientFactory: { _ in
                clientCreated = true
                return StubAuthClient()
            },
            offlineIdentityEnabled: true
        )

        await session.bootstrap()

        guard case .authenticated(let user) = session.state else {
            return XCTFail("Expected demo authentication")
        }
        XCTAssertEqual(user.id, FrontendDemoIdentity.user.id)
        XCTAssertEqual(user.gender, nil)
        XCTAssertNil(session.accessToken)
        XCTAssertFalse(clientCreated)
    }

    func testDemoModeRefreshAndLogoutPreserveTokensAndAvoidClient() async {
        let store = InMemoryTokenStore()
        store.save(accessToken: "access", refreshToken: "refresh", expiresAt: Date().addingTimeInterval(3600))
        var clientCreated = false
        let session = AuthSession(
            tokenStore: store,
            clientFactory: { _ in
                clientCreated = true
                return StubAuthClient()
            },
            offlineIdentityEnabled: true
        )

        await session.refreshIfNeeded()
        await session.logout()

        guard case .authenticated(let user) = session.state else {
            return XCTFail("Expected demo authentication")
        }
        XCTAssertEqual(user.id, FrontendDemoIdentity.user.id)
        XCTAssertEqual(store.getAccessToken(), "access")
        XCTAssertEqual(store.getRefreshToken(), "refresh")
        XCTAssertFalse(clientCreated)
    }

    func testDemoModeEnvironmentOverridesPlistValue() {
#if DEBUG
        XCTAssertTrue(FrontendDemoMode.isEnabled(environment: ["FRONTEND_DEMO_MODE": "YES"], plistValue: "NO"))
        XCTAssertFalse(FrontendDemoMode.isEnabled(environment: ["FRONTEND_DEMO_MODE": "NO"], plistValue: "YES"))
#endif
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
