import SwiftUI

struct OrdersView: View {
    @EnvironmentObject private var store: AppStore
    
    var body: some View {
        NavigationStack {
            ScrollView {
                if store.orders.isEmpty {
                    EmptyState
                } else {
                    OrdersList
                }
            }
            .navigationTitle("我的订单")
        }
    }
    
    private var EmptyState: some View {
        VStack(spacing: 16) {
            Image(systemName: "calendar.badge.clock")
                .font(.system(size: 64))
                .foregroundStyle(.secondary)
            
            Text("暂无订单")
                .foregroundStyle(.secondary)
            
            Button("去发现页看看") {
                // Navigate to home
            }
            .tint(.teal)
        }
        .padding(.top, 60)
    }
    
    private var OrdersList: some View {
        LazyVStack(spacing: 12) {
            ForEach(store.orders) { order in
                OrderRow(order: order)
            }
        }
        .padding()
    }
}

struct OrderRow: View {
    let order: Order
    @EnvironmentObject private var store: AppStore
    
    var companion: Companion? {
        store.companion(by: order.companionId)
    }
    
    var statusConfig: (icon: String, color: Color, label: String) {
        switch order.status {
        case .pending:
            return ("clock", .orange, "待确认")
        case .confirmed:
            return ("checkmark.circle", .teal, "已确认")
        case .inProgress:
            return ("message", .teal, "进行中")
        case .completed:
            return ("checkmark.circle", .secondary, "已完成")
        case .cancelled:
            return ("xmark.circle", .secondary, "已取消")
        }
    }
    
    var body: some View {
        HStack(spacing: 12) {
            if let companion = companion {
                AsyncImage(url: URL(string: companion.avatar)) { image in
                    image
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                } placeholder: {
                    Circle()
                        .fill(Color.gray.opacity(0.3))
                }
                .frame(width: 48, height: 48)
                .clipShape(RoundedRectangle(cornerRadius: 12))
            }
            
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(companion?.name ?? "未知")
                        .font(.headline)
                    
                    Spacer()
                    
                    HStack(spacing: 4) {
                        Image(systemName: statusConfig.icon)
                            .font(.caption)
                        Text(statusConfig.label)
                            .font(.subheadline)
                    }
                    .foregroundStyle(statusConfig.color)
                }
                
                Text("\(order.scheduledAt.formatted(date: .abbreviated, time: .shortened)) · \(order.duration, specifier: "%.1f")小时 · ¥\(order.totalPrice)")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            
            Spacer()
        }
        .padding()
        .background(Color.gray.opacity(0.1))
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }
}
