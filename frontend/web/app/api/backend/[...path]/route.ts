import { NextResponse } from "next/server";

import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  backendRequest,
  cookieOptions,
  errorEnvelope,
  parseCookies,
  responseJson,
} from "../../../../lib/server-api";

type RouteContext = { params: Promise<{ path: string[] }> };

const BLOCKED_PREFIXES = [
  "admin",
  "auth",
  "metrics",
  "review",
  "payments/wechat",
];

function isBlocked(path: string): boolean {
  const normalized = path.toLowerCase();
  return BLOCKED_PREFIXES.some(
    (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`),
  );
}

function normalizedPath(pathSegments: string[]): string | null {
  try {
    const segments = pathSegments.map((segment) => decodeURIComponent(segment));
    if (
      !segments.length ||
      segments.some(
        (segment) =>
          !segment ||
          segment === "." ||
          segment === ".." ||
          segment.includes("/") ||
          segment.includes("\\"),
      )
    ) {
      return null;
    }
    return segments.join("/");
  } catch {
    return null;
  }
}

function isCrossSiteMutation(request: Request): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase())) return false;
  if (request.headers.get("sec-fetch-site") === "cross-site") return true;
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin !== new URL(request.url).origin;
  } catch {
    return true;
  }
}

async function proxy(request: Request, context: RouteContext) {
  const { path: pathSegments } = await context.params;
  const path = normalizedPath(pathSegments);
  if (!path || isBlocked(path)) {
    return NextResponse.json(errorEnvelope("ROUTE_NOT_ALLOWED", "该接口不对网站客户端开放"), {
      status: 403,
    });
  }
  if (isCrossSiteMutation(request)) {
    return NextResponse.json(errorEnvelope("CROSS_SITE_REQUEST_BLOCKED", "拒绝跨站写入请求"), {
      status: 403,
    });
  }

  const requestUrl = new URL(request.url);
  const cookies = parseCookies(request.headers.get("cookie"));
  let accessToken = cookies[ACCESS_COOKIE];
  let refreshToken = cookies[REFRESH_COOKIE];
  const method = request.method.toUpperCase();
  const bodyBuffer =
    method === "GET" || method === "HEAD" ? undefined : await request.arrayBuffer();
  const body = bodyBuffer && bodyBuffer.byteLength ? bodyBuffer : undefined;

  const call = (token?: string) =>
    backendRequest(
      path,
      {
        method,
        body,
        headers: {
          ...(request.headers.get("content-type")
            ? { "content-type": request.headers.get("content-type")! }
            : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
      },
      requestUrl.search,
    );

  try {
    let backendResponse = await call(accessToken);
    let rotated: { accessToken: string; refreshToken: string; expiresIn: number } | null = null;

    if (backendResponse.status === 401 && refreshToken) {
      const refreshResponse = await backendRequest("auth/refresh", {
        method: "POST",
        body: JSON.stringify({ refreshToken }),
      });
      const refreshEnvelope = await responseJson<{
        accessToken: string;
        refreshToken: string;
        expiresIn: number;
      }>(refreshResponse);
      if (refreshResponse.ok && refreshEnvelope?.data?.accessToken && refreshEnvelope?.data?.refreshToken) {
        rotated = {
          accessToken: refreshEnvelope.data.accessToken,
          refreshToken: refreshEnvelope.data.refreshToken,
          expiresIn: Number(refreshEnvelope.data.expiresIn) || 900,
        };
        accessToken = rotated.accessToken;
        refreshToken = rotated.refreshToken;
        backendResponse = await call(accessToken);
      }
    }

    const responseBody = await backendResponse.arrayBuffer();
    const response = new NextResponse(responseBody, {
      status: backendResponse.status,
      headers: {
        "content-type": backendResponse.headers.get("content-type") || "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    });
    if (rotated) {
      response.cookies.set(
        ACCESS_COOKIE,
        rotated.accessToken,
        cookieOptions(Number(rotated.expiresIn) || 900),
      );
      response.cookies.set(
        REFRESH_COOKIE,
        rotated.refreshToken,
        cookieOptions(30 * 24 * 60 * 60),
      );
    } else if (backendResponse.status === 401 && (accessToken || refreshToken)) {
      response.cookies.set(ACCESS_COOKIE, "", cookieOptions(0));
      response.cookies.set(REFRESH_COOKIE, "", cookieOptions(0));
    }
    return response;
  } catch {
    return NextResponse.json(
      errorEnvelope("BACKEND_UNAVAILABLE", "服务连接暂时不可用，请稍后重试"),
      { status: 502 },
    );
  }
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
