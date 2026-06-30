import PhotosUI
import SwiftUI
import UIKit

struct CommunityView: View {
    @EnvironmentObject private var store: AppStore
    @State private var showingComposer = false
    @State private var topic = "情绪倾听"
    @State private var selectedTopic = "全部"
    @State private var content = ""

    private let topicFilters = ["全部", "情绪倾听", "陪伴故事", "职场减压", "睡前聊天"]

    private var approvedPosts: [CommunityPost] {
        store.approvedCommunityPosts()
    }

    private var filteredApprovedPosts: [CommunityPost] {
        guard selectedTopic != "全部" else { return approvedPosts }
        return approvedPosts.filter { $0.topic == selectedTopic }
    }

    var body: some View {
        AppScaffold(title: "社区", spacing: DS.Space.lg) {
            BelongingBanner()

            if !store.pendingCommunityPosts().isEmpty {
                SectionHeader(title: "审核中", subtitle: "先审后发，保护社区氛围")
                CommunityMasonryGrid(posts: store.pendingCommunityPosts())
            }

            CommunityFeedHeader(canPublish: store.accountRestrictions.canPostCommunity) {
                showingComposer = true
            }
            CommunityTopicFilterBar(topics: topicFilters, selection: $selectedTopic)

            if approvedPosts.isEmpty && store.pendingCommunityPosts().isEmpty {
                EmptyStateView(symbol: "text.bubble", title: "还没有故事", subtitle: "成为第一个分享的人。")
            } else if filteredApprovedPosts.isEmpty {
                EmptyStateView(symbol: "text.bubble", title: "这个话题还没有笔记", subtitle: "换个频道看看，或者发布你的第一篇。")
            } else {
                CommunityMasonryGrid(posts: filteredApprovedPosts)
            }
        }
        .sheet(isPresented: $showingComposer) {
            ComposeStorySheet(
                topic: $topic,
                content: $content,
                isPresented: $showingComposer
            )
        }
    }
}

private struct ComposeStorySheet: View {
    @EnvironmentObject private var store: AppStore
    @Binding var topic: String
    @Binding var content: String
    @Binding var isPresented: Bool

    @State private var selectedPhotoItem: PhotosPickerItem?
    @State private var coverImageData: Data?
    @State private var coverAspectRatio: Double?
    @State private var isSubmitting = false
    @State private var feedbackMessage: String?

