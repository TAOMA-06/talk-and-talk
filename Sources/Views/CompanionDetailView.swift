import SwiftUI

struct CompanionDetailView: View {
    let companionId: String
    @EnvironmentObject private var store: AppStore
    @State private var showingReport = false
    @State private var reportReason = "资料不实"
    @State private var trustExpanded = false

    private var companion: Companion? {
        store.companion(by: companionId)
    }

    var body: some View {
        ZStack {
            AppBackground()
            if let companion {
                ScrollView {
                    VStack(spacing: DS.Space.lg) {
                        ProfileHero(companion: companion)
                        TrustFoldSection(isExpanded: $trustExpanded, companion: companion)
                        BoundaryNotice()
                        BioPanel(companion: companion)
                        ReviewPreview(companion: companion)
                    }
                    .padding(DS.Space.lg)
                    .padding(.bottom, 112)
                }
                .safeAreaInset(edge: .bottom) {
                    BottomActionBar(companion: companion, showingReport: $showingReport)
                }
            } else {
                EmptyStateView(symbol: "person.crop.circle.badge.questionmark", title: "陪伴者不存在", subtitle: "这可能是演示数据已被刷新。")
            }
        }
        .navigationTitle("陪伴者详情")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Color.dsBackground, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .sheet(isPresented: $showingReport) {
            ReportSheet(companionId: companionId, reason: $reportReason)
                .presentationDetents([.medium])
        }
    }
}

private struct ProfileHero: View {
    let companion: Companion

    var body: some View {
        SoftCard {
            VStack(alignment: .leading, spacing: DS.Space.lg) {
                HStack(alignment: .top, spacing: DS.Space.lg) {
                    CompanionAvatar(companion: companion, size: 72)
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
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: DS.Space.sm) {
                                AvailabilityBadge(status: companion.availability)
                                DistanceLabel(distanceKm: companion.distanceKm, district: companion.cityDistrict)
                                StatusPill(text: String(format: "%.1f", companion.rating), symbol: "star.fill", color: Color.dsWarning)
                                TrustMicroBadge(text: "平台担保", tone: .primary)
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

private struct TrustFoldSection: View {
    @Binding var isExpanded: Bool
    let companion: Companion

    var body: some View {
        SoftCard(padding: 0) {
            VStack(spacing: 0) {
                Button {
                    withAnimation(.easeOut(duration: DS.Motion.fast)) { isExpanded.toggle() }
                } label: {
                    HStack {
                        Text("为什么信任她")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(Color.dsTextPrimary)
                        Spacer()
                        Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(Color.dsTextSecondary)
                    }
                    .padding(DS.Space.lg)
                }
                .buttonStyle(.plain)

                if isExpanded {
                    Divider().padding(.horizontal, DS.Space.lg)
                    VStack(alignment: .leading, spacing: DS.Space.md) {
                        TrustReasonRow(symbol: "person.text.rectangle", title: "三层实名认证", detail: companion.isVerified ? "身份证 + 人脸 + 手机号已核验" : "待完成全部认证")
                        TrustReasonRow(symbol: "lock.shield", title: "平台担保交易", detail: "先付平台，服务完成后结算")
                        TrustReasonRow(symbol: "star.bubble", title: "真实评价", detail: "\(companion.reviewCount) 条历史评价，均分 \(String(format: "%.1f", companion.rating))")
                    }
                    .padding(DS.Space.lg)
                    .padding(.top, DS.Space.xxs)
                }
            }
        }
    }
}

private struct TrustReasonRow: View {
    let symbol: String
    let title: String
    let detail: String

    var body: some View {
        HStack(spacing: DS.Space.md) {
            Image(systemName: symbol)
                .foregroundStyle(Color.dsPrimary)
                .frame(width: 24)
            VStack(alignment: .leading, spacing: DS.Space.xxs) {
                Text(title)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Color.dsTextPrimary)
                Text(detail)
                    .font(.system(size: 11))
                    .foregroundStyle(Color.dsTextSecondary)
            }
        }
    }
}

private struct MetricTile: View {
    let title: String
    let value: String

    var body: some View {
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
        .padding(.vertical, DS.Space.md)
        .background(Color.dsBackground, in: RoundedRectangle(cornerRadius: DS.Radius.sm, style: .continuous))
    }
}

private struct BoundaryNotice: View {
    var body: some View {
        SoftCard(padding: DS.Space.md) {
            HStack(alignment: .top, spacing: DS.Space.md) {
                Image(systemName: "lock.shield.fill")
                    .foregroundStyle(Color.dsDanger)
                VStack(alignment: .leading, spacing: DS.Space.xxs) {
                    Text("服务边界")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Color.dsTextPrimary)
                    Text("仅支持平台内文字与语音沟通；禁止线下邀约、私下转账、敏感交易和医疗诊断承诺。")
                        .font(.system(size: 13))
                        .foregroundStyle(Color.dsTextSecondary)
                        .lineSpacing(3)
                }
            }
        }
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
                    VStack(alignment: .leading, spacing: DS.Space.sm) {
                        HStack {
                            Text(review.userName)
                                .font(.system(size: 15, weight: .semibold))
                            Spacer()
                            Label("\(review.rating)", systemImage: "star.fill")
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundStyle(Color.dsWarning)
                        }
                        Text(review.content)
                            .font(.system(size: 13))
                            .foregroundStyle(Color.dsTextSecondary)
                    }
                    .padding(DS.Space.md)
                    .background(Color.dsBackground, in: RoundedRectangle(cornerRadius: DS.Radius.sm, style: .continuous))
                }
            }
        }
    }
}

private struct BottomActionBar: View {
    let companion: Companion
    @Binding var showingReport: Bool
    @EnvironmentObject private var store: AppStore

    var body: some View {
        ActionDock {
            HStack(spacing: DS.Space.md) {
                VStack(alignment: .leading, spacing: DS.Space.xxs) {
                    Text("免费试聊 \(store.freeTrialMessageLimit) 条")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(Color.dsTextPrimary)
                    Text("继续聊 ¥\(companion.pricePerHalfHour)/30m")
                        .font(.system(size: 11))
                        .foregroundStyle(Color.dsTextSecondary)
                }
                Spacer()
                Button {
                    showingReport = true
                } label: {
                    Image(systemName: "exclamationmark.bubble")
                        .frame(width: 40, height: 40)
                        .foregroundStyle(Color.dsTextPrimary)
                }
                .background(Color.dsBackground, in: RoundedRectangle(cornerRadius: DS.Radius.sm, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: DS.Radius.sm, style: .continuous)
                        .stroke(Color.dsBorder, lineWidth: 1)
                }

                Button {
                    store.navigate(.order(companion.id))
                } label: {
                    Text("直接下单")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Color.dsPrimary)
                        .frame(width: 76, height: 40)
                        .background(Color.dsBackground, in: RoundedRectangle(cornerRadius: DS.Radius.sm, style: .continuous))
                        .overlay {
                            RoundedRectangle(cornerRadius: DS.Radius.sm, style: .continuous)
                                .stroke(Color.dsBorder, lineWidth: 1)
                        }
                }
                .buttonStyle(DSPressButtonStyle())

                DSPrimaryButton(title: "免费试聊", systemImage: "bubble.left.and.bubble.right") {
                    guard store.user.isVerified else {
                        store.navigate(.verify)
                        return
                    }
                    store.navigate(.chat(.companion(id: companion.id)))
                }
                .frame(maxWidth: 148)
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
                Text("举报会进入人工审核队列；演示版不会上传任何真实数据。")
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
