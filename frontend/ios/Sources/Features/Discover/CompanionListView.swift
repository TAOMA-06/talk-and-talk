import SwiftUI

struct CompanionListView: View {
    let themeId: String?
    var preset: ListPreset?
    @EnvironmentObject private var store: AppStore
    @Environment(\.dismiss) private var dismiss
    @State private var filter: FilterType
    @State private var sort: SortType

    enum FilterType: String, CaseIterable {
        case all = "全部"
        case online = "在线"
        case verified = "已实名"
        case availableTonight = "今晚可聊"
        case budgetFriendly = "预算友好"
    }

    enum SortType: String, CaseIterable {
        case recommended = "推荐"
        case rating = "评分高"
        case price = "价格低"
        case response = "响应快"
    }

    init(themeId: String?, preset: ListPreset?) {
        self.themeId = themeId
        self.preset = preset
        switch preset {
        case .availableTonight:
            _filter = State(initialValue: .availableTonight)
            _sort = State(initialValue: .recommended)
        case .budgetFriendly:
            _filter = State(initialValue: .budgetFriendly)
            _sort = State(initialValue: .price)
        case nil:
            _filter = State(initialValue: .all)
            _sort = State(initialValue: .recommended)
        }
    }

    private var title: String {
        store.theme(by: themeId)?.name ?? "全部陪伴者"
    }

    private var filteredCompanions: [Companion] {
        var result = store.companions(for: themeId)
        switch filter {
        case .all: break
        case .online: result = result.filter { $0.availability == .online }
        case .verified: result = result.filter(\.isVerified)
        case .availableTonight: result = result.filter { $0.availability != .busy }
        case .budgetFriendly: result = result.filter { $0.pricePerHalfHour <= 35 }
        }

        switch sort {
        case .recommended:
            result.sort { isRecommended($0, before: $1) }
        case .rating:
            result.sort { lhs, rhs in
                if lhs.rating != rhs.rating { return lhs.rating > rhs.rating }
                return isRecommended(lhs, before: rhs)
            }
        case .price:
            result.sort { lhs, rhs in
                if lhs.pricePerHalfHour != rhs.pricePerHalfHour {
                    return lhs.pricePerHalfHour < rhs.pricePerHalfHour
                }
                return isRecommended(lhs, before: rhs)
            }
        case .response:
            result.sort { lhs, rhs in
                let left = responseSeconds(lhs.responseTime)
                let right = responseSeconds(rhs.responseTime)
                if left != right { return left < right }
                return isRecommended(lhs, before: rhs)
            }
        }
        return result
    }

    var body: some View {
        AppScaffold(title: title, spacing: DS.Space.lg) {
            let companions = filteredCompanions
            let baseCompanions = store.companions(for: themeId)
            ListHeader(
                title: title,
                count: companions.count,
                onlineCount: baseCompanions.filter { $0.availability == .online }.count,
                availableCount: baseCompanions.filter { $0.availability != .busy }.count
            )
            FilterStrip(filter: $filter, sort: $sort)
            if companions.isEmpty {
                switch store.companionListLoadState {
                case .loading:
                    CompanionListLoadingState()
                case .failed(let message):
                    CompanionListErrorState(message: message) {
                        Task { await store.loadCompanions(pageSize: 50) }
                    }
                default:
                    CompanionListEmptyState(
                        title: emptyTitle,
                        subtitle: emptySubtitle,
                        reset: resetFilters,
                        back: { dismiss() }
                    )
                }
            } else {
                LazyVStack(spacing: DS.Space.sm) {
                    ForEach(companions) { companion in
                        Button {
                            store.navigate(.companionDetail(companion.id))
                        } label: {
                            CompanionSummaryCard(companion: companion)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("查看\(companion.name)详情，\(companion.role)，\(companion.availability.displayName)")
                        .accessibilityIdentifier("companionListCard-\(companion.id)")
                    }
                }
            }
        }
        .accessibilityIdentifier("companionListView")
        .task {
            if store.companionListLoadState == .idle {
                await store.loadCompanions(pageSize: 50)
            }
        }
    }

    private func resetFilters() {
        filter = .all
        sort = .recommended
    }

    private var emptyTitle: String {
        switch filter {
        case .online:
            return "暂时没有在线陪伴者"
        case .verified:
            return "暂无已实名陪伴者"
        case .availableTonight:
            return "今晚暂时没有可聊的人"
        case .budgetFriendly:
            return "当前预算下暂无结果"
        case .all:
            return "暂无匹配陪伴者"
        }
    }

    private var emptySubtitle: String {
        if themeId != nil {
            return "这个主题下暂时没有合适的人，可以放宽筛选，或返回发现页换个入口。"
        }
        return "可以放宽筛选条件，先看看更多可聊的人。"
    }

    private func isRecommended(_ lhs: Companion, before rhs: Companion) -> Bool {
        let leftAvailability = availabilityRank(for: lhs.availability)
        let rightAvailability = availabilityRank(for: rhs.availability)
        if leftAvailability != rightAvailability { return leftAvailability > rightAvailability }
        if lhs.isVerified != rhs.isVerified { return lhs.isVerified && !rhs.isVerified }
        if lhs.rating != rhs.rating { return lhs.rating > rhs.rating }
        if lhs.reviewCount != rhs.reviewCount { return lhs.reviewCount > rhs.reviewCount }

        let leftResponse = responseSeconds(lhs.responseTime)
        let rightResponse = responseSeconds(rhs.responseTime)
        if leftResponse != rightResponse { return leftResponse < rightResponse }

        return lhs.pricePerHalfHour < rhs.pricePerHalfHour
    }

    private func availabilityRank(for status: AvailabilityStatus) -> Int {
        switch status {
        case .online: 2
        case .available: 1
        case .busy: 0
        }
    }

    private func responseSeconds(_ value: String) -> Int {
        let digits = value.filter { $0.isNumber }
        guard let amount = Int(digits) else { return Int.max }
        if value.contains("秒") { return amount }
        if value.contains("分钟") { return amount * 60 }
        return Int.max
    }
}

private struct CompanionListLoadingState: View {
    var body: some View {
        DSCard(padding: DS.Space.xl) {
            VStack(spacing: DS.Space.md) {
                ProgressView()
                Text("正在加载陪伴者")
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(Color.dsTextSecondary)
            }
            .frame(maxWidth: .infinity)
        }
        .accessibilityIdentifier("companionListLoadingState")
    }
}

private struct CompanionListErrorState: View {
    let message: String
    let retry: () -> Void

