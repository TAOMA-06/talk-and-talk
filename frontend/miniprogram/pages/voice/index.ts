import { api, ApiError, currentUser, ensureSession } from "../../utils/api";
import {
  handleCustomerAdultEligibilityError,
  isCustomerAdultEligibilityError
} from "../../utils/adult-eligibility-recovery";
import { clientRealtimeVoiceEnabled } from "../../utils/config";
import { VoiceRoomAccess } from "../../utils/models";
import { ensurePrivacyAuthorization, openLegalDocument } from "../../utils/privacy";
import { attendanceDisputesApi } from "../../utils/attendance-disputes-api";

declare const require: (moduleName: string) => unknown;

type TrtcPusher = {
  url?: string;
  mode?: string;
  autopush?: boolean;
  enableCamera?: boolean;
  enableMic?: boolean;
  [key: string]: unknown;
};

type TrtcPlayer = {
  id?: string;
  src?: string;
  userID?: string;
  streamID?: string;
  streamType?: string;
  muteAudio?: boolean;
  [key: string]: unknown;
};

type TrtcEventHandler = (event: unknown) => void;

type TrtcInstance = {
  EVENT?: Record<string, string | undefined>;
  on?(eventCode: string, handler: TrtcEventHandler, context?: unknown): void;
  off?(eventCode: string, handler: TrtcEventHandler): void;
  createPusher?(attributes: Record<string, unknown>): TrtcPusher;
  enterRoom(options: {
    sdkAppID: number;
    userID: string;
    userSig: string;
    strRoomID: string;
    privateMapKey: string;
    scene: "rtc";
    recvMode: 2;
    enableCamera: false;
    enableMic: true;
  }): TrtcPusher;
  exitRoom?(): Promise<{ pusher?: TrtcPusher; playerList?: TrtcPlayer[] } | void> | { pusher?: TrtcPusher; playerList?: TrtcPlayer[] } | void;
  getPusherInstance?(): { start?(): Promise<void> | void } | undefined;
  getPlayerList?(): TrtcPlayer[];
  setPusherAttributes?(attributes: Record<string, unknown>): TrtcPusher;
  setPlayerAttributes?(id: string, attributes: Record<string, unknown>): TrtcPlayer[];
  pusherEventHandler?(event: unknown): void;
  pusherNetStatusHandler?(event: unknown): void;
  pusherErrorHandler?(event: unknown): void;
  playerEventHandler?(event: unknown): void;
  playerFullscreenChange?(event: unknown): void;
  playerNetStatus?(event: unknown): void;
  playerAudioVolumeNotify?(event: unknown): void;
  pusherAudioVolumeNotify?(event: unknown): void;
};

type TrtcConstructor = new (page: unknown) => TrtcInstance;

type TrtcModule = TrtcConstructor | { default?: TrtcConstructor; TRTC?: TrtcConstructor };

type PageDataSink = {
  setData(patch: Record<string, unknown>, callback?: () => void): void;
};

function emptyPusher(): TrtcPusher {
  return {
    url: "",
    mode: "RTC",
    autopush: true,
    enableCamera: false,
    enableMic: false
  };
}

function normalizePusher(value: unknown): TrtcPusher {
  return value && typeof value === "object" ? value as TrtcPusher : emptyPusher();
}

function normalizePlayerList(value: unknown): TrtcPlayer[] {
  return Array.isArray(value) ? value as TrtcPlayer[] : [];
}

function setPageData(page: PageDataSink, patch: Record<string, unknown>): Promise<void> {
  return new Promise((resolve) => page.setData(patch, resolve));
}

