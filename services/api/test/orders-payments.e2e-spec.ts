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

describe("Orders and payments (e2e)", () => {
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
    process.env.WECHAT_PAY_APP_ID = "";
    process.env.WECHAT_PAY_MCH_ID = "";

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

  async function createUser() {
    const user = await prisma.user.create({
      data: {
        role: "user",
        profile: {
          create: {
            displayName: "小楷",
            phone: "+8613800138000",
            age: 22,
            gender: "female",
            isVerified: true
          }
        }
      }
    });

    const token = jwt.sign(
      { sub: user.id, role: "user" },
      { secret: "e2e-access-secret", expiresIn: "15m" }
    );
    return { user, token };
  }

  it("creates order, mock pays, and activates conversation once", async () => {
    const { token } = await createUser();

    const createRes = await request(app.getHttpServer())
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${token}`)
      .send({ companionId: "c1", themeId: "t1", durationMinutes: 30 })
      .expect(201);

    const orderId = createRes.body.data.id;
    expect(createRes.body.data.status).toBe("pending");
    expect(createRes.body.data.amountCents).toBe(3900);

    const prepayRes = await request(app.getHttpServer())
      .post(`/api/v1/orders/${orderId}/prepay`)
      .set("Authorization", `Bearer ${token}`)
      .expect(201);

    expect(prepayRes.body.data.order.status).toBe("paying");
    expect(prepayRes.body.data.payment.mock).toBe(true);
    const outTradeNo = prepayRes.body.data.payment.outTradeNo as string;

    const payRes = await request(app.getHttpServer())
      .post("/api/v1/payments/wechat/mock-notify")
      .set("Authorization", `Bearer ${token}`)
      .send({ outTradeNo })
      .expect(201);

    expect(payRes.body.data.code).toBe("SUCCESS");
    expect(payRes.body.data.data.orderStatus).toBe("paid");

    const getRes = await request(app.getHttpServer())
      .get(`/api/v1/orders/${orderId}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(getRes.body.data.status).toBe("paid");
    expect(getRes.body.data.conversationId).toBe("c1");

    const conversations = await request(app.getHttpServer())
      .get("/api/v1/conversations")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(conversations.body.data.conversations.length).toBe(1);

    // Duplicate notify must not create a second conversation
    await request(app.getHttpServer())
      .post("/api/v1/payments/wechat/mock-notify")
      .set("Authorization", `Bearer ${token}`)
      .send({ outTradeNo })
      .expect(201);

    const conversationsAgain = await request(app.getHttpServer())
      .get("/api/v1/conversations")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(conversationsAgain.body.data.conversations.length).toBe(1);

    const payments = await prisma.paymentTransaction.findMany({ where: { orderId } as any } as any);
    const successPayments = payments.filter((p: any) => p.status === "success");
    expect(successPayments).toHaveLength(1);

    const messages = await prisma.message.findMany({} as any);
    const systemMsgs = messages.filter((m: any) => m.type === "system");
    expect(systemMsgs).toHaveLength(1);
  });

  it("rejects amount mismatch on mock notify", async () => {
    const { token } = await createUser();

    const createRes = await request(app.getHttpServer())
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${token}`)
      .send({ companionId: "c1", themeId: "t1", durationMinutes: 30 })
      .expect(201);

    const orderId = createRes.body.data.id;

    const prepayRes = await request(app.getHttpServer())
      .post(`/api/v1/orders/${orderId}/prepay`)
      .set("Authorization", `Bearer ${token}`)
      .expect(201);

    const outTradeNo = prepayRes.body.data.payment.outTradeNo as string;

    await request(app.getHttpServer())
      .post("/api/v1/payments/wechat/mock-notify")
      .set("Authorization", `Bearer ${token}`)
      .send({ outTradeNo, amountCents: 1 })
      .expect(400);

    const getRes = await request(app.getHttpServer())
      .get(`/api/v1/orders/${orderId}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(getRes.body.data.status).toBe("paying");
  });

  it("cancels a pending order", async () => {
    const { token } = await createUser();

    const createRes = await request(app.getHttpServer())
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${token}`)
      .send({ companionId: "c2", themeId: "t2", durationMinutes: 60 })
      .expect(201);

    const orderId = createRes.body.data.id;

    const cancelRes = await request(app.getHttpServer())
      .post(`/api/v1/orders/${orderId}/cancel`)
      .set("Authorization", `Bearer ${token}`)
      .expect(201);

    expect(cancelRes.body.data.status).toBe("cancelled");
  });
});
