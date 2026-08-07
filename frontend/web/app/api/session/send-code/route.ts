import { NextResponse } from "next/server";

import { enforceApiSurface } from "../../../../lib/enforce-web-surface";
import { backendRequest, errorEnvelope, responseJson } from "../../../../lib/server-api";

export async function POST(request: Request) {
  const surfaceRefusal = enforceApiSurface("/api/session");
  if (surfaceRefusal) return surfaceRefusal;

  try {
    const input = await request.json() as { phone?: unknown };
    const phone = typeof input.phone === "string" ? input.phone.trim() : "";
    if (!/^1\d{10}$/.test(phone)) {
      return NextResponse.json(
        errorEnvelope("PHONE_INVALID", "请输入正确的 11 位手机号"),
        { status: 400 },
      );
    }

    const response = await backendRequest("auth/sms/send-code", {
      method: "POST",
      body: JSON.stringify({ phone }),
    });
    return NextResponse.json(await responseJson(response), { status: response.status });
  } catch {
    return NextResponse.json(
      errorEnvelope("AUTH_SERVICE_UNAVAILABLE", "验证码服务暂时不可用，请稍后重试"),
      { status: 502 },
    );
  }
}
