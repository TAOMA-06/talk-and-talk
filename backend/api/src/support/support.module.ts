import { Module } from "@nestjs/common";

import { CommercialModule } from "../commercial/commercial.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { ModerationModule } from "../moderation/moderation.module";
import { PublicSupportController } from "./public-support.controller";
import { SupportController } from "./support.controller";
import { SupportService } from "./support.service";

@Module({
  imports: [CommercialModule, NotificationsModule, ModerationModule],
  controllers: [PublicSupportController, SupportController],
  providers: [SupportService],
  exports: [SupportService]
})
export class SupportModule {}
