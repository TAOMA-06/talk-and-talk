import SwiftUI

struct MessagesView: View {
    @EnvironmentObject private var store: AppStore
    @State private var searchText = ""
    @State private var showingNewConversation = false

    private var conversations: [ContactTarget] {
        let sortedTargets = baseConversations
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return sortedTargets }

        return sortedTargets.filter { target in
            let summary = store.backendConversationSummary(for: target)
            let displayName = summary?.displayName ?? store.displayName(for: target)
            let lastMessage = summary?.lastMessage ?? store.latestMessage(for: target)
            return displayName.localizedStandardContains(query)
                || (lastMessage?.content.localizedStandardContains(query) ?? false)
        }
    }

    private var baseConversations: [ContactTarget] {
        if store.backendConversationLoadState == .loaded || store.backendConversationLoadState == .empty {
            let backendTargets = store.backendConversations.map(\.target)
            if !backendTargets.isEmpty || store.backendConversationLoadState == .empty {
                return backendTargets
            }
        }

        let companionTargets = store.companions
            .filter { store.latestMessage(for: $0.id) != nil }
            .map { ContactTarget.companion(id: $0.id) }

        let communityAuthorIds = Set(store.messages.compactMap { message -> String? in
            let id = message.conversationId
            guard id.hasPrefix("community-") else { return nil }
            return String(id.dropFirst("community-".count))
        })

        let communityTargets: [ContactTarget] = communityAuthorIds.compactMap { id in
            guard let post = store.communityPosts.first(where: { $0.authorId == id }) else { return nil }
            return .communityUser(id: id, name: post.authorName, initials: post.authorInitials)
        }

        return (companionTargets + communityTargets).sorted {
            let lhsDate = store.latestMessage(for: $0)?.timestamp ?? .distantPast
            let rhsDate = store.latestMessage(for: $1)?.timestamp ?? .distantPast
            return lhsDate > rhsDate
        }
    }

    private var isSearching: Bool {
        !searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: DS.Space.lg) {
                MessagesInboxHeader(conversationCount: conversations.count)
                MessageSearchBar(text: $searchText)

                if conversations.isEmpty {
                    EmptyStateView(
                        symbol: isSearching ? "magnifyingglass" : "bubble.left.and.bubble.right",
                        title: isSearching ? "没有找到相关会话" : "暂无沟通会话",
                        subtitle: isSearching ? "换个姓名或消息关键词再试试。" : "可以从在线陪伴者开始试聊，也可以在广场里继续平台内沟通。"
                    )
                    .padding(.top, DS.Space.md)
                    .accessibilityIdentifier(isSearching ? "messagesSearchEmptyState" : "messagesEmptyState")
                } else {
                    LazyVStack(spacing: DS.Space.md) {
                        ForEach(conversations) { target in
                            Button {
                                store.navigate(.chat(target))
                            } label: {
                                SecureConversationRow(
                                    target: target,
                                    summary: store.backendConversationSummary(for: target)
                                )
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("打开与\(store.displayName(for: target))的会话")
                            .accessibilityIdentifier("conversationRow-\(target.id)")
                        }
                    }
                    .accessibilityIdentifier("conversationList")
                }
            }
            .padding(DS.Space.lg)
            .padding(.bottom, 96)
        }
        .background(AppBackground())
        .navigationTitle("消息")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Color.dsBackground.opacity(0.96), for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                DSIconButton(systemImage: "plus.circle", size: 34) {
                    showingNewConversation = true
                }
                .accessibilityLabel("新建沟通")
                .accessibilityIdentifier("newConversationButton")
            }
        }
        .sheet(isPresented: $showingNewConversation) {
            NewConversationSheet()
                .presentationDetents([.medium, .large])
        }
        .task {
            await store.loadBackendConversations()
        }
    }
}

private struct MessagesInboxHeader: View {
    let conversationCount: Int

