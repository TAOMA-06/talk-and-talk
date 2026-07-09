import { Injectable, Logger } from "@nestjs/common";

import { maskPhone, redactString } from "../../common/logging/redact";
import { SmsProvider } from "./sms-provider.interface";

@Injectable()
export class MockSmsProvider implements SmsProvider {
  private readonly logger = new Logger(MockSmsProvider.name);
  private lastSentCode: { phone: string; code: string } | null = null;

  async sendCode(phone: string, code: string): Promise<void> {
    this.lastSentCode = { phone, code };
    // Never log raw verification codes or full phone numbers.
    const safe = redactString(`[MOCK SMS] ${maskPhone(phone)} → ******`);
    this.logger.log(safe);
  }

  getLastCode(): { phone: string; code: string } | null {
    return this.lastSentCode;
  }
}
