import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

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
  WeChatComplaintNegotiationEvent,
  WeChatComplaintNegotiationResult,
  WeChatProviderOperationResult,
  WeChatDailyStatementInput,
  WeChatDailyStatementKind,
  WeChatDailyStatementResult
} from "./wechat-pay.provider";

/** Deterministic secret for unit/e2e fixtures. Never use outside development|test. */
export const TEST_MOCK_WECHAT_NOTIFY_SECRET = "test-only-mock-wechat-notify-secret-32b";

export type MockWeChatDailyStatementFixture = {
  billDate: string;
  kind: WeChatDailyStatementKind;
  text: string;
};

export class MockWeChatPayProvider implements WeChatPayProvider {
  readonly mode = "mock" as const;
  readonly isMock = true;
  private readonly notifySecret: string;
  private readonly prepays = new Map<
    string,
    { amountCents: number; channel: "app" | "miniProgram" | "native" }
  >();
  private readonly complaints = new Map<string, WeChatComplaintDetail>();
  private readonly complaintHistories = new Map<string, WeChatComplaintNegotiationEvent[]>();
  private readonly dailyStatements = new Map<string, string>();

  constructor(
    notifySecret: string = TEST_MOCK_WECHAT_NOTIFY_SECRET,
    fixtures: readonly MockWeChatDailyStatementFixture[] = []
  ) {
    const secret = notifySecret.trim();
    if (secret.length < 32) {
      throw new Error("Mock WeChat notify secret must be at least 32 characters");
    }
    this.notifySecret = secret;
    for (const fixture of fixtures) {
      this.dailyStatements.set(`${fixture.billDate}:${fixture.kind}`, fixture.text);
    }
  }

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
      successTime: prepay ? new Date().toISOString() : null,
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
    if (!token) {
      return false;
    }
    return constantTimeEqual(token, this.notifySecret);
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
      successTime: optionalString(resource.success_time ?? resource.successTime ?? parsed.successTime)
        ?? (tradeState === "SUCCESS" ? new Date().toISOString() : null),
      amountCents,
      currency: String(amount.currency ?? resource.currency ?? parsed.currency ?? "CNY"),
      raw: parsed
    };
  }

  async createRefund(input: WeChatRefundInput): Promise<WeChatRefundResult> {
    const now = new Date().toISOString();
    return {
      outRefundNo: input.outRefundNo,
      refundId: `mock_refund_${input.outRefundNo}`,
      status: "SUCCESS",
      acceptedTime: now,
      successTime: now
    };
  }

  async queryRefund(outRefundNo: string): Promise<WeChatRefundResult> {
    const now = new Date().toISOString();
    return {
      outRefundNo,
      refundId: `mock_refund_${outRefundNo}`,
      status: "SUCCESS",
      acceptedTime: now,
      successTime: now
    };
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
      acceptedTime: optionalString(plaintext.create_time ?? plaintext.createTime)
        ?? new Date().toISOString(),
      successTime: optionalString(plaintext.success_time ?? plaintext.successTime)
        ?? (String(plaintext.refund_status ?? plaintext.status ?? "SUCCESS") === "SUCCESS"
          ? new Date().toISOString()
          : null),
      totalAmountCents: Number(amount.total ?? plaintext.totalAmountCents ?? 0),
      refundAmountCents: Number(amount.refund ?? plaintext.refundAmountCents ?? 0),
      currency: optionalString(amount.currency ?? plaintext.currency),
      raw: parsed
    };
  }

  parseComplaintNotifyPayload(rawBody: string): WeChatComplaintNotifyPayload {
    const parsed = JSON.parse(rawBody) as Record<string, any>;
    const plaintext = parsed.resource?.plaintext ?? parsed.resource ?? parsed;
    const complaintId = String(plaintext.complaint_id ?? parsed.complaintId ?? "");
    const complaintTime = String(plaintext.complaint_time ?? parsed.create_time ?? new Date().toISOString());
    const outTradeNo = String(plaintext.out_trade_no ?? "");
    const current = this.complaints.get(complaintId);
    this.complaints.set(complaintId, {
      complaintId,
      complaintTime,
      complaintDetail: String(plaintext.complaint_detail ?? current?.complaintDetail ?? "Mock complaint"),
      complaintState: String(plaintext.complaint_state ?? current?.complaintState ?? "PENDING"),
      complaintOrders: outTradeNo
        ? [{ transactionId: String(plaintext.transaction_id ?? ""), outTradeNo, amountCents: Number(plaintext.amount ?? 0) }]
        : current?.complaintOrders ?? [],
      complaintFullRefunded: plaintext.complaint_full_refunded === true,
      incomingUserResponse: plaintext.incoming_user_response !== false,
      userComplaintTimes: Number(plaintext.user_complaint_times ?? 1),
      complaintMedia: current?.complaintMedia ?? [],
      problemType: optionalString(plaintext.problem_type),
      applyRefundAmountCents: typeof plaintext.apply_refund_amount === "number" ? plaintext.apply_refund_amount : undefined,
      inPlatformService: plaintext.in_platform_service === true,
      needImmediateService: plaintext.need_immediate_service === true
    });
    if (!this.complaintHistories.has(complaintId)) {
      this.complaintHistories.set(complaintId, [{
        logId: `mock_log_create_${complaintId}`,
        operator: "投诉人",
        operateTime: complaintTime,
        operateType: "USER_CREATE_COMPLAINT",
        operateDetails: String(plaintext.complaint_detail ?? "Mock complaint"),
        mediaUrls: []
      }]);
    }
    return {
      notificationId: String(parsed.id ?? `mock_notice_${complaintId}`),
      createTime: String(parsed.create_time ?? new Date().toISOString()),
      eventType: String(parsed.event_type ?? "COMPLAINT.CREATE"),
      summary: optionalString(parsed.summary),
      complaintId,
      actionType: String(plaintext.action_type ?? "CREATE_COMPLAINT")
    };
  }

  async listComplaints(input: { beginDate: string; endDate: string; limit: number; offset: number }): Promise<WeChatComplaintListResult> {
    const all = [...this.complaints.values()];
    return {
      data: all.slice(input.offset, input.offset + input.limit),
      limit: input.limit,
      offset: input.offset,
      totalCount: all.length
    };
  }

  async queryComplaint(complaintId: string): Promise<WeChatComplaintDetail> {
    return this.complaints.get(complaintId) ?? {
      complaintId,
      complaintTime: new Date().toISOString(),
      complaintDetail: "Mock complaint",
      complaintState: "PENDING",
      complaintOrders: [],
      complaintFullRefunded: false,
      incomingUserResponse: true,
      userComplaintTimes: 1,
      complaintMedia: [],
      inPlatformService: false,
      needImmediateService: false
    };
  }

  async listComplaintNegotiationHistory(input: {
    complaintId: string;
    limit: number;
    offset: number;
  }): Promise<WeChatComplaintNegotiationResult> {
    const all = this.complaintHistories.get(input.complaintId) ?? [];
    return {
      data: all.slice(input.offset, input.offset + input.limit),
      limit: input.limit,
      offset: input.offset,
      totalCount: all.length
    };
  }

  async replyComplaint(input: { complaintId: string; responseContent: string; responseImages?: string[] }): Promise<WeChatProviderOperationResult> {
    const current = await this.queryComplaint(input.complaintId);
    this.complaints.set(input.complaintId, { ...current, complaintState: "PROCESSING", incomingUserResponse: false });
    const history = this.complaintHistories.get(input.complaintId) ?? [];
    history.push({
      logId: `mock_log_reply_${history.length + 1}_${input.complaintId}`,
      operator: "商户",
      operateTime: new Date().toISOString(),
      operateType: "MERCHANT_RESPONSE",
      operateDetails: input.responseContent,
      mediaUrls: input.responseImages ?? []
    });
    this.complaintHistories.set(input.complaintId, history);
    return { providerReference: `mock_reply_${input.complaintId}` };
  }

  async completeComplaint(complaintId: string): Promise<WeChatProviderOperationResult> {
    const current = await this.queryComplaint(complaintId);
    this.complaints.set(complaintId, { ...current, complaintState: "PROCESSED", incomingUserResponse: false });
    const history = this.complaintHistories.get(complaintId) ?? [];
    history.push({
      logId: `mock_log_complete_${history.length + 1}_${complaintId}`,
      operator: "商户",
      operateTime: new Date().toISOString(),
      operateType: "MERCHANT_CONFIRM_COMPLETE",
      mediaUrls: []
    });
    this.complaintHistories.set(complaintId, history);
    return { providerReference: `mock_complete_${complaintId}` };
  }

  async downloadDailyStatement(
    input: WeChatDailyStatementInput
  ): Promise<WeChatDailyStatementResult> {
    const text = this.dailyStatements.get(`${input.billDate}:${input.kind}`);
    if (text === undefined) {
      return { status: "noStatement", billDate: input.billDate, kind: input.kind };
    }
    const bytes = Buffer.from(text, "utf8");
    return {
      status: "downloaded",
      billDate: input.billDate,
      kind: input.kind,
      bytes,
      text,
      sizeBytes: bytes.byteLength,
      sha1: createHash("sha1").update(bytes).digest("hex"),
      sha256: createHash("sha256").update(bytes).digest("hex")
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

function constantTimeEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}
