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
                        content: emptyContent,
                        reset: resetFilters,
                        back: { dismiss() }
                    )
                }
            } else {
                LazyVStack(spacing: DS.Space.md) {
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

    private var emptyContent: MarketplaceEmptyCopy.Content {
        var content = MarketplaceEmptyCopy.content(for: .companionList(filter: filterKind))
        if themeId != nil, filter == .all {
            content = MarketplaceEmptyCopy.Content(
                symbol: content.symbol,
                title: content.title,
                subtitle: "这个主题下暂时没有合适的人，可以放宽筛选，或返回发现页换个入口。",
                actionTitle: content.actionTitle
            )
        }
        return content
    }

    private var filterKind: MarketplaceEmptyCopy.CompanionListFilterKind {
        switch filter {
        case .all: .all
        case .online: .online
        case .verified: .verified
        case .availableTonight: .availableTonight
        case .budgetFriendly: .budgetFriendly
        }
    }

    private func isRecommended(_ lhs: Companion, before rhs: Companion) -> Bool {
        if HomeCompanionSorter.compare(lhs, rhs) { return true }
        if HomeCompanionSorter.compare(rhs, lhs) { return false }

        let leftResponse = responseSeconds(lhs.responseTime)
        let rightResponse = responseSeconds(rhs.responseTime)
        if leftResponse != rightResponse { return leftResponse < rightResponse }

        return lhs.pricePerHalfHour < rhs.pricePerHalfHour
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
    let content: MarketplaceEmptyCopy.Content
    let reset: () -> Void
    let back: () -> Void

    var body: some View {
        DSCard(padding: DS.Space.md, elevated: false) {
            VStack(alignment: .leading, spacing: DS.Space.md) {
                HStack(spacing: DS.Space.md) {
                    Image(systemName: content.symbol)
                        .font(.system(size: 16, weight: .medium))
                        .foregroundStyle(Color.dsPrimary)
                        .frame(width: 36, height: 36)
                        .background(Color.dsPrimarySoft.opacity(0.8), in: Circle())
                    VStack(alignment: .leading, spacing: 2) {
                        Text(content.title)
                            .font(.system(size: DS.TypeScale.body, weight: .semibold))
                            .foregroundStyle(Color.dsTextPrimary)
                        Text(content.subtitle)
                            .font(.system(size: DS.TypeScale.caption))
                            .foregroundStyle(Color.dsTextSecondary)
                            .lineLimit(2)
                    }
                }

                HStack(spacing: DS.Space.sm) {
                    DSButton(
                        title: content.actionTitle ?? "放宽筛选",
                        variant: .primary,
                        height: DS.ControlHeight.md,
                        action: reset
                    )
                    .accessibilityIdentifier("companionListResetFilters")
                    DSButton(
                        title: "返回",
                        variant: .secondary,
                        maxWidth: 88,
                        height: DS.ControlHeight.md,
                        action: back
                    )
                    .accessibilityIdentifier("companionListBackToDiscover")
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
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
        HStack(spacing: DS.Space.sm) {
            Text("\(count) 人 · \(onlineCount) 在线 · \(availableCount) 可聊")
                .font(.system(size: DS.TypeScale.caption, weight: .medium))
                .foregroundStyle(Color.dsTextSecondary)
            Spacer(minLength: 0)
            Text("平台内沟通")
                .font(.system(size: DS.TypeScale.micro, weight: .semibold))
                .foregroundStyle(Color.dsPrimary)
                .padding(.horizontal, DS.Space.sm)
                .padding(.vertical, DS.Space.xxs)
                .background(Color.dsPrimarySoft.opacity(0.7), in: Capsule())
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(title)，\(count)人，\(onlineCount)在线")
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
