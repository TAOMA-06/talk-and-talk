import { createHmac, randomBytes } from "node:crypto";

import {
  WeChatNotifyPayload,
  WeChatPayProvider,
  WeChatPrepayInput,
  WeChatAppPrepayResult,
  WeChatMiniProgramPrepayInput,
  WeChatMiniProgramPrepayResult
  , WeChatRefundInput, WeChatRefundNotifyPayload, WeChatRefundResult
} from "./wechat-pay.provider";

export const MOCK_WECHAT_NOTIFY_TOKEN = "mock-wechat-notify";

export class MockWeChatPayProvider implements WeChatPayProvider {
  readonly mode = "mock" as const;
  readonly isMock = true;

  async createAppPrepay(input: WeChatPrepayInput): Promise<WeChatAppPrepayResult> {
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
      outTradeNo,
      transactionId,
      tradeState,
      amountCents,
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
    return {
      outRefundNo: String(parsed.outRefundNo ?? parsed.out_refund_no ?? ""),
      refundId: String(parsed.refundId ?? parsed.refund_id ?? ""),
      status: String(parsed.status ?? "SUCCESS"),
      refundAmountCents: Number(parsed.refundAmountCents ?? 0),
      raw: parsed
    };
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
