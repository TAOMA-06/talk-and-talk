import SwiftUI

struct ReviewView: View {
    let companionId: String
    @EnvironmentObject private var store: AppStore
    @Environment(\.dismiss) private var dismiss
    @State private var rating = 5
    @State private var content = ""
    @State private var submitted = false
    @State private var isSubmitting = false

    private var companion: Companion? { store.companion(by: companionId) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DS.Space.lg) {
                if submitted {
                    SuccessPanel(onFinish: finishAndGoHome)
                } else if let companion {
                    CompanionOrderHeader(companion: companion)
                    RatingPicker(rating: $rating)
                    ReviewEditor(content: $content)
                    DSPrimaryButton(title: isSubmitting ? "正在提交…" : "提交评价", systemImage: "star.fill", isEnabled: !isSubmitting, action: submitReview)
                    DSSecondaryButton(title: "稍后评价", action: { dismiss() })
                } else {
                    EmptyStateView(symbol: "star.slash", title: "评价对象不存在", subtitle: "请返回订单页查看状态。")
                    DSSecondaryButton(title: "返回", action: { dismiss() })
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, DS.Space.lg)
            .padding(.top, DS.Space.md)
            .padding(.bottom, DS.Space.xxxl)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(Color.dsBackground)
        .navigationTitle("评价")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Color.dsBackground, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .toolbar(.visible, for: .tabBar)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                if !submitted {
                    Button("返回") { dismiss() }
                }
            }
        }
    }

    private func submitReview() {
        guard store.orders.contains(where: { $0.companionId == companionId && $0.status == .completed }) else { return }
        isSubmitting = true
        Task {
            let succeeded = await store.submitReview(companionId: companionId, rating: rating, content: content)
            isSubmitting = false
            if succeeded {
                withAnimation(.easeOut(duration: DS.Motion.fast)) { submitted = true }
            }
        }
    }

    private func finishAndGoHome() {
        store.selectedTab = .discover
        store.popToRoot()
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
                DSTextEditor(placeholder: "写下你的感受...", text: $content, minHeight: 120)
            }
        }
    }
}

private struct SuccessPanel: View {
    let onFinish: () -> Void

    var body: some View {
        SoftCard {
            VStack(spacing: DS.Space.lg) {
                Image(systemName: "checkmark.seal.fill")
                    .font(.system(size: 48))
                    .foregroundStyle(Color.dsSuccess)
                Text("评价已提交")
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(Color.dsTextPrimary)
                Text("感谢你的评价，这会帮助其他人做选择。")
                    .font(.system(size: 13))
                    .foregroundStyle(Color.dsTextSecondary)
                DSPrimaryButton(title: "回到发现", systemImage: "house", action: onFinish)
            }
            .frame(maxWidth: .infinity)
        }
    }
}
