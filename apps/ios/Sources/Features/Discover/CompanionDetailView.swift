import SwiftUI

struct CompanionDetailView: View {
    let companionId: String
    @EnvironmentObject private var store: AppStore
    @Environment(\.dismiss) private var dismiss
    @State private var showingReport = false
    @State private var reportReason = "资料不实"

    private var companion: Companion? {
        store.companion(by: companionId)
    }

    var body: some View {
        ZStack {
            AppBackground()
            if let companion {
                ScrollView {
                    VStack(spacing: DS.Space.lg) {
                        ProfileHero(companion: companion, showingReport: $showingReport)
                        CertificationStatusCard(companion: companion)
                        BoundaryNotice()
                        BioPanel(companion: companion)
                        ReviewPreview(companion: companion)
                    }
                    .padding(DS.Space.lg)
                    .padding(.bottom, DS.Space.xl)
                }
                .safeAreaInset(edge: .bottom) {
                    BottomActionBar(companion: companion)
                }
            } else {
                EmptyStateView(
                    symbol: "person.crop.circle.badge.questionmark",
                    title: "陪伴者暂不可用",
                    subtitle: "这位陪伴者的信息暂时无法打开，可以返回继续看看其他人。",
                    actionTitle: "返回上一页",
                    action: { dismiss() }
                )
                .padding(DS.Space.lg)
            }
        }
        .navigationTitle("陪伴者详情")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Color.dsBackground.opacity(0.96), for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .sheet(isPresented: $showingReport) {
            ReportSheet(companionId: companionId, reason: $reportReason)
                .presentationDetents([.medium])
        }
    }
}

private struct ProfileHero: View {
    let companion: Companion
    @Binding var showingReport: Bool
    @EnvironmentObject private var store: AppStore

    var body: some View {
        SoftCard {
            VStack(alignment: .leading, spacing: DS.Space.lg) {
                HStack(alignment: .top, spacing: DS.Space.lg) {
                    CompanionAvatar(companion: companion, size: 72)
                    VStack(alignment: .leading, spacing: DS.Space.sm) {
                        HStack(alignment: .top, spacing: DS.Space.sm) {
                            VStack(alignment: .leading, spacing: DS.Space.sm) {
                                HStack(spacing: DS.Space.sm) {
                                    Text(companion.name)
                                        .font(.system(size: 22, weight: .semibold))
                                        .foregroundStyle(Color.dsTextPrimary)
                                    if companion.isVerified {
                                        Image(systemName: "checkmark.seal.fill")
                                            .foregroundStyle(Color.dsPrimary)
                                    }
                                }
                                Text(companion.role)
                                    .font(.system(size: 13))
                                    .foregroundStyle(Color.dsTextSecondary)
                            }
                            Spacer(minLength: DS.Space.sm)
                            HStack(spacing: DS.Space.xxs) {
                                DSButton(title: "主页", systemImage: "person.crop.square", variant: .secondary, maxWidth: 76, height: 36) {
                                    store.navigate(.companionHomepage(companion.id))
                                }
                                .accessibilityLabel("进入主页")

                                DSIconButton(systemImage: "exclamationmark.bubble", size: 36) {
                                    showingReport = true
                                }
                                .accessibilityLabel("举报")
                            }
                        }
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: DS.Space.sm) {
                                AvailabilityBadge(status: companion.availability)
                                DistanceLabel(distanceKm: companion.distanceKm, district: companion.cityDistrict)
                                StatusPill(text: String(format: "%.1f", companion.rating), symbol: "star.fill", color: Color.dsWarning)
                                TrustMicroBadge(text: companion.isVerified ? "已认证" : "未认证", tone: companion.isVerified ? .success : .warning)
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
                    MetricTile(title: "完成", value: "\(companion.completedOrders)")
                    MetricTile(title: "响应", value: companion.responseTime)
                    MetricTile(title: "价格", value: "¥\(companion.pricePerHalfHour)/30m")
                }
            }
        }
    }
}

private struct CertificationStatusCard: View {
    let companion: Companion

