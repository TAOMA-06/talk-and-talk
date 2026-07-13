import { api, ensureSession } from "../../utils/api";
import { ChatMessage } from "../../utils/models";
import { ensurePrivacyAuthorization } from "../../utils/privacy";

Page({
  data: { messages: [] as ChatMessage[], draft: "", loading: true, sending: false, error: "" },
  conversationId: "",
  onLoad(query: any) { this.conversationId = query.id || ""; void this.load(); },
  onPullDownRefresh() { void this.load(true); },
  async load(stopRefresh = false) {
    try {
      await ensureSession();
      const result = await api.messages(this.conversationId);
      this.setData({ messages: result.messages || [], loading: false, error: "" });
    } catch (error) { this.setData({ loading: false, error: (error as Error).message || "加载消息失败" }); }
    finally { if (stopRefresh) wx.stopPullDownRefresh(); }
  },
  setDraft(event: any) { this.setData({ draft: event.detail.value }); },
  async send() {
    const content = this.data.draft.trim();
    if (!content || this.data.sending) return;
    this.setData({ sending: true });
    try {
      await ensurePrivacyAuthorization();
      const result = await api.sendMessage(this.conversationId, content);
      const next = [...this.data.messages];
      if (result.message) next.push(result.message);
      if (result.safetyMessage) next.push(result.safetyMessage);
      this.setData({ messages: next, draft: "" });
      if (result.moderation.decision !== "allow") wx.showToast({ title: "内容已按平台规则处理", icon: "none" });
    } catch (error) { wx.showToast({ title: (error as Error).message || "发送失败", icon: "none" }); }
    finally { this.setData({ sending: false }); }
  },
  report() {
    wx.showModal({
      title: "举报会话", editable: true, placeholderText: "请说明举报原因", success: async (result: any) => {
        if (!result.confirm || !result.content?.trim()) return;
        try {
          await api.report({ conversationId: this.conversationId, reason: result.content.trim() });
          wx.showToast({ title: "举报已提交", icon: "success" });
        } catch (error) { wx.showToast({ title: (error as Error).message || "提交失败", icon: "none" }); }
      }
    });
  }
});
