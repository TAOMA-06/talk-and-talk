import { timingSafeEqual } from "node:crypto";

import { Controller, Get, Headers, Res, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Response } from "express";

import { MetricsService } from "./metrics.service";

@Controller("metrics")
export class MetricsController {
  constructor(
    private readonly metrics: MetricsService,
    private readonly config: ConfigService
  ) {}

  @Get()
  prometheus(
    @Headers("authorization") authorization?: string,
    @Res({ passthrough: true }) response?: Response
  ) {
    if (this.config.getOrThrow<string>("APP_ENV") === "production") {
      const expected = `Bearer ${this.config.getOrThrow<string>("METRICS_TOKEN")}`;
      if (!constantTimeEqual(authorization ?? "", expected)) {
        throw new UnauthorizedException("Metrics authentication required");
      }
    }
    response?.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
    return this.metrics.toPrometheusText(
      this.config.getOrThrow<string>("APP_VERSION"),
      this.config.getOrThrow<string>("APP_ENV")
    );
  }
}

function constantTimeEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}
