import { Module } from "@nestjs/common";

import { CompanionsModule } from "../companions/companions.module";
import { CommercialModule } from "../commercial/commercial.module";
import { PaymentsModule } from "../payments/payments.module";
import { ModerationModule } from "../moderation/moderation.module";
import { SupportModule } from "../support/support.module";
import { UsersModule } from "../users/users.module";
import { AdminController } from "./admin.controller";
import { AdminCommercialController } from "./commercial/admin-commercial.controller";
import { AdminModerationController } from "./moderation/admin-moderation.controller";
import { AdminModerationService } from "./moderation/admin-moderation.service";

@Module({
  imports: [CompanionsModule, UsersModule, PaymentsModule, ModerationModule, CommercialModule, SupportModule],
  controllers: [AdminController, AdminModerationController, AdminCommercialController],
  providers: [AdminModerationService]
})
export class AdminModule {}
