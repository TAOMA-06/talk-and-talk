import {
  createDecipheriv,
  createSign,
  createVerify,
  randomBytes,
  X509Certificate
} from "node:crypto";
import { readFileSync } from "node:fs";
import { HttpStatus } from "@nestjs/common";

import { AppException } from "../../common/errors/app.exception";
import {
  WeChatNotifyPayload,
  WeChatPayProvider,
  WeChatPrepayInput,
  WeChatPrepayResult
  , WeChatRefundInput, WeChatRefundNotifyPayload, WeChatRefundResult
} from "./wechat-pay.provider";

export type RealWeChatPayConfig = {
  appId: string;
  mchId: string;
  apiV3Key: string;
  privateKeyPath: string;
  certSerialNo: string;
  /** Optional override for tests / private endpoints. */
  apiBaseUrl?: string;
  /** Injectable fetch for unit tests. */
  fetchImpl?: typeof fetch;
};

type PlatformCertEntry = {
  serialNo: string;
  publicKeyPem: string;
  expireAt: number;
};

const WECHAT_API_BASE = "https://api.mch.weixin.qq.com";
const PLATFORM_CERT_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * Production WeChat Pay App API (v3):
 * - App prepay with merchant private-key Authorization
 * - Platform certificate download + notify signature verification
 * - AES-256-GCM resource decryption with apiV3Key
 */
export class RealWeChatPayProvider implements WeChatPayProvider {
  readonly isMock = false;
  private readonly privateKey: string;
  private readonly apiBaseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private platformCerts: PlatformCertEntry[] = [];
  private platformCertsFetchedAt = 0;

  constructor(private readonly config: RealWeChatPayConfig) {
    this.privateKey = readFileSync(config.privateKeyPath, "utf8");
    this.apiBaseUrl = (config.apiBaseUrl ?? WECHAT_API_BASE).replace(/\/+$/, "");
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async createAppPrepay(input: WeChatPrepayInput): Promise<WeChatPrepayResult> {
    const body = {
      appid: this.config.appId,
      mchid: this.config.mchId,
      description: input.description.slice(0, 127),
      out_trade_no: input.outTradeNo,
      notify_url: input.notifyUrl,
      amount: {
        total: input.amountCents,
        currency: "CNY"
      }
    };

    const path = "/v3/pay/transactions/app";
    const response = await this.requestJson<{ prepay_id?: string }>("POST", path, body);

    const prepayId = response.prepay_id?.trim();
    if (!prepayId) {
      throw new AppException(
        "WECHAT_PREPAY_FAILED",
        "WeChat prepay response missing prepay_id",
        HttpStatus.BAD_GATEWAY
      );
    }

    const timeStamp = String(Math.floor(Date.now() / 1000));
    const nonceStr = buildNonce();
    const packageValue = "Sign=WXPay";
    // App pay sign message: appId\n timeStamp\n nonceStr\n prepayId\n
    const message = `${this.config.appId}\n${timeStamp}\n${nonceStr}\n${prepayId}\n`;
    const sign = this.signMessage(message);

    return {
      prepayId,
      mock: false,
      clientParams: {
        appId: this.config.appId,
        partnerId: this.config.mchId,
        prepayId,
        package: packageValue,
        nonceStr,
        timeStamp,
        sign
      }
    };
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

    // Reject stale timestamps (>5 minutes) to limit replay.
    const ts = Number(timestamp);
    if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) {
      return false;
    }

    try {
      const publicKey = this.getPlatformPublicKeySync(serial);
      if (!publicKey) {
        // Async cert refresh is best-effort; caller may retry after warm-up.
        void this.refreshPlatformCertificates().catch(() => undefined);
        return false;
      }

      const message = `${timestamp}\n${nonce}\n${rawBody}\n`;
      const verifier = createVerify("RSA-SHA256");
      verifier.update(message);
      verifier.end();
      return verifier.verify(publicKey, signature, "base64");
    } catch {
      return false;
    }
  }

  /**
   * Async verify that ensures platform certs are loaded (preferred for notify handler).
   * PaymentsService uses sync verify today; warm certs via ensurePlatformCertificates in prepay path.
   */
  async verifyNotifySignatureAsync(
    headers: Record<string, string | string[] | undefined>,
    rawBody: string
  ): Promise<boolean> {
    await this.ensurePlatformCertificates();
    return this.verifyNotifySignature(headers, rawBody);
  }

