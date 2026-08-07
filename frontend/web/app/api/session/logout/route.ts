import { NextResponse } from "next/server";

import { enforceApiSurface } from "../../../../lib/enforce-web-surface";
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  backendRequest,
  cookieOptions,
  parseCookies,
} from "../../../../lib/server-api";

export async function POST(request: Request) {
  const surfaceRefusal = enforceApiSurface("/api/session");
  if (surfaceRefusal) return surfaceRefusal;

  const cookies = parseCookies(request.headers.get("cookie"));
  const accessToken = cookies[ACCESS_COOKIE];
  const refreshToken = cookies[REFRESH_COOKIE];

  if (accessToken && refreshToken) {
    await backendRequest("auth/logout", {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ refreshToken }),
    }).catch(() => undefined);
  }

  const response = NextResponse.json({ data: { success: true } });
  response.cookies.set(ACCESS_COOKIE, "", cookieOptions(0));
  response.cookies.set(REFRESH_COOKIE, "", cookieOptions(0));
  return response;
}
