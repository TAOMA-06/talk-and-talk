import SwiftUI

struct CompanionListView: View {
    let themeId: String?
    var preset: ListPreset?
    @EnvironmentObject private var store: AppStore
    @State private var filter: FilterType
    @State private var sort: SortType

    enum FilterType: String, CaseIterable {
        case all = "全部"
        case online = "在线"
        case verified = "已认证"
        case nearby = "附近"
        case availableTonight = "今晚可约"
        case budgetFriendly = "预算内"
    }

    enum SortType: String, CaseIterable {
        case recommended = "推荐"
        case distance = "距离最近"
        case rating = "评分"
        case price = "价格"
    }

    init(themeId: String?, preset: ListPreset?) {
        self.themeId = themeId
        self.preset = preset
        switch preset {
        case .nearby:
            _filter = State(initialValue: .nearby)
            _sort = State(initialValue: .distance)
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
        case .nearby: result = result.filter { $0.distanceKm <= 3 }
        case .availableTonight: result = result.filter { $0.availability != .busy }
        case .budgetFriendly: result = result.filter { $0.pricePerHalfHour <= 35 }
        }

        switch sort {
        case .recommended:
            result.sort { lhs, rhs in
                (
                    lhs.availability == .online ? 2 : (lhs.availability == .available ? 1 : 0),
                    lhs.isVerified ? 1 : 0,
                    lhs.rating
                ) > (
                    rhs.availability == .online ? 2 : (rhs.availability == .available ? 1 : 0),
                    rhs.isVerified ? 1 : 0,
                    rhs.rating
                )
            }
        case .distance:
            result.sort { $0.distanceKm < $1.distanceKm }
        case .rating:
            result.sort { $0.rating > $1.rating }
        case .price:
            result.sort { $0.pricePerHalfHour < $1.pricePerHalfHour }
        }
        return result
    }

    var body: some View {
        AppScaffold(title: title, spacing: 18) {
            ListHeader(title: title, count: filteredCompanions.count)
            PeakHourBanner()
            FilterStrip(filter: $filter, sort: $sort)
            if filteredCompanions.isEmpty {
                EmptyStateView(symbol: "person.2.slash", title: "暂无匹配陪伴者", subtitle: "可以切换主题或重置筛选条件。")
            } else {
                LazyVStack(spacing: 12) {
                    ForEach(filteredCompanions) { companion in
                        Button {
                            store.navigate(.companionDetail(companion.id))
                        } label: {
                            CompanionSummaryCard(companion: companion)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }
}

private struct ListHeader: View {
    let title: String
    let count: Int

    var body: some View {
        HStack(alignment: .lastTextBaseline) {
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.title2.weight(.bold))
                    .foregroundStyle(Color.appInk)
                Text("仅展示平台内线上文字/语音服务")
                    .font(.caption)
                    .foregroundStyle(Color.appMuted)
            }
            Spacer()
            StatusPill(text: "\(count)人", symbol: "person.2", color: Color.appTeal)
        }
    }
}

private struct PeakHourBanner: View {
    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "chart.line.uptrend.xyaxis")
                .foregroundStyle(Color.appGold)
            Text(MockData.peakHourHint)
                .font(.caption)
                .foregroundStyle(Color.appMuted)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.appGold.opacity(0.08), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}

private struct FilterStrip: View {
    @Binding var filter: CompanionListView.FilterType
    @Binding var sort: CompanionListView.SortType

    var body: some View {
        VStack(spacing: 10) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(CompanionListView.FilterType.allCases, id: \.self) { item in
                        TagChip(title: item.rawValue, isSelected: filter == item) {
                            filter = item
                        }
                    }
                }
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    Text("排序")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Color.appMuted)
                    ForEach(CompanionListView.SortType.allCases, id: \.self) { item in
                        TagChip(title: item.rawValue, isSelected: sort == item) {
                            sort = item
                        }
                    }
                }
            }
        }
    }
}
