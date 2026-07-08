import { Module } from "@nestjs/common";

import { CompanionsController } from "./companions.controller";

@Module({
  controllers: [CompanionsController]
})
export class CompanionsModule {}
