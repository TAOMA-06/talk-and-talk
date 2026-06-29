import SwiftUI

struct AdminView: View {
    @EnvironmentObject private var store: AppStore

    var body: some View {
        AppScaffold(title: "演示后台", spacing: DS.Space.lg, bottomPadding: DS.Space.xxl) {
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
                Text("审核与风控控制台")
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(Color.dsTextPrimary)
                Text("规则引擎 + 可选 AI 审查，聊天、社区、举报统一进入工单台。")
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

    var body: some View {
        LazyVGrid(columns: columns, spacing: DS.Space.md) {
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

    var body: some View {
        SoftCard {
            VStack(alignment: .leading, spacing: DS.Space.md) {
                SectionHeader(title: "审核队列", subtitle: "资料、聊天、举报统一处理")
                if store.moderationCases.isEmpty {
                    EmptyStateView(symbol: "tray", title: "暂无工单", subtitle: "触发风控或举报后会出现在这里。")
                } else {
                    ForEach(store.moderationCases) { item in
                        ModerationCaseRow(item: item)
                    }
                }
            }
        }
    }
}

private struct ModerationCaseRow: View {
    let item: ModerationCase
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
                    Text("AI 分数 \(String(format: "%.2f", item.aiScore)) · \(item.aiReason)")
                        .font(.system(size: 11))
                        .foregroundStyle(Color.dsTextSecondary)
                        .lineLimit(2)
                    if item.usedAI {
                        TrustMicroBadge(text: "AI 参与", tone: .neutral)
                    }
                }
                Spacer()
            }
            if item.status != .resolved && item.status != .dismissed {
                HStack(spacing: DS.Space.sm) {
                    Button("确认违规") {
                        store.resolveModerationCase(id: item.id, action: .confirmViolation)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(Color.dsDanger)
                    Button("误报驳回") {
                        store.resolveModerationCase(id: item.id, action: .dismiss)
                    }
                    .buttonStyle(.bordered)
                    Button("升级人工") {
                        store.resolveModerationCase(id: item.id, action: .escalate)
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
