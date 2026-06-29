import SwiftUI

public struct HomeView: View {
    @EnvironmentObject private var store: AppStore
    @State private var selectedCompanion: Companion?
    
    public init() {}
    
    public var body: some View {
        NavigationStack(path: $store.navigationPath) {
            ScrollView {
                VStack(spacing: 24) {
                    SafetyBanner()
                    
                    ThemesSection { theme in
                        store.selectedTheme = theme
                        store.navigationPath.append(NavigationDestination.companionList)
                    }
                    
                    RecommendedCompanionsSection { companion in
                        selectedCompanion = companion
                        store.navigationPath.append(NavigationDestination.companionDetail(companion.id))
                    }
                }
                .padding(.vertical)
            }
            .navigationTitle("Talk&Talk")
            .navigationDestination(for: NavigationDestination.self) { destination in
                switch destination {
                case .companionList:
                    CompanionListView(theme: store.selectedTheme)
                case .companionDetail(let id):
                    CompanionDetailView(companionId: id)
                case .order(let id):
                    OrderView(companionId: id)
                case .chat(let id):
                    ChatView(companionId: id)
                case .review(let id):
                    ReviewView(companionId: id)
                case .verify:
                    VerifyView()
                }
            }
        }
    }
}

public enum NavigationDestination: Hashable {
    case companionList
    case companionDetail(String)
    case order(String)
    case chat(String)
    case review(String)
    case verify
}

struct SafetyBanner: View {
    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "shield.checkered")
                .font(.title2)
                .foregroundStyle(.teal)
            
            VStack(alignment: .leading, spacing: 4) {
                Text("平台安全提示")
                    .font(.subheadline)
                    .fontWeight(.semibold)
                Text("所有陪伴者均通过实名认证，沟通全程受平台保护")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            
            Spacer()
        }
        .padding()
        .background(Color.teal.opacity(0.1))
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(Color.teal.opacity(0.2), lineWidth: 1)
        )
        .padding(.horizontal)
    }
}

struct ThemesSection: View {
    let onSelect: (Theme) -> Void
    @EnvironmentObject private var store: AppStore
    
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Text("选择沟通主题")
                    .font(.title2)
                    .fontWeight(.bold)
                
                Spacer()
                
                Button("全部") {}
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal)
            
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 100))], spacing: 12) {
                ForEach(store.themes) { theme in
                    ThemeCard(theme: theme)
                        .onTapGesture {
                            onSelect(theme)
                        }
                }
            }
            .padding(.horizontal)
        }
    }
}

struct ThemeCard: View {
    let theme: Theme
    
    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: theme.icon)
                .font(.title2)
                .foregroundStyle(.teal)
                .frame(width: 56, height: 56)
                .background(Color.teal.opacity(0.1))
                .clipShape(Circle())
            
            Text(theme.name)
                .font(.subheadline)
                .fontWeight(.medium)
            
            Text(theme.description)
                .font(.caption)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .lineLimit(2)
        }
        .padding()
        .frame(maxWidth: .infinity)
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(Color.gray.opacity(0.2), lineWidth: 0.5)
        )
    }
}

struct RecommendedCompanionsSection: View {
    let onSelect: (Companion) -> Void
    @EnvironmentObject private var store: AppStore
    
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Text("推荐陪伴者")
                    .font(.title2)
                    .fontWeight(.bold)
                
                Spacer()
                
                Button("更多") {}
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal)
            
            LazyVStack(spacing: 12) {
                ForEach(store.companions.prefix(4)) { companion in
                    CompanionRow(companion: companion)
                        .onTapGesture {
                            onSelect(companion)
                        }
                }
            }
            .padding(.horizontal)
        }
    }
}

struct CompanionRow: View {
    let companion: Companion
    
    var body: some View {
        HStack(spacing: 12) {
            AsyncImage(url: URL(string: companion.avatar)) { image in
                image
                    .resizable()
                    .aspectRatio(contentMode: .fill)
            } placeholder: {
                Circle()
                    .fill(Color.gray.opacity(0.3))
            }
            .frame(width: 64, height: 64)
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .overlay(alignment: .bottomTrailing) {
                if companion.isOnline {
                    Circle()
                        .fill(Color.teal)
                        .frame(width: 12, height: 12)
                        .overlay(Circle().stroke(Color.white, lineWidth: 2))
                }
            }
            
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(companion.name)
                        .font(.headline)
                    
                    if companion.isVerified {
                        Image(systemName: "checkmark.seal.fill")
                            .foregroundStyle(.teal)
                            .font(.caption)
                    }
                }
                
                HStack(spacing: 4) {
                    Image(systemName: "star.fill")
                        .foregroundStyle(.orange)
                        .font(.caption)
                    Text("\(companion.rating, specifier: "%.1f")")
                        .font(.subheadline)
                    Text("(\(companion.reviewCount))")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                
                HStack {
                    ForEach(companion.tags.prefix(2), id: \.self) { tag in
                        Text(tag)
                            .font(.caption)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 2)
                            .background(Color.gray.opacity(0.1))
                            .clipShape(Capsule())
                    }
                }
                
                Text("¥\(companion.pricePerHour)/小时")
                    .font(.subheadline)
                    .foregroundStyle(.orange)
                    .fontWeight(.medium)
            }
            
            Spacer()
        }
        .padding()
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(Color.gray.opacity(0.2), lineWidth: 0.5)
        )
    }
}