    private let topics = ["情绪倾听", "陪伴故事", "职场减压", "睡前聊天"]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: DS.Space.lg) {
                    coverPicker
                    topicPicker
                    storyEditor
                    if let feedbackMessage {
                        Text(feedbackMessage)
                            .font(.system(size: 13))
                            .foregroundStyle(Color.dsDanger)
                    }
                    DSPrimaryButton(
                        title: isSubmitting ? "审核中..." : "发布笔记",
                        systemImage: "paperplane",
                        isEnabled: !trimmedContent.isEmpty && !isSubmitting,
                        isLoading: isSubmitting,
                        action: submitPost
                    )
                }
                .padding(DS.Space.lg)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(Color.dsBackground)
            .navigationTitle("发布笔记")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("关闭") { isPresented = false }
                }
            }
        }
        .task(id: selectedPhotoItem) {
            await loadSelectedCover()
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    private var trimmedContent: String {
        content.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var coverPicker: some View {
        VStack(alignment: .leading, spacing: DS.Space.sm) {
            Text("封面")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Color.dsTextSecondary)

            if let coverImageData, let uiImage = UIImage(data: coverImageData) {
                ZStack(alignment: .topTrailing) {
                    Image(uiImage: uiImage)
                        .resizable()
                        .scaledToFill()
                        .frame(maxWidth: .infinity)
                        .aspectRatio(CGFloat(coverAspectRatio ?? 1), contentMode: .fit)
                        .clipShape(RoundedRectangle(cornerRadius: DS.Radius.sm, style: .continuous))

                    Button(action: removeCover) {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 24, weight: .semibold))
                            .symbolRenderingMode(.palette)
                            .foregroundStyle(Color.dsSurface, Color.dsTextPrimary.opacity(0.72))
                            .padding(DS.Space.sm)
                    }
                    .accessibilityLabel("移除封面")
                }
            } else {
                PhotosPicker(selection: $selectedPhotoItem, matching: .images) {
                    VStack(spacing: DS.Space.sm) {
                        Image(systemName: "photo.on.rectangle.angled")
                            .font(.system(size: 26, weight: .regular))
                            .foregroundStyle(Color.dsPrimary)
                        Text("选择封面")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(Color.dsTextPrimary)
                        Text("未选择时会使用话题封面")
                            .font(.system(size: 12))
                            .foregroundStyle(Color.dsTextSecondary)
                    }
                    .frame(maxWidth: .infinity)
                    .frame(height: 132)
                    .background(Color.dsSurface, in: RoundedRectangle(cornerRadius: DS.Radius.sm, style: .continuous))
                    .overlay {
                        RoundedRectangle(cornerRadius: DS.Radius.sm, style: .continuous)
                            .stroke(Color.dsBorder, style: StrokeStyle(lineWidth: 1, dash: [6, 5]))
                    }
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var topicPicker: some View {
        VStack(alignment: .leading, spacing: DS.Space.sm) {
            Text("话题")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Color.dsTextSecondary)
            FlowLayout(spacing: DS.Space.sm) {
                ForEach(topics, id: \.self) { item in
                    TagChip(title: item, isSelected: topic == item) {
                        topic = item
                    }
                }
            }
        }
    }

    private var storyEditor: some View {
        VStack(alignment: .leading, spacing: DS.Space.sm) {
            Text("笔记内容")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Color.dsTextSecondary)
            ZStack(alignment: .topLeading) {
                if trimmedContent.isEmpty {
                    Text("写下你的故事...")
                        .font(.system(size: 15))
                        .foregroundStyle(Color.dsTextSecondary)
                        .padding(.horizontal, DS.Space.md)
                        .padding(.vertical, DS.Space.md)
                }
                TextEditor(text: $content)
                    .font(.system(size: 15))
                    .frame(minHeight: 140)
                    .scrollContentBackground(.hidden)
                    .padding(.horizontal, DS.Space.sm)
                    .padding(.vertical, DS.Space.sm)
            }
            .background(Color.dsSurface, in: RoundedRectangle(cornerRadius: DS.Radius.sm, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: DS.Radius.sm, style: .continuous)
                    .stroke(Color.dsBorder, lineWidth: 1)
            }
        }
    }

    @MainActor
    private func loadSelectedCover() async {
        guard let selectedPhotoItem else { return }
        guard let data = try? await selectedPhotoItem.loadTransferable(type: Data.self) else { return }

        coverImageData = data
        coverAspectRatio = Self.coverAspectRatio(for: data)
    }

    private func removeCover() {
        selectedPhotoItem = nil
        coverImageData = nil
        coverAspectRatio = nil
    }

    private func submitPost() {
        guard !isSubmitting else { return }
        isSubmitting = true
        feedbackMessage = nil
        let draft = content
        let draftCoverImageData = coverImageData
        let draftCoverAspectRatio = coverAspectRatio

        Task { @MainActor in
            let status = await store.submitCommunityPost(
                topic: topic,
                content: draft,
                coverImageData: draftCoverImageData,
                coverAspectRatio: draftCoverAspectRatio
            )
            feedbackMessage = store.lastModerationFeedback
            isSubmitting = false
            if status == .approved {
                content = ""
                removeCover()
                isPresented = false
            }
        }
    }

    private static func coverAspectRatio(for data: Data) -> Double {
        guard let image = UIImage(data: data), image.size.height > 0 else { return 1 }
        let ratio = image.size.width / image.size.height
        return min(1.35, max(0.65, ratio))
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

private struct CommunityFeedHeader: View {
    let canPublish: Bool
    let action: () -> Void

    var body: some View {
        HStack(alignment: .center) {
            VStack(alignment: .leading, spacing: DS.Space.xxs) {
                Text("她的故事")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(Color.dsTextPrimary)
                Text("分享、被理解、被尊重")
                    .font(.system(size: 13))
                    .foregroundStyle(Color.dsTextSecondary)
            }
            Spacer()
            Button(action: action) {
                Label("发布笔记", systemImage: "square.and.pencil")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(canPublish ? Color.dsPrimary : Color.dsTextSecondary)
                    .padding(.horizontal, DS.Space.md)
                    .padding(.vertical, DS.Space.sm)
                    .background(Color.dsSurface, in: Capsule())
                    .overlay {
                        Capsule().stroke(Color.dsBorder, lineWidth: 1)
                    }
            }
            .disabled(!canPublish)
            .buttonStyle(DSPressButtonStyle())
        }
    }
}

private struct CommunityTopicFilterBar: View {
    let topics: [String]
    @Binding var selection: String

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: DS.Space.sm) {
                ForEach(topics, id: \.self) { topic in
                    Button {
                        selection = topic
                    } label: {
                        Text(topic)
                            .font(.system(size: 14, weight: selection == topic ? .semibold : .medium))
                            .foregroundStyle(selection == topic ? Color.dsSurface : Color.dsTextPrimary)
                            .padding(.horizontal, DS.Space.md)
                            .frame(height: 34)
                            .background(selection == topic ? Color.dsPrimary : Color.dsSurface, in: Capsule())
                            .overlay {
                                if selection != topic {
                                    Capsule().stroke(Color.dsBorder, lineWidth: 1)
                                }
                            }
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .accessibilityIdentifier("communityTopicFilterBar")
    }
}

private struct CommunityMasonryGrid: View {
    let posts: [CommunityPost]

    private var splitPosts: ([CommunityPost], [CommunityPost]) {
        var leftPosts: [CommunityPost] = []
        var rightPosts: [CommunityPost] = []
        var leftHeight: Double = 0
        var rightHeight: Double = 0

        for post in posts {
            let height = estimatedHeight(for: post)
            if leftHeight <= rightHeight {
                leftPosts.append(post)
                leftHeight += height
            } else {
                rightPosts.append(post)
                rightHeight += height
            }
        }

        return (leftPosts, rightPosts)
    }

    var body: some View {
        let columns = splitPosts

        HStack(alignment: .top, spacing: DS.Space.sm) {
            LazyVStack(spacing: DS.Space.sm) {
                ForEach(columns.0) { post in
                    CommunityPostCard(post: post)
                }
            }
            LazyVStack(spacing: DS.Space.sm) {
                ForEach(columns.1) { post in
                    CommunityPostCard(post: post)
                }
            }
        }
    }

    private func estimatedHeight(for post: CommunityPost) -> Double {
        let ratio = max(0.65, min(1.35, post.coverAspectRatio ?? CommunityPostCoverView.placeholderAspectRatio(for: post.topic)))
        let coverHeight = 160 / ratio
        let textHeight = post.content.count > 36 ? 58.0 : 38.0
        return coverHeight + textHeight + 52
    }
}

private struct CommunityPostCard: View {
    let post: CommunityPost

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            CommunityPostCoverView(post: post)

            VStack(alignment: .leading, spacing: DS.Space.sm) {
                Text(post.content)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Color.dsTextPrimary)
                    .lineSpacing(2)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)

                HStack(spacing: DS.Space.xxs) {
                    authorBadge
                    Text(post.authorName)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(Color.dsTextSecondary)
                        .lineLimit(1)
                    Spacer(minLength: DS.Space.xxs)
                    Label("\(post.likeCount)", systemImage: "heart")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(Color.dsTextSecondary)
                        .labelStyle(.titleAndIcon)
                }
            }
            .padding(DS.Space.sm)
        }
        .background(Color.dsSurface, in: RoundedRectangle(cornerRadius: DS.Radius.sm, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: DS.Radius.sm, style: .continuous)
                .stroke(Color.dsBorder, lineWidth: 1)
        }
        .clipShape(RoundedRectangle(cornerRadius: DS.Radius.sm, style: .continuous))
    }

    private var authorBadge: some View {
        ZStack {
            Circle()
                .fill(Color.dsPrimary.opacity(0.12))
            Text(post.authorInitials.prefix(1))
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(Color.dsPrimary)
        }
        .frame(width: 20, height: 20)
    }
}

