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
                    VStack(spacing: 18) {
                        ProfileHero(companion: companion)
                        TrustFoldSection(isExpanded: $trustExpanded, companion: companion)
                        BoundaryNotice()
                        BioPanel(companion: companion)
                        ReviewPreview(companion: companion)
                    }
                    .padding(18)
                    .padding(.bottom, 118)
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
        .toolbarBackground(.hidden, for: .navigationBar)
        .sheet(isPresented: $showingReport) {
            ReportSheet(companionId: companionId, reason: $reportReason)
                .presentationDetents([.medium])
        }
    }
}

private struct ProfileHero: View {
    let companion: Companion

    var body: some View {
        SoftCard(cornerRadius: 28, tint: Color.appTeal, padding: 18) {
            VStack(alignment: .leading, spacing: 16) {
                HStack(alignment: .top, spacing: 16) {
                    CompanionAvatar(companion: companion, size: 88)
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(spacing: 8) {
                            Text(companion.name)
                                .font(.title2.bold())
                                .foregroundStyle(Color.appInk)
                            if companion.isVerified {
                                Image(systemName: "checkmark.seal.fill")
                                    .foregroundStyle(Color.appTeal)
                            }
                        }
                        Text(companion.role)
                            .font(.subheadline)
                            .foregroundStyle(Color.appMuted)
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 8) {
                                AvailabilityBadge(status: companion.availability)
                                DistanceLabel(distanceKm: companion.distanceKm, district: companion.cityDistrict)
                                StatusPill(text: String(format: "%.1f", companion.rating), symbol: "star.fill", color: Color.appGold)
                                TrustMicroBadge(text: "平台担保", symbol: "lock.shield", color: Color.appLilac)
                            }
                        }
                    }
                }

                FlowLayout(spacing: 8) {
                    ForEach(companion.tags, id: \.self) { tag in
                        TagChip(title: tag, color: Color.appTeal)
                    }
                }

                HStack(spacing: 12) {
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
        SoftCard(cornerRadius: 20, tint: Color.appTeal, padding: 0) {
            VStack(spacing: 0) {
                Button {
                    withAnimation(.snappy) { isExpanded.toggle() }
                } label: {
                    HStack {
                        Text("为什么信任她")
                            .font(.headline)
                            .foregroundStyle(Color.appInk)
                        Spacer()
                        Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                            .font(.caption.weight(.bold))
                            .foregroundStyle(Color.appMuted)
                    }
                    .padding(16)
                }
                .buttonStyle(.plain)

                if isExpanded {
                    Divider().padding(.horizontal, 16)
                    VStack(alignment: .leading, spacing: 12) {
                        TrustReasonRow(symbol: "person.text.rectangle", title: "三层实名认证", detail: companion.isVerified ? "身份证 + 人脸 + 手机号已核验" : "待完成全部认证")
                        TrustReasonRow(symbol: "lock.shield", title: "平台担保交易", detail: "先付平台，服务完成后结算")
                        TrustReasonRow(symbol: "star.bubble", title: "真实评价", detail: "\(companion.reviewCount) 条历史评价，均分 \(String(format: "%.1f", companion.rating))")
                    }
                    .padding(16)
                    .padding(.top, 4)
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
        HStack(spacing: 12) {
            Image(systemName: symbol)
                .foregroundStyle(Color.appTeal)
                .frame(width: 24)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Color.appInk)
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(Color.appMuted)
            }
        }
    }
}

private struct MetricTile: View {
    let title: String
    let value: String

    var body: some View {
        VStack(spacing: 5) {
            Text(value)
                .font(.headline)
                .foregroundStyle(Color.appInk)
                .lineLimit(1)
                .minimumScaleFactor(0.75)
            Text(title)
                .font(.caption)
                .foregroundStyle(Color.appMuted)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
        .background(Color.appMist, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}

private struct BoundaryNotice: View {
    var body: some View {
        SoftCard(cornerRadius: 20, tint: Color.appCoral, padding: 14) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: "lock.shield.fill")
                    .foregroundStyle(Color.appCoral)
                VStack(alignment: .leading, spacing: 4) {
                    Text("服务边界")
                        .font(.headline)
                        .foregroundStyle(Color.appInk)
                    Text("仅支持平台内文字与语音沟通；禁止线下邀约、私下转账、敏感交易和医疗诊断承诺。")
                        .font(.subheadline)
                        .foregroundStyle(Color.appMuted)
                        .lineSpacing(3)
                }
            }
        }
    }
}

private struct BioPanel: View {
    let companion: Companion

    var body: some View {
        SoftCard(cornerRadius: 22, tint: Color.appTeal, padding: 16) {
            VStack(alignment: .leading, spacing: 16) {
                SectionHeader(title: "介绍与可约时间")
                Text(companion.bio)
                    .font(.subheadline)
                    .foregroundStyle(Color.appMuted)
                    .lineSpacing(4)
                VStack(alignment: .leading, spacing: 10) {
                    Label(companion.languages.joined(separator: " / "), systemImage: "globe.asia.australia")
                    Label(companion.availableTimes.joined(separator: "  "), systemImage: "clock")
                    Label(companion.specialties.joined(separator: " / "), systemImage: "tag")
                }
                .font(.subheadline)
                .foregroundStyle(Color.appInk)
            }
        }
    }
}

private struct ReviewPreview: View {
    let companion: Companion
    @EnvironmentObject private var store: AppStore

    var body: some View {
        SoftCard(cornerRadius: 22, tint: Color.appGold, padding: 16) {
            VStack(alignment: .leading, spacing: 12) {
                SectionHeader(title: "近期评价", subtitle: "\(companion.reviewCount) 条历史评价")
                ForEach(store.reviews(for: companion.id).prefix(3)) { review in
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text(review.userName)
                                .font(.subheadline.weight(.semibold))
                            Spacer()
                            Label("\(review.rating)", systemImage: "star.fill")
                                .font(.caption.weight(.bold))
                                .foregroundStyle(Color.appGold)
                        }
                        Text(review.content)
                            .font(.subheadline)
                            .foregroundStyle(Color.appMuted)
                    }
                    .padding(12)
                    .background(Color.appMist, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
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
        ActionDock(tint: .white.opacity(0.2)) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("¥\(companion.pricePerHalfHour)")
                        .font(.title3.bold())
                        .foregroundStyle(Color.appCoral)
                    Text("30分钟起 · 平台担保")
                        .font(.caption)
                        .foregroundStyle(Color.appMuted)
                }
                Spacer()
                Button {
                    showingReport = true
                } label: {
                    Image(systemName: "exclamationmark.bubble")
                        .frame(width: 42, height: 42)
                        .foregroundStyle(Color.appInk)
                }
                .background(Color.appWarm, in: RoundedRectangle(cornerRadius: 15, style: .continuous))
                PrimaryActionButton(title: "发起沟通", systemImage: "waveform") {
                    store.navigate(.order(companion.id))
                }
                .frame(maxWidth: 180)
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
            VStack(alignment: .leading, spacing: 18) {
                Text("举报会进入人工审核队列；演示版不会上传任何真实数据。")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Picker("原因", selection: $reason) {
                    ForEach(reasons, id: \.self) { Text($0) }
                }
                .pickerStyle(.inline)
                PrimaryActionButton(title: "提交举报", systemImage: "paperplane") {
                    store.report(companionId: companionId, reason: reason)
                    dismiss()
                }
                Spacer()
            }
            .padding()
            .navigationTitle("举报")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}