  parseNotifyPayload(rawBody: string): WeChatNotifyPayload {
    const parsed = JSON.parse(rawBody) as Record<string, unknown>;
    const resource = (parsed.resource as Record<string, unknown> | undefined) ?? {};

    let decrypted: Record<string, unknown>;

    if (typeof resource.ciphertext === "string" && resource.ciphertext) {
      decrypted = decryptResource(this.config.apiV3Key, {
        ciphertext: String(resource.ciphertext),
        nonce: String(resource.nonce ?? ""),
        associatedData: String(resource.associated_data ?? "")
      });
    } else {
      // Plaintext test shape for local integration fixtures only.
      decrypted =
        ((resource as { plaintext?: Record<string, unknown> }).plaintext as
          | Record<string, unknown>
          | undefined) ?? (resource as Record<string, unknown>);
    }

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

  async createRefund(input: WeChatRefundInput): Promise<WeChatRefundResult> {
    const response = await this.requestJson<any>("POST", "/v3/refund/domestic/refunds", {
      transaction_id: input.transactionId,
      out_refund_no: input.outRefundNo,
      reason: input.reason.slice(0, 80),
      notify_url: input.notifyUrl,
      amount: { refund: input.refundAmountCents, total: input.totalAmountCents, currency: "CNY" }
    });
    return this.refundResult(response);
  }

  async queryRefund(outRefundNo: string): Promise<WeChatRefundResult> {
    const encoded = encodeURIComponent(outRefundNo);
    const response = await this.requestJson<any>("GET", `/v3/refund/domestic/refunds/${encoded}`);
    return this.refundResult(response);
  }

  parseRefundNotifyPayload(rawBody: string): WeChatRefundNotifyPayload {
    const parsed = JSON.parse(rawBody) as Record<string, unknown>;
    const resource = (parsed.resource as Record<string, unknown> | undefined) ?? {};
    const decrypted = typeof resource.ciphertext === "string" && resource.ciphertext
      ? decryptResource(this.config.apiV3Key, {
          ciphertext: String(resource.ciphertext), nonce: String(resource.nonce ?? ""),
          associatedData: String(resource.associated_data ?? "")
        })
      : ((resource as any).plaintext ?? resource);
    const amount = (decrypted.amount as Record<string, unknown> | undefined) ?? {};
    return {
      ...this.refundResult(decrypted),
      refundAmountCents: Number(amount.refund ?? 0),
      raw: parsed
    };
  }

  /** Warm platform cert cache (call on boot or before first notify). */
  async ensurePlatformCertificates(): Promise<void> {
    const stale =
      this.platformCerts.length === 0 ||
      Date.now() - this.platformCertsFetchedAt > PLATFORM_CERT_TTL_MS;
    if (stale) {
      await this.refreshPlatformCertificates();
    }
  }

  private getPlatformPublicKeySync(serial: string): string | undefined {
    const entry = this.platformCerts.find((c) => c.serialNo === serial);
    if (!entry) return undefined;
    if (entry.expireAt > 0 && Date.now() > entry.expireAt) return undefined;
    return entry.publicKeyPem;
  }

  private async refreshPlatformCertificates(): Promise<void> {
    const path = "/v3/certificates";
    const data = await this.requestJson<{
      data?: Array<{
        serial_no?: string;
        effective_time?: string;
        expire_time?: string;
        encrypt_certificate?: {
          algorithm?: string;
          nonce?: string;
          associated_data?: string;
          ciphertext?: string;
        };
      }>;
    }>("GET", path);

    const next: PlatformCertEntry[] = [];
    for (const item of data.data ?? []) {
      const serial = item.serial_no?.trim();
      const enc = item.encrypt_certificate;
      if (!serial || !enc?.ciphertext || !enc.nonce) continue;

      const certPem = decryptToString(this.config.apiV3Key, {
        ciphertext: enc.ciphertext,
        nonce: enc.nonce,
        associatedData: enc.associated_data ?? "certificate"
      });

      const x509 = new X509Certificate(certPem);
      next.push({
        serialNo: serial,
        publicKeyPem: x509.publicKey.export({ type: "spki", format: "pem" }).toString(),
        expireAt: item.expire_time ? Date.parse(item.expire_time) : 0
      });
    }

    if (next.length === 0) {
      throw new AppException(
        "WECHAT_CERT_UNAVAILABLE",
        "Unable to load WeChat platform certificates",
        HttpStatus.BAD_GATEWAY
      );
    }

    this.platformCerts = next;
    this.platformCertsFetchedAt = Date.now();
  }

  private async requestJson<T>(
    method: "GET" | "POST",
    path: string,
    body?: Record<string, unknown>
  ): Promise<T> {
    const url = `${this.apiBaseUrl}${path}`;
    const bodyText = body ? JSON.stringify(body) : "";
    const authorization = this.buildAuthorization(method, path, bodyText);

    const response = await this.fetchImpl(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: authorization,
        "User-Agent": "TalkAndTalk-API/0.1"
      },
      body: method === "POST" ? bodyText : undefined
    });

