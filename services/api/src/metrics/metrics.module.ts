import { Global, Module } from "@nestjs/common";

import { MetricsController } from "./metrics.controller";
import { MetricsService } from "./metrics.service";
import { RequestMetricsMiddleware } from "./request-metrics.middleware";

@Global()
@Module({
  controllers: [MetricsController],
  providers: [MetricsService, RequestMetricsMiddleware],
  exports: [MetricsService, RequestMetricsMiddleware]
})
export class MetricsModule {}