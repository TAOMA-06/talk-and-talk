import SwiftUI

struct OrderView: View {
    let companionId: String
    @EnvironmentObject private var store: AppStore
    @Environment(\.dismiss) private var dismiss
    @State private var selectedThemeId = ""
    @State private var selectedDuration = 30
    @State private var scheduledAt = Date().addingTimeInterval(3600)
    @State private var agreedToRules = false
    @State private var isSubmitting = false
    @State private var errorMessage: String?

    private let durations = [30, 60, 90, 120]
    private var companion: Companion? { store.companion(by: companionId) }
    private var selectedTheme: Theme? { store.theme(by: selectedThemeId) }
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
                SoftCard {
                    DatePicker("预约时间", selection: $scheduledAt, in: Date().addingTimeInterval(300)..., displayedComponents: [.date, .hourAndMinute])
                        .font(.system(size: 15, weight: .medium))
                }
                PricePanel(
                    unitPrice: companion.pricePerHalfHour,
                    duration: selectedDuration,
                    totalPrice: totalPrice
                )
                PlatformGuaranteePanel()
                RulesPanel(agreedToRules: $agreedToRules)
                OrderCheckoutSummary(
                    themeName: selectedTheme?.name ?? "线上沟通",
                    duration: selectedDuration,
                    totalPrice: totalPrice
                )
                if let errorMessage {
                    DSBanner(
                        title: "支付未完成",
                        message: errorMessage,
                        systemImage: "exclamationmark.triangle",
                        tone: .warning
                    )
                }
                DSPrimaryButton(
                    title: isSubmitting ? "正在支付..." : "确认并支付",
                    systemImage: isSubmitting ? "hourglass" : "yensign.circle.fill",
                    isEnabled: agreedToRules && !isSubmitting,
                    isLoading: isSubmitting
                ) {
                    submit()
                }
                .accessibilityLabel(isSubmitting ? "正在支付" : "确认并支付")
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
        isSubmitting = true
        errorMessage = nil
        Task {
            do {
                let order = try await store.createAndPayOrder(
                    companionId: companionId,
                    themeId: selectedThemeId,
                    durationMinutes: selectedDuration,
                    scheduledAt: scheduledAt
                )
                isSubmitting = false
                guard order.status == .paid || order.status == .inService else {
                    errorMessage = "支付结果未确认，请到订单页查看状态。"
                    store.selectedTab = .orders
                    return
                }
                store.navigate(.chat(.companion(id: companionId)))
            } catch {
                isSubmitting = false
                if let backendError = error as? BackendError {
                    errorMessage = backendError.userFacingMessage
                } else if let payError = error as? WeChatPayError {
                    switch payError {
                    case .cancelled:
                        errorMessage = "已取消支付"
                    case .notConfigured:
                        errorMessage = "微信支付未配置。请在 Config/Shared.xcconfig 填写 WECHAT_APP_ID，或使用已配置微信的正式构建。"
                    case .failed(let message):
                        errorMessage = message
                    }
                } else {
                    errorMessage = "下单或支付失败，请稍后重试"
                }
            }
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
        VStack(alignment: .leading, spacing: DS.Space.sm) {
            DSBanner(
                title: store.user.isVerified ? "18+ 实名已完成" : "先完成 18+ 实名",
                message: store.user.isVerified ? "可继续预约，沟通全程留在平台内。" : "完成年龄核验后再继续预约。",
                systemImage: store.user.isVerified ? "checkmark.seal.fill" : "person.badge.key",
                tone: store.user.isVerified ? .success : .warning
            )
            if !store.user.isVerified {
                DSButton(title: "去认证", systemImage: "person.badge.key", variant: .secondary, height: 38) {
                    store.navigate(.verify)
                }
                .accessibilityIdentifier("orderVerifyButton")
            }
        }
        .accessibilityIdentifier("orderVerificationGate")
    }
}

