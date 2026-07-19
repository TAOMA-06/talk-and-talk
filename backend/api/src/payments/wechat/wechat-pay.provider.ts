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

export type WeChatPrepayResult = WeChatAppPrepayResult | WeChatMiniProgramPrepayResult;

export type WeChatNotifyPayload = {
  appId: string;
  mchId: string;
  outTradeNo: string;
  transactionId: string;
  tradeState: string;
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

export interface WeChatPayProvider {
  readonly mode: "mock" | "real" | "disabled";
  readonly isMock: boolean;
  createAppPrepay(input: WeChatPrepayInput): Promise<WeChatAppPrepayResult>;
  createMiniProgramPrepay(input: WeChatMiniProgramPrepayInput): Promise<WeChatMiniProgramPrepayResult>;
  closePayment(outTradeNo: string): Promise<void>;
  queryPayment(outTradeNo: string): Promise<WeChatNotifyPayload>;
  verifyNotifySignature(headers: Record<string, string | string[] | undefined>, rawBody: string): boolean;
  parseNotifyPayload(rawBody: string): WeChatNotifyPayload;
  createRefund(input: WeChatRefundInput): Promise<WeChatRefundResult>;
  queryRefund(outRefundNo: string): Promise<WeChatRefundResult>;
  parseRefundNotifyPayload(rawBody: string): WeChatRefundNotifyPayload;
}
