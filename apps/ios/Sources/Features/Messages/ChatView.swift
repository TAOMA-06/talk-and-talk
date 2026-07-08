import SwiftUI

struct ChatView: View {
    let target: ContactTarget
    @EnvironmentObject private var store: AppStore
    @State private var inputText = ""
    @State private var isCallActive = false
    @State private var seconds = 0
    @State private var showingReport = false
    @State private var showingTrialPaywall = false
    @State private var isSending = false

    private var companionId: String? {
        if case .companion(let id) = target { return id }
        return nil
    }

    private var companion: Companion? {
        guard let companionId else { return nil }
        return store.companion(by: companionId)
    }

    private var messages: [Message] { store.messages(for: target) }
    private var hasPaidChat: Bool {
        guard let companionId else { return false }
        return store.hasActivePaidChat(with: companionId)
    }
    private var remainingTrialMessages: Int {
        guard let companionId else { return 0 }
        return store.remainingTrialMessages(for: companionId)
    }
    private var canSendRecommendationCard: Bool {
        guard store.user.gender == .male, store.user.isVerified else { return false }
        if case .communityUser = target { return true }
        return false
    }
    private var usesBackendChat: Bool {
        guard let companionId else { return false }
        return BackendConfig.supportsChat(for: companionId)
    }
    private let timer = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    var body: some View {
        ZStack {
            Color.dsBackground.ignoresSafeArea()

            VStack(spacing: 0) {
                WeChatChatHeader(
                    companion: companion,
                    isCallActive: isCallActive,
                    seconds: seconds,
                    canStartCall: companion != nil,
                    openCompanion: {
                        if let companionId {
                            store.navigate(.companionDetail(companionId))
                        }
                    },
                    toggleCall: toggleCall,
                    onReport: { showingReport = true }
                )

                if let feedback = store.lastModerationFeedback {
                    ModerationFeedbackBar(text: feedback)
                }

                if !store.accountRestrictions.canSendMessages {
                    RestrictionBanner(text: store.accountRestrictions.summary)
                }

                if target.allowsPaidActions {
                    TrialChatStatusRow(
                        hasPaidChat: hasPaidChat,
                        remaining: remainingTrialMessages,
                        limit: store.freeTrialMessageLimit
                    )
                }

                if usesBackendChat, store.backendChatSyncingCompanionId == companionId {
                    ProgressView("同步会话…")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    WeChatMessageList(
                        messages: messages,
                        currentUser: store.user,
                        companion: companion,
                        otherInitials: target.communityInitials ?? "TA"
                    ) { companionId in
                        store.navigate(.companionDetail(companionId))
                    }
                }
            }

            if isCallActive, let companion {
                VoiceCallFloatingPanel(companion: companion, seconds: seconds) {
                    withAnimation(.easeOut(duration: DS.Motion.fast)) { isCallActive = false }
                }
                .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .navigationTitle(store.displayName(for: target))
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Color.dsBackground, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .toolbar(.hidden, for: .tabBar)
        .safeAreaInset(edge: .bottom) {
            WeChatComposerBar(
                text: $inputText,
                isSending: isSending,
                isDisabled: !store.accountRestrictions.canSendMessages,
                hasPaidChat: hasPaidChat,
                showsPaidControls: target.allowsPaidActions,
                canSendRecommendationCard: canSendRecommendationCard,
                send: sendMessage,
                finish: finish,
                continuePaid: { showingTrialPaywall = true },
                sendRecommendationCard: { store.sendRecommendationCard(to: target) }
            )
        }
        .alert("免费试聊已用完", isPresented: $showingTrialPaywall) {
            Button("确认订单后继续") {
                if let companionId {
                    store.navigate(.order(companionId))
                }
            }
            Button("稍后再说", role: .cancel) {}
        } message: {
            Text("试聊内容会保留，确认订单后可以回到当前聊天继续沟通。")
        }
        .onReceive(timer) { _ in
            if isCallActive { seconds += 1 }
        }
        .sheet(isPresented: $showingReport) {
            ReportSheetForChat(target: target)
                .presentationDetents([.medium])
        }
        .task {
            if let companionId, BackendConfig.supportsChat(for: companionId) {
                await store.syncBackendChat(for: companionId)
            }
        }
    }

    private func toggleCall() {
        guard let companionId else { return }
        if !isCallActive, !hasPaidChat {
            showingTrialPaywall = true
            return
        }
        withAnimation(.easeOut(duration: DS.Motion.fast)) {
            isCallActive.toggle()
            if isCallActive {
                store.startActiveOrder(with: companionId)
            }
        }
    }

    private func sendMessage() {
        guard !isSending else { return }
        let text = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }

        if let companionId {
            guard hasPaidChat || store.canSendTrialMessage(to: companionId) else {
                showingTrialPaywall = true
                return
            }
        }

        isSending = true
        Task {
            let decision: ModerationDecision
            if let companionId {
                if hasPaidChat {
                    decision = await store.sendMessage(text, to: companionId)
                } else {
                    decision = await store.sendTrialMessage(text, to: companionId)
                }
            } else {
                decision = await store.sendMessage(text, to: target)
            }
            if decision != .block {
                inputText = ""
            }
            isSending = false
        }
    }

    private func finish() {
        guard let companionId else { return }
        guard hasPaidChat else {
            showingTrialPaywall = true
            return
        }
        isCallActive = false
        store.completeActiveOrder(with: companionId)
        store.navigate(.review(companionId))
    }
}

private struct WeChatChatHeader: View {
    let companion: Companion?
    let isCallActive: Bool
    let seconds: Int
    let canStartCall: Bool
    let openCompanion: () -> Void
    let toggleCall: () -> Void
    let onReport: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: DS.Space.sm) {
                if let companion {
                    Button(action: openCompanion) {
                        HStack(spacing: DS.Space.sm) {
                            CompanionAvatar(companion: companion, size: 32)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(companion.name)
                                    .font(.system(size: 15, weight: .semibold))
                                    .foregroundStyle(Color.dsTextPrimary)
                                    .lineLimit(1)
                                Text(isCallActive ? "语音沟通中 \(format(seconds))" : "查看资料与服务边界")
                                    .font(.system(size: 11, weight: .medium))
                                    .foregroundStyle(Color.dsTextSecondary)
                                    .lineLimit(1)
                            }
                        }
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("进入\(companion.name)主页")
                } else {
                    Image(systemName: "lock.fill")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Color.dsPrimary)

                    Text(isCallActive ? "语音沟通中 \(format(seconds))" : "平台内安全沟通")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(Color.dsTextPrimary)
                        .lineLimit(1)
                }

