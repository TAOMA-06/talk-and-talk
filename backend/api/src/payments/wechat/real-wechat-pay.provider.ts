import {
  createDecipheriv,
  createHash,
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
  WeChatAppPrepayResult,
  WeChatMiniProgramPrepayInput,
  WeChatMiniProgramPrepayResult,
  WeChatNativePrepayResult,
  WeChatRefundInput,
  WeChatRefundNotifyPayload,
  WeChatRefundResult,
  WeChatComplaintNotifyPayload,
  WeChatComplaintDetail,
  WeChatComplaintListResult,
  WeChatComplaintNegotiationResult,
  WeChatProviderOperationResult,
  WeChatDailyStatementInput,
  WeChatDailyStatementResult,
  WECHAT_DAILY_STATEMENT_MAX_BYTES
} from "./wechat-pay.provider";

export type RealWeChatPayConfig = {
  appId: string;
  mchId: string;
  apiV3Key: string;
  privateKey?: string;
  privateKeyPath?: string;
  certSerialNo: string;
  miniProgramAppId?: string;
  /** Optional override for tests / private endpoints. */
  apiBaseUrl?: string;
  /** Injectable fetch for unit tests. */
  fetchImpl?: typeof fetch;
  /** Unit-test escape hatch. Production calls must verify WeChat response signatures. */
  verifyResponseSignatures?: boolean;
  /**
   * Allow plaintext notify `resource` shapes used by local fixtures.
   * Staging/production must leave this false so only AES-GCM ciphertext is accepted.
   */
  allowPlaintextNotifyResource?: boolean;
};

type PlatformCertEntry = {
  serialNo: string;
  publicKeyPem: string;
  expireAt: number;
};

const WECHAT_API_BASE = "https://api.mch.weixin.qq.com";
const WECHAT_REQUEST_TIMEOUT_MS = 8_000;
const PLATFORM_CERT_TTL_MS = 12 * 60 * 60 * 1000;
const WECHAT_BILL_DOWNLOAD_ORIGINS = new Set([
  "https://api.mch.weixin.qq.com",
  "https://api2.mch.weixin.qq.com"
]);
const WECHAT_BILL_DOWNLOAD_PATH_PREFIX = "/v3/billdownload/";
const WECHAT_BILL_DOWNLOAD_LEGACY_PATH = "/v3/bill/downloadurl";

type WeChatBillApplication = {
  hash_type?: unknown;
  hash_value?: unknown;
  download_url?: unknown;
};

/**
 * Production WeChat Pay App API (v3):
 * - App prepay with merchant private-key Authorization
 * - Platform certificate download + notify signature verification
 * - AES-256-GCM resource decryption with apiV3Key
 */
export class RealWeChatPayProvider implements WeChatPayProvider {
  readonly mode = "real" as const;
  readonly isMock = false;
  private readonly privateKey: string;
  private readonly apiBaseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly verifyResponseSignatures: boolean;
  private platformCerts: PlatformCertEntry[] = [];
  private platformCertsFetchedAt = 0;

  constructor(private readonly config: RealWeChatPayConfig) {
    const inlinePrivateKey = config.privateKey?.trim().replace(/\\n/g, "\n");
    if (inlinePrivateKey) {
      this.privateKey = inlinePrivateKey;
    } else if (config.privateKeyPath?.trim()) {
      this.privateKey = readFileSync(config.privateKeyPath, "utf8");
    } else {
      throw new Error(
        "WeChat Pay private key is required via WECHAT_PAY_PRIVATE_KEY or WECHAT_PAY_PRIVATE_KEY_PATH"
      );
    }
    this.apiBaseUrl = (config.apiBaseUrl ?? WECHAT_API_BASE).replace(/\/+$/, "");
    this.fetchImpl = config.fetchImpl ?? fetch;
    // An injected fetch is used by the existing unit fixtures, which predate
    // signed response objects. Runtime construction never injects fetch.
    this.verifyResponseSignatures = config.verifyResponseSignatures ?? !config.fetchImpl;
  }

