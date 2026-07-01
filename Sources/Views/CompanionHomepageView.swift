import SwiftUI
import UIKit

struct CompanionHomepageView: View {
    let companionId: String
    @EnvironmentObject private var store: AppStore

    private var companion: Companion? {
        store.companion(by: companionId)
    }

    private var promotionPosts: [CommunityPost] {
        store.approvedCommunityPosts()
            .filter { post in
                guard post.kind == .malePromotion else { return false }
                guard case .companion(let id)? = post.contactTarget else { return false }
                return id == companionId
            }
            .sorted { $0.createdAt > $1.createdAt }
    }

    var body: some View {
        ZStack {
            AppBackground()
            if let companion {
                ScrollView {
                    VStack(alignment: .leading, spacing: DS.Space.lg) {
                        CompanionHomepageHero(companion: companion)
                        CompanionPromotionSection(posts: promotionPosts)
                    }
                    .padding(DS.Space.lg)
                    .padding(.bottom, DS.Space.xl)
                }
            } else {
                EmptyStateView(
                    symbol: "person.crop.circle.badge.questionmark",
                    title: "主页不存在",
                    subtitle: "这位陪伴者可能已经下架或演示数据已刷新。"
                )
                .padding(DS.Space.lg)
            }
        }
        .navigationTitle("主页")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Color.dsBackground.opacity(0.96), for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
    }
}

private struct CompanionHomepageHero: View {
    let companion: Companion

    var body: some View {
        SoftCard {
            VStack(alignment: .leading, spacing: DS.Space.lg) {
                HStack(alignment: .top, spacing: DS.Space.lg) {
                    CompanionAvatar(companion: companion, size: 76)
                    VStack(alignment: .leading, spacing: DS.Space.sm) {
                        HStack(spacing: DS.Space.sm) {
                            Text(companion.name)
                                .font(.system(size: 24, weight: .semibold))
                                .foregroundStyle(Color.dsTextPrimary)
                                .lineLimit(1)
                                .minimumScaleFactor(0.8)
                            if companion.isVerified {
                                Image(systemName: "checkmark.seal.fill")
                                    .font(.system(size: 18, weight: .semibold))
                                    .foregroundStyle(Color.dsPrimary)
                            }
                        }
                        Text(companion.role)
                            .font(.system(size: 14))
                            .foregroundStyle(Color.dsTextSecondary)
                            .lineLimit(1)
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: DS.Space.sm) {
                                AvailabilityBadge(status: companion.availability)
                                TrustMicroBadge(text: "主页认证", tone: .primary)
                                StatusPill(text: String(format: "%.1f", companion.rating), symbol: "star.fill", color: Color.dsWarning)
                            }
                        }
                    }
                }

                FlowLayout(spacing: DS.Space.sm) {
                    ForEach(companion.tags, id: \.self) { tag in
                        TagChip(title: tag)
                    }
                }

                HStack(spacing: DS.Space.md) {
                    HomepageMetricTile(title: "完成", value: "\(companion.completedOrders)")
                    HomepageMetricTile(title: "响应", value: companion.responseTime)
                    HomepageMetricTile(title: "价格", value: "¥\(companion.pricePerHalfHour)/30m")
                }
            }
        }
    }
}

private struct CompanionPromotionSection: View {
    let posts: [CommunityPost]

    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.md) {
            SectionHeader(title: "主页动态", subtitle: "已审核的宣传帖子")
            if posts.isEmpty {
                SoftCard {
                    EmptyStateView(
                        symbol: "sparkles.rectangle.stack",
                        title: "还没有主页动态",
                        subtitle: "对方暂时没有发布宣传帖子，可以先从详情页发起试聊。"
                    )
                }
            } else {
                LazyVStack(spacing: DS.Space.md) {
                    ForEach(posts) { post in
                        HomepagePromotionCard(post: post)
                    }
                }
            }
        }
    }
}

private struct HomepagePromotionCard: View {
    let post: CommunityPost
    @EnvironmentObject private var store: AppStore

