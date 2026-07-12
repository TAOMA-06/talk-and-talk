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
                    DetailActionBar(companion: companion)
                }
            } else {
                detailFallback
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
        .task(id: companionId) {
            async let detail: Void = store.loadCompanionDetail(id: companionId)
            async let reviews: Void = store.loadReviews(companionId: companionId)
            _ = await (detail, reviews)
        }
    }

    @ViewBuilder
    private var detailFallback: some View {
        switch store.companionDetailLoadState(for: companionId) {
        case .loading:
            DSCard(padding: DS.Space.xl) {
                VStack(spacing: DS.Space.md) {
                    ProgressView()
                    Text("正在加载陪伴者详情")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(Color.dsTextSecondary)
                }
                .frame(maxWidth: .infinity)
            }
            .padding(DS.Space.lg)
            .accessibilityIdentifier("companionDetailLoading")
        case .failed(let message):
            EmptyStateView(
                symbol: "wifi.exclamationmark",
                title: "详情加载失败",
                subtitle: message,
                actionTitle: "重试",
                action: { Task { await store.loadCompanionDetail(id: companionId) } }
            )
            .padding(DS.Space.lg)
            .accessibilityIdentifier("companionDetailError")
        default:
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
}

private struct ProfileHero: View {
    let companion: Companion
    @Binding var showingReport: Bool
    @EnvironmentObject private var store: AppStore

    var body: some View {
        SoftCard {
            VStack(alignment: .leading, spacing: DS.Space.lg) {
                HStack(alignment: .top, spacing: DS.Space.lg) {
                    CompanionAvatar(companion: companion, size: 78)
                    VStack(alignment: .leading, spacing: DS.Space.sm) {
                        HStack(alignment: .top, spacing: DS.Space.sm) {
                            VStack(alignment: .leading, spacing: DS.Space.sm) {
                                HStack(alignment: .firstTextBaseline, spacing: DS.Space.sm) {
                                    Text(companion.name)
                                        .font(.system(size: 24, weight: .semibold))
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
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                            Spacer(minLength: DS.Space.sm)
                            HStack(spacing: DS.Space.xxs) {
                                DSButton(title: "主页", systemImage: "person.crop.square", variant: .secondary, maxWidth: 76, height: 36) {
                                    store.navigate(.companionHomepage(companion.id))
                                }
                                .accessibilityLabel("进入主页")
                                .accessibilityIdentifier("detailHomepage-\(companion.id)")

                                DSIconButton(systemImage: "exclamationmark.bubble", size: 36) {
                                    showingReport = true
                                }
                                .accessibilityLabel("举报")
                                .accessibilityIdentifier("detailReport-\(companion.id)")
                            }
                        }
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: DS.Space.sm) {
                                AvailabilityBadge(status: companion.availability)
                                DistanceLabel(distanceKm: companion.distanceKm, district: companion.cityDistrict)
                                StatusPill(text: String(format: "%.1f", companion.rating), symbol: "star.fill", color: Color.dsWarning)
                                TrustMicroBadge(text: companion.isVerified ? "资料已核验" : "先试聊了解", tone: companion.isVerified ? .success : .warning)
                            }
                        }
                    }
                }

                Text(companion.bio)
                    .font(.system(size: 14))
                    .foregroundStyle(Color.dsTextSecondary)
                    .lineSpacing(4)
                    .lineLimit(3)

                FlowLayout(spacing: DS.Space.sm) {
                    ForEach(companion.tags, id: \.self) { tag in
                        TagChip(title: tag)
                    }
                }

                HStack(spacing: DS.Space.md) {
                    MetricTile(title: "沟通过", value: "\(companion.completedOrders) 单")
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
            title: "认证与沟通方式",
            message: companion.isVerified ? "Ta 的资料已核验，文字和语音沟通都在平台内完成。" : "这位陪伴者还在完善资料，建议先试聊几句，确认合适再预约。",
            systemImage: companion.isVerified ? "checkmark.seal.fill" : "person.badge.key",
            tone: companion.isVerified ? .success : .warning
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(companion.isVerified ? "资料已核验" : "建议先试聊了解")
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
            title: "聊得安心一点",
            message: "沟通和付款都留在平台内；不约线下、不私下转账，也不做医疗诊断承诺。不舒服时可以结束并举报。",
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
                SectionHeader(title: "关于 Ta", subtitle: "沟通风格、擅长方向和可约时间")

                DetailInfoBlock(title: "介绍", symbol: "person.text.rectangle", text: companion.bio)

                VStack(alignment: .leading, spacing: DS.Space.sm) {
                    Text("适合聊什么")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Color.dsTextSecondary)
                    FlowLayout(spacing: DS.Space.sm) {
                        ForEach(companion.specialties, id: \.self) { specialty in
                            TagChip(title: specialty)
                        }
                    }
                }

                VStack(alignment: .leading, spacing: DS.Space.sm) {
                    DetailInfoBlock(title: "可约时间", symbol: "clock", text: companion.availableTimes.joined(separator: " · "))
                    DetailInfoBlock(title: "语言", symbol: "globe.asia.australia", text: companion.languages.joined(separator: " / "))
                }
            }
        }
    }
}

private struct DetailInfoBlock: View {
    let title: String
    let symbol: String
    let text: String

    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.xxs) {
            Label(title, systemImage: symbol)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Color.dsTextSecondary)
            Text(text)
                .font(.system(size: 14))
                .foregroundStyle(Color.dsTextPrimary)
                .lineSpacing(4)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

private struct ReviewPreview: View {
    let companion: Companion
    @EnvironmentObject private var store: AppStore

    private var reviews: [Review] {
        Array(store.reviews(for: companion.id).prefix(3))
    }

    var body: some View {
        SoftCard {
            VStack(alignment: .leading, spacing: DS.Space.md) {
                SectionHeader(title: "近期评价", subtitle: "\(companion.reviewCount) 条历史评价")

                if reviews.isEmpty {
                    DSInsetSurface(padding: DS.Space.md) {
                        VStack(alignment: .leading, spacing: DS.Space.sm) {
                            Label("还没有评价", systemImage: "text.bubble")
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundStyle(Color.dsTextPrimary)
                            Text("可以先试聊，确认沟通节奏舒服后再预约。")
                                .font(.system(size: 13))
                                .foregroundStyle(Color.dsTextSecondary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                } else {
                    ForEach(reviews) { review in
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
                                    .lineSpacing(3)
                            }
                        }
                    }
                }
            }
        }
    }
}

private struct DetailActionBar: View {
    let companion: Companion
    @EnvironmentObject private var store: AppStore

    var body: some View {
        ActionDock {
            VStack(spacing: DS.Space.md) {
                HStack(spacing: DS.Space.sm) {
                    VStack(alignment: .leading, spacing: DS.Space.xxs) {
                        Text("先聊几句再决定")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(Color.dsTextPrimary)
                            .lineLimit(1)
                        Text("试聊剩余 \(store.remainingTrialMessages(for: companion.id))/\(store.freeTrialMessageLimit) 条 · ¥\(companion.pricePerHalfHour)/30m")
                            .font(.system(size: 11))
                            .foregroundStyle(Color.dsTextSecondary)
                            .lineLimit(1)
                            .minimumScaleFactor(0.78)
                    }
                    .layoutPriority(1)

                    Spacer(minLength: DS.Space.sm)
                }

                HStack(spacing: DS.Space.sm) {
                    DSButton(title: "预约沟通", systemImage: "calendar.badge.plus", variant: .secondary) {
                        store.navigate(.order(companion.id))
                    }
                    .accessibilityLabel("预约\(companion.name)沟通")
                    .accessibilityIdentifier("detailOrder-\(companion.id)")

                    DSButton(
                        title: store.user.isVerified ? "先聊几句" : "先完成认证",
                        systemImage: "bubble.left.and.bubble.right",
                        variant: .primary
                    ) {
                        guard store.user.isVerified else {
                            store.navigate(.verify)
                            return
                        }
                        store.navigate(.chat(.companion(id: companion.id)))
                    }
                    .accessibilityLabel(store.user.isVerified ? "先和\(companion.name)聊几句" : "先完成认证再聊天")
                    .accessibilityIdentifier("detailChat-\(companion.id)")
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
                Text("收到后会尽快查看。你也可以先结束沟通，把感受照顾好。")
                    .font(.system(size: 13))
                    .foregroundStyle(Color.dsTextSecondary)
                Picker("原因", selection: $reason) {
                    ForEach(reasons, id: \.self) { Text($0) }
                }
                .pickerStyle(.inline)
                .accessibilityIdentifier("detailReportReasonPicker")
                DSPrimaryButton(title: "提交举报", systemImage: "paperplane") {
                    store.report(companionId: companionId, reason: reason)
                    dismiss()
                }
                .accessibilityIdentifier("detailReportSubmit")
                Spacer()
            }
            .padding(DS.Space.lg)
            .background(Color.dsBackground)
            .navigationTitle("举报")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}
