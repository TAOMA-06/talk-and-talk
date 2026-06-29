import SwiftUI

struct OrdersView: View {
    @EnvironmentObject private var store: AppStore

    var body: some View {
        AppScaffold(title: "订单", spacing: 16) {
            SectionHeader(title: "我的订单", subtitle: "本地模拟订单状态")
            if store.orders.isEmpty {
                EmptyStateView(symbol: "calendar.badge.clock", title: "暂无订单", subtitle: "从发现页选择一个陪伴者，完成一次演示下单。")
            } else {
                ForEach(store.orders) { order in
                    OrderCard(order: order)
                }
            }
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    store.selectedTab = .discover
                } label: {
                    Image(systemName: "plus")
                }
                .accessibilityLabel("创建订单")
            }
        }
    }
}

private struct OrderCard: View {
    let order: Order
    @EnvironmentObject private var store: AppStore

    private var companion: Companion? {
        store.companion(by: order.companionId)
    }

    private var theme: Theme? {
        store.theme(by: order.themeId)
    }

    var body: some View {
        GlassPanel(cornerRadius: 24, tint: .white.opacity(0.18)) {
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 12) {
                    if let companion {
                        CompanionAvatar(companion: companion, size: 54)
                    }
                    VStack(alignment: .leading, spacing: 4) {
                        Text(companion?.name ?? "未知陪伴者")
                            .font(.headline)
                            .foregroundStyle(Color.appInk)
                        Text(theme?.name ?? "线上沟通")
                            .font(.subheadline)
                            .foregroundStyle(Color.appMuted)
                    }
                    Spacer()
                    StatusPill(text: order.status.displayName, symbol: order.status.symbol, color: color(for: order.status))
                }

                HStack {
                    Label("\(order.durationMinutes)分钟", systemImage: "timer")
                    Spacer()
                    Label("¥\(order.totalPrice)", systemImage: "creditcard")
                }
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Color.appInk)

                Text(order.scheduledAt.formatted(date: .abbreviated, time: .shortened))
                    .font(.caption)
                    .foregroundStyle(Color.appMuted)

                if order.status == .confirmed || order.status == .inProgress, let companion {
                    PrimaryActionButton(title: order.status == .inProgress ? "继续沟通" : "进入沟通", systemImage: "bubble.left.and.bubble.right") {
                        store.navigate(.chat(companion.id))
                    }
                }
            }
        }
    }

    private func color(for status: OrderStatus) -> Color {
        switch status {
        case .pending, .confirmed: Color.appGold
        case .inProgress: Color.appTeal
        case .completed: Color.appMuted
        case .refunded: Color.appCoral
        }
    }
}
