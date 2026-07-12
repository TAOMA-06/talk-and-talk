import SwiftUI

struct HomeView: View {
    @EnvironmentObject private var store: AppStore

    var body: some View {
        AppScaffold(title: "Talk&Talk", spacing: DS.Space.lg, topPadding: DS.Space.sm) {
            HomeHero()
            MoodChipRow()
            CompanionFeedSection()
        }
        .task {
            if store.companionListLoadState == .idle {
                await store.loadCompanions(pageSize: 50)
            }
        }
    }
}

// MARK: - Hero (greeting + primary actions in one short block)

private struct HomeHero: View {
    @EnvironmentObject private var store: AppStore

    var body: some View {
        DSCard(padding: DS.Space.md) {
            VStack(alignment: .leading, spacing: DS.Space.md) {
                HStack(alignment: .center, spacing: DS.Space.sm) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(greeting)
                            .font(.system(size: DS.TypeScale.section + 1, weight: .semibold))
                            .foregroundStyle(Color.dsTextPrimary)
                        Text(statusLine)
                            .font(.system(size: DS.TypeScale.caption))
                            .foregroundStyle(Color.dsTextSecondary)
                            .lineLimit(1)
                    }
                    Spacer(minLength: DS.Space.sm)
                    DSBadge(
                        text: store.user.isVerified ? "已实名" : "待认证",
                        tone: store.user.isVerified ? .primary : .warning
                    )
                }

                HStack(spacing: DS.Space.sm) {
                    DSButton(
                        title: store.user.isVerified ? "找人聊聊" : "先完成认证",
                        systemImage: store.user.isVerified ? "bubble.left.and.bubble.right" : "person.badge.key",
                        variant: .primary,
                        height: DS.ControlHeight.md,
                        action: primaryAction
                    )
                    .accessibilityIdentifier(store.user.isVerified ? "discoverOnlineCompanionsButton" : "discoverVerifyButton")

                    DSButton(
                        title: "今晚",
                        systemImage: "moon.stars",
                        variant: .secondary,
                        maxWidth: 96,
                        height: DS.ControlHeight.md
                    ) {
                        store.navigate(.companionList(themeId: nil, preset: .availableTonight))
                    }
                    .accessibilityIdentifier("discoverTonightButton")
                }

                Text("平台内沟通 · 可先试聊")
                    .font(.system(size: DS.TypeScale.micro, weight: .medium))
                    .foregroundStyle(Color.dsTextSecondary)
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
        let name = store.user.name.trimmingCharacters(in: .whitespacesAndNewlines)
        if name.isEmpty { return "\(timeGreeting)，想聊一会儿吗？" }
        return "\(timeGreeting)，\(name)"
    }

    private var statusLine: String {
        let online = store.onlineCompanionCount
        let available = store.availableCompanionCount
        if available == 0 && online == 0 {
            return "现在还没有人在线，可以先逛逛主题"
        }
        return "\(online) 人在线 · \(available) 位可聊"
    }

    private func primaryAction() {
        if store.user.isVerified {
            store.navigate(.companionList(themeId: nil, preset: nil))
        } else {
            store.navigate(.verify)
        }
    }
}

// MARK: - Mood chips (horizontal, not a tall 2×2 grid)

private struct MoodChipRow: View {
    @EnvironmentObject private var store: AppStore

