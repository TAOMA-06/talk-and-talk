import SwiftUI

struct MessagesView: View {
    @EnvironmentObject private var store: AppStore
    
    var conversations: [Companion] {
        store.companions.filter { companion in
            store.messages.contains { $0.senderId == companion.id || $0.senderId == store.user.id }
        }
    }
    
    var body: some View {
        NavigationStack {
            ScrollView {
                if conversations.isEmpty {
                    EmptyState
                } else {
                    ConversationsList
                }
            }
            .navigationTitle("消息")
        }
    }
    
    private var EmptyState: some View {
        VStack(spacing: 16) {
            Image(systemName: "message")
                .font(.system(size: 64))
                .foregroundStyle(.secondary)
            
            Text("暂无消息")
                .foregroundStyle(.secondary)
        }
        .padding(.top, 60)
    }
    
    private var ConversationsList: some View {
        LazyVStack(spacing: 12) {
            ForEach(conversations) { companion in
                ConversationRow(companion: companion)
            }
        }
        .padding()
    }
}

struct ConversationRow: View {
    let companion: Companion
    @EnvironmentObject private var store: AppStore
    
    var lastMessage: Message? {
        store.messages(for: companion.id).last
    }
    
    var body: some View {
        HStack(spacing: 12) {
            ZStack(alignment: .bottomTrailing) {
                AsyncImage(url: URL(string: companion.avatar)) { image in
                    image
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                } placeholder: {
                    Circle()
                        .fill(Color.gray.opacity(0.3))
                }
                .frame(width: 48, height: 48)
                .clipShape(RoundedRectangle(cornerRadius: 12))
                
                if companion.isOnline {
                    Circle()
                        .fill(Color.teal)
                        .frame(width: 12, height: 12)
                        .overlay(Circle().stroke(Color.white, lineWidth: 2))
                }
            }
            
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(companion.name)
                        .font(.headline)
                    
                    Spacer()
                    
                    if let lastMessage = lastMessage {
                        Text(lastMessage.timestamp, style: .time)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                
                if let lastMessage = lastMessage {
                    Text(lastMessage.content)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            
            Spacer()
        }
        .padding()
        .background(Color.gray.opacity(0.1))
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .onTapGesture {
            store.navigationPath.append(NavigationDestination.chat(companion.id))
        }
    }
}
