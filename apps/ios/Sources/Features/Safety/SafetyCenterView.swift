import SwiftUI

struct SafetyCenterView: View {
    @State private var expandedSection: SafetySection?

    enum SafetySection: String, CaseIterable, Identifiable {
        case verification
        case escrow
        case emergency
        case credit
        case insurance

        var id: String { rawValue }

        var title: String {
            switch self {
            case .verification: "实名认证"
            case .escrow: "资金托管"
            case .emergency: "紧急求助"
            case .credit: "安全分"
            case .insurance: "异常保障"
            }
        }

        var symbol: String {
            switch self {
            case .verification: "person.text.rectangle"
            case .escrow: "lock.shield"
            case .emergency: "sos"
            case .credit: "star.bubble"
            case .insurance: "umbrella"
            }
        }
    }

    var body: some View {
        AppScaffold(title: "安全中心", spacing: DS.Space.lg, bottomPadding: DS.Space.xl) {
            SoftCard {
                VStack(alignment: .leading, spacing: DS.Space.sm) {
                    Text("安全机制")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(Color.dsTextPrimary)
                    Text("实名、资金托管、内容审核和安全分，一起保护你的沟通。")
                        .font(.system(size: 13))
                        .foregroundStyle(Color.dsTextSecondary)
                        .lineSpacing(3)
                }
            }

            ForEach(SafetySection.allCases) { section in
                SafetySectionCard(
                    section: section,
                    isExpanded: expandedSection == section
                ) {
                    withAnimation(.easeOut(duration: DS.Motion.fast)) {
                        expandedSection = expandedSection == section ? nil : section
                    }
                }
            }
        }
    }
}

private struct SafetySectionCard: View {
    let section: SafetyCenterView.SafetySection
    let isExpanded: Bool
    let toggle: () -> Void

    var body: some View {
        SoftCard(padding: 0) {
            VStack(alignment: .leading, spacing: 0) {
                Button(action: toggle) {
                    HStack(spacing: DS.Space.md) {
                        Image(systemName: section.symbol)
                            .font(.system(size: 17))
                            .foregroundStyle(Color.dsPrimary)
                            .frame(width: 32)
                        Text(section.title)
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(Color.dsTextPrimary)
                        Spacer()
                        Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(Color.dsTextSecondary)
                    }
                    .padding(DS.Space.lg)
                }
                .buttonStyle(.plain)

                if isExpanded {
                    Divider().padding(.horizontal, DS.Space.lg)
                    sectionContent
                        .padding(DS.Space.lg)
                        .padding(.top, DS.Space.xxs)
                }
            }
        }
    }

    @ViewBuilder
    private var sectionContent: some View {
        switch section {
        case .verification:
            VStack(alignment: .leading, spacing: DS.Space.md) {
                VerificationStep(number: 1, title: "身份证核验", detail: "确认身份与年龄")
                VerificationStep(number: 2, title: "人脸识别", detail: "活体防冒用")
                VerificationStep(number: 3, title: "手机号绑定", detail: "绑定通知手机")
            }
        case .escrow:
            VStack(alignment: .leading, spacing: DS.Space.md) {
                EscrowStep(number: 1, title: "先付到平台", detail: "资金由平台托管")
                EscrowStep(number: 2, title: "平台内沟通", detail: "全程留在 App 内")
                EscrowStep(number: 3, title: "完成后结算", detail: "服务结束再结算")
            }
        case .emergency:
            VStack(alignment: .leading, spacing: DS.Space.sm) {
                EmergencyItem(symbol: "phone.fill", title: "一键报警", detail: "紧急情况快速求助")
                EmergencyItem(symbol: "exclamationmark.bubble.fill", title: "越界预警", detail: "不当表达会提醒")
                EmergencyItem(symbol: "person.2.fill", title: "紧急联系人", detail: "预设可信赖的人")
                EmergencyItem(symbol: "clock.badge.exclamationmark", title: "超时提醒", detail: "异常时长自动提示")
            }
        case .credit:
            VStack(alignment: .leading, spacing: DS.Space.sm) {
                Text("聊天、发帖和举报都会影响分数。")
                    .font(.system(size: 13))
                    .foregroundStyle(Color.dsTextSecondary)
                CreditRuleRow(title: "完成实名", detail: "基础分 85")
                CreditRuleRow(title: "轻度违规", detail: "-8 分；前 2 次仅提醒")
                CreditRuleRow(title: "严重违规", detail: "-20 分；多次或低于 20 分封禁")
                CreditRuleRow(title: "误报驳回", detail: "+5 分恢复")
                Text("受限账号无法发帖；封禁账号无法发消息。")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Color.dsDanger)
            }
        case .insurance:
            Text("订单异常时平台介入，沟通全程留痕。")
                .font(.system(size: 13))
                .foregroundStyle(Color.dsTextSecondary)
                .lineSpacing(3)
        }
    }
}

private struct VerificationStep: View {
    let number: Int
    let title: String
    let detail: String

    var body: some View {
        HStack(spacing: DS.Space.md) {
            Text("\(number)")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 24, height: 24)
                .background(Color.dsPrimary, in: Circle())
            VStack(alignment: .leading, spacing: DS.Space.xxs) {
                Text(title)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Color.dsTextPrimary)
                Text(detail)
                    .font(.system(size: 11))
                    .foregroundStyle(Color.dsTextSecondary)
            }
        }
    }
}

private struct EscrowStep: View {
    let number: Int
    let title: String
    let detail: String

    var body: some View {
        HStack(spacing: DS.Space.md) {
            Image(systemName: "arrow.right.circle.fill")
                .foregroundStyle(Color.dsPrimary)
            VStack(alignment: .leading, spacing: DS.Space.xxs) {
                Text("\(number). \(title)")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Color.dsTextPrimary)
                Text(detail)
                    .font(.system(size: 11))
                    .foregroundStyle(Color.dsTextSecondary)
            }
        }
    }
}

private struct CreditRuleRow: View {
    let title: String
    let detail: String

    var body: some View {
        HStack(alignment: .top, spacing: DS.Space.sm) {
            Image(systemName: "circle.fill")
                .font(.system(size: 6))
                .foregroundStyle(Color.dsTextSecondary)
                .padding(.top, 6)
            VStack(alignment: .leading, spacing: DS.Space.xxs) {
                Text(title)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Color.dsTextPrimary)
                Text(detail)
                    .font(.system(size: 11))
                    .foregroundStyle(Color.dsTextSecondary)
            }
        }
    }
}

private struct EmergencyItem: View {
    let symbol: String
    let title: String
    let detail: String

    var body: some View {
        HStack(spacing: DS.Space.md) {
            Image(systemName: symbol)
                .foregroundStyle(Color.dsPrimary)
                .frame(width: 24)
            VStack(alignment: .leading, spacing: DS.Space.xxs) {
                Text(title)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Color.dsTextPrimary)
                Text(detail)
                    .font(.system(size: 11))
                    .foregroundStyle(Color.dsTextSecondary)
            }
        }
    }
}
