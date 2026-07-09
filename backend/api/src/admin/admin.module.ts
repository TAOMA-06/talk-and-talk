import { Module } from "@nestjs/common";

import { CompanionsModule } from "../companions/companions.module";
import { AdminController } from "./admin.controller";
import { AdminModerationController } from "./moderation/admin-moderation.controller";
import { AdminModerationService } from "./moderation/admin-moderation.service";

@Module({
  imports: [CompanionsModule],
  controllers: [AdminController, AdminModerationController],
  providers: [AdminModerationService]
})
export class AdminModule {}
