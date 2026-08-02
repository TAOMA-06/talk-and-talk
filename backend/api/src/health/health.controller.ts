import { timingSafeEqual } from "node:crypto";

import {
  Controller,
  Get,
  Headers,
  HttpStatus,
  Res,
  ServiceUnavailableException,
  UnauthorizedException
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Response } from "express";

import { HealthService } from "./health.service";

@Controller("health")
export class HealthController {
  constructor(
    private readonly healthService: HealthService,
    private readonly config: ConfigService
  ) {}

  @Get()
  async check(@Res({ passthrough: true }) response: Response) {
    const health = await this.healthService.check();

    response.status(
      health.status === "ok"
        ? HttpStatus.OK
        : HttpStatus.SERVICE_UNAVAILABLE
    );

    return health;
  }

  /** Authenticated readiness with dependency detail for ops/scrapers. */
  @Get("ready")
  async ready(
    @Headers("authorization") authorization: string | undefined,
    @Res({ passthrough: true }) response: Response
  ) {
    const appEnv = this.config.getOrThrow<string>("APP_ENV");
    if (appEnv !== "development") {
      const token = this.config.get<string>("METRICS_TOKEN")?.trim() ?? "";
      if (token.length < 32) {
        throw new ServiceUnavailableException("Health ready endpoint disabled: METRICS_TOKEN is not configured");
      }
      const expected = `Bearer ${token}`;
      if (!constantTimeEqual(authorization ?? "", expected)) {
        throw new UnauthorizedException("Health ready authentication required");
      }
    }

    const health = await this.healthService.ready();
    response.status(
      health.status === "ok"
        ? HttpStatus.OK
        : HttpStatus.SERVICE_UNAVAILABLE
    );
    return health;
  }
}

function constantTimeEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}
