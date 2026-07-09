import PhotosUI
import SwiftUI
import UIKit

struct CommunityView: View {
    @EnvironmentObject private var store: AppStore
    @State private var composingKind: CommunityPostKind?
    @State private var topic = "情绪倾听"
    @State private var selectedTopic = "全部"
    @State private var content = ""

    private var topicFilters: [String] {
        ["全部", "情绪倾听", "陪伴故事", "职场减压", "睡前聊天"]
    }

    private var browsingKind: CommunityPostKind {
        switch store.user.gender {
        case .female: .malePromotion
        case .male: .femaleRequest
        case nil: .malePromotion
        }
    }

    private var publishingKind: CommunityPostKind? {
        switch store.user.gender {
        case .female: .femaleRequest
        case .male: .malePromotion
        case nil: nil
        }
    }

    private var approvedPosts: [CommunityPost] {
        store.approvedCommunityPosts().filter { $0.kind == browsingKind }
    }

    private var reviewPosts: [CommunityPost] {
        store.communityPosts
            .filter { $0.authorId == store.user.id && $0.moderationStatus != .approved }
            .sorted { $0.createdAt > $1.createdAt }
    }

    private var filteredApprovedPosts: [CommunityPost] {
        guard selectedTopic != "全部" else { return approvedPosts }
        return approvedPosts.filter { $0.topic == selectedTopic }
    }

    private var canStartPublishFlow: Bool {
        store.accountRestrictions.canPostCommunity && publishingKind != nil
    }

    var body: some View {
        AppScaffold(title: "广场", spacing: DS.Space.lg) {
            SquareHeroHeader(
                browsingText: browsingText,
                publishTitle: publishTitle,
                canPublish: canStartPublishFlow,
                restrictionText: store.accountRestrictions.canPostCommunity ? nil : store.accountRestrictions.summary,
                pendingCount: reviewPosts.count,
                action: startPublishing
            )

            if !reviewPosts.isEmpty {
                SquareReviewSection(posts: reviewPosts)
            }

            SectionHeader(title: "广场动态", subtitle: feedSubtitle)
            CommunityTopicFilterBar(topics: topicFilters, selection: $selectedTopic)

            feedContent
        }
        .sheet(item: $composingKind) { kind in
            ComposeStorySheet(
                kind: kind,
                topic: $topic,
                content: $content
            )
        }
    }

    @ViewBuilder
    private var feedContent: some View {
        if approvedPosts.isEmpty && reviewPosts.isEmpty {
            SquareEmptyState(
                title: "广场还在等第一条声音",
                subtitle: "可以先说说此刻想聊的事，也可以稍后回来看看。",
                primaryTitle: publishTitle,
                primaryAction: startPublishing,
                secondaryTitle: nil,
                secondaryAction: nil,
                isPrimaryEnabled: canStartPublishFlow
            )
        } else if filteredApprovedPosts.isEmpty {
            SquareEmptyState(
                title: "这个话题暂时安静",
                subtitle: "换个话题看看，或者发一条让合适的人看见。",
                primaryTitle: "查看全部话题",
                primaryAction: { selectedTopic = "全部" },
                secondaryTitle: publishTitle,
                secondaryAction: startPublishing,
                isPrimaryEnabled: true
            )
        } else {
            CommunityMasonryGrid(posts: filteredApprovedPosts)
        }
    }

    private var browsingText: String {
        switch browsingKind {
        case .femaleRequest:
            return "正在寻找陪伴的人"
        case .malePromotion:
            return "已实名陪伴者"
        }
    }

    private var feedSubtitle: String {
        switch browsingKind {
        case .femaleRequest:
            return "看看谁正在寻找平台内沟通"
        case .malePromotion:
            return "按你的身份展示更适合的陪伴者"
        }
    }

    private var publishTitle: String {
        switch publishingKind {
        case .femaleRequest:
            return "发布需求"
        case .malePromotion:
            return store.user.isVerified ? "发布自荐" : "先认证再发布"
        case nil:
            return "发布"
        }
    }

    private func startPublishing() {
        guard store.accountRestrictions.canPostCommunity else { return }
        guard let publishingKind else { return }
        topic = defaultTopic(for: publishingKind)

        switch publishingKind {
        case .femaleRequest:
            composingKind = .femaleRequest
        case .malePromotion:
            if store.user.isVerified {
                composingKind = .malePromotion
            } else {
                store.navigate(.verify)
            }
        }
    }

