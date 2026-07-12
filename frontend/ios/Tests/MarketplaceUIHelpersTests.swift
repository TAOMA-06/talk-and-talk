import XCTest
@testable import TalkAndTalk

final class MarketplaceUIHelpersTests: XCTestCase {
    func testHomeCompanionSorterPrefersOnlineThenVerifiedThenRating() {
        let busy = makeCompanion(id: "busy", availability: .busy, verified: true, rating: 5.0, reviews: 100)
        let onlineUnverified = makeCompanion(id: "online-u", availability: .online, verified: false, rating: 4.2, reviews: 10)
        let onlineVerified = makeCompanion(id: "online-v", availability: .online, verified: true, rating: 4.5, reviews: 20)
        let availableVerifiedHigh = makeCompanion(id: "avail-hi", availability: .available, verified: true, rating: 4.9, reviews: 50)
        let onlineVerifiedHigher = makeCompanion(id: "online-v2", availability: .online, verified: true, rating: 4.8, reviews: 5)

        let sorted = HomeCompanionSorter.sorted([
            busy, onlineUnverified, availableVerifiedHigh, onlineVerified, onlineVerifiedHigher
        ])

        XCTAssertEqual(sorted.map(\.id), [
            "online-v2",
            "online-v",
            "online-u",
            "avail-hi",
            "busy"
        ])
    }

    func testHomeCompanionSorterAvailabilityRank() {
        XCTAssertEqual(HomeCompanionSorter.availabilityRank(for: .online), 2)
        XCTAssertEqual(HomeCompanionSorter.availabilityRank(for: .available), 1)
        XCTAssertEqual(HomeCompanionSorter.availabilityRank(for: .busy), 0)
    }

    func testMarketplaceEmptyCopyRecommendedCompanionsIsIntentionalProductUX() {
        let content = MarketplaceEmptyCopy.content(for: .recommendedCompanions)
        XCTAssertEqual(content.title, "暂时还没有人在线")
        XCTAssertFalse(content.subtitle.isEmpty)
        XCTAssertEqual(content.symbol, "person.2")
        // Cold-start shell: guidance only, no fake CTA that invents supply.
        XCTAssertNil(content.actionTitle)
    }

    func testMarketplaceEmptyCopyTonightOffersBrowseAllAction() {
        let content = MarketplaceEmptyCopy.content(for: .tonightAvailable)
        XCTAssertEqual(content.actionTitle, "查看全部")
        XCTAssertFalse(content.subtitle.isEmpty)
    }

    func testMarketplaceEmptyCopyCompanionListFilters() {
        let online = MarketplaceEmptyCopy.content(for: .companionList(filter: .online))
        XCTAssertEqual(online.title, "现在没人在线")
        XCTAssertEqual(online.actionTitle, "放宽筛选")

        let budget = MarketplaceEmptyCopy.content(for: .companionList(filter: .budgetFriendly))
        XCTAssertEqual(budget.title, "这个预算没有结果")
    }

    func testMarketplaceEmptyCopyMessagesAndOrders() {
        let emptyInbox = MarketplaceEmptyCopy.content(for: .messages(isSearching: false))
        XCTAssertEqual(emptyInbox.title, "还没有会话")
        XCTAssertTrue(emptyInbox.subtitle.contains("试聊") || emptyInbox.subtitle.contains("广场"))

        let searchMiss = MarketplaceEmptyCopy.content(for: .messages(isSearching: true))
        XCTAssertEqual(searchMiss.title, "没找到会话")

        let orders = MarketplaceEmptyCopy.content(for: .orders)
        XCTAssertEqual(orders.title, "还没有订单")
        XCTAssertEqual(orders.actionTitle, "去发现")
    }

    func testMarketplaceEmptyCopyCommunitySurfaces() {
        let feed = MarketplaceEmptyCopy.content(for: .communityFeed)
        XCTAssertEqual(feed.title, "广场还很安静")
        let topic = MarketplaceEmptyCopy.content(for: .communityTopicQuiet)
        XCTAssertEqual(topic.actionTitle, "查看全部")
    }

    @MainActor
    func testAppStoreStillStartsWithoutSeededMarketplaceUsers() {
        // Regression: offline demo must remain a product shell without fake supply.
        let store = AppStore()
        XCTAssertTrue(store.companions.isEmpty)
        XCTAssertTrue(store.communityPosts.isEmpty)
        XCTAssertTrue(store.orders.isEmpty)
        XCTAssertTrue(store.messages.isEmpty)
        XCTAssertFalse(store.themes.isEmpty)
    }

    private func makeCompanion(
        id: String,
        availability: AvailabilityStatus,
        verified: Bool,
        rating: Double,
        reviews: Int
    ) -> Companion {
        Companion(
            id: id,
            name: id,
            role: "测试",
            initials: "测",
            tags: [],
            rating: rating,
            reviewCount: reviews,
            pricePerHalfHour: 39,
            isOnline: availability == .online,
            isVerified: verified,
            bio: "test",
            availableTimes: ["20:00"],
            languages: ["中文"],
            specialties: ["情绪倾听"],
            completedOrders: reviews,
            responseTime: "约1分钟",
            distanceKm: 1,
            availability: availability,
            cityDistrict: "测试"
        )
    }
}
