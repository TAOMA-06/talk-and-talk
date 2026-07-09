import { Injectable, Logger } from "@nestjs/common";

import { SmsProvider } from "./sms-provider.interface";

@Injectable()
export class MockSmsProvider implements SmsProvider {
  private readonly logger = new Logger(MockSmsProvider.name);
  private lastSentCode: { phone: string; code: string } | null = null;

  async sendCode(phone: string, code: string): Promise<void> {
    this.lastSentCode = { phone, code };
    this.logger.log(`[MOCK SMS] ${phone} → ${code}`);
  }

  getLastCode(): { phone: string; code: string } | null {
    return this.lastSentCode;
  }
}
