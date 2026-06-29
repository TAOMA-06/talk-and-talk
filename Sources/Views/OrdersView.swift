import SwiftUI

struct OrdersView: View {
    @EnvironmentObject private var store: AppStore

    var body: some View {
        AppScaffold(title: "订单", spacing: DS.Space.lg) {
            SectionHeader(title: "我的订单", subtitle: "本地模拟订单状态")
            if store.orders.isEmpty {
                EmptyStateView(symbol: "calendar.badge.clock", title: "暂无订单", subtitle: "从发现页选择一个陪伴者，完成一次演示下单。")
            } else {
                LazyVStack(spacing: DS.Space.md) {
                    ForEach(store.orders) { order in
                        OrderCard(order: order)
                    }
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
        SoftCard {
            VStack(alignment: .leading, spacing: DS.Space.md) {
                HStack(spacing: DS.Space.md) {
                    if let companion {
                        CompanionAvatar(companion: companion, size: 48)
                    }
                    VStack(alignment: .leading, spacing: DS.Space.xxs) {
                        Text(companion?.name ?? "未知陪伴者")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(Color.dsTextPrimary)
                        Text(theme?.name ?? "线上沟通")
                            .font(.system(size: 13))
                            .foregroundStyle(Color.dsTextSecondary)
                    }
                    Spacer()
                    StatusPill(text: order.status.displayName, symbol: order.status.symbol, color: color(for: order.status))
                }

                HStack {
                    Label("\(order.durationMinutes)分钟", systemImage: "timer")
                    Spacer()
                    Label("¥\(order.totalPrice)", systemImage: "creditcard")
                }
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.dsTextPrimary)

                Text(order.scheduledAt.formatted(date: .abbreviated, time: .shortened))
                    .font(.system(size: 11))
                    .foregroundStyle(Color.dsTextSecondary)

                if order.status == .confirmed || order.status == .inProgress, let companion {
                    DSPrimaryButton(
                        title: order.status == .inProgress ? "继续沟通" : "进入沟通",
                        systemImage: "bubble.left.and.bubble.right"
                    ) {
                        store.navigate(.chat(companion.id))
                    }
                }
            }
        }
    }

    private func color(for status: OrderStatus) -> Color {
        switch status {
        case .pending, .confirmed: Color.dsWarning
        case .inProgress: Color.dsPrimary
        case .completed: Color.dsTextSecondary
        case .refunded: Color.dsDanger
        }
    }
}