    var body: some View {
        SoftCard(padding: DS.Space.md) {
            VStack(alignment: .leading, spacing: DS.Space.md) {
                promotionCover

                VStack(alignment: .leading, spacing: DS.Space.sm) {
                    HStack(spacing: DS.Space.sm) {
                        TrustMicroBadge(text: post.topic, tone: .primary)
                        Spacer(minLength: DS.Space.sm)
                        Label("\(post.likeCount)", systemImage: "heart")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(Color.dsTextSecondary)
                    }

                    Text(post.content)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Color.dsTextPrimary)
                        .lineSpacing(3)
                        .fixedSize(horizontal: false, vertical: true)
                }

                if let target = post.contactTarget {
                    HStack(spacing: DS.Space.sm) {
                        Button {
                            store.navigate(.chat(target))
                        } label: {
                            Label("聊天", systemImage: "bubble.left.and.bubble.right")
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(Color.dsPrimary)
                                .frame(maxWidth: .infinity)
                                .frame(height: 40)
                                .background(Color.dsBackground.opacity(0.86), in: RoundedRectangle(cornerRadius: DS.Radius.md, style: .continuous))
                                .overlay {
                                    RoundedRectangle(cornerRadius: DS.Radius.md, style: .continuous)
                                        .stroke(Color.dsBorder, lineWidth: 1)
                                }
                        }
                        .buttonStyle(DSPressButtonStyle())
                        .accessibilityIdentifier("homepagePostChat-\(post.id)")

                        if case .companion(let id) = target {
                            Button {
                                store.navigate(.order(id))
                            } label: {
                                Label("下单", systemImage: "creditcard")
                                    .font(.system(size: 13, weight: .semibold))
                                    .foregroundStyle(Color.dsSurface)
                                    .frame(maxWidth: .infinity)
                                    .frame(height: 40)
                                    .background(Color.dsPrimary, in: RoundedRectangle(cornerRadius: DS.Radius.md, style: .continuous))
                            }
                            .buttonStyle(DSPressButtonStyle())
                            .accessibilityIdentifier("homepagePostOrder-\(post.id)")
                        }
                    }
                }
            }
        }
    }

    private var promotionCover: some View {
        ZStack {
            if let coverImageData = post.coverImageData, let uiImage = UIImage(data: coverImageData) {
                Image(uiImage: uiImage)
                    .resizable()
                    .scaledToFill()
            } else {
                LinearGradient(
                    colors: [Color.dsPrimary.opacity(0.14), Color.dsHeroBottom.opacity(0.42)],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
                VStack(spacing: DS.Space.sm) {
                    Image(systemName: icon(for: post.topic))
                        .font(.system(size: 28, weight: .regular))
                        .foregroundStyle(Color.dsPrimary)
                    Text(post.topic)
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(Color.dsTextPrimary)
                }
                .padding(DS.Space.lg)
            }
        }
        .aspectRatio(CGFloat(post.coverAspectRatio ?? placeholderAspectRatio(for: post.topic)), contentMode: .fit)
        .frame(maxWidth: .infinity)
        .clipShape(RoundedRectangle(cornerRadius: DS.Radius.sm, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: DS.Radius.sm, style: .continuous)
                .stroke(Color.dsBorder, lineWidth: 1)
        }
    }

    private func placeholderAspectRatio(for topic: String) -> Double {
        switch topic {
        case "情绪倾听": 0.82
        case "睡前聊天": 1.0
        case "职场减压": 0.72
        case "陪伴故事": 1.18
        default: 0.9
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

private struct HomepageMetricTile: View {
    let title: String
    let value: String

    var body: some View {
        VStack(spacing: DS.Space.xxs) {
            Text(value)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Color.dsTextPrimary)
                .lineLimit(1)
                .minimumScaleFactor(0.72)
            Text(title)
                .font(.system(size: 11))
                .foregroundStyle(Color.dsTextSecondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, DS.Space.md)
        .background(Color.dsBackground, in: RoundedRectangle(cornerRadius: DS.Radius.sm, style: .continuous))
    }
}
