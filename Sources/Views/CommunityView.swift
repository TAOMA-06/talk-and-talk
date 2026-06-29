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
        AppScaffold(title: "社区", spacing: DS.Space.lg) {
            BelongingBanner()
            if !store.pendingCommunityPosts().isEmpty {
                SectionHeader(title: "审核中", subtitle: "先审后发，保护社区氛围")
                LazyVStack(spacing: DS.Space.md) {
                    ForEach(store.pendingCommunityPosts()) { post in
                        CommunityPostCard(post: post)
                    }
                }
            }
            SectionHeader(title: "她的故事", subtitle: "分享、被理解、被尊重")
            if store.approvedCommunityPosts().isEmpty && store.pendingCommunityPosts().isEmpty {
                EmptyStateView(symbol: "text.bubble", title: "还没有故事", subtitle: "成为第一个分享的人。")
            } else {
                LazyVStack(spacing: DS.Space.md) {
                    ForEach(store.approvedCommunityPosts()) { post in
                        CommunityPostCard(post: post)
                    }
                }
            }
            DSSecondaryButton(title: "分享你的故事") {
                showingComposer = true
            }
            .disabled(!store.accountRestrictions.canPostCommunity)
        }
        .sheet(isPresented: $showingComposer) {
            NavigationStack {
                VStack(alignment: .leading, spacing: DS.Space.lg) {
                    Picker("话题", selection: $topic) {
                        ForEach(topics, id: \.self) { Text($0).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    DSInputField(placeholder: "写下你的故事...", text: $content, axis: .vertical, lineLimit: 4...8)
                    if let feedbackMessage {
                        Text(feedbackMessage)
                            .font(.system(size: 13))
                            .foregroundStyle(Color.dsDanger)
                    }
                    DSPrimaryButton(
                        title: isSubmitting ? "审核中..." : "发布",
                        systemImage: "paperplane",
                        isEnabled: !content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !isSubmitting,
                        isLoading: isSubmitting
                    ) {
                        submitPost()
                    }
                    Spacer()
                }
                .padding(DS.Space.lg)
                .background(Color.dsBackground)
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
        SoftCard {
            VStack(alignment: .leading, spacing: DS.Space.sm) {
                Text("这是属于我们的地方")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(Color.dsTextPrimary)
                Text("从女性视角出发，尊重每一种情绪。骚扰、低俗、越界内容零容忍——在这里，你可以安心做自己。")
                    .font(.system(size: 13))
                    .foregroundStyle(Color.dsTextSecondary)
                    .lineSpacing(4)
                HStack(spacing: DS.Space.sm) {
                    TrustMicroBadge(text: "女性主导", tone: .primary)
                    TrustMicroBadge(text: "严格审核", tone: .success)
                }
            }
        }
    }
}

private struct CommunityPostCard: View {
    let post: CommunityPost

    var body: some View {
        SoftCard {
            VStack(alignment: .leading, spacing: DS.Space.md) {
                HStack(spacing: DS.Space.md) {
                    ZStack {
                        RoundedRectangle(cornerRadius: DS.Radius.sm, style: .continuous)
                            .fill(Color.dsPrimary.opacity(0.12))
                        Text(post.authorInitials)
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(Color.dsPrimary)
                    }
                    .frame(width: 40, height: 40)
                    VStack(alignment: .leading, spacing: DS.Space.xxs) {
                        Text(post.authorName)
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(Color.dsTextPrimary)
                        Text("#\(post.topic)")
                            .font(.system(size: 11))
                            .foregroundStyle(Color.dsTextSecondary)
                    }
                    Spacer()
                    statusBadge
                }
                Text(post.content)
                    .font(.system(size: 15))
                    .foregroundStyle(Color.dsTextPrimary)
                    .lineSpacing(4)
                    .fixedSize(horizontal: false, vertical: true)
                HStack {
                    Label("\(post.likeCount)", systemImage: "heart")
                        .font(.system(size: 11))
                        .foregroundStyle(Color.dsTextSecondary)
                    Spacer()
                }
            }
        }
    }

    @ViewBuilder
    private var statusBadge: some View {
        switch post.moderationStatus {
        case .approved:
            TrustMicroBadge(text: "已审核", tone: .success)
        case .pending:
            TrustMicroBadge(text: "审核中", tone: .warning)
        case .rejected:
            TrustMicroBadge(text: "未通过", tone: .danger)
        }
    }
}
