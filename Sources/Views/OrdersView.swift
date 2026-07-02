import SwiftUI

struct OrdersView: View {
    @EnvironmentObject private var store: AppStore

    var body: some View {
        AppScaffold(title: "订单", spacing: DS.Space.lg) {
            SectionHeader(title: sectionTitle, subtitle: sectionSubtitle)
            if store.user.gender == .male {
                serviceOrdersContent
            } else {
                customerOrdersContent
            }
        }
        .toolbar {
            if store.user.gender != .male {
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

    private var sectionTitle: String {
        store.user.gender == .male ? "待服务订单" : "我的订单"
    }

    private var sectionSubtitle: String {
        store.user.gender == .male ? "别人预约你的未完成服务" : "本地模拟订单状态"
    }

    @ViewBuilder
    private var customerOrdersContent: some View {
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

    @ViewBuilder
    private var serviceOrdersContent: some View {
        let serviceOrders = store.pendingServiceOrdersForCurrentCompanion()
        if serviceOrders.isEmpty {
            EmptyStateView(symbol: "tray", title: "暂无待服务订单", subtitle: "新的预约会出现在这里，完成服务后可手动标记。")
        } else {
            LazyVStack(spacing: DS.Space.md) {
                ForEach(serviceOrders) { order in
                    ServiceOrderCard(order: order)
                }
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
                        Button {
                            store.navigate(.companionHomepage(companion.id))
                        } label: {
                            HStack(spacing: DS.Space.md) {
                                CompanionAvatar(companion: companion, size: 48)
                                companionTitle(companion)
                            }
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("进入\(companion.name)主页")
                    } else {
                        companionTitle(nil)
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

                if showsConversationEntry, let companion {
                    DSPrimaryButton(
                        title: conversationEntryTitle,
                        systemImage: conversationEntryIcon
                    ) {
                        store.navigate(.chat(.companion(id: companion.id)))
                    }
                }
            }
        }
    }

    private func companionTitle(_ companion: Companion?) -> some View {
        VStack(alignment: .leading, spacing: DS.Space.xxs) {
            Text(companion?.name ?? "未知陪伴者")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Color.dsTextPrimary)
            Text(theme?.name ?? "线上沟通")
                .font(.system(size: 13))
                .foregroundStyle(Color.dsTextSecondary)
        }
    }

    private var showsConversationEntry: Bool {
        order.status == .confirmed || order.status == .inProgress || order.status == .completed
    }

    private var conversationEntryTitle: String {
        switch order.status {
        case .inProgress:
            "继续沟通"
        case .completed:
            "查看沟通"
        default:
            "进入沟通"
        }
    }

    private var conversationEntryIcon: String {
        order.status == .completed ? "headphones" : "bubble.left.and.bubble.right"
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

private struct ServiceOrderCard: View {
    let order: Order
    @EnvironmentObject private var store: AppStore

    private var theme: Theme? {
        store.theme(by: order.themeId)
    }

    private var customerTarget: ContactTarget? {
        order.customerTarget
    }

    private var customerName: String {
        customerTarget.map { store.displayName(for: $0) } ?? "下单用户"
    }

    private var customerInitials: String {
        if let initials = customerTarget?.communityInitials {
            return String(initials.prefix(1))
        }
        return String(customerName.prefix(1))
    }

    var body: some View {
        SoftCard {
            VStack(alignment: .leading, spacing: DS.Space.md) {
                HStack(spacing: DS.Space.md) {
                    ServiceCustomerAvatar(initials: customerInitials)
                    VStack(alignment: .leading, spacing: DS.Space.xxs) {
                        Text(customerName)
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

                HStack(spacing: DS.Space.sm) {
                    DSPrimaryButton(
                        title: "进入沟通",
                        systemImage: "bubble.left.and.bubble.right",
                        isEnabled: customerTarget != nil
                    ) {
                        if let customerTarget {
                            store.navigate(.chat(customerTarget))
                        }
                    }

                    DSSecondaryButton(title: "标记完成") {
                        store.completeOrder(id: order.id)
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

private struct ServiceCustomerAvatar: View {
    let initials: String

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: DS.Radius.sm, style: .continuous)
                .fill(Color.dsPrimary.opacity(0.12))
            Text(initials)
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(Color.dsPrimary)
        }
        .frame(width: 48, height: 48)
    }
}