    var body: some View {
        SoftCard {
            VStack(alignment: .leading, spacing: DS.Space.lg) {
                HStack(alignment: .top, spacing: DS.Space.md) {
                    Image(systemName: "lock.shield.fill")
                        .font(.system(size: 20, weight: .semibold))
                        .foregroundStyle(Color.dsPrimary)
                        .frame(width: 42, height: 42)
                        .background(Color.dsPrimarySoft.opacity(0.78), in: RoundedRectangle(cornerRadius: DS.Radius.md, style: .continuous))

                    VStack(alignment: .leading, spacing: DS.Space.xxs) {
                        Text("平台内安全沟通")
                            .font(.system(size: 19, weight: .semibold))
                            .foregroundStyle(Color.dsTextPrimary)
                        Text("聊天、试聊和订单沟通都留在这里，遇到不适可以随时举报。")
                            .font(.system(size: 13))
                            .foregroundStyle(Color.dsTextSecondary)
                            .lineSpacing(3)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    Spacer(minLength: DS.Space.sm)
                }

                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: DS.Space.sm) {
                        InboxTrustPill(title: "平台内沟通", systemImage: "bubble.left.and.bubble.right")
                        InboxTrustPill(title: "内容保护", systemImage: "checkmark.shield")
                        InboxTrustPill(title: "可举报", systemImage: "exclamationmark.bubble")
                    }
                }

                Text(conversationCount == 0 ? "还没有会话" : "\(conversationCount) 个正在进行的会话")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(Color.dsTextSecondary)
            }
        }
        .accessibilityIdentifier("messagesInboxHeader")
    }
}

private struct InboxTrustPill: View {
    let title: String
    let systemImage: String

    var body: some View {
        Label(title, systemImage: systemImage)
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(Color.dsPrimary)
            .lineLimit(1)
            .minimumScaleFactor(0.82)
            .padding(.horizontal, DS.Space.sm)
            .padding(.vertical, DS.Space.xxs)
            .background(Color.dsPrimarySoft.opacity(0.72), in: Capsule())
            .overlay(Capsule().stroke(Color.dsPrimary.opacity(0.12), lineWidth: DS.Stroke.hairline))
    }
}

private struct NewConversationSheet: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.dismiss) private var dismiss

    private var candidates: [Companion] {
        store.companions
            .filter { $0.availability != .busy }
            .sorted {
                if $0.isOnline != $1.isOnline { return $0.isOnline && !$1.isOnline }
                return $0.rating > $1.rating
            }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: DS.Space.lg) {
                    DSBanner(
                        title: "选择一位可沟通的陪伴者",
                        message: "会话会在平台内进行。可以先试聊，再决定是否预约更长时间。",
                        systemImage: "lock.shield.fill",
                        tone: .primary
                    )

                    LazyVStack(spacing: DS.Space.md) {
                        ForEach(candidates) { companion in
                            Button {
                                dismiss()
                                store.navigate(.chat(.companion(id: companion.id)))
                            } label: {
                                NewConversationRow(companion: companion)
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("开始与\(companion.name)沟通")
                            .accessibilityIdentifier("newConversation-\(companion.id)")
                        }
                    }
                }
                .padding(DS.Space.lg)
            }
            .background(Color.dsBackground)
            .navigationTitle("新建沟通")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("关闭") { dismiss() }
                        .accessibilityIdentifier("newConversationClose")
                }
            }
        }
        .accessibilityIdentifier("newConversationSheet")
    }
}

private struct NewConversationRow: View {
    let companion: Companion

    var body: some View {
        DSCard(padding: DS.Space.md) {
            HStack(spacing: DS.Space.md) {
                CompanionAvatar(companion: companion, size: 52)
                VStack(alignment: .leading, spacing: DS.Space.xxs) {
                    HStack(spacing: DS.Space.sm) {
                        Text(companion.name)
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(Color.dsTextPrimary)
                            .lineLimit(1)
                        if companion.isVerified {
                            Image(systemName: "checkmark.seal.fill")
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(Color.dsPrimary)
                        }
                    }
                    Text("\(companion.role) · \(companion.responseTime)")
                        .font(.system(size: 13))
                        .foregroundStyle(Color.dsTextSecondary)
                        .lineLimit(1)
                }
                Spacer(minLength: DS.Space.sm)
                StatusPill(text: companion.availability.displayName, symbol: "circle.fill", color: companion.availabilityColor)
            }
        }
    }
}

private struct MessageSearchBar: View {
    @Binding var text: String

    var body: some View {
        HStack(spacing: DS.Space.sm) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 17, weight: .medium))
                .foregroundStyle(Color.dsTextSecondary)
            TextField("搜索联系人或消息内容", text: $text)
                .font(.system(size: 15))
                .textInputAutocapitalization(.never)
                .submitLabel(.search)
                .accessibilityLabel("搜索联系人或消息内容")
                .accessibilityIdentifier("messageSearchBar")
        }
        .padding(.horizontal, DS.Space.md)
        .frame(height: 46)
        .background(Color.dsSurfaceElevated, in: RoundedRectangle(cornerRadius: DS.Radius.md, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: DS.Radius.md, style: .continuous)
                .stroke(Color.dsBorder.opacity(0.72), lineWidth: DS.Stroke.hairline)
        }
    }
}

