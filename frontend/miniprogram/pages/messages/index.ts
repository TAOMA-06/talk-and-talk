import { api, ensureSession } from "../../utils/api";
import { Conversation } from "../../utils/models";

Page({
  data: { conversations: [] as Array<Conversation & { name: string; preview: string }>, loading: true, error: "" },
  onShow() { void this.load(); },
  onPullDownRefresh() { void this.load(true); },
  async load(stopRefresh = false) {
    this.setData({ loading: true, error: "" });
    try {
      await ensureSession();
      const result = await api.conversations();
      const conversations = (result.conversations || []).map((item: Conversation) => ({
        ...item,
        name: item.participant?.name || "平台会话",
        preview: item.conversationBlockedByYou
          ? "你已为自己拉黑本会话；点此管理"
          : !item.messageInteractionAvailable
            ? "当前会话暂不能继续收发消息"
            : item.lastMessage?.content || "开始一段安全的沟通"
      }));
      this.setData({ conversations, loading: false });
    } catch (error) { this.setData({ loading: false, error: (error as Error).message || "加载会话失败" }); }
    finally { if (stopRefresh) wx.stopPullDownRefresh(); }
  },
  openChat(event: any) { wx.navigateTo({ url: `/pages/chat/index?id=${encodeURIComponent(event.currentTarget.dataset.id)}` }); }
});
