import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";

import { AppModule } from "../src/app.module";
import { HttpExceptionFilter } from "../src/common/errors/http-exception.filter";
import { EnvelopeInterceptor } from "../src/common/envelope/envelope.interceptor";
import { buildCorsOptions } from "../src/config/cors";
import { HealthService } from "../src/health/health.service";
import { ConfigService } from "@nestjs/config";

describe("AppController (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.API_PREFIX = "api/v1";
    process.env.CORS_ORIGINS = "http://localhost:3000";

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    })
      .overrideProvider(HealthService)
      .useValue({
        check: jest.fn().mockResolvedValue({
          status: "ok",
          service: "talk-and-talk-api",
          version: "0.1.0",
          uptimeSeconds: 1,
          dependencies: {
            database: { status: "ok", latencyMs: 1 },
            redis: { status: "ok", latencyMs: 1 }
          }
        })
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    app.useGlobalInterceptors(new EnvelopeInterceptor());
    app.useGlobalFilters(new HttpExceptionFilter());
    app.enableCors(buildCorsOptions(app.get(ConfigService)));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("/api/v1/health (GET)", async () => {
    const response = await request(app.getHttpServer())
      .get("/api/v1/health")
      .set("x-request-id", "e2e-req")
      .expect(200);

    expect(response.body).toEqual({
      data: {
        status: "ok",
        service: "talk-and-talk-api",
        version: "0.1.0",
        uptimeSeconds: 1,
        dependencies: {
          database: { status: "ok", latencyMs: 1 },
          redis: { status: "ok", latencyMs: 1 }
        }
      },
      meta: {
        requestId: "e2e-req",
        timestamp: expect.any(String)
      }
    });
    expect(response.headers["x-request-id"]).toBe("e2e-req");
  });

  it("wraps missing routes in the error envelope", async () => {
    const response = await request(app.getHttpServer())
      .get("/api/v1/missing")
      .expect(404);

    expect(response.body.error.code).toBe("NOT_FOUND");
    expect(response.body.meta.requestId).toEqual(expect.any(String));
    expect(response.body.meta.timestamp).toEqual(expect.any(String));
  });

  it("generates a request id when one is not provided", async () => {
    const response = await request(app.getHttpServer())
      .get("/api/v1/health")
      .expect(200);

    expect(response.headers["x-request-id"]).toEqual(expect.any(String));
    expect(response.body.meta.requestId).toBe(response.headers["x-request-id"]);
  });

  it("allows configured CORS origins", async () => {
    const response = await request(app.getHttpServer())
      .options("/api/v1/health")
      .set("Origin", "http://localhost:3000")
      .set("Access-Control-Request-Method", "GET")
      .expect(204);

    expect(response.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    expect(response.headers["access-control-expose-headers"]).toContain("x-request-id");
  });

  it("rejects unconfigured CORS origins", async () => {
    const response = await request(app.getHttpServer())
      .options("/api/v1/health")
      .set("Origin", "https://evil.example")
      .set("Access-Control-Request-Method", "GET")
      .expect(404);

    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
