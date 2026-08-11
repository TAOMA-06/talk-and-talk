import { api, ApiError, ensureSession, readLocalFile, uploadAuthorizedMedia } from "../../utils/api";
import { clientChatMediaEnabled, isCommercialTextOnly } from "../../utils/config";
import { openCrisisResources } from "../../utils/crisis-gate";
import { ChatMessage } from "../../utils/models";
import { ensurePrivacyAuthorization } from "../../utils/privacy";
import {
  isPublicInteractionIdentityError,
  publicInteractionErrorUserMessage,
  publicInteractionRecoveryPath
} from "../../utils/public-interaction-errors";
import { sha256Hex } from "../../utils/sha256";
import { requestTransactionalSubscriptions } from "../../utils/subscription";

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
    for (const message of group) {
      // Historic media must not leak back into a text-only release just because
      // an older server record still contains an attachment reference.
      byId.set(message.id, isCommercialTextOnly() ? { ...message, attachments: [] } : message);
    }
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
    textOnly: isCommercialTextOnly(),
    messageNotificationsMuted: false,
    messageNotificationUpdating: false,
    conversationBlockedByYou: false,
    viewerCanManageFutureBookingBoundary: false,
    futureBookingsDeclinedByYou: false,
    futureBookingBoundaryUpdating: false,
    messageHistoryAvailable: true,
    messageInteractionAvailable: true,
    conversationBlockUpdating: false,
    recording: false,
    hasConversation: false,
    hasLoadedInitial: false,
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
      this.setData({ loading: false, hasConversation: false, error: "会话不存在，请返回会话列表重试" });
      return;
    }
    this.setData({ hasConversation: true });
    if (!isCommercialTextOnly()) this.ensureRecorder();
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
      this.setData({ hasConversation: false });
      if (stopRefresh) wx.stopPullDownRefresh();
      return;
    }
    this.setData({ hasConversation: true });
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
      this.setData({
        mediaEnabled: clientChatMediaEnabled(status.mediaEnabled),
        messageNotificationsMuted: status.messageNotificationsMuted,
        conversationBlockedByYou: status.conversationBlockedByYou,
        viewerCanManageFutureBookingBoundary: status.viewerCanManageFutureBookingBoundary,
        futureBookingsDeclinedByYou: status.futureBookingsDeclinedByYou,
        messageHistoryAvailable: status.messageHistoryAvailable,
        messageInteractionAvailable: status.messageInteractionAvailable
      });
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
          hasLoadedInitial: true,
          hasMore: this.hasMore,
          mediaEnabled: clientChatMediaEnabled(status.mediaEnabled),
          messageNotificationsMuted: status.messageNotificationsMuted,
          conversationBlockedByYou: status.conversationBlockedByYou,
          viewerCanManageFutureBookingBoundary: status.viewerCanManageFutureBookingBoundary,
          futureBookingsDeclinedByYou: status.futureBookingsDeclinedByYou,
          messageHistoryAvailable: status.messageHistoryAvailable,
          messageInteractionAvailable: status.messageInteractionAvailable,
          error: ""
        });
        this.applyRestriction(status.chatRestriction);
      } catch (error) {
        this.hasLoadedInitial = false;
        this.setData({
          loading: false,
          hasLoadedInitial: false,
          error: (error as Error).message || "加载消息失败"
        });
      }
    })();
    this.initialLoadInFlight = operation;
    try { await operation; }
    finally {
      if (this.initialLoadInFlight === operation) this.initialLoadInFlight = null;
    }
  },
  async retryInitial() {
    if (this.data.loading || this.hasLoadedInitial) return;
    await this.loadInitial();
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
        wx.showToast({ title: "内容审核中，仅自己可见", icon: "none" });
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
    if ((error as ApiError)?.code === "CONVERSATION_INTERACTION_UNAVAILABLE") {
      this.setData({ messageInteractionAvailable: false });
      wx.showToast({ title: "当前会话无法继续收发消息", icon: "none" });
      return;
    }
    if (isPublicInteractionIdentityError(error as ApiError)) {
      const recoveryPath = publicInteractionRecoveryPath(error as ApiError);
      wx.showModal({
        title: "需要完成身份核验",
        content: publicInteractionErrorUserMessage(error as ApiError),
        confirmText: "去核验",
        cancelText: "稍后",
        success: (result) => {
          if (result.confirm && recoveryPath?.startsWith("/pages/")) {
            wx.navigateTo({ url: recoveryPath, fail: () => wx.switchTab({ url: recoveryPath }) });
          }
        }
      });
      return;
    }
    wx.showToast({ title: (error as Error).message || fallback, icon: "none" });
  },
  async send() {
    const content = this.data.draft.trim();
    if (!content || this.data.sending || this.data.mediaUploading || this.data.restrictionEndsAt || !this.data.messageInteractionAvailable) return;
    this.setData({ sending: true });
    try {
      await ensurePrivacyAuthorization();
      this.handleSendResult(await api.sendMessage(this.conversationId, content));
    } catch (error) { this.handleSendError(error, "发送失败"); }
    finally { this.setData({ sending: false }); }
  },
  chooseImage() {
    if (isCommercialTextOnly()) {
      wx.showToast({ title: "当前首发版本仅支持文字消息", icon: "none" });
      return;
    }
    if (!this.data.messageInteractionAvailable) return;
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
    if (isCommercialTextOnly()) return null;
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
    if (isCommercialTextOnly()) {
      wx.showToast({ title: "当前首发版本仅支持文字消息", icon: "none" });
      return;
    }
    if (!this.data.messageInteractionAvailable) return;
    if (!this.data.mediaEnabled) {
      wx.showToast({ title: "当前环境未启用媒体消息", icon: "none" });
      return;
    }
    if (this.data.mediaUploading || this.data.sending || this.data.restrictionEndsAt || !this.data.messageInteractionAvailable) return;
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
    if (isCommercialTextOnly()) {
      wx.showToast({ title: "当前首发版本仅支持文字消息", icon: "none" });
      return;
    }
    if (this.data.mediaUploading || this.data.sending || this.data.restrictionEndsAt || !this.data.messageInteractionAvailable) return;
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
    if (isCommercialTextOnly()) {
      wx.showToast({ title: "当前首发版本不展示图片或语音消息", icon: "none" });
      return;
    }
    const url = event.currentTarget.dataset.url;
    if (typeof url === "string" && url) wx.previewImage({ current: url, urls: [url] });
  },
  playAudio(event: any) {
    if (isCommercialTextOnly()) {
      wx.showToast({ title: "当前首发版本不展示图片或语音消息", icon: "none" });
      return;
    }
    const url = event.currentTarget.dataset.url;
    if (typeof url !== "string" || !url) return;
    this.audioPlayer?.destroy?.();
    const player = wx.createInnerAudioContext();
    player.src = url;
    player.onError(() => wx.showToast({ title: "语音暂时无法播放", icon: "none" }));
    player.play();
    this.audioPlayer = player;
  },
  async toggleMessageNotifications() {
    if (!this.conversationId || this.data.messageNotificationUpdating) return;
    const muted = !this.data.messageNotificationsMuted;
    const confirmation = await new Promise<any>((resolve) => wx.showModal({
      title: muted ? "静音本会话" : "恢复本会话提醒",
      content: muted
        ? "只会暂停你在这个会话的后续新消息提醒。消息仍会正常收发、显示在会话和未读列表，对方不会收到提示；订单、举报、审核、客服和安全通知不受影响。"
        : "恢复后，后续已发布消息会进入平台提醒。可在下一步主动授权微信订阅；未授权不影响聊天和未读列表。",
      confirmText: muted ? "静音" : "恢复提醒",
      confirmColor: muted ? "#8D5565" : "#55748F",
      success: resolve,
      fail: () => resolve({ confirm: false })
    }));
    if (!confirmation?.confirm) return;

    this.setData({ messageNotificationUpdating: true });
    try {
      const result = await api.setConversationMessageNotificationsMuted(this.conversationId, muted);
      this.setData({ messageNotificationsMuted: result.messageNotificationsMuted });
      if (muted) {
        wx.showToast({ title: "已仅为你静音本会话", icon: "success" });
        return;
      }

      // Subscription permission is requested only after the user explicitly
      // chose to restore this conversation's reminders. A declined platform
      // prompt never changes message delivery or hides its unread state.
      const subscription = await requestTransactionalSubscriptions(["messageReceived"]);
      wx.showToast({
        title: subscription.recorded > 0
          ? "已恢复提醒并记录微信授权"
          : "已恢复提醒；未授权仍可查看未读",
        icon: "none"
      });
    } catch (error) {
      wx.showToast({ title: (error as Error).message || "暂时无法更新提醒", icon: "none" });
    } finally {
      this.setData({ messageNotificationUpdating: false });
    }
  },
  async toggleConversationBlock() {
    if (!this.conversationId || this.data.conversationBlockUpdating) return;
    const blocked = !this.data.conversationBlockedByYou;
    const confirmation = await new Promise<any>((resolve) => wx.showModal({
      title: blocked ? "为自己拉黑本会话" : "解除本会话拉黑",
      content: blocked
        ? "这会停止双方在该会话继续收发和展示消息，并清除你尚未查看的消息提醒。不会取消订单、退款、结算、举报或客服处理；需要时仍可从订单和安全入口获得帮助。"
        : "解除后，只有在对方没有设置同样边界时，本会话才会恢复收发。订单、退款、举报和客服处理始终独立。",
      confirmText: blocked ? "拉黑" : "解除拉黑",
      confirmColor: blocked ? "#8D5565" : "#55748F",
      success: resolve,
      fail: () => resolve({ confirm: false })
    }));
    if (!confirmation?.confirm) return;
    this.setData({ conversationBlockUpdating: true });
    try {
      const result = await api.setConversationBlocked(this.conversationId, blocked);
      this.setData({
        conversationBlockedByYou: result.conversationBlockedByYou,
        messageHistoryAvailable: result.messageHistoryAvailable,
        messageInteractionAvailable: result.messageInteractionAvailable,
        ...(blocked ? { messages: [], draft: "", hasMore: false } : {})
      });
      if (blocked) {
        this.nextCursor = null;
        this.hasMore = false;
        wx.showToast({ title: "已为自己拉黑本会话", icon: "success" });
        return;
      }
      wx.showToast({
        title: result.messageInteractionAvailable ? "已解除拉黑" : "已解除；当前会话仍不可收发",
        icon: "none"
      });
      if (result.messageHistoryAvailable) await this.load();
    } catch (error) {
      wx.showToast({ title: (error as Error).message || "暂时无法更新拉黑状态", icon: "none" });
    } finally {
      this.setData({ conversationBlockUpdating: false });
    }
  },
  async toggleFutureBookingBoundary() {
    if (
      !this.conversationId
      || !this.data.viewerCanManageFutureBookingBoundary
      || this.data.futureBookingBoundaryUpdating
    ) return;
    const declined = !this.data.futureBookingsDeclinedByYou;
    const confirmation = await new Promise<any>((resolve) => wx.showModal({
      title: declined ? "不再接受此客户的新预约" : "恢复此客户未来预约",
      content: declined
        ? "这是你的私密未来交易设置：此客户不会再在推荐中看到你，也无法向你创建新订单。客户不会收到原因或被处罚；现有订单、聊天、退款、评价、举报与客服处理均不受影响。"
        : "恢复后，此客户可能再次在推荐中看到你，并可在你仍公开可约时创建新订单。现有订单与聊天不会发生变化。",
      confirmText: declined ? "确认设置" : "恢复",
      confirmColor: declined ? "#7A5B3B" : "#55748F",
      success: resolve,
      fail: () => resolve({ confirm: false })
    }));
    if (!confirmation?.confirm) return;

    this.setData({ futureBookingBoundaryUpdating: true });
    try {
      const result = await api.setConversationFutureBookingBoundary(
        this.conversationId,
        declined
      );
      this.setData({
        viewerCanManageFutureBookingBoundary: result.viewerCanManageFutureBookingBoundary,
        futureBookingsDeclinedByYou: result.futureBookingsDeclinedByYou
      });
      wx.showToast({
        title: result.futureBookingsDeclinedByYou
          ? "已停止未来新预约"
          : "已恢复未来预约",
        icon: "success"
      });
    } catch (error) {
      wx.showToast({ title: (error as Error).message || "暂时无法更新未来预约设置", icon: "none" });
    } finally {
      this.setData({ futureBookingBoundaryUpdating: false });
    }
  },
  openSafetyCenter() {
    wx.navigateTo({ url: "/pages/safety/index" });
  },
  openEmergencyHelp() {
    openCrisisResources({ source: "directEmergencyHelp", riskCode: "userRequested" });
  },
  openMessageEmergencyHelp() {
    // Deliberately omit message id/content: the intervention stores only the
    // structured fact that a server safety rule produced this route.
    openCrisisResources({ source: "chatSafetyRule", riskCode: "chatSafetyRule" });
  },
  leaveConversation() {
    // Leaving only changes the visible page. It never cancels an order,
    // submits a report, uploads conversation content, or writes a safety flag.
    wx.switchTab({ url: "/pages/messages/index" });
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
          const response = await api.appeal(caseId, result.content.trim());
          this.setData({ appealCaseId: "" });
          wx.showModal({
            title: "申诉已进入独立复核",
            content: `平台计划在 ${formatAppealDueAt(response.appeal.reviewDueAt)} 前完成复核。可在“安全与支持”查看进度和最终结果。`,
            showCancel: false,
            confirmText: "知道了"
          });
        } catch (error) { this.handleSendError(error, "申诉提交失败"); }
      }
    });
  }
});

function formatAppealDueAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "约定处理期限";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
