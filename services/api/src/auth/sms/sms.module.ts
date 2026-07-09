import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { SMS_PROVIDER } from "./sms-provider.interface";
import { MockSmsProvider } from "./mock-sms.provider";

@Module({
  providers: [
    {
      provide: SMS_PROVIDER,
      useFactory: (config: ConfigService) => {
        const provider = config.get<string>("SMS_PROVIDER", "mock");
        switch (provider) {
          case "mock":
          case "none":
            return new MockSmsProvider();
          default:
            return new MockSmsProvider();
        }
      },
      inject: [ConfigService]
    }
  ],
  exports: [SMS_PROVIDER]
})
export class SmsModule {}
