import { Module, forwardRef } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { OrdersModule } from "../orders/orders.module";
import { PaymentsController } from "./payments.controller";
import { PaymentsService } from "./payments.service";
import { MockWeChatPayProvider } from "./wechat/mock-wechat-pay.provider";
import { RealWeChatPayProvider, isWeChatConfigured } from "./wechat/real-wechat-pay.provider";
import { WECHAT_PAY_PROVIDER } from "./wechat/wechat-pay.provider";

@Module({
  imports: [forwardRef(() => OrdersModule)],
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    {
      provide: WECHAT_PAY_PROVIDER,
      useFactory: (config: ConfigService) => {
        const nodeEnv = config.getOrThrow<string>("NODE_ENV");
        const env = {
          WECHAT_PAY_APP_ID: config.get<string>("WECHAT_PAY_APP_ID", ""),
          WECHAT_PAY_MCH_ID: config.get<string>("WECHAT_PAY_MCH_ID", ""),
          WECHAT_PAY_API_V3_KEY: config.get<string>("WECHAT_PAY_API_V3_KEY", ""),
          WECHAT_PAY_PRIVATE_KEY_PATH: config.get<string>("WECHAT_PAY_PRIVATE_KEY_PATH", ""),
          WECHAT_PAY_CERT_SERIAL_NO: config.get<string>("WECHAT_PAY_CERT_SERIAL_NO", "")
        };

        if (nodeEnv === "production" && isWeChatConfigured(env)) {
          return new RealWeChatPayProvider({
            appId: env.WECHAT_PAY_APP_ID,
            mchId: env.WECHAT_PAY_MCH_ID,
            apiV3Key: env.WECHAT_PAY_API_V3_KEY,
            privateKeyPath: env.WECHAT_PAY_PRIVATE_KEY_PATH,
            certSerialNo: env.WECHAT_PAY_CERT_SERIAL_NO
          });
        }

        // Development, test, or incomplete credentials: mock provider for closed-loop acceptance.
        return new MockWeChatPayProvider();
      },
      inject: [ConfigService]
    }
  ],
  exports: [PaymentsService, WECHAT_PAY_PROVIDER]
})
export class PaymentsModule {}
