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
                    withAnimation(.snappy) {
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
                    withAnimation(.snappy) { isCallActive = false }
                }
                .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .navigationTitle(companion?.name ?? "沟通")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(.hidden, for: .navigationBar)
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
        HStack(spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(Color.appCoral)
            Text(text)
                .font(.caption.weight(.semibold))
                .foregroundStyle(Color.appCoral)
            Spacer()
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 10)
        .background(Color.appCoral.opacity(0.1))
    }
}

private struct RestrictionBanner: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.caption)
            .foregroundStyle(Color.appMuted)
            .padding(.horizontal, 18)
            .padding(.bottom, 6)
    }
}

private struct ChatSafetyHeader: View {
    let companion: Companion?
    let isCallActive: Bool
    let seconds: Int
    let toggleCall: () -> Void
    let onReport: () -> Void

    var body: some View {
        GlassPanel(cornerRadius: 24, tint: Color.appTeal.opacity(0.1)) {
            VStack(spacing: 12) {
                HStack(spacing: 12) {
                    if let companion {
                        CompanionAvatar(companion: companion, size: 46)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(companion.name)
                                .font(.headline)
                                .foregroundStyle(Color.appInk)
                            Text(isCallActive ? "语音沟通中 \(format(seconds))" : "平台内安全沟通")
                                .font(.caption)
                                .foregroundStyle(Color.appMuted)
                        }
                    }
                    Spacer()
                    Button(action: toggleCall) {
                        Image(systemName: isCallActive ? "phone.down.fill" : "phone.fill")
                            .frame(width: 40, height: 40)
                            .foregroundStyle(isCallActive ? .white : Color.appInk)
                            .background(isCallActive ? Color.appCoral : Color.white.opacity(0.45), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    }
                    .accessibilityLabel(isCallActive ? "结束语音" : "开始语音")
                    Button(action: onReport) {
                        Image(systemName: "exclamationmark.bubble")
                            .frame(width: 40, height: 40)
                            .foregroundStyle(Color.appInk)
                            .background(.white.opacity(0.45), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    }
                    .accessibilityLabel("举报")
                }
                HStack(spacing: 8) {
                    StatusPill(text: "AI+规则审查", symbol: "checklist.checked", color: Color.appTeal)
                    StatusPill(text: "禁止私下交易", symbol: "lock.fill", color: Color.appCoral)
                    Spacer()
                }
            }
        }
        .padding(.horizontal, 14)
        .padding(.top, 8)
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
                LazyVStack(spacing: 12) {
                    ForEach(messages) { message in
                        MessageBubble(message: message, isCurrentUser: message.senderId == currentUserId)
                            .id(message.id)
                    }
                }
                .padding(18)
            }
            .onChange(of: messages.count) { _, _ in
                if let last = messages.last {
                    withAnimation(.snappy) {
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
            if isCurrentUser { Spacer(minLength: 42) }
            VStack(alignment: isCurrentUser ? .trailing : .leading, spacing: 4) {
                Text(message.content)
                    .font(.subheadline)
                    .foregroundStyle(foreground)
                    .padding(.horizontal, 13)
                    .padding(.vertical, 10)
                    .background(background, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                    .liquidGlass(cornerRadius: 18, tint: tint, interactive: false)
                Text(message.timestamp, style: .time)
                    .font(.caption2)
                    .foregroundStyle(Color.appMuted)
                    .padding(.horizontal, 4)
            }
            if !isCurrentUser { Spacer(minLength: 42) }
        }
    }

    private var background: Color {
        switch message.type {
        case .system: Color.appTeal.opacity(0.12)
        case .safety: Color.appCoral.opacity(0.14)
        case .text: isCurrentUser ? Color.appInk : .white.opacity(0.54)
        }
    }

    private var foreground: Color {
        isCurrentUser && message.type == .text ? .white : Color.appInk
    }

    private var tint: Color {
        message.type == .safety ? Color.appCoral.opacity(0.14) : .white.opacity(0.15)
    }
}

private struct ComposerBar: View {
    @Binding var text: String
    var isSending: Bool
    var isDisabled: Bool
    let send: () -> Void
    let finish: () -> Void

    var body: some View {
        ActionDock(tint: .white.opacity(0.2)) {
            VStack(spacing: 10) {
                HStack(spacing: 10) {
                    TextField("输入消息，试试“加微信”触发风控", text: $text, axis: .vertical)
                        .lineLimit(1...3)
                        .textFieldStyle(.plain)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 11)
                        .background(.white.opacity(0.6), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
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
                        .frame(width: 42, height: 42)
                        .foregroundStyle(.white)
                        .background(Color.appInk, in: RoundedRectangle(cornerRadius: 15, style: .continuous))
                    }
                    .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isDisabled || isSending)
                    .accessibilityLabel("发送")
                }
                PrimaryActionButton(title: "结束沟通并评价", systemImage: "checkmark.circle") {
                    finish()
                }
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
            GlassPanel(cornerRadius: 28, tint: Color.appTeal.opacity(0.16)) {
                HStack(spacing: 12) {
                    CompanionAvatar(companion: companion, size: 48)
                    VStack(alignment: .leading, spacing: 3) {
                        Text("语音沟通中")
                            .font(.headline)
                            .foregroundStyle(Color.appInk)
                        Text("\(seconds / 60):\(String(format: "%02d", seconds % 60)) · 模拟 RTC")
                            .font(.caption)
                            .foregroundStyle(Color.appMuted)
                    }
                    Spacer()
                    Button(action: end) {
                        Image(systemName: "phone.down.fill")
                            .foregroundStyle(.white)
                            .frame(width: 44, height: 44)
                            .background(Color.appCoral, in: Circle())
                    }
                    .accessibilityLabel("结束通话")
                }
            }
            .padding(.horizontal, 18)
            .padding(.top, 92)
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
            VStack(alignment: .leading, spacing: 18) {
                Text("举报后会进入 AI 分拣和人工复核队列。")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Picker("举报原因", selection: $reason) {
                    Text("聊天内容不适").tag("聊天内容不适")
                    Text("诱导私下联系").tag("诱导私下联系")
                    Text("服务边界不清").tag("服务边界不清")
                }
                .pickerStyle(.inline)
                PrimaryActionButton(title: "提交", systemImage: "paperplane") {
                    store.report(companionId: companionId, reason: reason)
                    dismiss()
                }
                Spacer()
            }
            .padding()
            .navigationTitle("举报")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}
