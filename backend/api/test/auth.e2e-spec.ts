import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";

import { AppModule } from "../src/app.module";
import { HttpExceptionFilter } from "../src/common/errors/http-exception.filter";
import { EnvelopeInterceptor } from "../src/common/envelope/envelope.interceptor";
import { buildCorsOptions } from "../src/config/cors";
import { ConfigService } from "@nestjs/config";
import { HealthService } from "../src/health/health.service";
import { PrismaService } from "../src/database/prisma.service";
import { SMS_PROVIDER } from "../src/auth/sms/sms-provider.interface";
import { MockSmsProvider } from "../src/auth/sms/mock-sms.provider";
import { encryptTotpSecret } from "../src/auth/staff-auth.crypto";
import * as bcrypt from "bcrypt";
import { grantCurrentLegalConsent } from "./legal-consent-fixture";

describe("Auth (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let smsProvider: MockSmsProvider;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.API_PREFIX = "api/v1";
    process.env.CORS_ORIGINS = "http://localhost:3000";
    process.env.JWT_ACCESS_SECRET = "e2e-access-secret";
    process.env.JWT_REFRESH_SECRET = "e2e-refresh-secret";
    process.env.JWT_ACCESS_TTL = "15m";
    process.env.JWT_REFRESH_TTL = "30d";
    process.env.SMS_PROVIDER = "mock";
    process.env.STAFF_TOTP_ENCRYPTION_KEY = "e2e-staff-totp-encryption-key-32-characters";

    const mockSms = new MockSmsProvider();

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    })
      .overrideProvider(HealthService)
      .useValue({ check: jest.fn().mockResolvedValue({ status: "ok" }) })
      .overrideProvider(SMS_PROVIDER)
      .useValue(mockSms)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    app.useGlobalInterceptors(new EnvelopeInterceptor());
    app.useGlobalFilters(new HttpExceptionFilter());
    app.enableCors(buildCorsOptions(app.get(ConfigService)));
    await app.init();

    prisma = moduleRef.get(PrismaService);
    smsProvider = mockSms;
  });

  beforeEach(async () => {
    await prisma.notification.deleteMany();
    await prisma.identityVerificationRequest.deleteMany();
    await prisma.accountDeletionRequest.deleteMany();
    await prisma.refundTransaction.deleteMany();
    await prisma.paymentTransaction.deleteMany();
    await prisma.order.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.messageReadState.deleteMany();
    await prisma.message.deleteMany();
    await prisma.conversation.deleteMany();
    await prisma.auditLog.deleteMany();
    await prisma.moderationLabel.deleteMany();
    await prisma.moderationActionLog.deleteMany();
    await prisma.moderationEvidence.deleteMany();
    await prisma.moderationCase.deleteMany();
    await prisma.verificationCode.deleteMany();
    await prisma.staffCredential.deleteMany();
    await prisma.authIdentity.deleteMany();
    await prisma.userProfile.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.notification.deleteMany();
    await prisma.identityVerificationRequest.deleteMany();
    await prisma.accountDeletionRequest.deleteMany();
    await prisma.refundTransaction.deleteMany();
    await prisma.paymentTransaction.deleteMany();
    await prisma.order.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.messageReadState.deleteMany();
    await prisma.message.deleteMany();
    await prisma.conversation.deleteMany();
    await prisma.auditLog.deleteMany();
    await prisma.moderationLabel.deleteMany();
    await prisma.moderationActionLog.deleteMany();
    await prisma.moderationEvidence.deleteMany();
    await prisma.moderationCase.deleteMany();
    await prisma.verificationCode.deleteMany();
    await prisma.staffCredential.deleteMany();
    await prisma.authIdentity.deleteMany();
    await prisma.userProfile.deleteMany();
    await prisma.user.deleteMany();
    await app.close();
  });

  const phone = "13800138000";

  async function sendCodeAndGetCode() {
    await request(app.getHttpServer())
      .post("/api/v1/auth/sms/send-code")
      .send({ phone })
      .expect(201);

    return smsProvider.getLastCode()!.code;
  }

  async function loginAndGetTokens() {
    const code = await sendCodeAndGetCode();
    const res = await request(app.getHttpServer())
      .post("/api/v1/auth/phone/login")
      .send({ phone, code })
      .expect(201);
    await grantCurrentLegalConsent(prisma, res.body.data.user.id);
    return res.body.data;
  }

  describe("POST /auth/sms/send-code", () => {
    it("should send a code successfully", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/auth/sms/send-code")
        .send({ phone })
        .expect(201);

      expect(res.body.data.expiresInSeconds).toBe(300);
    });

    it("should rate-limit repeated sends", async () => {
      await request(app.getHttpServer())
        .post("/api/v1/auth/sms/send-code")
        .send({ phone })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post("/api/v1/auth/sms/send-code")
        .send({ phone })
        .expect(429);

      expect(res.body.error.code).toBe("RATE_LIMITED");
    });
  });

  describe("POST /auth/phone/login", () => {
    it("should return tokens and user on valid code", async () => {
      const data = await loginAndGetTokens();

      expect(data.accessToken).toBeDefined();
      expect(data.refreshToken).toBeDefined();
      expect(data.expiresIn).toBeGreaterThan(0);
      expect(data.user.id).toBeDefined();
      expect(data.user.role).toBe("user");
      expect(data.user.profile).toBeDefined();
    });

    it("should reject invalid code", async () => {
      await sendCodeAndGetCode();

      const res = await request(app.getHttpServer())
        .post("/api/v1/auth/phone/login")
        .send({ phone, code: "000000" })
        .expect(401);

      expect(res.body.error.code).toBe("INVALID_VERIFICATION_CODE");
    });
  });

  describe("POST /auth/staff/login", () => {
    it("logs a provisioned staff member in with password and TOTP", async () => {
      const password = "Correct-Horse-Battery-9!";
      const totpKey = process.env.STAFF_TOTP_ENCRYPTION_KEY!;
      await prisma.user.create({
        data: {
          role: "admin",
          accountStatus: "active",
          profile: { create: { displayName: "Ops Admin", isVerified: true } },
          staffCredential: {
            create: {
              username: "ops-admin",
              passwordHash: await bcrypt.hash(password, 4),
              totpSecretCiphertext: encryptTotpSecret("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", totpKey)
            }
          }
        }
      });
      const dateSpy = jest.spyOn(Date, "now").mockReturnValue(59_000);

      const response = await request(app.getHttpServer())
        .post("/api/v1/auth/staff/login")
        .send({ username: "OPS-ADMIN", password, totpCode: "287082" })
        .expect(201);

      expect(response.body.data.user.role).toBe("admin");
      expect(response.body.data.accessToken).toBeDefined();

      const replay = await request(app.getHttpServer())
        .post("/api/v1/auth/staff/login")
        .send({ username: "ops-admin", password, totpCode: "287082" })
        .expect(401);
      expect(replay.body.error.code).toBe("STAFF_LOGIN_FAILED");
      dateSpy.mockRestore();
    });
  });

  describe("GET /users/me", () => {
    it("should return current user", async () => {
      const tokens = await loginAndGetTokens();

      const res = await request(app.getHttpServer())
        .get("/api/v1/users/me")
        .set("Authorization", `Bearer ${tokens.accessToken}`)
        .expect(200);

      expect(res.body.data.id).toBe(tokens.user.id);
    });

    it("should reject unauthenticated request", async () => {
      await request(app.getHttpServer())
        .get("/api/v1/users/me")
        .expect(401);
    });
  });

  describe("POST /auth/refresh", () => {
    it("should issue new token pair", async () => {
      const tokens = await loginAndGetTokens();

      const res = await request(app.getHttpServer())
        .post("/api/v1/auth/refresh")
        .send({ refreshToken: tokens.refreshToken })
        .expect(201);

      expect(res.body.data.accessToken).toBeDefined();
      expect(res.body.data.refreshToken).toBeDefined();
      expect(res.body.data.accessToken).not.toBe(tokens.accessToken);
    });

    it("should reject reused refresh token", async () => {
      const tokens = await loginAndGetTokens();

      await request(app.getHttpServer())
        .post("/api/v1/auth/refresh")
        .send({ refreshToken: tokens.refreshToken })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post("/api/v1/auth/refresh")
        .send({ refreshToken: tokens.refreshToken })
        .expect(401);

      expect(res.body.error.code).toBe("UNAUTHORIZED");
    });
  });

  describe("POST /auth/logout", () => {
    it("should revoke refresh token", async () => {
      const tokens = await loginAndGetTokens();

      await request(app.getHttpServer())
        .post("/api/v1/auth/logout")
        .set("Authorization", `Bearer ${tokens.accessToken}`)
        .send({ refreshToken: tokens.refreshToken })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post("/api/v1/auth/refresh")
        .send({ refreshToken: tokens.refreshToken })
        .expect(401);

      expect(res.body.error.code).toBe("UNAUTHORIZED");
    });
  });

  describe("RBAC", () => {
    it("should deny non-admin user from admin endpoints", async () => {
      const tokens = await loginAndGetTokens();

      const res = await request(app.getHttpServer())
        .get("/api/v1/admin/status")
        .set("Authorization", `Bearer ${tokens.accessToken}`)
        .expect(403);

      expect(res.body.error.code).toBe("FORBIDDEN");
    });
  });
});
