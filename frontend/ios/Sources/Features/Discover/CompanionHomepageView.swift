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

    private var companionReviews: [Review] {
        store.reviews(for: companionId)
            .sorted { $0.createdAt > $1.createdAt }
    }

    var body: some View {
        ZStack {
            AppBackground()
            if let companion {
                ScrollView {
                    VStack(alignment: .leading, spacing: DS.Space.lg) {
                        CompanionHomepageHero(companion: companion)
                        CompanionHomepageAboutCard(companion: companion)
                        CompanionHomepageReviewsSection(reviews: companionReviews, reviewCount: companionReviews.count)
                        CompanionPromotionSection(posts: promotionPosts)
                    }
                    .padding(DS.Space.lg)
                    .padding(.bottom, DS.Space.xl)
                }
            } else {
                EmptyStateView(
                    symbol: "person.crop.circle.badge.questionmark",
                    title: "主页不存在",
                    subtitle: "该主页暂不可用。"
                )
                .padding(DS.Space.lg)
            }
        }
        .navigationTitle("主页")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Color.dsBackground.opacity(0.96), for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .task(id: companionId) {
            async let detail: Void = store.loadCompanionDetail(id: companionId)
            async let reviews: Void = store.loadReviews(companionId: companionId)
            async let posts: Void = store.loadCommunityPosts()
            _ = await (detail, reviews, posts)
        }
    }
}

private struct CompanionHomepageHero: View {
    let companion: Companion
    @EnvironmentObject private var store: AppStore

    var body: some View {
        SoftCard {
            VStack(alignment: .leading, spacing: DS.Space.lg) {
                HStack(alignment: .top, spacing: DS.Space.lg) {
                    CompanionAvatar(companion: companion, size: 82)

                    VStack(alignment: .leading, spacing: DS.Space.sm) {
                        VStack(alignment: .leading, spacing: DS.Space.xxs) {
                            HStack(alignment: .firstTextBaseline, spacing: DS.Space.sm) {
                                Text(companion.name)
                                    .font(.system(size: 25, weight: .semibold))
                                    .foregroundStyle(Color.dsTextPrimary)
                                    .lineLimit(1)
                                    .minimumScaleFactor(0.78)

                                if companion.isVerified {
                                    Image(systemName: "checkmark.seal.fill")
                                        .font(.system(size: 17, weight: .semibold))
                                        .foregroundStyle(Color.dsPrimary)
                                        .accessibilityLabel("已认证")
                                }
                            }

                            Text(companion.role)
                                .font(.system(size: 14))
                                .foregroundStyle(Color.dsTextSecondary)
                                .lineLimit(2)
                        }
                    }
                }

                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: DS.Space.sm) {
                        AvailabilityBadge(status: companion.availability)
                        TrustMicroBadge(text: companion.isVerified ? "资料已核验" : "可先试聊", tone: companion.isVerified ? .success : .warning)
                        StatusPill(text: String(format: "%.1f", companion.rating), symbol: "star.fill", color: Color.dsWarning)
                        StatusPill(text: companion.responseTime, symbol: "bolt.fill", color: Color.dsPrimary)
                        Text("\(companion.cityDistrict) · \(distanceText)")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(Color.dsTextSecondary)
                            .padding(.horizontal, DS.Space.sm)
                            .padding(.vertical, DS.Space.xxs)
                            .background(Color.dsSurfaceElevated, in: Capsule())
                            .overlay(Capsule().stroke(Color.dsBorder.opacity(0.74), lineWidth: DS.Stroke.hairline))
                    }
                }

                FlowLayout(spacing: DS.Space.sm) {
                    ForEach(companion.tags, id: \.self) { tag in
                        TagChip(title: tag)
                    }
                }

                HStack(spacing: DS.Space.md) {
                    HomepageMetricTile(title: "沟通过", value: "\(companion.completedOrders) 单")
                    HomepageMetricTile(title: "评价", value: "\(companion.reviewCount) 条")
                    HomepageMetricTile(title: "价格", value: "¥\(companion.pricePerHalfHour)/30m")
                }

                HStack(spacing: DS.Space.sm) {
                    DSButton(title: "和 Ta 聊聊", systemImage: "bubble.left.and.bubble.right", variant: .primary) {
                        store.navigate(.chat(.companion(id: companion.id)))
                    }
                    .accessibilityIdentifier("homepageHeroChat-\(companion.id)")

                    DSButton(title: "预约沟通", systemImage: "calendar.badge.plus", variant: .secondary, maxWidth: 118) {
                        store.navigate(.order(companion.id))
                    }
                    .accessibilityIdentifier("homepageHeroOrder-\(companion.id)")
                }
            }
        }
    }

    private var distanceText: String {
        companion.distanceKm < 1
            ? String(format: "%.0fm", companion.distanceKm * 1000)
            : String(format: "%.1fkm", companion.distanceKm)
    }
}

