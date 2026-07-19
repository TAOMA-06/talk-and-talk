import { api, ensureSession } from "../../utils/api";
import { ChatMessage } from "../../utils/models";
import { ensurePrivacyAuthorization } from "../../utils/privacy";

const CHAT_SYNC_INTERVAL_MS = 15_000;

function compareMessages(left: ChatMessage, right: ChatMessage): number {
  const leftTime = Date.parse(left.timestamp);
  const rightTime = Date.parse(right.timestamp);
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
    return leftTime - rightTime;
  }
  if (left.timestamp !== right.timestamp) return left.timestamp.localeCompare(right.timestamp);
  return left.id.localeCompare(right.id);
}

function mergeMessages(...groups: ChatMessage[][]): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  for (const group of groups) {
    for (const message of group) byId.set(message.id, message);
  }
  return [...byId.values()].sort(compareMessages);
}

Page({
  data: {
    messages: [] as ChatMessage[], draft: "", loading: true, loadingOlder: false,
    syncing: false, hasMore: false, sending: false, error: ""
  },
  conversationId: "",
  nextCursor: null as string | null,
  hasMore: false,
  hasLoadedInitial: false,
  isVisible: false,
  syncTimer: null as ReturnType<typeof setInterval> | null,
  initialLoadInFlight: null as Promise<void> | null,
  latestSyncInFlight: null as Promise<void> | null,
  olderLoadInFlight: null as Promise<void> | null,
  onLoad(query: any) {
    this.conversationId = typeof query.id === "string" ? query.id : "";
    if (!this.conversationId) {
      this.setData({ loading: false, error: "会话不存在，请返回会话列表重试" });
      return;
    }
    void this.load();
  },
  onShow() {
    this.isVisible = true;
    this.startSyncTimer();
    if (this.hasLoadedInitial) void this.refreshLatest();
  },
  onHide() {
    this.isVisible = false;
    this.stopSyncTimer();
  },
  onUnload() {
    this.isVisible = false;
    this.stopSyncTimer();
  },
  async onPullDownRefresh() { await this.load(true); },
  async onReachBottom() { await this.loadOlder(); },
  async load(stopRefresh = false) {
    if (!this.conversationId) {
      if (stopRefresh) wx.stopPullDownRefresh();
      return;
    }
    try {
      if (this.hasLoadedInitial) await this.refreshLatest(true);
      else await this.loadInitial();
    }
    finally { if (stopRefresh) wx.stopPullDownRefresh(); }
  },
  startSyncTimer() {
    if (this.syncTimer || !this.conversationId) return;
    this.syncTimer = setInterval(() => {
      if (this.isVisible && this.hasLoadedInitial) void this.refreshLatest();
    }, CHAT_SYNC_INTERVAL_MS);
  },
  stopSyncTimer() {
    if (!this.syncTimer) return;
    clearInterval(this.syncTimer);
    this.syncTimer = null;
  },
  async loadInitial() {
    if (this.initialLoadInFlight) return this.initialLoadInFlight;
    const operation = (async () => {
      this.setData({ loading: true, error: "" });
      try {
        await ensureSession();
        const result = await api.messages(this.conversationId);
        this.nextCursor = result.pagination?.nextCursor || null;
        this.hasMore = Boolean(result.pagination?.hasMore && this.nextCursor);
        this.hasLoadedInitial = true;
        this.setData({
          messages: mergeMessages(this.data.messages as ChatMessage[], result.messages || []),
          loading: false,
          hasMore: this.hasMore,
          error: ""
        });
      } catch (error) {
        this.setData({ loading: false, error: (error as Error).message || "加载消息失败" });
      }
    })();
    this.initialLoadInFlight = operation;
    try { await operation; }
    finally {
      if (this.initialLoadInFlight === operation) this.initialLoadInFlight = null;
    }
  },
  async refreshLatest(showFailure = false) {
    if (!this.hasLoadedInitial) {
      await this.loadInitial();
      return;
    }
    if (this.latestSyncInFlight) return this.latestSyncInFlight;

    const operation = (async () => {
      this.setData({ syncing: true });
      try {
        await ensureSession();
        const existing = this.data.messages as ChatMessage[];
        const knownIds = new Set(existing.map((message) => message.id));
        const latest = await api.messages(this.conversationId);
        const pages: ChatMessage[][] = [latest.messages || []];

        // The API pages backward from the newest message. If more than one page
        // arrived since the previous sync, bridge pages until reaching an already
        // displayed message so a periodic refresh cannot create a gap.
        if (existing.length) {
          let page = latest;
          let overlapsExisting = (page.messages || []).some((message) => knownIds.has(message.id));
          while (!overlapsExisting && page.pagination?.hasMore && page.pagination.nextCursor) {
            page = await api.messages(this.conversationId, { cursor: page.pagination.nextCursor });
            const pageMessages = page.messages || [];
            pages.push(pageMessages);
            overlapsExisting = pageMessages.some((message) => knownIds.has(message.id));
          }
        } else {
          // A previously empty conversation may now have enough messages to be
          // paginated. Start a fresh history cursor in that case.
          this.nextCursor = latest.pagination?.nextCursor || null;
          this.hasMore = Boolean(latest.pagination?.hasMore && this.nextCursor);
        }

        this.setData({
          messages: mergeMessages(this.data.messages as ChatMessage[], ...pages),
          hasMore: this.hasMore
        });
      } catch (error) {
        if (showFailure) wx.showToast({ title: (error as Error).message || "同步消息失败", icon: "none" });
      } finally {
        this.setData({ syncing: false });
      }
    })();
    this.latestSyncInFlight = operation;
    try { await operation; }
    finally {
      if (this.latestSyncInFlight === operation) this.latestSyncInFlight = null;
    }
  },
  async loadOlder() {
    if (!this.hasLoadedInitial || !this.hasMore || !this.nextCursor) return;
    if (this.olderLoadInFlight) return this.olderLoadInFlight;

    const cursor = this.nextCursor;
    const operation = (async () => {
      this.setData({ loadingOlder: true });
      try {
        await ensureSession();
        const result = await api.messages(this.conversationId, { cursor });
        const olderMessages = result.messages || [];
        this.nextCursor = result.pagination?.nextCursor || null;
        this.hasMore = Boolean(olderMessages.length && result.pagination?.hasMore && this.nextCursor);
        this.setData({
          messages: mergeMessages(this.data.messages as ChatMessage[], olderMessages),
          hasMore: this.hasMore
        });
      } catch (error) {
        wx.showToast({ title: (error as Error).message || "加载更早消息失败", icon: "none" });
      } finally {
        this.setData({ loadingOlder: false });
      }
    })();
    this.olderLoadInFlight = operation;
    try { await operation; }
    finally {
      if (this.olderLoadInFlight === operation) this.olderLoadInFlight = null;
    }
  },
  setDraft(event: any) { this.setData({ draft: event.detail.value }); },
  async send() {
    const content = this.data.draft.trim();
    if (!content || this.data.sending) return;
    this.setData({ sending: true });
    try {
      await ensurePrivacyAuthorization();
      const result = await api.sendMessage(this.conversationId, content);
      const outgoing = [result.message, result.safetyMessage].filter((message): message is ChatMessage => Boolean(message));
      this.setData({ messages: mergeMessages(this.data.messages as ChatMessage[], outgoing), draft: "" });
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
