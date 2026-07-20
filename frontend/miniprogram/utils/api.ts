import { BackendConfig, backendConfig } from "./config";
import {
  AuthSession, AuthUser, ChatMessage, CommunityPost, Companion, Conversation, MediaAttachment, MiniProgramPayParams,
  Notification, Order, RecommendationPlacement, RecommendationPreference, RecommendationTopic, RecommendedCompanion, Review
} from "./models";
import {
  bindLegalConsentToUser, currentLegalConsent, requireLegalConsent, withdrawLegalConsent
} from "./privacy";

export type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  data?: Record<string, unknown>;
  authenticated?: boolean;
  retry?: boolean;
};
export type ApiError = Error & { statusCode?: number; code?: string; details?: Record<string, unknown> };
type TransportResponse = { statusCode: number; data?: any };

export type MediaUploadReservation = {
  asset: Omit<MediaAttachment, "url">;
  upload: { url: string; method: "PUT" | "POST"; headers: Record<string, string>; expiresAt: string };
};

const ACCESS_TOKEN_KEY = "talkandtalk.accessToken";
const REFRESH_TOKEN_KEY = "talkandtalk.refreshToken";
const USER_KEY = "talkandtalk.user";
let refreshInFlight: Promise<void> | null = null;
let loginInFlight: Promise<AuthSession> | null = null;
let legalConsentVerificationInFlight: Promise<void> | null = null;
let verifiedLegalConsentKey = "";
const initializedCloudEnvironments = new Set<string>();

function storedAccessToken(): string { return wx.getStorageSync(ACCESS_TOKEN_KEY) || ""; }
function storedRefreshToken(): string { return wx.getStorageSync(REFRESH_TOKEN_KEY) || ""; }

function saveSession(session: AuthSession): void {
  wx.setStorageSync(ACCESS_TOKEN_KEY, session.accessToken);
  wx.setStorageSync(REFRESH_TOKEN_KEY, session.refreshToken);
  wx.setStorageSync(USER_KEY, session.user);
  bindLegalConsentToUser(session.user.id);
}

export function clearSession(): void {
  wx.removeStorageSync(ACCESS_TOKEN_KEY);
  wx.removeStorageSync(REFRESH_TOKEN_KEY);
  wx.removeStorageSync(USER_KEY);
  verifiedLegalConsentKey = "";
  legalConsentVerificationInFlight = null;
}

export function currentUser(): AuthUser | null { return wx.getStorageSync(USER_KEY) || null; }

function decodeJwtPayload(token: string): { exp?: number } | null {
  try {
    const segment = token.split(".")[1];
    if (!segment) return null;
    const padded = segment.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((segment.length + 3) % 4);
    const bytes = wx.base64ToArrayBuffer(padded);
    const text = String.fromCharCode(...new Uint8Array(bytes));
    return JSON.parse(text) as { exp?: number };
  } catch {
    return null;
  }
}

function isAccessTokenExpired(token: string, skewMs = 30_000): boolean {
  const payload = decodeJwtPayload(token);
  if (!payload?.exp) return false;
  return payload.exp * 1000 <= Date.now() + skewMs;
}

function ensureCloudInitialized(config: Extract<BackendConfig, { transport: "cloudRun" }>): void {
  if (!wx.cloud?.init || !wx.cloud?.callContainer) {
    throw new Error("当前微信基础库不支持云托管，请升级微信后重试");
  }
  if (initializedCloudEnvironments.has(config.envId)) return;
  wx.cloud.init({ env: config.envId });
  initializedCloudEnvironments.add(config.envId);
}

export function initializeBackend(): void {
  const config = backendConfig();
  if (config.transport === "cloudRun") ensureCloudInitialized(config);
}

