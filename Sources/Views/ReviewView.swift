import SwiftUI

struct ReviewView: View {
    let companionId: String
    @EnvironmentObject private var store: AppStore
    @Environment(\.dismiss) private var dismiss
    @State private var rating = 5
    @State private var content = "沟通过程很安心，边界提醒也清楚。"
    @State private var submitted = false

    private var companion: Companion? { store.companion(by: companionId) }

    var body: some View {
        AppScaffold(title: "评价", spacing: 20, bottomPadding: 40) {
            if submitted {
                SuccessPanel()
            } else if let companion {
                CompanionOrderHeader(companion: companion)
                RatingPicker(rating: $rating)
                ReviewEditor(content: $content)
                PrimaryActionButton(title: "提交评价", systemImage: "star.fill") {
                    store.submitReview(companionId: companionId, rating: rating, content: content)
                    withAnimation(.snappy) { submitted = true }
                }
            } else {
                EmptyStateView(symbol: "star.slash", title: "评价对象不存在", subtitle: "请返回订单页查看状态。")
            }
        }
    }
}

private struct RatingPicker: View {
    @Binding var rating: Int

    var body: some View {
        GlassPanel(cornerRadius: 28, tint: Color.appGold.opacity(0.12)) {
            VStack(spacing: 18) {
                Text("这次沟通体验怎么样？")
                    .font(.title3.bold())
                    .foregroundStyle(Color.appInk)
                HStack(spacing: 12) {
                    ForEach(1...5, id: \.self) { star in
                        Button {
                            rating = star
                        } label: {
                            Image(systemName: star <= rating ? "star.fill" : "star")
                                .font(.system(size: 30, weight: .semibold))
                                .foregroundStyle(star <= rating ? Color.appGold : Color.appMuted.opacity(0.45))
                        }
                        .buttonStyle(.plain)
                    }
                }
                Text(ratingText)
                    .font(.subheadline)
                    .foregroundStyle(Color.appMuted)
            }
            .frame(maxWidth: .infinity)
        }
    }

    private var ratingText: String {
        switch rating {
        case 5: "非常安心，愿意再次预约"
        case 4: "整体满意"
        case 3: "一般，有改进空间"
        default: "体验不佳，需要平台跟进"
        }
    }
}

private struct ReviewEditor: View {
    @Binding var content: String

    var body: some View {
        GlassPanel(cornerRadius: 24) {
            VStack(alignment: .leading, spacing: 12) {
                SectionHeader(title: "评价内容", subtitle: "帮助其他用户理解服务体验")
                TextEditor(text: $content)
                    .frame(minHeight: 130)
                    .scrollContentBackground(.hidden)
                    .padding(10)
                    .background(.white.opacity(0.5), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
        }
    }
}

private struct SuccessPanel: View {
    @EnvironmentObject private var store: AppStore

    var body: some View {
        GlassPanel(cornerRadius: 30, tint: Color.appTeal.opacity(0.14)) {
            VStack(spacing: 18) {
                Image(systemName: "checkmark.seal.fill")
                    .font(.system(size: 58))
                    .foregroundStyle(Color.appTeal)
                Text("评价已提交")
                    .font(.title2.bold())
                    .foregroundStyle(Color.appInk)
                Text("订单已完成，评价已写入本地 mock 数据。")
                    .font(.subheadline)
                    .foregroundStyle(Color.appMuted)
                PrimaryActionButton(title: "回到发现", systemImage: "sparkles") {
                    store.selectedTab = .discover
                    store.popToRoot()
                }
            }
            .frame(maxWidth: .infinity)
        }
    }
}
