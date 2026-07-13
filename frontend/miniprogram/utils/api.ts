import { API_BASE_URL } from "./config";
import {
  AuthSession, AuthUser, ChatMessage, CommunityPost, Companion, Conversation, MiniProgramPayParams,
  Notification, Order, Review
} from "./models";

type RequestOptions = { method?: "GET" | "POST" | "PATCH"; data?: Record<string, unknown>; authenticated?: boolean; retry?: boolean };
type ApiError = Error & { statusCode?: number; code?: string };

const ACCESS_TOKEN_KEY = "talkandtalk.accessToken";
const REFRESH_TOKEN_KEY = "talkandtalk.refreshToken";
const USER_KEY = "talkandtalk.user";
let refreshInFlight: Promise<void> | null = null;

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

function rawRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const header: Record<string, string> = { "content-type": "application/json" };
  if (options.authenticated !== false && storedAccessToken()) header.Authorization = `Bearer ${storedAccessToken()}`;
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${API_BASE_URL}${path}`,
      method: options.method || "GET",
      data: options.data,
      header,
      success: (response: any) => {
        const body = response.data || {};
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve(body.data as T);
          return;
        }
        const error = new Error(body.error?.message || "服务暂时不可用") as ApiError;
        error.statusCode = response.statusCode;
        error.code = body.error?.code;
        reject(error);
      },
      fail: () => reject(new Error("网络连接失败，请稍后重试"))
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

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  try {
    return await rawRequest<T>(path, options);
  } catch (error) {
    const apiError = error as ApiError;
    if (options.authenticated !== false && options.retry !== false && apiError.statusCode === 401 && storedRefreshToken()) {
      try {
        await refreshSession();
        return rawRequest<T>(path, { ...options, retry: false });
      } catch {
        clearSession();
      }
    }
    throw error;
  }
}

function wxLoginCode(): Promise<string> {
  return new Promise((resolve, reject) => wx.login({
    success: (result: any) => result.code ? resolve(result.code) : reject(new Error("未获取到微信登录凭证")),
    fail: () => reject(new Error("微信登录失败，请重试"))
  }));
}

export async function ensureSession(): Promise<AuthSession | null> {
  if (storedAccessToken() && currentUser()) return null;
  const code = await wxLoginCode();
  const session = await rawRequest<AuthSession>("/auth/wechat/mini-program", {
    method: "POST", data: { code }, authenticated: false
  });
  saveSession(session);
  return session;
}

export async function logout(): Promise<void> {
  const refreshToken = storedRefreshToken();
  try {
    if (refreshToken) await request("/auth/logout", { method: "POST", data: { refreshToken } });
  } finally { clearSession(); }
}

export const api = {
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
