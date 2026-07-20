import { Module } from "@nestjs/common";

import { ModerationModule } from "../moderation/moderation.module";
import { CompanionsController } from "./companions.controller";
import { CompanionsService } from "./companions.service";

@Module({
  imports: [ModerationModule],
  controllers: [CompanionsController],
  providers: [CompanionsService],
  exports: [CompanionsService]
})
export class CompanionsModule {}