    var body: some View {
        DSCard(padding: DS.Space.xl) {
            EmptyStateView(
                symbol: "wifi.exclamationmark",
                title: "陪伴者加载失败",
                subtitle: message,
                actionTitle: "重试",
                action: retry
            )
        }
        .accessibilityIdentifier("companionListErrorState")
    }
}

private struct CompanionListEmptyState: View {
    let title: String
    let subtitle: String
    let reset: () -> Void
    let back: () -> Void

    var body: some View {
        DSCard(padding: DS.Space.xl) {
            VStack(spacing: DS.Space.md) {
                DSInitialsAvatar(initials: "", tone: .neutral, size: 56)
                    .overlay {
                        Image(systemName: "person.2.slash")
                            .font(.system(size: 24, weight: .regular))
                            .foregroundStyle(Color.dsPrimary)
                    }

                VStack(spacing: DS.Space.xxs) {
                    Text(title)
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(Color.dsTextPrimary)
                    Text(subtitle)
                        .font(.system(size: 13))
                        .foregroundStyle(Color.dsTextSecondary)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                }

                HStack(spacing: DS.Space.sm) {
                    DSButton(title: "放宽筛选", variant: .primary, action: reset)
                        .accessibilityIdentifier("companionListResetFilters")
                    DSButton(title: "返回发现", variant: .secondary, maxWidth: 108, action: back)
                        .accessibilityIdentifier("companionListBackToDiscover")
                }
            }
            .frame(maxWidth: .infinity)
        }
        .accessibilityIdentifier("companionListEmptyState")
    }
}

private struct ListHeader: View {
    let title: String
    let count: Int
    let onlineCount: Int
    let availableCount: Int

    var body: some View {
        DSCard(padding: DS.Space.md) {
            VStack(alignment: .leading, spacing: DS.Space.md) {
                HStack(alignment: .lastTextBaseline, spacing: DS.Space.md) {
                    VStack(alignment: .leading, spacing: DS.Space.xxs) {
                        Text(title)
                            .font(.system(size: 22, weight: .semibold))
                            .foregroundStyle(Color.dsTextPrimary)
                        Text("仅展示平台内线上文字/语音服务")
                            .font(.system(size: 12))
                            .foregroundStyle(Color.dsTextSecondary)
                    }

                    Spacer()

                    Text("\(count)人")
                        .font(.system(size: 20, weight: .semibold))
                        .foregroundStyle(Color.dsTextPrimary)
                }

                HStack(spacing: DS.Space.sm) {
                    StatusPill(text: "\(onlineCount) 在线", symbol: "dot.radiowaves.left.and.right", color: Color.dsPrimary)
                    StatusPill(text: "\(availableCount) 可聊", symbol: "bubble.left.and.bubble.right", color: Color.dsSuccess)
                    StatusPill(text: "平台内沟通", symbol: "lock.shield", color: Color.dsTextSecondary)
                }
            }
        }
    }
}

private struct FilterStrip: View {
    @Binding var filter: CompanionListView.FilterType
    @Binding var sort: CompanionListView.SortType

    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.sm) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: DS.Space.sm) {
                    ForEach(CompanionListView.FilterType.allCases, id: \.self) { item in
                        TagChip(title: item.rawValue, isSelected: filter == item) {
                            filter = item
                        }
                        .accessibilityLabel("筛选\(item.rawValue)")
                        .accessibilityAddTraits(filter == item ? .isSelected : [])
                        .accessibilityIdentifier("discoverFilter-\(item.rawValue)")
                    }
                }
            }
            .accessibilityIdentifier("discoverFilterStrip")
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: DS.Space.sm) {
                    StatusPill(text: "排序", symbol: "arrow.up.arrow.down", color: Color.dsTextSecondary)
                    ForEach(CompanionListView.SortType.allCases, id: \.self) { item in
                        TagChip(title: item.rawValue, isSelected: sort == item) {
                            sort = item
                        }
                        .accessibilityLabel("排序\(item.rawValue)")
                        .accessibilityAddTraits(sort == item ? .isSelected : [])
                        .accessibilityIdentifier("discoverSort-\(item.rawValue)")
                    }
                }
            }
            .accessibilityIdentifier("discoverSortStrip")
        }
    }
}