private struct CommunityPostCoverView: View {
    let post: CommunityPost

    static func placeholderAspectRatio(for topic: String) -> Double {
        switch topic {
        case "情绪倾听": 0.82
        case "睡前聊天": 1.0
        case "职场减压": 0.72
        case "陪伴故事": 1.18
        default: 0.9
        }
    }

    private var aspectRatio: CGFloat {
        CGFloat(post.coverAspectRatio ?? Self.placeholderAspectRatio(for: post.topic))
    }

    var body: some View {
        ZStack(alignment: .topTrailing) {
            cover
            if post.moderationStatus != .approved {
                statusBadge
                    .padding(DS.Space.sm)
            }
        }
        .aspectRatio(aspectRatio, contentMode: .fit)
        .frame(maxWidth: .infinity)
        .clipped()
    }

    @ViewBuilder
    private var cover: some View {
        if let coverImageData = post.coverImageData, let uiImage = UIImage(data: coverImageData) {
            Image(uiImage: uiImage)
                .resizable()
                .scaledToFill()
        } else {
            ZStack {
                Color.dsPrimary.opacity(0.10)
                VStack(spacing: DS.Space.sm) {
                    Image(systemName: icon(for: post.topic))
                        .font(.system(size: 26, weight: .regular))
                        .foregroundStyle(Color.dsPrimary)
                    Text(post.topic)
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(Color.dsTextPrimary)
                        .multilineTextAlignment(.center)
                        .lineLimit(2)
                        .padding(.horizontal, DS.Space.sm)
                }
                .padding(DS.Space.sm)
            }
        }
    }

    @ViewBuilder
    private var statusBadge: some View {
        switch post.moderationStatus {
        case .approved:
            EmptyView()
        case .pending:
            TrustMicroBadge(text: "审核中", tone: .warning)
        case .rejected:
            TrustMicroBadge(text: "未通过", tone: .danger)
        }
    }

    private func icon(for topic: String) -> String {
        switch topic {
        case "情绪倾听": "heart.text.square"
        case "陪伴故事": "bubble.left.and.bubble.right"
        case "职场减压": "briefcase"
        case "睡前聊天": "moon.stars"
        default: "sparkles"
        }
    }
}
