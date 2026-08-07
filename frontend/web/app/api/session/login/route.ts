import { NextResponse } from "next/server";

import { enforceApiSurface } from "../../../../lib/enforce-web-surface";
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  backendRequest,
  cookieOptions,
  errorEnvelope,
  responseJson,
} from "../../../../lib/server-api";
import {
  LEGAL_CONSENT_VERSION,
  LEGAL_PRIVACY_URL,
  LEGAL_TERMS_URL,
} from "../../../../lib/legal-consent";
import type { AuthUser } from "../../../../lib/types";

type LoginBody = {
  phone?: unknown;
  code?: unknown;
  consent?: Record<string, unknown>;
};

function validConsent(consent?: Record<string, unknown>): boolean {
  const acceptedAt =
    typeof consent?.acceptedAt === "string" ? Date.parse(consent.acceptedAt) : Number.NaN;
  const now = Date.now();
  return Boolean(
    consent &&
      consent.version === LEGAL_CONSENT_VERSION &&
      consent.privacyAccepted === true &&
      consent.termsAccepted === true &&
      consent.adultConfirmed === true &&
      consent.source === "web" &&
      consent.privacyUrl === LEGAL_PRIVACY_URL &&
      consent.termsUrl === LEGAL_TERMS_URL &&
      Number.isFinite(acceptedAt) &&
      acceptedAt <= now + 5 * 60_000 &&
      acceptedAt >= now - 24 * 60 * 60_000,
  );
}

export async function POST(request: Request) {
  const surfaceRefusal = enforceApiSurface("/api/session");
  if (surfaceRefusal) return surfaceRefusal;

  let input: LoginBody;
  try {
    input = await request.json() as LoginBody;
  } catch {
    return NextResponse.json(errorEnvelope("REQUEST_INVALID", "登录信息格式不正确"), { status: 400 });
  }

  const phone = typeof input.phone === "string" ? input.phone.trim() : "";
  const code = typeof input.code === "string" ? input.code.trim() : "";
  if (!/^1\d{10}$/.test(phone) || !/^\d{4,8}$/.test(code)) {
    return NextResponse.json(errorEnvelope("LOGIN_INPUT_INVALID", "请填写正确的手机号和验证码"), {
      status: 400,
    });
  }
  if (!validConsent(input.consent)) {
    return NextResponse.json(
      errorEnvelope("LEGAL_CONSENT_REQUIRED", "请先阅读并同意用户协议、隐私政策，并确认已满 18 周岁"),
      { status: 400 },
    );
  }

  try {
    const loginResponse = await backendRequest("auth/phone/login", {
      method: "POST",
      body: JSON.stringify({ phone, code }),
    });
    const loginEnvelope = await responseJson<{
      accessToken: string;
      refreshToken: string;
      expiresIn: number;
      user: AuthUser;
    }>(loginResponse);
    if (!loginResponse.ok) {
      return NextResponse.json(loginEnvelope, { status: loginResponse.status });
    }

    const session = loginEnvelope?.data;
    if (!session?.accessToken || !session?.refreshToken || !session?.user?.id) {
      return NextResponse.json(errorEnvelope("AUTH_RESPONSE_INVALID", "登录服务返回了无效会话"), {
        status: 502,
      });
    }

    const legalResponse = await backendRequest("users/me/legal-consents", {
      method: "POST",
      headers: { authorization: `Bearer ${session.accessToken}` },
      body: JSON.stringify(input.consent),
    });
    const legalEnvelope = await responseJson<{ receipt?: { id?: string } }>(legalResponse);
    if (!legalResponse.ok || !legalEnvelope?.data?.receipt?.id) {
      await backendRequest("auth/logout", {
        method: "POST",
        headers: { authorization: `Bearer ${session.accessToken}` },
        body: JSON.stringify({ refreshToken: session.refreshToken }),
      }).catch(() => undefined);
      return NextResponse.json(
        legalResponse.ok
          ? errorEnvelope("LEGAL_CONSENT_NOT_RECORDED", "暂时无法记录协议同意，请稍后重试")
          : legalEnvelope,
        { status: legalResponse.ok ? 502 : legalResponse.status },
      );
    }

    const response = NextResponse.json({ data: { user: session.user } });
    response.cookies.set(
      ACCESS_COOKIE,
      session.accessToken,
      cookieOptions(Number(session.expiresIn) || 900),
    );
    response.cookies.set(REFRESH_COOKIE, session.refreshToken, cookieOptions(30 * 24 * 60 * 60));
    return response;
  } catch {
    return NextResponse.json(
      errorEnvelope("AUTH_SERVICE_UNAVAILABLE", "登录服务暂时不可用，请稍后重试"),
      { status: 502 },
    );
  }
}
