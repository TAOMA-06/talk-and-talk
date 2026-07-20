import { api, ApiError, ensureSession, readLocalFile, uploadAuthorizedMedia } from "../../utils/api";
import { ChatMessage } from "../../utils/models";
import { ensurePrivacyAuthorization } from "../../utils/privacy";
import { sha256Hex } from "../../utils/sha256";

const CHAT_SYNC_INTERVAL_MS = 15_000;
const RESTRICTION_REFRESH_INTERVAL_MS = 30_000;

type MediaInput = {
  kind: "image" | "audio";
  path: string;
  mimeType: string;
  durationMs?: number;
};

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

function formatRemaining(endsAt: string): string {
  const milliseconds = Date.parse(endsAt) - Date.now();
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return "";
  const totalMinutes = Math.ceil(milliseconds / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours ? `${hours}小时${minutes}分钟` : `${minutes}分钟`;
}

function chatRestrictionFromError(error: unknown): { endsAt: string; reason: string } | null {
  const apiError = error as ApiError;
  const endsAt = typeof apiError?.details?.endsAt === "string" ? apiError.details.endsAt : "";
  if (apiError?.code !== "CHAT_RESTRICTED" || !endsAt || !formatRemaining(endsAt)) return null;
  return {
    endsAt,
    reason: typeof apiError.details?.reason === "string" ? apiError.details.reason : "聊天发送功能暂时受限"
  };
}

function imageMimeType(path: string): string {
  const extension = path.split("?")[0].split(".").pop()?.toLowerCase();
  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";
  return "image/jpeg";
}

Page({
  data: {
    messages: [] as ChatMessage[],
    draft: "",
    loading: true,
    loadingOlder: false,
    syncing: false,
    hasMore: false,
    sending: false,
    mediaUploading: false,
    mediaEnabled: false,
    recording: false,
    restrictionEndsAt: "",
    restrictionNotice: "",
    appealCaseId: "",
    error: ""
  },
  conversationId: "",
  nextCursor: null as string | null,
  hasMore: false,
  hasLoadedInitial: false,
  isVisible: false,
  syncTimer: null as ReturnType<typeof setInterval> | null,
  restrictionTimer: null as ReturnType<typeof setInterval> | null,
  recorder: null as any,
  audioPlayer: null as any,
  initialLoadInFlight: null as Promise<void> | null,
  latestSyncInFlight: null as Promise<void> | null,
  olderLoadInFlight: null as Promise<void> | null,
  onLoad(query: any) {
    this.conversationId = typeof query.id === "string" ? query.id : "";
    if (!this.conversationId) {
      this.setData({ loading: false, error: "会话不存在，请返回会话列表重试" });
      return;
    }
    this.ensureRecorder();
    void this.load();
  },
  onShow() {
    this.isVisible = true;
    this.startSyncTimer();
    if (this.hasLoadedInitial) {
      void this.refreshLatest();
      void this.refreshConversationStatus();
    }
  },
  onHide() {
    this.isVisible = false;
    this.stopSyncTimer();
  },
  onUnload() {
    this.isVisible = false;
    this.stopSyncTimer();
    this.stopRestrictionTimer();
    if (this.data.recording) this.recorder?.stop?.();
    this.audioPlayer?.destroy?.();
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
  startRestrictionTimer() {
    if (this.restrictionTimer) return;
    this.restrictionTimer = setInterval(() => this.updateRestrictionNotice(), RESTRICTION_REFRESH_INTERVAL_MS);
  },
  stopRestrictionTimer() {
    if (!this.restrictionTimer) return;
    clearInterval(this.restrictionTimer);
    this.restrictionTimer = null;
  },
  updateRestrictionNotice() {
    const remaining = formatRemaining(this.data.restrictionEndsAt);
    if (!remaining) {
      this.stopRestrictionTimer();
      this.setData({ restrictionEndsAt: "", restrictionNotice: "" });
      return;
    }
    this.setData({ restrictionNotice: `聊天限言中，还剩 ${remaining}` });
  },
  applyRestriction(restriction: { endsAt: string; reason: string } | null) {
    if (!restriction) {
      this.stopRestrictionTimer();
      this.setData({ restrictionEndsAt: "", restrictionNotice: "" });
      return;
    }
    this.setData({ restrictionEndsAt: restriction.endsAt });
    this.updateRestrictionNotice();
    this.startRestrictionTimer();
  },
  async refreshConversationStatus() {
    if (!this.conversationId) return;
    try {
      const status = await api.conversationStatus(this.conversationId);
      this.setData({ mediaEnabled: status.mediaEnabled });
      this.applyRestriction(status.chatRestriction);
    } catch {
      // Sending still receives authoritative restriction errors. Do not replace
      // a working timeline with a status-only transient failure.
    }
  },
  async loadInitial() {
    if (this.initialLoadInFlight) return this.initialLoadInFlight;
    const operation = (async () => {
      this.setData({ loading: true, error: "" });
      try {
        await ensureSession();
        const [result, status] = await Promise.all([
          api.messages(this.conversationId),
          api.conversationStatus(this.conversationId)
        ]);
        this.nextCursor = result.pagination?.nextCursor || null;
        this.hasMore = Boolean(result.pagination?.hasMore && this.nextCursor);
        this.hasLoadedInitial = true;
        this.setData({
          messages: mergeMessages(this.data.messages as ChatMessage[], result.messages || []),
          loading: false,
          hasMore: this.hasMore,
          mediaEnabled: status.mediaEnabled,
          error: ""
        });
        this.applyRestriction(status.chatRestriction);
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
          this.nextCursor = latest.pagination?.nextCursor || null;
          this.hasMore = Boolean(latest.pagination?.hasMore && this.nextCursor);
        }

        this.setData({
          messages: mergeMessages(this.data.messages as ChatMessage[], ...pages),
          hasMore: this.hasMore
        });
        void this.refreshConversationStatus();
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
  handleSendResult(result: Awaited<ReturnType<typeof api.sendMessage>>, clearDraft = true) {
    const outgoing = [result.message, result.safetyMessage].filter((message): message is ChatMessage => Boolean(message));
    this.setData({
      messages: mergeMessages(this.data.messages as ChatMessage[], outgoing),
      ...(clearDraft ? { draft: "" } : {}),
      ...(result.moderation.appealEligible && result.moderation.caseId ? { appealCaseId: result.moderation.caseId } : {})
    });
    switch (result.moderation.deliveryStatus) {
      case "queued":
        wx.showToast({ title: "媒体审核中，仅自己可见", icon: "none" });
        break;
      case "pendingReview":
        wx.showToast({ title: "消息审核中，暂未送达", icon: "none" });
        break;
      case "blocked":
        wx.showToast({ title: "消息未送达", icon: "none" });
        break;
    }
  },
  handleSendError(error: unknown, fallback: string) {
    const restriction = chatRestrictionFromError(error);
    if (restriction) {
      this.applyRestriction(restriction);
      wx.showToast({ title: "当前处于聊天限言", icon: "none" });
      return;
    }
    wx.showToast({ title: (error as Error).message || fallback, icon: "none" });
  },
  async send() {
    const content = this.data.draft.trim();
    if (!content || this.data.sending || this.data.mediaUploading || this.data.restrictionEndsAt) return;
    this.setData({ sending: true });
    try {
      await ensurePrivacyAuthorization();
      this.handleSendResult(await api.sendMessage(this.conversationId, content));
    } catch (error) { this.handleSendError(error, "发送失败"); }
    finally { this.setData({ sending: false }); }
  },
  chooseImage() {
    if (!this.data.mediaEnabled) {
      wx.showToast({ title: "当前环境未启用媒体消息", icon: "none" });
      return;
    }
    wx.chooseMedia({
      count: 1,
      mediaType: ["image"],
      sourceType: ["album", "camera"],
      success: (result: any) => {
        const file = result.tempFiles?.[0];
        if (!file?.tempFilePath) return;
        void this.sendMedia({
          kind: "image",
          path: file.tempFilePath,
          mimeType: imageMimeType(file.tempFilePath)
        });
      }
    });
  },
  ensureRecorder() {
    if (this.recorder || !wx.getRecorderManager) return this.recorder;
    const recorder = wx.getRecorderManager();
    recorder.onStop((result: any) => {
      this.setData({ recording: false });
      if (!result?.tempFilePath) return;
      void this.sendMedia({
        kind: "audio",
        path: result.tempFilePath,
        mimeType: "audio/mpeg",
        durationMs: Math.max(1, Math.min(Number(result.duration) || 1, 60_000))
      });
    });
    recorder.onError(() => {
      this.setData({ recording: false });
      wx.showToast({ title: "语音录制失败，请检查麦克风权限", icon: "none" });
    });
    this.recorder = recorder;
    return recorder;
  },
  async toggleRecord() {
    if (!this.data.mediaEnabled) {
      wx.showToast({ title: "当前环境未启用媒体消息", icon: "none" });
      return;
    }
    if (this.data.mediaUploading || this.data.sending || this.data.restrictionEndsAt) return;
    const recorder = this.ensureRecorder();
    if (!recorder) {
      wx.showToast({ title: "当前微信版本不支持语音录制", icon: "none" });
      return;
    }
    if (this.data.recording) {
      recorder.stop();
      return;
    }
    try {
      await ensurePrivacyAuthorization();
      recorder.start({ duration: 60_000, format: "mp3", sampleRate: 16_000, numberOfChannels: 1, encodeBitRate: 48_000 });
      this.setData({ recording: true });
    } catch (error) {
      this.handleSendError(error, "无法开始录音");
    }
  },
  async sendMedia(input: MediaInput) {
    if (this.data.mediaUploading || this.data.sending || this.data.restrictionEndsAt) return;
    this.setData({ mediaUploading: true });
    try {
      await ensurePrivacyAuthorization();
      const bytes = await readLocalFile(input.path);
      const reservation = await api.reserveMediaUpload(this.conversationId, {
        kind: input.kind,
        mimeType: input.mimeType,
        sizeBytes: bytes.byteLength,
        sha256: sha256Hex(bytes),
        ...(input.durationMs ? { durationMs: input.durationMs } : {})
      });
      await uploadAuthorizedMedia(reservation.upload, bytes);
      await api.completeMediaUpload(this.conversationId, reservation.asset.id);
      this.handleSendResult(await api.sendMessage(this.conversationId, "", [reservation.asset.id]), false);
    } catch (error) {
      this.handleSendError(error, "媒体发送失败");
    } finally {
      this.setData({ mediaUploading: false });
    }
  },
  previewImage(event: any) {
    const url = event.currentTarget.dataset.url;
    if (typeof url === "string" && url) wx.previewImage({ current: url, urls: [url] });
  },
  playAudio(event: any) {
    const url = event.currentTarget.dataset.url;
    if (typeof url !== "string" || !url) return;
    this.audioPlayer?.destroy?.();
    const player = wx.createInnerAudioContext();
    player.src = url;
    player.onError(() => wx.showToast({ title: "语音暂时无法播放", icon: "none" }));
    player.play();
    this.audioPlayer = player;
  },
  report() { this.openReport(); },
  reportMessage(event: any) {
    const messageId = event.currentTarget.dataset.messageId;
    this.openReport(typeof messageId === "string" ? messageId : undefined);
  },
  openReport(messageId?: string) {
    wx.showModal({
      title: messageId ? "举报这条消息" : "举报会话",
      editable: true,
      placeholderText: "请说明举报原因",
      success: async (result: any) => {
        if (!result.confirm || !result.content?.trim()) return;
        try {
          await api.report({
            conversationId: this.conversationId,
            ...(messageId ? { messageId } : {}),
            reason: result.content.trim()
          });
          wx.showToast({ title: "举报已提交", icon: "success" });
        } catch (error) { this.handleSendError(error, "提交失败"); }
      }
    });
  },
  appeal() {
    const caseId = this.data.appealCaseId;
    if (!caseId) return;
    wx.showModal({
      title: "申请复核",
      editable: true,
      placeholderText: "请说明你认为处置有误的原因",
      success: async (result: any) => {
        if (!result.confirm || !result.content?.trim()) return;
        try {
          await api.appeal(caseId, result.content.trim());
          this.setData({ appealCaseId: "" });
          wx.showToast({ title: "申诉已提交", icon: "success" });
        } catch (error) { this.handleSendError(error, "申诉提交失败"); }
      }
    });
  }
});
