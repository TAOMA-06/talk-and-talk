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

describe("Notifications and security (e2e)", () => {
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
    process.env.RATE_LIMIT_PER_MINUTE = "1000";

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();

    app = moduleRef.createNestApplication({ rawBody: true });
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
            gender: "female",
            isVerified: true
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

  it("lists notifications, marks read and read-all", async () => {
    const { user, token } = await createUser();
    await prisma.notification.createMany({
      data: [
        {
          userId: user.id,
          type: "paymentSuccess",
          title: "支付成功",
          body: "订单已支付"
        },
        {
          userId: user.id,
          type: "orderStatus",
          title: "订单更新",
          body: "订单已取消"
        }
      ]
    } as any);

    const list = await request(app.getHttpServer())
      .get("/api/v1/notifications")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(list.body.data.items).toHaveLength(2);

    const id = list.body.data.items[0].id as string;
    await request(app.getHttpServer())
      .post(`/api/v1/notifications/${id}/read`)
      .set("Authorization", `Bearer ${token}`)
      .expect(201);

    const unread = await request(app.getHttpServer())
      .get("/api/v1/notifications/unread-count")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(unread.body.data.count).toBe(1);

    await request(app.getHttpServer())
      .post("/api/v1/notifications/read-all")
      .set("Authorization", `Bearer ${token}`)
      .expect(201);

    const unreadAfter = await request(app.getHttpServer())
      .get("/api/v1/notifications/unread-count")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(unreadAfter.body.data.count).toBe(0);
  });

  it("forbids plain user from admin routes", async () => {
    const { token } = await createUser("user");
    await request(app.getHttpServer())
      .get("/api/v1/admin/status")
      .set("Authorization", `Bearer ${token}`)
      .expect(403);
  });

  it("invalidates an existing access token immediately after an account is banned", async () => {
    const { user, token } = await createUser("user");
    await prisma.user.update({ where: { id: user.id }, data: { accountStatus: "banned" } });

    const response = await request(app.getHttpServer())
      .get("/api/v1/notifications")
      .set("Authorization", `Bearer ${token}`)
      .expect(403);
    expect(response.body.error.code).toBe("ACCOUNT_BANNED");
  });

  it("writes audit log on account deletion request", async () => {
    const { user, token } = await createUser();
    const res = await request(app.getHttpServer())
      .post("/api/v1/me/deletion-request")
      .set("Authorization", `Bearer ${token}`)
      .expect(201);

    expect(res.body.data.status).toBe("pending");
    expect(res.body.data.message).toContain("注销");

    const logs = await prisma.auditLog.findMany({
      where: { actorId: user.id, action: "account.deletion_requested" }
    } as any);
    expect(logs.length).toBeGreaterThanOrEqual(1);
  });

  it("rate-limits SMS send-code by phone", async () => {
    const first = await request(app.getHttpServer())
      .post("/api/v1/auth/sms/send-code")
      .send({ phone: "13800138099" })
      .expect(201);
    expect(first.body.data.expiresInSeconds).toBeGreaterThan(0);

    await request(app.getHttpServer())
      .post("/api/v1/auth/sms/send-code")
      .send({ phone: "13800138099" })
      .expect(429);
  });
});
