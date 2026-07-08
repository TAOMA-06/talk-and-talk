import SwiftUI

struct CompanionDetailView: View {
    let companionId: String
    @EnvironmentObject private var store: AppStore
    @Environment(\.dismiss) private var dismiss
    
    var companion: Companion? {
        store.companion(by: companionId)
    }
    
    var body: some View {
        ScrollView {
            if let companion = companion {
                VStack(spacing: 0) {
                    ProfileHeader(companion: companion)
                    
                    VStack(alignment: .leading, spacing: 24) {
                        TagsSection(companion: companion)
                        BioSection(companion: companion)
                        DetailsSection(companion: companion)
                        SpecialtiesSection(companion: companion)
                        ReviewsSection(companion: companion)
                    }
                    .padding()
                }
            } else {
                EmptyState
            }
        }
        .navigationTitle("陪伴者详情")
        .safeAreaInset(edge: .bottom) {
            BottomActionBar
        }
    }
    
    private var EmptyState: some View {
        VStack(spacing: 16) {
            Text("陪伴者不存在")
                .foregroundStyle(.secondary)
            Button("返回首页") {
                dismiss()
            }
            .tint(.teal)
        }
        .padding(.top, 60)
    }
    
    private var BottomActionBar: some View {
        HStack {
            if let companion = companion {
                VStack(alignment: .leading, spacing: 2) {
                    Text("¥\(companion.pricePerHour)")
                        .font(.title3)
                        .fontWeight(.bold)
                        .foregroundStyle(.orange)
                    + Text("/小时")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                
                Spacer()
                
                Button {
                    store.navigationPath.append(NavigationDestination.order(companion.id))
                } label: {
                    Text("发起沟通")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(.primary)
            }
        }
        .padding()
        .background(Color.white)
        .overlay(
            Rectangle()
                .frame(height: 0.5)
                .foregroundColor(Color.gray.opacity(0.3)),
            alignment: .top
        )
    }
}

struct ProfileHeader: View {
    let companion: Companion
    
    var body: some View {
        ZStack(alignment: .bottomLeading) {
            LinearGradient(
                colors: [.teal.opacity(0.2), .orange.opacity(0.2)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .frame(height: 120)
            
            HStack(alignment: .bottom, spacing: 16) {
                AsyncImage(url: URL(string: companion.avatar)) { image in
                    image
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                } placeholder: {
                    Circle()
                        .fill(Color.gray.opacity(0.3))
                }
                .frame(width: 96, height: 96)
                .clipShape(RoundedRectangle(cornerRadius: 16))
                .overlay(
                    RoundedRectangle(cornerRadius: 16)
                        .stroke(Color.white, lineWidth: 4)
                )
                
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(companion.name)
                            .font(.title2)
                            .fontWeight(.bold)
                        
                        if companion.isVerified {
                            Image(systemName: "checkmark.seal.fill")
                                .foregroundStyle(.teal)
                                .font(.title3)
                        }
                    }
                    
                    HStack(spacing: 4) {
                        Image(systemName: "star.fill")
                            .foregroundStyle(.orange)
                        Text("\(companion.rating, specifier: "%.1f")")
                            .fontWeight(.medium)
                        Text("(\(companion.reviewCount) 评价)")
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(.bottom, 8)
                
                Spacer()
            }
            .padding(.horizontal)
            .padding(.bottom, -24)
        }
    }
}

struct TagsSection: View {
    let companion: Companion
    
    var body: some View {
        FlowLayout(spacing: 8) {
            ForEach(companion.tags, id: \.self) { tag in
                Text(tag)
                    .font(.subheadline)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(Color.gray.opacity(0.1))
                    .clipShape(Capsule())
            }
        }
    }
}

struct BioSection: View {
    let companion: Companion
    
    var body: some View {
        Text(companion.bio)
            .font(.subheadline)
            .foregroundStyle(.secondary)
            .lineSpacing(4)
    }
}

struct DetailsSection: View {
    let companion: Companion
    
    var body: some View {
        HStack(spacing: 12) {
            DetailCard(
                icon: "clock",
                title: "可约时间",
                value: "\(companion.availableTimes.count) 个时段"
            )
            
            DetailCard(
                icon: "globe",
                title: "语言",
                value: companion.languages.joined(separator: "、")
            )
        }
    }
}

struct DetailCard: View {
    let icon: String
    let title: String
    let value: String
    
    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: icon)
                .foregroundStyle(.teal)
            
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text(value)
                    .font(.subheadline)
                    .fontWeight(.medium)
            }
            
            Spacer()
        }
        .padding()
        .background(Color.gray.opacity(0.1))
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }
}

struct SpecialtiesSection: View {
    let companion: Companion
    
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("擅长领域")
                .font(.headline)
            
            FlowLayout(spacing: 8) {
                ForEach(companion.specialties, id: \.self) { specialty in
                    Text(specialty)
                        .font(.subheadline)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .background(Color.teal.opacity(0.1))
                        .foregroundStyle(.teal)
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                }
            }
        }
    }
}

struct ReviewsSection: View {
    let companion: Companion
    @EnvironmentObject private var store: AppStore
    
    var reviews: [Review] {
        store.reviews(for: companion.id)
    }
    
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("用户评价")
                .font(.headline)
            
            ForEach(reviews.prefix(3)) { review in
                ReviewCard(review: review)
            }
        }
    }
}

struct ReviewCard: View {
    let review: Review
    
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(review.userName)
                    .font(.subheadline)
                    .fontWeight(.medium)
                
                Spacer()
                
                HStack(spacing: 4) {
                    Image(systemName: "star.fill")
                        .foregroundStyle(.orange)
                        .font(.caption)
                    Text("\(review.rating)")
                        .font(.subheadline)
                }
            }
            
            Text(review.content)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .padding()
        .background(Color.gray.opacity(0.1))
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }
}

struct FlowLayout: Layout {
    var spacing: CGFloat = 8
    
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let result = FlowResult(in: proposal.width ?? 0, subviews: subviews, spacing: spacing)
        return result.size
    }
    
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = FlowResult(in: bounds.width, subviews: subviews, spacing: spacing)
        for (index, subview) in subviews.enumerated() {
            subview.place(at: CGPoint(x: bounds.minX + result.positions[index].x, y: bounds.minY + result.positions[index].y), proposal: .unspecified)
        }
    }
    
    struct FlowResult {
        var size: CGSize = .zero
        var positions: [CGPoint] = []
        
        init(in maxWidth: CGFloat, subviews: Subviews, spacing: CGFloat) {
            var x: CGFloat = 0
            var y: CGFloat = 0
            var rowHeight: CGFloat = 0
            
            for subview in subviews {
                let size = subview.sizeThatFits(.unspecified)
                
                if x + size.width > maxWidth && x > 0 {
                    x = 0
                    y += rowHeight + spacing
                    rowHeight = 0
                }
                
                positions.append(CGPoint(x: x, y: y))
                rowHeight = max(rowHeight, size.height)
                x += size.width + spacing
            }
            
            self.size = CGSize(width: maxWidth, height: y + rowHeight)
        }
    }
}