    private func defaultTopic(for kind: CommunityPostKind) -> String {
        switch kind {
        case .femaleRequest: "情绪倾听"
        case .malePromotion: "情绪倾听"
        }
    }
}

private struct ComposeStorySheet: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.dismiss) private var dismiss
    let kind: CommunityPostKind
    @Binding var topic: String
    @Binding var content: String

    @State private var selectedPhotoItem: PhotosPickerItem?
    @State private var coverImageData: Data?
    @State private var coverAspectRatio: Double?
    @State private var isSubmitting = false
    @State private var feedbackMessage: String?

    private var topics: [String] {
        ["情绪倾听", "陪伴故事", "职场减压", "睡前聊天"]
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: DS.Space.lg) {
                    introBanner
                    if kind == .malePromotion {
                        coverPicker
                    }
                    topicPicker
                    storyEditor
                    if let feedbackMessage {
                        DSBanner(
                            title: feedbackMessage,
                            systemImage: "exclamationmark.triangle.fill",
                            tone: .warning
                        )
                    }
                    DSPrimaryButton(
                        title: isSubmitting ? "正在确认..." : submitTitle,
                        systemImage: "paperplane",
                        isEnabled: !trimmedContent.isEmpty && !isSubmitting,
                        isLoading: isSubmitting,
                        action: submitPost
                    )
                    .accessibilityLabel(submitTitle)
                    .accessibilityIdentifier("communityComposeSubmit")
                }
                .padding(DS.Space.lg)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(Color.dsBackground)
            .navigationTitle(navigationTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("关闭") { dismiss() }
                        .accessibilityIdentifier("communityComposeClose")
                }
            }
        }
        .accessibilityIdentifier("communityComposeSheet")
        .task(id: selectedPhotoItem) {
            await loadSelectedCover()
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    private var trimmedContent: String {
        content.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var navigationTitle: String {
        switch kind {
        case .femaleRequest: "发一条需求"
        case .malePromotion: "发布自荐"
        }
    }

    private var submitTitle: String {
        switch kind {
        case .femaleRequest: "发布到广场"
        case .malePromotion: "发布自荐"
        }
    }

    private var contentLabel: String {
        switch kind {
        case .femaleRequest: "想说的话"
        case .malePromotion: "自荐介绍"
        }
    }

    private var contentPlaceholder: String {
        switch kind {
        case .femaleRequest:
            return "说说你想聊什么、希望对方怎样陪伴，以及你在意的边界。"
        case .malePromotion:
            return "介绍你的陪伴风格、擅长话题、可沟通时间和平台内服务边界。"
        }
    }

    private var introBanner: some View {
        DSBanner(
            title: kind == .femaleRequest ? "发布后会展示给合适的人" : "自荐会展示给合适的人",
            message: "发布后会出现在广场里；沟通始终留在平台内。",
            systemImage: "lock.shield",
            tone: .primary
        )
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
                        .clipShape(RoundedRectangle(cornerRadius: DS.Radius.md, style: .continuous))

                    Button(action: removeCover) {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 24, weight: .semibold))
                            .symbolRenderingMode(.palette)
                            .foregroundStyle(Color.dsSurface, Color.dsTextPrimary.opacity(0.72))
                            .padding(DS.Space.sm)
                    }
                    .accessibilityLabel("移除封面")
                    .accessibilityIdentifier("communityCoverRemove")
                }
            } else {
                PhotosPicker(selection: $selectedPhotoItem, matching: .images) {
                    VStack(spacing: DS.Space.sm) {
                        Image(systemName: "photo.on.rectangle.angled")
                            .font(.system(size: 26, weight: .regular))
                            .foregroundStyle(Color.dsPrimary)
                        Text("添加封面")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(Color.dsTextPrimary)
                        Text("不添加也可以发布")
                            .font(.system(size: 12))
                            .foregroundStyle(Color.dsTextSecondary)
                    }
                    .frame(maxWidth: .infinity)
                    .frame(height: 132)
                    .padding(DS.Space.lg)
                    .background(Color.dsSurfaceMuted.opacity(0.72), in: RoundedRectangle(cornerRadius: DS.Radius.md, style: .continuous))
                    .overlay {
                        RoundedRectangle(cornerRadius: DS.Radius.md, style: .continuous)
                            .stroke(Color.dsBorder.opacity(0.55), lineWidth: DS.Stroke.hairline)
                    }
                }
                .buttonStyle(.plain)
                .accessibilityLabel("添加发布封面")
                .accessibilityIdentifier("communityCoverPicker")
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
                    .accessibilityLabel("选择话题\(item)")
                    .accessibilityAddTraits(topic == item ? .isSelected : [])
                    .accessibilityIdentifier("communityComposeTopic-\(item)")
                }
            }
        }
    }

    private var storyEditor: some View {
        VStack(alignment: .leading, spacing: DS.Space.sm) {
            Text(contentLabel)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Color.dsTextSecondary)
            DSTextEditor(placeholder: contentPlaceholder, text: $content, minHeight: 150)
                .accessibilityLabel(contentLabel)
                .accessibilityHint(contentPlaceholder)
                .accessibilityIdentifier("communityComposeContent")
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
                kind: kind,
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
                dismiss()
            }
        }
    }

    private static func coverAspectRatio(for data: Data) -> Double {
        guard let image = UIImage(data: data), image.size.height > 0 else { return 1 }
        let ratio = image.size.width / image.size.height
        return min(1.35, max(0.65, ratio))
    }
}

