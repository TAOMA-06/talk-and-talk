import { INestApplication, ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import request from "supertest";

import { AppModule } from "../src/app.module";
import { EnvelopeInterceptor } from "../src/common/envelope/envelope.interceptor";
import { HttpExceptionFilter } from "../src/common/errors/http-exception.filter";
import { buildCorsOptions } from "../src/config/cors";
import { PrismaService } from "../src/database/prisma.service";
import { seedDatabase } from "../src/database/seed";
import { grantCurrentLegalConsent } from "./legal-consent-fixture";

describe("Companions and me (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.API_PREFIX = "api/v1";
    process.env.CORS_ORIGINS = "http://localhost:3000";
    process.env.JWT_ACCESS_SECRET = "e2e-access-secret";
    process.env.JWT_REFRESH_SECRET = "e2e-refresh-secret";
    process.env.SMS_PROVIDER = "mock";

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    app.useGlobalInterceptors(new EnvelopeInterceptor());
    app.useGlobalFilters(new HttpExceptionFilter());
    app.enableCors(buildCorsOptions(app.get(ConfigService)));
    await app.init();

    prisma = moduleRef.get(PrismaService);
    jwt = moduleRef.get(JwtService);
  });

  beforeEach(async () => {
    await cleanup();
    await seedDatabase(prisma as any);
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  async function cleanup() {
    if (!prisma) return;
    await prisma.notification.deleteMany();
    await prisma.accountDeletionRequest.deleteMany();
    await prisma.refundTransaction.deleteMany();
    await prisma.paymentTransaction.deleteMany();
    await prisma.order.deleteMany();
    await prisma.messageReadState.deleteMany();
    await prisma.message.deleteMany();
    await prisma.conversation.deleteMany();
    await prisma.auditLog.deleteMany();
    await prisma.moderationLabel.deleteMany();
    await prisma.moderationActionLog.deleteMany();
    await prisma.moderationEvidence.deleteMany();
    await prisma.moderationCase.deleteMany();
    await prisma.companionServiceTag.deleteMany();
    await prisma.serviceTag.deleteMany();
    await prisma.companionProfile.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.verificationCode.deleteMany();
    await prisma.authIdentity.deleteMany();
    await prisma.userProfile.deleteMany();
    await prisma.user.deleteMany();
  }

  async function createUser(role: "user" | "admin" = "user") {
    const user = await prisma.user.create({
      data: {
        role,
        profile: {
          create: {
            displayName: role === "admin" ? "管理员" : "小楷",
            phone: role === "admin" ? "+8613800138001" : "+8613800138000",
            age: 22,
            gender: "male"
          }
        }
      }
    });
    if (role === "user") await grantCurrentLegalConsent(prisma, user.id);

    const token = jwt.sign(
      { sub: user.id, role },
      { secret: "e2e-access-secret", expiresIn: "15m" }
    );
    return { user, token };
  }

  it("returns seeded c1/c2/c3 from the public companion list", async () => {
    const response = await request(app.getHttpServer())
      .get("/api/v1/companions")
      .expect(200);

    const ids = response.body.data.items.map((item: { id: string }) => item.id);
    expect(ids).toEqual(expect.arrayContaining(["c1", "c2", "c3"]));
    expect(response.body.data.pagination.total).toBeGreaterThanOrEqual(3);
  });

  it("supports public filters", async () => {
    const response = await request(app.getHttpServer())
      .get("/api/v1/companions")
      .query({ tag: "心理学背景", availability: "online", isOnline: "true" })
      .expect(200);

    expect(response.body.data.items.map((item: { id: string }) => item.id)).toContain("c1");
    expect(response.body.data.items.every((item: { availability: string; isOnline: boolean }) => item.availability === "online" && item.isOnline)).toBe(true);
  });

  it("returns public details and hides unpublished companions", async () => {
    await request(app.getHttpServer())
      .get("/api/v1/companions/c1")
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.id).toBe("c1");
      });

    await prisma.companionProfile.update({
      where: { id: "c1" },
      data: { isPublished: false }
    });

    const response = await request(app.getHttpServer())
      .get("/api/v1/companions/c1")
      .expect(404);

    expect(response.body.error.code).toBe("COMPANION_NOT_FOUND");
  });

  it("allows admins to create, edit, publish and unpublish companions", async () => {
    const { token } = await createUser("admin");
    const { token: reviewerToken } = await createUser("admin");
    const { user: owner } = await createUser("user");

    await request(app.getHttpServer())
      .patch(`/api/v1/admin/users/${owner.id}/verification`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        isVerified: true,
        reason: "test identity review",
        evidenceReference: "kyc://test/c-admin-owner"
      })
      .expect(200);

    await request(app.getHttpServer())
      .post("/api/v1/admin/companions")
      .set("Authorization", `Bearer ${token}`)
      .send({
        id: "c-admin",
        ownerUserId: owner.id,
        name: "陆安",
        role: "测试陪伴者",
        initials: "LA",
        tags: ["测试"],
        rating: 4.5,
        reviewCount: 0,
        pricePerHalfHour: 30,
        isOnline: false,
        isVerified: true,
        bio: "仅用于测试。",
        availableTimes: ["20:00"],
        languages: ["中文"],
        specialties: ["情绪倾听"],
        completedOrders: 0,
        responseTime: "约1分钟",
        distanceKm: 0,
        availability: "available",
        cityDistrict: "平台内"
      })
      .expect(201);

    await request(app.getHttpServer())
      .patch("/api/v1/admin/companions/c-admin")
      .set("Authorization", `Bearer ${token}`)
      .send({ pricePerHalfHour: 35, tags: ["测试", "情绪倾听"] })
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.pricePerHalfHour).toBe(35);
        expect(body.data.tags).toEqual(expect.arrayContaining(["测试", "情绪倾听"]));
      });

    await request(app.getHttpServer())
      .post("/api/v1/admin/commercial/companions/c-admin/profile-submissions")
      .set("Authorization", `Bearer ${token}`)
      .send({
        settlementRecipientRef: "settlement://test/c-admin",
        settlementRecipientMasked: "测试账户（尾号 0001）",
        taxProfileRef: "tax://test/c-admin",
        identityEvidenceRef: "kyc://test/c-admin-owner",
        serviceAgreementVersion: "test-v1",
        serviceAgreementEvidenceRef: "agreement://test/c-admin/v1"
      })
      .expect(201);

    await request(app.getHttpServer())
      .post("/api/v1/admin/commercial/companions/c-admin/profile-verifications")
      .set("Authorization", `Bearer ${reviewerToken}`)
      .expect(201);

    await request(app.getHttpServer())
      .post("/api/v1/admin/companions/c-admin/publish")
      .set("Authorization", `Bearer ${token}`)
      .expect(201);

    await request(app.getHttpServer())
      .get("/api/v1/companions/c-admin")
      .expect(200);

    await request(app.getHttpServer())
      .post("/api/v1/admin/companions/c-admin/unpublish")
      .set("Authorization", `Bearer ${token}`)
      .expect(201);

    await request(app.getHttpServer())
      .get("/api/v1/companions/c-admin")
      .expect(404);
  });

  it("denies non-admin users from companion management", async () => {
    const { token } = await createUser("user");

    const response = await request(app.getHttpServer())
      .post("/api/v1/admin/companions/c1/unpublish")
      .set("Authorization", `Bearer ${token}`)
      .expect(403);

    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("gets and updates the current user through /me", async () => {
    const { token } = await createUser("user");

    await request(app.getHttpServer())
      .get("/api/v1/me")
      .set("Authorization", `Bearer ${token}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.profile.displayName).toBe("小楷");
      });

    await request(app.getHttpServer())
      .patch("/api/v1/me")
      .set("Authorization", `Bearer ${token}`)
      .send({
        displayName: "新的小楷",
        age: 23,
        gender: "male",
        role: "admin",
        safetyScore: 0
      })
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.role).toBe("user");
        expect(body.data.profile.displayName).toBe("新的小楷");
        expect(body.data.profile.age).toBe(23);
        expect(body.data.profile.safetyScore).toBe(80);
      });
  });
});
