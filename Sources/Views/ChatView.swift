import SwiftUI

struct ChatView: View {
    let companionId: String
    @EnvironmentObject private var store: AppStore
    @State private var inputText = ""
    @State private var isCallActive = false
    @State private var seconds = 0
    @State private var showingReport = false
    @State private var isSending = false

    private var companion: Companion? { store.companion(by: companionId) }
    private var messages: [Message] { store.messages(for: companionId) }
    private let timer = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    var body: some View {
        ZStack {
            AppBackground()
            VStack(spacing: 0) {
                ChatSafetyHeader(companion: companion, isCallActive: isCallActive, seconds: seconds) {
                    withAnimation(.easeOut(duration: DS.Motion.fast)) {
                        isCallActive.toggle()
                        if isCallActive {
                            store.startActiveOrder(with: companionId)
                        }
                    }
                } onReport: {
                    showingReport = true
                }
                if let feedback = store.lastModerationFeedback {
                    ModerationFeedbackBar(text: feedback)
                }
                if !store.accountRestrictions.canSendMessages {
                    RestrictionBanner(text: store.accountRestrictions.summary)
                }
                MessageList(messages: messages, currentUserId: store.user.id)
            }
            if isCallActive, let companion {
                VoiceCallFloatingPanel(companion: companion, seconds: seconds) {
                    withAnimation(.easeOut(duration: DS.Motion.fast)) { isCallActive = false }
                }
                .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .navigationTitle(companion?.name ?? "沟通")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Color.dsBackground, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .toolbar(.hidden, for: .tabBar)
        .safeAreaInset(edge: .bottom) {
            ComposerBar(
                text: $inputText,
                isSending: isSending,
                isDisabled: !store.accountRestrictions.canSendMessages,
                send: sendMessage,
                finish: finish
            )
        }
        .onReceive(timer) { _ in
            if isCallActive { seconds += 1 }
        }
        .sheet(isPresented: $showingReport) {
            ReportSheetForChat(companionId: companionId)
                .presentationDetents([.medium])
        }
    }

    private func sendMessage() {
        guard !isSending else { return }
        isSending = true
        let text = inputText
        inputText = ""
        Task {
            _ = await store.sendMessage(text, to: companionId)
            isSending = false
        }
    }

    private func finish() {
        isCallActive = false
        store.completeActiveOrder(with: companionId)
        store.navigate(.review(companionId))
    }
}

private struct ModerationFeedbackBar: View {
    let text: String

    var body: some View {
        HStack(spacing: DS.Space.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(Color.dsDanger)
            Text(text)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Color.dsDanger)
            Spacer()
        }
        .padding(.horizontal, DS.Space.lg)
        .padding(.vertical, DS.Space.sm)
        .background(Color.dsDanger.opacity(0.08))
    }
}

private struct RestrictionBanner: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.system(size: 11))
            .foregroundStyle(Color.dsTextSecondary)
            .padding(.horizontal, DS.Space.lg)
            .padding(.bottom, DS.Space.sm)
    }
}

private struct ChatSafetyHeader: View {
    let companion: Companion?
    let isCallActive: Bool
    let seconds: Int
    let toggleCall: () -> Void
    let onReport: () -> Void

    var body: some View {
        SoftCard(padding: DS.Space.md) {
            VStack(spacing: DS.Space.md) {
                HStack(spacing: DS.Space.md) {
                    if let companion {
                        CompanionAvatar(companion: companion, size: 44)
                        VStack(alignment: .leading, spacing: DS.Space.xxs) {
                            Text(companion.name)
                                .font(.system(size: 15, weight: .semibold))
                                .foregroundStyle(Color.dsTextPrimary)
                            Text(isCallActive ? "语音沟通中 \(format(seconds))" : "平台内安全沟通")
                                .font(.system(size: 11))
                                .foregroundStyle(Color.dsTextSecondary)
                        }
                    }
                    Spacer()
                    iconButton(
                        systemName: isCallActive ? "phone.down.fill" : "phone.fill",
                        isActive: isCallActive,
                        action: toggleCall
                    )
                    .accessibilityLabel(isCallActive ? "结束语音" : "开始语音")
                    iconButton(systemName: "exclamationmark.bubble", isActive: false, action: onReport)
                        .accessibilityLabel("举报")
                }
                HStack(spacing: DS.Space.sm) {
                    StatusPill(text: "AI+规则审查", symbol: "checklist.checked", color: Color.dsPrimary)
                    StatusPill(text: "禁止私下交易", symbol: "lock.fill", color: Color.dsDanger)
                    Spacer()
                }
            }
        }
        .padding(.horizontal, DS.Space.md)
        .padding(.top, DS.Space.sm)
    }

