import Foundation

/// Pure ranking for Discover home recommended / tonight strips.
/// Prefer online → verified → higher rating → more reviews.
enum HomeCompanionSorter {
    static func sorted(_ companions: [Companion]) -> [Companion] {
        companions.sorted { lhs, rhs in
            compare(lhs, rhs)
        }
    }

    /// Returns true when `lhs` should appear before `rhs`.
    static func compare(_ lhs: Companion, _ rhs: Companion) -> Bool {
        let left = score(for: lhs)
        let right = score(for: rhs)
        if left.0 != right.0 { return left.0 > right.0 }
        if left.1 != right.1 { return left.1 > right.1 }
        if left.2 != right.2 { return left.2 > right.2 }
        return left.3 > right.3
    }

    static func score(for companion: Companion) -> (Int, Int, Double, Int) {
        (
            availabilityRank(for: companion.availability),
            companion.isVerified ? 1 : 0,
            companion.rating,
            companion.reviewCount
        )
    }

    static func availabilityRank(for status: AvailabilityStatus) -> Int {
        switch status {
        case .online: 2
        case .available: 1
        case .busy: 0
        }
    }
}

/// Centralized empty-state copy for cold-start / offline product shell.
/// Keeps Discover, list, messages, and orders calm and intentional—not broken placeholders.
enum MarketplaceEmptyCopy {
    enum Surface: Equatable {
        case recommendedCompanions
        case tonightAvailable
        case companionList(filter: CompanionListFilterKind)
        case messages(isSearching: Bool)
        case orders
        case communityFeed
        case communityTopicQuiet
    }

    enum CompanionListFilterKind: Equatable {
        case all
        case online
        case verified
        case availableTonight
        case budgetFriendly
    }

    struct Content: Equatable {
        let symbol: String
        let title: String
        let subtitle: String
        let actionTitle: String?
    }

    static func content(for surface: Surface) -> Content {
        switch surface {
        case .recommendedCompanions:
            return Content(
                symbol: "person.2.slash",
                title: "暂无推荐陪伴者",
                subtitle: "合适的人上线后会出现在这里。也可以从心情入口先选一个主题。",
                actionTitle: nil
            )
        case .tonightAvailable:
            return Content(
                symbol: "moon.zzz",
                title: "今晚暂时没有可聊的人",
                subtitle: "可以先看看全部陪伴者，找到适合稍后沟通的人。",
                actionTitle: "查看全部"
            )
        case .companionList(let filter):
            switch filter {
            case .all:
                return Content(
                    symbol: "person.2.slash",
                    title: "暂无匹配陪伴者",
                    subtitle: "可以放宽筛选条件，或返回发现页换个入口。",
                    actionTitle: "放宽筛选"
                )
            case .online:
                return Content(
                    symbol: "wifi",
                    title: "暂时没有在线陪伴者",
                    subtitle: "稍后再来，或切换到「全部」看看可预约的人。",
                    actionTitle: "放宽筛选"
                )
            case .verified:
                return Content(
                    symbol: "checkmark.shield",
                    title: "暂无已实名陪伴者",
                    subtitle: "实名陪伴者会优先展示；可先放宽筛选。",
                    actionTitle: "放宽筛选"
                )
            case .availableTonight:
                return Content(
                    symbol: "moon.zzz",
                    title: "今晚暂时没有可聊的人",
                    subtitle: "可以放宽筛选，或看看其他时段可预约的陪伴者。",
                    actionTitle: "放宽筛选"
                )
            case .budgetFriendly:
                return Content(
                    symbol: "yensign.circle",
                    title: "当前预算下暂无结果",
                    subtitle: "试试提高预算，或切换到推荐排序看看更多选项。",
                    actionTitle: "放宽筛选"
                )
            }
        case .messages(let isSearching):
            if isSearching {
                return Content(
                    symbol: "magnifyingglass",
                    title: "没有找到相关会话",
                    subtitle: "换个姓名或消息关键词再试试。",
                    actionTitle: nil
                )
            }
            return Content(
                symbol: "bubble.left.and.bubble.right",
                title: "暂无沟通会话",
                subtitle: "从发现页选择陪伴者开始试聊，或在广场继续平台内沟通。",
                actionTitle: nil
            )
        case .orders:
            return Content(
                symbol: "calendar.badge.clock",
                title: "暂无订单",
                subtitle: "去发现页选择陪伴者，开始第一次平台内沟通。",
                actionTitle: "去发现"
            )
        case .communityFeed:
            return Content(
                symbol: "text.bubble",
                title: "广场还在等第一条声音",
                subtitle: "可以先说说此刻想聊的事，也可以稍后回来看看。",
                actionTitle: "发布"
            )
        case .communityTopicQuiet:
            return Content(
                symbol: "leaf",
                title: "这个话题暂时安静",
                subtitle: "换个话题看看，或者发一条让合适的人看见。",
                actionTitle: "查看全部话题"
            )
        }
    }
}
