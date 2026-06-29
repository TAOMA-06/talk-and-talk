import SwiftUI

struct HomeView: View {
    @EnvironmentObject private var store: AppStore

    private var availableCount: Int {
        store.companions.filter { $0.availability != .busy }.count
    }

    var body: some View {
        AppScaffold(title: "Talk&Talk", spacing: 22, topPadding: 8) {
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
        HStack(alignment: .center, spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                Text(greeting)
                    .font(.title2.weight(.bold))
                    .foregroundStyle(Color.appInk)
                Text("女性友好的线上陪伴服务")
                    .font(.subheadline)
                    .foregroundStyle(Color.appMuted)
            }
            Spacer()
            GlassCapsule(tint: verificationColor.opacity(0.12)) {
                Label(store.user.isVerified ? "已实名" : "待认证", systemImage: store.user.isVerified ? "checkmark.seal.fill" : "person.badge.key")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(verificationColor)
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

    private var verificationColor: Color {
        store.user.isVerified ? Color.appTeal : Color.appCoral
    }
}

private struct SmartMatchBar: View {
    @EnvironmentObject private var store: AppStore

    var body: some View {
        SoftCard(cornerRadius: 22, tint: Color.appTeal, padding: 16) {
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 8) {
                    Image(systemName: "location.fill")
                        .foregroundStyle(Color.appTeal)
                        .font(.caption.weight(.bold))
                    Text("距你最近 · \(store.nearbyOnlineCount) 位在线")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Color.appInk)
                    Spacer()
                    HStack(spacing: 5) {
                        Circle()
                            .fill(Color.appTeal)
                            .frame(width: 7, height: 7)
                        Text("\(store.onlineCompanionCount) 人在线，\(store.availableCompanionCount) 位可约")
                            .font(.caption)
                            .foregroundStyle(Color.appMuted)
                    }
                }

                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        TagChip(title: "情绪倾听", color: Color.appTeal) {
                            store.navigate(.companionList(themeId: "t1", preset: nil))
                        }
                        TagChip(title: "今晚可约", color: Color.appRose) {
                            store.navigate(.companionList(themeId: nil, preset: .availableTonight))
                        }
                        TagChip(title: "预算友好", color: Color.appGold) {
                            store.navigate(.companionList(themeId: nil, preset: .budgetFriendly))
                        }
                        TagChip(title: "附近优先", color: Color.appTeal) {
                            store.navigate(.companionList(themeId: nil, preset: .nearby))
                        }
                    }
                }

                Text(MockData.peakHourHint)
                    .font(.caption)
                    .foregroundStyle(Color.appMuted)
            }
        }
    }
}

private struct ThemeRail: View {
    @EnvironmentObject private var store: AppStore

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            SectionHeader(title: "今天想聊什么", subtitle: "选一个主题，帮你找到更合适的人", actionTitle: "全部") {
                store.navigate(.companionList(themeId: nil, preset: nil))
            }

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 14) {
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
        SoftCard(cornerRadius: 22, tint: tint, padding: 16) {
            VStack(alignment: .leading, spacing: 14) {
                Image(systemName: theme.icon)
                    .font(.headline)
                    .foregroundStyle(tint)
                    .frame(width: 40, height: 40)
                    .background(tint.opacity(0.12), in: RoundedRectangle(cornerRadius: 13, style: .continuous))
                VStack(alignment: .leading, spacing: 5) {
                    Text(theme.name)
                        .font(.headline)
                        .foregroundStyle(Color.appInk)
                    Text(theme.description)
                        .font(.caption)
                        .foregroundStyle(Color.appMuted)
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(width: 140, alignment: .leading)
        }
    }

    private var tint: Color {
        switch theme.tintName {
        case "coral": Color.appCoral
        case "gold": Color.appGold
        case "lilac": Color.appLilac
        default: Color.appTeal
        }
    }
}

private struct RecommendedCompanions: View {
    @EnvironmentObject private var store: AppStore

    var body: some View {
        VStack(spacing: 14) {
            SectionHeader(title: "推荐陪伴者", subtitle: "在线、距离、评价综合排序", actionTitle: "更多") {
                store.navigate(.companionList(themeId: nil, preset: nil))
            }
            LazyVStack(spacing: 12) {
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
        SoftCard(cornerRadius: 22, tint: Color.appTeal, padding: 14) {
            HStack(spacing: 13) {
                CompanionAvatar(companion: companion, size: 58)
                VStack(alignment: .leading, spacing: 7) {
                    HStack(spacing: 7) {
                        Text(companion.name)
                            .font(.headline)
                            .foregroundStyle(Color.appInk)
                        AvailabilityBadge(status: companion.availability)
                        Spacer()
                        Text("¥\(companion.pricePerHalfHour)/30m")
                            .font(.subheadline.weight(.bold))
                            .foregroundStyle(Color.appCoral)
                    }
                    Text(companion.role)
                        .font(.subheadline)
                        .foregroundStyle(Color.appMuted)
                    HStack(spacing: 8) {
                        DistanceLabel(distanceKm: companion.distanceKm, district: companion.cityDistrict)
                        Label(String(format: "%.1f", companion.rating), systemImage: "star.fill")
                            .foregroundStyle(Color.appGold)
                        Text("\(companion.reviewCount)条评价")
                    }
                    .font(.caption)
                    .foregroundStyle(Color.appMuted)
                    HStack {
                        FlowLayout(spacing: 6) {
                            ForEach(companion.tags.prefix(3), id: \.self) { tag in
                                TagChip(title: tag, color: Color.appTeal)
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
