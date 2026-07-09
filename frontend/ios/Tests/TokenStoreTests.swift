import XCTest
@testable import TalkAndTalk

final class TokenStoreTests: XCTestCase {
    func testSaveAndReadTokens() {
        let store = InMemoryTokenStore()
        let expiresAt = Date().addingTimeInterval(900)

        store.save(accessToken: "access-1", refreshToken: "refresh-1", expiresAt: expiresAt)

        XCTAssertEqual(store.getAccessToken(), "access-1")
        XCTAssertEqual(store.getRefreshToken(), "refresh-1")
        XCTAssertEqual(store.getExpiresAt()?.timeIntervalSince1970 ?? 0, expiresAt.timeIntervalSince1970, accuracy: 0.001)
    }

    func testClearRemovesTokens() {
        let store = InMemoryTokenStore()
        store.save(accessToken: "access-1", refreshToken: "refresh-1", expiresAt: Date())

        store.clear()

        XCTAssertNil(store.getAccessToken())
        XCTAssertNil(store.getRefreshToken())
        XCTAssertNil(store.getExpiresAt())
    }
}
