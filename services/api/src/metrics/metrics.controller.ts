import { Controller, Get, Header } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { MetricsService } from "./metrics.service";

@Controller("metrics")
export class MetricsController {
  constructor(
    private readonly metrics: MetricsService,
    private readonly config: ConfigService
  ) {}

  @Get()
  @Header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
  prometheus() {
    return this.metrics.toPrometheusText(
      this.config.getOrThrow<string>("APP_VERSION"),
      this.config.getOrThrow<string>("APP_ENV")
    );
  }
}