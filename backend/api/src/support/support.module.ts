import { Module } from "@nestjs/common";

import { CommercialModule } from "../commercial/commercial.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { SupportController } from "./support.controller";
import { SupportService } from "./support.service";

@Module({
  imports: [CommercialModule, NotificationsModule],
  controllers: [SupportController],
  providers: [SupportService],
  exports: [SupportService]
})
export class SupportModule {}
