import { Module } from "@nestjs/common";

import { CompanionsModule } from "../companions/companions.module";
import { CommercialModule } from "../commercial/commercial.module";
import { PaymentsModule } from "../payments/payments.module";
import { ModerationModule } from "../moderation/moderation.module";
import { SupportModule } from "../support/support.module";
import { UsersModule } from "../users/users.module";
import { AdminController } from "./admin.controller";
import { AdminCommercialController } from "./commercial/admin-commercial.controller";

@Module({
  imports: [CompanionsModule, UsersModule, PaymentsModule, ModerationModule, CommercialModule, SupportModule],
  // Moderation is deliberately not an AdminModule concern. Review staff now
  // authenticate through ReviewModule and receive a separate token domain.
  controllers: [AdminController, AdminCommercialController]
})
export class AdminModule {}