private struct SecureConversationRow: View {
    let target: ContactTarget
    let summary: ConversationSummary?
    @EnvironmentObject private var store: AppStore

    private var lastMessage: Message? {
        summary?.lastMessage ?? store.latestMessage(for: target)
    }

    private var companion: Companion? {
        guard case .companion(let id) = target else { return nil }
        return store.companion(by: id)
    }

    var body: some View {
        DSCard(padding: DS.Space.md) {
            HStack(alignment: .top, spacing: DS.Space.md) {
                conversationAvatar

                VStack(alignment: .leading, spacing: DS.Space.sm) {
                    HStack(alignment: .firstTextBaseline, spacing: DS.Space.sm) {
                        Text(summary?.displayName ?? store.displayName(for: target))
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(Color.dsTextPrimary)
                            .lineLimit(1)

                        if companion?.isVerified == true {
                            Image(systemName: "checkmark.seal.fill")
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(Color.dsPrimary)
                        }

                        Spacer(minLength: DS.Space.sm)

                        if let lastMessage {
                            Text(lastMessage.timestamp, style: .time)
                                .font(.system(size: 11, weight: .medium))
                                .foregroundStyle(Color.dsTextSecondary)
                        }
                    }

                    Text(participantSubtitle)
                        .font(.system(size: 12))
                        .foregroundStyle(Color.dsTextSecondary)
                        .lineLimit(1)

                    HStack(alignment: .top, spacing: DS.Space.sm) {
                        Text(lastMessagePreview)
                            .font(.system(size: 14))
                            .foregroundStyle(previewColor)
                            .lineLimit(2)
                            .frame(maxWidth: .infinity, alignment: .leading)

                        ConversationStatusPill(text: statusText, tone: statusTone)
                    }
                }
            }
        }
        .contentShape(Rectangle())
    }

    @ViewBuilder
    private var conversationAvatar: some View {
        if let companion {
            CompanionAvatar(companion: companion, size: 52)
        } else if let initials = target.communityInitials {
            ConversationInitialsAvatar(initials: String(initials.prefix(1)))
        } else {
            ConversationInitialsAvatar(initials: "TA")
        }
    }

    private var participantSubtitle: String {
        if let companion {
            return "\(companion.role) · \(companion.responseTime)"
        }
        return "广场用户 · 平台内沟通"
    }

    private var lastMessagePreview: String {
        guard let lastMessage else { return "暂无消息" }
        switch lastMessage.type {
        case .system:
            return "系统消息：\(lastMessage.content)"
        case .safety:
            return "安全提醒：\(lastMessage.content)"
        case .recommendationCard:
            return "推荐卡片：可查看陪伴者资料"
        case .text:
            return lastMessage.content
        }
    }

    private var previewColor: Color {
        lastMessage?.type == .safety ? Color.dsWarning : Color.dsTextSecondary
    }

    private var statusText: String {
        if let unreadCount = summary?.unreadCount, unreadCount > 0 { return "\(unreadCount) 未读" }
        if lastMessage?.type == .safety { return "安全提醒" }
        guard let companion else { return "平台内" }
        if store.hasActivePaidChat(with: companion.id) { return "付费沟通" }
        return "试聊 \(store.remainingTrialMessages(for: companion.id))/\(store.freeTrialMessageLimit)"
    }

    private var statusTone: DSBadge.Tone {
        if let unreadCount = summary?.unreadCount, unreadCount > 0 { return .primary }
        if lastMessage?.type == .safety { return .warning }
        guard let companion else { return .neutral }
        if store.hasActivePaidChat(with: companion.id) { return .success }
        return store.remainingTrialMessages(for: companion.id) > 0 ? .primary : .warning
    }
}

private struct ConversationStatusPill: View {
    let text: String
    let tone: DSBadge.Tone

    var body: some View {
        DSBadge(text: text, tone: tone)
            .lineLimit(1)
            .fixedSize(horizontal: true, vertical: false)
    }
}

private struct ConversationInitialsAvatar: View {
    let initials: String

    var body: some View {
        DSInitialsAvatar(initials: initials, tone: .neutral, size: 52)
    }
}
