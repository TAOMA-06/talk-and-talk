import { Module } from "@nestjs/common";

import { FavoritesModule } from "../favorites/favorites.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { ModerationModule } from "../moderation/moderation.module";
import { PaymentsModule } from "../payments/payments.module";
import { CommercialController } from "./commercial.controller";
import { CompanionLifecycleAdminController } from "./companion-lifecycle-admin.controller";
import { CompanionLifecycleController } from "./companion-lifecycle.controller";
import { CompanionLifecycleService } from "./companion-lifecycle.service";
import { CommercialFunnelService } from "./commercial-funnel.service";
import { CommercialSettlementWorker } from "./commercial-settlement.worker";
import { CommercialService } from "./commercial.service";

@Module({
  imports: [FavoritesModule, NotificationsModule, PaymentsModule, ModerationModule],
  controllers: [CommercialController, CompanionLifecycleController, CompanionLifecycleAdminController],
  providers: [
    CommercialService,
    CompanionLifecycleService,
    CommercialFunnelService,
    CommercialSettlementWorker
  ],
  exports: [CommercialService, CompanionLifecycleService, CommercialFunnelService]
})
export class CommercialModule {}
