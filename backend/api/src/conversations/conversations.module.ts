import { Module } from "@nestjs/common";

import { CrisisInterventionModule } from "../crisis-intervention/crisis-intervention.module";
import { ModerationModule } from "../moderation/moderation.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { ConversationsController } from "./conversations.controller";
import { ConversationsService } from "./conversations.service";

@Module({
  imports: [CrisisInterventionModule, ModerationModule, NotificationsModule],
  controllers: [ConversationsController],
  providers: [ConversationsService]
})
export class ConversationsModule {}
