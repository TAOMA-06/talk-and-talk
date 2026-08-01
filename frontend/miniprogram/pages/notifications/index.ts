import { api, ensureSession } from "../../utils/api";
import { Notification } from "../../utils/models";
import { formatShanghaiDateTime } from "../../utils/order-display";
import { requestTransactionalSubscriptions } from "../../utils/subscription";
import { openNotificationDestination } from "../../utils/notification-router";

type DisplayNotification = Notification & {
  timeText: string;
  typeText: string;
};

const TYPE_LABELS: Record<string, string> = {
  orderStatus: "订单",
  paymentSuccess: "支付",
  messageReceived: "消息",
  supportUpdate: "客服",
  moderation: "安全",
  moderationAlert: "内容安全",
  safetyAlert: "安全案件",
  availabilityReminder: "可约提醒"
};

function displayNotification(item: Notification): DisplayNotification {
  return {
    ...item,
    timeText: formatShanghaiDateTime(item.createdAt),
    typeText: TYPE_LABELS[item.type] || "平台通知"
  };
}

Page({
  data: {
    notifications: [] as DisplayNotification[],
    unreadCount: 0,
    unreadState: "loading" as "loading" | "available" | "error",
    unreadError: "",
    page: 1,
    totalPages: 1,
    total: 0,
    loadingMore: false,
    loading: true,
    error: "",
    markingAll: false,
    enabling: false
  },
  onShow() { void this.load(); },
  onPullDownRefresh() { void this.load(true); },
  async load(stopRefresh = false) {
    this.setData({ loading: true, error: "", notifications: [], unreadCount: 0, unreadState: "loading", unreadError: "" });
    try {
      await ensureSession();
      const [notifications, unread] = await Promise.all([
        api.notifications({ page: 1, pageSize: 20 }),
        api.notificationUnreadCount()
          .then((response) => ({ ...response, available: true }))
          .catch(() => ({ count: 0, available: false }))
      ]);
      this.setData({
        notifications: (notifications.items || []).map(displayNotification),
        page: notifications.pagination?.page || 1,
        totalPages: notifications.pagination?.totalPages || 1,
        total: notifications.pagination?.total || (notifications.items || []).length,
        unreadCount: unread.count || 0,
        unreadState: unread.available ? "available" : "error",
        unreadError: unread.available ? "" : "未读数量暂时无法核对；这不代表没有未读通知。",
        loading: false
      });
    } catch (error) {
      this.setData({ loading: false, error: (error as Error).message || "通知暂时无法加载" });
    } finally {
      if (stopRefresh) wx.stopPullDownRefresh();
    }
  },
  async loadMore() {
    if (this.data.loadingMore || this.data.page >= this.data.totalPages) return;
    this.setData({ loadingMore: true, error: "" });
    try {
      const result = await api.notifications({ page: this.data.page + 1, pageSize: 20 });
      const existing = new Set(this.data.notifications.map((item) => item.id));
      const added = (result.items || []).filter((item) => !existing.has(item.id)).map(displayNotification);
      this.setData({
        notifications: [...this.data.notifications, ...added],
        page: result.pagination.page,
        totalPages: result.pagination.totalPages,
        total: result.pagination.total
      });
    } catch (error) {
      wx.showToast({ title: (error as Error).message || "更多通知暂时无法加载", icon: "none" });
    } finally {
      this.setData({ loadingMore: false });
    }
  },
  async retryUnreadCount() {
    if (this.data.unreadState === "loading") return;
    this.setData({ unreadCount: 0, unreadState: "loading", unreadError: "" });
    try {
      const result = await api.notificationUnreadCount();
      this.setData({ unreadCount: result.count || 0, unreadState: "available", unreadError: "" });
    } catch {
      this.setData({
        unreadCount: 0,
        unreadState: "error",
        unreadError: "未读数量暂时无法核对；这不代表没有未读通知。"
      });
    }
  },
  async enableImportantNotifications() {
    if (this.data.enabling) return;
    this.setData({ enabling: true });
    try {
      const result = await requestTransactionalSubscriptions([
        "orderConfirmed",
        "paymentSuccess",
        "serviceStarted",
        "serviceCompleted",
        "supportUpdate",
        "messageReceived"
      ]);
      wx.showToast({
        title: result.recorded > 0 ? "已记录微信提醒授权" : "未授权；仍可在本页查看",
        icon: "none"
      });
    } catch (error) {
      wx.showToast({ title: (error as Error).message || "提醒授权未完成", icon: "none" });
    } finally {
      this.setData({ enabling: false });
    }
  },
  async markAllRead() {
    if (this.data.unreadState !== "available" || !this.data.unreadCount || this.data.markingAll) return;
    const loadedUnread = this.data.notifications.filter((item) => !item.readAt).length;
    const unseenUnread = Math.max(0, this.data.unreadCount - loadedUnread);
    const confirmation = await new Promise<any>((resolve) => wx.showModal({
      title: `将 ${this.data.unreadCount} 条通知全部标为已读`,
      content: unseenUnread > 0
        ? `当前仅加载了其中 ${loadedUnread} 条未读；另有 ${unseenUnread} 条尚未翻页查看。继续会连同未加载记录一起标记，但不会删除通知。`
        : "继续会标记服务端全部未读通知，但不会删除任何记录，你仍可翻页查看。",
      confirmText: "全部标为已读",
      success: resolve,
      fail: () => resolve({ confirm: false })
    }));
    if (!confirmation.confirm) return;
    this.setData({ markingAll: true });
    try {
      const result = await api.markAllNotificationsRead();
      const readAt = new Date().toISOString();
      this.setData({
        notifications: this.data.notifications.map((item) => ({ ...item, readAt: item.readAt || readAt })),
        unreadCount: 0
      });
      wx.showToast({ title: `已标记 ${result.updated} 条`, icon: "none" });
    } catch (error) {
      wx.showToast({ title: (error as Error).message || "暂时无法全部标为已读", icon: "none" });
    } finally {
      this.setData({ markingAll: false });
    }
  },
  async openNotification(event: any) {
    const id = String(event.currentTarget.dataset.id || "");
    const item = this.data.notifications.find((notification) => notification.id === id);
    if (!item) return;
    let opened: Notification = item;
    if (!item.readAt) {
      try {
        opened = await api.markNotificationRead(item.id);
        this.setData({
          notifications: this.data.notifications.map((notification) => notification.id === item.id
            ? displayNotification(opened)
            : notification),
          ...(this.data.unreadState === "available"
            ? { unreadCount: Math.max(0, this.data.unreadCount - 1) }
            : {})
        });
      } catch (error) {
        wx.showToast({ title: (error as Error).message || "无法更新已读状态", icon: "none" });
      }
    }
    openNotificationDestination(opened);
  }
});
