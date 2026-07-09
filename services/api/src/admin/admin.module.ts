import { Module } from "@nestjs/common";

import { CompanionsModule } from "../companions/companions.module";
import { AdminController } from "./admin.controller";

@Module({
  imports: [CompanionsModule],
  controllers: [AdminController]
})
export class AdminModule {}
