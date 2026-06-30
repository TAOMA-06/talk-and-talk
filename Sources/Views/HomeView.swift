import SwiftUI

struct HomeView: View {
    @EnvironmentObject private var store: AppStore

    private var availableCount: Int {
        store.companions.filter { $0.availability != .busy }.count
    }

    var body: some View {
        AppScaffold(title: "Talk&Talk", spacing: DS.Space.xl, topPadding: DS.Space.sm) {
            HomeTopBar()
            ModernHero(
                eyebrow: "今晚，有人愿意听你说",
                title: "把难说的话，交给一个被筛选过的人听完。",
                subtitle: "在这里，被认真倾听，而不是被评判。",
                primaryTitle: store.user.isVerified ? "看看谁在线" : "先完成 18+ 认证",
                primarySystemImage: "arrow.right",
                secondary: "不开放线下服务，不接真实支付。当前为前端本地演示。",
                metricTitle: "可约",
                metricValue: "\(availableCount) 位"
            ) {
                if store.user.isVerified {
                    store.navigate(.companionList(themeId: nil, preset: nil))
                } else {
                    store.navigate(.verify)
                }
            }
            SmartMatchBar()
            ThemeRail()
            RecommendedCompanions()
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    store.navigate(.admin)
                } label: {
                    Image(systemName: "shield.lefthalf.filled")
                }
                .accessibilityLabel("打开演示后台")
            }
        }
    }
}

private struct HomeTopBar: View {
    @EnvironmentObject private var store: AppStore

    var body: some View {
        HStack(alignment: .center, spacing: DS.Space.md) {
            VStack(alignment: .leading, spacing: DS.Space.xxs) {
                Text(greeting)
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(Color.dsTextPrimary)
                Text("女性友好的线上陪伴服务")
                    .font(.system(size: 13))
                    .foregroundStyle(Color.dsTextSecondary)
            }
            Spacer()
            GlassCapsule {
                Label(
                    store.user.isVerified ? "已实名" : "待认证",
                    systemImage: store.user.isVerified ? "checkmark.seal.fill" : "person.badge.key"
                )
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(store.user.isVerified ? Color.dsPrimary : Color.dsWarning)
            }
        }
    }

    private var greeting: String {
        let hour = Calendar.current.component(.hour, from: Date())
        let timeGreeting: String
        switch hour {
        case 5..<12: timeGreeting = "早上好"
        case 12..<18: timeGreeting = "下午好"
        default: timeGreeting = "晚上好"
        }
        return "\(timeGreeting)，\(store.user.name)"
    }
}

private struct SmartMatchBar: View {
    @EnvironmentObject private var store: AppStore

    var body: some View {
        SoftCard {
            VStack(alignment: .leading, spacing: DS.Space.md) {
                HStack(spacing: DS.Space.sm) {
                    Image(systemName: "bolt.heart")
                        .foregroundStyle(Color.dsPrimary)
                        .font(.system(size: 12, weight: .semibold))
                    Text("\(store.onlineCompanionCount) 人在线，\(store.availableCompanionCount) 位可约")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Color.dsTextPrimary)
                    Spacer()
                    Text("按状态和评价推荐")
                        .font(.system(size: 11))
                        .foregroundStyle(Color.dsTextSecondary)
                }

                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: DS.Space.sm) {
                        TagChip(title: "情绪倾听") {
                            store.navigate(.companionList(themeId: "t1", preset: nil))
                        }
                        TagChip(title: "今晚可聊") {
                            store.navigate(.companionList(themeId: nil, preset: .availableTonight))
                        }
                        TagChip(title: "预算友好") {
                            store.navigate(.companionList(themeId: nil, preset: .budgetFriendly))
                        }
                    }
                }
            }
        }
    }
}

private struct ThemeRail: View {
    @EnvironmentObject private var store: AppStore

    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.md) {
            SectionHeader(title: "今天想聊什么", subtitle: "选一个主题，帮你找到更合适的人", actionTitle: "全部") {
                store.navigate(.companionList(themeId: nil, preset: nil))
            }

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: DS.Space.md) {
                    ForEach(store.themes) { theme in
                        Button {
                            store.navigate(.companionList(themeId: theme.id, preset: nil))
                        } label: {
                            ThemePillCard(theme: theme)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }
}

private struct ThemePillCard: View {
    let theme: Theme

    var body: some View {
        SoftCard {
            VStack(alignment: .leading, spacing: DS.Space.md) {
                Image(systemName: theme.icon)
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(Color.dsPrimary)
                    .frame(width: 40, height: 40)
                    .background(Color.dsPrimary.opacity(0.12), in: RoundedRectangle(cornerRadius: DS.Radius.sm, style: .continuous))
                VStack(alignment: .leading, spacing: DS.Space.xxs) {
                    Text(theme.name)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Color.dsTextPrimary)
                    Text(theme.description)
                        .font(.system(size: 11))
                        .foregroundStyle(Color.dsTextSecondary)
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(width: 140, alignment: .leading)
        }
    }
}

private struct RecommendedCompanions: View {
    @EnvironmentObject private var store: AppStore

    var body: some View {
        VStack(spacing: DS.Space.md) {
            SectionHeader(title: "推荐陪伴者", subtitle: "在线、认证、评价综合排序", actionTitle: "更多") {
                store.navigate(.companionList(themeId: nil, preset: nil))
            }
            LazyVStack(spacing: DS.Space.md) {
                ForEach(store.companions.prefix(4)) { companion in
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

struct CompanionSummaryCard: View {
    let companion: Companion

    var body: some View {
        SoftCard(padding: DS.Space.md) {
            HStack(spacing: DS.Space.md) {
                CompanionAvatar(companion: companion, size: 48)
                VStack(alignment: .leading, spacing: DS.Space.sm) {
                    HStack(spacing: DS.Space.sm) {
                        Text(companion.name)
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(Color.dsTextPrimary)
                        AvailabilityBadge(status: companion.availability)
                        Spacer()
                        Text("¥\(companion.pricePerHalfHour)/30m")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(Color.dsTextPrimary)
                    }
                    Text(companion.role)
                        .font(.system(size: 13))
                        .foregroundStyle(Color.dsTextSecondary)
                    HStack(spacing: DS.Space.sm) {
                        DistanceLabel(distanceKm: companion.distanceKm, district: companion.cityDistrict)
                        Label(String(format: "%.1f", companion.rating), systemImage: "star.fill")
                        Text("\(companion.reviewCount)条评价")
                    }
                    .font(.system(size: 11))
                    .foregroundStyle(Color.dsTextSecondary)
                    HStack {
                        FlowLayout(spacing: DS.Space.sm) {
                            ForEach(companion.tags.prefix(3), id: \.self) { tag in
                                TagChip(title: tag)
                            }
                        }
                        Spacer()
                        if companion.isVerified {
                            TrustMicroBadge()
                        }
                    }
                }
            }
        }
    }
}
