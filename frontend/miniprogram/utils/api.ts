import { BackendConfig, backendConfig } from "./config";
import {
  AccountDeletionPolicy, AccountDeletionRequest, AccountSession, AuthSession, AuthUser, AvailabilityReminderChannel, ChatMessage, CommunityPost, CommunityPostReportReceipt, CommunityReportReceipt, Companion, Conversation, CrisisIntervention, CrisisInterventionRiskCode, CrisisInterventionSource, CrisisResourceCatalog, CustomerAdultEligibilityMethod, CustomerAdultEligibilityStatus, DataRightsFollowUp, DataRightsRequest, DataRightsRequestType, FavoriteAvailabilityReminderPreference, FavoriteCompanion, InvoiceRequest, MediaAttachment, MiniProgramPayParams,
  InvoiceCandidateOrder, LoginIdentityUnavailableNotice, ModerationAppeal, ModerationAppealableCase, Notification, Order, OrderExperienceFeedbackTag, OrderRescheduleRequest, OrderServiceIntentCode, OrderTimeline, PaymentDispute, PublicSupportInfo, RecommendationCompanionExclusion, RecommendationPlacement, RecommendationPreference, RecommendationTopic, RecommendedCompanion, RefundRequestResult, ReporterCase, ReporterCaseFollowUp, ReporterCaseSummary, Review, VoiceRoomAccess,
  CompanionTodayServiceSchedule,
  CompanionAvailabilityResponse, CreateOwnAvailabilityWindowInput, CreateOwnServiceOfferingInput, OwnAvailabilityWindow, OwnServiceOffering, ServiceOffering,
  SupportTicket, SupportTicketCategory, UpdateOwnAvailabilityWindowInput, UpdateOwnServiceOfferingInput, UserAccountAction, UserAccountAppeal
} from "./models";
import {
  bindLegalConsentToUser, currentLegalConsent, requireLegalConsent, withdrawLegalConsent
} from "./privacy";

export type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  data?: Record<string, unknown>;
  authenticated?: boolean;
  retry?: boolean;
};
export type CreateOrderRequest = {
  companionId: string;
  themeId: string;
  durationMinutes: number;
  scheduledAt: string;
  clientRequestId?: string;
  recommendationImpressionId?: string;
  serviceOfferingId?: string;
  availabilityWindowId?: string;
  serviceIntent: OrderServiceIntentCode;
};
export type ApiError = Error & { statusCode?: number; code?: string; details?: Record<string, unknown> };
export type Pagination = { page: number; pageSize: number; total: number; totalPages: number };
type TransportResponse = { statusCode: number; data?: any };

export type MediaUploadReservation = {
  asset: Omit<MediaAttachment, "url">;
  upload: { url: string; method: "PUT" | "POST"; headers: Record<string, string>; expiresAt: string };
};

export type ControlledEvidenceAsset = Omit<MediaAttachment, "url"> & {
  purpose: "orderSupportFact" | "attendanceDisputeStatement" | "companionIncidentReport";
};

const ACCESS_TOKEN_KEY = "talkandtalk.accessToken";
const REFRESH_TOKEN_KEY = "talkandtalk.refreshToken";
const USER_KEY = "talkandtalk.user";
const LOGIN_IDENTITY_UNAVAILABLE_KEY = "talkandtalk.loginIdentityUnavailable";
const LOGIN_IDENTITY_UNAVAILABLE_MESSAGE = "该登录标识暂不可使用，请联系客服";
let refreshInFlight: Promise<void> | null = null;
let loginInFlight: Promise<AuthSession> | null = null;
let legalRecoveryLoginInFlight: Promise<AuthSession> | null = null;
let legalConsentVerificationInFlight: Promise<void> | null = null;
let verifiedLegalConsentKey = "";
const initializedCloudEnvironments = new Set<string>();

function storedAccessToken(): string { return wx.getStorageSync(ACCESS_TOKEN_KEY) || ""; }
function storedRefreshToken(): string { return wx.getStorageSync(REFRESH_TOKEN_KEY) || ""; }

