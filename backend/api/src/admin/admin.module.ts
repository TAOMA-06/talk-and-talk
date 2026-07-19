import { Module } from "@nestjs/common";

import { CompanionsModule } from "../companions/companions.module";
import { PaymentsModule } from "../payments/payments.module";
import { UsersModule } from "../users/users.module";
import { AdminController } from "./admin.controller";
import { AdminModerationController } from "./moderation/admin-moderation.controller";
import { AdminModerationService } from "./moderation/admin-moderation.service";

@Module({
  imports: [CompanionsModule, UsersModule, PaymentsModule],
  controllers: [AdminController, AdminModerationController],
  providers: [AdminModerationService]
})
export class AdminModule {}
