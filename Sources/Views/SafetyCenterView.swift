import SwiftUI

struct SafetyCenterView: View {
    @State private var expandedSection: SafetySection? = .verification

    enum SafetySection: String, CaseIterable, Identifiable {
        case verification
        case escrow
        case emergency
        case credit
        case insurance

        var id: String { rawValue }

        var title: String {
            switch self {
            case .verification: "三层实名认证"
            case .escrow: "平台担保交易"
            case .emergency: "紧急安全机制"
            case .credit: "信用档案"
            case .insurance: "保险兜底"
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

        var tint: Color {
            switch self {
            case .verification: Color.appTeal
            case .escrow: Color.appLilac
            case .emergency: Color.appCoral
            case .credit: Color.appGold
            case .insurance: Color.appTeal
            }
        }
    }

    var body: some View {
        AppScaffold(title: "安全中心", spacing: 16, bottomPadding: 40) {
            SoftCard(cornerRadius: 24, tint: Color.appTeal, padding: 18) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("信任，是我们最核心的壁垒")
                        .font(.title3.weight(.bold))
                        .foregroundStyle(Color.appInk)
                    Text("微信群做不到的，我们一条一条做到。女生敢不敢，取决于她觉不觉得安全。")
                        .font(.subheadline)
                        .foregroundStyle(Color.appMuted)
                        .lineSpacing(3)
                }
            }

            ForEach(SafetySection.allCases) { section in
                SafetySectionCard(
                    section: section,
                    isExpanded: expandedSection == section
                ) {
                    withAnimation(.snappy) {
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
        SoftCard(cornerRadius: 20, tint: section.tint, padding: 0) {
            VStack(alignment: .leading, spacing: 0) {
                Button(action: toggle) {
                    HStack(spacing: 12) {
                        Image(systemName: section.symbol)
                            .font(.title3)
                            .foregroundStyle(section.tint)
                            .frame(width: 32)
                        Text(section.title)
                            .font(.headline)
                            .foregroundStyle(Color.appInk)
                        Spacer()
                        Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                            .font(.caption.weight(.bold))
                            .foregroundStyle(Color.appMuted)
                    }
                    .padding(16)
                }
                .buttonStyle(.plain)

                if isExpanded {
                    Divider().padding(.horizontal, 16)
                    sectionContent
                        .padding(16)
                        .padding(.top, 4)
                }
            }
        }
    }

    @ViewBuilder
    private var sectionContent: some View {
        switch section {
        case .verification:
            VStack(alignment: .leading, spacing: 12) {
                VerificationStep(number: 1, title: "身份证核验", detail: "确认真实身份与年龄")
                VerificationStep(number: 2, title: "人脸识别", detail: "活体检测，防止冒用")
                VerificationStep(number: 3, title: "手机号三绑", detail: "账号、支付、通知三重绑定")
            }
        case .escrow:
            VStack(alignment: .leading, spacing: 12) {
                EscrowStep(number: 1, title: "先付到平台", detail: "资金由平台托管")
                EscrowStep(number: 2, title: "服务进行中", detail: "全程平台内沟通")
                EscrowStep(number: 3, title: "完成后结算", detail: "防止跑单和欺诈")
            }
        case .emergency:
            VStack(alignment: .leading, spacing: 10) {
                EmergencyItem(symbol: "phone.fill", title: "一键报警", detail: "紧急情况下快速求助")
                EmergencyItem(symbol: "location.fill", title: "行程分享", detail: "向紧急联系人同步状态")
                EmergencyItem(symbol: "person.2.fill", title: "紧急联系人", detail: "预设可信赖的人")
                EmergencyItem(symbol: "clock.badge.exclamationmark", title: "超时自动提醒", detail: "异常时长自动触发安全流程")
            }
        case .credit:
            VStack(alignment: .leading, spacing: 10) {
                Text("安全分会随聊天、社区发帖和举报处置实时变化。")
                    .font(.subheadline)
                    .foregroundStyle(Color.appMuted)
                CreditRuleRow(title: "完成实名", detail: "基础信任分 85")
                CreditRuleRow(title: "warn 违规", detail: "-8 分，累计 3 次进入受限")
                CreditRuleRow(title: "block 违规", detail: "-20 分，累计 5 次或低于 20 分封禁")
                CreditRuleRow(title: "误报驳回", detail: "+5 分恢复")
                Text("受限账号无法在社区发帖；封禁账号无法发送消息。")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Color.appCoral)
            }
        case .insurance:
            Text("平台购买责任险，意外事件有保障。让你在沟通时多一份安心。")
                .font(.subheadline)
                .foregroundStyle(Color.appMuted)
                .lineSpacing(3)
        }
    }
}

private struct VerificationStep: View {
    let number: Int
    let title: String
    let detail: String

    var body: some View {
        HStack(spacing: 12) {
            Text("\(number)")
                .font(.caption.weight(.bold))
                .foregroundStyle(.white)
                .frame(width: 24, height: 24)
                .background(Color.appTeal, in: Circle())
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Color.appInk)
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(Color.appMuted)
            }
        }
    }
}

private struct EscrowStep: View {
    let number: Int
    let title: String
    let detail: String

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "arrow.right.circle.fill")
                .foregroundStyle(Color.appLilac)
            VStack(alignment: .leading, spacing: 2) {
                Text("\(number). \(title)")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Color.appInk)
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(Color.appMuted)
            }
        }
    }
}

private struct CreditRuleRow: View {
    let title: String
    let detail: String

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "circle.fill")
                .font(.system(size: 6))
                .foregroundStyle(Color.appGold)
                .padding(.top, 6)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Color.appInk)
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(Color.appMuted)
            }
        }
    }
}

private struct EmergencyItem: View {
    let symbol: String
    let title: String
    let detail: String

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: symbol)
                .foregroundStyle(Color.appCoral)
                .frame(width: 24)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Color.appInk)
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(Color.appMuted)
            }
        }
    }
}