function saveSession(session: AuthSession): void {
  wx.setStorageSync(ACCESS_TOKEN_KEY, session.accessToken);
  wx.setStorageSync(REFRESH_TOKEN_KEY, session.refreshToken);
  wx.setStorageSync(USER_KEY, session.user);
  wx.removeStorageSync(LOGIN_IDENTITY_UNAVAILABLE_KEY);
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

export function currentLoginIdentityUnavailableNotice(): LoginIdentityUnavailableNotice | null {
  const notice = wx.getStorageSync(LOGIN_IDENTITY_UNAVAILABLE_KEY) as Partial<LoginIdentityUnavailableNotice> | undefined;
  if (notice?.code !== "LOGIN_IDENTITY_UNAVAILABLE" || typeof notice.message !== "string") return null;
  return { code: notice.code, message: LOGIN_IDENTITY_UNAVAILABLE_MESSAGE };
}

function handleLoginIdentityUnavailable(error: unknown): boolean {
  const apiError = error as ApiError;
  if (apiError.statusCode !== 409 || apiError.code !== "LOGIN_IDENTITY_UNAVAILABLE") return false;
  clearSession();
  const notice: LoginIdentityUnavailableNotice = {
    code: "LOGIN_IDENTITY_UNAVAILABLE",
    message: LOGIN_IDENTITY_UNAVAILABLE_MESSAGE
  };
  wx.setStorageSync(LOGIN_IDENTITY_UNAVAILABLE_KEY, notice);
  apiError.message = LOGIN_IDENTITY_UNAVAILABLE_MESSAGE;
  wx.reLaunch({ url: "/pages/account/deletion-status" });
  return true;
}

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
    let session: AuthSession;
    try {
      session = await rawRequest<AuthSession>("/auth/wechat/mini-program", {
        method: "POST", data: { code }, authenticated: false
      });
    } catch (error) {
      handleLoginIdentityUnavailable(error);
      throw error;
    }
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

/**
 * Establishes identity only for the narrowly allowlisted account-rights flow.
 * It deliberately does not create or upload a platform legal-consent receipt.
 */
async function loginForLegalRecovery(): Promise<AuthSession> {
  if (legalRecoveryLoginInFlight) return legalRecoveryLoginInFlight;
  legalRecoveryLoginInFlight = (async () => {
    const code = await wxLoginCode();
    let session: AuthSession;
    try {
      session = await rawRequest<AuthSession>("/auth/wechat/mini-program", {
        method: "POST", data: { code }, authenticated: false
      });
    } catch (error) {
      handleLoginIdentityUnavailable(error);
      throw error;
    }
    saveSession(session);
    return session;
  })().finally(() => { legalRecoveryLoginInFlight = null; });
  return legalRecoveryLoginInFlight;
}

export async function ensureLegalRecoverySession(): Promise<AuthSession | null> {
  const accessToken = storedAccessToken();
  if (accessToken && currentUser() && !isAccessTokenExpired(accessToken)) return null;

  if (storedRefreshToken()) {
    try {
      await refreshSession();
      if (storedAccessToken() && currentUser()) return null;
    } catch {
      clearSession();
    }
  } else if (accessToken || currentUser()) {
    clearSession();
  }

  return loginForLegalRecovery();
}

function isAllowedLegalRecoveryRequest(path: string, method: NonNullable<RequestOptions["method"]>): boolean {
  const pathname = path.split("?", 1)[0];
  if (pathname === "/me/account-actions" && method === "GET") return true;
  if (/^\/me\/account-actions\/[^/?]+\/appeals$/.test(pathname) && method === "POST") return true;
  if (pathname === "/me/data-rights" && (method === "GET" || method === "POST")) return true;
  if (/^\/me\/data-rights\/[^/?]+\/follow-ups$/.test(pathname) && method === "POST") return true;
  if (pathname === "/me/deletion-request" && (method === "GET" || method === "POST")) return true;
  return pathname === "/me/deletion-request/cancel" && method === "POST";
}

/**
 * No caller can turn this into a general consent bypass: both route and method
 * are checked here, in addition to the server-side @SkipLegalConsent boundary.
 */
async function legalRecoveryRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method || "GET";
  if (!isAllowedLegalRecoveryRequest(path, method)) {
    throw new Error("该操作不属于账号权利恢复通道");
  }
  await ensureLegalRecoverySession();
  try {
    return await rawRequest<T>(path, { ...options, authenticated: true });
  } catch (error) {
    const apiError = error as ApiError;
    if (options.retry === false || apiError.statusCode !== 401) throw error;
    clearSession();
    await loginForLegalRecovery();
    return rawRequest<T>(path, { ...options, authenticated: true, retry: false });
  }
}

function isAllowedCrisisSafetyRequest(path: string, method: NonNullable<RequestOptions["method"]>): boolean {
  if (path === "/crisis/interventions" && method === "POST") return true;
  if (path === "/crisis/interventions/active" && method === "GET") return true;
  if (/^\/crisis\/interventions\/[^/?]+$/.test(path) && method === "GET") return true;
  return /^\/crisis\/interventions\/[^/?]+\/resource-view-completions$/.test(path) && method === "POST";
}

/** Exact, server-mirrored safety bypass: public resources never depend on consent,
 * while owner facts may establish a session without redirecting away from help. */
async function crisisSafetyRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method || "GET";
  if (!isAllowedCrisisSafetyRequest(path, method)) {
    throw new Error("该操作不属于紧急资源安全通道");
  }
  await ensureLegalRecoverySession();
  try {
    return await rawRequest<T>(path, { ...options, authenticated: true });
  } catch (error) {
    const apiError = error as ApiError;
    if (options.retry === false || apiError.statusCode !== 401) throw error;
    clearSession();
    await loginForLegalRecovery();
    return rawRequest<T>(path, { ...options, authenticated: true, retry: false });
  }
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

export type DownloadedDataExport = {
  tempFilePath: string;
  fileName: string;
  contentType: string;
};

export async function downloadDataRightsExport(
  requestId: string
): Promise<DownloadedDataExport> {
  const id = requestId.trim();
  if (!id) throw new Error("缺少数据导出请求编号");

  // Exercise the rights-recovery refresh/login path before starting a binary
  // download, because wx.downloadFile does not participate in request retries.
  await legalRecoveryRequest<{ items: DataRightsRequest[] }>("/me/data-rights");
  const config = backendConfig();
  if (config.transport !== "https") {
    throw new Error("当前云托管通道尚未配置安全文件下载，请联系平台客服");
  }
  const accessToken = storedAccessToken();
  if (!accessToken) throw new Error("登录会话已失效，请重新进入后重试");

  const result = await new Promise<any>((resolve, reject) => {
    wx.downloadFile({
      url: `${config.baseUrl}/me/data-rights/${encodeURIComponent(id)}/export`,
      header: { Authorization: `Bearer ${accessToken}` },
      timeout: 65_000,
      success: resolve,
      fail: reject
    });
  }).catch((error: any) => {
    throw new Error(error?.errMsg || "数据包下载失败");
  });
  if (result.statusCode < 200 || result.statusCode >= 300 || !result.tempFilePath) {
    throw new Error(
      result.statusCode === 409
        ? "数据包尚未生成完成"
        : result.statusCode === 503
          ? "安全数据交付通道暂未配置"
          : `数据包下载失败（${result.statusCode || "网络错误"}）`
    );
  }
  const headers = Object.entries(result.header || {}).reduce<Record<string, string>>(
    (output, [key, value]) => {
      output[key.toLowerCase()] = String(value);
      return output;
    },
    {}
  );
  const contentType = (headers["content-type"] || "application/octet-stream")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  const extension = contentType === "application/zip"
    ? "zip"
    : contentType === "application/pdf"
      ? "pdf"
      : "json";
  return {
    tempFilePath: result.tempFilePath,
    fileName: `TalkAndTalk-个人数据副本-${id.slice(0, 8)}.${extension}`,
    contentType
  };
}

