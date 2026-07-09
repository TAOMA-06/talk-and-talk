import { HttpStatus, Injectable } from "@nestjs/common";

import { AppException } from "../../common/errors/app.exception";
import { SmsProvider } from "./sms-provider.interface";

/**
 * Used when SMS_PROVIDER=none (production Apple-only path).
 * Does not log or store codes — sendCode always fails with a clear error.
 */
@Injectable()
export class DisabledSmsProvider implements SmsProvider {
  async sendCode(_phone: string, _code: string): Promise<void> {
    throw new AppException(
      "SMS_UNAVAILABLE",
      "SMS verification is not available in this environment. Use Sign in with Apple.",
      HttpStatus.SERVICE_UNAVAILABLE
    );
  }
}