    const text = await response.text();
    if (!response.ok) {
      throw new AppException(
        "WECHAT_API_ERROR",
        `WeChat API ${method} ${path} failed: ${response.status}`,
        HttpStatus.BAD_GATEWAY,
        { status: response.status, body: text.slice(0, 500) }
      );
    }

    if (!text) {
      return {} as T;
    }

    try {
      return JSON.parse(text) as T;
    } catch {
      throw new AppException(
        "WECHAT_API_ERROR",
        "WeChat API returned invalid JSON",
        HttpStatus.BAD_GATEWAY
      );
    }
  }

  private refundResult(value: Record<string, unknown>): WeChatRefundResult {
    return {
      outRefundNo: String(value.out_refund_no ?? ""),
      refundId: String(value.refund_id ?? ""),
      status: String(value.status ?? "")
    };
  }

  private buildAuthorization(method: string, path: string, body: string): string {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonceStr = buildNonce();
    // GET uses empty body; path includes query if any
    const message = `${method}\n${path}\n${timestamp}\n${nonceStr}\n${body}\n`;
    const signature = this.signMessage(message);
    return (
      `WECHATPAY2-SHA256-RSA2048 mchid="${this.config.mchId}",` +
      `nonce_str="${nonceStr}",` +
      `signature="${signature}",` +
      `timestamp="${timestamp}",` +
      `serial_no="${this.config.certSerialNo}"`
    );
  }

  private signMessage(message: string): string {
    const signer = createSign("RSA-SHA256");
    signer.update(message);
    signer.end();
    return signer.sign(this.privateKey, "base64");
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

export function buildNonce(): string {
  return randomBytes(16).toString("hex");
}

/** AES-256-GCM decrypt WeChat v3 resource (apiV3Key is 32-byte UTF-8 string). */
export function decryptResource(
  apiV3Key: string,
  input: { ciphertext: string; nonce: string; associatedData: string }
): Record<string, unknown> {
  const plaintext = decryptToString(apiV3Key, input);
  return JSON.parse(plaintext) as Record<string, unknown>;
}

export function decryptToString(
  apiV3Key: string,
  input: { ciphertext: string; nonce: string; associatedData: string }
): string {
  if (!apiV3Key || apiV3Key.length !== 32) {
    throw new AppException(
      "WECHAT_NOTIFY_INVALID",
      "WECHAT_PAY_API_V3_KEY must be 32 characters",
      HttpStatus.INTERNAL_SERVER_ERROR
    );
  }
  if (!input.ciphertext || !input.nonce) {
    throw new AppException(
      "WECHAT_NOTIFY_INVALID",
      "Missing ciphertext or nonce for WeChat resource",
      HttpStatus.BAD_REQUEST
    );
  }

  const key = Buffer.from(apiV3Key, "utf8");
  const nonce = Buffer.from(input.nonce, "utf8");
  const associatedData = Buffer.from(input.associatedData ?? "", "utf8");
  const data = Buffer.from(input.ciphertext, "base64");

  // Last 16 bytes are auth tag
  if (data.length <= 16) {
    throw new AppException(
      "WECHAT_NOTIFY_INVALID",
      "WeChat resource ciphertext too short",
      HttpStatus.BAD_REQUEST
    );
  }
  const authTag = data.subarray(data.length - 16);
  const encrypted = data.subarray(0, data.length - 16);

  try {
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAuthTag(authTag);
    if (associatedData.length > 0) {
      decipher.setAAD(associatedData);
    }
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString("utf8");
  } catch {
    throw new AppException(
      "WECHAT_NOTIFY_INVALID",
      "Failed to decrypt WeChat notify resource",
      HttpStatus.BAD_REQUEST
    );
  }
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
