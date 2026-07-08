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

    private var isSyncingBackendChat: Bool {
        usesBackendChat && store.backendChatSyncingCompanionId == companionId
    }

    private var disabledReason: String? {
        store.accountRestrictions.canSendMessages ? nil : store.accountRestrictions.summary
    }

    private let timer = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    var body: some View {
        ZStack {
            Color.dsBackground.ignoresSafeArea()

            VStack(spacing: 0) {
                SecureChatHeader(
                    displayName: store.displayName(for: target),
                    companion: companion,
                    isCallActive: isCallActive,
                    seconds: seconds,
                    canStartCall: companion != nil,
                    usesBackendChat: usesBackendChat,
                    isSyncing: isSyncingBackendChat,
                    isBackendConnected: store.isBackendConnected,
                    backendModel: store.backendModerationModel,
                    openCompanion: {
                        if let companionId {
                            store.navigate(.companionDetail(companionId))
                        }
                    },
                    toggleCall: toggleCall,
                    onReport: { showingReport = true }
                )

                if let feedback = store.lastModerationFeedback {
                    ModerationFeedbackPanel(text: feedback)
                }

                if let disabledReason {
                    RestrictionBanner(text: disabledReason)
                }

                if target.allowsPaidActions {
                    TrialChatStatusRow(
                        hasPaidChat: hasPaidChat,
                        remaining: remainingTrialMessages,
                        limit: store.freeTrialMessageLimit,
                        priceText: companion.map { "¥\($0.pricePerHalfHour)/30m" },
                        continuePaid: { showingTrialPaywall = true }
                    )
                }

                if isSyncingBackendChat {
                    ChatSyncPlaceholder()
                } else {
                    SecureMessageList(
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
        .toolbarBackground(Color.dsBackground.opacity(0.96), for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .toolbar(.hidden, for: .tabBar)
        .safeAreaInset(edge: .bottom) {
            SecureComposerBar(
                text: $inputText,
                isSending: isSending,
                disabledReason: disabledReason,
                hasPaidChat: hasPaidChat,
                showsPaidControls: target.allowsPaidActions,
                canSendRecommendationCard: canSendRecommendationCard,
                send: sendMessage,
                finish: finish,
                continuePaid: { showingTrialPaywall = true },
                sendRecommendationCard: { store.sendRecommendationCard(to: target) }
            )
        }
        .alert("试聊额度已用完", isPresented: $showingTrialPaywall) {
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

private struct SecureChatHeader: View {
    let displayName: String
    let companion: Companion?
    let isCallActive: Bool
    let seconds: Int
    let canStartCall: Bool
    let usesBackendChat: Bool
    let isSyncing: Bool
    let isBackendConnected: Bool
    let backendModel: String
    let openCompanion: () -> Void
    let toggleCall: () -> Void
    let onReport: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: DS.Space.md) {
                HStack(alignment: .top, spacing: DS.Space.md) {
                    identityBlock

                    Spacer(minLength: DS.Space.sm)

                    HStack(spacing: DS.Space.xxs) {
                        if companion != nil {
                            DSButton(title: "资料", systemImage: "person.crop.square", variant: .secondary, maxWidth: 72, height: 34, action: openCompanion)
                                .accessibilityLabel("查看资料")
                        }

                        if canStartCall {
                            DSIconButton(
                                systemImage: isCallActive ? "phone.down.fill" : "phone.fill",
                                tone: isCallActive ? .danger : .neutral,
                                size: 34,
                                action: toggleCall
                            )
                            .accessibilityLabel(isCallActive ? "结束语音" : "开始语音")
                        }

                        DSIconButton(systemImage: "exclamationmark.bubble", tone: .warning, size: 34, action: onReport)
                            .accessibilityLabel("举报")
                    }
                }

                HStack(spacing: DS.Space.sm) {
                    HeaderStatusChip(text: primaryStatusText, systemImage: primaryStatusIcon, tone: primaryStatusTone)
                    HeaderStatusChip(text: "平台内沟通", systemImage: "lock.shield", tone: .primary)
                    HeaderStatusChip(text: backendStatusText, systemImage: backendStatusIcon, tone: backendStatusTone)
                }
            }
            .padding(.horizontal, DS.Space.lg)
            .padding(.vertical, DS.Space.md)

            Divider()
        }
        .background(Color.dsSurfaceElevated.opacity(0.96))
    }

    @ViewBuilder
    private var identityBlock: some View {
        if let companion {
            Button(action: openCompanion) {
                HStack(alignment: .top, spacing: DS.Space.sm) {
                    CompanionAvatar(companion: companion, size: 42)
                    VStack(alignment: .leading, spacing: DS.Space.xxs) {
                        HStack(spacing: DS.Space.sm) {
                            Text(companion.name)
                                .font(.system(size: 17, weight: .semibold))
                                .foregroundStyle(Color.dsTextPrimary)
                                .lineLimit(1)
                            if companion.isVerified {
                                Image(systemName: "checkmark.seal.fill")
                                    .font(.system(size: 12, weight: .semibold))
                                    .foregroundStyle(Color.dsPrimary)
                            }
                        }
                        Text(isCallActive ? "语音沟通中 \(format(seconds))" : "\(companion.role) · \(companion.responseTime)")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(Color.dsTextSecondary)
                            .lineLimit(1)
                    }
                }
            }
            .buttonStyle(.plain)
            .accessibilityLabel("进入\(companion.name)资料")
        } else {
            HStack(alignment: .top, spacing: DS.Space.sm) {
                DSInitialsAvatar(initials: "TA", tone: .neutral, size: 42)
                VStack(alignment: .leading, spacing: DS.Space.xxs) {
                    Text(displayName)
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(Color.dsTextPrimary)
                        .lineLimit(1)
                    Text("广场会话 · 平台内安全沟通")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(Color.dsTextSecondary)
                        .lineLimit(1)
                }
            }
        }
    }

    private var primaryStatusText: String {
        if isCallActive { return "语音 \(format(seconds))" }
        guard let companion else { return "可举报" }
        return companion.availability.displayName
    }

    private var primaryStatusIcon: String {
        isCallActive ? "waveform" : "circle.fill"
    }

    private var primaryStatusTone: DSBadge.Tone {
        if isCallActive { return .success }
        if companion == nil { return .neutral }
        return .success
    }

    private var backendStatusText: String {
        guard usesBackendChat else { return "本地会话" }
        if isSyncing { return "同步中" }
        if isBackendConnected {
            return backendModel.isEmpty ? "后端已连接" : backendModel
        }
        return "后端待连接"
    }

    private var backendStatusIcon: String {
        isSyncing ? "arrow.triangle.2.circlepath" : "server.rack"
    }

    private var backendStatusTone: DSBadge.Tone {
        guard usesBackendChat else { return .neutral }
        if isSyncing { return .primary }
        return isBackendConnected ? .success : .warning
    }

    private func format(_ seconds: Int) -> String {
        "\(seconds / 60):\(String(format: "%02d", seconds % 60))"
    }
}

private struct HeaderStatusChip: View {
    let text: String
    let systemImage: String
    let tone: DSBadge.Tone

    var body: some View {
        Label(text, systemImage: systemImage)
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(foreground)
            .lineLimit(1)
            .minimumScaleFactor(0.78)
            .padding(.horizontal, DS.Space.sm)
            .padding(.vertical, DS.Space.xxs)
            .background(foreground.opacity(0.10), in: Capsule())
            .overlay(Capsule().stroke(foreground.opacity(0.14), lineWidth: DS.Stroke.hairline))
    }

    private var foreground: Color {
        switch tone {
        case .neutral: Color.dsTextSecondary
        case .primary: Color.dsPrimary
        case .success: Color.dsSuccess
        case .warning: Color.dsWarning
        case .danger: Color.dsDanger
        }
    }
}

private struct ModerationFeedbackPanel: View {
    let text: String

    var body: some View {
        DSBanner(title: title, message: text, systemImage: systemImage, tone: tone)
            .padding(.horizontal, DS.Space.lg)
            .padding(.vertical, DS.Space.xxs)
    }

    private var title: String {
        if text.contains("举报") { return "举报已提交" }
        if text.contains("未发送") || text.contains("违规") { return "消息未发送" }
        if text.contains("提醒") || text.contains("协议") { return "沟通提醒" }
        if text.contains("失败") || text.contains("不可用") { return "服务状态提醒" }
        return "沟通状态"
    }

    private var systemImage: String {
        switch tone {
        case .success: "checkmark.circle.fill"
        case .warning: "exclamationmark.triangle.fill"
        case .danger: "xmark.octagon.fill"
        default: "info.circle.fill"
        }
    }

    private var tone: DSBadge.Tone {
        if text.contains("举报") || text.contains("已提交") { return .success }
        if text.contains("未发送") || text.contains("违规") { return .danger }
        if text.contains("失败") || text.contains("不可用") || text.contains("提醒") { return .warning }
        return .primary
    }
}

private struct RestrictionBanner: View {
    let text: String

    var body: some View {
        DSBanner(title: "当前账号暂不能发送消息", message: text, systemImage: "lock.fill", tone: .warning)
            .padding(.horizontal, DS.Space.lg)
            .padding(.vertical, DS.Space.xxs)
    }
}

private struct TrialChatStatusRow: View {
    let hasPaidChat: Bool
    let remaining: Int
    let limit: Int
    let priceText: String?
    let continuePaid: () -> Void

    var body: some View {
        HStack(spacing: DS.Space.md) {
            Image(systemName: hasPaidChat ? "checkmark.seal.fill" : "gift.fill")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(hasPaidChat ? Color.dsSuccess : Color.dsPrimary)
                .frame(width: 30, height: 30)
                .background((hasPaidChat ? Color.dsSuccess : Color.dsPrimary).opacity(0.10), in: RoundedRectangle(cornerRadius: DS.Radius.sm, style: .continuous))

            VStack(alignment: .leading, spacing: DS.Space.xxs) {
                Text(hasPaidChat ? "已开通付费沟通" : "试聊额度")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.dsTextPrimary)
                Text(hasPaidChat ? "可继续文字与语音沟通" : "剩余 \(remaining)/\(limit) 条，确认合适后可预约\(priceSuffix)")
                    .font(.system(size: 11))
                    .foregroundStyle(Color.dsTextSecondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.78)
            }

            Spacer(minLength: DS.Space.sm)

            if !hasPaidChat {
                DSButton(title: "确认订单", systemImage: "calendar.badge.plus", variant: .secondary, maxWidth: 96, height: 34, action: continuePaid)
            }
        }
        .padding(.horizontal, DS.Space.lg)
        .padding(.vertical, DS.Space.sm)
        .background(Color.dsSurface)
        .overlay(alignment: .bottom) {
            Divider()
        }
    }

    private var priceSuffix: String {
        guard let priceText else { return "" }
        return " · \(priceText)"
    }
}

private struct ChatSyncPlaceholder: View {
    var body: some View {
        VStack(spacing: DS.Space.md) {
            ProgressView()
                .tint(Color.dsPrimary)
            Text("正在同步平台内会话")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Color.dsTextPrimary)
            Text("稍等片刻，最新消息和安全提醒会一起加载。")
                .font(.system(size: 13))
                .foregroundStyle(Color.dsTextSecondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

private struct SecureMessageList: View {
    let messages: [Message]
    let currentUser: User
    let companion: Companion?
    let otherInitials: String
    let openCompanion: (String) -> Void
    @EnvironmentObject private var store: AppStore

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                if messages.isEmpty {
                    EmptyStateView(
                        symbol: "lock.shield",
                        title: "会话已建立",
                        subtitle: "发送第一条消息后，这里会保留平台内沟通记录。"
                    )
                    .padding(.horizontal, DS.Space.lg)
                    .padding(.top, DS.Space.xl)
                } else {
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
                                SecureMessageBubble(
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

private struct SecureMessageBubble: View {
    let message: Message
    let isCurrentUser: Bool
    let currentUser: User
    let companion: Companion?
    let otherInitials: String

    var body: some View {
        HStack(alignment: .top, spacing: DS.Space.sm) {
            if isCurrentUser {
                Spacer(minLength: 52)
                bubble
                UserInitialsAvatar(initials: String(currentUser.name.prefix(1)), tone: .primary)
            } else {
                if let companion {
                    CompanionAvatar(companion: companion, size: 36)
                } else {
                    UserInitialsAvatar(initials: String(otherInitials.prefix(1)), tone: .neutral)
                }
                bubble
                Spacer(minLength: 52)
            }
        }
        .id(message.id)
    }

    private var bubble: some View {
        VStack(alignment: isCurrentUser ? .trailing : .leading, spacing: DS.Space.xxs) {
            Text(message.content)
                .font(.system(size: 16))
                .foregroundStyle(isCurrentUser ? Color.white : Color.dsTextPrimary)
                .lineSpacing(3)
            Text(message.timestamp, style: .time)
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(isCurrentUser ? Color.white.opacity(0.78) : Color.dsTextSecondary)
        }
        .padding(.horizontal, DS.Space.md)
        .padding(.vertical, DS.Space.sm)
        .background(isCurrentUser ? Color.dsPrimary : Color.dsSurface, in: RoundedRectangle(cornerRadius: DS.Radius.md, style: .continuous))
        .overlay {
            if !isCurrentUser {
                RoundedRectangle(cornerRadius: DS.Radius.md, style: .continuous)
                    .stroke(Color.dsBorder.opacity(0.55), lineWidth: DS.Stroke.hairline)
            }
        }
        .frame(maxWidth: 270, alignment: isCurrentUser ? .trailing : .leading)
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
                Spacer(minLength: 52)
                card
                UserInitialsAvatar(initials: String(currentUser.name.prefix(1)), tone: .primary)
            } else {
                if let chatCompanion {
                    CompanionAvatar(companion: chatCompanion, size: 36)
                } else {
                    UserInitialsAvatar(initials: String(otherInitials.prefix(1)), tone: .neutral)
                }
                card
                Spacer(minLength: 52)
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
            .frame(maxWidth: 270, alignment: .leading)
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
        HStack(spacing: DS.Space.xxs) {
            Image(systemName: message.type == .safety ? "lock.shield" : "info.circle")
                .font(.system(size: 11, weight: .semibold))
            Text(message.content)
                .font(.system(size: 12, weight: .medium))
                .lineLimit(3)
        }
        .foregroundStyle(message.type == .safety ? Color.dsWarning : Color.dsTextSecondary)
        .multilineTextAlignment(.center)
        .padding(.horizontal, DS.Space.md)
        .padding(.vertical, DS.Space.xxs)
        .background((message.type == .safety ? Color.dsWarning : Color.dsTextSecondary).opacity(0.10), in: Capsule())
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

private struct SecureComposerBar: View {
    @Binding var text: String
    var isSending: Bool
    var disabledReason: String?
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

    private var isDisabled: Bool {
        disabledReason != nil
    }

    var body: some View {
        VStack(spacing: DS.Space.sm) {
            if let disabledReason {
                DSBanner(title: "当前无法发送", message: disabledReason, systemImage: "lock.fill", tone: .warning)
            }

            HStack(alignment: .bottom, spacing: DS.Space.sm) {
                Menu {
                    if canSendRecommendationCard {
                        Button(action: sendRecommendationCard) {
                            Label("发送推荐卡片", systemImage: "person.crop.rectangle.stack")
                        }
                    }
                    Button("沟通和付款请留在平台内") {}
                        .disabled(true)
                } label: {
                    Image(systemName: "plus.circle.fill")
                        .font(.system(size: 24, weight: .regular))
                        .foregroundStyle(Color.dsPrimary)
                        .frame(width: 40, height: 42)
                }
                .accessibilityLabel("更多沟通操作")

                TextField("在平台内输入消息", text: $text, axis: .vertical)
                    .font(.system(size: 15))
                    .lineLimit(1...4)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled(false)
                    .submitLabel(.send)
                    .onSubmit(send)
                    .padding(.horizontal, DS.Space.md)
                    .padding(.vertical, DS.Space.sm)
                    .frame(minHeight: 42)
                    .background(Color.dsSurfaceElevated, in: RoundedRectangle(cornerRadius: DS.Radius.md, style: .continuous))
                    .overlay {
                        RoundedRectangle(cornerRadius: DS.Radius.md, style: .continuous)
                            .stroke(Color.dsBorder.opacity(0.72), lineWidth: DS.Stroke.hairline)
                    }
                    .accessibilityIdentifier("messageInput")
                    .disabled(isDisabled || isSending)

                Button(action: send) {
                    Image(systemName: isSending ? "clock" : "paperplane.fill")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(.white)
                        .frame(width: 42, height: 42)
                        .background(sendButtonColor, in: RoundedRectangle(cornerRadius: DS.Radius.md, style: .continuous))
                }
                .disabled(trimmedText.isEmpty || isDisabled || isSending)
                .buttonStyle(DSPressButtonStyle())
                .accessibilityLabel("发送")
            }

            if showsPaidControls {
                DSButton(
                    title: hasPaidChat ? "完成沟通并评价" : "确认订单后继续",
                    systemImage: hasPaidChat ? "checkmark.circle" : "calendar.badge.plus",
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

    private var sendButtonColor: Color {
        trimmedText.isEmpty || isDisabled ? Color.dsTextSecondary.opacity(0.45) : Color.dsPrimary
    }
}

private struct VoiceCallFloatingPanel: View {
    let companion: Companion
    let seconds: Int
    let end: () -> Void

    var body: some View {
        VStack {
            SoftCard {
                VStack(alignment: .leading, spacing: DS.Space.md) {
                    HStack(spacing: DS.Space.md) {
                        CompanionAvatar(companion: companion, size: 50)

                        VStack(alignment: .leading, spacing: DS.Space.xxs) {
                            Text("平台内语音沟通中")
                                .font(.system(size: 16, weight: .semibold))
                                .foregroundStyle(Color.dsTextPrimary)
                            Text("\(companion.name) · \(format(seconds))")
                                .font(.system(size: 12, weight: .medium))
                                .foregroundStyle(Color.dsTextSecondary)
                        }

                        Spacer()

                        Button(action: end) {
                            Image(systemName: "phone.down.fill")
                                .foregroundStyle(.white)
                                .frame(width: 44, height: 44)
                                .background(Color.dsDanger, in: Circle())
                        }
                        .buttonStyle(DSPressButtonStyle())
                        .accessibilityLabel("结束通话")
                    }

                    Text("语音仅用于当前订单沟通，请勿交换私人联系方式或转账信息。")
                        .font(.system(size: 12))
                        .foregroundStyle(Color.dsTextSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(.horizontal, DS.Space.lg)
            .padding(.top, 88)
            Spacer()
        }
    }

    private func format(_ seconds: Int) -> String {
        "\(seconds / 60):\(String(format: "%02d", seconds % 60))"
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
                DSBanner(
                    title: "提交后会尽快查看",
                    message: "你也可以先结束沟通，把感受照顾好。举报只会用于平台内安全处理。",
                    systemImage: "exclamationmark.bubble",
                    tone: .warning
                )

                Picker("举报原因", selection: $reason) {
                    Text("聊天内容不适").tag("聊天内容不适")
                    Text("诱导私下联系").tag("诱导私下联系")
                    Text("服务边界不清").tag("服务边界不清")
                }
                .pickerStyle(.inline)

                DSPrimaryButton(title: "提交举报", systemImage: "paperplane") {
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
