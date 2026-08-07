import { NextResponse } from "next/server";

import { enforceApiSurface } from "../../../lib/enforce-web-surface";
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  backendRequest,
  cookieOptions,
  errorEnvelope,
  parseCookies,
  responseJson,
} from "../../../lib/server-api";
import type { AuthUser } from "../../../lib/types";

export async function GET(request: Request) {
  const surfaceRefusal = enforceApiSurface("/api/session");
  if (surfaceRefusal) return surfaceRefusal;

  const cookies = parseCookies(request.headers.get("cookie"));
  let accessToken = cookies[ACCESS_COOKIE];
  let refreshToken = cookies[REFRESH_COOKIE];

  if (!accessToken && !refreshToken) {
    return NextResponse.json(errorEnvelope("UNAUTHORIZED", "尚未登录"), { status: 401 });
  }

  try {
    let meResponse = accessToken
      ? await backendRequest("me", { headers: { authorization: `Bearer ${accessToken}` } })
      : new Response(null, { status: 401 });
    let rotated: { accessToken: string; refreshToken: string; expiresIn: number } | null = null;

    if (meResponse.status === 401 && refreshToken) {
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
        meResponse = await backendRequest("me", {
          headers: { authorization: `Bearer ${accessToken}` },
        });
      }
    }

    const meEnvelope = await responseJson<AuthUser>(meResponse);
    if (!meResponse.ok) {
      const response = NextResponse.json(
        meEnvelope?.error ? meEnvelope : errorEnvelope("UNAUTHORIZED", "登录状态已失效"),
        { status: meResponse.status },
      );
      response.cookies.set(ACCESS_COOKIE, "", cookieOptions(0));
      response.cookies.set(REFRESH_COOKIE, "", cookieOptions(0));
      return response;
    }

    const response = NextResponse.json({ data: { user: meEnvelope.data } });
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
    }
    return response;
  } catch {
    return NextResponse.json(
      errorEnvelope("SESSION_SERVICE_UNAVAILABLE", "暂时无法确认登录状态"),
      { status: 502 },
    );
  }
}