    var body: some View {
        DSBanner(
            title: companion.isVerified ? "平台认证已完成" : "认证信息待完善",
            message: companion.isVerified ? "身份与服务资料已通过平台核验。" : "建议先试聊了解边界，必要时选择已认证陪伴者。",
            systemImage: companion.isVerified ? "checkmark.seal.fill" : "person.badge.key",
            tone: companion.isVerified ? .success : .warning
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(companion.isVerified ? "已完成平台认证" : "暂未完成平台认证")
    }
}

private struct MetricTile: View {
    let title: String
    let value: String

    var body: some View {
        DSInsetSurface(padding: DS.Space.md) {
            VStack(spacing: DS.Space.xxs) {
                Text(value)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Color.dsTextPrimary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
                Text(title)
                    .font(.system(size: 11))
                    .foregroundStyle(Color.dsTextSecondary)
            }
            .frame(maxWidth: .infinity)
        }
        .frame(maxWidth: .infinity)
    }
}

private struct BoundaryNotice: View {
    var body: some View {
        DSBanner(
            title: "平台内安全沟通",
            message: "仅支持平台内文字与语音沟通；不接受线下邀约、私下转账、敏感交易和医疗诊断承诺。",
            systemImage: "lock.shield.fill",
            tone: .warning
        )
    }
}

private struct BioPanel: View {
    let companion: Companion

    var body: some View {
        SoftCard {
            VStack(alignment: .leading, spacing: DS.Space.lg) {
                SectionHeader(title: "介绍与可约时间")
                Text(companion.bio)
                    .font(.system(size: 13))
                    .foregroundStyle(Color.dsTextSecondary)
                    .lineSpacing(4)
                VStack(alignment: .leading, spacing: DS.Space.sm) {
                    Label(companion.languages.joined(separator: " / "), systemImage: "globe.asia.australia")
                    Label(companion.availableTimes.joined(separator: "  "), systemImage: "clock")
                    Label(companion.specialties.joined(separator: " / "), systemImage: "tag")
                }
                .font(.system(size: 13))
                .foregroundStyle(Color.dsTextPrimary)
            }
        }
    }
}

private struct ReviewPreview: View {
    let companion: Companion
    @EnvironmentObject private var store: AppStore

    var body: some View {
        SoftCard {
            VStack(alignment: .leading, spacing: DS.Space.md) {
                SectionHeader(title: "近期评价", subtitle: "\(companion.reviewCount) 条历史评价")
                ForEach(store.reviews(for: companion.id).prefix(3)) { review in
                    DSInsetSurface(padding: DS.Space.md) {
                        VStack(alignment: .leading, spacing: DS.Space.sm) {
                            HStack {
                                Text(review.userName)
                                    .font(.system(size: 15, weight: .semibold))
                                Spacer()
                                StatusPill(text: "\(review.rating)", symbol: "star.fill", color: Color.dsWarning)
                            }
                            Text(review.content)
                                .font(.system(size: 13))
                                .foregroundStyle(Color.dsTextSecondary)
                        }
                    }
                }
            }
        }
    }
}

private struct ReportSheet: View {
    let companionId: String
    @Binding var reason: String
    @EnvironmentObject private var store: AppStore
    @Environment(\.dismiss) private var dismiss

    private let reasons = ["资料不实", "诱导私聊", "不当内容", "其他风险"]

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: DS.Space.lg) {
                Text("平台安全团队会认真处理。")
                    .font(.system(size: 13))
                    .foregroundStyle(Color.dsTextSecondary)
                Picker("原因", selection: $reason) {
                    ForEach(reasons, id: \.self) { Text($0) }
                }
                .pickerStyle(.inline)
                DSPrimaryButton(title: "提交举报", systemImage: "paperplane") {
                    store.report(companionId: companionId, reason: reason)
                    dismiss()
                }
                Spacer()
            }
            .padding(DS.Space.lg)
            .background(Color.dsBackground)
            .navigationTitle("举报")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}