/** Shared transport boundary: public HTTPS and WeChat Cloud Run return the same API envelope. */
export function dispatchBackendRequest(
  config: BackendConfig,
  path: string,
  options: RequestOptions,
  header: Record<string, string>
): Promise<TransportResponse> {
  return new Promise((resolve, reject) => {
    const callbacks = {
      success: (response: TransportResponse) => resolve(response),
      fail: () => reject(new Error("网络连接失败，请稍后重试"))
    };

    if (config.transport === "cloudRun") {
      try {
        ensureCloudInitialized(config);
      } catch (error) {
        reject(error);
        return;
      }
      wx.cloud.callContainer({
        config: { env: config.envId },
        path: `${config.apiPrefix}${path}`,
        method: options.method || "GET",
        data: options.data,
        header: { ...header, "X-WX-SERVICE": config.service },
        ...callbacks
      });
      return;
    }

    wx.request({
      url: `${config.baseUrl}${path}`,
      method: options.method || "GET",
      data: options.data,
      header,
      ...callbacks
    });
  });
}

function consentPayload() {
  const consent = currentLegalConsent();
  if (!consent) throw new Error("请先阅读并同意用户协议与隐私政策");
  return {
    version: consent.version,
    acceptedAt: consent.acceptedAt,
    privacyAccepted: consent.privacyAccepted,
    termsAccepted: consent.termsAccepted,
    adultConfirmed: consent.adultConfirmed,
    privacyUrl: consent.privacyUrl,
    termsUrl: consent.termsUrl,
    source: consent.source
  };
}

async function uploadLegalConsentReceipt(userId: string): Promise<void> {
  const payload = consentPayload();
  const response = await rawRequest<{ receipt: { id: string; version: string } }>("/users/me/legal-consents", {
    method: "POST", data: payload
  });
  if (!response?.receipt?.id || response.receipt.version !== payload.version) {
    throw new Error("服务端未确认协议同意记录");
  }
  verifiedLegalConsentKey = `${userId}:${payload.version}`;
}

async function verifyServerLegalConsent(user: AuthUser): Promise<void> {
  const consent = currentLegalConsent();
  if (!consent) requireLegalConsent();
  const key = `${user.id}:${consent!.version}`;
  if (verifiedLegalConsentKey === key) return;
  if (legalConsentVerificationInFlight) return legalConsentVerificationInFlight;

  legalConsentVerificationInFlight = (async () => {
    const status = await rawRequest<{ valid: boolean; receipt: { id: string; version: string } | null }>(
      `/users/me/legal-consents?version=${encodeURIComponent(consent!.version)}`
    );
    if (!status?.valid || status.receipt?.version !== consent!.version) {
      withdrawLegalConsent();
      clearSession();
      wx.reLaunch({ url: "/pages/consent/index" });
      throw new Error("协议版本需要重新确认");
    }
    bindLegalConsentToUser(user.id);
    verifiedLegalConsentKey = key;
  })().finally(() => { legalConsentVerificationInFlight = null; });
  return legalConsentVerificationInFlight;
}

async function rawRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const header: Record<string, string> = { "content-type": "application/json" };
  if (options.authenticated !== false && storedAccessToken()) header.Authorization = `Bearer ${storedAccessToken()}`;
  const response = await dispatchBackendRequest(backendConfig(), path, options, header);
  const body = response.data || {};
  if (response.statusCode >= 200 && response.statusCode < 300) return body.data as T;

  const error = new Error(body.error?.message || "服务暂时不可用") as ApiError;
  error.statusCode = response.statusCode;
  error.code = body.error?.code;
  error.details = body.error?.details;
  throw error;
}

export function readLocalFile(path: string): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({
      filePath: path,
      success: (result: { data: ArrayBuffer }) => resolve(result.data),
      fail: () => reject(new Error("无法读取待上传的媒体文件"))
    });
  });
}

