import SwiftUI

struct CompanionListView: View {
    let theme: Theme?
    @EnvironmentObject private var store: AppStore
    @State private var filter: FilterType = .all
    @State private var sort: SortType = .rating
    @State private var showFilters = false
    
    enum FilterType: String, CaseIterable {
        case all = "全部"
        case online = "在线"
        case verified = "已认证"
    }
    
    enum SortType: String, CaseIterable {
        case rating = "评分"
        case priceAsc = "价格 ↑"
        case priceDesc = "价格 ↓"
    }
    
    var filteredCompanions: [Companion] {
        var result = store.companions(for: theme)
        
        switch filter {
        case .online:
            result = result.filter { $0.isOnline }
        case .verified:
            result = result.filter { $0.isVerified }
        case .all:
            break
        }
        
        switch sort {
        case .rating:
            result.sort { $0.rating > $1.rating }
        case .priceAsc:
            result.sort { $0.pricePerHour < $1.pricePerHour }
        case .priceDesc:
            result.sort { $0.pricePerHour > $1.pricePerHour }
        }
        
        return result
    }
    
    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                FilterBar
                
                if showFilters {
                    SortOptions
                }
                
                if filteredCompanions.isEmpty {
                    EmptyState
                } else {
                    CompanionsList
                }
            }
            .padding(.vertical)
        }
        .navigationTitle(theme?.name ?? "全部陪伴者")
    }
    
    private var FilterBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                Button {
                    showFilters.toggle()
                } label: {
                    Label("筛选", systemImage: "slider.horizontal.3")
                        .font(.subheadline)
                }
                .buttonStyle(.bordered)
                .tint(.primary)
                
                ForEach(FilterType.allCases, id: \.self) { filterType in
                    Button {
                        filter = filterType
                    } label: {
                        Text(filterType.rawValue)
                            .font(.subheadline)
                    }
                    .buttonStyle(filter == filterType ? BorderlessButtonStyle() : BorderlessButtonStyle())
                    .tint(.primary)
                }
            }
            .padding(.horizontal)
        }
    }
    
    private var SortOptions: some View {
        HStack {
            Text("排序：")
                .font(.subheadline)
                .foregroundStyle(.secondary)
            
            ForEach(SortType.allCases, id: \.self) { sortType in
                Button {
                    sort = sortType
                } label: {
                    Text(sortType.rawValue)
                        .font(.subheadline)
                }
                .buttonStyle(sort == sortType ? BorderlessButtonStyle() : BorderlessButtonStyle())
                .tint(.teal)
            }
            
            Spacer()
            
            Button {
                showFilters = false
            } label: {
                Image(systemName: "xmark")
            }
            .buttonStyle(.bordered)
            .tint(.primary)
        }
        .padding()
        .background(Color.gray.opacity(0.1))
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .padding(.horizontal)
    }
    
    private var CompanionsList: some View {
        LazyVStack(spacing: 12) {
            ForEach(filteredCompanions) { companion in
                CompanionRow(companion: companion)
                    .onTapGesture {
                        store.navigationPath.append(NavigationDestination.companionDetail(companion.id))
                    }
            }
        }
        .padding(.horizontal)
    }
    
    private var EmptyState: some View {
        VStack(spacing: 16) {
            Text("暂无符合条件的陪伴者")
                .foregroundStyle(.secondary)
            
            Button("重置筛选") {
                filter = .all
                sort = .rating
            }
            .tint(.teal)
        }
        .padding(.top, 60)
    }
}
