import SwiftUI

struct OrdersView: View {
    @EnvironmentObject private var store: AppStore

    var body: some View {
        AppScaffold(title: "订单", spacing: DS.Space.lg) {
            SectionHeader(title: "我的订单", subtitle: "查看预约与沟通记录")
            customerOrdersContent
            if store.orders.contains(where: { $0.customerTarget != nil }) {
                SectionHeader(title: "待服务订单", subtitle: "用户预约的服务订单")
                serviceOrdersContent
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
        .task {
            await store.loadOrders()
        }
        .refreshable {
            await store.loadOrders()
        }
    }

    @ViewBuilder
    private var customerOrdersContent: some View {
        let customerOrders = store.orders.filter { $0.customerTarget == nil }
        let activeOrders = customerOrders.filter { $0.status.isActive }
        let historyOrders = customerOrders.filter { !$0.status.isActive }

        if customerOrders.isEmpty {
            let copy = MarketplaceEmptyCopy.content(for: .orders)
            EmptyStateView(
                content: copy,
                action: { store.selectedTab = .discover },
                compact: true
            )
            .background(
                Color.dsSurfaceElevated,
                in: RoundedRectangle(cornerRadius: DS.Radius.lg, style: .continuous)
            )
            .overlay {
                RoundedRectangle(cornerRadius: DS.Radius.lg, style: .continuous)
                    .stroke(Color.dsBorder.opacity(0.68), lineWidth: DS.Stroke.hairline)
            }
            .accessibilityIdentifier("ordersEmptyState")
        } else {
            LazyVStack(spacing: DS.Space.lg) {
                if !activeOrders.isEmpty {
                    orderSection(title: "进行中", subtitle: "可进入沟通继续服务") {
                        ForEach(activeOrders) { order in
                            OrderCard(order: order)
                        }
                    }
                }
                if !historyOrders.isEmpty {
                    orderSection(title: "历史订单", subtitle: "已完成或已退款的记录") {
                        ForEach(historyOrders) { order in
                            OrderCard(order: order)
                        }
                    }
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

    private func orderSection<Content: View>(
        title: String,
        subtitle: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: DS.Space.md) {
            SectionHeader(title: title, subtitle: subtitle)
            LazyVStack(spacing: DS.Space.md) {
                content()
            }
        }
    }
}

private extension OrderStatus {
    var detailText: String {
        switch self {
        case .pending: "待支付，完成支付后可进入沟通"
        case .paying: "正在等待微信支付结果"
        case .paid: "已支付，可以进入沟通"
        case .inService: "服务进行中"
        case .completed: "服务已结束"
        case .cancelled: "订单已取消"
        case .refunded: "订单已退款"
        }
    }
}

private struct OrderDetailsSection: View {
    let themeName: String
    let durationMinutes: Int
    let totalPrice: Int
    let scheduledAt: Date
    let status: OrderStatus

    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.sm) {
            detailRow(title: "沟通主题", value: themeName)
            detailRow(title: "沟通时长", value: "\(durationMinutes) 分钟")
            detailRow(title: "订单金额", value: "¥\(totalPrice)")
            detailRow(title: "预约时间", value: scheduledAt.formatted(date: .abbreviated, time: .shortened))

            HStack(alignment: .top) {
                Text("订单状态")
                    .font(.system(size: 12))
                    .foregroundStyle(Color.dsTextSecondary)
                Spacer()
                VStack(alignment: .trailing, spacing: DS.Space.xxs) {
                    StatusPill(text: status.displayName, symbol: status.symbol, color: statusColor(for: status))
                    Text(status.detailText)
                        .font(.system(size: 11))
                        .foregroundStyle(Color.dsTextSecondary)
                        .multilineTextAlignment(.trailing)
                }
            }
        }
        .padding(DS.Space.md)
        .background(Color.dsBackground, in: RoundedRectangle(cornerRadius: DS.Radius.md, style: .continuous))
    }

    private func detailRow(title: String, value: String) -> some View {
        HStack {
            Text(title)
                .font(.system(size: 12))
                .foregroundStyle(Color.dsTextSecondary)
            Spacer()
            Text(value)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Color.dsTextPrimary)
        }
    }

    private func statusColor(for status: OrderStatus) -> Color {
        switch status {
        case .pending, .paying: Color.dsWarning
        case .paid, .inService: Color.dsPrimary
        case .completed: Color.dsTextSecondary
        case .cancelled, .refunded: Color.dsDanger
        }
    }
}

private struct OrderCard: View {
    let order: Order
    @EnvironmentObject private var store: AppStore
    @State private var showingRefund = false

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
                }

                OrderDetailsSection(
                    themeName: order.themeNameSnapshot ?? theme?.name ?? "线上沟通",
                    durationMinutes: order.durationMinutes,
                    totalPrice: order.totalPrice,
                    scheduledAt: order.scheduledAt,
                    status: order.status
                )

                if showsConversationEntry, let companion {
                    DSPrimaryButton(
                        title: conversationEntryTitle,
                        systemImage: conversationEntryIcon
                    ) {
                        store.navigate(.chat(.companion(id: companion.id)))
                    }
                }

                if order.status.canCancel {
                    DSButton(title: "取消订单", systemImage: "xmark.circle", variant: .secondary, height: 40) {
                        Task { await store.cancelOrder(id: order.id) }
                    }
                }

                if let refund = order.refund {
                    StatusPill(text: refund.status.displayName, symbol: "arrow.uturn.backward.circle", color: refund.status == .success ? Color.dsSuccess : Color.dsWarning)
                } else if [.paid, .inService, .completed].contains(order.status) {
                    DSButton(title: "申请退款 / 售后", systemImage: "arrow.uturn.backward.circle", variant: .secondary, height: 40) {
                        showingRefund = true
                    }
                }
            }
        }
        .sheet(isPresented: $showingRefund) {
            RefundRequestSheet(order: order)
                .environmentObject(store)
        }
    }

    private func companionTitle(_ companion: Companion?) -> some View {
        VStack(alignment: .leading, spacing: DS.Space.xxs) {
            Text(order.companionNameSnapshot ?? companion?.name ?? "陪伴服务")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Color.dsTextPrimary)
            Text(order.companionRoleSnapshot ?? companion?.role ?? "线上沟通")
                .font(.system(size: 13))
                .foregroundStyle(Color.dsTextSecondary)
        }
    }

    private var showsConversationEntry: Bool {
        order.status.allowsChat
    }

    private var conversationEntryTitle: String {
        switch order.status {
        case .inService:
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
}

private struct RefundRequestSheet: View {
    let order: Order
    @EnvironmentObject private var store: AppStore
    @Environment(\.dismiss) private var dismiss
    @State private var reason = "行程有变，服务尚未开始"
    @State private var isSubmitting = false
    @State private var resultMessage: String?
    private let reasons = ["行程有变，服务尚未开始", "重复下单", "无法联系陪伴者", "服务体验问题", "其他原因"]

    var body: some View {
        NavigationStack {
            Form {
                Section("退款金额") {
                    Text("¥\(order.totalPrice)（全额原路退回）")
                    Text(order.status == .paid ? "服务未开始时将自动申请全额退款。" : "服务中或已完成的订单将进入人工售后审核。")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                Section("申请原因") {
                    Picker("原因", selection: $reason) {
                        ForEach(reasons, id: \.self) { Text($0).tag($0) }
                    }
                }
                if let resultMessage {
                    Section { Text(resultMessage) }
                }
                Section {
                    Button(isSubmitting ? "正在提交…" : "确认提交退款申请") {
                        submit()
                    }
                    .disabled(isSubmitting)
                }
            }
            .navigationTitle("退款 / 售后")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("关闭") { dismiss() } } }
        }
    }

    private func submit() {
        isSubmitting = true
        Task {
            do {
                let updated = try await store.requestRefund(orderId: order.id, reason: reason)
                resultMessage = updated.refund?.status.displayName ?? "申请已提交"
            } catch {
                resultMessage = (error as? BackendError)?.userFacingMessage ?? "提交失败，请稍后重试"
            }
            isSubmitting = false
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

    private var canMarkComplete: Bool {
        order.status == .paid || order.status == .inService
    }

    var body: some View {
        SoftCard {
            VStack(alignment: .leading, spacing: DS.Space.md) {
                HStack {
                    TrustMicroBadge(text: "服务订单", tone: .primary)
                    Spacer()
                }

                HStack(spacing: DS.Space.md) {
                    ServiceCustomerAvatar(initials: customerInitials)
                    VStack(alignment: .leading, spacing: DS.Space.xxs) {
                        Text("预约用户")
                            .font(.system(size: 11, weight: .medium))
                            .foregroundStyle(Color.dsTextSecondary)
                        Text(customerName)
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(Color.dsTextPrimary)
                    }
                    Spacer()
                }

                OrderDetailsSection(
                    themeName: theme?.name ?? "线上沟通",
                    durationMinutes: order.durationMinutes,
                    totalPrice: order.totalPrice,
                    scheduledAt: order.scheduledAt,
                    status: order.status
                )

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

                    if canMarkComplete {
                        DSSecondaryButton(title: "标记完成") {
                            store.completeOrder(id: order.id)
                        }
                    }
                }

                Text("请在平台内完成服务，勿引导私下联系。")
                    .font(.system(size: 11))
                    .foregroundStyle(Color.dsTextSecondary)
            }
        }
    }
}

private struct ServiceCustomerAvatar: View {
    let initials: String

    var body: some View {
        DSInitialsAvatar(initials: initials, tone: .primary, size: 48)
    }
}