private struct ThemePicker: View {
    @EnvironmentObject private var store: AppStore
    @Binding var selectedThemeId: String

    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.md) {
            SectionHeader(title: "沟通主题", subtitle: "选择本次沟通主题")
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: DS.Space.sm) {
                ForEach(store.themes) { theme in
                    SelectableTile(
                        title: theme.name,
                        symbol: theme.icon,
                        isSelected: selectedThemeId == theme.id,
                        accessibilityIdentifier: "orderTheme-\(theme.id)"
                    ) {
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
            SectionHeader(title: "沟通时长", subtitle: "按 30 分钟计费")
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: DS.Space.sm) {
                ForEach(durations, id: \.self) { duration in
                    SelectableTile(
                        title: "\(duration) 分钟",
                        symbol: "timer",
                        isSelected: selectedDuration == duration,
                        accessibilityIdentifier: "orderDuration-\(duration)"
                    ) {
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
    var accessibilityIdentifier: String? = nil
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
        .accessibilityLabel(title)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
        .accessibilityIdentifier(accessibilityIdentifier ?? "selectableTile-\(title)")
    }
}

private struct PricePanel: View {
    let unitPrice: Int
    let duration: Int
    let totalPrice: Int

    var body: some View {
        SoftCard {
            VStack(spacing: DS.Space.md) {
                SectionHeader(title: "费用明细", subtitle: "确认前请核对金额与托管方式")
                priceRow(title: "单价", value: "¥\(unitPrice)/30 分钟")
                priceRow(title: "沟通时长", value: "\(duration) 分钟")
                priceRow(title: "资金托管", value: "资金托管中")
                HStack(alignment: .top, spacing: DS.Space.sm) {
                    Image(systemName: "bubble.left.and.bubble.right.fill")
                        .foregroundStyle(Color.dsPrimary)
                    Text("确认后进入聊天，试聊内容会保留。")
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

    private func priceRow(title: String, value: String) -> some View {
        HStack {
            Text(title)
            Spacer()
            Text(value)
        }
    }
}

private struct PlatformGuaranteePanel: View {
    private let steps = [
        ("1.circle.fill", "先付到平台托管", "费用暂由平台保管"),
        ("2.circle.fill", "全程平台内沟通", "文字与语音均在 App 内完成"),
        ("3.circle.fill", "服务完成后结算", "防止跑单，保障双方权益")
    ]

    var body: some View {
        SoftCard {
            VStack(alignment: .leading, spacing: DS.Space.md) {
                SectionHeader(title: "平台保障", subtitle: "资金与服务全程受平台规则保护")
                ForEach(steps, id: \.1) { step in
                    HStack(alignment: .top, spacing: DS.Space.md) {
                        Image(systemName: step.0)
                            .foregroundStyle(Color.dsPrimary)
                            .frame(width: 20)
                        VStack(alignment: .leading, spacing: DS.Space.xxs) {
                            Text(step.1)
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundStyle(Color.dsTextPrimary)
                            Text(step.2)
                                .font(.system(size: 12))
                                .foregroundStyle(Color.dsTextSecondary)
                        }
                    }
                }
            }
        }
    }
}

private struct OrderCheckoutSummary: View {
    let themeName: String
    let duration: Int
    let totalPrice: Int

    var body: some View {
        SoftCard {
            HStack(spacing: DS.Space.sm) {
                Image(systemName: "doc.text")
                    .foregroundStyle(Color.dsPrimary)
                Text("\(themeName) · \(duration) 分钟 · ¥\(totalPrice)")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Color.dsTextPrimary)
                    .lineLimit(2)
                Spacer(minLength: 0)
            }
        }
    }
}

private struct RulesPanel: View {
    @Binding var agreedToRules: Bool
    private let rules = ["仅限平台内文字/语音沟通", "禁止线下邀约和私下转账", "不提供医疗诊断或治疗承诺", "不适可立即结束并举报"]

    var body: some View {
        SoftCard {
            VStack(alignment: .leading, spacing: DS.Space.md) {
                SectionHeader(title: "沟通边界", subtitle: "预约前确认即可")
                ForEach(rules, id: \.self) { rule in
                    Label(rule, systemImage: "checkmark.circle.fill")
                        .font(.system(size: 13))
                        .foregroundStyle(Color.dsTextPrimary)
                }
                Toggle("我理解沟通边界", isOn: $agreedToRules)
                    .font(.system(size: 13, weight: .semibold))
                    .tint(Color.dsPrimary)
                    .accessibilityIdentifier("orderBoundaryToggle")
            }
        }
    }
}
