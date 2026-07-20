import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { WeChatSubscribeTemplate } from "../../config/configuration";
import { PrismaService } from "../../database/prisma.service";

export type SubscribeMessageInput = {
  userId: string;
  templateKey: string;
  templateId: string;
  title: string;
  body: string;
  data?: Record<string, unknown> | null;
};

export type SubscribeMessageResult = {
  outcome: "sent" | "retryable" | "failed" | "skipped";
  attempted: boolean;
  providerMessageId?: string;
  errorCode?: string;
  message?: string;
};

type CachedToken = { value: string; expiresAt: number };
const WECHAT_HTTP_TIMEOUT_MS = 15_000;

/**
 * Thin official-API adapter. It deliberately has no marketing fallback and
 * requires a per-template grant before the worker invokes it.
 */
@Injectable()
export class WeChatSubscribeMessageProvider {
  private cachedToken: CachedToken | null = null;
  private tokenRequest: Promise<string> | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService
  ) {}

  async send(input: SubscribeMessageInput): Promise<SubscribeMessageResult> {
    if (this.config.get<boolean>("WECHAT_SUBSCRIBE_MESSAGES_ENABLED") !== true) {
      return { outcome: "skipped", attempted: false, errorCode: "CHANNEL_DISABLED" };
    }
    const template = this.findTemplate(input.templateKey, input.templateId);
    if (!template) {
      return { outcome: "failed", attempted: false, errorCode: "UNKNOWN_TEMPLATE" };
    }
    const identity = await this.prisma.authIdentity.findFirst({
      where: { userId: input.userId, provider: "wechatMiniProgram" },
      select: { providerId: true },
      orderBy: { id: "asc" }
    } as any);
    if (!identity?.providerId) {
      return { outcome: "skipped", attempted: false, errorCode: "WECHAT_IDENTITY_MISSING" };
    }

    let accessToken: string;
    try {
      accessToken = await this.getAccessToken();
    } catch (error) {
      return {
        outcome: "retryable",
        attempted: false,
        errorCode: "ACCESS_TOKEN_UNAVAILABLE",
        message: this.safeError(error)
      };
    }

    try {
      const response = await fetch(
        `https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=${encodeURIComponent(accessToken)}`,
        {
          method: "POST",
          signal: AbortSignal.timeout(WECHAT_HTTP_TIMEOUT_MS),
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            touser: identity.providerId,
            template_id: template.templateId,
            page: template.page,
            miniprogram_state: this.miniProgramState(),
            lang: "zh_CN",
            data: this.renderTemplateData(template, input)
          })
        }
      );
      const payload: any = await response.json().catch(() => ({}));
      if (response.ok && Number(payload.errcode ?? 0) === 0) {
        return {
          outcome: "sent",
          attempted: true,
          providerMessageId: typeof payload.msgid === "string" || typeof payload.msgid === "number"
            ? String(payload.msgid)
            : undefined
        };
      }
      const errorCode = String(payload.errcode ?? `HTTP_${response.status}`);
      const message = typeof payload.errmsg === "string" ? payload.errmsg.slice(0, 180) : "WeChat rejected the message";
      if (["40001", "40014", "42001"].includes(errorCode)) {
        // These are token rejection/expiry responses: WeChat did not accept
        // the message, so it is safe to refresh the token and retry without
        // consuming the user's one-time authorization.
        this.cachedToken = null;
        return { outcome: "retryable", attempted: false, errorCode, message };
      }
      if (response.status >= 500 || errorCode === "-1") {
        // WeChat may or may not have accepted an HTTP 5xx request. Conservatively
        // mark it failed rather than blindly re-sending a one-time subscription.
        return { outcome: "failed", attempted: true, errorCode, message };
      }
      return { outcome: "failed", attempted: true, errorCode, message };
    } catch (error) {
      // A network failure after POST is an unknown remote state. Never retry it
      // automatically, because duplicate transactional messages are worse than
      // a visible in-app notification plus an operator review.
      return {
        outcome: "failed",
        attempted: true,
        errorCode: "DELIVERY_UNKNOWN",
        message: this.safeError(error)
      };
    }
  }

  private async getAccessToken(): Promise<string> {
    if (this.cachedToken && this.cachedToken.expiresAt > Date.now() + 60_000) {
      return this.cachedToken.value;
    }
    if (this.tokenRequest) return this.tokenRequest;
    this.tokenRequest = this.fetchAccessToken().finally(() => {
      this.tokenRequest = null;
    });
    return this.tokenRequest;
  }

  private async fetchAccessToken(): Promise<string> {
    const appId = this.config.get<string>("WECHAT_MINIPROGRAM_APP_ID", "").trim();
    const secret = this.config.get<string>("WECHAT_MINIPROGRAM_APP_SECRET", "").trim();
    if (!appId || !secret) throw new Error("Mini Program credentials are unavailable");
    const response = await fetch(
      "https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential" +
        `&appid=${encodeURIComponent(appId)}&secret=${encodeURIComponent(secret)}`,
      { signal: AbortSignal.timeout(WECHAT_HTTP_TIMEOUT_MS) }
    );
    const payload: any = await response.json().catch(() => ({}));
    if (!response.ok || typeof payload.access_token !== "string" || !payload.access_token) {
      throw new Error(`WeChat access token request failed (${String(payload.errcode ?? response.status)})`);
    }
    const expiresIn = Number(payload.expires_in);
    this.cachedToken = {
      value: payload.access_token,
      expiresAt: Date.now() + (Number.isFinite(expiresIn) ? Math.max(expiresIn - 120, 60) : 5_400) * 1_000
    };
    return this.cachedToken.value;
  }

  private findTemplate(templateKey: string, templateId: string): WeChatSubscribeTemplate | undefined {
    return (this.config.get<WeChatSubscribeTemplate[]>("WECHAT_SUBSCRIBE_TEMPLATES") ?? [])
      .find((template) => template.key === templateKey && template.templateId === templateId);
  }

  private renderTemplateData(template: WeChatSubscribeTemplate, input: SubscribeMessageInput) {
    const values: Record<string, string> = {
      title: input.title,
      body: input.body,
      ...(Object.fromEntries(Object.entries(input.data ?? {}).map(([key, value]) => [key, String(value ?? "")]))),
      now: new Date().toLocaleString("zh-CN", { hour12: false })
    };
    return Object.fromEntries(Object.entries(template.data).map(([field, source]) => [
      field,
      { value: this.interpolate(source, values).slice(0, 80) }
    ]));
  }

  private interpolate(source: string, values: Record<string, string>) {
    return source.replace(/\{\{([A-Za-z][A-Za-z0-9_]*)\}\}/g, (_match, key: string) => values[key] ?? "");
  }

  private miniProgramState(): "developer" | "trial" | "formal" {
    const appEnv = this.config.get<string>("APP_ENV", "development");
    if (appEnv === "production") return "formal";
    if (appEnv === "staging") return "trial";
    return "developer";
  }

  private safeError(error: unknown): string {
    return error instanceof Error ? error.name : "unknown_error";
  }
}
