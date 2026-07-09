import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";

import { AdminModule } from "./admin/admin.module";
import { AuthModule } from "./auth/auth.module";
import { CompanionsModule } from "./companions/companions.module";
import { configuration, validateEnvironment } from "./config/configuration";
import { ConversationsModule } from "./conversations/conversations.module";
import { AuditModule } from "./common/audit/audit.module";
import { RequestIdMiddleware } from "./common/middleware/request-id.middleware";
import { IpRateLimitMiddleware } from "./common/rate-limit/ip-rate-limit.middleware";
import { DatabaseModule } from "./database/database.module";
import { HealthModule } from "./health/health.module";
import { ModerationModule } from "./moderation/moderation.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { OrdersModule } from "./orders/orders.module";
import { PaymentsModule } from "./payments/payments.module";
import { UsersModule } from "./users/users.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validate: validateEnvironment
    }),
    DatabaseModule,
    AuditModule,
    AuthModule,
    UsersModule,
    CompanionsModule,
    ConversationsModule,
    ModerationModule,
    OrdersModule,
    PaymentsModule,
    AdminModule,
    NotificationsModule,
    HealthModule
  ],
  providers: [IpRateLimitMiddleware]
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware, IpRateLimitMiddleware).forRoutes("*");
  }
}
