import { Module, forwardRef } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { NotificationsModule } from "../notifications/notifications.module";
import { OrdersModule } from "../orders/orders.module";
import { VoiceModule } from "../voice/voice.module";
import { PaymentsController } from "./payments.controller";
import { PaymentsReconciliationWorker } from "./payments-reconciliation.worker";
import { PaymentsService } from "./payments.service";
import { WeChatDailyReconciliationService } from "./wechat-daily-reconciliation.service";
import { WeChatDailyReconciliationWorker } from "./wechat-daily-reconciliation.worker";
import { AdminPaymentDisputesController } from "./admin-payment-disputes.controller";
import { PaymentDisputesController } from "./payment-disputes.controller";
import { PaymentDisputesService } from "./payment-disputes.service";
import { PaymentDisputesWorker } from "./payment-disputes.worker";
import { createWeChatPayProvider } from "./wechat/wechat-pay-provider.factory";
import { WECHAT_PAY_PROVIDER } from "./wechat/wechat-pay.provider";

@Module({
  imports: [forwardRef(() => OrdersModule), NotificationsModule, VoiceModule],
  controllers: [PaymentsController, PaymentDisputesController, AdminPaymentDisputesController],
  providers: [
    PaymentsService,
    PaymentsReconciliationWorker,
    WeChatDailyReconciliationService,
    WeChatDailyReconciliationWorker,
    PaymentDisputesService,
    PaymentDisputesWorker,
    {
      provide: WECHAT_PAY_PROVIDER,
      useFactory: (config: ConfigService) => createWeChatPayProvider(config),
      inject: [ConfigService]
    }
  ],
  exports: [PaymentsService, PaymentDisputesService, WeChatDailyReconciliationService, WECHAT_PAY_PROVIDER]
})
export class PaymentsModule {}