                Spacer(minLength: DS.Space.sm)

                if canStartCall {
                    DSIconButton(
                        systemImage: isCallActive ? "phone.down.fill" : "phone.fill",
                        tone: isCallActive ? .danger : .neutral,
                        size: 34,
                        action: toggleCall
                    )
                    .accessibilityLabel(isCallActive ? "结束语音" : "开始语音")
                }

                DSIconButton(systemImage: "exclamationmark.bubble", size: 34, action: onReport)
                .accessibilityLabel("举报")
            }
            .padding(.horizontal, DS.Space.lg)
            .padding(.vertical, DS.Space.sm)

            Divider()
        }
        .background(Color.dsBackground)
    }

    private func format(_ seconds: Int) -> String {
        "\(seconds / 60):\(String(format: "%02d", seconds % 60))"
    }
}

private struct ModerationFeedbackBar: View {
    let text: String

    var body: some View {
        DSBanner(title: text, systemImage: "exclamationmark.triangle.fill", tone: .danger)
        .padding(.horizontal, DS.Space.lg)
        .padding(.vertical, DS.Space.xxs)
    }
}

private struct RestrictionBanner: View {
    let text: String

    var body: some View {
        DSBanner(title: text, systemImage: "lock.fill", tone: .warning)
            .padding(.horizontal, DS.Space.lg)
            .padding(.vertical, DS.Space.xxs)
    }
}

private struct TrialChatStatusRow: View {
    let hasPaidChat: Bool
    let remaining: Int
    let limit: Int

    var body: some View {
        HStack(spacing: DS.Space.sm) {
            Image(systemName: hasPaidChat ? "checkmark.seal.fill" : "gift.fill")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(hasPaidChat ? Color.dsSuccess : Color.dsPrimary)

            Text(hasPaidChat ? "已开通付费沟通 · 不受试聊限制" : "免费试聊剩余 \(remaining)/\(limit) 条")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Color.dsTextPrimary)

            Spacer()
        }
        .padding(.horizontal, DS.Space.lg)
        .padding(.vertical, DS.Space.sm)
        .background(Color.dsSurface)
        .overlay(alignment: .bottom) {
            Divider()
        }
    }
}

private struct WeChatMessageList: View {
    let messages: [Message]
    let currentUser: User
    let companion: Companion?
    let otherInitials: String
    let openCompanion: (String) -> Void
    @EnvironmentObject private var store: AppStore

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: DS.Space.md) {
                    ForEach(messages) { message in
                        if message.type == .system || message.type == .safety {
                            CenteredSystemMessage(message: message)
                        } else if message.type == .recommendationCard,
                                  let companionId = message.companionCardId,
                                  let cardCompanion = store.companion(by: companionId) {
                            RecommendationCardRow(
                                message: message,
                                isCurrentUser: message.senderId == currentUser.id,
                                currentUser: currentUser,
                                chatCompanion: companion,
                                otherInitials: otherInitials,
                                cardCompanion: cardCompanion,
                                open: { openCompanion(companionId) }
                            )
                        } else {
                            WeChatMessageBubble(
                                message: message,
                                isCurrentUser: message.senderId == currentUser.id,
                                currentUser: currentUser,
                                companion: companion,
                                otherInitials: otherInitials
                            )
                        }
                    }
                }
                .padding(.horizontal, DS.Space.lg)
                .padding(.vertical, DS.Space.lg)
            }
            .onChange(of: messages.count) { _, _ in
                if let last = messages.last {
                    withAnimation(.easeOut(duration: DS.Motion.fast)) {
                        proxy.scrollTo(last.id, anchor: .bottom)
                    }
                }
            }
        }
    }
}