    private func iconButton(systemName: String, isActive: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 15, weight: .medium))
                .frame(width: 40, height: 40)
                .foregroundStyle(isActive ? .white : Color.dsTextPrimary)
                .background(
                    isActive ? Color.dsDanger : Color.dsBackground,
                    in: RoundedRectangle(cornerRadius: DS.Radius.sm, style: .continuous)
                )
                .overlay {
                    if !isActive {
                        RoundedRectangle(cornerRadius: DS.Radius.sm, style: .continuous)
                            .stroke(Color.dsBorder, lineWidth: 1)
                    }
                }
        }
        .buttonStyle(.plain)
    }

    private func format(_ seconds: Int) -> String {
        "\(seconds / 60):\(String(format: "%02d", seconds % 60))"
    }
}

private struct MessageList: View {
    let messages: [Message]
    let currentUserId: String

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: DS.Space.md) {
                    ForEach(messages) { message in
                        MessageBubble(message: message, isCurrentUser: message.senderId == currentUserId)
                            .id(message.id)
                    }
                }
                .padding(DS.Space.lg)
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

private struct MessageBubble: View {
    let message: Message
    let isCurrentUser: Bool

    var body: some View {
        HStack {
            if isCurrentUser { Spacer(minLength: 48) }
            VStack(alignment: isCurrentUser ? .trailing : .leading, spacing: DS.Space.xxs) {
                Text(message.content)
                    .font(.system(size: 15))
                    .foregroundStyle(foreground)
                    .padding(.horizontal, DS.Space.md)
                    .padding(.vertical, DS.Space.sm)
                    .background(background, in: RoundedRectangle(cornerRadius: DS.Radius.md, style: .continuous))
                Text(message.timestamp, style: .time)
                    .font(.system(size: 11))
                    .foregroundStyle(Color.dsTextSecondary)
                    .padding(.horizontal, DS.Space.xxs)
            }
            if !isCurrentUser { Spacer(minLength: 48) }
        }
    }

    private var background: Color {
        switch message.type {
        case .system: Color.dsPrimary.opacity(0.12)
        case .safety: Color.dsDanger.opacity(0.12)
        case .text: isCurrentUser ? Color.dsPrimary : Color.dsSurface
        }
    }

    private var foreground: Color {
        switch message.type {
        case .text where isCurrentUser: .white
        default: Color.dsTextPrimary
        }
    }
}

private struct ComposerBar: View {
    @Binding var text: String
    var isSending: Bool
    var isDisabled: Bool
    let send: () -> Void
    let finish: () -> Void

    var body: some View {
        ActionDock {
            VStack(spacing: DS.Space.sm) {
                HStack(spacing: DS.Space.sm) {
                    TextField("输入消息，试试“加微信”触发风控", text: $text, axis: .vertical)
                        .lineLimit(1...3)
                        .font(.system(size: 15))
                        .padding(.horizontal, DS.Space.md)
                        .padding(.vertical, DS.Space.sm)
                        .background(Color.dsBackground, in: RoundedRectangle(cornerRadius: DS.Radius.sm, style: .continuous))
                        .overlay {
                            RoundedRectangle(cornerRadius: DS.Radius.sm, style: .continuous)
                                .stroke(Color.dsBorder, lineWidth: 1)
                        }
                        .accessibilityIdentifier("messageInput")
                        .disabled(isDisabled || isSending)
                    Button(action: send) {
                        Group {
                            if isSending {
                                ProgressView()
                            } else {
                                Image(systemName: "paperplane.fill")
                            }
                        }
                        .frame(width: 40, height: 40)
                        .foregroundStyle(.white)
                        .background(Color.dsPrimary, in: RoundedRectangle(cornerRadius: DS.Radius.sm, style: .continuous))
                    }
                    .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isDisabled || isSending)
                    .accessibilityLabel("发送")
                }
                DSPrimaryButton(title: "结束沟通并评价", systemImage: "checkmark.circle", action: finish)
                    .accessibilityIdentifier("finishChatButton")
            }
        }
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
                        Text("\(seconds / 60):\(String(format: "%02d", seconds % 60)) · 模拟 RTC")
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
    let companionId: String
    @EnvironmentObject private var store: AppStore
    @Environment(\.dismiss) private var dismiss
    @State private var reason = "聊天内容不适"

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: DS.Space.lg) {
                Text("举报后会进入 AI 分拣和人工复核队列。")
                    .font(.system(size: 15))
                    .foregroundStyle(Color.dsTextSecondary)
                Picker("举报原因", selection: $reason) {
                    Text("聊天内容不适").tag("聊天内容不适")
                    Text("诱导私下联系").tag("诱导私下联系")
                    Text("服务边界不清").tag("服务边界不清")
                }
                .pickerStyle(.inline)
                DSPrimaryButton(title: "提交", systemImage: "paperplane") {
                    store.report(companionId: companionId, reason: reason)
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
