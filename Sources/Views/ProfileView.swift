import SwiftUI

struct ProfileView: View {
    @EnvironmentObject private var store: AppStore

    var body: some View {
        AppScaffold(title: "我的", spacing: 18) {
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
        GlassPanel(cornerRadius: 30, tint: Color.appTeal.opacity(0.12)) {
            HStack(spacing: 16) {
                ZStack {
                    Circle()
                        .fill(LinearGradient(colors: [Color.appTeal, Color.appLilac], startPoint: .topLeading, endPoint: .bottomTrailing))
                    Text("TT")
                        .font(.title2.bold())
                        .foregroundStyle(.white)
                }
                .frame(width: 72, height: 72)
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text(store.user.name)
                            .font(.title3.bold())
                            .foregroundStyle(Color.appInk)
                        if store.user.isVerified {
                            Image(systemName: "checkmark.seal.fill")
                                .foregroundStyle(Color.appTeal)
                        }
                    }
                    Text("\(store.user.phone) · \(store.user.age)+")
                        .font(.subheadline)
                        .foregroundStyle(Color.appMuted)
                    StatusPill(text: store.user.isVerified ? "已完成 18+ 实名" : "未完成实名", symbol: store.user.isVerified ? "checkmark.shield" : "person.badge.key", color: store.user.isVerified ? Color.appTeal : Color.appCoral)
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
        SoftCard(cornerRadius: 24, tint: Color.appGold, padding: 16) {
            VStack(alignment: .leading, spacing: 12) {
                SectionHeader(
                    title: "安全分",
                    subtitle: "\(creditService.scoreLevel(for: store.user.safetyScore)) · \(store.user.accountStatus.displayName)"
                )
                if store.user.accountStatus != .active {
                    Text(store.accountRestrictions.summary)
                        .font(.caption)
                        .foregroundStyle(Color.appCoral)
                        .padding(10)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color.appCoral.opacity(0.08), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
                HStack(alignment: .lastTextBaseline) {
                    Text("\(store.user.safetyScore)")
                        .font(.system(size: 46, weight: .bold, design: .rounded))
                        .foregroundStyle(Color.appInk)
                    Text("/100")
                        .font(.headline)
                        .foregroundStyle(Color.appMuted)
                    Spacer()
                    VStack(alignment: .trailing, spacing: 4) {
                        Image(systemName: "shield.checkered")
                            .font(.largeTitle)
                            .foregroundStyle(Color.appTeal)
                        Text("违规 \(store.user.violationCount) 次")
                            .font(.caption2)
                            .foregroundStyle(Color.appMuted)
                    }
                }
                ProgressView(value: Double(store.user.safetyScore), total: 100)
                    .tint(Color.appTeal)
                VStack(alignment: .leading, spacing: 8) {
                    Text("最近信用变动")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Color.appMuted)
                    ForEach(store.creditEvents.prefix(3)) { event in
                        HStack {
                            Text(event.reason)
                                .font(.caption)
                                .foregroundStyle(Color.appInk)
                                .lineLimit(1)
                            Spacer()
                            Text(event.delta == 0 ? "—" : "\(event.delta > 0 ? "+" : "")\(event.delta)")
                                .font(.caption.weight(.bold))
                                .foregroundStyle(event.delta >= 0 ? Color.appTeal : Color.appCoral)
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
        VStack(spacing: 10) {
            ProfileMenuRow(symbol: "shield.checkered", title: "安全中心", detail: "信任体系") {
                store.navigate(.safetyCenter)
            }
            ProfileMenuRow(symbol: "person.badge.key", title: "18+ 实名认证", detail: store.user.isVerified ? "已完成" : "待完成") {
                store.navigate(.verify)
            }
            ProfileMenuRow(symbol: "shield.lefthalf.filled", title: "演示后台", detail: "\(store.moderationCases.count) 条事件") {
                store.navigate(.admin)
            }
            ProfileMenuRow(symbol: "doc.text", title: "平台规范", detail: "线上服务边界") {}
        }
    }
}

private struct ProfileMenuRow: View {
    let symbol: String
    let title: String
    let detail: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            GlassPanel(cornerRadius: 20) {
                HStack {
                    Image(systemName: symbol)
                        .foregroundStyle(Color.appTeal)
                        .frame(width: 28)
                    Text(title)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Color.appInk)
                    Spacer()
                    Text(detail)
                        .font(.caption)
                        .foregroundStyle(Color.appMuted)
                    Image(systemName: "chevron.right")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(Color.appMuted)
                }
            }
        }
        .buttonStyle(.plain)
    }
}

private struct OperatorNote: View {
    var body: some View {
        GlassPanel(cornerRadius: 24, tint: Color.appCoral.opacity(0.08)) {
            VStack(alignment: .leading, spacing: 8) {
                Label("Demo 说明", systemImage: "info.circle")
                    .font(.headline)
                    .foregroundStyle(Color.appInk)
                Text("当前版本不接后端、不保存真实身份、不发起真实支付。内容审查默认使用本地规则引擎；配置 MODERATION_API_KEY 后可启用 AI 辅助审查。")
                    .font(.subheadline)
                    .foregroundStyle(Color.appMuted)
                    .lineSpacing(3)
            }
        }
    }
}
