import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { ModerationModule } from "../moderation/moderation.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { AccountGovernanceAdminController } from "./account-governance-admin.controller";
import { AccountGovernanceController } from "./account-governance.controller";
import { AccountGovernanceService } from "./account-governance.service";
import { DataExportDeliveryController } from "./data-export-delivery.controller";
import { DataExportDeliveryService } from "./data-export-delivery.service";
import { UserAccountActionsService } from "./user-account-actions.service";

@Module({
  imports: [AuthModule, ModerationModule, NotificationsModule],
  controllers: [
    AccountGovernanceController,
    AccountGovernanceAdminController,
    DataExportDeliveryController
  ],
  providers: [AccountGovernanceService, DataExportDeliveryService, UserAccountActionsService],
  exports: [AccountGovernanceService, UserAccountActionsService]
})
export class AccountGovernanceModule {}
