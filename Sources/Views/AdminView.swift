import SwiftUI

struct AdminView: View {
    @EnvironmentObject private var store: AppStore

    var body: some View {
        AppScaffold(title: "演示后台", spacing: 18, bottomPadding: 32) {
            AdminHero()
            AdminMetricGrid()
            ModerationQueue()
        }
    }
}

private struct AdminHero: View {
    var body: some View {
        GlassPanel(cornerRadius: 30, tint: Color.appTeal.opacity(0.12)) {
            VStack(alignment: .leading, spacing: 10) {
                Text("审核与风控控制台")
                    .font(.system(size: 29, weight: .bold, design: .rounded))
                    .foregroundStyle(Color.appInk)
                Text("规则引擎 + 可选 AI 审查，聊天、社区、举报统一进入工单台。")
                    .font(.subheadline)
                    .foregroundStyle(Color.appMuted)
                    .lineSpacing(3)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

private struct AdminMetricGrid: View {
    @EnvironmentObject private var store: AppStore
    private let columns = [GridItem(.flexible()), GridItem(.flexible())]

    var body: some View {
        LazyVGrid(columns: columns, spacing: 12) {
            AdminMetric(title: "待审工单", value: "\(store.pendingModerationCount)", symbol: "shield.checkered")
            AdminMetric(title: "今日拦截", value: "\(store.blockedTodayCount)", symbol: "hand.raised")
            AdminMetric(title: "受限用户", value: store.user.accountStatus == .restricted ? "1" : "0", symbol: "person.crop.circle.badge.exclamationmark")
            AdminMetric(title: "AI 模式", value: ModerationConfig.isAPIEnabled ? "开启" : "规则", symbol: "brain")
        }
    }
}

private struct AdminMetric: View {
    let title: String
    let value: String
    let symbol: String

    var body: some View {
        GlassPanel(cornerRadius: 22) {
            VStack(alignment: .leading, spacing: 10) {
                Image(systemName: symbol)
                    .foregroundStyle(Color.appTeal)
                Text(value)
                    .font(.system(size: 32, weight: .bold, design: .rounded))
                    .foregroundStyle(Color.appInk)
                Text(title)
                    .font(.caption)
                    .foregroundStyle(Color.appMuted)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

private struct ModerationQueue: View {
    @EnvironmentObject private var store: AppStore

    var body: some View {
        SoftCard(cornerRadius: 24, tint: Color.appCoral, padding: 16) {
            VStack(alignment: .leading, spacing: 12) {
                SectionHeader(title: "审核队列", subtitle: "资料、聊天、举报统一处理")
                ForEach(store.moderationCases) { item in
                    ModerationCaseRow(item: item)
                }
            }
        }
    }
}

private struct ModerationCaseRow: View {
    let item: ModerationCase
    @EnvironmentObject private var store: AppStore

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 12) {
                Image(systemName: icon(for: item.riskLevel))
                    .foregroundStyle(color(for: item.riskLevel))
                    .frame(width: 26)
                VStack(alignment: .leading, spacing: 3) {
                    Text(item.title)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Color.appInk)
                    Text("\(item.category) · 风险\(item.riskLevel.rawValue) · \(item.status.displayName)")
                        .font(.caption)
                        .foregroundStyle(Color.appMuted)
                    Text("AI 分数 \(String(format: "%.2f", item.aiScore)) · \(item.aiReason)")
                        .font(.caption2)
                        .foregroundStyle(Color.appMuted)
                        .lineLimit(2)
                    if item.usedAI {
                        TrustMicroBadge(text: "AI 参与", symbol: "brain", color: Color.appLilac)
                    }
                }
                Spacer()
            }
            if item.status != .resolved && item.status != .dismissed {
                HStack(spacing: 8) {
                    Button("确认违规") {
                        store.resolveModerationCase(id: item.id, action: .confirmViolation)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(Color.appCoral)
                    Button("误报驳回") {
                        store.resolveModerationCase(id: item.id, action: .dismiss)
                    }
                    .buttonStyle(.bordered)
                    Button("升级人工") {
                        store.resolveModerationCase(id: item.id, action: .escalate)
                    }
                    .buttonStyle(.bordered)
                }
                .font(.caption.weight(.semibold))
            }
        }
        .padding(12)
        .background(Color.appMist, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
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
        case .low: Color.appTeal
        case .medium: Color.appGold
        case .high: Color.appCoral
        }
    }
}
