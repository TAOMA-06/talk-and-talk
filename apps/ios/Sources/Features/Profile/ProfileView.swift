import SwiftUI

struct ProfileView: View {
    @EnvironmentObject private var store: AppStore

    var body: some View {
        AppScaffold(title: "我的", spacing: DS.Space.lg) {
            UserPanel()
            SafetyScorePanel()
            MenuPanel()
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
                    Text(String(store.user.name.prefix(2)))
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
                    Text("账号状态 · \(store.user.accountStatus.displayName)")
                        .font(.system(size: 12))
                        .foregroundStyle(Color.dsTextSecondary)
                    HStack(spacing: DS.Space.sm) {
                        StatusPill(
                            text: store.user.isVerified ? "已完成 18+ 实名" : "未完成实名",
                            symbol: store.user.isVerified ? "checkmark.shield" : "person.badge.key",
                            color: store.user.isVerified ? Color.dsPrimary : Color.dsWarning
                        )
                        if let gender = store.user.gender {
                            StatusPill(
                                text: gender.displayName,
                                symbol: gender == .female ? "heart.text.square" : "checkmark.shield",
                                color: Color.dsPrimary
                            )
                        }
                    }
                }
                Spacer()
            }
        }
    }
}

private struct SafetyScorePanel: View {
    @EnvironmentObject private var store: AppStore
    private let creditService = CreditService()

    private var scoreLevel: String {
        creditService.scoreLevel(for: store.user.safetyScore)
    }

    var body: some View {
        Button {
            store.navigate(.safetyCenter)
        } label: {
            SoftCard {
                VStack(alignment: .leading, spacing: DS.Space.md) {
                    HStack(alignment: .center) {
                        SectionHeader(
                            title: "安全分",
                            subtitle: "\(scoreLevel) · 提醒 \(store.user.violationCount) 次"
                        )
                        Spacer(minLength: DS.Space.sm)
                        Image(systemName: "chevron.right")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(Color.dsTextSecondary)
                    }
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
                        Image(systemName: "shield.checkered")
                            .font(.system(size: 28))
                            .foregroundStyle(Color.dsPrimary)
                    }
                    ProgressView(value: Double(store.user.safetyScore), total: 100)
                        .tint(Color.dsPrimary)
                    VStack(alignment: .leading, spacing: DS.Space.sm) {
                        Text("最近变动")
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
        .buttonStyle(.plain)
        .accessibilityLabel("安全分，前往安全中心")
        .accessibilityIdentifier("profileSafetyScoreCard")
    }
}

private struct MenuPanel: View {
    @EnvironmentObject private var store: AppStore
    @State private var showingGenderSettings = false
    @State private var showingAgreement = false

    private let creditService = CreditService()

    private var scoreLevel: String {
        creditService.scoreLevel(for: store.user.safetyScore)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.lg) {
            menuGroup(title: "账户与身份") {
                DSListRow(
                    title: "身份设置",
                    subtitle: store.user.gender?.displayName ?? "待选择",
                    symbol: "person.2"
                ) {
                    showingGenderSettings = true
                }
                .accessibilityIdentifier("genderSettingsRow")
                menuDivider()
                DSListRow(
                    title: "18+ 实名认证",
                    subtitle: store.user.isVerified ? "已完成" : "待完成",
                    symbol: "person.badge.key"
                ) {
                    store.navigate(.verify)
                }
                .accessibilityIdentifier("profileVerifyRow")
            }

            menuGroup(title: "安全与信任") {
                DSListRow(
                    title: "安全中心",
                    subtitle: "\(scoreLevel) · \(store.user.safetyScore)/100",
                    symbol: "shield.checkered"
                ) {
                    store.navigate(.safetyCenter)
                }
                .accessibilityIdentifier("profileSafetyCenterRow")
            }

            menuGroup(title: "帮助与规范") {
                DSListRow(
                    title: "平台规范",
                    subtitle: "服务边界与沟通规则",
                    symbol: "doc.text"
                ) {
                    showingAgreement = true
                }
                .accessibilityIdentifier("profileAgreementRow")
            }

#if DEBUG
            menuGroup(title: "内容安全") {
                DSListRow(
                    title: "安全工作台",
                    subtitle: "\(store.moderationCases.count) 条待查看",
                    symbol: "shield.lefthalf.filled"
                ) {
                    store.navigate(.admin)
                }
                .accessibilityIdentifier("profileSafetyWorkspaceRow")
            }
#endif
        }
        .sheet(isPresented: $showingGenderSettings) {
            GenderSettingsSheet()
                .presentationDetents([.height(300)])
                .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $showingAgreement) {
            PlatformAgreementSheet()
        }
    }

    @ViewBuilder
    private func menuGroup<Content: View>(title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: DS.Space.sm) {
            SectionHeader(title: title)
            VStack(spacing: 0) {
                content()
            }
            .background(Color.dsSurface, in: RoundedRectangle(cornerRadius: DS.Radius.md, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: DS.Radius.md, style: .continuous)
                    .stroke(Color.dsBorder, lineWidth: 1)
            }
        }
    }

    private func menuDivider() -> some View {
        Divider().padding(.leading, 52)
    }
}

private struct PlatformAgreementSheet: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: DS.Space.lg) {
                    Text(PlatformAgreement.title)
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(Color.dsTextPrimary)

                    ForEach(Array(PlatformAgreement.sections.enumerated()), id: \.offset) { _, section in
                        VStack(alignment: .leading, spacing: DS.Space.xxs) {
                            Text(section.0)
                                .font(.system(size: 15, weight: .semibold))
                                .foregroundStyle(Color.dsTextPrimary)
                            Text(section.1)
                                .font(.system(size: 13))
                                .foregroundStyle(Color.dsTextSecondary)
                                .lineSpacing(3)
                        }
                    }
                }
                .padding(DS.Space.lg)
            }
            .background(Color.dsBackground)
            .navigationTitle("平台规范")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("完成") { dismiss() }
                        .accessibilityIdentifier("agreementDoneButton")
                }
            }
        }
    }
}

private struct GenderSettingsSheet: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: DS.Space.lg) {
                Text("身份设置")
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(Color.dsTextPrimary)
                Text("当前身份会影响社区浏览和发布规则。")
                    .font(.system(size: 13))
                    .foregroundStyle(Color.dsTextSecondary)
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: DS.Space.sm) {
                    genderButton(.female, symbol: "heart.text.square")
                    genderButton(.male, symbol: "checkmark.shield")
                }
                Spacer()
            }
            .padding(DS.Space.lg)
            .background(Color.dsBackground)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("完成") { dismiss() }
                        .accessibilityIdentifier("genderSettingsDoneButton")
                }
            }
        }
        .accessibilityIdentifier("genderSettingsSheet")
    }

    private func genderButton(_ gender: UserGender, symbol: String) -> some View {
        GenderChoiceButton(
            gender: gender,
            isSelected: store.user.gender == gender,
            symbol: symbol
        ) {
            store.setUserGender(gender)
        }
    }
}