    private let entries = [
        MoodEntry(id: "listen", title: "想被听见", symbol: "heart.text.square", themeId: "t1"),
        MoodEntry(id: "pressure", title: "整理压力", symbol: "briefcase", themeId: "t2"),
        MoodEntry(id: "night", title: "睡前放松", symbol: "moon.stars", themeId: "t4"),
        MoodEntry(id: "light", title: "轻松聊聊", symbol: "sparkles", themeId: "t5")
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.sm) {
            Text("现在的心情")
                .font(.system(size: DS.TypeScale.callout, weight: .semibold))
                .foregroundStyle(Color.dsTextPrimary)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: DS.Space.sm) {
                    ForEach(entries) { entry in
                        Button {
                            store.navigate(.companionList(themeId: entry.themeId, preset: nil))
                        } label: {
                            HStack(spacing: DS.Space.sm) {
                                Image(systemName: entry.symbol)
                                    .font(.system(size: 13, weight: .semibold))
                                    .foregroundStyle(Color.dsPrimary)
                                Text(entry.title)
                                    .font(.system(size: DS.TypeScale.callout, weight: .medium))
                                    .foregroundStyle(Color.dsTextPrimary)
                            }
                            .padding(.horizontal, DS.Space.md)
                            .frame(height: 40)
                            .background(Color.dsSurfaceElevated, in: Capsule())
                            .overlay {
                                Capsule()
                                    .stroke(Color.dsBorder.opacity(0.7), lineWidth: DS.Stroke.hairline)
                            }
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(entry.title)
                        .accessibilityIdentifier("discoverMood-\(entry.id)")
                    }
                }
            }
        }
    }
}

private struct MoodEntry: Identifiable {
    let id: String
    let title: String
    let symbol: String
    let themeId: String
}

// MARK: - Single companion feed (replaces tonight + recommended stacks)

private struct CompanionFeedSection: View {
    @EnvironmentObject private var store: AppStore

    private var companions: [Companion] {
        Array(HomeCompanionSorter.sorted(store.companions).prefix(5))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.sm) {
            SectionHeader(title: "可聊的人", actionTitle: "全部") {
                store.navigate(.companionList(themeId: nil, preset: nil))
            }

            if companions.isEmpty {
                switch store.companionListLoadState {
                case .loading:
                    CompanionLoadingRow()
                case .failed(let message):
                    CompactInlineEmpty(
                        symbol: "wifi.exclamationmark",
                        title: "加载失败",
                        subtitle: message,
                        actionTitle: "重试"
                    ) {
                        Task { await store.loadCompanions(pageSize: 50) }
                    }
                    .accessibilityIdentifier("discoverCompanionError")
                default:
                    CompactInlineEmpty(
                        symbol: "person.2",
                        title: "暂时还没有人在线",
                        subtitle: "可以先选一个心情主题，或稍后再来看看。",
                        actionTitle: "逛逛主题"
                    ) {
                        store.navigate(.companionList(themeId: "t1", preset: nil))
                    }
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
                    }
                }
            }
        }
    }
}

private struct CompanionLoadingRow: View {
    var body: some View {
        DSCard(padding: DS.Space.md) {
            HStack(spacing: DS.Space.sm) {
                ProgressView()
                    .controlSize(.small)
                Text("正在加载…")
                    .font(.system(size: DS.TypeScale.callout))
                    .foregroundStyle(Color.dsTextSecondary)
            }
        }
        .accessibilityIdentifier("discoverCompanionLoading")
    }
}

/// Short, friendly empty block — not a full-screen placeholder.
private struct CompactInlineEmpty: View {
    let symbol: String
    let title: String
    let subtitle: String
    var actionTitle: String?
    var action: (() -> Void)?

    var body: some View {
        DSCard(padding: DS.Space.md, elevated: false) {
            HStack(alignment: .center, spacing: DS.Space.md) {
                Image(systemName: symbol)
                    .font(.system(size: 18, weight: .medium))
                    .foregroundStyle(Color.dsPrimary)
                    .frame(width: 36, height: 36)
                    .background(Color.dsPrimarySoft.opacity(0.8), in: Circle())

                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.system(size: DS.TypeScale.body, weight: .semibold))
                        .foregroundStyle(Color.dsTextPrimary)
                    Text(subtitle)
                        .font(.system(size: DS.TypeScale.caption))
                        .foregroundStyle(Color.dsTextSecondary)
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Spacer(minLength: 0)

                if let actionTitle, let action {
                    Button(action: action) {
                        Text(actionTitle)
                            .font(.system(size: DS.TypeScale.caption, weight: .semibold))
                            .foregroundStyle(Color.dsPrimary)
                    }
                    .buttonStyle(DSPressButtonStyle())
                }
            }
        }
    }
}