private struct SquareHeroHeader: View {
    let browsingText: String
    let publishTitle: String
    let canPublish: Bool
    let restrictionText: String?
    let pendingCount: Int
    let action: () -> Void

    var body: some View {
        DSCard {
            VStack(alignment: .leading, spacing: DS.Space.lg) {
                HStack(alignment: .top, spacing: DS.Space.md) {
                    VStack(alignment: .leading, spacing: DS.Space.sm) {
                        DSBadge(text: "广场", tone: .primary)
                        Text("看看大家此刻想聊什么")
                            .font(.system(size: 22, weight: .semibold))
                            .foregroundStyle(Color.dsTextPrimary)
                            .fixedSize(horizontal: false, vertical: true)
                        Text("只展示适合你身份的内容，沟通留在平台内。")
                            .font(.system(size: 13))
                            .foregroundStyle(Color.dsTextSecondary)
                            .lineSpacing(3)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    Spacer(minLength: DS.Space.md)

                    DSInsetSurface(padding: DS.Space.md) {
                        VStack(spacing: DS.Space.xxs) {
                            Text("\(pendingCount)")
                                .font(.system(size: 22, weight: .semibold))
                                .foregroundStyle(Color.dsTextPrimary)
                            Text("发布中")
                                .font(.system(size: 11, weight: .medium))
                                .foregroundStyle(Color.dsTextSecondary)
                        }
                    }
                    .frame(width: 78)
                }

                HStack(spacing: DS.Space.sm) {
                    StatusPill(text: browsingText, symbol: "person.2", color: Color.dsPrimary)
                    StatusPill(text: "平台内沟通", symbol: "lock.shield", color: Color.dsTextSecondary)
                }

                if let restrictionText {
                    DSBanner(title: restrictionText, systemImage: "exclamationmark.triangle.fill", tone: .warning)
                }

                DSButton(
                    title: publishTitle,
                    systemImage: "square.and.pencil",
                    isEnabled: canPublish,
                    action: action
                )
                .accessibilityLabel(publishTitle)
                .accessibilityIdentifier("communityPublishButton")
            }
        }
    }
}

private struct SquareReviewSection: View {
    let posts: [CommunityPost]

    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.md) {
            SectionHeader(title: "我的发布", subtitle: "暂未展示的内容会先在这里显示")
            CommunityMasonryGrid(posts: posts)
        }
    }
}

private struct SquareEmptyState: View {
    let title: String
    let subtitle: String
    let primaryTitle: String
    let primaryAction: () -> Void
    let secondaryTitle: String?
    let secondaryAction: (() -> Void)?
    let isPrimaryEnabled: Bool