export function uploadAuthorizedMedia(
  upload: MediaUploadReservation["upload"],
  bytes: ArrayBuffer
): Promise<void> {
  // The bundled mock adapter deliberately has no backing store. Completing its
  // reservation exercises the moderation lifecycle without leaking a bypass
  // into real environments.
  if (upload.url.startsWith("mock://")) return Promise.resolve();
  return new Promise((resolve, reject) => {
    wx.request({
      url: upload.url,
      method: upload.method,
      data: bytes,
      header: upload.headers,
      success: (response: { statusCode: number }) => {
        if (response.statusCode >= 200 && response.statusCode < 300) resolve();
        else reject(new Error("媒体上传失败，请重试"));
      },
      fail: () => reject(new Error("媒体上传失败，请检查网络"))
    });
  });
}

async function refreshSession(): Promise<void> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const refreshToken = storedRefreshToken();
    if (!refreshToken) throw new Error("登录已失效");
    const tokens = await rawRequest<{ accessToken: string; refreshToken: string; expiresIn: number }>("/auth/refresh", {
      method: "POST", data: { refreshToken }, authenticated: false
    });
    wx.setStorageSync(ACCESS_TOKEN_KEY, tokens.accessToken);
    wx.setStorageSync(REFRESH_TOKEN_KEY, tokens.refreshToken);
  })().finally(() => { refreshInFlight = null; });
  return refreshInFlight;
}

function wxLoginCode(): Promise<string> {
  return new Promise((resolve, reject) => wx.login({
    success: (result: any) => result.code ? resolve(result.code) : reject(new Error("未获取到微信登录凭证")),
    fail: () => reject(new Error("微信登录失败，请重试"))
  }));
}

async function loginWithWechatCode(): Promise<AuthSession> {
  requireLegalConsent();
  if (loginInFlight) return loginInFlight;
  loginInFlight = (async () => {
    const code = await wxLoginCode();
    const session = await rawRequest<AuthSession>("/auth/wechat/mini-program", {
      method: "POST", data: { code }, authenticated: false
    });
    saveSession(session);
    try {
      await uploadLegalConsentReceipt(session.user.id);
    } catch {
      clearSession();
      throw new Error("暂时无法记录协议同意，请稍后重试");
    }
    return session;
  })().finally(() => { loginInFlight = null; });
  return loginInFlight;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  requireLegalConsent();
  try {
    return await rawRequest<T>(path, options);
  } catch (error) {
    const apiError = error as ApiError;
    if (options.authenticated === false || options.retry === false || apiError.statusCode !== 401) {
      throw error;
    }

    if (storedRefreshToken()) {
      try {
        await refreshSession();
        return rawRequest<T>(path, { ...options, retry: false });
      } catch {
        clearSession();
      }
    } else {
      clearSession();
    }

    try {
      await loginWithWechatCode();
      return rawRequest<T>(path, { ...options, retry: false });
    } catch (loginError) {
      throw loginError;
    }
  }
}

export async function ensureSession(): Promise<AuthSession | null> {
  requireLegalConsent();
  const accessToken = storedAccessToken();
  if (accessToken && currentUser() && !isAccessTokenExpired(accessToken)) {
    await verifyServerLegalConsent(currentUser()!);
    return null;
  }

  if (storedRefreshToken()) {
    try {
      await refreshSession();
      if (!currentUser()) {
        const user = await rawRequest<AuthUser>("/me");
        wx.setStorageSync(USER_KEY, user);
        bindLegalConsentToUser(user.id);
      }
      if (storedAccessToken() && currentUser()) {
        await verifyServerLegalConsent(currentUser()!);
        return null;
      }
    } catch {
      clearSession();
    }
  }

  return loginWithWechatCode();
}

export async function logout(): Promise<void> {
  const refreshToken = storedRefreshToken();
  try {
    if (refreshToken) await request("/auth/logout", { method: "POST", data: { refreshToken } });
  } finally { clearSession(); }
}

