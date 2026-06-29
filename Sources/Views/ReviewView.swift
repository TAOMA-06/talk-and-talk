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
        AppScaffold(title: "评价", spacing: DS.Space.lg, bottomPadding: DS.Space.xl) {
            if submitted {
                SuccessPanel()
            } else if let companion {
                CompanionOrderHeader(companion: companion)
                RatingPicker(rating: $rating)
                ReviewEditor(content: $content)
                DSPrimaryButton(title: "提交评价", systemImage: "star.fill") {
                    store.submitReview(companionId: companionId, rating: rating, content: content)
                    withAnimation(.easeOut(duration: DS.Motion.fast)) { submitted = true }
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
        SoftCard {
            VStack(spacing: DS.Space.lg) {
                Text("这次沟通体验怎么样？")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(Color.dsTextPrimary)
                HStack(spacing: DS.Space.md) {
                    ForEach(1...5, id: \.self) { star in
                        Button {
                            rating = star
                        } label: {
                            Image(systemName: star <= rating ? "star.fill" : "star")
                                .font(.system(size: 28, weight: .regular))
                                .foregroundStyle(star <= rating ? Color.dsWarning : Color.dsBorder)
                        }
                        .buttonStyle(.plain)
                    }
                }
                Text(ratingText)
                    .font(.system(size: 13))
                    .foregroundStyle(Color.dsTextSecondary)
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
        SoftCard {
            VStack(alignment: .leading, spacing: DS.Space.md) {
                SectionHeader(title: "评价内容", subtitle: "帮助其他用户理解服务体验")
                TextEditor(text: $content)
                    .frame(minHeight: 120)
                    .font(.system(size: 15))
                    .scrollContentBackground(.hidden)
                    .padding(DS.Space.sm)
                    .background(Color.dsBackground, in: RoundedRectangle(cornerRadius: DS.Radius.sm, style: .continuous))
                    .overlay {
                        RoundedRectangle(cornerRadius: DS.Radius.sm, style: .continuous)
                            .stroke(Color.dsBorder, lineWidth: 1)
                    }
            }
        }
    }
}

private struct SuccessPanel: View {
    @EnvironmentObject private var store: AppStore

    var body: some View {
        SoftCard {
            VStack(spacing: DS.Space.lg) {
                Image(systemName: "checkmark.seal.fill")
                    .font(.system(size: 48))
                    .foregroundStyle(Color.dsSuccess)
                Text("评价已提交")
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(Color.dsTextPrimary)
                Text("订单已完成，评价已写入本地 mock 数据。")
                    .font(.system(size: 13))
                    .foregroundStyle(Color.dsTextSecondary)
                DSPrimaryButton(title: "回到发现", systemImage: "house") {
                    store.selectedTab = .discover
                    store.popToRoot()
                }
            }
            .frame(maxWidth: .infinity)
        }
    }
}