function attendanceEventId(type: string): string {
  return `${type}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

function voiceFailureMessage(error: unknown): string {
  const apiError = error as ApiError;
  switch (apiError.code) {
    case "VOICE_FEATURE_DISABLED":
      return "实时语音正在完成平台配置，请稍后通过订单进入。";
    case "VOICE_ORDER_NOT_ELIGIBLE":
      return "这笔订单不是实时语音服务。";
    case "VOICE_ORDER_NOT_ACCEPTED":
      return "请等待陪伴者手动接单后再进入实时语音。";
    case "VOICE_SERVICE_NOT_STARTED":
      return "陪伴者开始本次服务后，双方才能进入实时语音。";
    case "VOICE_SERVICE_WINDOW_EXPIRED":
      return "本次服务时间已结束，不能再进入实时语音。";
    case "VOICE_REFUND_IN_PROGRESS":
      return "订单正在处理售后，实时语音已暂停；请从订单查看客服进度。";
    case "VOICE_SIGNING_UNAVAILABLE":
      return "实时语音凭证暂时不可用，请稍后重试。";
    case "CUSTOMER_ADULT_ELIGIBILITY_REQUIRED":
    case "CUSTOMER_ADULT_ELIGIBILITY_PENDING":
    case "CUSTOMER_ADULT_ELIGIBILITY_INELIGIBLE":
    case "CUSTOMER_ADULT_ELIGIBILITY_EXPIRED":
    case "CUSTOMER_ADULT_ELIGIBILITY_VALIDITY_TOO_SHORT":
      return "客户成年资格当前无法覆盖本次实时语音；订单、退款和账号权利保持可用。";
    default:
      return apiError.message || "实时语音暂时无法连接，请稍后重试。";
  }
}

function resolveTrtcConstructor(): TrtcConstructor | null {
  const injected = (globalThis as { __TALK_AND_TALK_TRTC_SDK__?: TrtcModule }).__TALK_AND_TALK_TRTC_SDK__;
  try {
    // The injected branch is a smoke-test seam only. In a Mini Program build,
    // WeChat's NPM build resolves the declared trtc-wx-sdk package here.
    const module = (injected || require("trtc-wx-sdk")) as TrtcModule;
    if (typeof module === "function") return module;
    if (typeof module?.default === "function") return module.default;
    if (typeof module?.TRTC === "function") return module.TRTC;
  } catch {
    // The page reports an honest configuration error instead of pretending a
    // recorded voice message or local timer is a real-time connection.
  }
  return null;
}

function serviceEndDelay(access: VoiceRoomAccess): number {
  const serviceEndsAt = Date.parse(access.serviceEndsAt);
  return Number.isFinite(serviceEndsAt) ? Math.max(0, serviceEndsAt - Date.now()) : 0;
}

function wxOperation<T>(operation: (callbacks: { success: (value: T) => void; fail: (error?: unknown) => void }) => void): Promise<T> {
  return new Promise((resolve, reject) => operation({ success: resolve, fail: reject }));
}

function networkPresentation(networkType: string): { text: string; tone: "good" | "warning" | "error" | "unknown" } {
  const normalized = networkType.toLowerCase();
  if (normalized === "none") return { text: "当前无网络", tone: "error" };
  if (normalized === "2g" || normalized === "3g") return { text: `${networkType.toUpperCase()} · 可能不稳定`, tone: "warning" };
  if (normalized === "wifi" || normalized === "4g" || normalized === "5g") {
    return { text: `${normalized === "wifi" ? "Wi-Fi" : networkType.toUpperCase()} · 可尝试连接`, tone: "good" };
  }
  return { text: "网络状态未知", tone: "unknown" };
}

function formatRemaining(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

Page({
  data: {
    motionOff: false,
    voiceFeatureAvailable: clientRealtimeVoiceEnabled(),
    orderId: "",
    participantName: "对方",
    participantInitials: "TA",
    participantRole: "customer" as "customer" | "companion",
    roomState: "loading" as "loading" | "preflight" | "connecting" | "connected" | "leaving" | "ended" | "error",
    statusText: "请先完成通话前检查。",
    canRetry: false,
    muted: false,
    serviceEndsAtText: "",
    serviceRemainingText: "",
    networkTypeText: "正在检测网络…",
    networkQualityText: "尚未进入通话",
    networkTone: "unknown" as "good" | "warning" | "error" | "unknown",
    preflightVisible: true,
    environmentConfirmed: false,
    boundaryConfirmed: false,
    trtcDisclosureConfirmed: false,
    preflightChecking: false,
    microphoneStatusText: "连接前才会请求麦克风授权",
    remoteAudioConnected: false,
    pusher: emptyPusher(),
    playerList: [] as TrtcPlayer[]
  },
  trtc: null as TrtcInstance | null,
  trtcEventHandlers: [] as Array<{ eventCode: string; handler: TrtcEventHandler }>,
  leaving: false,
  connectionEpoch: 0,
  serviceEndTimer: null as ReturnType<typeof setTimeout> | null,
  serviceCountdownTimer: null as ReturnType<typeof setInterval> | null,
  attendanceHeartbeatTimer: null as ReturnType<typeof setInterval> | null,
  hasJoinedOnce: false,
  serviceEndsAtMs: 0,
  onLoad(options: Record<string, string | undefined>) {
    if (!clientRealtimeVoiceEnabled()) {
      this.setData({
        voiceFeatureAvailable: false,
        roomState: "error",
        statusText: "首发仅开放文字陪伴；实时语音待平台配置完成后再开放。",
        canRetry: false,
        preflightVisible: false
      });
      return;
    }
    const orderId = String(options.orderId || "").trim();
    if (!orderId) {
      this.setData({
        roomState: "error",
        statusText: "缺少订单信息，请从订单页重新进入实时语音。",
        canRetry: false
      });
      return;
    }
    this.setData({ orderId, roomState: "preflight" });
    void this.inspectNetwork();
  },
  onHide() {
    // Leaving on background invalidates both an active room and a credential
    // request that has not returned yet. The user must deliberately tap retry
    // after returning; we never auto-enable a microphone on foregrounding.
    if (!this.data.preflightVisible) void this.leaveRoom(false, true);
  },
  onUnload() {
    void this.leaveRoom(false);
  },
  async connect() {
    const orderId = this.data.orderId;
    if (!orderId || this.leaving) return;
    // This guard is deliberately repeated below the UI layer. Tests, retries or
    // future navigation changes must never initialize the third-party SDK before
    // the user has seen and confirmed its purpose and data-processing boundary.
    if (
      !this.data.environmentConfirmed
      || !this.data.boundaryConfirmed
      || !this.data.trtcDisclosureConfirmed
    ) {
      this.setData({
        preflightVisible: true,
        roomState: "preflight",
        statusText: "请先完成通话前的隐私与服务边界确认。",
        canRetry: false
      });
      return;
    }
    const connectionEpoch = ++this.connectionEpoch;
    this.clearServiceEndTimer();
    this.setData({
      roomState: "connecting",
      statusText: "正在签发本次订单的短效语音凭证…",
      canRetry: false,
      muted: false,
      remoteAudioConnected: false
    });
    try {
      await ensureSession();
      if (!this.isCurrentConnection(connectionEpoch)) return;
      const access = await api.voiceRoomAccess(orderId);
      if (!this.isCurrentConnection(connectionEpoch)) return;
      const Trtc = resolveTrtcConstructor();
      if (!Trtc) {
        throw new Error("实时语音组件未安装；请联系平台完成小程序 RTC 配置。");
      }
      if (this.trtc) await this.teardownTrtc();
      if (!this.isCurrentConnection(connectionEpoch)) return;
      const trtc = new Trtc(this);
      this.trtc = trtc;
      this.bindTrtcRoomEvents(trtc);
      const initialPusher = trtc.createPusher?.({
        enableCamera: false,
        enableMic: true,
        autopush: true
      });
      if (!initialPusher) {
        throw new Error("实时语音组件缺少必要的推流能力；请联系平台完成 RTC 配置。");
      }
      await setPageData(this, {
        pusher: initialPusher,
        playerList: [],
        participantName: access.participant.name,
        participantInitials: access.participant.initials,
        participantRole: access.participantRole,
        serviceEndsAtText: this.formatServiceEnd(access.serviceEndsAt)
      });
      if (!this.isCurrentConnection(connectionEpoch) || this.trtc !== trtc) return;
      const pusher = trtc.enterRoom({
        sdkAppID: access.sdkAppId,
        userID: access.userId,
        userSig: access.userSig,
        strRoomID: access.roomId,
        privateMapKey: access.privateMapKey,
        scene: "rtc",
        recvMode: 2,
        enableCamera: false,
        enableMic: true
      });
      // trtc-wx requires its ephemeral pusher attributes to be bound to the
      // native component. Raw response credentials are never persisted, logged
      // or sent to analytics; a reconnect always obtains fresh credentials.
      await setPageData(this, { pusher: normalizePusher(pusher) });
      if (!this.isCurrentConnection(connectionEpoch) || this.trtc !== trtc) return;
      const pusherInstance = trtc.getPusherInstance?.();
      if (!pusherInstance?.start) {
        throw new Error("实时语音组件未能创建推流实例；请联系平台完成 RTC 配置。");
      }
      await pusherInstance.start();
      // A provider error can arrive while start() is resolving. Do not let a
      // stale connect continuation re-arm the timer or show a connected state
      // after the transport has already been torn down.
      if (this.trtc !== trtc || this.leaving) return;
      if (!this.hasRoomEvent(trtc, "LOCAL_JOIN")) {
        this.markLocalJoined();
      }
      this.scheduleServiceEnd(access);
    } catch (error) {
      if (!this.isCurrentConnection(connectionEpoch)) return;
      const ended = await this.teardownTrtc();
      if (!this.isCurrentConnection(connectionEpoch)) return;
      if (isCustomerAdultEligibilityError(error)) {
        let subject: "currentUser" | "otherParticipant" = "otherParticipant";
        try {
          const order = await api.order(orderId);
          if (order.customer?.id && order.customer.id === currentUser()?.id) subject = "currentUser";
        } catch {
          // The eligibility gate remains closed even if the participant-safe
          // order lookup is temporarily unavailable.
        }
        await handleCustomerAdultEligibilityError(error, subject);
      }
      this.setData({
        pusher: ended.pusher,
        playerList: ended.playerList,
        roomState: "error",
        statusText: voiceFailureMessage(error),
        canRetry: true
      });
    }
  },
  async inspectNetwork() {
    if (typeof wx.getNetworkType !== "function") {
      this.setData({
        networkTypeText: "无法读取网络类型",
        networkQualityText: "连接后继续监测",
        networkTone: "unknown"
      });
      return;
    }
    try {
      const result = await wxOperation<{ networkType?: string }>((callbacks) => wx.getNetworkType(callbacks));
      const presentation = networkPresentation(String(result.networkType || ""));
      this.setData({
        networkTypeText: presentation.text,
        networkQualityText: presentation.tone === "error" ? "无法进入实时语音" : "连接后继续监测",
        networkTone: presentation.tone
      });
    } catch {
      this.setData({
        networkTypeText: "网络检测失败",
        networkQualityText: "请确认微信能够联网",
        networkTone: "warning"
      });
    }
  },
  toggleEnvironmentConfirmation() {
    if (this.data.preflightChecking) return;
    this.setData({ environmentConfirmed: !this.data.environmentConfirmed });
  },
  toggleBoundaryConfirmation() {
    if (this.data.preflightChecking) return;
    this.setData({ boundaryConfirmed: !this.data.boundaryConfirmed });
  },
  toggleTrtcDisclosureConfirmation() {
    if (this.data.preflightChecking) return;
    this.setData({ trtcDisclosureConfirmed: !this.data.trtcDisclosureConfirmed });
  },
  openPrivacyPolicy() {
    openLegalDocument("privacy");
  },
  async confirmPreflight() {
    if (this.data.preflightChecking) return;
    if (
      !this.data.environmentConfirmed
      || !this.data.boundaryConfirmed
      || !this.data.trtcDisclosureConfirmed
    ) {
      wx.showToast({ title: "请先完成隐私与服务边界确认", icon: "none" });
      return;
    }
    this.setData({ preflightChecking: true, microphoneStatusText: "正在请求麦克风授权…" });
    try {
      await ensureSession();
      await ensurePrivacyAuthorization();
      await this.ensureMicrophonePermission();
      if (this.data.networkTone === "error") throw new Error("当前没有可用网络，请恢复网络后再进入");
      this.setData({
        preflightVisible: false,
        preflightChecking: false,
        microphoneStatusText: "麦克风权限已就绪",
        roomState: "loading",
        statusText: "正在核对订单与服务时间…"
      });
      await this.connect();
    } catch (error) {
      this.setData({
        preflightChecking: false,
        microphoneStatusText: (error as Error).message || "麦克风权限未就绪"
      });
      wx.showToast({ title: (error as Error).message || "通话前检查未完成", icon: "none" });
    }
  },
  async ensureMicrophonePermission() {
    if (typeof wx.getSetting !== "function" || typeof wx.authorize !== "function") {
      throw new Error("当前微信版本无法核对麦克风权限，请升级后重试");
    }
    const setting = await wxOperation<{ authSetting?: Record<string, boolean> }>((callbacks) => wx.getSetting(callbacks));
    const granted = setting.authSetting?.["scope.record"];
    if (granted === true) return;
    if (granted === undefined) {
      try {
        await wxOperation((callbacks) => wx.authorize({ scope: "scope.record", ...callbacks }));
        return;
      } catch {
        throw new Error("需要麦克风权限才能进入实时语音");
      }
    }
    if (typeof wx.openSetting !== "function") throw new Error("请在微信设置中开启麦克风权限");
    const opened = await wxOperation<{ authSetting?: Record<string, boolean> }>((callbacks) => wx.openSetting(callbacks));
    if (opened.authSetting?.["scope.record"] !== true) {
      throw new Error("麦克风权限仍未开启，实时语音不会连接");
    }
  },
  async retry() {
    await this.connect();
  },
  async leaveVoice() {
    await this.leaveRoom(true);
  },
  hasRoomEvent(trtc: TrtcInstance, eventName: string): boolean {
    return Boolean(trtc.EVENT?.[eventName] && trtc.on);
  },
  isCurrentConnection(connectionEpoch: number): boolean {
    return this.connectionEpoch === connectionEpoch && !this.leaving;
  },
  invalidateConnection() {
    this.connectionEpoch += 1;
  },
  bindTrtcRoomEvents(trtc: TrtcInstance) {
    this.trtcEventHandlers = [];
    const bind = (eventName: string, handler: TrtcEventHandler) => {
      const eventCode = trtc.EVENT?.[eventName];
      if (!eventCode || !trtc.on) return;
      const guarded: TrtcEventHandler = (event) => {
        if (this.trtc === trtc) handler(event);
      };
      trtc.on(eventCode, guarded, this);
      this.trtcEventHandlers.push({ eventCode, handler: guarded });
    };
    bind("LOCAL_JOIN", () => this.markLocalJoined());
    bind("KICKED_OUT", () => {
      void this.handleKickedOut();
    });
    bind("ERROR", () => {
      void this.handleTransportError("实时语音连接出现异常，请重新连接。");
    });
    bind("REMOTE_AUDIO_ADD", (event) => this.enableRemoteAudio(trtc, event));
    bind("REMOTE_AUDIO_REMOVE", (event) => this.removeRemoteAudio(trtc, event));
    bind("REMOTE_VIDEO_ADD", (event) => this.disableRemoteVideo(trtc, event));
  },
  unbindTrtcRoomEvents(trtc: TrtcInstance | null) {
    for (const subscription of this.trtcEventHandlers) {
      trtc?.off?.(subscription.eventCode, subscription.handler);
    }
    this.trtcEventHandlers = [];
  },
  markLocalJoined() {
    if (this.data.roomState !== "connecting") return;
    this.setData({
      roomState: "connected",
      statusText: "已进入实时语音房间，正在等待对方加入。",
      canRetry: false
    });
    const eventType = this.hasJoinedOnce ? "reconnect" : "join";
    this.hasJoinedOnce = true;
    void this.reportAuxiliaryAttendance(eventType);
    this.startAttendanceHeartbeat();
  },
  enableRemoteAudio(trtc: TrtcInstance, event: unknown) {
    const data = (event as { data?: { player?: TrtcPlayer; playerList?: TrtcPlayer[] } })?.data;
    const streamId = data?.player?.streamID;
    const playerList = streamId && trtc.setPlayerAttributes
      ? trtc.setPlayerAttributes(streamId, { muteAudio: false, muteVideo: true })
      : (data?.playerList || trtc.getPlayerList?.() || []);
    this.setData({
      playerList: normalizePlayerList(playerList),
      remoteAudioConnected: true,
      statusText: "对方已加入实时语音，正在通话中。"
    });
  },
  removeRemoteAudio(trtc: TrtcInstance, event: unknown) {
    const data = (event as { data?: { player?: TrtcPlayer; playerList?: TrtcPlayer[] } })?.data;
    const streamId = data?.player?.streamID || data?.player?.id;
    const current = data?.playerList || trtc.getPlayerList?.() || [];
    const playerList = streamId
      ? current.filter((player) => player.streamID !== streamId && player.id !== streamId)
      : current;
    this.setData({
      playerList: normalizePlayerList(playerList),
      remoteAudioConnected: false,
      statusText: "对方已离开实时语音，房间仍在等待其重新加入。",
      networkQualityText: "等待对方重新加入",
      networkTone: "warning"
    });
  },
  disableRemoteVideo(trtc: TrtcInstance, event: unknown) {
    const data = (event as { data?: { player?: TrtcPlayer; playerList?: TrtcPlayer[] } })?.data;
    const streamId = data?.player?.streamID;
    const playerList = streamId && trtc.setPlayerAttributes
      ? trtc.setPlayerAttributes(streamId, { muteVideo: true })
      : (data?.playerList || trtc.getPlayerList?.() || []);
    this.setData({ playerList: normalizePlayerList(playerList) });
  },
  async teardownTrtc(skipExit = false): Promise<{ pusher: TrtcPusher; playerList: TrtcPlayer[] }> {
    this.clearAttendanceHeartbeat();
    const trtc = this.trtc;
    this.trtc = null;
    this.unbindTrtcRoomEvents(trtc);
    this.setData({ remoteAudioConnected: false });
    if (!trtc) return { pusher: emptyPusher(), playerList: [] };
    // KICKED_OUT is emitted after the SDK has already left the room. Calling
    // exitRoom again can race the SDK's cleanup and produce a misleading error.
    if (skipExit) return { pusher: emptyPusher(), playerList: [] };
    try {
      const result = await trtc.exitRoom?.();
      return {
        pusher: normalizePusher(result?.pusher),
        playerList: normalizePlayerList(result?.playerList)
      };
    } catch {
      // A local page transition must still clear the rendered RTC transport.
      return { pusher: emptyPusher(), playerList: [] };
    }
  },
  async handleKickedOut() {
    if (this.leaving) return;
    this.invalidateConnection();
    this.leaving = true;
    this.clearServiceEndTimer();
    const ended = await this.teardownTrtc(true);
    this.leaving = false;
    this.setData({
      pusher: ended.pusher,
      playerList: ended.playerList,
      roomState: "ended",
      statusText: "实时语音房间已关闭，请返回订单查看后续安排。",
      canRetry: false
    });
  },
  async handleTransportError(statusText: string) {
    if (this.leaving) return;
    this.invalidateConnection();
    this.leaving = true;
    this.clearServiceEndTimer();
    const ended = await this.teardownTrtc();
    this.leaving = false;
    this.setData({
      pusher: ended.pusher,
      playerList: ended.playerList,
      roomState: "error",
      statusText,
      canRetry: true
    });
  },
  async leaveRoom(returnToOrders: boolean, allowRetry = false) {
    if (this.leaving) return;
    const wasConnected = this.data.roomState === "connected";
    this.invalidateConnection();
    this.leaving = true;
    this.clearServiceEndTimer();
    this.setData({ roomState: "leaving", statusText: "正在退出实时语音…", canRetry: false });
    const ended = await this.teardownTrtc();
    if (wasConnected) void this.reportAuxiliaryAttendance("leave");
    this.leaving = false;
    this.setData({
      pusher: ended.pusher,
      playerList: ended.playerList,
      roomState: "ended",
      statusText: "已退出实时语音。",
      canRetry: allowRetry
    });
    if (returnToOrders) wx.navigateBack({ delta: 1 });
  },
  reportAuxiliaryAttendance(eventType: "join" | "leave" | "reconnect" | "heartbeat") {
    const orderId = this.data.orderId;
    if (!orderId) return Promise.resolve();
    // Client events are an availability aid only. Failure is deliberately
    // silent and never changes the room or dispute UI; signed TRTC callbacks
    // remain the authoritative attendance source.
    return attendanceDisputesApi.reportClientEvent(orderId, eventType, attendanceEventId(eventType))
      .then(() => undefined)
      .catch(() => undefined);
  },
  startAttendanceHeartbeat() {
    this.clearAttendanceHeartbeat();
    this.attendanceHeartbeatTimer = setInterval(() => {
      if (this.data.roomState === "connected") void this.reportAuxiliaryAttendance("heartbeat");
    }, 30_000);
  },
  clearAttendanceHeartbeat() {
    if (this.attendanceHeartbeatTimer) clearInterval(this.attendanceHeartbeatTimer);
    this.attendanceHeartbeatTimer = null;
  },
  toggleMute() {
    if (this.data.roomState !== "connected") return;
    const muted = !this.data.muted;
    try {
      const updated = this.trtc?.setPusherAttributes?.({ enableMic: !muted });
      this.setData({
        muted,
        pusher: updated || { ...this.data.pusher, enableMic: !muted }
      });
    } catch {
      wx.showToast({ title: "麦克风状态暂时无法切换", icon: "none" });
    }
  },
  pusherStateChange(event: unknown) {
    this.trtc?.pusherEventHandler?.(event);
    const code = Number((event as { detail?: { code?: number } })?.detail?.code);
    if (code === -1301 || code === -1302) {
      void this.handleTransportError("麦克风不可用，请检查小程序授权后重试。");
    }
  },
  pusherNetStatus(event: unknown) {
    this.trtc?.pusherNetStatusHandler?.(event);
    this.updateTransportQuality(event);
  },
  pusherAudioVolumeNotify(event: unknown) {
    this.trtc?.pusherAudioVolumeNotify?.(event);
  },
  pusherError(event: unknown) {
    this.trtc?.pusherErrorHandler?.(event);
    void this.handleTransportError("实时语音连接出现异常，请重新连接。");
  },
  playerStateChange(event: unknown) {
    this.trtc?.playerEventHandler?.(event);
  },
  playerFullscreenChange(event: unknown) {
    this.trtc?.playerFullscreenChange?.(event);
  },
  playerNetStatus(event: unknown) {
    this.trtc?.playerNetStatus?.(event);
    this.updateTransportQuality(event);
  },
  playerAudioVolumeNotify(event: unknown) {
    this.trtc?.playerAudioVolumeNotify?.(event);
  },
  playerError(event: unknown) {
    this.setData({
      ...(this.data.remoteAudioConnected
        ? { statusText: "对方音频暂时不稳定，系统正在保持连接。" }
        : {}),
      networkQualityText: "对方音频不稳定",
      networkTone: "warning"
    });
  },
  updateTransportQuality(event: unknown) {
    const info = (event as { detail?: { info?: Record<string, unknown> } })?.detail?.info || {};
    const rtt = Number(info.RTT ?? info.rtt);
    const netSpeed = Number(info.NET_SPEED ?? info.netSpeed);
    const poor = (Number.isFinite(rtt) && rtt > 450) || (Number.isFinite(netSpeed) && netSpeed > 0 && netSpeed < 30);
    const warning = (Number.isFinite(rtt) && rtt > 250) || (Number.isFinite(netSpeed) && netSpeed > 0 && netSpeed < 60);
    this.setData(poor ? {
      networkQualityText: "网络较差，可能出现断续",
      networkTone: "error"
    } : warning ? {
      networkQualityText: "网络有波动",
      networkTone: "warning"
    } : {
      networkQualityText: "通话网络正常",
      networkTone: "good"
    });
  },
  async leaveAndReport() {
    await this.leaveRoom(false);
    const result = await new Promise<any>((resolve) => wx.showModal({
      title: "提交实时语音安全举报",
      editable: true,
      placeholderText: "请说明发生了什么（5–500 字）",
      content: "语音已经退出。举报会进入独立审核部门，你可以在案件中心查看处理状态并补充事实。",
      confirmText: "提交举报",
      confirmColor: "#A94458",
      success: resolve,
      fail: () => resolve({ confirm: false })
    }));
    if (!result.confirm) return;
    const reason = String(result.content || "").trim();
    if (reason.length < 5 || reason.length > 500) {
      wx.showToast({ title: "请填写 5–500 字情况说明", icon: "none" });
      return;
    }
    try {
      const report = await api.report({
        targetId: this.data.orderId,
        reasonCode: "voice_safety",
        reason
      });
      wx.navigateTo({ url: `/pages/support/detail?kind=safety&id=${encodeURIComponent(report.report.id)}` });
    } catch (error) {
      wx.showToast({ title: (error as Error).message || "举报提交失败", icon: "none" });
    }
  },
  async leaveAndOpenSupport() {
    await this.leaveRoom(false);
    wx.navigateTo({
      url: `/pages/support/index?orderId=${encodeURIComponent(this.data.orderId)}&category=orderIssue&subject=${encodeURIComponent("实时语音连接或履约问题")}`
    });
  },
  scheduleServiceEnd(access: VoiceRoomAccess) {
    const delay = serviceEndDelay(access);
    if (delay <= 0) {
      void this.leaveRoom(false);
      return;
    }
    this.serviceEndsAtMs = Date.parse(access.serviceEndsAt);
    this.refreshServiceRemaining();
    this.serviceCountdownTimer = setInterval(() => this.refreshServiceRemaining(), 1000);
    this.serviceEndTimer = setTimeout(() => {
      this.setData({ roomState: "ended", statusText: "本次服务时间已结束，实时语音已退出。", canRetry: false });
      void this.leaveRoom(false);
    }, delay);
  },
  clearServiceEndTimer() {
    if (this.serviceEndTimer) clearTimeout(this.serviceEndTimer);
    if (this.serviceCountdownTimer) clearInterval(this.serviceCountdownTimer);
    this.serviceEndTimer = null;
    this.serviceCountdownTimer = null;
    this.serviceEndsAtMs = 0;
    this.setData({ serviceRemainingText: "" });
  },
  refreshServiceRemaining() {
    if (!Number.isFinite(this.serviceEndsAtMs) || this.serviceEndsAtMs <= 0) return;
    this.setData({ serviceRemainingText: formatRemaining(this.serviceEndsAtMs - Date.now()) });
  },
  formatServiceEnd(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "以订单服务时间为准";
    const pad = (part: number) => String(part).padStart(2, "0");
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
});
