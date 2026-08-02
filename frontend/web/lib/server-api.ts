const DEFAULT_API_BASE_URL = "https://api.talkandtalk.app/api/v1";

export const ACCESS_COOKIE = "tt_access";
export const REFRESH_COOKIE = "tt_refresh";

export type BackendEnvelope<T = unknown> = {
  data?: T;
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
  message?: string;
  [key: string]: unknown;
};

export function apiBaseUrl(): string {
  const runtimeBaseUrl = (
    globalThis as typeof globalThis & { __TALKTALK_API_BASE_URL__?: string }
  ).__TALKTALK_API_BASE_URL__;
  const configured =
    runtimeBaseUrl?.trim() ||
    process.env.TALKTALK_API_BASE_URL?.trim() ||
    DEFAULT_API_BASE_URL;
  return configured.replace(/\/+$/, "");
}

export function backendUrl(path: string, search = ""): URL {
  const normalized = path
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return new URL(`${apiBaseUrl()}/${normalized}${search}`);
}

export async function backendRequest(
  path: string,
  init: RequestInit = {},
  search = "",
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    return await fetch(backendUrl(path, search), {
      ...init,
      signal: controller.signal,
      headers: {
        accept: "application/json",
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...Object.fromEntries(new Headers(init.headers).entries()),
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function responseJson<T = unknown>(response: Response): Promise<BackendEnvelope<T>> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as BackendEnvelope<T>;
  } catch {
    return {};
  }
}

export function parseCookies(header: string | null): Record<string, string> {
  if (!header) return {};
  return Object.fromEntries(
    header.split(";").flatMap((entry) => {
      const index = entry.indexOf("=");
      if (index < 0) return [];
      const key = entry.slice(0, index).trim();
      const value = entry.slice(index + 1).trim();
      return key ? [[key, decodeURIComponent(value)]] : [];
    }),
  );
}

export function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

export function errorEnvelope(
  code: string,
  message: string,
  details?: Record<string, unknown>,
) {
  return {
    error: { code, message, ...(details ? { details } : {}) },
    meta: { requestId: "web-bff", timestamp: new Date().toISOString() },
  };
}
