import { BackendConfig, backendConfig } from "./config";
import {
  AuthSession, AuthUser, ChatMessage, CommunityPost, Companion, Conversation, MiniProgramPayParams,
  Notification, Order, Review
} from "./models";

export type RequestOptions = { method?: "GET" | "POST" | "PATCH"; data?: Record<string, unknown>; authenticated?: boolean; retry?: boolean };
type ApiError = Error & { statusCode?: number; code?: string };
type TransportResponse = { statusCode: number; data?: any };

const ACCESS_TOKEN_KEY = "talkandtalk.accessToken";
const REFRESH_TOKEN_KEY = "talkandtalk.refreshToken";
const USER_KEY = "talkandtalk.user";
let refreshInFlight: Promise<void> | null = null;
let loginInFlight: Promise<AuthSession> | null = null;
const initializedCloudEnvironments = new Set<string>();

function storedAccessToken(): string { return wx.getStorageSync(ACCESS_TOKEN_KEY) || ""; }
function storedRefreshToken(): string { return wx.getStorageSync(REFRESH_TOKEN_KEY) || ""; }

function saveSession(session: AuthSession): void {
  wx.setStorageSync(ACCESS_TOKEN_KEY, session.accessToken);
  wx.setStorageSync(REFRESH_TOKEN_KEY, session.refreshToken);
  wx.setStorageSync(USER_KEY, session.user);
}

export function clearSession(): void {
  wx.removeStorageSync(ACCESS_TOKEN_KEY);
  wx.removeStorageSync(REFRESH_TOKEN_KEY);
  wx.removeStorageSync(USER_KEY);
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

async function rawRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const header: Record<string, string> = { "content-type": "application/json" };
  if (options.authenticated !== false && storedAccessToken()) header.Authorization = `Bearer ${storedAccessToken()}`;
  const response = await dispatchBackendRequest(backendConfig(), path, options, header);
  const body = response.data || {};
  if (response.statusCode >= 200 && response.statusCode < 300) return body.data as T;

  const error = new Error(body.error?.message || "服务暂时不可用") as ApiError;
  error.statusCode = response.statusCode;
  error.code = body.error?.code;
  throw error;
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
  if (loginInFlight) return loginInFlight;
  loginInFlight = (async () => {
    const code = await wxLoginCode();
    const session = await rawRequest<AuthSession>("/auth/wechat/mini-program", {
      method: "POST", data: { code }, authenticated: false
    });
    saveSession(session);
    return session;
  })().finally(() => { loginInFlight = null; });
  return loginInFlight;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
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
  const accessToken = storedAccessToken();
  if (accessToken && currentUser() && !isAccessTokenExpired(accessToken)) {
    return null;
  }

  if (storedRefreshToken()) {
    try {
      await refreshSession();
      if (!currentUser()) {
        const user = await rawRequest<AuthUser>("/me");
        wx.setStorageSync(USER_KEY, user);
      }
      if (storedAccessToken() && currentUser()) return null;
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
  companions: () => request<{ items: Companion[] }>("/companions"),
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
  prepay: (id: string) => request<{ order: Order; payment: { outTradeNo: string; mock: boolean; channel: string; wechatMiniProgramParams?: MiniProgramPayParams } }>(`/orders/${encodeURIComponent(id)}/prepay`, { method: "POST", data: { channel: "miniProgram" } }),
  mockNotify: (outTradeNo: string) => request("/payments/wechat/mock-notify", { method: "POST", data: { outTradeNo } }),
  refund: (id: string, reason: string) => request(`/orders/${encodeURIComponent(id)}/refund`, { method: "POST", data: { reason } }),
  conversations: () => request<{ conversations: Conversation[] }>("/conversations"),
  messages: (id: string) => request<{ messages: ChatMessage[]; pagination: { nextCursor?: string | null; hasMore: boolean } }>(`/conversations/${encodeURIComponent(id)}/messages`),
  sendMessage: (id: string, content: string) => request<{
    moderation: { decision: "allow" | "warn" | "review" | "block"; riskLevel: string };
    message: ChatMessage | null;
    safetyMessage: ChatMessage | null;
  }>(`/conversations/${encodeURIComponent(id)}/messages`, { method: "POST", data: { content } }),
  report: (data: Record<string, unknown>) => request("/moderation/reports", { method: "POST", data }),
  notifications: () => request<{ items: Notification[] }>("/notifications")
};
