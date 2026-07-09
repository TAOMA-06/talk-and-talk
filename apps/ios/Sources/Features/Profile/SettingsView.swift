import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var store: AppStore
    @State private var showingLogoutConfirm = false
    @State private var deletionMessage: String?

    var body: some View {
        AppScaffold(title: "账号设置", spacing: DS.Space.lg) {
            menuGroup(title: "消息") {
                DSListRow(
                    title: "消息通知",
                    subtitle: store.notificationUnreadCount > 0
                        ? "\(store.notificationUnreadCount) 条未读"
                        : "支付、订单与安全提醒",
                    symbol: "bell"
                ) {
                    store.navigate(.notifications)
                }
                .accessibilityIdentifier("settingsNotificationsRow")
            }

            menuGroup(title: "法律与隐私") {
                DSListRow(
                    title: "用户协议",
                    subtitle: "服务边界与沟通规则",
                    symbol: "doc.text"
                ) {
                    store.navigate(.userAgreement)
                }
                .accessibilityIdentifier("settingsAgreementRow")
                menuDivider()
                DSListRow(
                    title: "隐私政策",
                    subtitle: "信息收集、使用与你的权利",
                    symbol: "hand.raised"
                ) {
                    store.navigate(.privacyPolicy)
                }
                .accessibilityIdentifier("settingsPrivacyRow")
            }

            menuGroup(title: "账号") {
                DSListRow(
                    title: "注销账号申请",
                    subtitle: "提交后将在 15 个工作日内处理",
                    symbol: "person.crop.circle.badge.minus"
                ) {
                    store.navigate(.accountDeletion)
                }
                .accessibilityIdentifier("settingsDeletionRow")
                menuDivider()
                DSListRow(
                    title: "退出登录",
                    subtitle: "清除本机登录状态与本地缓存",
                    symbol: "rectangle.portrait.and.arrow.right"
                ) {
                    showingLogoutConfirm = true
                }
                .accessibilityIdentifier("settingsLogoutRow")
            }

            if let deletionMessage {
                DSBanner(
                    title: "注销申请",
                    message: deletionMessage,
                    systemImage: "checkmark.circle",
                    tone: .success
                )
            }
        }
        .confirmationDialog("确认退出登录？", isPresented: $showingLogoutConfirm, titleVisibility: .visible) {
            Button("退出登录", role: .destructive) {
                Task { await store.logout() }
            }
            Button("取消", role: .cancel) {}
        } message: {
            Text("退出后需重新验证登录。本地登录凭证将被清除。")
        }
        .task {
            await store.loadNotifications()
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

struct LegalDocumentView: View {
    let title: String
    let sections: [(String, String)]
    var externalURL: URL? = nil

    var body: some View {
        AppScaffold(title: title, spacing: DS.Space.lg) {
            SoftCard {
                VStack(alignment: .leading, spacing: DS.Space.lg) {
                    Text(title)
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(Color.dsTextPrimary)
                    ForEach(Array(sections.enumerated()), id: \.offset) { _, section in
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
                    if let externalURL {
                        Link(destination: externalURL) {
                            Label("在浏览器打开完整页面", systemImage: "safari")
                                .font(.system(size: 14, weight: .medium))
                                .foregroundStyle(Color.dsPrimary)
                        }
                        .accessibilityIdentifier("legalExternalLink")
                    }
                }
            }
        }
    }
}

struct AccountDeletionView: View {
    @EnvironmentObject private var store: AppStore
    @State private var isSubmitting = false
    @State private var resultMessage: String?
    @State private var errorMessage: String?

    var body: some View {
        AppScaffold(title: "注销账号", spacing: DS.Space.lg) {
            SoftCard {
                VStack(alignment: .leading, spacing: DS.Space.md) {
                    Text("申请注销前请了解")
                        .font(.system(size: 15, weight: .semibold))
                    Text("提交后我们会在 15 个工作日内处理。处理完成前你仍可正常使用账号；订单与聊天记录将按合规要求保留或删除。")
                        .font(.system(size: 13))
                        .foregroundStyle(Color.dsTextSecondary)
                        .lineSpacing(3)
                }
            }

            if let resultMessage {
                DSBanner(
                    title: "申请已提交",
                    message: resultMessage,
                    systemImage: "checkmark.seal",
                    tone: .success
                )
            }
            if let errorMessage {
                DSBanner(
                    title: "提交失败",
                    message: errorMessage,
                    systemImage: "exclamationmark.triangle",
                    tone: .warning
                )
            }

            DSPrimaryButton(
                title: isSubmitting ? "提交中..." : "提交注销申请",
                systemImage: "paperplane",
                isEnabled: !isSubmitting && resultMessage == nil,
                isLoading: isSubmitting
            ) {
                submit()
            }
            .accessibilityIdentifier("submitDeletionButton")
        }
    }

    private func submit() {
        isSubmitting = true
        errorMessage = nil
        Task {
            do {
                let message = try await store.requestAccountDeletion()
                resultMessage = message
            } catch {
                errorMessage = (error as? BackendError)?.userFacingMessage ?? "网络异常，请稍后重试"
            }
            isSubmitting = false
        }
    }
}
