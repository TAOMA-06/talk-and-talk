export const WECHAT_PAY_PROVIDER = Symbol("WECHAT_PAY_PROVIDER");

export type WeChatAppPayParams = {
  appId: string;
  partnerId: string;
  prepayId: string;
  package: string;
  nonceStr: string;
  timeStamp: string;
  sign: string;
};

export type WeChatPrepayInput = {
  outTradeNo: string;
  description: string;
  amountCents: number;
  notifyUrl: string;
};

export type WeChatPrepayResult = {
  prepayId: string;
  clientParams: WeChatAppPayParams;
  mock: boolean;
};

export type WeChatNotifyPayload = {
  outTradeNo: string;
  transactionId: string;
  tradeState: string;
  amountCents: number;
  raw: Record<string, unknown>;
};

export interface WeChatPayProvider {
  readonly isMock: boolean;
  createAppPrepay(input: WeChatPrepayInput): Promise<WeChatPrepayResult>;
  verifyNotifySignature(headers: Record<string, string | string[] | undefined>, rawBody: string): boolean;
  parseNotifyPayload(rawBody: string): WeChatNotifyPayload;
}
