import SwiftUI

struct ProfileView: View {
    @EnvironmentObject private var store: AppStore
    
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 24) {
                    UserCard
                    MenuSection
                    SafetyInfo
                }
                .padding(.vertical)
            }
            .navigationTitle("我的")
        }
    }
    
    private var UserCard: some View {
        HStack(spacing: 16) {
            AsyncImage(url: URL(string: store.user.avatar)) { image in
                image
                    .resizable()
                    .aspectRatio(contentMode: .fill)
            } placeholder: {
                Circle()
                    .fill(Color.gray.opacity(0.3))
            }
            .frame(width: 64, height: 64)
            .clipShape(Circle())
            
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(store.user.name)
                        .font(.title3)
                        .fontWeight(.bold)
                    
                    if store.user.isVerified {
                        Image(systemName: "checkmark.seal.fill")
                            .foregroundStyle(.teal)
                    }
                }
                
                if let phone = store.user.phone {
                    Text(phone)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                
                if !store.user.isVerified {
                    Button {
                        store.navigationPath.append(NavigationDestination.verify)
                    } label: {
                        Text("未认证，点击完成实名认证")
                            .font(.caption)
                            .foregroundStyle(.orange)
                    }
                }
            }
            
            Spacer()
        }
        .padding()
        .background(Color.gray.opacity(0.1))
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .padding(.horizontal)
    }
    
    private var MenuSection: some View {
        VStack(spacing: 12) {
            MenuItem(icon: "shield.checkered", title: "实名认证", showBadge: !store.user.isVerified) {
                store.navigationPath.append(NavigationDestination.verify)
            }
            
            MenuItem(icon: "phone", title: "联系方式", showBadge: false) {}
            
            MenuItem(icon: "person", title: "个人资料", showBadge: false) {}
        }
        .padding(.horizontal)
    }
    
    private var SafetyInfo: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Image(systemName: "shield.checkered")
                    .foregroundStyle(.teal)
                Text("平台保障")
                    .font(.headline)
            }
            
            Text("您的隐私与安全是我们的首要任务。所有沟通内容均经过加密，陪伴者均通过严格审核。")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .padding()
        .background(Color.teal.opacity(0.05))
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(Color.teal.opacity(0.2), lineWidth: 1)
        )
        .padding(.horizontal)
    }
}

struct MenuItem: View {
    let icon: String
    let title: String
    let showBadge: Bool
    let action: () -> Void
    
    var body: some View {
        Button(action: action) {
            HStack {
                HStack(spacing: 12) {
                    Image(systemName: icon)
                        .foregroundStyle(.secondary)
                    
                    Text(title)
                        .font(.subheadline)
                }
                
                Spacer()
                
                HStack(spacing: 8) {
                    if showBadge {
                        Circle()
                            .fill(Color.orange)
                            .frame(width: 8, height: 8)
                    }
                    
                    Image(systemName: "chevron.right")
                        .foregroundStyle(.secondary)
                        .font(.caption)
                }
            }
            .padding()
            .background(Color.gray.opacity(0.1))
            .clipShape(RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
    }
}
