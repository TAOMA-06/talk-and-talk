import { Module } from "@nestjs/common";

import { ModerationController } from "./moderation.controller";

@Module({
  controllers: [ModerationController]
})
export class ModerationModule {}
