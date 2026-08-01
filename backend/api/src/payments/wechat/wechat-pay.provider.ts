export const WECHAT_PAY_PROVIDER = Symbol("WECHAT_PAY_PROVIDER");
export const WECHAT_PREPAY_TTL_MS = 15 * 60 * 1000;

export type WeChatAppPayParams = {
  appId: string;
  partnerId: string;
  prepayId: string;
  package: string;
  nonceStr: string;
  timeStamp: string;
  sign: string;
};

export type WeChatMiniProgramPayParams = {
  timeStamp: string;
  nonceStr: string;
  package: string;
  signType: "RSA";
  paySign: string;
};

export type WeChatNativePayParams = {
  codeUrl: string;
};

export type WeChatPrepayInput = {
  outTradeNo: string;
  description: string;
  amountCents: number;
  notifyUrl: string;
  expiresAt?: Date;
};

export type WeChatMiniProgramPrepayInput = WeChatPrepayInput & {
  openId: string;
};

export type WeChatAppPrepayResult = {
  prepayId: string;
  channel: "app";
  clientParams: WeChatAppPayParams;
  mock: boolean;
};

export type WeChatMiniProgramPrepayResult = {
  prepayId: string;
  channel: "miniProgram";
  clientParams: WeChatMiniProgramPayParams;
  mock: boolean;
};

export type WeChatNativePrepayResult = {
  prepayId: string;
  channel: "native";
  clientParams: WeChatNativePayParams;
  mock: boolean;
};

export type WeChatPrepayResult =
  | WeChatAppPrepayResult
  | WeChatMiniProgramPrepayResult
  | WeChatNativePrepayResult;

export type WeChatNotifyPayload = {
  appId: string;
  mchId: string;
  outTradeNo: string;
  transactionId: string;
  tradeState: string;
  /** Provider-authored RFC 3339 success_time. Null for non-success states. */
  successTime: string | null;
  amountCents: number;
  currency: string;
  raw: Record<string, unknown>;
};

export type WeChatRefundInput = {
  transactionId: string;
  outRefundNo: string;
  reason: string;
  refundAmountCents: number;
  totalAmountCents: number;
  notifyUrl: string;
};

export type WeChatRefundResult = {
  outRefundNo: string;
  refundId: string;
  status: string;
  /** Provider-authored create_time. Kept under the acceptedTime name for API compatibility. */
  acceptedTime: string | null;
  /** Provider-authored success_time; null until the refund actually succeeds. */
  successTime: string | null;
};

export type WeChatRefundNotifyPayload = WeChatRefundResult & {
  appId?: string;
  mchId: string;
  outTradeNo: string;
  transactionId: string;
  totalAmountCents: number;
  refundAmountCents: number;
  currency?: string;
  raw: Record<string, unknown>;
};

export type WeChatComplaintNotifyPayload = {
  notificationId: string;
  createTime: string;
  eventType: string;
  summary?: string;
  complaintId: string;
  actionType: string;
};

export type WeChatComplaintDetail = {
  complaintId: string;
  complaintTime: string;
  complaintDetail: string;
  complaintState: string;
  complaintOrders: Array<{ transactionId: string; outTradeNo: string; amountCents: number }>;
  complaintFullRefunded: boolean;
  incomingUserResponse: boolean;
  userComplaintTimes: number;
  complaintMedia: Array<{ mediaType: string; mediaUrls: string[] }>;
  problemDescription?: string;
  problemType?: string;
  applyRefundAmountCents?: number;
  inPlatformService: boolean;
  needImmediateService: boolean;
};

export type WeChatComplaintListResult = {
  data: WeChatComplaintDetail[];
  limit: number;
  offset: number;
  totalCount: number;
};

export type WeChatComplaintNegotiationEvent = {
  logId: string;
  operator: string;
  operateTime: string;
  operateType: string;
  operateDetails?: string;
  mediaUrls: string[];
};

export type WeChatComplaintNegotiationResult = {
  data: WeChatComplaintNegotiationEvent[];
  limit: number;
  offset: number;
  totalCount: number;
};

export type WeChatProviderOperationResult = {
  /** Upstream request/reference id when the provider actually returns one. */
  providerReference?: string;
};

export const WECHAT_DAILY_STATEMENT_MAX_BYTES = 20 * 1024 * 1024;

export type WeChatDailyStatementKind =
  | "tradeAll"
  | "fundBasic"
  | "fundOperation"
  | "fundFees";

export type WeChatDailyStatementInput = {
  /** WeChat bill date in yyyy-MM-dd; callers may backfill within the provider's supported window. */
  billDate: string;
  kind: WeChatDailyStatementKind;
};

export type WeChatDailyStatementResult =
  | {
      status: "noStatement";
      billDate: string;
      kind: WeChatDailyStatementKind;
    }
  | {
      status: "downloaded";
      billDate: string;
      kind: WeChatDailyStatementKind;
      /** Exact uncompressed bytes whose SHA1 was attested by the signed application response. */
      bytes: Uint8Array;
      /** Strict UTF-8 decoding of bytes. */
      text: string;
      sizeBytes: number;
      sha1: string;
      /** Local durable evidence hash for reconciliation storage and deduplication. */
      sha256: string;
    };

export interface WeChatPayProvider {
  readonly mode: "mock" | "real" | "disabled";
  readonly isMock: boolean;
  createAppPrepay(input: WeChatPrepayInput): Promise<WeChatAppPrepayResult>;
  createMiniProgramPrepay(input: WeChatMiniProgramPrepayInput): Promise<WeChatMiniProgramPrepayResult>;
  createNativePrepay(input: WeChatPrepayInput): Promise<WeChatNativePrepayResult>;
  closePayment(outTradeNo: string): Promise<void>;
  queryPayment(outTradeNo: string): Promise<WeChatNotifyPayload>;
  verifyNotifySignature(headers: Record<string, string | string[] | undefined>, rawBody: string): boolean;
  verifyNotifySignatureAsync?(
    headers: Record<string, string | string[] | undefined>,
    rawBody: string
  ): Promise<boolean>;
  parseNotifyPayload(rawBody: string): WeChatNotifyPayload;
  createRefund(input: WeChatRefundInput): Promise<WeChatRefundResult>;
  queryRefund(outRefundNo: string): Promise<WeChatRefundResult>;
  parseRefundNotifyPayload(rawBody: string): WeChatRefundNotifyPayload;
  parseComplaintNotifyPayload(rawBody: string): WeChatComplaintNotifyPayload;
  listComplaints(input: {
    beginDate: string;
    endDate: string;
    limit: number;
    offset: number;
  }): Promise<WeChatComplaintListResult>;
  queryComplaint(complaintId: string): Promise<WeChatComplaintDetail>;
  listComplaintNegotiationHistory(input: {
    complaintId: string;
    limit: number;
    offset: number;
  }): Promise<WeChatComplaintNegotiationResult>;
  replyComplaint(input: {
    complaintId: string;
    responseContent: string;
    responseImages?: string[];
  }): Promise<WeChatProviderOperationResult>;
  completeComplaint(complaintId: string): Promise<WeChatProviderOperationResult>;
  downloadDailyStatement(input: WeChatDailyStatementInput): Promise<WeChatDailyStatementResult>;
}
