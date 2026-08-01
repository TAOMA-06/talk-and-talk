import { api, ensureSession } from "../../utils/api";
import { Conversation } from "../../utils/models";
import { formatShanghaiDateTime } from "../../utils/order-display";

Page({
  data: {
    conversations: [] as Array<Conversation & { name: string; preview: string; updatedAtText: string }>,
    unreadNotificationCount: 0,
    activeSupportCount: null as number | null,
    activeSupportCountText: "—",
    activeSupportCountUnknown: true,
    conversationPage: 1,
    conversationTotalPages: 1,
    conversationTotal: 0,
    loadingMore: false,
    loadMoreError: "",
    loading: true,
    error: "",
    partialWarning: ""
  },
  onShow() { void this.load(); },
  onPullDownRefresh() { void this.load(true); },
  async load(stopRefresh = false) {
    this.setData({ loading: true, error: "", partialWarning: "" });
    try {
      await ensureSession();
      const [result, unread, support] = await Promise.all([
        api.conversations({ page: 1, pageSize: 20 }),
        api.notificationUnreadCount().then((value) => ({ ok: true as const, value }))
          .catch(() => ({ ok: false as const, value: { count: 0 } })),
        api.conversationSummary().then((value) => ({ ok: true as const, value }))
          .catch(() => ({ ok: false as const, value: { activeSupportCount: null as number | null } }))
      ]);
      const conversations = (result.conversations || []).map((item: Conversation) => ({
        ...item,
        name: item.participant?.name || "平台会话",
        updatedAtText: formatShanghaiDateTime(item.updatedAt),
        preview: item.conversationBlockedByYou
          ? "你已为自己拉黑本会话；点此管理"
          : !item.messageInteractionAvailable
            ? item.messageHistoryAvailable
              ? "订单服务已结束，消息记录仅供查看"
              : "当前会话暂不能继续收发消息"
            : item.lastMessage?.content || "开始一段安全的沟通"
      }));
      this.setData({
        conversations,
        unreadNotificationCount: unread.value.count || 0,
        activeSupportCount: support.value.activeSupportCount,
        activeSupportCountText: support.ok ? String(support.value.activeSupportCount || 0) : "—",
        activeSupportCountUnknown: !support.ok,
        conversationPage: result.pagination?.page || 1,
        conversationTotalPages: result.pagination?.totalPages || 1,
        conversationTotal: result.pagination?.total || conversations.length,
        loadMoreError: "",
        partialWarning: !unread.ok || !support.ok ? "会话已加载，但通知或客服摘要暂时未能读取。" : "",
        loading: false
      });
    } catch (error) { this.setData({ loading: false, error: (error as Error).message || "加载会话失败" }); }
    finally { if (stopRefresh) wx.stopPullDownRefresh(); }
  },
  async loadMoreConversations() {
    if (this.data.loadingMore || this.data.conversationPage >= this.data.conversationTotalPages) return;
    const nextPage = this.data.conversationPage + 1;
    this.setData({ loadingMore: true, loadMoreError: "" });
    try {
      const result = await api.conversations({ page: nextPage, pageSize: 20 });
      const incoming = (result.conversations || []).map((item: Conversation) => ({
        ...item,
        name: item.participant?.name || "平台会话",
        updatedAtText: formatShanghaiDateTime(item.updatedAt),
        preview: item.conversationBlockedByYou
          ? "你已为自己拉黑本会话；点此管理"
          : !item.messageInteractionAvailable
            ? item.messageHistoryAvailable
              ? "订单服务已结束，消息记录仅供查看"
              : "当前会话暂不能继续收发消息"
            : item.lastMessage?.content || "开始一段安全的沟通"
      }));
      const byId = new Map(this.data.conversations.map((item) => [item.id, item]));
      incoming.forEach((item) => byId.set(item.id, item));
      this.setData({
        conversations: [...byId.values()],
        conversationPage: result.pagination?.page || nextPage,
        conversationTotalPages: result.pagination?.totalPages || nextPage,
        conversationTotal: result.pagination?.total || byId.size,
        loadMoreError: ""
      });
    } catch (error) {
      this.setData({ loadMoreError: (error as Error).message || "更多会话暂时无法读取；已加载内容仍保留。" });
    } finally {
      this.setData({ loadingMore: false });
    }
  },
  openChat(event: any) { wx.navigateTo({ url: `/pages/chat/index?id=${encodeURIComponent(event.currentTarget.dataset.id)}` }); },
  openNotifications() { wx.navigateTo({ url: "/pages/notifications/index" }); },
  openSupport() { wx.navigateTo({ url: "/pages/support/index" }); },
  openSafety() { wx.navigateTo({ url: "/pages/safety/index" }); },
  openOrders() { wx.switchTab({ url: "/pages/orders/index" }); }
});
