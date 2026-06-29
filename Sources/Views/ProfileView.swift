import SwiftUI

struct ProfileView: View {
    @EnvironmentObject private var store: AppStore

    var body: some View {
        AppScaffold(title: "我的", spacing: DS.Space.lg) {
            UserPanel()
            SafetyScorePanel()
            MenuPanel()
            OperatorNote()
        }
    }
}

private struct UserPanel: View {
    @EnvironmentObject private var store: AppStore

    var body: some View {
        SoftCard {
            HStack(spacing: DS.Space.lg) {
                ZStack {
                    RoundedRectangle(cornerRadius: DS.Radius.md, style: .continuous)
                        .fill(Color.dsPrimary.opacity(0.12))
                    Text("TT")
                        .font(.system(size: 22, weight: .semibold))
                        .foregroundStyle(Color.dsPrimary)
                }
                .frame(width: 64, height: 64)
                VStack(alignment: .leading, spacing: DS.Space.sm) {
                    HStack {
                        Text(store.user.name)
                            .font(.system(size: 17, weight: .semibold))
                            .foregroundStyle(Color.dsTextPrimary)
                        if store.user.isVerified {
                            Image(systemName: "checkmark.seal.fill")
                                .foregroundStyle(Color.dsPrimary)
                        }
                    }
                    Text("\(store.user.phone) · \(store.user.age)+")
                        .font(.system(size: 13))
                        .foregroundStyle(Color.dsTextSecondary)
                    StatusPill(
                        text: store.user.isVerified ? "已完成 18+ 实名" : "未完成实名",
                        symbol: store.user.isVerified ? "checkmark.shield" : "person.badge.key",
                        color: store.user.isVerified ? Color.dsPrimary : Color.dsWarning
                    )
                }
                Spacer()
            }
        }
    }
}

private struct SafetyScorePanel: View {
    @EnvironmentObject private var store: AppStore
    private let creditService = CreditService()

    var body: some View {
        SoftCard {
            VStack(alignment: .leading, spacing: DS.Space.md) {
                SectionHeader(
                    title: "安全分",
                    subtitle: "\(creditService.scoreLevel(for: store.user.safetyScore)) · \(store.user.accountStatus.displayName)"
                )
                if store.user.accountStatus != .active {
                    Text(store.accountRestrictions.summary)
                        .font(.system(size: 13))
                        .foregroundStyle(Color.dsDanger)
                        .padding(DS.Space.md)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color.dsDanger.opacity(0.08), in: RoundedRectangle(cornerRadius: DS.Radius.sm, style: .continuous))
                }
                HStack(alignment: .lastTextBaseline) {
                    Text("\(store.user.safetyScore)")
                        .font(.system(size: 40, weight: .semibold))
                        .foregroundStyle(Color.dsTextPrimary)
                    Text("/100")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(Color.dsTextSecondary)
                    Spacer()
                    VStack(alignment: .trailing, spacing: DS.Space.xxs) {
                        Image(systemName: "shield.checkered")
                            .font(.system(size: 28))
                            .foregroundStyle(Color.dsPrimary)
                        Text("违规 \(store.user.violationCount) 次")
                            .font(.system(size: 11))
                            .foregroundStyle(Color.dsTextSecondary)
                    }
                }
                ProgressView(value: Double(store.user.safetyScore), total: 100)
                    .tint(Color.dsPrimary)
                VStack(alignment: .leading, spacing: DS.Space.sm) {
                    Text("最近信用变动")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(Color.dsTextSecondary)
                    ForEach(store.creditEvents.prefix(3)) { event in
                        HStack {
                            Text(event.reason)
                                .font(.system(size: 13))
                                .foregroundStyle(Color.dsTextPrimary)
                                .lineLimit(1)
                            Spacer()
                            Text(event.delta == 0 ? "—" : "\(event.delta > 0 ? "+" : "")\(event.delta)")
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(event.delta >= 0 ? Color.dsSuccess : Color.dsDanger)
                        }
                    }
                }
            }
        }
    }
}

private struct MenuPanel: View {
    @EnvironmentObject private var store: AppStore

    var body: some View {
        VStack(spacing: 0) {
            DSListRow(title: "安全中心", subtitle: "信任体系", symbol: "shield.checkered") {
                store.navigate(.safetyCenter)
            }
            Divider().padding(.leading, 52)
            DSListRow(
                title: "18+ 实名认证",
                subtitle: store.user.isVerified ? "已完成" : "待完成",
                symbol: "person.badge.key"
            ) {
                store.navigate(.verify)
            }
            Divider().padding(.leading, 52)
            DSListRow(
                title: "演示后台",
                subtitle: "\(store.moderationCases.count) 条事件",
                symbol: "shield.lefthalf.filled"
            ) {
                store.navigate(.admin)
            }
            Divider().padding(.leading, 52)
            DSListRow(title: "平台规范", subtitle: "线上服务边界", symbol: "doc.text")
        }
        .background(Color.dsSurface, in: RoundedRectangle(cornerRadius: DS.Radius.md, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: DS.Radius.md, style: .continuous)
                .stroke(Color.dsBorder, lineWidth: 1)
        }
    }
}

private struct OperatorNote: View {
    var body: some View {
        SoftCard {
            VStack(alignment: .leading, spacing: DS.Space.sm) {
                Label("Demo 说明", systemImage: "info.circle")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Color.dsTextPrimary)
                Text("当前版本不接后端、不保存真实身份、不发起真实支付。内容审查默认使用本地规则引擎；配置 MODERATION_API_KEY 后可启用 AI 辅助审查。")
                    .font(.system(size: 13))
                    .foregroundStyle(Color.dsTextSecondary)
                    .lineSpacing(3)
            }
        }
    }
}
