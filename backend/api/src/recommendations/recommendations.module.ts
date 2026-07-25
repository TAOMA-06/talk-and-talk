import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { RolesGuard } from "../auth/guards/roles.guard";
import { CompanionsModule } from "../companions/companions.module";
import { AdminRecommendationsController } from "./admin-recommendations.controller";
import { RecommendationsController } from "./recommendations.controller";
import { RecommendationsService } from "./recommendations.service";

@Module({
  imports: [AuthModule, CompanionsModule],
  controllers: [RecommendationsController, AdminRecommendationsController],
  providers: [RecommendationsService, RolesGuard],
  exports: [RecommendationsService]
})
export class RecommendationsModule {}
