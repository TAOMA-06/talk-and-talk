import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";

import { ModerationModule } from "../moderation/moderation.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { ReviewAuthController } from "./review-auth.controller";
import { ReviewAuthService } from "./review-auth.service";
import { ReviewJwtAuthGuard } from "./guards/review-jwt-auth.guard";
import { ReviewRolesGuard } from "./guards/review-roles.guard";
import { ReviewModerationController } from "./review-moderation.controller";
import { ReviewModerationService } from "./review-moderation.service";
import { ReviewCaseService } from "./review-case.service";
import { ReviewStaffOffboardingService } from "./review-staff-offboarding.service";

@Module({
  imports: [JwtModule.register({}), ModerationModule, NotificationsModule],
  controllers: [ReviewAuthController, ReviewModerationController],
  providers: [
    ReviewAuthService,
    ReviewJwtAuthGuard,
    ReviewRolesGuard,
    ReviewCaseService,
    ReviewModerationService,
    ReviewStaffOffboardingService
  ]
})
export class ReviewModule {}
