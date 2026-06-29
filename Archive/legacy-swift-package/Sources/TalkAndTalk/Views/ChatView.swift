import SwiftUI

struct ChatView: View {
    let companionId: String
    @EnvironmentObject private var store: AppStore
    @Environment(\.dismiss) private var dismiss
    
    @State private var inputText = ""
    @State private var isVoiceMode = false
    @State private var isCallActive = false
    
    var companion: Companion? {
        store.companion(by: companionId)
    }
    
    var messages: [Message] {
        store.messages(for: companionId)
    }
    
    var body: some View {
        VStack(spacing: 0) {
            ChatHeader
            
            MessagesList
            
            InputArea
        }
        .navigationTitle(companion?.name ?? "聊天")
        .overlay {
            if isCallActive {
                VoiceCallOverlay
            }
        }
    }
    
    private var ChatHeader: some View {
        HStack {
            Button {
                dismiss()
            } label: {
                Image(systemName: "chevron.left")
            }
            
            if let companion = companion {
                AsyncImage(url: URL(string: companion.avatar)) { image in
                    image
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                } placeholder: {
                    Circle()
                        .fill(Color.gray.opacity(0.3))
                }
                .frame(width: 32, height: 32)
                .clipShape(Circle())
                
                VStack(alignment: .leading, spacing: 2) {
                    Text(companion.name)
                        .font(.subheadline)
                        .fontWeight(.medium)
                    Text(companion.isOnline ? "在线" : "离线")
                        .font(.caption)
                        .foregroundStyle(companion.isOnline ? .teal : .secondary)
                }
            }
            
            Spacer()
            
            Button {
                isCallActive.toggle()
            } label: {
                Image(systemName: "phone.fill")
                    .foregroundStyle(isCallActive ? .white : .primary)
            }
            .buttonStyle(BorderlessButtonStyle())
            .tint(.teal)
            
            Button {
                // More options
            } label: {
                Image(systemName: "ellipsis")
            }
            .buttonStyle(BorderlessButtonStyle())
            .tint(.primary)
        }
        .padding()
        .background(Color.white)
        .overlay(
            Rectangle()
                .frame(height: 0.5)
                .foregroundColor(Color.gray.opacity(0.3)),
            alignment: .bottom
        )
    }
    
    private var MessagesList: some View {
        ScrollView {
            LazyVStack(spacing: 12) {
                ForEach(messages) { message in
                    MessageBubble(message: message, isCurrentUser: message.senderId == store.user.id)
                }
            }
            .padding()
        }
    }
    
    private var InputArea: some View {
        VStack(spacing: 8) {
            HStack(spacing: 8) {
                Button {
                    isVoiceMode.toggle()
                } label: {
                    Image(systemName: "mic.fill")
                        .foregroundStyle(isVoiceMode ? .white : .primary)
                }
                .buttonStyle(BorderlessButtonStyle())
                .tint(.teal)
                
                TextField("输入消息...", text: $inputText)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit {
                        sendMessage()
                    }
                
                Button {
                    sendMessage()
                } label: {
                    Image(systemName: "paperplane.fill")
                        .foregroundStyle(.white)
                }
                .buttonStyle(.borderedProminent)
                .tint(.primary)
                .disabled(inputText.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            
            Button {
                store.navigationPath.append(NavigationDestination.review(companionId))
            } label: {
                Text("结束沟通并评价")
                    .font(.subheadline)
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .tint(.teal)
        }
        .padding()
        .background(Color.white)
        .overlay(
            Rectangle()
                .frame(height: 0.5)
                .foregroundColor(Color.gray.opacity(0.3)),
            alignment: .top
        )
    }
    
    private var VoiceCallOverlay: some View {
        ZStack {
            Color.white
                .opacity(0.95)
                .ignoresSafeArea()
            
            VStack(spacing: 24) {
                if let companion = companion {
                    AsyncImage(url: URL(string: companion.avatar)) { image in
                        image
                            .resizable()
                            .aspectRatio(contentMode: .fill)
                    } placeholder: {
                        Circle()
                            .fill(Color.gray.opacity(0.3))
                    }
                    .frame(width: 96, height: 96)
                    .clipShape(Circle())
                    
                    Text(companion.name)
                        .font(.title2)
                        .fontWeight(.bold)
                }
                
                Text("语音通话中...")
                    .foregroundStyle(.secondary)
                
                Button {
                    isCallActive = false
                } label: {
                    Label("结束通话", systemImage: "phone.down.fill")
                        .font(.headline)
                }
                .buttonStyle(.borderedProminent)
                .tint(.red)
            }
        }
    }
    
    private func sendMessage() {
        let trimmed = inputText.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return }
        store.sendMessage(trimmed, to: companionId)
        inputText = ""
    }
}

struct MessageBubble: View {
    let message: Message
    let isCurrentUser: Bool
    
    var body: some View {
        HStack {
            if isCurrentUser {
                Spacer()
            }
            
            VStack(alignment: isCurrentUser ? .trailing : .leading, spacing: 4) {
                if message.type == .system {
                    Text(message.content)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .background(Color.gray.opacity(0.1))
                        .clipShape(Capsule())
                } else {
                    Text(message.content)
                        .font(.subheadline)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(isCurrentUser ? Color.primary : Color.gray.opacity(0.1))
                        .foregroundStyle(isCurrentUser ? .white : .primary)
                        .clipShape(RoundedRectangle(cornerRadius: 16))
                }
            }
            
            if !isCurrentUser {
                Spacer()
            }
        }
    }
}
