import { Module, forwardRef } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { NotificationsModule } from "../notifications/notifications.module";
import { OrdersModule } from "../orders/orders.module";
import { VoiceModule } from "../voice/voice.module";
import { PaymentsController } from "./payments.controller";
import { PaymentsReconciliationWorker } from "./payments-reconciliation.worker";
import { PaymentsService } from "./payments.service";
import { DisabledWeChatPayProvider } from "./wechat/disabled-wechat-pay.provider";
import { MockWeChatPayProvider } from "./wechat/mock-wechat-pay.provider";
import { RealWeChatPayProvider, isWeChatConfigured } from "./wechat/real-wechat-pay.provider";
import { WECHAT_PAY_PROVIDER } from "./wechat/wechat-pay.provider";

@Module({
  imports: [forwardRef(() => OrdersModule), NotificationsModule, VoiceModule],
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    PaymentsReconciliationWorker,
    {
      provide: WECHAT_PAY_PROVIDER,
      useFactory: (config: ConfigService) => {
        const appEnv = config.getOrThrow<string>("APP_ENV");
        const env = {
          WECHAT_PAY_APP_ID: config.get<string>("WECHAT_PAY_APP_ID", ""),
          WECHAT_PAY_MCH_ID: config.get<string>("WECHAT_PAY_MCH_ID", ""),
          WECHAT_PAY_API_V3_KEY: config.get<string>("WECHAT_PAY_API_V3_KEY", ""),
          WECHAT_PAY_PRIVATE_KEY: config.get<string>("WECHAT_PAY_PRIVATE_KEY", ""),
          WECHAT_PAY_PRIVATE_KEY_PATH: config.get<string>("WECHAT_PAY_PRIVATE_KEY_PATH", ""),
          WECHAT_PAY_CERT_SERIAL_NO: config.get<string>("WECHAT_PAY_CERT_SERIAL_NO", ""),
          WECHAT_MINIPROGRAM_APP_ID: config.get<string>("WECHAT_MINIPROGRAM_APP_ID", "")
        };

        // Production: Real when fully configured; otherwise Disabled (never Mock).
        if (appEnv === "production") {
          if (isWeChatConfigured(env)) {
            return new RealWeChatPayProvider({
              appId: env.WECHAT_PAY_APP_ID,
              mchId: env.WECHAT_PAY_MCH_ID,
              apiV3Key: env.WECHAT_PAY_API_V3_KEY,
              privateKey: env.WECHAT_PAY_PRIVATE_KEY,
              privateKeyPath: env.WECHAT_PAY_PRIVATE_KEY_PATH,
              certSerialNo: env.WECHAT_PAY_CERT_SERIAL_NO,
              miniProgramAppId: env.WECHAT_MINIPROGRAM_APP_ID
            });
          }
          return new DisabledWeChatPayProvider();
        }

        // Staging / development / test: prefer Real when configured, else Mock closed-loop.
        if (isWeChatConfigured(env)) {
          return new RealWeChatPayProvider({
            appId: env.WECHAT_PAY_APP_ID,
            mchId: env.WECHAT_PAY_MCH_ID,
            apiV3Key: env.WECHAT_PAY_API_V3_KEY,
            privateKey: env.WECHAT_PAY_PRIVATE_KEY,
            privateKeyPath: env.WECHAT_PAY_PRIVATE_KEY_PATH,
            certSerialNo: env.WECHAT_PAY_CERT_SERIAL_NO,
            miniProgramAppId: env.WECHAT_MINIPROGRAM_APP_ID
          });
        }

        return new MockWeChatPayProvider();
      },
      inject: [ConfigService]
    }
  ],
  exports: [PaymentsService, WECHAT_PAY_PROVIDER]
})
export class PaymentsModule {}
