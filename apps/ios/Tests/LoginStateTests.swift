import XCTest
@testable import TalkAndTalk

@MainActor
final class LoginStateTests: XCTestCase {
    func testApplyAuthenticatedUserReplacesMockUser() {
        let store = AppStore()
        let authenticated = User(
            id: "api-user-1",
            name: "登录用户",
            phone: "138****8000",
            age: 18,
            gender: nil,
            isVerified: false,
            safetyScore: 80,
            accountStatus: .active,
            violationCount: 0,
            lastViolationAt: nil,
            warnGraceStrikeCount: 0
        )

        store.applyAuthenticatedUser(authenticated)

        XCTAssertEqual(store.user.id, "api-user-1")
        XCTAssertNotEqual(store.user.id, MockData.user.id)
    }
}
