import { CallHandler, ExecutionContext } from "@nestjs/common";
import type { Response } from "express";
import { firstValueFrom, of } from "rxjs";

import { EnvelopeInterceptor } from "../common/envelope/envelope.interceptor";
import { HealthController } from "./health.controller";
import { HealthResponse, HealthService } from "./health.service";

const healthyResponse: HealthResponse = {
  status: "ok",
  service: "talk-and-talk-api",
  version: "1.2.3",
  appEnv: "test",
  uptimeSeconds: 10,
  dependencies: {
    database: { status: "ok", latencyMs: 1 },
    redis: { status: "ok", latencyMs: 2 }
  }
};

describe("HealthController", () => {
  const check = jest.fn<Promise<HealthResponse>, []>();
  const healthService = { check } as unknown as HealthService;
  const controller = new HealthController(healthService);
  const interceptor = new EnvelopeInterceptor<HealthResponse>();

  beforeEach(() => {
    check.mockReset();
  });

  it("returns 200 with the success envelope when dependencies are healthy", async () => {
    check.mockResolvedValue(healthyResponse);
    const response = mockResponse();

    const health = await controller.check(response.value);
    const envelope = await wrap(health);

    expect(response.status).toHaveBeenCalledWith(200);
    expect(envelope.data).toEqual(healthyResponse);
    expect(envelope.meta).toEqual({
      requestId: "health-test",
      timestamp: expect.any(String)
    });
  });

  it("returns 503 with the same envelope when a dependency is degraded", async () => {
    const degradedResponse: HealthResponse = {
      ...healthyResponse,
      status: "degraded",
      dependencies: {
        ...healthyResponse.dependencies,
        database: {
          status: "error",
          latencyMs: 1200,
          message: "database unavailable"
        }
      }
    };
    check.mockResolvedValue(degradedResponse);
    const response = mockResponse();

    const health = await controller.check(response.value);
    const envelope = await wrap(health);

    expect(response.status).toHaveBeenCalledWith(503);
    expect(envelope.data).toEqual(degradedResponse);
    expect(envelope.meta).toEqual({
      requestId: "health-test",
      timestamp: expect.any(String)
    });
  });

  function mockResponse() {
    const status = jest.fn().mockReturnThis();
    return {
      status,
      value: { status } as unknown as Response
    };
  }

  function wrap(health: HealthResponse) {
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ requestId: "health-test" })
      })
    } as unknown as ExecutionContext;
    const next = {
      handle: () => of(health)
    } as CallHandler<HealthResponse>;

    return firstValueFrom(interceptor.intercept(context, next));
  }
});
