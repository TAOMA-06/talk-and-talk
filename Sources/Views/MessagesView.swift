import SwiftUI

struct MessagesView: View {
    @EnvironmentObject private var store: AppStore

    private var conversations: [Companion] {
        store.companions.filter { store.latestMessage(for: $0.id) != nil }
    }

    var body: some View {
        AppScaffold(title: "消息", spacing: 16) {
            SectionHeader(title: "消息", subtitle: "平台内沟通记录")
            if conversations.isEmpty {
                EmptyStateView(symbol: "bubble.left.and.bubble.right", title: "暂无消息", subtitle: "下单后会自动生成安全沟通房间。")
            } else {
                ForEach(conversations) { companion in
                    Button {
                        store.navigate(.chat(companion.id))
                    } label: {
                        ConversationCard(companion: companion)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }
}

private struct ConversationCard: View {
    let companion: Companion
    @EnvironmentObject private var store: AppStore

    private var lastMessage: Message? {
        store.latestMessage(for: companion.id)
    }

    var body: some View {
        GlassPanel(cornerRadius: 24) {
            HStack(spacing: 13) {
                CompanionAvatar(companion: companion, size: 58)
                VStack(alignment: .leading, spacing: 5) {
                    HStack {
                        Text(companion.name)
                            .font(.headline)
                            .foregroundStyle(Color.appInk)
                        Spacer()
                        if let lastMessage {
                            Text(lastMessage.timestamp, style: .time)
                                .font(.caption)
                                .foregroundStyle(Color.appMuted)
                        }
                    }
                    Text(lastMessage?.content ?? "暂无消息")
                        .font(.subheadline)
                        .foregroundStyle(Color.appMuted)
                        .lineLimit(2)
                    HStack {
                        StatusPill(text: companion.isOnline ? "在线" : "可预约", symbol: companion.isOnline ? "circle.fill" : "calendar", color: companion.isOnline ? Color.appTeal : Color.appGold)
                        Spacer()
                    }
                }
            }
        }
    }
}
