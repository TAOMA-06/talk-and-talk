import SwiftUI

struct ReviewView: View {
    let companionId: String
    @EnvironmentObject private var store: AppStore
    @Environment(\.dismiss) private var dismiss
    
    @State private var rating = 0
    @State private var hoverRating = 0
    @State private var content = ""
    @State private var submitted = false
    
    var companion: Companion? {
        store.companion(by: companionId)
    }
    
    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                if let companion = companion {
                    if submitted {
                        SuccessState
                    } else {
                        CompanionInfoCard(companion: companion)
                        RatingSection(rating: $rating, hoverRating: $hoverRating)
                        ReviewContentSection(content: $content)
                        ReviewSubmitButton(isEnabled: rating > 0) {
                            submitted = true
                            DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                                dismiss()
                            }
                        }
                    }
                } else {
                    EmptyState
                }
            }
            .padding()
        }
        .navigationTitle("评价")
    }
    
    private var SuccessState: some View {
        VStack(spacing: 24) {
            Image(systemName: "star.fill")
                .font(.system(size: 64))
                .foregroundStyle(.teal)
            
            Text("评价已提交")
                .font(.title2)
                .fontWeight(.bold)
            
            Text("感谢您的反馈，这将帮助我们提供更好的服务")
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding(.top, 60)
    }
    
    private var EmptyState: some View {
        VStack(spacing: 16) {
            Text("订单不存在")
                .foregroundStyle(.secondary)
            Button("返回首页") {
                dismiss()
            }
            .tint(.teal)
        }
        .padding(.top, 60)
    }
}

struct RatingSection: View {
    @Binding var rating: Int
    @Binding var hoverRating: Int
    
    var body: some View {
        VStack(spacing: 16) {
            Text("为这次沟通打分")
                .font(.title3)
                .fontWeight(.bold)
            
            HStack(spacing: 12) {
                ForEach(1...5, id: \.self) { star in
                    Image(systemName: star <= (hoverRating > 0 ? hoverRating : rating) ? "star.fill" : "star")
                        .font(.title)
                        .foregroundStyle(star <= (hoverRating > 0 ? hoverRating : rating) ? .orange : .secondary)
                        .onTapGesture {
                            rating = star
                        }
                        .onHover { hovering in
                            hoverRating = hovering ? star : 0
                        }
                }
            }
            
            Text(ratingText)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
    }
    
    private var ratingText: String {
        if rating == 0 { return "点击星星评分" }
        if rating == 5 { return "非常满意" }
        if rating >= 3 { return "满意" }
        return "一般"
    }
}

struct ReviewContentSection: View {
    @Binding var content: String
    
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("评价内容（可选）")
                .font(.headline)
            
            TextEditor(text: $content)
                .frame(minHeight: 100)
                .padding(8)
                .background(Color.gray.opacity(0.1))
                .clipShape(RoundedRectangle(cornerRadius: 12))
        }
    }
}

struct ReviewSubmitButton: View {
    let isEnabled: Bool
    let action: () -> Void
    
    var body: some View {
        Button(action: action) {
            Text("提交评价")
                .font(.headline)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 16)
        }
        .buttonStyle(.borderedProminent)
        .tint(.primary)
        .disabled(!isEnabled)
    }
}
