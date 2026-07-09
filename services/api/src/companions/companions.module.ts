import { Module } from "@nestjs/common";

import { CompanionsController } from "./companions.controller";
import { CompanionsService } from "./companions.service";

@Module({
  controllers: [CompanionsController],
  providers: [CompanionsService],
  exports: [CompanionsService]
})
export class CompanionsModule {}
