import { Module } from "@nestjs/common";

import { FavoritesModule } from "../favorites/favorites.module";
import { ModerationModule } from "../moderation/moderation.module";
import { CompanionAvailabilityScheduleRuleService } from "./companion-availability-schedule-rule.service";
import { CompanionProfileMediaService } from "./companion-profile-media.service";
import { CompanionRecurringAvailabilityDraftMaterializerService } from "./companion-recurring-availability-draft-materializer.service";
import { CompanionsController } from "./companions.controller";
import { CompanionsService } from "./companions.service";

@Module({
  imports: [ModerationModule, FavoritesModule],
  controllers: [CompanionsController],
  providers: [
    CompanionsService,
    CompanionProfileMediaService,
    CompanionAvailabilityScheduleRuleService,
    CompanionRecurringAvailabilityDraftMaterializerService
  ],
  exports: [CompanionsService]
})
export class CompanionsModule {}