private struct WeChatMessageBubble: View {
    let message: Message
    let isCurrentUser: Bool
    let currentUser: User
    let companion: Companion?
    let otherInitials: String

    var body: some View {
        HStack(alignment: .top, spacing: DS.Space.sm) {
            if isCurrentUser {
                Spacer(minLength: 56)
                bubble
                UserInitialsAvatar(initials: String(currentUser.name.prefix(1)), tone: .primary)
            } else {
                if let companion {
                    CompanionAvatar(companion: companion, size: 36)
                } else {
                    UserInitialsAvatar(initials: String(otherInitials.prefix(1)), tone: .neutral)
                }
                bubble
                Spacer(minLength: 56)
            }
        }
        .id(message.id)
    }

    private var bubble: some View {
        Text(message.content)
            .font(.system(size: 16))
            .foregroundStyle(isCurrentUser ? Color.white : Color.dsTextPrimary)
            .lineSpacing(3)
            .padding(.horizontal, DS.Space.md)
            .padding(.vertical, DS.Space.sm)
            .background(isCurrentUser ? Color.dsPrimary : Color.dsSurface, in: RoundedRectangle(cornerRadius: DS.Radius.sm, style: .continuous))
            .overlay {
                if !isCurrentUser {
                    RoundedRectangle(cornerRadius: DS.Radius.sm, style: .continuous)
                        .stroke(Color.dsBorder.opacity(0.55), lineWidth: DS.Stroke.hairline)
                }
            }
            .frame(maxWidth: 260, alignment: isCurrentUser ? .trailing : .leading)
    }
}

private struct RecommendationCardRow: View {
    let message: Message
    let isCurrentUser: Bool
    let currentUser: User
    let chatCompanion: Companion?
    let otherInitials: String
    let cardCompanion: Companion
    let open: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: DS.Space.sm) {
            if isCurrentUser {
                Spacer(minLength: 56)
                card
                UserInitialsAvatar(initials: String(currentUser.name.prefix(1)), tone: .primary)
            } else {
                if let chatCompanion {
                    CompanionAvatar(companion: chatCompanion, size: 36)
                } else {
                    UserInitialsAvatar(initials: String(otherInitials.prefix(1)), tone: .neutral)
                }
                card
                Spacer(minLength: 56)
            }
        }
        .id(message.id)
    }

    private var card: some View {
        Button(action: open) {
            VStack(alignment: .leading, spacing: DS.Space.sm) {
                HStack(spacing: DS.Space.sm) {
                    CompanionAvatar(companion: cardCompanion, size: 40)
                    VStack(alignment: .leading, spacing: DS.Space.xxs) {
                        Text("推荐卡片")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(Color.dsPrimary)
                        Text(cardCompanion.name)
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(Color.dsTextPrimary)
                            .lineLimit(1)
                    }
                    Spacer()
                }

                Text(cardCompanion.role)
                    .font(.system(size: 12))
                    .foregroundStyle(Color.dsTextSecondary)
                    .lineLimit(1)

                HStack(spacing: DS.Space.sm) {
                    Label("¥\(cardCompanion.pricePerHalfHour)/30m", systemImage: "creditcard")
                    Spacer()
                    Label("查看详情", systemImage: "chevron.right")
                }
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Color.dsTextPrimary)
            }
            .padding(DS.Space.md)
            .frame(maxWidth: 260, alignment: .leading)
            .background(Color.dsSurfaceElevated, in: RoundedRectangle(cornerRadius: DS.Radius.md, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: DS.Radius.md, style: .continuous)
                    .stroke(Color.dsBorder.opacity(0.72), lineWidth: DS.Stroke.hairline)
            }
        }
        .buttonStyle(DSPressButtonStyle())
        .accessibilityLabel("推荐卡片 \(cardCompanion.name)")
        .accessibilityIdentifier("recommendationCard-\(cardCompanion.id)")
    }
}

private struct CenteredSystemMessage: View {
    let message: Message

