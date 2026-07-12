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
        XCTAssertEqual(content.title, "暂无推荐陪伴者")
        XCTAssertFalse(content.subtitle.isEmpty)
        XCTAssertEqual(content.symbol, "person.2.slash")
        // Cold-start shell: guidance only, no fake CTA that invents supply.
        XCTAssertNil(content.actionTitle)
    }

    func testMarketplaceEmptyCopyTonightOffersBrowseAllAction() {
        let content = MarketplaceEmptyCopy.content(for: .tonightAvailable)
        XCTAssertEqual(content.actionTitle, "查看全部")
        XCTAssertTrue(content.subtitle.contains("陪伴者") || content.subtitle.contains("沟通"))
    }

    func testMarketplaceEmptyCopyCompanionListFilters() {
        let online = MarketplaceEmptyCopy.content(for: .companionList(filter: .online))
        XCTAssertEqual(online.title, "暂时没有在线陪伴者")
        XCTAssertEqual(online.actionTitle, "放宽筛选")

        let budget = MarketplaceEmptyCopy.content(for: .companionList(filter: .budgetFriendly))
        XCTAssertEqual(budget.title, "当前预算下暂无结果")
    }

    func testMarketplaceEmptyCopyMessagesAndOrders() {
        let emptyInbox = MarketplaceEmptyCopy.content(for: .messages(isSearching: false))
        XCTAssertEqual(emptyInbox.title, "暂无沟通会话")
        XCTAssertTrue(emptyInbox.subtitle.contains("试聊") || emptyInbox.subtitle.contains("广场"))

        let searchMiss = MarketplaceEmptyCopy.content(for: .messages(isSearching: true))
        XCTAssertEqual(searchMiss.title, "没有找到相关会话")

        let orders = MarketplaceEmptyCopy.content(for: .orders)
        XCTAssertEqual(orders.title, "暂无订单")
        XCTAssertEqual(orders.actionTitle, "去发现")
    }

    func testMarketplaceEmptyCopyCommunitySurfaces() {
        let feed = MarketplaceEmptyCopy.content(for: .communityFeed)
        XCTAssertEqual(feed.title, "广场还在等第一条声音")
        let topic = MarketplaceEmptyCopy.content(for: .communityTopicQuiet)
        XCTAssertEqual(topic.actionTitle, "查看全部话题")
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
