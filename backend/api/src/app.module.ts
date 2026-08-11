import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";

import { AdminModule } from "./admin/admin.module";
import { AccountGovernanceModule } from "./account-governance/account-governance.module";
import { AttendanceDisputesModule } from "./attendance-disputes/attendance-disputes.module";
import { AuthModule } from "./auth/auth.module";
import { CompanionsModule } from "./companions/companions.module";
import { CommunityModule } from "./community/community.module";
import { CommercialModule } from "./commercial/commercial.module";
import { configuration, validateEnvironment } from "./config/configuration";
import { ConversationsModule } from "./conversations/conversations.module";
import { CrisisInterventionModule } from "./crisis-intervention/crisis-intervention.module";
import { AuditModule } from "./common/audit/audit.module";
import { RequestIdMiddleware } from "./common/middleware/request-id.middleware";
import { IpRateLimitMiddleware } from "./common/rate-limit/ip-rate-limit.middleware";
import { DatabaseModule } from "./database/database.module";
import { FavoritesModule } from "./favorites/favorites.module";
import { HealthModule } from "./health/health.module";
import { LegalModule } from "./legal/legal.module";
import { MetricsModule } from "./metrics/metrics.module";
import { RequestMetricsMiddleware } from "./metrics/request-metrics.middleware";
import { ModerationModule } from "./moderation/moderation.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { OrdersModule } from "./orders/orders.module";
import { PaymentsModule } from "./payments/payments.module";
import { ReviewsModule } from "./reviews/reviews.module";
import { ReviewModule } from "./review/review.module";
import { RecommendationsModule } from "./recommendations/recommendations.module";
import { SupportModule } from "./support/support.module";
import { UsersModule } from "./users/users.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Isolated E2E invokes Nest with a sealed child environment. Do not let a
      // developer's backend/api/.env reintroduce provider credentials or
      // worker switches after the E2E guard has checked them.
      ignoreEnvFile: process.env.NODE_ENV === "test",
      load: [configuration],
      validate: validateEnvironment
    }),
    DatabaseModule,
    AuditModule,
    AuthModule,
    AccountGovernanceModule,
    AttendanceDisputesModule,
    UsersModule,
    CompanionsModule,
    FavoritesModule,
    CommunityModule,
    ConversationsModule,
    CrisisInterventionModule,
    ModerationModule,
    OrdersModule,
    PaymentsModule,
    ReviewsModule,
    RecommendationsModule,
    CommercialModule,
    SupportModule,
    AdminModule,
    ReviewModule,
    NotificationsModule,
    MetricsModule,
    HealthModule,
    LegalModule
  ],
  providers: [IpRateLimitMiddleware]
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(RequestIdMiddleware, RequestMetricsMiddleware, IpRateLimitMiddleware)
      .forRoutes("{*path}");
  }
}