export async function logout(): Promise<void> {
  const refreshToken = storedRefreshToken();
  try {
    if (refreshToken) await request("/auth/logout", { method: "POST", data: { refreshToken } });
  } finally { clearSession(); }
}

/** Best-effort server logout for a user who has not accepted current terms. */
export async function logoutLegalRecovery(): Promise<void> {
  const refreshToken = storedRefreshToken();
  try {
    if (refreshToken && storedAccessToken()) {
      await rawRequest("/auth/logout", { method: "POST", data: { refreshToken }, retry: false });
    }
  } catch {
    // Local credentials must still be removed even if the server token was
    // already revoked by consent withdrawal or the network is unavailable.
  } finally {
    clearSession();
  }
}

export const api = {
  health: () => request<{ status: "ok" | "degraded"; service: string; version: string }>("/health", { authenticated: false }),
  crisisResources: (region = "CN") => rawRequest<CrisisResourceCatalog>(
    `/crisis/resources?region=${encodeURIComponent(region)}`,
    { authenticated: false }
  ),
  activeCrisisIntervention: () => crisisSafetyRequest<{ intervention: CrisisIntervention | null }>(
    "/crisis/interventions/active"
  ),
  crisisIntervention: (id: string) => crisisSafetyRequest<CrisisIntervention>(
    `/crisis/interventions/${encodeURIComponent(id)}`
  ),
  createCrisisIntervention: (data: {
    source: CrisisInterventionSource;
    riskCode: CrisisInterventionRiskCode;
    region: string;
  }) => crisisSafetyRequest<CrisisIntervention>("/crisis/interventions", { method: "POST", data }),
  completeCrisisResourceView: (id: string) => crisisSafetyRequest<CrisisIntervention>(
    `/crisis/interventions/${encodeURIComponent(id)}/resource-view-completions`,
    { method: "POST" }
  ),
  // Intentionally bypasses legal/session bootstrap: this is the recovery
  // contact path for users whose login or consent flow itself is unavailable.
  publicSupportInfo: () =>
    rawRequest<PublicSupportInfo>("/support/public-info", { authenticated: false }),
  fetchMe: () => request<AuthUser>("/me"),
  updateMe: (data: Record<string, unknown>) => request<AuthUser>("/me", { method: "PATCH", data }),
  customerAdultEligibility: () => request<CustomerAdultEligibilityStatus>("/me/adult-eligibility"),
  submitCustomerAdultEligibility: (data: {
    verificationMethod: CustomerAdultEligibilityMethod;
    evidenceReference: string;
    evidenceProcessingConfirmed: true;
  }) => request<CustomerAdultEligibilityStatus>("/me/adult-eligibility/submissions", {
    method: "POST",
    data
  }),
  deletionRequest: () => legalRecoveryRequest<{
    request: AccountDeletionRequest | null;
    policy: AccountDeletionPolicy;
  }>("/me/deletion-request"),
  requestDeletion: () => legalRecoveryRequest<AccountDeletionRequest & {
    message: string;
    policy: AccountDeletionPolicy;
  }>("/me/deletion-request", { method: "POST" }),
  cancelDeletionRequest: () => legalRecoveryRequest<AccountDeletionRequest & {
    message: string;
    policy: AccountDeletionPolicy;
    cancellation: {
      idempotent: boolean;
      accountStatusPreserved: "active" | "restricted" | "banned" | string;
      independentAccountActionsPreserved: boolean;
      sessionsRestored: boolean;
      companionSupply: {
        automaticRestore: boolean;
        reactivationRequired: boolean;
        state: "manualReviewRequired" | "notApplicable" | string;
        requirements: string[];
      };
    };
  }>("/me/deletion-request/cancel", { method: "POST" }),
  accountActions: (options: {
    page?: number;
    pageSize?: number;
    status?: "pending" | "upheld" | "overturned" | "dismissed";
    actionId?: string;
    appealId?: string;
  } = {}) => {
    const query = [
      options.page ? `page=${encodeURIComponent(String(options.page))}` : "",
      options.pageSize ? `pageSize=${encodeURIComponent(String(options.pageSize))}` : "",
      options.status ? `status=${encodeURIComponent(options.status)}` : "",
      options.actionId ? `actionId=${encodeURIComponent(options.actionId)}` : "",
      options.appealId ? `appealId=${encodeURIComponent(options.appealId)}` : ""
    ].filter(Boolean).join("&");
    return legalRecoveryRequest<{
      accountStatus: "active" | "restricted" | "banned" | string;
      items: UserAccountAction[];
      pagination: { page: number; pageSize: number; total: number; totalPages: number };
    }>(`/me/account-actions${query ? `?${query}` : ""}`);
  },
  createAccountActionAppeal: (id: string, statement: string) => legalRecoveryRequest<UserAccountAppeal>(
    `/me/account-actions/${encodeURIComponent(id)}/appeals`,
    { method: "POST", data: { statement } }
  ),
  accountSessions: (options: { page?: number; pageSize?: number } = {}) => {
    const query = [
      options.page ? `page=${encodeURIComponent(String(options.page))}` : "",
      options.pageSize ? `pageSize=${encodeURIComponent(String(options.pageSize))}` : ""
    ].filter(Boolean).join("&");
    return request<{
      items: AccountSession[];
      pagination: { page: number; pageSize: number; total: number; totalPages: number };
    }>(`/me/sessions${query ? `?${query}` : ""}`);
  },
  revokeOtherAccountSessions: () => request<{ success: boolean; revokedCount: number }>(
    "/me/sessions",
    { method: "DELETE" }
  ),
  revokeAccountSession: (id: string) => request<{ success: boolean; id: string }>(
    `/me/sessions/${encodeURIComponent(id)}`,
    { method: "DELETE" }
  ),
  dataRightsRequests: (options: {
    page?: number;
    pageSize?: number;
    status?: DataRightsRequest["status"];
  } = {}) => {
    const query = [
      options.page ? `page=${encodeURIComponent(String(options.page))}` : "",
      options.pageSize ? `pageSize=${encodeURIComponent(String(options.pageSize))}` : "",
      options.status ? `status=${encodeURIComponent(options.status)}` : ""
    ].filter(Boolean).join("&");
    return legalRecoveryRequest<{
      items: DataRightsRequest[];
      pagination: { page: number; pageSize: number; total: number; totalPages: number };
    }>(`/me/data-rights${query ? `?${query}` : ""}`);
  },
  createDataRightsRequest: (data: { type: DataRightsRequestType; description: string }) =>
    legalRecoveryRequest<DataRightsRequest>("/me/data-rights", { method: "POST", data }),
  addDataRightsRequestFollowUp: (id: string, statement: string) =>
    legalRecoveryRequest<{ request: DataRightsRequest; followUp: DataRightsFollowUp }>(
      `/me/data-rights/${encodeURIComponent(id)}/follow-ups`,
      { method: "POST", data: { statement } }
    ),
  invoiceRequests: (options: {
    page?: number;
    pageSize?: number;
    status?: InvoiceRequest["status"];
  } = {}) => {
    const query = [
      options.page ? `page=${encodeURIComponent(String(options.page))}` : "",
      options.pageSize ? `pageSize=${encodeURIComponent(String(options.pageSize))}` : "",
      options.status ? `status=${encodeURIComponent(options.status)}` : ""
    ].filter(Boolean).join("&");
    return request<{
      items: InvoiceRequest[];
      pagination: { page: number; pageSize: number; total: number; totalPages: number };
    }>(`/me/invoice-requests${query ? `?${query}` : ""}`);
  },
  createInvoiceRequest: (data: { orderId: string; invoiceTitle: string }) =>
    request<InvoiceRequest>("/me/invoice-requests", { method: "POST", data }),
  invoiceCandidateOrders: (options: { page?: number; pageSize?: number } = {}) => {
    const query = [
      options.page ? `page=${encodeURIComponent(String(options.page))}` : "",
      options.pageSize ? `pageSize=${encodeURIComponent(String(options.pageSize))}` : ""
    ].filter(Boolean).join("&");
    return request<{ items: InvoiceCandidateOrder[]; pagination: Pagination }>(
      `/me/invoice-requests/eligible-orders${query ? `?${query}` : ""}`
    );
  },
  cancelInvoiceRequest: (id: string) =>
    request<InvoiceRequest>(`/me/invoice-requests/${encodeURIComponent(id)}/cancel`, { method: "POST" }),
  withdrawLegalConsent: () => rawRequest<{ withdrawn: boolean; withdrawnAt: string | null }>("/users/me/legal-consents/current", { method: "DELETE" }),
  companions: (options: {
    page?: number;
    pageSize?: number;
    tag?: string;
    language?: string;
    specialty?: string;
    keyword?: string;
    sortBy?: "online" | "rating" | "reviewCount" | "priceAsc" | "soonestAvailable";
    availability?: "online" | "available" | "busy";
    isOnline?: boolean;
    topicId?: string;
    deliveryMode?: "text" | "voice";
    maxServicePriceCents?: number;
    availableWithinDays?: number;
  } = {}) => {
    const query = [
      options.page ? `page=${encodeURIComponent(String(options.page))}` : "",
      options.pageSize ? `pageSize=${encodeURIComponent(String(options.pageSize))}` : "",
      options.tag ? `tag=${encodeURIComponent(options.tag)}` : "",
      options.language ? `language=${encodeURIComponent(options.language)}` : "",
      options.specialty ? `specialty=${encodeURIComponent(options.specialty)}` : "",
      options.keyword ? `keyword=${encodeURIComponent(options.keyword)}` : "",
      options.sortBy ? `sortBy=${encodeURIComponent(options.sortBy)}` : "",
      options.availability ? `availability=${encodeURIComponent(options.availability)}` : "",
      options.isOnline === undefined ? "" : `isOnline=${options.isOnline ? "true" : "false"}`,
      options.topicId ? `topicId=${encodeURIComponent(options.topicId)}` : "",
      options.deliveryMode ? `deliveryMode=${encodeURIComponent(options.deliveryMode)}` : "",
      options.maxServicePriceCents ? `maxServicePriceCents=${encodeURIComponent(String(options.maxServicePriceCents))}` : "",
      options.availableWithinDays ? `availableWithinDays=${encodeURIComponent(String(options.availableWithinDays))}` : ""
    ].filter(Boolean).join("&");
    return request<{ items: Companion[]; pagination: { total: number } }>(
      `/companions${query ? `?${query}` : ""}`
    );
  },
  recommendationTopics: () => request<{ algorithmVersion: string; items: RecommendationTopic[] }>("/recommendations/topics"),
  recommendationPreferences: () => request<RecommendationPreference>("/recommendations/me/preferences"),
  updateRecommendationPreferences: (data: Partial<Pick<RecommendationPreference,
    "personalizationEnabled" | "topicIds" | "city" | "maxPricePerHalfHour" | "preferredTimeSlots">>) =>
    request<RecommendationPreference>("/recommendations/me/preferences", { method: "PATCH", data }),
  deleteRecommendationTag: (id: string) => request<{ deleted: boolean; topicId: string }>(
    `/recommendations/me/tags/${encodeURIComponent(id)}`, { method: "DELETE" }
  ),
  recommendationCompanionExclusions: (options: { page?: number; pageSize?: number } = {}) => {
    const query = [
      options.page ? `page=${encodeURIComponent(String(options.page))}` : "",
      options.pageSize ? `pageSize=${encodeURIComponent(String(options.pageSize))}` : ""
    ].filter(Boolean).join("&");
    return request<{ items: RecommendationCompanionExclusion[]; pagination: Pagination }>(
      `/recommendations/me/companion-exclusions${query ? `?${query}` : ""}`
    );
  },
  excludeCompanionFromRecommendations: (id: string) =>
    request<{ excluded: true; item: RecommendationCompanionExclusion }>(
      `/recommendations/me/companion-exclusions/${encodeURIComponent(id)}`,
      { method: "PUT" }
    ),
  restoreCompanionToRecommendations: (id: string) =>
    request<{ excluded: false; removed: boolean; companionId: string }>(
      `/recommendations/me/companion-exclusions/${encodeURIComponent(id)}`,
      { method: "DELETE" }
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
  serviceOfferings: (id: string, options: { page?: number; pageSize?: number } = {}) => {
    const query = [
      options.page ? `page=${encodeURIComponent(String(options.page))}` : "",
      options.pageSize ? `pageSize=${encodeURIComponent(String(options.pageSize))}` : ""
    ].filter(Boolean).join("&");
    return request<{ items: ServiceOffering[]; pagination: Pagination }>(
      `/companions/${encodeURIComponent(id)}/service-offerings${query ? `?${query}` : ""}`,
      { authenticated: false }
    );
  },
  companionAvailability: (
    id: string,
    options: { serviceOfferingId?: string; durationMinutes?: number; from?: string; days?: number } = {}
  ) => {
    const query = [
      options.serviceOfferingId ? `serviceOfferingId=${encodeURIComponent(options.serviceOfferingId)}` : "",
      options.durationMinutes ? `durationMinutes=${encodeURIComponent(String(options.durationMinutes))}` : "",
      options.from ? `from=${encodeURIComponent(options.from)}` : "",
      options.days ? `days=${encodeURIComponent(String(options.days))}` : ""
    ].filter(Boolean).join("&");
    return request<CompanionAvailabilityResponse>(
      `/companions/${encodeURIComponent(id)}/availability${query ? `?${query}` : ""}`,
      { authenticated: false }
    );
  },
  favoriteCompanions: (options: { page?: number; pageSize?: number } = {}) => {
    const query = [
      options.page ? `page=${encodeURIComponent(String(options.page))}` : "",
      options.pageSize ? `pageSize=${encodeURIComponent(String(options.pageSize))}` : ""
    ].filter(Boolean).join("&");
    return request<{ items: FavoriteCompanion[]; pagination: Pagination }>(
      `/favorites/companions${query ? `?${query}` : ""}`
    );
  },
  favoriteCompanionStatus: (id: string) => request<{
    companionId: string;
    favorited: boolean;
    availabilityReminderEnabled: boolean;
    availabilityReminderUpdatedAt: string | null;
    availabilityReminderMinimumIntervalHours: number;
  }>(`/favorites/companions/${encodeURIComponent(id)}/status`),
  saveFavoriteCompanion: (id: string) => request<{ favorited: true; companion: Companion }>(
    `/favorites/companions/${encodeURIComponent(id)}`,
    { method: "PUT" }
  ),
  setFavoriteAvailabilityReminder: (
    id: string,
    data: { enabled: boolean; subscriptionGrantId?: string }
  ) => request<FavoriteAvailabilityReminderPreference>(
    `/favorites/companions/${encodeURIComponent(id)}/availability-reminder`,
    { method: "PUT", data }
  ),
  availabilityReminderChannel: () => request<AvailabilityReminderChannel>(
    "/notifications/channels/availability-reminder"
  ),
  removeFavoriteCompanion: (id: string) => request<{ favorited: false; removed: boolean }>(
    `/favorites/companions/${encodeURIComponent(id)}`,
    { method: "DELETE" }
  ),
  recentlyViewedCompanions: () => request<{ items: Companion[] }>("/recently-viewed/companions"),
  recordRecentlyViewedCompanion: (id: string) => request<{ recorded: true }>(
    `/recently-viewed/companions/${encodeURIComponent(id)}`,
    { method: "PUT" }
  ),
  clearRecentlyViewedCompanions: () => request<{ cleared: number }>("/recently-viewed/companions", { method: "DELETE" }),
  ownCompanion: () => request<Companion>("/companions/me/profile"),
  ownServiceOfferings: (options: { page?: number; pageSize?: number } = {}) => {
    const query = [
      options.page ? `page=${encodeURIComponent(String(options.page))}` : "",
      options.pageSize ? `pageSize=${encodeURIComponent(String(options.pageSize))}` : ""
    ].filter(Boolean).join("&");
    return request<{ items: OwnServiceOffering[]; summary: { total: number; active: number }; pagination: Pagination }>(
      `/companions/me/service-offerings${query ? `?${query}` : ""}`
    );
  },
  createOwnServiceOffering: (data: CreateOwnServiceOfferingInput) => request<OwnServiceOffering>(
    "/companions/me/service-offerings",
    { method: "POST", data }
  ),
  updateOwnServiceOffering: (id: string, data: UpdateOwnServiceOfferingInput) => request<OwnServiceOffering>(
    `/companions/me/service-offerings/${encodeURIComponent(id)}`,
    { method: "PATCH", data }
  ),
  ownAvailabilityWindows: (options: { page?: number; pageSize?: number } = {}) => {
    const query = [
      options.page ? `page=${options.page}` : "",
      options.pageSize ? `pageSize=${options.pageSize}` : ""
    ].filter(Boolean).join("&");
    return request<{
      items: OwnAvailabilityWindow[];
      summary: { futureActiveCount: number; nextFutureActiveStartsAt: string | null };
      pagination: Pagination;
    }>(
      `/companions/me/availability-windows${query ? `?${query}` : ""}`
    );
  },
  createOwnAvailabilityWindow: (data: CreateOwnAvailabilityWindowInput) => request<OwnAvailabilityWindow>(
    "/companions/me/availability-windows",
    { method: "POST", data }
  ),
  updateOwnAvailabilityWindow: (id: string, data: UpdateOwnAvailabilityWindowInput) => request<OwnAvailabilityWindow>(
    `/companions/me/availability-windows/${encodeURIComponent(id)}`,
    { method: "PATCH", data }
  ),
  community: (options: { page?: number; pageSize?: number } = {}) => {
    const query = [
      options.page ? `page=${options.page}` : "",
      options.pageSize ? `pageSize=${options.pageSize}` : ""
    ].filter(Boolean).join("&");
    return request<{ items: CommunityPost[]; pagination: Pagination }>(
      `/community/posts${query ? `?${query}` : ""}`
    );
  },
  createPost: (data: Record<string, unknown>) => request<CommunityPost>("/community/posts", { method: "POST", data }),
  setPostLike: (id: string, liked: boolean) => request<CommunityPost>(`/community/posts/${encodeURIComponent(id)}/like`, { method: "POST", data: { liked } }),
  reportCommunityPost: (id: string, reason: string) => request<{ report: CommunityPostReportReceipt }>(
    `/community/posts/${encodeURIComponent(id)}/report`,
    { method: "POST", data: { reason } }
  ),
  communityReportReceipts: (options: { page?: number; pageSize?: number } = {}) => {
    const query = [
      options.page ? `page=${options.page}` : "",
      options.pageSize ? `pageSize=${options.pageSize}` : ""
    ].filter(Boolean).join("&");
    return request<{ items: CommunityReportReceipt[]; pagination: Pagination }>(
      `/community/reports/mine${query ? `?${query}` : ""}`
    );
  },
  reviews: (companionId: string, options: { page?: number; pageSize?: number } = {}) => {
    const query = [
      options.page ? `page=${options.page}` : "",
      options.pageSize ? `pageSize=${options.pageSize}` : ""
    ].filter(Boolean).join("&");
    return request<{ items: Review[]; pagination: Pagination }>(
      `/reviews/companion/${encodeURIComponent(companionId)}${query ? `?${query}` : ""}`,
      { authenticated: false }
    );
  },
  ownOrderReview: (orderId: string) => request<{ review: Review | null }>(`/reviews/orders/${encodeURIComponent(orderId)}/me`),
  createReview: (data: Record<string, unknown>) => request<Review>("/reviews", { method: "POST", data }),
  orders: (options: {
    page?: number;
    pageSize?: number;
    status?: Order["status"];
    view?: "all" | "active" | "history";
  } = {}) => {
    const query = [
      options.page ? `page=${encodeURIComponent(String(options.page))}` : "",
      options.pageSize ? `pageSize=${encodeURIComponent(String(options.pageSize))}` : "",
      options.status ? `status=${encodeURIComponent(options.status)}` : "",
      options.view ? `view=${encodeURIComponent(options.view)}` : ""
    ].filter(Boolean).join("&");
    return request<{ items: Order[]; pagination: Pagination }>(`/orders${query ? `?${query}` : ""}`);
  },
  order: (id: string) => request<Order>(`/orders/${encodeURIComponent(id)}`),
  paymentDisputes: (options: {
    page?: number;
    pageSize?: number;
    status?: "pendingSync" | "open" | "processing" | "resolved" | "syncFailed";
  } = {}) => {
    const query = [
      options.page ? `page=${encodeURIComponent(String(options.page))}` : "",
      options.pageSize ? `pageSize=${encodeURIComponent(String(options.pageSize))}` : "",
      options.status ? `status=${encodeURIComponent(options.status)}` : ""
    ].filter(Boolean).join("&");
    return request<{
      items: PaymentDispute[];
      pagination: { page: number; pageSize: number; total: number; totalPages: number };
    }>(`/payments/disputes/me${query ? `?${query}` : ""}`);
  },
  paymentDispute: (id: string) => request<PaymentDispute>(
    `/payments/disputes/${encodeURIComponent(id)}`
  ),
  paymentDisputeByOrder: (orderId: string) => request<{ item: PaymentDispute | null }>(
    `/payments/disputes/by-order/${encodeURIComponent(orderId)}`
  ),
  serviceOrders: (options: {
    page?: number;
    pageSize?: number;
    status?: Order["status"];
    view?: "all" | "active" | "history";
  } = {}) => {
    const query = [
      options.page ? `page=${encodeURIComponent(String(options.page))}` : "",
      options.pageSize ? `pageSize=${encodeURIComponent(String(options.pageSize))}` : "",
      options.status ? `status=${encodeURIComponent(options.status)}` : "",
      options.view ? `view=${encodeURIComponent(options.view)}` : ""
    ].filter(Boolean).join("&");
    return request<{ items: Order[]; pagination: Pagination }>(`/orders/service${query ? `?${query}` : ""}`);
  },
  companionTodayServiceSchedule: () => request<CompanionTodayServiceSchedule>("/orders/service/today"),
  orderTimeline: (id: string, options: { page?: number; pageSize?: number } = {}) => {
    const query = [
      options.page ? `page=${encodeURIComponent(String(options.page))}` : "",
      options.pageSize ? `pageSize=${encodeURIComponent(String(options.pageSize))}` : ""
    ].filter(Boolean).join("&");
    return request<OrderTimeline>(
      `/orders/${encodeURIComponent(id)}/timeline${query ? `?${query}` : ""}`
    );
  },
  voiceRoomAccess: (id: string) => request<VoiceRoomAccess>(
    `/orders/${encodeURIComponent(id)}/voice-room/access`, { method: "POST" }
  ),
  createOrderRescheduleRequest: (id: string, data: { requestedScheduledAt: string; availabilityWindowId?: string }) =>
    request<OrderRescheduleRequest>(`/orders/${encodeURIComponent(id)}/reschedule-requests`, { method: "POST", data }),
  acceptOrderRescheduleRequest: (orderId: string, requestId: string) => request<{ rescheduleRequest: OrderRescheduleRequest; order: Order }>(
    `/orders/${encodeURIComponent(orderId)}/reschedule-requests/${encodeURIComponent(requestId)}/accept`,
    { method: "POST" }
  ),
  rejectOrderRescheduleRequest: (orderId: string, requestId: string) => request<OrderRescheduleRequest>(
    `/orders/${encodeURIComponent(orderId)}/reschedule-requests/${encodeURIComponent(requestId)}/reject`,
    { method: "POST" }
  ),
  createOrder: (data: CreateOrderRequest) => request<Order>("/orders", { method: "POST", data }),
  cancelOrder: (id: string) => request<Order>(`/orders/${encodeURIComponent(id)}/cancel`, { method: "POST" }),
  confirmOrderCompletion: (id: string) => request<Order>(`/orders/${encodeURIComponent(id)}/completion-confirmations`, { method: "POST" }),
  confirmOrderServiceGuidelines: (id: string) => request<Order>(
    `/orders/${encodeURIComponent(id)}/service-guidelines-confirmations`, { method: "POST" }
  ),
  submitOrderExperienceFeedback: (id: string, data: {
    rating: number;
    tags?: OrderExperienceFeedbackTag[];
    note?: string;
  }) => request<Order>(`/orders/${encodeURIComponent(id)}/experience-feedback`, { method: "POST", data }),
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
  refund: (id: string, reason: string) => request<RefundRequestResult>(
    `/orders/${encodeURIComponent(id)}/refund`, { method: "POST", data: { reason } }
  ),
  conversations: (options: { page?: number; pageSize?: number; blockedByYou?: boolean } = {}) => {
    const query = [
      options.page ? `page=${encodeURIComponent(String(options.page))}` : "",
      options.pageSize ? `pageSize=${encodeURIComponent(String(options.pageSize))}` : "",
      options.blockedByYou === true ? "blockedByYou=true" : ""
    ].filter(Boolean).join("&");
    return request<{ conversations: Conversation[]; pagination: Pagination }>(
      `/conversations${query ? `?${query}` : ""}`
    );
  },
  conversationSummary: () => request<{ activeSupportCount: number }>("/conversations/summary"),
  conversationStatus: (id: string) => request<{
    mediaEnabled: boolean;
    messageNotificationsMuted: boolean;
    conversationBlockedByYou: boolean;
    viewerCanManageFutureBookingBoundary: boolean;
    futureBookingsDeclinedByYou: boolean;
    futureBookingBoundaryScope: "newOrdersAndRecommendationsOnly";
    existingOrdersUnaffected: true;
    conversationUnaffected: true;
    messageHistoryAvailable: boolean;
    messageInteractionAvailable: boolean;
    chatRestriction: { id: string; reason: string; endsAt: string } | null;
  }>(`/conversations/${encodeURIComponent(id)}/status`),
  setConversationMessageNotificationsMuted: (id: string, muted: boolean) => request<{
    messageNotificationsMuted: boolean;
  }>(`/conversations/${encodeURIComponent(id)}/notification-preference`, { method: "PUT", data: { muted } }),
  setConversationBlocked: (id: string, blocked: boolean) => request<{
    conversationBlockedByYou: boolean;
    messageHistoryAvailable: boolean;
    messageInteractionAvailable: boolean;
  }>(`/conversations/${encodeURIComponent(id)}/block`, { method: "PUT", data: { blocked } }),
  setConversationFutureBookingBoundary: (id: string, declined: boolean) => request<{
    viewerCanManageFutureBookingBoundary: true;
    futureBookingsDeclinedByYou: boolean;
    futureBookingBoundaryScope: "newOrdersAndRecommendationsOnly";
    existingOrdersUnaffected: true;
    conversationUnaffected: true;
    changed: boolean;
  }>(`/conversations/${encodeURIComponent(id)}/future-booking-boundary`, {
    method: "PUT",
    data: { declined }
  }),
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
  reserveSupportEvidenceUpload: (ticketId: string, data: {
    kind: "image" | "audio";
    mimeType: string;
    sizeBytes: number;
    sha256: string;
    durationMs?: number;
  }) => request<{ asset: ControlledEvidenceAsset; upload: MediaUploadReservation["upload"] }>(
    `/support/tickets/${encodeURIComponent(ticketId)}/evidence-uploads`,
    { method: "POST", data }
  ),
  reserveAttendanceEvidenceUpload: (disputeId: string, data: {
    kind: "image" | "audio";
    mimeType: string;
    sizeBytes: number;
    sha256: string;
    durationMs?: number;
  }) => request<{ asset: ControlledEvidenceAsset; upload: MediaUploadReservation["upload"] }>(
    `/attendance-disputes/${encodeURIComponent(disputeId)}/evidence-uploads`,
    { method: "POST", data }
  ),
  reserveCompanionIncidentEvidenceUpload: (data: {
    kind: "image" | "audio";
    mimeType: string;
    sizeBytes: number;
    sha256: string;
    durationMs?: number;
  }) => request<{ asset: ControlledEvidenceAsset; upload: MediaUploadReservation["upload"] }>(
    "/commercial/companion/incident-evidence-uploads",
    { method: "POST", data }
  ),
  completeCaseEvidenceUpload: (assetId: string) => request<{ asset: ControlledEvidenceAsset }>(
    `/case-evidence/uploads/${encodeURIComponent(assetId)}/complete`,
    { method: "POST" }
  ),
  caseEvidenceUploadStatus: (assetId: string) => request<{ asset: ControlledEvidenceAsset }>(
    `/case-evidence/uploads/${encodeURIComponent(assetId)}`
  ),
  caseEvidenceReadUrl: (attachmentId: string) => request<{
    attachmentId: string;
    kind: "image" | "audio";
    url: string;
    assetExpiresAt: string;
  }>(`/case-evidence/attachments/${encodeURIComponent(attachmentId)}/read-url`),
  report: (data: Record<string, unknown>) => request<{
    report: { id: string; status: string; source: string };
  }>("/moderation/reports", { method: "POST", data }),
  reporterCases: (options: { page?: number; pageSize?: number } = {}) => {
    const query = [
      options.page ? `page=${options.page}` : "",
      options.pageSize ? `pageSize=${options.pageSize}` : ""
    ].filter(Boolean).join("&");
    return request<{ items: ReporterCaseSummary[]; pagination: Pagination }>(
      `/moderation/reports/me${query ? `?${query}` : ""}`
    );
  },
  reporterCase: (id: string) => request<ReporterCase>(`/moderation/reports/${encodeURIComponent(id)}`),
  addReporterCaseFollowUp: (id: string, statement: string) => request<ReporterCaseFollowUp>(
    `/moderation/reports/${encodeURIComponent(id)}/follow-ups`,
    { method: "POST", data: { statement } }
  ),
  appeal: (caseId: string, reason: string) => request<{ appeal: {
    id: string;
    caseId: string;
    status: string;
    appealDeadlineAt: string;
    reviewDueAt: string;
    policyVersion: string;
    createdAt: string;
  } }>(
    "/moderation/appeals",
    { method: "POST", data: { caseId, reason } }
  ),
  moderationAppeals: (options: {
    page?: number;
    pageSize?: number;
    status?: ModerationAppeal["status"];
    caseId?: string;
    appealId?: string;
  } = {}) => {
    const query = [
      options.page ? `page=${encodeURIComponent(String(options.page))}` : "",
      options.pageSize ? `pageSize=${encodeURIComponent(String(options.pageSize))}` : "",
      options.status ? `status=${encodeURIComponent(options.status)}` : "",
      options.caseId ? `caseId=${encodeURIComponent(options.caseId)}` : "",
      options.appealId ? `appealId=${encodeURIComponent(options.appealId)}` : ""
    ].filter(Boolean).join("&");
    return request<{
      items: ModerationAppeal[];
      pagination: { page: number; pageSize: number; total: number; totalPages: number };
    }>(`/moderation/appeals/me${query ? `?${query}` : ""}`);
  },
  moderationAppealableCases: (options: {
    page?: number;
    pageSize?: number;
    caseId?: string;
    restrictionId?: string;
  } = {}) => {
    const query = [
      options.page ? `page=${encodeURIComponent(String(options.page))}` : "",
      options.pageSize ? `pageSize=${encodeURIComponent(String(options.pageSize))}` : "",
      options.caseId ? `caseId=${encodeURIComponent(options.caseId)}` : "",
      options.restrictionId ? `restrictionId=${encodeURIComponent(options.restrictionId)}` : ""
    ].filter(Boolean).join("&");
    return request<{
      items: ModerationAppealableCase[];
      pagination: { page: number; pageSize: number; total: number; totalPages: number };
    }>(`/moderation/appeals/eligible${query ? `?${query}` : ""}`);
  },
  notifications: (options: { page?: number; pageSize?: number; unreadOnly?: boolean } = {}) => {
    const query = [
      options.page ? `page=${encodeURIComponent(String(options.page))}` : "",
      options.pageSize ? `pageSize=${encodeURIComponent(String(options.pageSize))}` : "",
      options.unreadOnly === undefined ? "" : `unreadOnly=${options.unreadOnly ? "true" : "false"}`
    ].filter(Boolean).join("&");
    return request<{
      items: Notification[];
      pagination: { page: number; pageSize: number; total: number; totalPages: number };
    }>(`/notifications${query ? `?${query}` : ""}`);
  },
  notificationUnreadCount: () => request<{ count: number }>("/notifications/unread-count"),
  subscriptionTemplates: (keys: string[]) => request<{
    enabled: boolean;
    templates: Array<{ key: string; templateId: string }>;
  }>(`/notifications/subscription-templates?keys=${encodeURIComponent(keys.join(","))}`),
  recordSubscriptionGrant: (templateKey: string, granted: boolean) => request<{
    recorded: boolean;
    reason?: "not_granted";
    grantId?: string;
    grantedAt?: string;
  }>("/notifications/subscription-grants", { method: "POST", data: { templateKey, granted } }),
  markNotificationRead: (id: string) => request<Notification>(`/notifications/${encodeURIComponent(id)}/read`, { method: "POST" }),
  markAllNotificationsRead: () => request<{ updated: number }>("/notifications/read-all", { method: "POST" }),
  createSupportTicket: (data: { orderId?: string; category: SupportTicketCategory; subject: string; body: string }) =>
    request<{ id: string; status: string }>("/support/tickets", { method: "POST", data }),
  addOrderSupportFact: (ticketId: string, statement: string, evidenceAssetIds: string[] = []) => request<{
    id: string;
    statement: string;
    evidenceAttachments: MediaAttachment[];
    createdAt: string;
  }>(`/support/tickets/${encodeURIComponent(ticketId)}/order-facts`, {
    method: "POST",
    data: { statement, ...(evidenceAssetIds.length ? { evidenceAssetIds } : {}) }
  }),
  supportTickets: (options: {
    page?: number;
    pageSize?: number;
    status?: SupportTicket["status"];
  } = {}) => {
    const query = [
      options.page ? `page=${encodeURIComponent(String(options.page))}` : "",
      options.pageSize ? `pageSize=${encodeURIComponent(String(options.pageSize))}` : "",
      options.status ? `status=${encodeURIComponent(options.status)}` : ""
    ].filter(Boolean).join("&");
    return request<{
      items: SupportTicket[];
      pagination: { page: number; pageSize: number; total: number; totalPages: number };
    }>(`/support/tickets/me${query ? `?${query}` : ""}`);
  },
  supportTicket: (id: string) => request<SupportTicket>(`/support/tickets/${encodeURIComponent(id)}`),
  supportTicketsByOrder: (orderId: string, options: { page?: number; pageSize?: number } = {}) => {
    const query = [
      options.page ? `page=${encodeURIComponent(String(options.page))}` : "",
      options.pageSize ? `pageSize=${encodeURIComponent(String(options.pageSize))}` : ""
    ].filter(Boolean).join("&");
    return request<{
      items: SupportTicket[];
      pagination: { page: number; pageSize: number; total: number; totalPages: number };
    }>(`/support/orders/${encodeURIComponent(orderId)}/tickets${query ? `?${query}` : ""}`);
  },
  companionEarnings: () => request<{ items: Array<{ id: string; payableCents: number; status: string; availableAt: string }> }>("/commercial/earnings/me")
};
