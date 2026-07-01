import SwiftUI

struct MessagesView: View {
    @EnvironmentObject private var store: AppStore
    @State private var searchText = ""

    private var conversations: [ContactTarget] {
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

        let allTargets = companionTargets + communityTargets
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return allTargets }

        return allTargets.filter { target in
            store.displayName(for: target).localizedStandardContains(query)
                || (store.latestMessage(for: target)?.content.localizedStandardContains(query) ?? false)
        }
    }

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(spacing: 0) {
                MessageSearchBar(text: $searchText)
                    .padding(.horizontal, DS.Space.lg)
                    .padding(.top, DS.Space.md)
                    .padding(.bottom, DS.Space.sm)

                MessagesSafetyLoginRow()

                if conversations.isEmpty {
                    EmptyStateView(symbol: "bubble.left.and.bubble.right", title: "暂无消息", subtitle: "下单后会自动生成安全沟通房间。")
                        .padding(.top, DS.Space.xl)
                } else {
                    LazyVStack(spacing: 0) {
                        ForEach(conversations) { target in
                            Button {
                                store.navigate(.chat(target))
                            } label: {
                                WeChatConversationRow(target: target)
                            }
                            .buttonStyle(.plain)

                            Divider()
                                .padding(.leading, 84)
                        }
                    }
                    .background(Color.dsSurface)
                }
            }
            .padding(.bottom, 96)
        }
        .background(Color.dsBackground)
        .navigationTitle("消息")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Color.dsBackground, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {} label: {
                    Image(systemName: "plus.circle")
                        .font(.system(size: 20, weight: .medium))
                }
                .foregroundStyle(Color.dsTextPrimary)
                .accessibilityLabel("新建沟通")
            }
        }
    }
}

private struct MessageSearchBar: View {
    @Binding var text: String

    var body: some View {
        HStack(spacing: DS.Space.sm) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 18))
                .foregroundStyle(Color.dsTextSecondary)
            TextField("搜索", text: $text)
                .font(.system(size: 16))
                .textInputAutocapitalization(.never)
                .submitLabel(.search)
        }
        .padding(.horizontal, DS.Space.md)
        .frame(height: 44)
        .background(Color.dsSurface, in: RoundedRectangle(cornerRadius: DS.Radius.sm, style: .continuous))
        .accessibilityIdentifier("messageSearchBar")
    }
}

private struct MessagesSafetyLoginRow: View {
    var body: some View {
        HStack(spacing: DS.Space.md) {
            Image(systemName: "lock.shield")
                .font(.system(size: 24, weight: .regular))
                .foregroundStyle(Color.dsTextSecondary)
                .frame(width: 52, height: 52)

            VStack(alignment: .leading, spacing: DS.Space.xxs) {
                Text("平台内安全沟通")
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(Color.dsTextPrimary)
                Text("AI+规则审查，禁止私下交易")
                    .font(.system(size: 13))
                    .foregroundStyle(Color.dsTextSecondary)
                    .lineLimit(1)
            }
            Spacer()
        }
        .padding(.horizontal, DS.Space.lg)
        .padding(.vertical, DS.Space.sm)
    }
}

private struct WeChatConversationRow: View {
    let target: ContactTarget
    @EnvironmentObject private var store: AppStore

    private var lastMessage: Message? {
        store.latestMessage(for: target)
    }

    var body: some View {
        HStack(alignment: .center, spacing: DS.Space.md) {
            conversationAvatar

            VStack(alignment: .leading, spacing: DS.Space.xxs) {
                HStack(alignment: .firstTextBaseline, spacing: DS.Space.sm) {
                    Text(store.displayName(for: target))
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(Color.dsTextPrimary)
                        .lineLimit(1)

                    Spacer(minLength: DS.Space.sm)

                    if let lastMessage {
                        Text(lastMessage.timestamp, style: .time)
                            .font(.system(size: 12))
                            .foregroundStyle(Color.dsTextSecondary)
                    }
                }

                Text(lastMessagePreview)
                    .font(.system(size: 14))
                    .foregroundStyle(Color.dsTextSecondary)
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(.horizontal, DS.Space.lg)
        .padding(.vertical, DS.Space.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.dsSurface)
        .contentShape(Rectangle())
    }

    @ViewBuilder
    private var conversationAvatar: some View {
        if case .companion(let id) = target, let companion = store.companion(by: id) {
            CompanionAvatar(companion: companion, size: 52)
        } else if let initials = target.communityInitials {
            ConversationInitialsAvatar(initials: String(initials.prefix(1)))
        } else {
            ConversationInitialsAvatar(initials: "TA")
        }
    }

    private var lastMessagePreview: String {
        guard let lastMessage else { return "暂无消息" }
        switch lastMessage.type {
        case .system:
            return "[系统] \(lastMessage.content)"
        case .safety:
            return "[安全提醒] \(lastMessage.content)"
        case .recommendationCard:
            return "[推荐卡片]"
        case .text:
            return lastMessage.content
        }
    }
}

private struct ConversationInitialsAvatar: View {
    let initials: String

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: DS.Radius.sm, style: .continuous)
                .fill(Color.dsTextSecondary.opacity(0.14))
            Text(initials)
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(Color.dsTextSecondary)
        }
        .frame(width: 52, height: 52)
    }
}