export const api = {
  health: () => request<{ status: "ok" | "degraded"; service: string; version: string }>("/health", { authenticated: false }),
  fetchMe: () => request<AuthUser>("/me"),
  updateMe: (data: Record<string, unknown>) => request<AuthUser>("/me", { method: "PATCH", data }),
  requestDeletion: () => request<{ id: string; status: string; message: string }>("/me/deletion-request", { method: "POST" }),
  withdrawLegalConsent: () => rawRequest<{ withdrawn: boolean; withdrawnAt: string | null }>("/users/me/legal-consents/current", { method: "DELETE" }),
  companions: () => request<{ items: Companion[] }>("/companions"),
  recommendationTopics: () => request<{ algorithmVersion: string; items: RecommendationTopic[] }>("/recommendations/topics"),
  recommendationPreferences: () => request<RecommendationPreference>("/recommendations/me/preferences"),
  updateRecommendationPreferences: (data: Partial<Pick<RecommendationPreference,
    "personalizationEnabled" | "topicIds" | "city" | "maxPricePerHalfHour" | "preferredTimeSlots">>) =>
    request<RecommendationPreference>("/recommendations/me/preferences", { method: "PATCH", data }),
  deleteRecommendationTag: (id: string) => request<{ deleted: boolean; topicId: string }>(
    `/recommendations/me/tags/${encodeURIComponent(id)}`, { method: "DELETE" }
  ),
  recommendedCompanions: (options: {
    placement: RecommendationPlacement;
    pageSize?: number;
    cursor?: string;
    themeId?: string;
  }) => {
    const query = [
      `placement=${encodeURIComponent(options.placement)}`,
      options.pageSize ? `pageSize=${encodeURIComponent(String(options.pageSize))}` : "",
      options.cursor ? `cursor=${encodeURIComponent(options.cursor)}` : "",
      options.themeId ? `themeId=${encodeURIComponent(options.themeId)}` : ""
    ].filter(Boolean).join("&");
    return request<{
      algorithmVersion: string;
      personalized: boolean;
      items: RecommendedCompanion[];
      pagination: { pageSize: number; total: number; nextCursor: string | null };
    }>(`/recommendations/companions?${query}`);
  },
  recordRecommendationEvents: (events: Array<{ impressionId: string; type: "view" | "click" }>) =>
    request<{ updated: number }>("/recommendations/events", { method: "POST", data: { events } }),
  companion: (id: string) => request<Companion>(`/companions/${encodeURIComponent(id)}`, { authenticated: false }),
  ownCompanion: () => request<Companion>("/companions/me/profile"),
  applyCompanion: (data: Record<string, unknown>) => request<Companion>("/companions/me/application", { method: "POST", data }),
  community: () => request<{ items: CommunityPost[] }>("/community/posts"),
  createPost: (data: Record<string, unknown>) => request<CommunityPost>("/community/posts", { method: "POST", data }),
  setPostLike: (id: string, liked: boolean) => request<CommunityPost>(`/community/posts/${encodeURIComponent(id)}/like`, { method: "POST", data: { liked } }),
  reviews: (companionId: string) => request<{ items: Review[] }>(`/reviews/companion/${encodeURIComponent(companionId)}`, { authenticated: false }),
  createReview: (data: Record<string, unknown>) => request<Review>("/reviews", { method: "POST", data }),
  orders: () => request<{ items: Order[] }>("/orders"),
  serviceOrders: () => request<{ items: Order[] }>("/orders/service"),
  createOrder: (data: Record<string, unknown>) => request<Order>("/orders", { method: "POST", data }),
  cancelOrder: (id: string) => request<Order>(`/orders/${encodeURIComponent(id)}/cancel`, { method: "POST" }),
  startService: (id: string) => request<Order>(`/orders/service/${encodeURIComponent(id)}/start`, { method: "POST" }),
  completeService: (id: string) => request<Order>(`/orders/service/${encodeURIComponent(id)}/complete`, { method: "POST" }),
  confirmServiceOrder: (id: string) => request<Order>(`/orders/service/${encodeURIComponent(id)}/confirm`, { method: "POST" }),
  rejectServiceOrder: (id: string) => request<Order>(`/orders/service/${encodeURIComponent(id)}/reject`, { method: "POST" }),
  prepay: (id: string) => request<{ order: Order; payment: { outTradeNo: string; mock: boolean; channel: string; wechatMiniProgramParams?: MiniProgramPayParams } }>(`/orders/${encodeURIComponent(id)}/prepay`, { method: "POST", data: { channel: "miniProgram" } }),
  syncPayment: (id: string) => request<{
    code: "SUCCESS" | "PENDING";
    message: string;
    data: { alreadyProcessed: boolean; orderId: string; orderStatus: string };
  }>(`/orders/${encodeURIComponent(id)}/payment/sync`, { method: "POST" }),
  mockNotify: (outTradeNo: string) => request("/payments/wechat/mock-notify", { method: "POST", data: { outTradeNo } }),
  refund: (id: string, reason: string) => request(`/orders/${encodeURIComponent(id)}/refund`, { method: "POST", data: { reason } }),
  conversations: () => request<{ conversations: Conversation[] }>("/conversations"),
  conversationStatus: (id: string) => request<{
    mediaEnabled: boolean;
    chatRestriction: { id: string; reason: string; endsAt: string } | null;
  }>(`/conversations/${encodeURIComponent(id)}/status`),
  messages: (id: string, options: { cursor?: string; limit?: number } = {}) => {
    const query = [
      options.cursor ? `cursor=${encodeURIComponent(options.cursor)}` : "",
      typeof options.limit === "number" ? `limit=${encodeURIComponent(String(options.limit))}` : ""
    ].filter(Boolean).join("&");
    const suffix = query ? `?${query}` : "";
    return request<{ messages: ChatMessage[]; pagination: { nextCursor?: string | null; hasMore: boolean } }>(
      `/conversations/${encodeURIComponent(id)}/messages${suffix}`
    );
  },
  sendMessage: (id: string, content?: string, attachmentIds?: string[]) => request<{
    moderation: {
      decision: "allow" | "warn" | "review" | "block";
      riskLevel: string;
      deliveryStatus: "queued" | "pendingReview" | "published" | "blocked" | "removed";
      caseId: string | null;
      appealEligible: boolean;
    };
    message: ChatMessage | null;
    safetyMessage: ChatMessage | null;
  }>(`/conversations/${encodeURIComponent(id)}/messages`, {
    method: "POST",
    data: { ...(content?.trim() ? { content: content.trim() } : {}), ...(attachmentIds?.length ? { attachmentIds } : {}) }
  }),
  reserveMediaUpload: (id: string, data: {
    kind: "image" | "audio";
    mimeType: string;
    sizeBytes: number;
    sha256: string;
    durationMs?: number;
  }) => request<MediaUploadReservation>(`/conversations/${encodeURIComponent(id)}/media-uploads`, { method: "POST", data }),
  completeMediaUpload: (id: string, assetId: string) => request<{ asset: MediaAttachment }>(
    `/conversations/${encodeURIComponent(id)}/media-uploads/${encodeURIComponent(assetId)}/complete`,
    { method: "POST" }
  ),
  report: (data: Record<string, unknown>) => request("/moderation/reports", { method: "POST", data }),
  appeal: (caseId: string, reason: string) => request<{ appeal: { id: string; caseId: string; status: string; createdAt: string } }>(
    "/moderation/appeals",
    { method: "POST", data: { caseId, reason } }
  ),
  notifications: () => request<{ items: Notification[] }>("/notifications"),
  notificationUnreadCount: () => request<{ count: number }>("/notifications/unread-count"),
  markNotificationRead: (id: string) => request<Notification>(`/notifications/${encodeURIComponent(id)}/read`, { method: "POST" }),
  markAllNotificationsRead: () => request<{ updated: number }>("/notifications/read-all", { method: "POST" })
};
