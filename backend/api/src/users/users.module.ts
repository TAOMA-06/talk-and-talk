import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { LegalModule } from "../legal/legal.module";
import { ModerationModule } from "../moderation/moderation.module";
import { CustomerAdultEligibilityService } from "./customer-adult-eligibility.service";
import { MeController } from "./me.controller";
import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";
import { AccountDeletionExecutionWorker } from "./account-deletion-execution.worker";

@Module({
  imports: [AuthModule, LegalModule, ModerationModule],
  controllers: [UsersController, MeController],
  providers: [UsersService, CustomerAdultEligibilityService, AccountDeletionExecutionWorker],
  exports: [UsersService, CustomerAdultEligibilityService, AccountDeletionExecutionWorker]
})
export class UsersModule {}
