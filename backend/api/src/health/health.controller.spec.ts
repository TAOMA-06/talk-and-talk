import { CallHandler, ExecutionContext } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Response } from "express";
import { firstValueFrom, of } from "rxjs";

import { EnvelopeInterceptor } from "../common/envelope/envelope.interceptor";
import { HealthController } from "./health.controller";
import { HealthLivenessResponse, HealthReadyResponse, HealthService } from "./health.service";

const healthyLiveness: HealthLivenessResponse = {
  status: "ok",
  service: "talk-and-talk-api",
  version: "1.2.3"
};

const healthyReady: HealthReadyResponse = {
  ...healthyLiveness,
  appEnv: "staging",
  uptimeSeconds: 10,
  dependencies: {
    database: { status: "ok", latencyMs: 1 },
    redis: { status: "ok", latencyMs: 2 }
  }
};

describe("HealthController", () => {
  const check = jest.fn<Promise<HealthLivenessResponse>, []>();
  const ready = jest.fn<Promise<HealthReadyResponse>, []>();
  const healthService = { check, ready } as unknown as HealthService;
  const config = {
    getOrThrow: jest.fn((key: string) => (key === "APP_ENV" ? "development" : "")),
    get: jest.fn()
  } as unknown as ConfigService;
  const controller = new HealthController(healthService, config);
  const interceptor = new EnvelopeInterceptor<HealthLivenessResponse | HealthReadyResponse>();

  beforeEach(() => {
    check.mockReset();
    ready.mockReset();
  });

  it("returns 200 with slim liveness envelope", async () => {
    check.mockResolvedValue(healthyLiveness);
    const response = mockResponse();

    const health = await controller.check(response.value);
    const envelope = await wrap(health);

    expect(response.status).toHaveBeenCalledWith(200);
    expect(envelope.data).toEqual(healthyLiveness);
    expect(envelope.meta).toEqual({
      requestId: "health-test",
      timestamp: expect.any(String)
    });
  });

  it("never returns dependency-driven degraded status from public liveness", async () => {
    check.mockResolvedValue(healthyLiveness);
    const response = mockResponse();

    await controller.check(response.value);

    expect(check).toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(200);
  });

  it("returns authenticated ready detail in development without a token", async () => {
    ready.mockResolvedValue(healthyReady);
    const response = mockResponse();

    const health = await controller.ready(undefined, response.value);
    const envelope = await wrap(health);

    expect(response.status).toHaveBeenCalledWith(200);
    expect(envelope.data).toEqual(healthyReady);
  });

  function mockResponse() {
    const status = jest.fn().mockReturnThis();
    return {
      status,
      value: { status } as unknown as Response
    };
  }

  function wrap(health: HealthLivenessResponse | HealthReadyResponse) {
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ requestId: "health-test" })
      })
    } as unknown as ExecutionContext;
    const next = {
      handle: () => of(health)
    } as CallHandler<HealthLivenessResponse | HealthReadyResponse>;

    return firstValueFrom(interceptor.intercept(context, next));
  }
});