  async createAppPrepay(input: WeChatPrepayInput): Promise<WeChatAppPrepayResult> {
    const body = {
      appid: this.config.appId,
      mchid: this.config.mchId,
      description: input.description.slice(0, 127),
      out_trade_no: input.outTradeNo,
      notify_url: input.notifyUrl,
      ...(input.expiresAt ? { time_expire: input.expiresAt.toISOString() } : {}),
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
      channel: "app",
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

  async createMiniProgramPrepay(input: WeChatMiniProgramPrepayInput): Promise<WeChatMiniProgramPrepayResult> {
    const appId = this.config.miniProgramAppId?.trim();
    if (!appId) {
      throw new AppException(
        "WECHAT_MINIPROGRAM_PAY_NOT_CONFIGURED",
        "WeChat Mini Program payment is not configured",
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
    if (!input.openId.trim()) {
      throw new AppException("WECHAT_OPENID_MISSING", "WeChat OpenID is required for Mini Program payment", HttpStatus.CONFLICT);
    }

    const body = {
      appid: appId,
      mchid: this.config.mchId,
      description: input.description.slice(0, 127),
      out_trade_no: input.outTradeNo,
      notify_url: input.notifyUrl,
      ...(input.expiresAt ? { time_expire: input.expiresAt.toISOString() } : {}),
      amount: { total: input.amountCents, currency: "CNY" },
      payer: { openid: input.openId }
    };
    const response = await this.requestJson<{ prepay_id?: string }>("POST", "/v3/pay/transactions/jsapi", body);
    const prepayId = response.prepay_id?.trim();
    if (!prepayId) {
      throw new AppException("WECHAT_PREPAY_FAILED", "WeChat prepay response missing prepay_id", HttpStatus.BAD_GATEWAY);
    }

    const timeStamp = String(Math.floor(Date.now() / 1000));
    const nonceStr = buildNonce();
    const packageValue = `prepay_id=${prepayId}`;
    // Mini Program pay sign message: appId\n timeStamp\n nonceStr\n package\n
    const paySign = this.signMessage(`${appId}\n${timeStamp}\n${nonceStr}\n${packageValue}\n`);
    return {
      prepayId,
      channel: "miniProgram",
      mock: false,
      clientParams: { timeStamp, nonceStr, package: packageValue, signType: "RSA", paySign }
    };
  }

  async createNativePrepay(input: WeChatPrepayInput): Promise<WeChatNativePrepayResult> {
    const body = {
      appid: this.config.appId,
      mchid: this.config.mchId,
      description: input.description.slice(0, 127),
      out_trade_no: input.outTradeNo,
      notify_url: input.notifyUrl,
      ...(input.expiresAt ? { time_expire: input.expiresAt.toISOString() } : {}),
      amount: {
        total: input.amountCents,
        currency: "CNY"
      }
    };
    const response = await this.requestJson<{ code_url?: string }>(
      "POST",
      "/v3/pay/transactions/native",
      body
    );
    const codeUrl = response.code_url?.trim();
    if (!codeUrl) {
      throw new AppException(
        "WECHAT_PREPAY_FAILED",
        "WeChat native prepay response missing code_url",
        HttpStatus.BAD_GATEWAY
      );
    }
    return {
      prepayId: `native:${input.outTradeNo}`,
      channel: "native",
      mock: false,
      clientParams: { codeUrl }
    };
  }

  async closePayment(outTradeNo: string): Promise<void> {
    const encoded = encodeURIComponent(outTradeNo);
    await this.requestJson(
      "POST",
      `/v3/pay/transactions/out-trade-no/${encoded}/close`,
      { mchid: this.config.mchId },
      ["ORDER_CLOSED", "ORDER_NOT_EXIST"]
    );
  }

  async queryPayment(outTradeNo: string): Promise<WeChatNotifyPayload> {
    const encodedTradeNo = encodeURIComponent(outTradeNo);
    const encodedMchId = encodeURIComponent(this.config.mchId);
    const response = await this.requestJson<Record<string, unknown>>(
      "GET",
      `/v3/pay/transactions/out-trade-no/${encodedTradeNo}?mchid=${encodedMchId}`,
      undefined,
      ["ORDER_NOT_EXIST"]
    );
    const doesNotExist = Object.keys(response).length === 0;
    const amount = (response.amount as Record<string, unknown> | undefined) ?? {};
    return {
      appId: String(response.appid ?? ""),
      mchId: String(response.mchid ?? ""),
      outTradeNo: String(response.out_trade_no ?? outTradeNo),
      transactionId: String(response.transaction_id ?? ""),
      tradeState: doesNotExist ? "NOTEXIST" : String(response.trade_state ?? ""),
      successTime: optionalPayloadString(response.success_time) ?? null,
      amountCents: Number(amount.total ?? 0),
      currency: String(amount.currency ?? ""),
      raw: response
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
    const serial = headerValue(headers, "wechatpay-serial");
    if (!serial) return false;
    await this.ensurePlatformCertificates();
    // A valid new certificate can appear before the normal cache TTL expires.
    // Refresh synchronously once for an unknown serial so the first callback
    // after a WeChat certificate rotation is not rejected unnecessarily.
    if (!this.getPlatformPublicKeySync(serial)) {
      await this.refreshPlatformCertificates();
    }
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
    } else if (this.config.allowPlaintextNotifyResource) {
      // Plaintext test shape for local/development integration fixtures only.
      decrypted =
        ((resource as { plaintext?: Record<string, unknown> }).plaintext as
          | Record<string, unknown>
          | undefined) ?? (resource as Record<string, unknown>);
    } else {
      throw new AppException(
        "WECHAT_NOTIFY_INVALID",
        "WeChat notify resource must include AES-GCM ciphertext",
        HttpStatus.BAD_REQUEST
      );
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
      appId: String(decrypted.appid ?? ""),
      mchId: String(decrypted.mchid ?? ""),
      outTradeNo: String(decrypted.out_trade_no ?? ""),
      transactionId: String(decrypted.transaction_id ?? ""),
      tradeState: String(decrypted.trade_state ?? ""),
      successTime: optionalPayloadString(decrypted.success_time) ?? null,
      amountCents: Number(amount.total ?? 0),
      currency: String(amount.currency ?? ""),
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
    const response = await this.requestJson<any>(
      "GET",
      `/v3/refund/domestic/refunds/${encoded}`,
      undefined,
      ["RESOURCE_NOT_EXISTS"]
    );
    if (Object.keys(response).length === 0) {
      return { outRefundNo, refundId: "", status: "NOTEXIST", acceptedTime: null, successTime: null };
    }
    return this.refundResult(response);
  }

  parseRefundNotifyPayload(rawBody: string): WeChatRefundNotifyPayload {
    const parsed = JSON.parse(rawBody) as Record<string, unknown>;
    const resource = (parsed.resource as Record<string, unknown> | undefined) ?? {};
    let decrypted: Record<string, unknown>;
    if (typeof resource.ciphertext === "string" && resource.ciphertext) {
      decrypted = decryptResource(this.config.apiV3Key, {
        ciphertext: String(resource.ciphertext),
        nonce: String(resource.nonce ?? ""),
        associatedData: String(resource.associated_data ?? "")
      });
    } else if (this.config.allowPlaintextNotifyResource) {
      decrypted = ((resource as any).plaintext ?? resource) as Record<string, unknown>;
    } else {
      throw new AppException(
        "WECHAT_NOTIFY_INVALID",
        "WeChat refund notify resource must include AES-GCM ciphertext",
        HttpStatus.BAD_REQUEST
      );
    }
    const amount = (decrypted.amount as Record<string, unknown> | undefined) ?? {};
    return {
      appId: optionalPayloadString(decrypted.appid),
      mchId: String(decrypted.mchid ?? ""),
      outTradeNo: String(decrypted.out_trade_no ?? ""),
      transactionId: String(decrypted.transaction_id ?? ""),
      outRefundNo: String(decrypted.out_refund_no ?? ""),
      refundId: String(decrypted.refund_id ?? ""),
      status: String(decrypted.refund_status ?? decrypted.status ?? ""),
      acceptedTime: optionalPayloadString(decrypted.create_time) ?? null,
      successTime: optionalPayloadString(decrypted.success_time) ?? null,
      totalAmountCents: Number(amount.total ?? 0),
      refundAmountCents: Number(amount.refund ?? 0),
      currency: optionalPayloadString(amount.currency),
      raw: parsed
    };
  }

  parseComplaintNotifyPayload(rawBody: string): WeChatComplaintNotifyPayload {
    const parsed = JSON.parse(rawBody) as Record<string, unknown>;
    const resource = (parsed.resource as Record<string, unknown> | undefined) ?? {};
    if (resource.algorithm !== "AEAD_AES_256_GCM") {
      throw new AppException("WECHAT_COMPLAINT_NOTIFY_INVALID", "Unsupported complaint resource algorithm", HttpStatus.BAD_REQUEST);
    }
    if (resource.original_type && resource.original_type !== "complaint") {
      throw new AppException("WECHAT_COMPLAINT_NOTIFY_INVALID", "Unexpected complaint resource type", HttpStatus.BAD_REQUEST);
    }
    const decrypted = decryptResource(this.config.apiV3Key, {
      ciphertext: String(resource.ciphertext ?? ""),
      nonce: String(resource.nonce ?? ""),
      associatedData: String(resource.associated_data ?? "")
    });
    const notificationId = String(parsed.id ?? "").trim();
    const createTime = String(parsed.create_time ?? "").trim();
    const eventType = String(parsed.event_type ?? "").trim();
    const complaintId = String(decrypted.complaint_id ?? "").trim();
    const actionType = String(decrypted.action_type ?? "").trim();
    if (!notificationId || !createTime || !complaintId || !actionType
      || !["COMPLAINT.CREATE", "COMPLAINT.STATE_CHANGE"].includes(eventType)) {
      throw new AppException("WECHAT_COMPLAINT_NOTIFY_INVALID", "Complaint notification is missing required fields", HttpStatus.BAD_REQUEST);
    }
    return {
      notificationId,
      createTime,
      eventType,
      summary: optionalPayloadString(parsed.summary),
      complaintId,
      actionType
    };
  }

  async listComplaints(input: {
    beginDate: string;
    endDate: string;
    limit: number;
    offset: number;
  }): Promise<WeChatComplaintListResult> {
    const query = new URLSearchParams({
      begin_date: input.beginDate,
      end_date: input.endDate,
      limit: String(input.limit),
      offset: String(input.offset)
    });
    const response = await this.requestJson<Record<string, unknown>>(
      "GET",
      `/v3/merchant-service/complaints-v2?${query.toString()}`
    );
    return {
      data: Array.isArray(response.data) ? response.data.map((item) => this.complaintDetail(item)) : [],
      limit: Number(response.limit ?? input.limit),
      offset: Number(response.offset ?? input.offset),
      totalCount: Number(response.total_count ?? 0)
    };
  }

  async queryComplaint(complaintId: string): Promise<WeChatComplaintDetail> {
    const response = await this.requestJson<Record<string, unknown>>(
      "GET",
      `/v3/merchant-service/complaints-v2/${encodeURIComponent(complaintId)}`
    );
    return this.complaintDetail(response);
  }

  async listComplaintNegotiationHistory(input: {
    complaintId: string;
    limit: number;
    offset: number;
  }): Promise<WeChatComplaintNegotiationResult> {
    const query = new URLSearchParams({
      limit: String(input.limit),
      offset: String(input.offset)
    });
    const response = await this.requestJson<Record<string, unknown>>(
      "GET",
      `/v3/merchant-service/complaints-v2/${encodeURIComponent(input.complaintId)}/negotiation-historys?${query.toString()}`
    );
    return {
      data: Array.isArray(response.data)
        ? response.data.map((item) => this.complaintNegotiationEvent(item)).filter((item) => item.logId)
        : [],
      limit: Number(response.limit ?? input.limit),
      offset: Number(response.offset ?? input.offset),
      totalCount: Number(response.total_count ?? 0)
    };
  }

  async replyComplaint(input: {
    complaintId: string;
    responseContent: string;
    responseImages?: string[];
  }): Promise<WeChatProviderOperationResult> {
    const response = await this.requestJson<Record<string, unknown>>(
      "POST",
      `/v3/merchant-service/complaints-v2/${encodeURIComponent(input.complaintId)}/response`,
      {
        complainted_mchid: this.config.mchId,
        response_content: input.responseContent,
        ...(input.responseImages?.length ? { response_images: input.responseImages } : {})
      }
    );
    return { providerReference: optionalPayloadString(response.request_id) };
  }

  async completeComplaint(complaintId: string): Promise<WeChatProviderOperationResult> {
    const response = await this.requestJson<Record<string, unknown>>(
      "POST",
      `/v3/merchant-service/complaints-v2/${encodeURIComponent(complaintId)}/complete`,
      { complainted_mchid: this.config.mchId }
    );
    return { providerReference: optionalPayloadString(response.request_id) };
  }

  async downloadDailyStatement(
    input: WeChatDailyStatementInput
  ): Promise<WeChatDailyStatementResult> {
    this.assertBillDate(input.billDate);
    const applicationPath = this.billApplicationPath(input);
    const application = await this.requestBillApplication(applicationPath);
    if (!application) {
      return { status: "noStatement", billDate: input.billDate, kind: input.kind };
    }

    const hashType = typeof application.hash_type === "string"
      ? application.hash_type.trim()
      : "";
    const expectedSha1 = typeof application.hash_value === "string"
      ? application.hash_value.trim().toLowerCase()
      : "";
    const downloadUrlText = typeof application.download_url === "string"
      ? application.download_url.trim()
      : "";
    if (hashType !== "SHA1" || !/^[0-9a-f]{40}$/.test(expectedSha1) || !downloadUrlText) {
      throw new AppException(
        "WECHAT_BILL_APPLICATION_INVALID",
        "WeChat bill application response is incomplete or invalid",
        HttpStatus.BAD_GATEWAY
      );
    }

    const downloadUrl = this.validateBillDownloadUrl(downloadUrlText);
    const requestPath = `${downloadUrl.pathname}${downloadUrl.search}`;
    const authorization = this.buildAuthorization("GET", requestPath, "");
    let response: Response;
    try {
      response = await this.fetchImpl(downloadUrl.toString(), {
        method: "GET",
        headers: {
          Accept: "text/plain, application/octet-stream",
          Authorization: authorization,
          "User-Agent": "TalkAndTalk-API/0.1"
        },
        redirect: "error",
        signal: AbortSignal.timeout(WECHAT_REQUEST_TIMEOUT_MS)
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      throw new AppException(
        name === "AbortError" || name === "TimeoutError"
          ? "WECHAT_BILL_DOWNLOAD_TIMEOUT"
          : "WECHAT_BILL_DOWNLOAD_FAILED",
        name === "AbortError" || name === "TimeoutError"
          ? "WeChat bill download timed out"
          : "WeChat bill download request failed",
        HttpStatus.BAD_GATEWAY
      );
    }

    // Per the official download endpoint, file responses do not carry WeChat
    // response signatures. Integrity comes from the SHA1 in the already-signed
    // application response; do not invent or require download signature headers.
    if (!response.ok) {
      throw new AppException(
        "WECHAT_BILL_DOWNLOAD_FAILED",
        "WeChat bill download request failed",
        HttpStatus.BAD_GATEWAY,
        { status: response.status }
      );
    }
    const bytes = await this.readBillBytes(response);
    const sha1 = createHash("sha1").update(bytes).digest("hex");
    if (sha1 !== expectedSha1) {
      throw new AppException(
        "WECHAT_BILL_HASH_MISMATCH",
        "WeChat bill SHA1 does not match the signed application response",
        HttpStatus.BAD_GATEWAY
      );
    }

    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new AppException(
        "WECHAT_BILL_ENCODING_INVALID",
        "WeChat bill is not valid UTF-8",
        HttpStatus.BAD_GATEWAY
      );
    }
    return {
      status: "downloaded",
      billDate: input.billDate,
      kind: input.kind,
      bytes,
      text,
      sizeBytes: bytes.byteLength,
      sha1,
      sha256: createHash("sha256").update(bytes).digest("hex")
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

  private billApplicationPath(input: WeChatDailyStatementInput): string {
    const query = new URLSearchParams({ bill_date: input.billDate });
    if (input.kind === "tradeAll") {
      query.set("bill_type", "ALL");
      return `/v3/bill/tradebill?${query.toString()}`;
    }
    const accountType = input.kind === "fundBasic"
      ? "BASIC"
      : input.kind === "fundOperation"
        ? "OPERATION"
        : "FEES";
    query.set("account_type", accountType);
    return `/v3/bill/fundflowbill?${query.toString()}`;
  }

  private async requestBillApplication(path: string): Promise<WeChatBillApplication | null> {
    const authorization = this.buildAuthorization("GET", path, "");
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.apiBaseUrl}${path}`, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: authorization,
          "User-Agent": "TalkAndTalk-API/0.1"
        },
        redirect: "error",
        signal: AbortSignal.timeout(WECHAT_REQUEST_TIMEOUT_MS)
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      throw new AppException(
        name === "AbortError" || name === "TimeoutError"
          ? "WECHAT_BILL_APPLICATION_TIMEOUT"
          : "WECHAT_BILL_APPLICATION_FAILED",
        name === "AbortError" || name === "TimeoutError"
          ? "WeChat bill application timed out"
          : "WeChat bill application request failed",
        HttpStatus.BAD_GATEWAY
      );
    }

    const text = await response.text();
    if (this.verifyResponseSignatures) {
      await this.verifyApiResponseSignature(response.headers, text);
    }
    if (!response.ok) {
      const upstreamCode = parseUpstreamCode(text);
      if (upstreamCode === "NO_STATEMENT_EXIST") return null;
      throw new AppException(
        "WECHAT_BILL_APPLICATION_FAILED",
        "WeChat bill application failed",
        HttpStatus.BAD_GATEWAY,
        {
          status: response.status,
          ...(upstreamCode ? { upstreamCode } : {})
        }
      );
    }
    try {
      return JSON.parse(text) as WeChatBillApplication;
    } catch {
      throw new AppException(
        "WECHAT_BILL_APPLICATION_INVALID",
        "WeChat bill application returned invalid JSON",
        HttpStatus.BAD_GATEWAY
      );
    }
  }

  private validateBillDownloadUrl(value: string): URL {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new AppException(
        "WECHAT_BILL_DOWNLOAD_URL_INVALID",
        "WeChat bill download URL is invalid",
        HttpStatus.BAD_GATEWAY
      );
    }
    const configuredOrigin = new URL(this.apiBaseUrl).origin;
    const allowedOrigin = WECHAT_BILL_DOWNLOAD_ORIGINS.has(url.origin)
      || (this.config.apiBaseUrl !== undefined && url.origin === configuredOrigin);
    const allowedPath = url.pathname.startsWith(WECHAT_BILL_DOWNLOAD_PATH_PREFIX)
      || url.pathname === WECHAT_BILL_DOWNLOAD_LEGACY_PATH;
    if (
      url.protocol !== "https:"
      || !allowedOrigin
      || !allowedPath
      || Boolean(url.username)
      || Boolean(url.password)
      || Boolean(url.hash)
    ) {
      throw new AppException(
        "WECHAT_BILL_DOWNLOAD_URL_REJECTED",
        "WeChat bill download URL is outside the approved boundary",
        HttpStatus.BAD_GATEWAY
      );
    }
    return url;
  }

  private async readBillBytes(response: Response): Promise<Uint8Array> {
    const contentLengthText = response.headers.get("content-length")?.trim() ?? "";
    if (/^[0-9]+$/.test(contentLengthText)
      && Number(contentLengthText) > WECHAT_DAILY_STATEMENT_MAX_BYTES) {
      throw new AppException(
        "WECHAT_BILL_TOO_LARGE",
        "WeChat bill exceeds the 20 MB limit",
        HttpStatus.BAD_GATEWAY
      );
    }

    if (!response.body || typeof response.body.getReader !== "function") {
      const bytes = new Uint8Array(await response.arrayBuffer());
      this.assertBillSize(bytes.byteLength);
      return bytes;
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        size += value.byteLength;
        this.assertBillSize(size);
        chunks.push(value);
      }
    } catch (error) {
      if (error instanceof AppException) {
        await reader.cancel().catch(() => undefined);
        throw error;
      }
      throw new AppException(
        "WECHAT_BILL_DOWNLOAD_FAILED",
        "WeChat bill download stream failed",
        HttpStatus.BAD_GATEWAY
      );
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  }

  private assertBillSize(size: number): void {
    if (size > WECHAT_DAILY_STATEMENT_MAX_BYTES) {
      throw new AppException(
        "WECHAT_BILL_TOO_LARGE",
        "WeChat bill exceeds the 20 MB limit",
        HttpStatus.BAD_GATEWAY
      );
    }
  }

  private assertBillDate(value: string): void {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new AppException(
        "WECHAT_BILL_DATE_INVALID",
        "WeChat bill date must use yyyy-MM-dd",
        HttpStatus.BAD_REQUEST
      );
    }
  }

  private async requestJson<T>(
    method: "GET" | "POST",
    path: string,
    body?: Record<string, unknown>,
    acceptedErrorCodes: string[] = []
  ): Promise<T> {
    const url = `${this.apiBaseUrl}${path}`;
    const bodyText = body ? JSON.stringify(body) : "";
    const authorization = this.buildAuthorization(method, path, bodyText);

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: authorization,
          "User-Agent": "TalkAndTalk-API/0.1"
        },
        body: method === "POST" ? bodyText : undefined,
        signal: AbortSignal.timeout(WECHAT_REQUEST_TIMEOUT_MS)
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      throw new AppException(
        name === "AbortError" || name === "TimeoutError" ? "WECHAT_API_TIMEOUT" : "WECHAT_API_ERROR",
        name === "AbortError" || name === "TimeoutError"
          ? `WeChat API ${method} ${path} timed out`
          : `WeChat API ${method} ${path} request failed`,
        HttpStatus.BAD_GATEWAY
      );
    }

    const text = await response.text();
    if (this.verifyResponseSignatures && path !== "/v3/certificates") {
      await this.verifyApiResponseSignature(response.headers, text);
    }
    if (!response.ok) {
      let responseCode = "";
      try {
        responseCode = String((JSON.parse(text) as { code?: unknown }).code ?? "");
      } catch {
        responseCode = "";
      }
      if (acceptedErrorCodes.includes(responseCode)) {
        return {} as T;
      }
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

  private async verifyApiResponseSignature(headers: Headers, body: string): Promise<void> {
    const serial = headers.get("Wechatpay-Serial")?.trim();
    const timestamp = headers.get("Wechatpay-Timestamp")?.trim();
    const nonce = headers.get("Wechatpay-Nonce")?.trim();
    const signature = headers.get("Wechatpay-Signature")?.trim();
    if (!serial || !timestamp || !nonce || !signature) {
      throw new AppException(
        "WECHAT_RESPONSE_SIGNATURE_INVALID",
        "WeChat API response is missing signature headers",
        HttpStatus.BAD_GATEWAY
      );
    }

    let publicKey = this.getPlatformPublicKeySync(serial);
    if (!publicKey) {
      await this.refreshPlatformCertificates();
      publicKey = this.getPlatformPublicKeySync(serial);
    }
    if (!publicKey) {
      throw new AppException(
        "WECHAT_RESPONSE_SIGNATURE_INVALID",
        "WeChat API response certificate is unavailable",
        HttpStatus.BAD_GATEWAY
      );
    }

    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${timestamp}\n${nonce}\n${body}\n`);
    verifier.end();
    if (!verifier.verify(publicKey, signature, "base64")) {
      throw new AppException(
        "WECHAT_RESPONSE_SIGNATURE_INVALID",
        "WeChat API response signature is invalid",
        HttpStatus.BAD_GATEWAY
      );
    }
  }

  private refundResult(value: Record<string, unknown>): WeChatRefundResult {
    return {
      outRefundNo: String(value.out_refund_no ?? ""),
      refundId: String(value.refund_id ?? ""),
      status: String(value.status ?? ""),
      acceptedTime: optionalPayloadString(value.create_time) ?? null,
      successTime: optionalPayloadString(value.success_time) ?? null
    };
  }

  private complaintDetail(value: unknown): WeChatComplaintDetail {
    const item = value && typeof value === "object" ? value as Record<string, unknown> : {};
    const complaintOrders = Array.isArray(item.complaint_order_info)
      ? item.complaint_order_info.map((entry) => {
          const order = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
          return {
            transactionId: String(order.transaction_id ?? ""),
            outTradeNo: String(order.out_trade_no ?? ""),
            amountCents: Number(order.amount ?? 0)
          };
        }).filter((order) => order.outTradeNo)
      : [];
    const complaintMedia = Array.isArray(item.complaint_media_list)
      ? item.complaint_media_list.map((entry) => {
          const media = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
          return {
            mediaType: String(media.media_type ?? "UNKNOWN"),
            mediaUrls: Array.isArray(media.media_url)
              ? media.media_url.filter((url): url is string => typeof url === "string")
              : []
          };
        })
      : [];
    return {
      complaintId: String(item.complaint_id ?? ""),
      complaintTime: String(item.complaint_time ?? ""),
      complaintDetail: String(item.complaint_detail ?? ""),
      complaintState: String(item.complaint_state ?? ""),
      complaintOrders,
      complaintFullRefunded: item.complaint_full_refunded === true,
      incomingUserResponse: item.incoming_user_response === true,
      userComplaintTimes: Math.max(1, Number(item.user_complaint_times ?? 1)),
      complaintMedia,
      problemDescription: optionalPayloadString(item.problem_description),
      problemType: optionalPayloadString(item.problem_type),
      applyRefundAmountCents: Number.isSafeInteger(item.apply_refund_amount)
        ? Number(item.apply_refund_amount)
        : undefined,
      inPlatformService: item.in_platform_service === true,
      needImmediateService: item.need_immediate_service === true
    };
  }

  private complaintNegotiationEvent(value: unknown) {
    const item = value && typeof value === "object" ? value as Record<string, unknown> : {};
    const complaintMedia = item.complaint_media_list && typeof item.complaint_media_list === "object"
      ? item.complaint_media_list as Record<string, unknown>
      : {};
    const imageList = Array.isArray(item.image_list)
      ? item.image_list.filter((url): url is string => typeof url === "string")
      : [];
    const complaintMediaUrls = Array.isArray(complaintMedia.media_url)
      ? complaintMedia.media_url.filter((url): url is string => typeof url === "string")
      : [];
    const normalMessage = item.normal_message && typeof item.normal_message === "object"
      ? item.normal_message as Record<string, unknown>
      : {};
    const normalBlocks = Array.isArray(normalMessage.blocks) ? normalMessage.blocks : [];
    const normalText = normalBlocks
      .map((block) => block && typeof block === "object" ? block as Record<string, unknown> : {})
      .filter((block) => block.type === "TEXT" && block.text && typeof block.text === "object")
      .map((block) => optionalPayloadString((block.text as Record<string, unknown>).text))
      .filter((text): text is string => Boolean(text))
      .join("\n");
    return {
      logId: String(item.log_id ?? "").trim(),
      operator: String(item.operator ?? "").trim().slice(0, 64),
      operateTime: String(item.operate_time ?? "").trim(),
      operateType: String(item.operate_type ?? "").trim().slice(0, 96),
      operateDetails: optionalPayloadString(item.operate_details) ?? optionalPayloadString(normalText),
      mediaUrls: [...new Set([...imageList, ...complaintMediaUrls])]
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
  WECHAT_MINIPROGRAM_APP_ID?: string;
  WECHAT_PAY_MCH_ID: string;
  WECHAT_PAY_API_V3_KEY: string;
  WECHAT_PAY_PRIVATE_KEY?: string;
  WECHAT_PAY_PRIVATE_KEY_PATH?: string;
  WECHAT_PAY_CERT_SERIAL_NO: string;
}): boolean {
  return Boolean(
    (config.WECHAT_PAY_APP_ID || config.WECHAT_MINIPROGRAM_APP_ID) &&
      config.WECHAT_PAY_MCH_ID &&
      config.WECHAT_PAY_API_V3_KEY &&
      (config.WECHAT_PAY_PRIVATE_KEY || config.WECHAT_PAY_PRIVATE_KEY_PATH) &&
      config.WECHAT_PAY_CERT_SERIAL_NO
  );
}

function optionalPayloadString(value: unknown): string | undefined {
  const result = typeof value === "string" ? value.trim() : "";
  return result || undefined;
}

function parseUpstreamCode(body: string): string {
  try {
    const parsed = JSON.parse(body) as { code?: unknown };
    return typeof parsed.code === "string" ? parsed.code.trim().slice(0, 64) : "";
  } catch {
    return "";
  }
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
