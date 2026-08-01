import { INestApplication, ValidationPipe } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import request from "supertest";

import { AppModule } from "../src/app.module";
import { EnvelopeInterceptor } from "../src/common/envelope/envelope.interceptor";
import { HttpExceptionFilter } from "../src/common/errors/http-exception.filter";
import { PrismaService } from "../src/database/prisma.service";
import { HealthService } from "../src/health/health.service";
import { issueSessionBoundAccessToken } from "./session-token-fixture";

describe("Legal consent receipts (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let accessToken: string;
  let userId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.APP_ENV = "development";
    process.env.API_PREFIX = "api/v1";
    process.env.CORS_ORIGINS = "http://localhost:3000";
    process.env.JWT_ACCESS_SECRET = "e2e-access-secret";
    process.env.JWT_REFRESH_SECRET = "e2e-refresh-secret";
    process.env.SMS_PROVIDER = "mock";

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(HealthService)
      .useValue({ check: jest.fn().mockResolvedValue({ status: "ok" }) })
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    app.useGlobalInterceptors(new EnvelopeInterceptor());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    prisma = moduleRef.get(PrismaService);
    const user = await prisma.user.create({ data: { role: "user" } });
    userId = user.id;
    accessToken = await issueSessionBoundAccessToken(
      prisma,
      moduleRef.get(JwtService),
      user
    );
  });

  afterAll(async () => {
    await prisma.legalConsentReceipt.deleteMany({ where: { userId } });
    await prisma.auditLog.deleteMany({ where: { actorId: userId } });
    await prisma.refreshToken.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await app.close();
  });

  const consent = {
    version: "2.2-2026-08-01",
    acceptedAt: new Date(Date.now() - 60_000).toISOString(),
    privacyAccepted: true,
    termsAccepted: true,
    adultConfirmed: true,
    privacyUrl: "https://api.talkandtalk.app/legal/privacy.html",
    termsUrl: "https://api.talkandtalk.app/legal/terms.html",
    source: "wechatMiniProgram"
  };

  it("requires JWT authentication", async () => {
    await request(app.getHttpServer())
      .get("/api/v1/users/me/legal-consents")
      .expect(401);
  });

  it("validates literal consent and HTTPS document URLs", async () => {
    await request(app.getHttpServer())
      .post("/api/v1/users/me/legal-consents")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ ...consent, privacyAccepted: false })
      .expect(400);
  });

  it("blocks authenticated business APIs until current consent is recorded", async () => {
    const blocked = await request(app.getHttpServer())
      .get("/api/v1/me")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(403);
    expect(blocked.body.error.code).toBe("LEGAL_CONSENT_REQUIRED");
  });

  it("records the current server-published version idempotently and rejects forged documents", async () => {
    const first = await request(app.getHttpServer())
      .post("/api/v1/users/me/legal-consents")
      .set("Authorization", `Bearer ${accessToken}`)
      .send(consent)
      .expect(201);

    expect(first.body.data.receipt).toEqual(expect.objectContaining({
      userId,
      version: consent.version,
      privacyVersion: consent.version,
      termsVersion: consent.version,
      acceptedAt: consent.acceptedAt,
      source: "wechatMiniProgram"
    }));
    expect(Date.parse(first.body.data.receipt.recordedAt)).toBeGreaterThan(Date.parse(consent.acceptedAt));

    const duplicate = await request(app.getHttpServer())
      .post("/api/v1/users/me/legal-consents")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ ...consent, acceptedAt: new Date(Date.now() - 30_000).toISOString() })
      .expect(201);

    expect(duplicate.body.data.receipt.id).toBe(first.body.data.receipt.id);
    expect(duplicate.body.data.receipt.acceptedAt).toBe(consent.acceptedAt);

    await request(app.getHttpServer())
      .post("/api/v1/users/me/legal-consents")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ ...consent, version: "2.0-2026-08-01" })
      .expect(400);

    await request(app.getHttpServer())
      .post("/api/v1/users/me/legal-consents")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ ...consent, privacyUrl: "https://attacker.example/privacy" })
      .expect(400);

    await expect(prisma.legalConsentReceipt.count({ where: { userId } })).resolves.toBe(1);
    await expect(prisma.auditLog.count({
      where: { actorId: userId, action: { in: ["legal.consent_recorded", "legal.consent_upgraded"] } }
    })).resolves.toBe(1);

    const current = await request(app.getHttpServer())
      .get(`/api/v1/users/me/legal-consents?version=${consent.version}`)
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);
    expect(current.body.data).toEqual(expect.objectContaining({
      valid: true,
      receipt: expect.objectContaining({ id: first.body.data.receipt.id })
    }));

    await request(app.getHttpServer())
      .get("/api/v1/me")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);

    const withdrawn = await request(app.getHttpServer())
      .delete("/api/v1/users/me/legal-consents/current")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);
    expect(withdrawn.body.data).toEqual(expect.objectContaining({ withdrawn: true }));

    await request(app.getHttpServer())
      .get(`/api/v1/users/me/legal-consents?version=${consent.version}`)
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(401);
    await request(app.getHttpServer())
      .get("/api/v1/me")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(401);

    const storedAfterWithdrawal = await prisma.legalConsentReceipt.findFirstOrThrow({
      where: { userId, version: consent.version },
      orderBy: [{ consentedAt: "desc" }, { id: "desc" }]
    });
    expect(storedAfterWithdrawal.withdrawnAt).not.toBeNull();

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    accessToken = await issueSessionBoundAccessToken(
      prisma,
      app.get(JwtService),
      user
    );

    const afterWithdrawal = await request(app.getHttpServer())
      .get(`/api/v1/users/me/legal-consents?version=${consent.version}`)
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);
    expect(afterWithdrawal.body.data.valid).toBe(false);
    expect(afterWithdrawal.body.data.receipt.withdrawnAt).not.toBeNull();
    await request(app.getHttpServer())
      .get("/api/v1/me")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(403);

    const reaccepted = await request(app.getHttpServer())
      .post("/api/v1/users/me/legal-consents")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ ...consent, acceptedAt: new Date().toISOString() })
      .expect(201);
    expect(reaccepted.body.data.receipt.id).not.toBe(first.body.data.receipt.id);
    await request(app.getHttpServer())
      .get("/api/v1/me")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);

    const missing = await request(app.getHttpServer())
      .get("/api/v1/users/me/legal-consents?version=missing")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);
    expect(missing.body.data).toEqual({ valid: false, receipt: null });
  });
});