    var body: some View {
        Text(message.content)
            .font(.system(size: 12, weight: .medium))
            .foregroundStyle(Color.dsTextSecondary)
            .multilineTextAlignment(.center)
            .lineLimit(3)
            .padding(.horizontal, DS.Space.md)
            .padding(.vertical, DS.Space.xxs)
            .background(Color.dsTextSecondary.opacity(0.10), in: Capsule())
            .frame(maxWidth: .infinity)
            .id(message.id)
    }
}

private struct UserInitialsAvatar: View {
    let initials: String
    var tone: DSBadge.Tone

    var body: some View {
        DSInitialsAvatar(initials: initials, tone: tone, size: 36)
    }
}

private struct WeChatComposerBar: View {
    @Binding var text: String
    var isSending: Bool
    var isDisabled: Bool
    var hasPaidChat: Bool
    var showsPaidControls: Bool
    var canSendRecommendationCard: Bool
    let send: () -> Void
    let finish: () -> Void
    let continuePaid: () -> Void
    let sendRecommendationCard: () -> Void

    private var trimmedText: String {
        text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var body: some View {
        VStack(spacing: DS.Space.sm) {
            HStack(spacing: DS.Space.sm) {
                Menu {
                    if canSendRecommendationCard {
                        Button(action: sendRecommendationCard) {
                            Label("发送推荐卡片", systemImage: "person.crop.rectangle.stack")
                        }
                    } else {
                        Button("暂无可用操作") {}
                            .disabled(true)
                    }
                } label: {
                    Image(systemName: "plus.circle")
                        .font(.system(size: 24, weight: .regular))
                        .foregroundStyle(Color.dsTextSecondary)
                }
                .accessibilityLabel("更多")

                DSInputField(placeholder: "输入消息", text: $text)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled(false)
                    .submitLabel(.send)
                    .onSubmit(send)
                    .accessibilityIdentifier("messageInput")
                    .disabled(isDisabled || isSending)

                DSButton(
                    title: "发送",
                    isEnabled: !trimmedText.isEmpty && !isDisabled,
                    isLoading: isSending,
                    maxWidth: 56,
                    height: 42,
                    action: send
                )
                .disabled(trimmedText.isEmpty || isDisabled || isSending)
                .accessibilityLabel("发送")
            }

            if showsPaidControls {
                DSButton(
                    title: hasPaidChat ? "完成沟通并评价" : "确认订单后继续",
                    systemImage: hasPaidChat ? "checkmark.circle" : "lock.open",
                    variant: .secondary,
                    height: 38,
                    action: hasPaidChat ? finish : continuePaid
                )
                .accessibilityIdentifier("finishChatButton")
            }
        }
        .padding(.horizontal, DS.Space.lg)
        .padding(.top, DS.Space.sm)
        .padding(.bottom, DS.Space.sm)
        .background(Color.dsBackground)
        .overlay(alignment: .top) { Color.dsSeparator.frame(height: DS.Stroke.hairline) }
    }
}

private struct VoiceCallFloatingPanel: View {
    let companion: Companion
    let seconds: Int
    let end: () -> Void

    var body: some View {
        VStack {
            SoftCard {
                HStack(spacing: DS.Space.md) {
                    CompanionAvatar(companion: companion, size: 48)
                    VStack(alignment: .leading, spacing: DS.Space.xxs) {
                        Text("语音沟通中")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(Color.dsTextPrimary)
                        Text("\(seconds / 60):\(String(format: "%02d", seconds % 60))")
                            .font(.system(size: 11))
                            .foregroundStyle(Color.dsTextSecondary)
                    }
                    Spacer()
                    Button(action: end) {
                        Image(systemName: "phone.down.fill")
                            .foregroundStyle(.white)
                            .frame(width: 44, height: 44)
                            .background(Color.dsDanger, in: Circle())
                    }
                    .accessibilityLabel("结束通话")
                }
            }
            .padding(.horizontal, DS.Space.lg)
            .padding(.top, 88)
            Spacer()
        }
    }
}

private struct ReportSheetForChat: View {
    let target: ContactTarget
    @EnvironmentObject private var store: AppStore
    @Environment(\.dismiss) private var dismiss
    @State private var reason = "聊天内容不适"

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: DS.Space.lg) {
                Text("我们会尽快处理你的举报。")
                    .font(.system(size: 15))
                    .foregroundStyle(Color.dsTextSecondary)
                Picker("举报原因", selection: $reason) {
                    Text("聊天内容不适").tag("聊天内容不适")
                    Text("诱导私下联系").tag("诱导私下联系")
                    Text("服务边界不清").tag("服务边界不清")
                }
                .pickerStyle(.inline)
                DSPrimaryButton(title: "提交", systemImage: "paperplane") {
                    store.report(target: target, reason: reason)
                    dismiss()
                }
                Spacer()
            }
            .padding(DS.Space.lg)
            .background(Color.dsBackground)
            .navigationTitle("举报")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}
