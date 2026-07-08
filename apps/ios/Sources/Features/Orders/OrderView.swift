import SwiftUI

struct OrderView: View {
    let companionId: String
    @EnvironmentObject private var store: AppStore
    @Environment(\.dismiss) private var dismiss
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
        AppScaffold(title: "确认订单", spacing: DS.Space.lg, bottomPadding: DS.Space.xl) {
            if let companion {
                CompanionOrderHeader(companion: companion)
                OrderTrustPoints()
                VerificationGate()
                ThemePicker(selectedThemeId: $selectedThemeId)
                DurationPicker(selectedDuration: $selectedDuration, durations: durations)
                PricePanel(duration: selectedDuration, totalPrice: totalPrice)
                RulesPanel(agreedToRules: $agreedToRules)
                DSPrimaryButton(
                    title: isPaying ? "正在确认..." : "确认订单并继续沟通",
                    systemImage: isPaying ? "hourglass" : "bubble.left.and.bubble.right.fill",
                    isEnabled: agreedToRules && !isPaying,
                    isLoading: isPaying
                ) {
                    submit()
                }
                .accessibilityIdentifier("confirmOrderButton")
            } else {
                EmptyStateView(
                    symbol: "cart.badge.questionmark",
                    title: "暂时无法确认订单",
                    subtitle: "这位陪伴者的信息暂时不可用，请返回重新选择。",
                    actionTitle: "返回上一页",
                    action: { dismiss() }
                )
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
            store.navigate(.chat(.companion(id: companionId)))
        }
    }
}

private struct OrderTrustPoints: View {
    private let items = [
        ("线上沟通", "bubble.left.and.bubble.right"),
        ("18+", "18.circle"),
        ("平台担保", "lock.shield"),
        ("可举报", "exclamationmark.bubble")
    ]

    var body: some View {
        HStack(spacing: DS.Space.sm) {
            ForEach(items, id: \.0) { item in
                VStack(spacing: DS.Space.sm) {
                    Image(systemName: item.1)
                        .foregroundStyle(Color.dsPrimary)
                    Text(item.0)
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(Color.dsTextPrimary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.75)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, DS.Space.sm)
                .background(Color.dsSurfaceElevated, in: RoundedRectangle(cornerRadius: DS.Radius.md, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: DS.Radius.md, style: .continuous)
                        .stroke(Color.dsBorder.opacity(0.72), lineWidth: DS.Stroke.hairline)
                }
            }
        }
    }
}

struct CompanionOrderHeader: View {
    let companion: Companion

    var body: some View {
        SoftCard {
            HStack(spacing: DS.Space.md) {
                CompanionAvatar(companion: companion, size: 48)
                VStack(alignment: .leading, spacing: DS.Space.xxs) {
                    Text(companion.name)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Color.dsTextPrimary)
                    Text(companion.role)
                        .font(.system(size: 13))
                        .foregroundStyle(Color.dsTextSecondary)
                }
                Spacer()
                StatusPill(text: "平台担保", symbol: "lock.shield", color: Color.dsPrimary)
            }
        }
    }
}

private struct VerificationGate: View {
    @EnvironmentObject private var store: AppStore

    var body: some View {
        DSBanner(
            title: store.user.isVerified ? "18+ 实名已完成" : "先完成 18+ 实名",
            message: store.user.isVerified ? "可以继续确认订单，沟通全程留在平台内。" : "完成实名与年龄核验后，再继续确认订单。",
            systemImage: store.user.isVerified ? "checkmark.seal.fill" : "person.badge.key",
            tone: store.user.isVerified ? .success : .warning
        )
        .overlay(alignment: .trailing) {
            if !store.user.isVerified {
                Button("去认证") {
                    store.navigate(.verify)
                }
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.dsPrimary)
                .padding(.trailing, DS.Space.md)
            }
        }
    }
}

private struct ThemePicker: View {
    @EnvironmentObject private var store: AppStore
    @Binding var selectedThemeId: String

    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.md) {
            SectionHeader(title: "沟通主题")
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: DS.Space.sm) {
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
        VStack(alignment: .leading, spacing: DS.Space.md) {
            SectionHeader(title: "沟通时长")
            HStack(spacing: DS.Space.sm) {
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
            HStack(spacing: DS.Space.sm) {
                Image(systemName: symbol)
                Text(title)
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
            }
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(isSelected ? .white : Color.dsTextPrimary)
            .frame(maxWidth: .infinity)
            .padding(.vertical, DS.Space.md)
            .background(isSelected ? Color.dsPrimary : Color.dsSurfaceElevated, in: RoundedRectangle(cornerRadius: DS.Radius.md, style: .continuous))
            .overlay {
                if !isSelected {
                    RoundedRectangle(cornerRadius: DS.Radius.md, style: .continuous)
                        .stroke(Color.dsBorder.opacity(0.72), lineWidth: DS.Stroke.hairline)
                }
            }
        }
        .buttonStyle(.plain)
    }
}

private struct PricePanel: View {
    let duration: Int
    let totalPrice: Int

    var body: some View {
        SoftCard {
            VStack(spacing: DS.Space.md) {
                HStack {
                    Text("沟通时长")
                    Spacer()
                    Text("\(duration) 分钟")
                }
                HStack {
                    Text("平台担保")
                    Spacer()
                    Text("资金托管中")
                }
                HStack(alignment: .top, spacing: DS.Space.sm) {
                    Image(systemName: "bubble.left.and.bubble.right.fill")
                        .foregroundStyle(Color.dsPrimary)
                    Text("确认后会进入聊天；如果是从试聊过来，已有内容会保留。")
                        .foregroundStyle(Color.dsTextSecondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                Divider()
                HStack {
                    Text("合计")
                        .font(.system(size: 15, weight: .semibold))
                    Spacer()
                    Text("¥\(totalPrice)")
                        .font(.system(size: 24, weight: .semibold))
                        .foregroundStyle(Color.dsTextPrimary)
                }
            }
            .font(.system(size: 13))
            .foregroundStyle(Color.dsTextPrimary)
        }
    }
}

private struct RulesPanel: View {
    @Binding var agreedToRules: Bool
    private let rules = ["仅限平台内文字/语音沟通", "禁止线下邀约和私下转账", "不提供医疗诊断或治疗承诺", "不适可立即结束并举报"]

    var body: some View {
        SoftCard {
            VStack(alignment: .leading, spacing: DS.Space.md) {
                SectionHeader(title: "安全规范", subtitle: "继续下单代表你理解服务边界")
                ForEach(rules, id: \.self) { rule in
                    Label(rule, systemImage: "checkmark.circle.fill")
                        .font(.system(size: 13))
                        .foregroundStyle(Color.dsTextPrimary)
                }
                Toggle("我已阅读并同意平台安全规范", isOn: $agreedToRules)
                    .font(.system(size: 13, weight: .semibold))
                    .tint(Color.dsPrimary)
            }
        }
    }
}
