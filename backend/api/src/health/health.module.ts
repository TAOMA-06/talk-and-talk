import { Module } from "@nestjs/common";

import { SecurityCounterModule } from "../common/security-counter/security-counter.module";
import { HealthController } from "./health.controller";
import { HealthService } from "./health.service";

@Module({
  imports: [SecurityCounterModule],
  controllers: [HealthController],
  providers: [HealthService],
  exports: [HealthService]
})
export class HealthModule {}
