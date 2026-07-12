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
                symbol: "person.2",
                title: "暂时还没有人在线",
                subtitle: "先选一个心情主题，或稍后再来。",
                actionTitle: nil
            )
        case .tonightAvailable:
            return Content(
                symbol: "moon.zzz",
                title: "今晚暂时没人",
                subtitle: "看看全部可预约的陪伴者吧。",
                actionTitle: "查看全部"
            )
        case .companionList(let filter):
            switch filter {
            case .all:
                return Content(
                    symbol: "person.2",
                    title: "还没有匹配的人",
                    subtitle: "放宽筛选，或换个主题试试。",
                    actionTitle: "放宽筛选"
                )
            case .online:
                return Content(
                    symbol: "wifi",
                    title: "现在没人在线",
                    subtitle: "切换到「全部」看看可预约的人。",
                    actionTitle: "放宽筛选"
                )
            case .verified:
                return Content(
                    symbol: "checkmark.shield",
                    title: "暂无已实名",
                    subtitle: "可先放宽筛选再看看。",
                    actionTitle: "放宽筛选"
                )
            case .availableTonight:
                return Content(
                    symbol: "moon.zzz",
                    title: "今晚暂时没人",
                    subtitle: "放宽筛选，或看看其他时段。",
                    actionTitle: "放宽筛选"
                )
            case .budgetFriendly:
                return Content(
                    symbol: "yensign.circle",
                    title: "这个预算没有结果",
                    subtitle: "试试放宽筛选或换个排序。",
                    actionTitle: "放宽筛选"
                )
            }
        case .messages(let isSearching):
            if isSearching {
                return Content(
                    symbol: "magnifyingglass",
                    title: "没找到会话",
                    subtitle: "换个名字或关键词试试。",
                    actionTitle: nil
                )
            }
            return Content(
                symbol: "bubble.left.and.bubble.right",
                title: "还没有会话",
                subtitle: "去发现页找人试聊，或逛逛广场。",
                actionTitle: nil
            )
        case .orders:
            return Content(
                symbol: "calendar.badge.clock",
                title: "还没有订单",
                subtitle: "去发现页找一位陪伴者开始吧。",
                actionTitle: "去发现"
            )
        case .communityFeed:
            return Content(
                symbol: "text.bubble",
                title: "广场还很安静",
                subtitle: "说说你想聊的，让合适的人看见。",
                actionTitle: "发布"
            )
        case .communityTopicQuiet:
            return Content(
                symbol: "leaf",
                title: "这个话题还安静",
                subtitle: "换个话题，或发一条自己的。",
                actionTitle: "查看全部"
            )
        }
    }
}
