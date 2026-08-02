"use client";

import type { AuthUser, ConsentReceipt } from "./types";
import {
  LEGAL_CONSENT_VERSION,
  LEGAL_PRIVACY_URL,
  LEGAL_TERMS_URL,
} from "./legal-consent";

export const CONSENT_VERSION = LEGAL_CONSENT_VERSION;
export const CONSENT_STORAGE_KEY = `talkandtalk.web.consent.${CONSENT_VERSION}`;
export const PRIVACY_URL = LEGAL_PRIVACY_URL;
export const TERMS_URL = LEGAL_TERMS_URL;

export class ApiClientError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
  }
}

type ApiResponseBody = {
  data?: unknown;
  message?: string;
  error?: {
    code?: string;
    message?: string;
  };
};

async function parseBody(response: Response): Promise<ApiResponseBody> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as ApiResponseBody;
  } catch {
    return {};
  }
}

export async function requestApi<T>(
  path: string,
  options: RequestInit & { data?: unknown } = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.data !== undefined) headers.set("content-type", "application/json");
  const response = await fetch(`/api/backend${path.startsWith("/") ? path : `/${path}`}`, {
    ...options,
    credentials: "include",
    headers,
    body: options.data === undefined ? options.body : JSON.stringify(options.data),
  });
  const body = await parseBody(response);
  if (!response.ok) {
    throw new ApiClientError(
      body?.error?.message || body?.message || "服务暂时不可用，请稍后重试",
      response.status,
      body?.error?.code,
    );
  }
  return (body?.data ?? body) as T;
}

export async function getSession(): Promise<AuthUser | null> {
  const response = await fetch("/api/session", { credentials: "include", cache: "no-store" });
  if (response.status === 401) return null;
  const body = await parseBody(response);
  if (!response.ok) return null;
  const data = body.data as { user?: AuthUser } | undefined;
  return data?.user ?? null;
}

export async function sendSmsCode(phone: string): Promise<{ expiresInSeconds?: number }> {
  const response = await fetch("/api/session/send-code", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phone }),
  });
  const body = await parseBody(response);
  if (!response.ok) {
    throw new ApiClientError(
      body?.error?.message || "验证码发送失败，请稍后重试",
      response.status,
      body?.error?.code,
    );
  }
  return (body?.data ?? body) as { expiresInSeconds?: number };
}

export async function loginWithPhone(phone: string, code: string): Promise<AuthUser> {
  const consent = readConsent();
  if (!consent) throw new ApiClientError("请先阅读并同意协议", 400, "LEGAL_CONSENT_REQUIRED");
  const response = await fetch("/api/session/login", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phone, code, consent }),
  });
  const body = await parseBody(response);
  if (!response.ok) {
    throw new ApiClientError(
      body?.error?.message || "登录失败，请检查验证码",
      response.status,
      body?.error?.code,
    );
  }
  const data = body.data as { user?: AuthUser } | undefined;
  if (!data?.user) {
    throw new ApiClientError("登录响应不完整，请稍后重试", 502, "INVALID_LOGIN_RESPONSE");
  }
  return data.user;
}

export async function logout(): Promise<void> {
  await fetch("/api/session/logout", {
    method: "POST",
    credentials: "include",
  });
}

export function readConsent(): ConsentReceipt | null {
  if (typeof window === "undefined") return null;
  try {
    const value = JSON.parse(window.localStorage.getItem(CONSENT_STORAGE_KEY) || "null");
    if (
      value?.version === CONSENT_VERSION &&
      value?.privacyAccepted === true &&
      value?.termsAccepted === true &&
      value?.adultConfirmed === true
    ) {
      return value as ConsentReceipt;
    }
  } catch {
    return null;
  }
  return null;
}

export function saveConsent(): ConsentReceipt {
  const receipt: ConsentReceipt = {
    version: CONSENT_VERSION,
    acceptedAt: new Date().toISOString(),
    privacyAccepted: true,
    termsAccepted: true,
    adultConfirmed: true,
    privacyUrl: PRIVACY_URL,
    termsUrl: TERMS_URL,
    source: "web",
  };
  window.localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(receipt));
  return receipt;
}

export function clearConsent(): void {
  if (typeof window !== "undefined") window.localStorage.removeItem(CONSENT_STORAGE_KEY);
}
