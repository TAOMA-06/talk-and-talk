import SwiftUI

struct CommunityView: View {
    @EnvironmentObject private var store: AppStore
    @State private var showingComposer = false
    @State private var topic = "情绪倾听"
    @State private var content = ""
    @State private var isSubmitting = false
    @State private var feedbackMessage: String?

    private let topics = ["情绪倾听", "穿搭分享", "拍照技巧", "陪伴故事"]

    var body: some View {
        AppScaffold(title: "社区", spacing: 20) {
            BelongingBanner()
            if !store.pendingCommunityPosts().isEmpty {
                SectionHeader(title: "审核中", subtitle: "先审后发，保护社区氛围")
                LazyVStack(spacing: 14) {
                    ForEach(store.pendingCommunityPosts()) { post in
                        CommunityPostCard(post: post)
                    }
                }
            }
            SectionHeader(title: "她的故事", subtitle: "分享、被理解、被尊重")
            LazyVStack(spacing: 14) {
                ForEach(store.approvedCommunityPosts()) { post in
                    CommunityPostCard(post: post)
                }
            }
            Button {
                showingComposer = true
            } label: {
                Label("分享你的故事", systemImage: "square.and.pencil")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 15)
                    .foregroundStyle(Color.appTeal)
                    .background(Color.appTeal.opacity(0.08), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            }
            .buttonStyle(.plain)
            .disabled(!store.accountRestrictions.canPostCommunity)
        }
        .sheet(isPresented: $showingComposer) {
            NavigationStack {
                VStack(alignment: .leading, spacing: 16) {
                    Picker("话题", selection: $topic) {
                        ForEach(topics, id: \.self) { Text($0).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    TextField("写下你的故事...", text: $content, axis: .vertical)
                        .lineLimit(4...8)
                        .padding(12)
                        .background(Color.appMist, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    if let feedbackMessage {
                        Text(feedbackMessage)
                            .font(.caption)
                            .foregroundStyle(Color.appCoral)
                    }
                    PrimaryActionButton(
                        title: isSubmitting ? "审核中..." : "发布",
                        systemImage: "paperplane",
                        isEnabled: !content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !isSubmitting
                    ) {
                        submitPost()
                    }
                    Spacer()
                }
                .padding()
                .navigationTitle("发布故事")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("关闭") { showingComposer = false }
                    }
                }
            }
            .presentationDetents([.medium, .large])
        }
    }

    private func submitPost() {
        isSubmitting = true
        Task {
            let status = await store.submitCommunityPost(topic: topic, content: content)
            feedbackMessage = store.lastModerationFeedback
            isSubmitting = false
            if status == .approved {
                content = ""
                showingComposer = false
            }
        }
    }
}

private struct BelongingBanner: View {
    var body: some View {
        SoftCard(cornerRadius: 24, tint: Color.appRose, padding: 20) {
            VStack(alignment: .leading, spacing: 10) {
                Text("这是属于我们的地方")
                    .font(.title3.weight(.bold))
                    .foregroundStyle(Color.appInk)
                Text("从女性视角出发，尊重每一种情绪。骚扰、低俗、越界内容零容忍——在这里，你可以安心做自己。")
                    .font(.subheadline)
                    .foregroundStyle(Color.appMuted)
                    .lineSpacing(4)
                HStack(spacing: 8) {
                    TrustMicroBadge(text: "女性主导", symbol: "heart.fill", color: Color.appRose)
                    TrustMicroBadge(text: "严格审核", symbol: "checkmark.shield", color: Color.appTeal)
                }
            }
        }
    }
}

private struct CommunityPostCard: View {
    let post: CommunityPost

    var body: some View {
        SoftCard(cornerRadius: 22, tint: Color.appRose, padding: 16) {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 12) {
                    ZStack {
                        Circle()
                            .fill(LinearGradient(colors: [Color.appRose, Color.appLilac], startPoint: .topLeading, endPoint: .bottomTrailing))
                        Text(post.authorInitials)
                            .font(.caption.weight(.bold))
                            .foregroundStyle(.white)
                    }
                    .frame(width: 40, height: 40)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(post.authorName)
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(Color.appInk)
                        Text("#\(post.topic)")
                            .font(.caption)
                            .foregroundStyle(Color.appRose)
                    }
                    Spacer()
                    statusBadge
                }
                Text(post.content)
                    .font(.subheadline)
                    .foregroundStyle(Color.appInk)
                    .lineSpacing(4)
                    .fixedSize(horizontal: false, vertical: true)
                HStack {
                    Label("\(post.likeCount)", systemImage: "heart")
                        .font(.caption)
                        .foregroundStyle(Color.appMuted)
                    Spacer()
                }
            }
        }
    }

    @ViewBuilder
    private var statusBadge: some View {
        switch post.moderationStatus {
        case .approved:
            TrustMicroBadge(text: "已审核", symbol: "checkmark.circle", color: Color.appTeal)
        case .pending:
            TrustMicroBadge(text: "审核中", symbol: "clock", color: Color.appGold)
        case .rejected:
            TrustMicroBadge(text: "未通过", symbol: "xmark.circle", color: Color.appCoral)
        }
    }
}
