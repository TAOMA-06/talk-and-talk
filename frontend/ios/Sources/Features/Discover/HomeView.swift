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
            HomeTrustFooter()
        }
        .task {
            if store.companionListLoadState == .idle {
                await store.loadCompanions(pageSize: 50)
            }
        }
    }
}

private struct HomeGreetingBar: View {
    @EnvironmentObject private var store: AppStore

    var body: some View {
        HStack(alignment: .top, spacing: DS.Space.md) {
            VStack(alignment: .leading, spacing: DS.Space.sm) {
                Text(greeting)
                    .font(.system(size: DS.TypeScale.title, weight: .semibold))
                    .foregroundStyle(Color.dsTextPrimary)
                Text("今天想找谁说说话？")
                    .font(.system(size: DS.TypeScale.body))
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
        let name = store.user.name.trimmingCharacters(in: .whitespacesAndNewlines)
        if name.isEmpty { return timeGreeting }
        return "\(timeGreeting)，\(name)"
    }
}

private struct MoodEntryPanel: View {
    @EnvironmentObject private var store: AppStore
    private let columns = [GridItem(.flexible(), spacing: DS.Space.md), GridItem(.flexible(), spacing: DS.Space.md)]

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
                    .accessibilityLabel("\(entry.title)，\(entry.subtitle)")
                    .accessibilityIdentifier("discoverMood-\(entry.id)")
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
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(tint)
                    .frame(width: 40, height: 40)
                    .background(tint.opacity(0.12), in: RoundedRectangle(cornerRadius: DS.Radius.md, style: .continuous))
                    .overlay {
                        RoundedRectangle(cornerRadius: DS.Radius.md, style: .continuous)
                            .stroke(tint.opacity(0.14), lineWidth: DS.Stroke.hairline)
                    }

                VStack(alignment: .leading, spacing: DS.Space.xxs) {
                    Text(entry.title)
                        .font(.system(size: DS.TypeScale.body, weight: .semibold))
                        .foregroundStyle(Color.dsTextPrimary)
                        .lineLimit(1)
                    Text(entry.subtitle)
                        .font(.system(size: DS.TypeScale.caption))
                        .foregroundStyle(Color.dsTextSecondary)
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(maxWidth: .infinity, minHeight: 118, alignment: .leading)
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
                        Text(headline)
                            .font(.system(size: DS.TypeScale.title - 2, weight: .semibold))
                            .foregroundStyle(Color.dsTextPrimary)
                            .fixedSize(horizontal: false, vertical: true)
                        Text("只在平台内文字/语音沟通，可以先试聊，再决定是否继续。")
                            .font(.system(size: DS.TypeScale.callout))
                            .foregroundStyle(Color.dsTextSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    Spacer(minLength: DS.Space.md)

                    DSInsetSurface(padding: DS.Space.md) {
                        VStack(spacing: DS.Space.xxs) {
                            Text("\(store.availableCompanionCount)")
                                .font(.system(size: 26, weight: .semibold))
                                .foregroundStyle(Color.dsPrimary)
                            Text("可聊")
                                .font(.system(size: DS.TypeScale.micro, weight: .medium))
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

                    DSButton(title: "今晚可聊", systemImage: "moon.stars", variant: .secondary, maxWidth: 124) {
                        store.navigate(.companionList(themeId: nil, preset: .availableTonight))
                    }
                    .accessibilityIdentifier("discoverTonightButton")
                }
            }
        }
    }

    private var headline: String {
        let online = store.onlineCompanionCount
        let available = store.availableCompanionCount
        if available == 0 && online == 0 {
            return "现在还没有人在线，可以先认证或稍后再来。"
        }
        return "现在有 \(online) 人在线，\(available) 位可以聊。"
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
                switch store.companionListLoadState {
                case .loading:
                    CompanionLoadingCard(title: "正在加载今晚可聊的人")
                case .failed(let message):
                    CompanionLoadErrorCard(message: message) {
                        Task { await store.loadCompanions(pageSize: 50) }
                    }
                default:
                    EmptyStateCard(
                        content: MarketplaceEmptyCopy.content(for: .tonightAvailable),
                        action: { store.navigate(.companionList(themeId: nil, preset: nil)) }
                    )
                }
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
                        .font(.system(size: DS.TypeScale.body + 1, weight: .semibold))
                        .foregroundStyle(Color.dsTextPrimary)
                        .lineLimit(1)
                    Text(companion.role)
                        .font(.system(size: DS.TypeScale.caption))
                        .foregroundStyle(Color.dsTextSecondary)
                        .lineLimit(1)
                }

                HStack(spacing: DS.Space.xxs) {
                    Image(systemName: "clock")
                    Text(companion.availableTimes.first ?? "今晚")
                    Spacer()
                    Text("¥\(companion.pricePerHalfHour)/30m")
                        .fontWeight(.semibold)
                        .foregroundStyle(Color.dsPrimary)
                }
                .font(.system(size: DS.TypeScale.micro))
                .foregroundStyle(Color.dsTextSecondary)
            }
            .frame(width: 160, alignment: .leading)
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
                if companions.isEmpty {
                    switch store.companionListLoadState {
                    case .loading:
                        CompanionLoadingCard(title: "正在加载推荐陪伴者")
                    case .failed(let message):
                        CompanionLoadErrorCard(message: message) {
                            Task { await store.loadCompanions(pageSize: 50) }
                        }
                    default:
                        EmptyStateView(
                            content: MarketplaceEmptyCopy.content(for: .recommendedCompanions),
                            compact: true
                        )
                        .background(
                            Color.dsSurfaceElevated,
                            in: RoundedRectangle(cornerRadius: DS.Radius.lg, style: .continuous)
                        )
                        .overlay {
                            RoundedRectangle(cornerRadius: DS.Radius.lg, style: .continuous)
                                .stroke(Color.dsBorder.opacity(0.68), lineWidth: DS.Stroke.hairline)
                        }
                    }
                } else {
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
}

private struct HomeTrustFooter: View {
    var body: some View {
        DSBanner(
            title: "平台内沟通 · 可试聊 · 可举报",
            message: "不会引导私下加微信或线下见面。遇到不适内容，随时在会话里举报。",
            systemImage: "lock.shield.fill",
            tone: .primary
        )
    }
}

private struct CompanionLoadingCard: View {
    let title: String

    var body: some View {
        DSCard(padding: DS.Space.md) {
            HStack(spacing: DS.Space.md) {
                ProgressView()
                Text(title)
                    .font(.system(size: DS.TypeScale.callout, weight: .medium))
                    .foregroundStyle(Color.dsTextSecondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityIdentifier("discoverCompanionLoading")
    }
}

private struct CompanionLoadErrorCard: View {
    let message: String
    let retry: () -> Void

    var body: some View {
        EmptyStateView(
            symbol: "wifi.exclamationmark",
            title: "陪伴者加载失败",
            subtitle: message,
            actionTitle: "重试",
            action: retry,
            compact: true
        )
        .background(
            Color.dsSurfaceElevated,
            in: RoundedRectangle(cornerRadius: DS.Radius.lg, style: .continuous)
        )
        .overlay {
            RoundedRectangle(cornerRadius: DS.Radius.lg, style: .continuous)
                .stroke(Color.dsBorder.opacity(0.68), lineWidth: DS.Stroke.hairline)
        }
        .accessibilityIdentifier("discoverCompanionError")
    }
}
