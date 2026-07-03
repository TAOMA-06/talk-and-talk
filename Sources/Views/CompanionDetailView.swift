import SwiftUI

struct CompanionDetailView: View {
    let companionId: String
    @EnvironmentObject private var store: AppStore
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
                EmptyStateView(symbol: "person.crop.circle.badge.questionmark", title: "陪伴者不存在", subtitle: "这可能是演示数据已被刷新。")
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
                                Button {
                                    store.navigate(.companionHomepage(companion.id))
                                } label: {
                                    Label("主页", systemImage: "person.crop.square")
                                        .font(.system(size: 13, weight: .semibold))
                                        .labelStyle(.titleAndIcon)
                                        .foregroundStyle(Color.dsPrimary)
                                        .frame(width: 72, height: 36)
                                        .background(Color.dsBackground.opacity(0.86), in: RoundedRectangle(cornerRadius: DS.Radius.md, style: .continuous))
                                        .overlay {
                                            RoundedRectangle(cornerRadius: DS.Radius.md, style: .continuous)
                                                .stroke(Color.dsBorder, lineWidth: 1)
                                        }
                                }
                                .buttonStyle(DSPressButtonStyle())
                                .accessibilityLabel("进入主页")

                                Button {
                                    showingReport = true
                                } label: {
                                    Image(systemName: "exclamationmark.bubble")
                                        .font(.system(size: 15, weight: .semibold))
                                        .foregroundStyle(Color.dsTextPrimary)
                                        .frame(width: 36, height: 36)
                                        .background(Color.dsBackground.opacity(0.86), in: RoundedRectangle(cornerRadius: DS.Radius.md, style: .continuous))
                                        .overlay {
                                            RoundedRectangle(cornerRadius: DS.Radius.md, style: .continuous)
                                                .stroke(Color.dsBorder, lineWidth: 1)
                                        }
                                }
                                .buttonStyle(DSPressButtonStyle())
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
        SoftCard(padding: DS.Space.md) {
            HStack(spacing: DS.Space.md) {
                Image(systemName: companion.isVerified ? "checkmark.seal.fill" : "person.badge.key")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(companion.isVerified ? Color.dsSuccess : Color.dsWarning)
                    .frame(width: 28, height: 28)

                VStack(alignment: .leading, spacing: DS.Space.xxs) {
                    Text("认证状态")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(Color.dsTextSecondary)
                    Text(companion.isVerified ? "已完成平台认证" : "暂未完成平台认证")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Color.dsTextPrimary)
                }

                Spacer()

                DSBadge(text: companion.isVerified ? "已认证" : "未认证", tone: companion.isVerified ? .success : .warning)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(companion.isVerified ? "已完成平台认证" : "暂未完成平台认证")
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
    @EnvironmentObject private var store: AppStore

    var body: some View {
        ActionDock {
            HStack(spacing: DS.Space.sm) {
                VStack(alignment: .leading, spacing: DS.Space.xxs) {
                    Text("免费试聊 \(store.freeTrialMessageLimit) 条")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(Color.dsTextPrimary)
                        .lineLimit(1)
                    Text("后续 ¥\(companion.pricePerHalfHour)/30m")
                        .font(.system(size: 11))
                        .foregroundStyle(Color.dsTextSecondary)
                        .lineLimit(1)
                }
                .layoutPriority(1)
                Spacer(minLength: DS.Space.sm)

                Button {
                    store.navigate(.order(companion.id))
                } label: {
                    Text("直接下单")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Color.dsPrimary)
                        .lineLimit(1)
                        .frame(width: 78, height: 44)
                        .background(Color.dsBackground.opacity(0.86), in: RoundedRectangle(cornerRadius: DS.Radius.md, style: .continuous))
                        .overlay {
                            RoundedRectangle(cornerRadius: DS.Radius.md, style: .continuous)
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
                .frame(width: 122)
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
