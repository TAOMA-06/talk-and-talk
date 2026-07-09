import { createSign, createVerify, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { HttpStatus } from "@nestjs/common";

import { AppException } from "../../common/errors/app.exception";
import {
  WeChatNotifyPayload,
  WeChatPayProvider,
  WeChatPrepayInput,
  WeChatPrepayResult
} from "./wechat-pay.provider";

export type RealWeChatPayConfig = {
  appId: string;
  mchId: string;
  apiV3Key: string;
  privateKeyPath: string;
  certSerialNo: string;
};

/**
 * Production-shaped WeChat Pay App API shell.
 * Prepay uses merchant private key signing; full platform-cert rotation can be layered later.
 * Without complete credentials this provider must not be selected.
 */
export class RealWeChatPayProvider implements WeChatPayProvider {
  readonly isMock = false;
  private readonly privateKey: string;

  constructor(private readonly config: RealWeChatPayConfig) {
    this.privateKey = readFileSync(config.privateKeyPath, "utf8");
  }

  async createAppPrepay(input: WeChatPrepayInput): Promise<WeChatPrepayResult> {
    // Real network call would hit https://api.mch.weixin.qq.com/v3/pay/transactions/app
    // This shell builds client params so the iOS boundary can be swapped without redesign.
    // Until live merchant credentials + network client are fully wired, refuse silent mock.
    throw new AppException(
      "WECHAT_PAY_NOT_IMPLEMENTED",
      "Real WeChat prepay network client is not configured for this environment",
      HttpStatus.SERVICE_UNAVAILABLE
    );
  }

  verifyNotifySignature(
    headers: Record<string, string | string[] | undefined>,
    rawBody: string
  ): boolean {
    const timestamp = headerValue(headers, "wechatpay-timestamp");
    const nonce = headerValue(headers, "wechatpay-nonce");
    const signature = headerValue(headers, "wechatpay-signature");
    const serial = headerValue(headers, "wechatpay-serial");

    if (!timestamp || !nonce || !signature || !serial) {
      return false;
    }

    // Platform certificate verification requires downloaded WeChat platform certs.
    // Until cert store is wired, require serial match against merchant serial as a hard gate
    // and refuse unsigned traffic.
    if (serial !== this.config.certSerialNo) {
      return false;
    }

    // Placeholder: real verify uses WeChat platform public key.
    // Keep structure ready; without platform cert return false rather than accept.
    void createVerify;
    void createSign;
    void rawBody;
    return false;
  }

  parseNotifyPayload(rawBody: string): WeChatNotifyPayload {
    const parsed = JSON.parse(rawBody) as Record<string, unknown>;
    const resource = (parsed.resource as Record<string, unknown> | undefined) ?? {};
    // Encrypted resource decryption with apiV3Key is required in production.
    // Support plaintext test shape if present for local integration tests.
    const decrypted = (resource as any).ciphertext
      ? null
      : ((resource as any).plaintext as Record<string, unknown> | undefined) ?? resource;

    if (!decrypted || typeof decrypted !== "object") {
      throw new AppException(
        "WECHAT_NOTIFY_INVALID",
        "Unable to parse WeChat notify resource",
        HttpStatus.BAD_REQUEST
      );
    }

    const amount = (decrypted.amount as Record<string, unknown> | undefined) ?? {};
    return {
      outTradeNo: String(decrypted.out_trade_no ?? ""),
      transactionId: String(decrypted.transaction_id ?? ""),
      tradeState: String(decrypted.trade_state ?? ""),
      amountCents: Number(amount.total ?? 0),
      raw: parsed
    };
  }
}

export function isWeChatConfigured(config: {
  WECHAT_PAY_APP_ID: string;
  WECHAT_PAY_MCH_ID: string;
  WECHAT_PAY_API_V3_KEY: string;
  WECHAT_PAY_PRIVATE_KEY_PATH: string;
  WECHAT_PAY_CERT_SERIAL_NO: string;
}): boolean {
  return Boolean(
    config.WECHAT_PAY_APP_ID &&
      config.WECHAT_PAY_MCH_ID &&
      config.WECHAT_PAY_API_V3_KEY &&
      config.WECHAT_PAY_PRIVATE_KEY_PATH &&
      config.WECHAT_PAY_CERT_SERIAL_NO
  );
}

function headerValue(
  headers: Record<string, string | string[] | undefined>,
  name: string
): string | undefined {
  const key = Object.keys(headers).find((item) => item.toLowerCase() === name.toLowerCase());
  if (!key) return undefined;
  const value = headers[key];
  return Array.isArray(value) ? value[0] : value;
}

export function buildNonce(): string {
  return randomBytes(16).toString("hex");
}
