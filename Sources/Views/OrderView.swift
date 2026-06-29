import SwiftUI

struct OrderView: View {
    let companionId: String
    @EnvironmentObject private var store: AppStore
    @State private var selectedThemeId = ""
    @State private var selectedDuration = 30
    @State private var agreedToRules = false
    @State private var isPaying = false

    private let durations = [30, 60, 90, 120]
    private var companion: Companion? { store.companion(by: companionId) }
    private var totalPrice: Int {
        guard let companion else { return 0 }
        return companion.pricePerHalfHour * max(1, selectedDuration / 30)
    }

    var body: some View {
        AppScaffold(title: "确认订单", spacing: 18, bottomPadding: 44) {
            if let companion {
                CompanionOrderHeader(companion: companion)
                OrderTrustPoints()
                VerificationGate()
                ThemePicker(selectedThemeId: $selectedThemeId)
                DurationPicker(selectedDuration: $selectedDuration, durations: durations)
                PricePanel(duration: selectedDuration, totalPrice: totalPrice)
                RulesPanel(agreedToRules: $agreedToRules)
                PrimaryActionButton(
                    title: isPaying ? "模拟支付中..." : "确认并进入沟通",
                    systemImage: isPaying ? "hourglass" : "lock.fill",
                    isEnabled: agreedToRules && !isPaying
                ) {
                    submit()
                }
                .accessibilityIdentifier("confirmOrderButton")
            } else {
                EmptyStateView(symbol: "cart.badge.questionmark", title: "订单对象不存在", subtitle: "请返回重新选择陪伴者。")
            }
        }
        .onAppear {
            if selectedThemeId.isEmpty {
                selectedThemeId = store.themes.first?.id ?? ""
            }
        }
    }

    private func submit() {
        guard store.user.isVerified else {
            store.navigate(.verify)
            return
        }
        isPaying = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
            _ = store.createOrder(companionId: companionId, themeId: selectedThemeId, durationMinutes: selectedDuration)
            isPaying = false
            store.navigate(.chat(companionId))
        }
    }
}

private struct OrderTrustPoints: View {
    private let items = [
        ("线上沟通", "bubble.left.and.bubble.right", Color.appTeal),
        ("18+", "18.circle", Color.appCoral),
        ("平台担保", "lock.shield", Color.appLilac),
        ("可举报", "exclamationmark.bubble", Color.appGold)
    ]

    var body: some View {
        HStack(spacing: 8) {
            ForEach(items, id: \.0) { item in
                VStack(spacing: 6) {
                    Image(systemName: item.1)
                        .foregroundStyle(item.2)
                    Text(item.0)
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(Color.appInk)
                        .lineLimit(1)
                        .minimumScaleFactor(0.75)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 10)
                .background(.white.opacity(0.48), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
        }
    }
}

struct CompanionOrderHeader: View {
    let companion: Companion

    var body: some View {
        GlassPanel(cornerRadius: 26, tint: Color.appTeal.opacity(0.1)) {
            HStack(spacing: 14) {
                CompanionAvatar(companion: companion, size: 58)
                VStack(alignment: .leading, spacing: 5) {
                    Text(companion.name)
                        .font(.headline)
                        .foregroundStyle(Color.appInk)
                    Text(companion.role)
                        .font(.subheadline)
                        .foregroundStyle(Color.appMuted)
                }
                Spacer()
                StatusPill(text: "平台担保", symbol: "lock.shield", color: Color.appTeal)
            }
        }
    }
}

private struct VerificationGate: View {
    @EnvironmentObject private var store: AppStore

    var body: some View {
        GlassPanel(cornerRadius: 22, tint: store.user.isVerified ? Color.appTeal.opacity(0.08) : Color.appCoral.opacity(0.08)) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: store.user.isVerified ? "checkmark.seal.fill" : "person.badge.key")
                    .foregroundStyle(store.user.isVerified ? Color.appTeal : Color.appCoral)
                VStack(alignment: .leading, spacing: 5) {
                    Text(store.user.isVerified ? "18+ 实名已完成" : "下单前需完成 18+ 实名")
                        .font(.headline)
                        .foregroundStyle(Color.appInk)
                    Text(store.user.isVerified ? "演示版已通过本地模拟实名与年龄核验。" : "不采集真实身份证，仅模拟姓名、年龄、人脸和手机号校验流程。")
                        .font(.subheadline)
                        .foregroundStyle(Color.appMuted)
                }
                Spacer()
                if !store.user.isVerified {
                    Button("去认证") {
                        store.navigate(.verify)
                    }
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(Color.appCoral)
                }
            }
        }
    }
}

private struct ThemePicker: View {
    @EnvironmentObject private var store: AppStore
    @Binding var selectedThemeId: String

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeader(title: "沟通主题")
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                ForEach(store.themes) { theme in
                    SelectableTile(title: theme.name, symbol: theme.icon, isSelected: selectedThemeId == theme.id) {
                        selectedThemeId = theme.id
                    }
                }
            }
        }
    }
}

private struct DurationPicker: View {
    @Binding var selectedDuration: Int
    let durations: [Int]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeader(title: "沟通时长")
            HStack(spacing: 8) {
                ForEach(durations, id: \.self) { duration in
                    SelectableTile(title: "\(duration) 分钟", symbol: "timer", isSelected: selectedDuration == duration) {
                        selectedDuration = duration
                    }
                }
            }
        }
    }
}

private struct SelectableTile: View {
    let title: String
    let symbol: String
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 7) {
                Image(systemName: symbol)
                Text(title)
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
            }
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(isSelected ? .white : Color.appInk)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
            .background(isSelected ? Color.appInk : Color.white.opacity(0.5), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
        .buttonStyle(.plain)
        .liquidGlass(cornerRadius: 16, tint: isSelected ? Color.appTeal.opacity(0.2) : .white.opacity(0.1), interactive: true)
    }
}

private struct PricePanel: View {
    let duration: Int
    let totalPrice: Int

    var body: some View {
        GlassPanel(cornerRadius: 24, tint: Color.appGold.opacity(0.09)) {
            VStack(spacing: 12) {
                HStack {
                    Text("沟通时长")
                    Spacer()
                    Text("\(duration) 分钟")
                }
                HStack {
                    Text("平台担保")
                    Spacer()
                    Text("模拟冻结资金")
                }
                Divider()
                HStack {
                    Text("合计")
                        .font(.headline)
                    Spacer()
                    Text("¥\(totalPrice)")
                        .font(.system(size: 28, weight: .bold, design: .rounded))
                        .foregroundStyle(Color.appCoral)
                }
            }
            .font(.subheadline)
            .foregroundStyle(Color.appInk)
        }
    }
}

private struct RulesPanel: View {
    @Binding var agreedToRules: Bool
    private let rules = ["仅限平台内文字/语音沟通", "禁止线下邀约和私下转账", "不提供医疗诊断或治疗承诺", "不适可立即结束并举报"]

    var body: some View {
        GlassPanel(cornerRadius: 24, tint: Color.appCoral.opacity(0.08)) {
            VStack(alignment: .leading, spacing: 12) {
                SectionHeader(title: "安全规范", subtitle: "继续下单代表你理解服务边界")
                ForEach(rules, id: \.self) { rule in
                    Label(rule, systemImage: "checkmark.circle.fill")
                        .font(.subheadline)
                        .foregroundStyle(Color.appInk)
                }
                Toggle("我已阅读并同意平台安全规范", isOn: $agreedToRules)
                    .font(.subheadline.weight(.semibold))
                    .tint(Color.appTeal)
            }
        }
    }
}
