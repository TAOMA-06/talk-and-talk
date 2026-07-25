import { api, ApiError, ensureSession } from "../../utils/api";
import { VoiceRoomAccess } from "../../utils/models";

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

Page({
  data: {
    orderId: "",
    participantName: "对方",
    participantInitials: "TA",
    participantRole: "customer" as "customer" | "companion",
    roomState: "loading" as "loading" | "connecting" | "connected" | "leaving" | "ended" | "error",
    statusText: "正在核对订单与服务时间…",
    canRetry: false,
    muted: false,
    serviceEndsAtText: "",
    pusher: emptyPusher(),
    playerList: [] as TrtcPlayer[]
  },
  trtc: null as TrtcInstance | null,
  trtcEventHandlers: [] as Array<{ eventCode: string; handler: TrtcEventHandler }>,
  leaving: false,
  connectionEpoch: 0,
  serviceEndTimer: null as ReturnType<typeof setTimeout> | null,
  onLoad(options: Record<string, string | undefined>) {
    const orderId = String(options.orderId || "").trim();
    if (!orderId) {
      this.setData({
        roomState: "error",
        statusText: "缺少订单信息，请从订单页重新进入实时语音。",
        canRetry: false
      });
      return;
    }
    this.setData({ orderId });
    void this.connect();
  },
  onHide() {
    // Leaving on background invalidates both an active room and a credential
    // request that has not returned yet. The user must deliberately tap retry
    // after returning; we never auto-enable a microphone on foregrounding.
    void this.leaveRoom(false, true);
  },
  onUnload() {
    void this.leaveRoom(false);
  },
  async connect() {
    const orderId = this.data.orderId;
    if (!orderId || this.leaving) return;
    const connectionEpoch = ++this.connectionEpoch;
    this.clearServiceEndTimer();
    this.setData({
      roomState: "connecting",
      statusText: "正在签发本次订单的短效语音凭证…",
      canRetry: false,
      muted: false
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
      this.setData({
        pusher: ended.pusher,
        playerList: ended.playerList,
        roomState: "error",
        statusText: voiceFailureMessage(error),
        canRetry: true
      });
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
  },
  enableRemoteAudio(trtc: TrtcInstance, event: unknown) {
    const data = (event as { data?: { player?: TrtcPlayer; playerList?: TrtcPlayer[] } })?.data;
    const streamId = data?.player?.streamID;
    const playerList = streamId && trtc.setPlayerAttributes
      ? trtc.setPlayerAttributes(streamId, { muteAudio: false, muteVideo: true })
      : (data?.playerList || trtc.getPlayerList?.() || []);
    this.setData({
      playerList: normalizePlayerList(playerList),
      statusText: "对方已加入实时语音，正在通话中。"
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
    const trtc = this.trtc;
    this.trtc = null;
    this.unbindTrtcRoomEvents(trtc);
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
    this.invalidateConnection();
    this.leaving = true;
    this.clearServiceEndTimer();
    this.setData({ roomState: "leaving", statusText: "正在退出实时语音…", canRetry: false });
    const ended = await this.teardownTrtc();
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
    if (this.data.roomState === "connected") {
      this.setData({ statusText: "对方已加入实时语音，正在通话中。" });
    }
  },
  playerFullscreenChange(event: unknown) {
    this.trtc?.playerFullscreenChange?.(event);
  },
  playerNetStatus(event: unknown) {
    this.trtc?.playerNetStatus?.(event);
  },
  playerAudioVolumeNotify(event: unknown) {
    this.trtc?.playerAudioVolumeNotify?.(event);
  },
  playerError(event: unknown) {
    this.setData({ statusText: "对方音频暂时不稳定，系统正在保持连接。" });
  },
  scheduleServiceEnd(access: VoiceRoomAccess) {
    const delay = serviceEndDelay(access);
    if (delay <= 0) {
      void this.leaveRoom(false);
      return;
    }
    this.serviceEndTimer = setTimeout(() => {
      this.setData({ roomState: "ended", statusText: "本次服务时间已结束，实时语音已退出。", canRetry: false });
      void this.leaveRoom(false);
    }, delay);
  },
  clearServiceEndTimer() {
    if (!this.serviceEndTimer) return;
    clearTimeout(this.serviceEndTimer);
    this.serviceEndTimer = null;
  },
  formatServiceEnd(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "以订单服务时间为准";
    const pad = (part: number) => String(part).padStart(2, "0");
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
});
