import { ConfigService } from "@nestjs/config";

import { MetricsController } from "./metrics.controller";
import { MetricsService } from "./metrics.service";

function config(appEnv: string): ConfigService {
  return {
    getOrThrow: jest.fn((key: string) => ({
      APP_ENV: appEnv,
      APP_VERSION: "1.2.3",
      METRICS_TOKEN: "m".repeat(32)
    })[key])
  } as unknown as ConfigService;
}

describe("MetricsController", () => {
  it("allows development metrics without a token", () => {
    const controller = new MetricsController(new MetricsService(), config("development"));
    expect(controller.prometheus()).toContain("talk_http_requests_total");
  });

  it("requires the production bearer token", () => {
    const controller = new MetricsController(new MetricsService(), config("production"));
    expect(() => controller.prometheus()).toThrow("Metrics authentication required");
    expect(() => controller.prometheus("Bearer wrong")).toThrow("Metrics authentication required");
    expect(controller.prometheus(`Bearer ${"m".repeat(32)}`)).toContain("talk_http_requests_total");
  });
});
