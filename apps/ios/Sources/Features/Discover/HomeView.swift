import SwiftUI

struct HomeView: View {
    @EnvironmentObject private var store: AppStore

    var body: some View {
        AppScaffold(title: "Talk&Talk", spacing: DS.Space.xl, topPadding: DS.Space.sm) {
            HomeGreetingBar()
            MoodEntryPanel()
            QuickMatchPanel()
            TonightAvailableSection()
            RecommendedCompanions()
        }
    }
}

private struct HomeGreetingBar: View {
    @EnvironmentObject private var store: AppStore

    var body: some View {
        HStack(alignment: .top, spacing: DS.Space.md) {
            VStack(alignment: .leading, spacing: DS.Space.xxs) {
                Text(greeting)
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(Color.dsTextPrimary)
                Text("今天想找谁说说话？")
                    .font(.system(size: 15))
                    .foregroundStyle(Color.dsTextSecondary)
            }

            Spacer(minLength: DS.Space.md)

            DSBadge(
                text: store.user.isVerified ? "已实名" : "待认证",
                tone: store.user.isVerified ? .primary : .warning
            )
            .padding(.top, DS.Space.xxs)
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

private struct MoodEntryPanel: View {
    @EnvironmentObject private var store: AppStore
    private let columns = [GridItem(.flexible()), GridItem(.flexible())]

    private let entries = [
        MoodEntry(id: "listen", title: "想被听见", subtitle: "有人认真听你说完", symbol: "heart.text.square", themeId: "t1", tone: .primary),
        MoodEntry(id: "pressure", title: "整理压力", subtitle: "把卡住的事拆开聊", symbol: "briefcase", themeId: "t2", tone: .warning),
        MoodEntry(id: "night", title: "睡前放松", subtitle: "安静一点，慢慢说", symbol: "moon.stars", themeId: "t4", tone: .neutral),
        MoodEntry(id: "light", title: "轻松聊聊", subtitle: "从兴趣和日常开始", symbol: "sparkles", themeId: "t5", tone: .success)
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.md) {
            SectionHeader(title: "从当下的心情开始", subtitle: "选一个入口，找到更合适的陪伴者")

            LazyVGrid(columns: columns, spacing: DS.Space.md) {
                ForEach(entries) { entry in
                    Button {
                        store.navigate(.companionList(themeId: entry.themeId, preset: nil))
                    } label: {
                        MoodEntryCard(entry: entry)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }
}

private struct MoodEntry: Identifiable {
    let id: String
    let title: String
    let subtitle: String
    let symbol: String
    let themeId: String
    let tone: DSBadge.Tone
}

private struct MoodEntryCard: View {
    let entry: MoodEntry

    var body: some View {
        DSCard(padding: DS.Space.md) {
            VStack(alignment: .leading, spacing: DS.Space.md) {
                Image(systemName: entry.symbol)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(tint)
                    .frame(width: 38, height: 38)
                    .background(tint.opacity(0.10), in: RoundedRectangle(cornerRadius: DS.Radius.md, style: .continuous))
                    .overlay {
                        RoundedRectangle(cornerRadius: DS.Radius.md, style: .continuous)
                            .stroke(tint.opacity(0.14), lineWidth: DS.Stroke.hairline)
                    }

                VStack(alignment: .leading, spacing: DS.Space.xxs) {
                    Text(entry.title)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Color.dsTextPrimary)
                        .lineLimit(1)
                    Text(entry.subtitle)
                        .font(.system(size: 12))
                        .foregroundStyle(Color.dsTextSecondary)
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(maxWidth: .infinity, minHeight: 112, alignment: .leading)
        }
    }

    private var tint: Color {
        switch entry.tone {
        case .neutral: Color.dsTextSecondary
        case .primary: Color.dsPrimary
        case .success: Color.dsSuccess
        case .warning: Color.dsWarning
        case .danger: Color.dsDanger
        }
    }
}

private struct QuickMatchPanel: View {
    @EnvironmentObject private var store: AppStore

    var body: some View {
        DSCard {
            VStack(alignment: .leading, spacing: DS.Space.lg) {
                HStack(alignment: .top, spacing: DS.Space.md) {
                    VStack(alignment: .leading, spacing: DS.Space.sm) {
                        DSBadge(text: "快速匹配", tone: .primary)
                        Text("现在有 \(store.onlineCompanionCount) 人在线，\(store.availableCompanionCount) 位可以聊。")
                            .font(.system(size: 20, weight: .semibold))
                            .foregroundStyle(Color.dsTextPrimary)
                            .fixedSize(horizontal: false, vertical: true)
                        Text("只在平台内文字/语音沟通，可以先试聊，再决定是否继续。")
                            .font(.system(size: 13))
                            .foregroundStyle(Color.dsTextSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    Spacer(minLength: DS.Space.md)

                    DSInsetSurface(padding: DS.Space.md) {
                        VStack(spacing: DS.Space.xxs) {
                            Text("\(store.availableCompanionCount)")
                                .font(.system(size: 24, weight: .semibold))
                                .foregroundStyle(Color.dsTextPrimary)
                            Text("可聊")
                                .font(.system(size: 11, weight: .medium))
                                .foregroundStyle(Color.dsTextSecondary)
                        }
                    }
                    .frame(width: 78)
                }

                HStack(spacing: DS.Space.sm) {
                    DSButton(
                        title: store.user.isVerified ? "看看谁在线" : "先完成 18+ 认证",
                        systemImage: store.user.isVerified ? "arrow.right" : "person.badge.key",
                        variant: .primary,
                        action: primaryAction
                    )
                    .accessibilityIdentifier(store.user.isVerified ? "discoverOnlineCompanionsButton" : "discoverVerifyButton")

                    DSButton(title: "今晚可聊", systemImage: "moon.stars", variant: .secondary, maxWidth: 118) {
                        store.navigate(.companionList(themeId: nil, preset: .availableTonight))
                    }
                    .accessibilityIdentifier("discoverTonightButton")
                }
            }
        }
    }

    private func primaryAction() {
        if store.user.isVerified {
            store.navigate(.companionList(themeId: nil, preset: nil))
        } else {
            store.navigate(.verify)
        }
    }
}

private struct TonightAvailableSection: View {
    @EnvironmentObject private var store: AppStore

    private var companions: [Companion] {
        Array(HomeCompanionSorter.sorted(store.companions.filter { $0.availability != .busy }).prefix(3))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.md) {
            SectionHeader(title: "今晚可聊", subtitle: "在线优先，适合现在就开始说说话", actionTitle: "全部") {
                store.navigate(.companionList(themeId: nil, preset: .availableTonight))
            }

            if companions.isEmpty {
                EmptyStateView(
                    symbol: "moon.zzz",
                    title: "今晚暂时没有可聊的人",
                    subtitle: "可以先看看全部陪伴者，找到适合稍后沟通的人。",
                    actionTitle: "查看全部",
                    action: { store.navigate(.companionList(themeId: nil, preset: nil)) }
                )
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: DS.Space.md) {
                        ForEach(companions) { companion in
                            Button {
                                store.navigate(.companionDetail(companion.id))
                            } label: {
                                TonightCompanionCard(companion: companion)
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("查看\(companion.name)详情")
                            .accessibilityIdentifier("discoverTonightCompanion-\(companion.id)")
                        }
                    }
                }
            }
        }
    }
}

private struct TonightCompanionCard: View {
    let companion: Companion

    var body: some View {
        DSCard(padding: DS.Space.md) {
            VStack(alignment: .leading, spacing: DS.Space.md) {
                HStack(alignment: .top) {
                    CompanionAvatar(companion: companion, size: 48)
                    Spacer()
                    AvailabilityBadge(status: companion.availability)
                }

                VStack(alignment: .leading, spacing: DS.Space.xxs) {
                    Text(companion.name)
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(Color.dsTextPrimary)
                        .lineLimit(1)
                    Text(companion.role)
                        .font(.system(size: 12))
                        .foregroundStyle(Color.dsTextSecondary)
                        .lineLimit(1)
                }

                HStack(spacing: DS.Space.xxs) {
                    Image(systemName: "clock")
                    Text(companion.availableTimes.first ?? "今晚")
                    Spacer()
                    Text("¥\(companion.pricePerHalfHour)/30m")
                        .fontWeight(.semibold)
                }
                .font(.system(size: 11))
                .foregroundStyle(Color.dsTextSecondary)
            }
            .frame(width: 156, alignment: .leading)
        }
    }
}

private struct RecommendedCompanions: View {
    @EnvironmentObject private var store: AppStore

    private var companions: [Companion] {
        Array(HomeCompanionSorter.sorted(store.companions).prefix(4))
    }

    var body: some View {
        VStack(spacing: DS.Space.md) {
            SectionHeader(title: "推荐陪伴者", subtitle: "综合在线状态、认证、评价与响应速度", actionTitle: "更多") {
                store.navigate(.companionList(themeId: nil, preset: nil))
            }

            LazyVStack(spacing: DS.Space.md) {
                ForEach(companions) { companion in
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

private enum HomeCompanionSorter {
    static func sorted(_ companions: [Companion]) -> [Companion] {
        companions.sorted { lhs, rhs in
            score(for: lhs) > score(for: rhs)
        }
    }

    private static func score(for companion: Companion) -> (Int, Int, Double, Int) {
        (
            availabilityRank(for: companion.availability),
            companion.isVerified ? 1 : 0,
            companion.rating,
            companion.reviewCount
        )
    }

    private static func availabilityRank(for status: AvailabilityStatus) -> Int {
        switch status {
        case .online: 2
        case .available: 1
        case .busy: 0
        }
    }
}
