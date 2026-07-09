import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { DisabledSmsProvider } from "./disabled-sms.provider";
import { MockSmsProvider } from "./mock-sms.provider";
import { SMS_PROVIDER } from "./sms-provider.interface";

@Module({
  providers: [
    {
      provide: SMS_PROVIDER,
      useFactory: (config: ConfigService) => {
        const provider = config.get<string>("SMS_PROVIDER", "mock");
        switch (provider) {
          case "mock":
            return new MockSmsProvider();
          case "none":
            return new DisabledSmsProvider();
          default:
            // Unknown vendors fall through to disabled until real providers are wired.
            return new DisabledSmsProvider();
        }
      },
      inject: [ConfigService]
    }
  ],
  exports: [SMS_PROVIDER]
})
export class SmsModule {}
