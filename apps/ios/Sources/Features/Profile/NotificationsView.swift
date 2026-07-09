import SwiftUI

struct NotificationsView: View {
    @EnvironmentObject private var store: AppStore

    var body: some View {
        AppScaffold(title: "消息通知", spacing: DS.Space.lg) {
            if store.notifications.isEmpty {
                EmptyStateView(
                    symbol: "bell.slash",
                    title: "暂无通知",
                    subtitle: "支付结果、订单状态与安全提醒会出现在这里。"
                )
            } else {
                LazyVStack(spacing: DS.Space.md) {
                    ForEach(store.notifications) { item in
                        NotificationRow(item: item) {
                            Task { await store.markNotificationRead(id: item.id) }
                        }
                    }
                }
            }
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("全部已读") {
                    Task { await store.markAllNotificationsRead() }
                }
                .disabled(store.notificationUnreadCount == 0)
                .accessibilityIdentifier("markAllNotificationsReadButton")
            }
        }
        .task {
            await store.loadNotifications()
        }
        .refreshable {
            await store.loadNotifications()
        }
    }
}

private struct NotificationRow: View {
    let item: AppNotification
    let onRead: () -> Void

    var body: some View {
        Button(action: onRead) {
            SoftCard {
                HStack(alignment: .top, spacing: DS.Space.md) {
                    Image(systemName: item.isUnread ? "bell.badge.fill" : "bell")
                        .foregroundStyle(item.isUnread ? Color.dsPrimary : Color.dsTextSecondary)
                        .frame(width: 24)
                    VStack(alignment: .leading, spacing: DS.Space.xxs) {
                        HStack {
                            Text(item.title)
                                .font(.system(size: 15, weight: .semibold))
                                .foregroundStyle(Color.dsTextPrimary)
                            Spacer()
                            StatusPill(
                                text: item.type.displayName,
                                symbol: "tag",
                                color: Color.dsPrimary
                            )
                        }
                        Text(item.body)
                            .font(.system(size: 13))
                            .foregroundStyle(Color.dsTextSecondary)
                            .multilineTextAlignment(.leading)
                        Text(item.createdAt.formatted(date: .abbreviated, time: .shortened))
                            .font(.system(size: 11))
                            .foregroundStyle(Color.dsTextSecondary)
                    }
                }
            }
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("notificationRow-\(item.id)")
    }
}
