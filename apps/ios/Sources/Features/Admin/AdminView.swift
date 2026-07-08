import SwiftUI

#if DEBUG
struct AdminView: View {
    @EnvironmentObject private var store: AppStore

    var body: some View {
        AppScaffold(title: "内容安全工作台", spacing: DS.Space.lg, bottomPadding: DS.Space.xxl) {
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
                Text("平台安全运营")
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(Color.dsTextPrimary)
                Text("聊天、社区与举报内容会统一进入平台安全复核流程。")
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

    private var aiModeValue: String {
        guard BackendConfig.isEnabled else { return "未启用" }
        if store.isBackendConnected {
            return store.backendModerationModel.isEmpty ? "DeepSeek" : store.backendModerationModel
        }
        return "未连接"
    }

    var body: some View {
        LazyVGrid(columns: columns, spacing: DS.Space.md) {
            AdminMetric(title: "待复核内容", value: "\(store.pendingModerationCount)", symbol: "shield.checkered")
            AdminMetric(title: "今日拦截", value: "\(store.blockedTodayCount)", symbol: "hand.raised")
            AdminMetric(title: "受限用户", value: store.user.accountStatus == .restricted ? "1" : "0", symbol: "person.crop.circle.badge.exclamationmark")
            AdminMetric(title: "安全模型", value: aiModeValue, symbol: "brain")
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
                SectionHeader(title: "复核队列", subtitle: "资料、聊天、举报统一处理")
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
                    EmptyStateView(symbol: "tray", title: "暂无待处理内容", subtitle: "触发平台安全规则或收到举报后会出现在这里。")
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
                    Text(item.title)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Color.dsTextPrimary)
                    Text("\(item.category) · 风险\(item.riskLevel.rawValue) · \(item.status.displayName)")
                        .font(.system(size: 11))
                        .foregroundStyle(Color.dsTextSecondary)
                    Text("风险评分 \(String(format: "%.2f", item.aiScore)) · \(item.aiReason)")
                        .font(.system(size: 11))
                        .foregroundStyle(Color.dsTextSecondary)
                        .lineLimit(2)
                    if item.usedAI {
                        TrustMicroBadge(text: "辅助识别", tone: .neutral)
                    }
                }
                Spacer()
            }
            if item.status != .resolved && item.status != .dismissed {
                HStack(spacing: DS.Space.sm) {
                    Button("确认违规") {
                        store.resolveModerationCase(id: item.id, action: .confirmViolation)
                        onAction("已确认违规，信用分与账号状态已同步更新。")
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(Color.dsDanger)
                    Button("误报驳回") {
                        store.resolveModerationCase(id: item.id, action: .dismiss)
                        onAction("已驳回误报，安全分已恢复。")
                    }
                    .buttonStyle(.bordered)
                    Button("转人工复核") {
                        store.resolveModerationCase(id: item.id, action: .escalate)
                        onAction("已转入人工复核，内容会继续保留在复核队列中。")
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
}
#endif