    var body: some View {
        DSCard(padding: DS.Space.xl) {
            VStack(spacing: DS.Space.md) {
                DSInitialsAvatar(initials: "", tone: .neutral, size: 56)
                    .overlay {
                        Image(systemName: "text.bubble")
                            .font(.system(size: 24, weight: .regular))
                            .foregroundStyle(Color.dsPrimary)
                    }

                VStack(spacing: DS.Space.xxs) {
                    Text(title)
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(Color.dsTextPrimary)
                    Text(subtitle)
                        .font(.system(size: 13))
                        .foregroundStyle(Color.dsTextSecondary)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                }

                HStack(spacing: DS.Space.sm) {
                    DSButton(title: primaryTitle, isEnabled: isPrimaryEnabled, action: primaryAction)
                    if let secondaryTitle, let secondaryAction {
                        DSButton(title: secondaryTitle, variant: .secondary, maxWidth: 118, action: secondaryAction)
                    }
                }
            }
            .frame(maxWidth: .infinity)
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
                    TagChip(title: topic, isSelected: selection == topic) {
                        selection = topic
                    }
                    .accessibilityLabel("广场话题\(topic)")
                    .accessibilityAddTraits(selection == topic ? .isSelected : [])
                    .accessibilityIdentifier("communityTopic-\(topic)")
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
        let textHeight = post.content.count > 54 ? 72.0 : 48.0
        let statusHeight = post.moderationStatus == .approved ? 0 : 34.0
        let actionHeight = post.contactTarget == nil || post.moderationStatus != .approved ? 0 : 38.0
        return coverHeight + textHeight + statusHeight + actionHeight + 82
    }
}

private struct CommunityPostCard: View {
    let post: CommunityPost
    @EnvironmentObject private var store: AppStore

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            CommunityPostCoverView(post: post)
                .contentShape(Rectangle())
                .onTapGesture {
                    openDetailIfAvailable()
                }

            VStack(alignment: .leading, spacing: DS.Space.sm) {
                HStack(spacing: DS.Space.xxs) {
                    DSBadge(text: post.topic, tone: .primary)
                    if post.moderationStatus != .approved {
                        statusBadge
                    }
                }

                Text(post.content)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Color.dsTextPrimary)
                    .lineSpacing(2)
                    .lineLimit(3)
                    .fixedSize(horizontal: false, vertical: true)
                    .contentShape(Rectangle())
                    .onTapGesture {
                        openDetailIfAvailable()
                    }

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

                if post.moderationStatus != .approved {
                    Text(statusMessage)
                        .font(.system(size: 11))
                        .foregroundStyle(Color.dsTextSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }

                if shouldShowContactActions {
                    contactActions
                }
            }
            .padding(DS.Space.sm)
        }
        .background(Color.dsSurfaceElevated, in: RoundedRectangle(cornerRadius: DS.Radius.sm, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: DS.Radius.sm, style: .continuous)
                .stroke(Color.dsBorder.opacity(0.72), lineWidth: DS.Stroke.hairline)
        }
        .clipShape(RoundedRectangle(cornerRadius: DS.Radius.sm, style: .continuous))
    }

    private var authorBadge: some View {
        DSInitialsAvatar(initials: String(post.authorInitials.prefix(1)), tone: .primary, size: 20)
    }

    private var statusBadge: some View {
        DSBadge(text: statusText, tone: post.moderationStatus == .pending ? .warning : .danger)
    }

    private var statusMessage: String {
        switch post.moderationStatus {
        case .approved:
            return ""
        case .pending:
            return "发布后会进入广场。"
        case .rejected:
            return "这条内容暂时没有发布，可以调整后再试。"
        }
    }

    private var shouldShowContactActions: Bool {
        post.moderationStatus == .approved && post.contactTarget != nil
    }

    private var statusText: String {
        switch post.moderationStatus {
        case .approved:
            return "已发布"
        case .pending:
            return "发布中"
        case .rejected:
            return "未发布"
        }
    }

    @ViewBuilder
    private var contactActions: some View {
        if let target = post.contactTarget {
            HStack(spacing: DS.Space.xxs) {
                DSButton(
                    title: "聊聊",
                    systemImage: "bubble.left.and.bubble.right",
                    variant: .secondary,
                    maxWidth: .infinity,
                    height: 32
                ) {
                    store.navigate(.chat(target))
                }
                .accessibilityIdentifier("communityPostChat-\(post.id)")

                if case .companion(let id) = target {
                    DSButton(
                        title: "看详情",
                        systemImage: "person.crop.circle",
                        maxWidth: .infinity,
                        height: 32
                    ) {
                        store.navigate(.companionDetail(id))
                    }
                    .accessibilityIdentifier("communityPostDetail-\(post.id)")
                }
            }
        }
    }

    private func openDetailIfAvailable() {
        guard let target = post.contactTarget else { return }
        if case .companion(let id) = target {
            store.navigate(.companionDetail(id))
        }
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
            TrustMicroBadge(text: "发布中", tone: .warning)
        case .rejected:
            TrustMicroBadge(text: "未发布", tone: .danger)
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
