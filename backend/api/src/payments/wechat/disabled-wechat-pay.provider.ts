import { HttpStatus } from "@nestjs/common";

import { AppException } from "../../common/errors/app.exception";
import {
  WeChatNotifyPayload,
  WeChatPayProvider,
  WeChatPrepayInput,
  WeChatPrepayResult
  , WeChatRefundInput, WeChatRefundNotifyPayload, WeChatRefundResult
} from "./wechat-pay.provider";

/**
 * Production fallback when WeChat credentials are incomplete.
 * Never accepts notify signatures — prevents mock forge surface.
 */
export class DisabledWeChatPayProvider implements WeChatPayProvider {
  readonly isMock = false;

  async createAppPrepay(_input: WeChatPrepayInput): Promise<WeChatPrepayResult> {
    throw new AppException(
      "WECHAT_PAY_NOT_CONFIGURED",
      "WeChat Pay is not configured for this environment",
      HttpStatus.SERVICE_UNAVAILABLE
    );
  }

  verifyNotifySignature(
    _headers: Record<string, string | string[] | undefined>,
    _rawBody: string
  ): boolean {
    return false;
  }

  parseNotifyPayload(_rawBody: string): WeChatNotifyPayload {
    throw new AppException(
      "WECHAT_PAY_NOT_CONFIGURED",
      "WeChat Pay is not configured for this environment",
      HttpStatus.SERVICE_UNAVAILABLE
    );
  }

  async createRefund(_input: WeChatRefundInput): Promise<WeChatRefundResult> { return this.unavailable(); }
  async queryRefund(_outRefundNo: string): Promise<WeChatRefundResult> { return this.unavailable(); }
  parseRefundNotifyPayload(_rawBody: string): WeChatRefundNotifyPayload { return this.unavailable(); }

  private unavailable(): never {
    throw new AppException("WECHAT_PAY_NOT_CONFIGURED", "WeChat Pay is not configured for this environment", HttpStatus.SERVICE_UNAVAILABLE);
  }
}
