import { createHmac, randomBytes } from "node:crypto";

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
  WeChatRefundResult
} from "./wechat-pay.provider";

export const MOCK_WECHAT_NOTIFY_TOKEN = "mock-wechat-notify";

export class MockWeChatPayProvider implements WeChatPayProvider {
  readonly mode = "mock" as const;
  readonly isMock = true;
  private readonly prepays = new Map<
    string,
    { amountCents: number; channel: "app" | "miniProgram" | "native" }
  >();

  async createAppPrepay(input: WeChatPrepayInput): Promise<WeChatAppPrepayResult> {
    this.prepays.set(input.outTradeNo, { amountCents: input.amountCents, channel: "app" });
    const prepayId = `mock_prepay_${input.outTradeNo}`;
    const nonceStr = randomBytes(8).toString("hex");
    const timeStamp = String(Math.floor(Date.now() / 1000));
    const sign = createHmac("sha256", "mock-wechat-key")
      .update(`${input.outTradeNo}.${input.amountCents}.${timeStamp}`)
      .digest("hex");

    return {
      prepayId,
      channel: "app",
      mock: true,
      clientParams: {
        appId: "wx_mock_app_id",
        partnerId: "1900000000",
        prepayId,
        package: "Sign=WXPay",
        nonceStr,
        timeStamp,
        sign
      }
    };
  }

  async createMiniProgramPrepay(input: WeChatMiniProgramPrepayInput): Promise<WeChatMiniProgramPrepayResult> {
    this.prepays.set(input.outTradeNo, { amountCents: input.amountCents, channel: "miniProgram" });
    const prepayId = `mock_prepay_${input.outTradeNo}`;
    const nonceStr = randomBytes(8).toString("hex");
    const timeStamp = String(Math.floor(Date.now() / 1000));
    const packageValue = `prepay_id=${prepayId}`;
    const paySign = createHmac("sha256", "mock-wechat-key")
      .update(`${input.openId}.${input.outTradeNo}.${input.amountCents}.${timeStamp}`)
      .digest("hex");

    return {
      prepayId,
      channel: "miniProgram",
      mock: true,
      clientParams: {
        timeStamp,
        nonceStr,
        package: packageValue,
        signType: "RSA",
        paySign
      }
    };
  }

  async createNativePrepay(input: WeChatPrepayInput): Promise<WeChatNativePrepayResult> {
    this.prepays.set(input.outTradeNo, { amountCents: input.amountCents, channel: "native" });
    const prepayId = `mock_native_${input.outTradeNo}`;
    return {
      prepayId,
      channel: "native",
      mock: true,
      clientParams: {
        codeUrl: `weixin://wxpay/bizpayurl?pr=${encodeURIComponent(prepayId)}`
      }
    };
  }

  async closePayment(_outTradeNo: string): Promise<void> {}

  async queryPayment(outTradeNo: string): Promise<WeChatNotifyPayload> {
    const prepay = this.prepays.get(outTradeNo);
    return {
      appId: prepay?.channel === "miniProgram" ? "wx-mini-app" : "wx_mock_app_id",
      mchId: "1900000000",
      outTradeNo,
      transactionId: `mock_query_txn_${outTradeNo}`,
      tradeState: prepay ? "SUCCESS" : "NOTPAY",
      amountCents: prepay?.amountCents ?? 0,
      currency: "CNY",
      raw: { out_trade_no: outTradeNo, trade_state: prepay ? "SUCCESS" : "NOTPAY" }
    };
  }

  verifyNotifySignature(
    headers: Record<string, string | string[] | undefined>,
    _rawBody: string
  ): boolean {
    const token = headerValue(headers, "x-mock-wechat-token");
    // Official path never hits mock; mock notify endpoint bypasses this with token.
    // For raw notify testing, accept MOCK token or missing signature in non-prod.
    if (token === MOCK_WECHAT_NOTIFY_TOKEN) {
      return true;
    }
    const signature = headerValue(headers, "wechatpay-signature");
    return signature === "MOCK_OK";
  }

  parseNotifyPayload(rawBody: string): WeChatNotifyPayload {
    const parsed = JSON.parse(rawBody) as Record<string, unknown>;
    const resource = (parsed.resource as Record<string, unknown> | undefined) ?? parsed;
    const amount = (resource.amount as Record<string, unknown> | undefined) ?? {};

    const outTradeNo = String(resource.out_trade_no ?? parsed.outTradeNo ?? "");
    const transactionId = String(resource.transaction_id ?? parsed.transactionId ?? `mock_txn_${outTradeNo}`);
    const tradeState = String(resource.trade_state ?? parsed.tradeState ?? "SUCCESS");
    const amountCents = Number(amount.total ?? parsed.amountCents ?? 0);

    return {
      appId: String(resource.appid ?? resource.appId ?? parsed.appId ?? "wx_mock_app_id"),
      mchId: String(resource.mchid ?? resource.mchId ?? parsed.mchId ?? "1900000000"),
      outTradeNo,
      transactionId,
      tradeState,
      amountCents,
      currency: String(amount.currency ?? resource.currency ?? parsed.currency ?? "CNY"),
      raw: parsed
    };
  }

  async createRefund(input: WeChatRefundInput): Promise<WeChatRefundResult> {
    return { outRefundNo: input.outRefundNo, refundId: `mock_refund_${input.outRefundNo}`, status: "SUCCESS" };
  }

  async queryRefund(outRefundNo: string): Promise<WeChatRefundResult> {
    return { outRefundNo, refundId: `mock_refund_${outRefundNo}`, status: "SUCCESS" };
  }

  parseRefundNotifyPayload(rawBody: string): WeChatRefundNotifyPayload {
    const parsed = JSON.parse(rawBody) as Record<string, unknown>;
    const resource = (parsed.resource as Record<string, unknown> | undefined) ?? parsed;
    const plaintext = (resource.plaintext as Record<string, unknown> | undefined) ?? resource;
    const amount = (plaintext.amount as Record<string, unknown> | undefined) ?? {};
    return {
      appId: optionalString(plaintext.appid ?? plaintext.appId ?? parsed.appId),
      mchId: String(plaintext.mchid ?? plaintext.mchId ?? parsed.mchId ?? "1900000000"),
      outTradeNo: String(plaintext.outTradeNo ?? plaintext.out_trade_no ?? ""),
      transactionId: String(plaintext.transactionId ?? plaintext.transaction_id ?? ""),
      outRefundNo: String(plaintext.outRefundNo ?? plaintext.out_refund_no ?? ""),
      refundId: String(plaintext.refundId ?? plaintext.refund_id ?? ""),
      status: String(plaintext.refund_status ?? plaintext.status ?? "SUCCESS"),
      totalAmountCents: Number(amount.total ?? plaintext.totalAmountCents ?? 0),
      refundAmountCents: Number(amount.refund ?? plaintext.refundAmountCents ?? 0),
      currency: optionalString(amount.currency ?? plaintext.currency),
      raw: parsed
    };
  }
}

function optionalString(value: unknown): string | undefined {
  const result = typeof value === "string" ? value.trim() : "";
  return result || undefined;
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