private struct CompanionHomepageAboutCard: View {
    let companion: Companion

    var body: some View {
        SoftCard {
            VStack(alignment: .leading, spacing: DS.Space.lg) {
                SectionHeader(title: "关于 Ta", subtitle: "适合聊的方向和沟通方式")

                Text(companion.bio)
                    .font(.system(size: 14))
                    .foregroundStyle(Color.dsTextSecondary)
                    .lineSpacing(4)
                    .fixedSize(horizontal: false, vertical: true)

                VStack(alignment: .leading, spacing: DS.Space.sm) {
                    HomepageTrustLine(symbol: "checkmark.seal", text: companion.isVerified ? "资料已核验，沟通留在平台内" : "可以先试聊，确认合适再预约")
                    HomepageTrustLine(symbol: "clock", text: companion.availableTimes.joined(separator: " · "))
                    HomepageTrustLine(symbol: "globe.asia.australia", text: companion.languages.joined(separator: " / "))
                }

                VStack(alignment: .leading, spacing: DS.Space.sm) {
                    Text("擅长")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Color.dsTextSecondary)
                    FlowLayout(spacing: DS.Space.sm) {
                        ForEach(companion.specialties, id: \.self) { specialty in
                            TagChip(title: specialty)
                        }
                    }
                }
            }
        }
    }
}

private struct HomepageTrustLine: View {
    let symbol: String
    let text: String

    var body: some View {
        Label(text, systemImage: symbol)
            .font(.system(size: 13, weight: .medium))
            .foregroundStyle(Color.dsTextPrimary)
            .lineLimit(2)
            .fixedSize(horizontal: false, vertical: true)
    }
}

private struct CompanionPromotionSection: View {
    let posts: [CommunityPost]

    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.md) {
            SectionHeader(title: "最近动态", subtitle: "Ta 想分享的片段")
            if posts.isEmpty {
                SoftCard {
                    EmptyStateView(
                        symbol: "sparkles.rectangle.stack",
                        title: "还没有更新动态",
                        subtitle: "可以先发起试聊，看看你们聊起来是否合拍。"
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
                            Label("和 Ta 聊聊", systemImage: "bubble.left.and.bubble.right")
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
                                Label("预约这段时间", systemImage: "calendar.badge.plus")
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

private struct CompanionHomepageReviewsSection: View {
    let reviews: [Review]
    let reviewCount: Int

    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.md) {
            SectionHeader(title: "用户评价", subtitle: "\(reviewCount) 条历史评价")
            if reviews.isEmpty {
                SoftCard {
                    EmptyStateView(
                        symbol: "text.bubble",
                        title: "还没有评价",
                        subtitle: "可以先试聊几句，再决定要不要预约。"
                    )
                }
            } else {
                LazyVStack(spacing: DS.Space.md) {
                    ForEach(reviews) { review in
                        CompanionHomepageReviewCard(review: review)
                    }
                }
            }
        }
    }
}

private struct CompanionHomepageReviewCard: View {
    let review: Review

    var body: some View {
        SoftCard(padding: DS.Space.md) {
            VStack(alignment: .leading, spacing: DS.Space.sm) {
                HStack {
                    Text(review.userName)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Color.dsTextPrimary)
                    Spacer()
                    StarRatingRow(rating: review.rating)
                }

                Text(review.content)
                    .font(.system(size: 13))
                    .foregroundStyle(Color.dsTextSecondary)
                    .lineSpacing(3)
                    .lineLimit(3)
            }
        }
    }
}

private struct StarRatingRow: View {
    let rating: Int

    var body: some View {
        HStack(spacing: DS.Space.xxs) {
            ForEach(1...5, id: \.self) { star in
                Image(systemName: star <= rating ? "star.fill" : "star")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(star <= rating ? Color.dsWarning : Color.dsBorder)
            }
        }
    }
}
