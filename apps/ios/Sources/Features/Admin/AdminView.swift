import SwiftUI

#if DEBUG
struct AdminView: View {
    @EnvironmentObject private var store: AppStore

    var body: some View {
        AppScaffold(title: "安全工作台", spacing: DS.Space.lg, bottomPadding: DS.Space.xxl) {
            AdminHero()
            AdminMetricGrid()
            ModerationQueue()
        }
    }
}

private struct AdminHero: View {
    var body: some View {
        SoftCard {
            VStack(alignment: .leading, spacing: DS.Space.sm) {
                Text("内容安全")
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(Color.dsTextPrimary)
                Text("集中查看沟通提醒、发布状态和用户举报。")
                    .font(.system(size: 13))
                    .foregroundStyle(Color.dsTextSecondary)
                    .lineSpacing(3)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

private struct AdminMetricGrid: View {
    @EnvironmentObject private var store: AppStore
    private let columns = [GridItem(.flexible()), GridItem(.flexible())]

    private var serviceStatusValue: String {
        guard BackendConfig.isEnabled else { return "未启用" }
        return store.isBackendConnected ? "已连接" : "待连接"
    }

    var body: some View {
        LazyVGrid(columns: columns, spacing: DS.Space.md) {
            AdminMetric(title: "待查看", value: "\(store.pendingModerationCount)", symbol: "shield.checkered")
            AdminMetric(title: "今日提醒", value: "\(store.blockedTodayCount)", symbol: "hand.raised")
            AdminMetric(title: "受限用户", value: store.user.accountStatus == .restricted ? "1" : "0", symbol: "person.crop.circle.badge.exclamationmark")
            AdminMetric(title: "服务状态", value: serviceStatusValue, symbol: "server.rack")
        }
    }
}

private struct AdminMetric: View {
    let title: String
    let value: String
    let symbol: String

    var body: some View {
        SoftCard {
            VStack(alignment: .leading, spacing: DS.Space.sm) {
                Image(systemName: symbol)
                    .foregroundStyle(Color.dsPrimary)
                Text(value)
                    .font(.system(size: 28, weight: .semibold))
                    .foregroundStyle(Color.dsTextPrimary)
                Text(title)
                    .font(.system(size: 11))
                    .foregroundStyle(Color.dsTextSecondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

private struct ModerationQueue: View {
    @EnvironmentObject private var store: AppStore
    @State private var feedback: String?

    var body: some View {
        SoftCard {
            VStack(alignment: .leading, spacing: DS.Space.md) {
                SectionHeader(title: "待处理内容", subtitle: "资料、聊天、举报统一查看")
                if let feedback {
                    Text(feedback)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(Color.dsPrimary)
                        .padding(.horizontal, DS.Space.sm)
                        .padding(.vertical, DS.Space.xxs)
                        .background(Color.dsPrimary.opacity(0.10), in: Capsule())
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                if store.moderationCases.isEmpty {
                    EmptyStateView(symbol: "tray", title: "暂无待处理内容", subtitle: "有新的提醒或举报时会出现在这里。")
                } else {
                    ForEach(store.moderationCases) { item in
                        ModerationCaseRow(item: item) { message in
                            withAnimation(.easeOut(duration: DS.Motion.fast)) {
                                feedback = message
                            }
                        }
                    }
                }
            }
        }
    }
}

private struct ModerationCaseRow: View {
    let item: ModerationCase
    let onAction: (String) -> Void
    @EnvironmentObject private var store: AppStore

    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.sm) {
            HStack(spacing: DS.Space.md) {
                Image(systemName: icon(for: item.riskLevel))
                    .foregroundStyle(color(for: item.riskLevel))
                    .frame(width: 24)
                VStack(alignment: .leading, spacing: DS.Space.xxs) {
                    Text(displayTitle)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Color.dsTextPrimary)
                    Text("\(item.category) · \(severityText(for: item.riskLevel)) · \(statusText(for: item.status))")
                        .font(.system(size: 11))
                        .foregroundStyle(Color.dsTextSecondary)
                    Text("处理说明：\(displayReason)")
                        .font(.system(size: 11))
                        .foregroundStyle(Color.dsTextSecondary)
                        .lineLimit(2)
                    if item.usedAI {
                        TrustMicroBadge(text: "辅助判断", tone: .neutral)
                    }
                }
                Spacer()
            }
            if item.status != .resolved && item.status != .dismissed {
                HStack(spacing: DS.Space.sm) {
                    Button("确认处理") {
                        store.resolveModerationCase(id: item.id, action: .confirmViolation)
                        onAction("已完成处理，账号状态已同步更新。")
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(Color.dsDanger)
                    Button("无需处理") {
                        store.resolveModerationCase(id: item.id, action: .dismiss)
                        onAction("已标记为无需处理。")
                    }
                    .buttonStyle(.bordered)
                    Button("继续查看") {
                        store.resolveModerationCase(id: item.id, action: .escalate)
                        onAction("已保留在待处理列表。")
                    }
                    .buttonStyle(.bordered)
                }
                .font(.system(size: 11, weight: .semibold))
            }
        }
        .padding(DS.Space.md)
        .background(Color.dsBackground, in: RoundedRectangle(cornerRadius: DS.Radius.sm, style: .continuous))
    }

    private func icon(for level: RiskLevel) -> String {
        switch level {
        case .low: "checkmark.shield"
        case .medium: "exclamationmark.shield"
        case .high: "exclamationmark.triangle.fill"
        }
    }

    private func color(for level: RiskLevel) -> Color {
        switch level {
        case .low: Color.dsSuccess
        case .medium: Color.dsWarning
        case .high: Color.dsDanger
        }
    }

    private func severityText(for level: RiskLevel) -> String {
        switch level {
        case .low: "普通"
        case .medium: "需留意"
        case .high: "优先"
        }
    }

    private func statusText(for status: ModerationCaseStatus) -> String {
        switch status {
        case .pending, .autoReviewing: "待查看"
        case .humanReview: "继续查看"
        case .resolved: "已处理"
        case .dismissed: "无需处理"
        }
    }

    private var displayTitle: String {
        item.title
            .replacingOccurrences(of: "审核", with: "资料")
            .replacingOccurrences(of: "未通过", with: "未展示")
            .replacingOccurrences(of: "违规", with: "越界")
            .replacingOccurrences(of: "待复核", with: "待查看")
            .replacingOccurrences(of: "预警", with: "提醒")
            .replacingOccurrences(of: "拦截", with: "未发送")
    }

    private var displayReason: String {
        if item.aiReason.contains("规则引擎") {
            return "需要继续查看"
        }
        return item.aiReason
            .replacingOccurrences(of: "违规", with: "越界")
            .replacingOccurrences(of: "审核", with: "查看")
    }
}
#endif
