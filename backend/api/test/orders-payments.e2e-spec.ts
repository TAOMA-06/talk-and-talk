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
import {
  WECHAT_PAY_PROVIDER,
  WeChatPayProvider
} from "../src/payments/wechat/wechat-pay.provider";
import { PaymentsService } from "../src/payments/payments.service";

describe("Orders and payments (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let wechat: WeChatPayProvider;
  let paymentsService: PaymentsService;
  let ownerSequence = 0;

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
    wechat = moduleRef.get(WECHAT_PAY_PROVIDER);
    paymentsService = moduleRef.get(PaymentsService);
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

  async function createUser(
    phone = "+8613800138000",
    role: "user" | "companion" | "moderator" | "admin" = "user"
  ) {
    const user = await prisma.user.create({
      data: {
        role,
        profile: {
          create: {
            displayName: "小楷",
            phone,
            age: 22,
            gender: "female",
            isVerified: true
          }
        }
      }
    });
    await prisma.legalConsentReceipt.create({
      data: {
        userId: user.id,
        version: "1.0-2026-07-19",
        privacyVersion: "1.0-2026-07-19",
        termsVersion: "1.0-2026-07-19",
        privacyAccepted: true,
        termsAccepted: true,
        adultConfirmed: true,
        acceptedAt: new Date(),
        privacyUrl: "https://api.talkandtalk.app/legal/privacy.html",
        termsUrl: "https://api.talkandtalk.app/legal/terms.html",
        source: "wechatMiniProgram"
      }
    });

    const token = jwt.sign(
      { sub: user.id, role },
      { secret: "e2e-access-secret", expiresIn: "15m" }
    );
    return { user, token };
  }

  function futureScheduledAt(): string {
    return new Date(Date.now() + 60 * 60 * 1000).toISOString();
  }

  async function confirmOrderForPayment(orderId: string): Promise<void> {
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    const companion = await prisma.companionProfile.findUniqueOrThrow({ where: { id: order.companionId } });
    if (!companion.ownerUserId) {
      ownerSequence += 1;
      const owner = await prisma.user.create({
        data: {
          role: "companion",
          profile: { create: { displayName: `测试陪伴者${ownerSequence}`, isVerified: true } }
        }
      });
      await prisma.companionProfile.update({
        where: { id: companion.id },
        data: { ownerUserId: owner.id }
      });
    }
    await prisma.order.update({
      where: { id: orderId },
      data: { companionConfirmedAt: new Date() }
    });
  }

  it("creates order, mock pays, and activates conversation once", async () => {
    const { token } = await createUser();

    const createRes = await request(app.getHttpServer())
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${token}`)
      .send({ companionId: "c1", themeId: "t1", durationMinutes: 30, scheduledAt: futureScheduledAt() })
      .expect(201);

    const orderId = createRes.body.data.id;
    expect(createRes.body.data.status).toBe("pending");
    expect(createRes.body.data.amountCents).toBe(3900);
    await confirmOrderForPayment(orderId);

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
      .send({ companionId: "c1", themeId: "t1", durationMinutes: 30, scheduledAt: futureScheduledAt() })
      .expect(201);

    const orderId = createRes.body.data.id;
    await confirmOrderForPayment(orderId);

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

  it("rejects prepay after the confirmed payment window has expired", async () => {
    const { token } = await createUser("+8613800138008");
    const order = await request(app.getHttpServer())
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${token}`)
      .send({ companionId: "c1", themeId: "t1", durationMinutes: 30, scheduledAt: futureScheduledAt() })
      .expect(201);
    await confirmOrderForPayment(order.body.data.id);
    await prisma.order.update({
      where: { id: order.body.data.id },
      data: { scheduledAt: new Date(Date.now() + 4 * 60 * 1000) }
    });

    const prepay = await request(app.getHttpServer())
      .post(`/api/v1/orders/${order.body.data.id}/prepay`)
      .set("Authorization", `Bearer ${token}`)
      .expect(409);

    expect(prepay.body.error.code).toBe("ORDER_PAYMENT_WINDOW_EXPIRED");
    expect(await prisma.paymentTransaction.count({ where: { orderId: order.body.data.id } })).toBe(0);
  });

  it("requires at least a full minute of usable prepay time before the payment cutoff", async () => {
    const { token } = await createUser("+8613800138011");
    const order = await request(app.getHttpServer())
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${token}`)
      .send({ companionId: "c1", themeId: "t1", durationMinutes: 30, scheduledAt: futureScheduledAt() })
      .expect(201);
    await confirmOrderForPayment(order.body.data.id);
    await prisma.order.update({
      where: { id: order.body.data.id },
      data: { scheduledAt: new Date(Date.now() + 5 * 60 * 1000 + 30 * 1000) }
    });

    const prepay = await request(app.getHttpServer())
      .post(`/api/v1/orders/${order.body.data.id}/prepay`)
      .set("Authorization", `Bearer ${token}`)
      .expect(409);

    expect(prepay.body.error.code).toBe("ORDER_PAYMENT_WINDOW_EXPIRED");
  });

  it("automatically refunds a successful callback received after the service window", async () => {
    const { token } = await createUser("+8613800138009");
    const order = await request(app.getHttpServer())
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${token}`)
      .send({ companionId: "c1", themeId: "t1", durationMinutes: 30, scheduledAt: futureScheduledAt() })
      .expect(201);
    await confirmOrderForPayment(order.body.data.id);
    const prepay = await request(app.getHttpServer())
      .post(`/api/v1/orders/${order.body.data.id}/prepay`)
      .set("Authorization", `Bearer ${token}`)
      .expect(201);
    await prisma.order.update({
      where: { id: order.body.data.id },
      data: { scheduledAt: new Date(Date.now() - 31 * 60 * 1000) }
    });

    await request(app.getHttpServer())
      .post("/api/v1/payments/wechat/mock-notify")
      .set("Authorization", `Bearer ${token}`)
      .send({ outTradeNo: prepay.body.data.payment.outTradeNo })
      .expect(201);

    const persisted = await prisma.order.findUniqueOrThrow({ where: { id: order.body.data.id } });
    const refunds = await prisma.refundTransaction.findMany({ where: { orderId: order.body.data.id } });
    expect(persisted.status).toBe("refunded");
    expect(refunds).toHaveLength(1);
    expect(refunds[0].status).toBe("success");
  });

  it("recovers a successful payment when the callback was missed", async () => {
    const { token } = await createUser("+8613800138010");
    const order = await request(app.getHttpServer())
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${token}`)
      .send({ companionId: "c1", themeId: "t1", durationMinutes: 30, scheduledAt: futureScheduledAt() })
      .expect(201);
    await confirmOrderForPayment(order.body.data.id);
    await request(app.getHttpServer())
      .post(`/api/v1/orders/${order.body.data.id}/prepay`)
      .set("Authorization", `Bearer ${token}`)
      .expect(201);

    const sync = await request(app.getHttpServer())
      .post(`/api/v1/orders/${order.body.data.id}/payment/sync`)
      .set("Authorization", `Bearer ${token}`)
      .expect(201);

    expect(sync.body.data.code).toBe("SUCCESS");
    const persisted = await prisma.order.findUniqueOrThrow({ where: { id: order.body.data.id } });
    expect(persisted.status).toBe("paid");
  });

  it("creates only one WeChat refund for concurrent full-refund requests", async () => {
    const { token } = await createUser("+8613800138007");
    const order = await request(app.getHttpServer())
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${token}`)
      .send({ companionId: "c1", themeId: "t1", durationMinutes: 30, scheduledAt: futureScheduledAt() })
      .expect(201);
    await confirmOrderForPayment(order.body.data.id);
    const prepay = await request(app.getHttpServer())
      .post(`/api/v1/orders/${order.body.data.id}/prepay`)
      .set("Authorization", `Bearer ${token}`)
      .expect(201);
    await request(app.getHttpServer())
      .post("/api/v1/payments/wechat/mock-notify")
      .set("Authorization", `Bearer ${token}`)
      .send({ outTradeNo: prepay.body.data.payment.outTradeNo })
      .expect(201);
    const createRefund = jest.spyOn(wechat, "createRefund");

    const results = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/v1/orders/${order.body.data.id}/refund`)
        .set("Authorization", `Bearer ${token}`)
        .send({ reason: "用户申请" }),
      request(app.getHttpServer())
        .post(`/api/v1/orders/${order.body.data.id}/refund`)
        .set("Authorization", `Bearer ${token}`)
        .send({ reason: "重复提交" })
    ]);

    expect(results.map((result) => result.status)).toEqual([201, 201]);
    expect(results[0].body.data.refund.outRefundNo).toBe(results[1].body.data.refund.outRefundNo);
    expect(createRefund).toHaveBeenCalledTimes(1);
    const refunds = await prisma.refundTransaction.findMany({
      where: { orderId: order.body.data.id }
    });
    expect(refunds).toHaveLength(1);
    expect(refunds[0].status).toBe("success");
    createRefund.mockRestore();
  });

  it("serializes concurrent refund approvals and rejection without a second provider submission", async () => {
    const customer = await createUser("+8613800138012");
    const moderator = await createUser("+8613800138013", "moderator");
    const order = await request(app.getHttpServer())
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${customer.token}`)
      .send({ companionId: "c1", themeId: "t1", durationMinutes: 30, scheduledAt: futureScheduledAt() })
      .expect(201);
    await confirmOrderForPayment(order.body.data.id);
    const prepay = await request(app.getHttpServer())
      .post(`/api/v1/orders/${order.body.data.id}/prepay`)
      .set("Authorization", `Bearer ${customer.token}`)
      .expect(201);
    await request(app.getHttpServer())
      .post("/api/v1/payments/wechat/mock-notify")
      .set("Authorization", `Bearer ${customer.token}`)
      .send({ outTradeNo: prepay.body.data.payment.outTradeNo })
      .expect(201);
    await prisma.order.update({
      where: { id: order.body.data.id },
      data: { status: "completed", completedAt: new Date() }
    });
    const requested = await request(app.getHttpServer())
      .post(`/api/v1/orders/${order.body.data.id}/refund`)
      .set("Authorization", `Bearer ${customer.token}`)
      .send({ reason: "服务售后" })
      .expect(201);
    const refundId = requested.body.data.refund.id as string;
    expect(requested.body.data.refund.status).toBe("pendingReview");
    const createRefund = jest.spyOn(wechat, "createRefund");

    const results = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/v1/payments/refunds/${refundId}/approve`)
        .set("Authorization", `Bearer ${moderator.token}`)
        .send({ note: "同意退款" }),
      request(app.getHttpServer())
        .post(`/api/v1/payments/refunds/${refundId}/approve`)
        .set("Authorization", `Bearer ${moderator.token}`)
        .send({ note: "重复同意" }),
      request(app.getHttpServer())
        .post(`/api/v1/payments/refunds/${refundId}/reject`)
        .set("Authorization", `Bearer ${moderator.token}`)
        .send({ note: "竞态拒绝" })
    ]);

    expect(results.filter((result) => result.status === 201).length).toBeGreaterThanOrEqual(1);
    const persisted = await prisma.refundTransaction.findUniqueOrThrow({ where: { id: refundId } });
    expect(["success", "rejected"]).toContain(persisted.status);
    expect(createRefund).toHaveBeenCalledTimes(persisted.status === "success" ? 1 : 0);
    expect(persisted.status).not.toBe("pending");
    expect(persisted.status).not.toBe("processing");
    createRefund.mockRestore();
  });

  it("never downgrades a successful refund when the provider response later times out", async () => {
    const customer = await createUser("+8613800138016");
    const order = await request(app.getHttpServer())
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${customer.token}`)
      .send({ companionId: "c1", themeId: "t1", durationMinutes: 30, scheduledAt: futureScheduledAt() })
      .expect(201);
    await confirmOrderForPayment(order.body.data.id);
    const prepay = await request(app.getHttpServer())
      .post(`/api/v1/orders/${order.body.data.id}/prepay`)
      .set("Authorization", `Bearer ${customer.token}`)
      .expect(201);
    await request(app.getHttpServer())
      .post("/api/v1/payments/wechat/mock-notify")
      .set("Authorization", `Bearer ${customer.token}`)
      .send({ outTradeNo: prepay.body.data.payment.outTradeNo })
      .expect(201);

    const provider = jest.spyOn(wechat, "createRefund").mockImplementationOnce(async (input) => {
      const refund = await prisma.refundTransaction.findUniqueOrThrow({
        where: { outRefundNo: input.outRefundNo }
      });
      await (paymentsService as any).applyRefundResult(refund.id, "SUCCESS", "wx_refund_race");
      throw new Error("response timed out after WeChat accepted the refund");
    });
    await request(app.getHttpServer())
      .post(`/api/v1/orders/${order.body.data.id}/refund`)
      .set("Authorization", `Bearer ${customer.token}`)
      .send({ reason: "退款回调先到" })
      .expect(500);

    const refund = await prisma.refundTransaction.findFirstOrThrow({
      where: { orderId: order.body.data.id }
    });
    const persistedOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.body.data.id } });
    expect(refund.status).toBe("success");
    expect(refund.failureReason).toBeNull();
    expect(persistedOrder.status).toBe("refunded");
    provider.mockRestore();
  });

  it("rejects starting a paid future service outside the allowed window", async () => {
    const customer = await createUser("+8613800138005");
    const companionOwner = await createUser("+8613800138006");
    await prisma.companionProfile.update({
      where: { id: "c1" },
      data: { ownerUserId: companionOwner.user.id }
    });
    const order = await request(app.getHttpServer())
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${customer.token}`)
      .send({ companionId: "c1", themeId: "t1", durationMinutes: 30, scheduledAt: futureScheduledAt() })
      .expect(201);
    const beforeConfirmation = await request(app.getHttpServer())
      .post(`/api/v1/orders/${order.body.data.id}/prepay`)
      .set("Authorization", `Bearer ${customer.token}`)
      .expect(409);
    expect(beforeConfirmation.body.error.code).toBe("ORDER_NOT_CONFIRMED");
    await request(app.getHttpServer())
      .post(`/api/v1/orders/service/${order.body.data.id}/confirm`)
      .set("Authorization", `Bearer ${companionOwner.token}`)
      .expect(201);
    const prepay = await request(app.getHttpServer())
      .post(`/api/v1/orders/${order.body.data.id}/prepay`)
      .set("Authorization", `Bearer ${customer.token}`)
      .expect(201);
    await request(app.getHttpServer())
      .post("/api/v1/payments/wechat/mock-notify")
      .set("Authorization", `Bearer ${customer.token}`)
      .send({ outTradeNo: prepay.body.data.payment.outTradeNo })
      .expect(201);

    const start = await request(app.getHttpServer())
      .post(`/api/v1/orders/service/${order.body.data.id}/start`)
      .set("Authorization", `Bearer ${companionOwner.token}`)
      .expect(409);

    expect(start.body.error.code).toBe("ORDER_SERVICE_NOT_READY");
    const persisted = await prisma.order.findUniqueOrThrow({ where: { id: order.body.data.id } });
    expect(persisted.status).toBe("paid");
  });

  it("does not let a stale companion rejection overwrite a concurrent prepay", async () => {
    const customer = await createUser("+8613800138014");
    const companionOwner = await createUser("+8613800138015", "companion");
    await prisma.companionProfile.update({
      where: { id: "c1" },
      data: { ownerUserId: companionOwner.user.id }
    });
    const created = await request(app.getHttpServer())
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${customer.token}`)
      .send({ companionId: "c1", themeId: "t1", durationMinutes: 30, scheduledAt: futureScheduledAt() })
      .expect(201);
    const orderId = created.body.data.id as string;

    let releaseOrderLock: () => void = () => {};
    let signalOrderLocked: () => void = () => {};
    const orderLocked = new Promise<void>((resolve) => { signalOrderLocked = resolve; });
    const release = new Promise<void>((resolve) => { releaseOrderLock = resolve; });
    const confirmation = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
      signalOrderLocked();
      await release;
      await tx.order.update({
        where: { id: orderId },
        data: { companionConfirmedAt: new Date() }
      });
    }, { maxWait: 5_000, timeout: 10_000 });
    await orderLocked;

    // Queue prepay first on the order lock, then a rejection that would have
    // captured stale unconfirmed state in the old read-before-update flow.
    const prepayPromise = request(app.getHttpServer())
      .post(`/api/v1/orders/${orderId}/prepay`)
      .set("Authorization", `Bearer ${customer.token}`)
      .then((response) => response);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const rejectPromise = request(app.getHttpServer())
      .post(`/api/v1/orders/service/${orderId}/reject`)
      .set("Authorization", `Bearer ${companionOwner.token}`)
      .then((response) => response);
    await new Promise((resolve) => setTimeout(resolve, 50));
    releaseOrderLock();

    await confirmation;
    const [prepay, reject] = await Promise.all([prepayPromise, rejectPromise]);
    expect(prepay.status).toBe(201);
    expect(reject.status).toBe(409);
    expect(["ORDER_INVALID_STATE", "ORDER_PAYMENT_IN_PROGRESS"]).toContain(reject.body.error.code);
    const persisted = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(persisted.status).toBe("paying");
    expect(await prisma.paymentTransaction.count({ where: { orderId, status: "initiated" } })).toBe(1);
  });

  it("blocks service start while a refund is processing", async () => {
    const customer = await createUser("+8613800138017");
    const companionOwner = await createUser("+8613800138018", "companion");
    await prisma.companionProfile.update({ where: { id: "c1" }, data: { ownerUserId: companionOwner.user.id } });
    const order = await request(app.getHttpServer())
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${customer.token}`)
      .send({ companionId: "c1", themeId: "t1", durationMinutes: 30, scheduledAt: futureScheduledAt() })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/orders/service/${order.body.data.id}/confirm`)
      .set("Authorization", `Bearer ${companionOwner.token}`)
      .expect(201);
    const prepay = await request(app.getHttpServer())
      .post(`/api/v1/orders/${order.body.data.id}/prepay`)
      .set("Authorization", `Bearer ${customer.token}`)
      .expect(201);
    await request(app.getHttpServer())
      .post("/api/v1/payments/wechat/mock-notify")
      .set("Authorization", `Bearer ${customer.token}`)
      .send({ outTradeNo: prepay.body.data.payment.outTradeNo })
      .expect(201);
    await prisma.order.update({
      where: { id: order.body.data.id },
      data: { scheduledAt: new Date(Date.now() + 5 * 60_000) }
    });
    const payment = await prisma.paymentTransaction.findFirstOrThrow({
      where: { orderId: order.body.data.id, status: "success" }
    });
    await prisma.refundTransaction.create({
      data: {
        orderId: order.body.data.id,
        paymentId: payment.id,
        outRefundNo: `R-processing-${Date.now()}`,
        amountCents: payment.amountCents,
        status: "processing"
      }
    });

    const start = await request(app.getHttpServer())
      .post(`/api/v1/orders/service/${order.body.data.id}/start`)
      .set("Authorization", `Bearer ${companionOwner.token}`)
      .expect(409);
    expect(start.body.error.code).toBe("ORDER_REFUND_IN_PROGRESS");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.body.data.id } })).status).toBe("paid");
  });

  it("does not let a stale completion overwrite an already refunded order", async () => {
    const customer = await createUser("+8613800138019");
    const companionOwner = await createUser("+8613800138020", "companion");
    await prisma.companionProfile.update({ where: { id: "c1" }, data: { ownerUserId: companionOwner.user.id } });
    const order = await prisma.order.create({
      data: {
        userId: customer.user.id,
        companionId: "c1",
        themeId: "t1",
        durationMinutes: 30,
        amountCents: 3900,
        currency: "CNY",
        status: "inService",
        scheduledAt: new Date(Date.now() - 5 * 60_000),
        companionNameSnapshot: "小安",
        companionRoleSnapshot: "倾听者",
        companionInitialsSnapshot: "小安",
        themeNameSnapshot: "情绪倾听"
      }
    });
    let releaseOrderLock: () => void = () => {};
    let signalLocked: () => void = () => {};
    const locked = new Promise<void>((resolve) => { signalLocked = resolve; });
    const release = new Promise<void>((resolve) => { releaseOrderLock = resolve; });
    const refundCommit = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${order.id} FOR UPDATE`;
      signalLocked();
      await release;
      await tx.order.update({ where: { id: order.id }, data: { status: "refunded" } });
    }, { timeout: 10_000 });
    await locked;
    const completion = request(app.getHttpServer())
      .post(`/api/v1/orders/service/${order.id}/complete`)
      .set("Authorization", `Bearer ${companionOwner.token}`)
      .then((response) => response);
    await new Promise((resolve) => setTimeout(resolve, 50));
    releaseOrderLock();
    await refundCommit;
    const complete = await completion;
    expect(complete.status).toBe(409);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("refunded");
  });

  it("returns one active prepay for sequential and concurrent retries", async () => {
    const { token } = await createUser();
    const createRes = await request(app.getHttpServer())
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${token}`)
      .send({ companionId: "c1", themeId: "t1", durationMinutes: 30, scheduledAt: futureScheduledAt() })
      .expect(201);
    const orderId = createRes.body.data.id as string;
    await confirmOrderForPayment(orderId);

    const first = await request(app.getHttpServer())
      .post(`/api/v1/orders/${orderId}/prepay`)
      .set("Authorization", `Bearer ${token}`)
      .expect(201);
    const retry = await request(app.getHttpServer())
      .post(`/api/v1/orders/${orderId}/prepay`)
      .set("Authorization", `Bearer ${token}`)
      .expect(201);
    const concurrent = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/v1/orders/${orderId}/prepay`)
        .set("Authorization", `Bearer ${token}`),
      request(app.getHttpServer())
        .post(`/api/v1/orders/${orderId}/prepay`)
        .set("Authorization", `Bearer ${token}`)
    ]);

    expect(retry.body.data.payment.outTradeNo).toBe(first.body.data.payment.outTradeNo);
    expect(concurrent.map((response) => response.status)).toEqual([201, 201]);
    expect(concurrent.map((response) => response.body.data.payment.outTradeNo))
      .toEqual([first.body.data.payment.outTradeNo, first.body.data.payment.outTradeNo]);
    const payments = await prisma.paymentTransaction.findMany({ where: { orderId } });
    expect(payments).toHaveLength(1);
    expect(payments.filter((payment) => payment.status === "initiated")).toHaveLength(1);
  });

  it("atomically rejects concurrent prepay for overlapping companion slots", async () => {
    const firstUser = await createUser("+8613800138001");
    const secondUser = await createUser("+8613800138002");
    const scheduledAt = futureScheduledAt();
    const [firstOrder, secondOrder] = await Promise.all([
      request(app.getHttpServer())
        .post("/api/v1/orders")
        .set("Authorization", `Bearer ${firstUser.token}`)
        .send({ companionId: "c1", themeId: "t1", durationMinutes: 60, scheduledAt }),
      request(app.getHttpServer())
        .post("/api/v1/orders")
        .set("Authorization", `Bearer ${secondUser.token}`)
        .send({ companionId: "c1", themeId: "t2", durationMinutes: 30, scheduledAt })
    ]);
    expect(firstOrder.status).toBe(201);
    expect(secondOrder.status).toBe(201);
    await confirmOrderForPayment(firstOrder.body.data.id);
    await confirmOrderForPayment(secondOrder.body.data.id);

    const results = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/v1/orders/${firstOrder.body.data.id}/prepay`)
        .set("Authorization", `Bearer ${firstUser.token}`),
      request(app.getHttpServer())
        .post(`/api/v1/orders/${secondOrder.body.data.id}/prepay`)
        .set("Authorization", `Bearer ${secondUser.token}`)
    ]);

    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    const conflict = results.find((result) => result.status === 409);
    expect(conflict?.body.error.code).toBe("COMPANION_SLOT_UNAVAILABLE");
    const orders = await prisma.order.findMany({
      where: { id: { in: [firstOrder.body.data.id, secondOrder.body.data.id] } }
    });
    expect(orders.filter((order) => order.status === "paying")).toHaveLength(1);
    expect(orders.filter((order) => order.status === "pending")).toHaveLength(1);
    const payments = await prisma.paymentTransaction.findMany({
      where: { orderId: { in: orders.map((order) => order.id) } }
    });
    expect(payments.filter((payment) => payment.status === "initiated")).toHaveLength(1);
  });

  it("reclaims an expired abandoned slot before allowing another user to prepay", async () => {
    const firstUser = await createUser("+8613800138003");
    const secondUser = await createUser("+8613800138004");
    const scheduledAt = futureScheduledAt();
    const firstOrder = await request(app.getHttpServer())
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${firstUser.token}`)
      .send({ companionId: "c1", themeId: "t1", durationMinutes: 30, scheduledAt })
      .expect(201);
    const secondOrder = await request(app.getHttpServer())
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${secondUser.token}`)
      .send({ companionId: "c1", themeId: "t2", durationMinutes: 30, scheduledAt })
      .expect(201);
    await confirmOrderForPayment(firstOrder.body.data.id);
    await confirmOrderForPayment(secondOrder.body.data.id);
    const firstPrepay = await request(app.getHttpServer())
      .post(`/api/v1/orders/${firstOrder.body.data.id}/prepay`)
      .set("Authorization", `Bearer ${firstUser.token}`)
      .expect(201);
    const firstTradeNo = firstPrepay.body.data.payment.outTradeNo as string;
    await prisma.paymentTransaction.update({
      where: { outTradeNo: firstTradeNo },
      data: { expiresAt: new Date(Date.now() - 1) }
    });

    await request(app.getHttpServer())
      .post(`/api/v1/orders/${secondOrder.body.data.id}/prepay`)
      .set("Authorization", `Bearer ${secondUser.token}`)
      .expect(201);
    const firstRetry = await request(app.getHttpServer())
      .post(`/api/v1/orders/${firstOrder.body.data.id}/prepay`)
      .set("Authorization", `Bearer ${firstUser.token}`)
      .expect(409);

    expect(firstRetry.body.error.code).toBe("COMPANION_SLOT_UNAVAILABLE");
    const firstPayment = await prisma.paymentTransaction.findUniqueOrThrow({
      where: { outTradeNo: firstTradeNo }
    });
    const orders = await prisma.order.findMany({
      where: { id: { in: [firstOrder.body.data.id, secondOrder.body.data.id] } }
    });
    expect(firstPayment.status).toBe("closed");
    expect(orders.find((order) => order.id === firstOrder.body.data.id)?.status).toBe("pending");
    expect(orders.find((order) => order.id === secondOrder.body.data.id)?.status).toBe("paying");
  });

  it("closes an expired prepay before issuing a replacement", async () => {
    const { token } = await createUser();
    const createRes = await request(app.getHttpServer())
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${token}`)
      .send({ companionId: "c1", themeId: "t1", durationMinutes: 30, scheduledAt: futureScheduledAt() })
      .expect(201);
    const orderId = createRes.body.data.id as string;
    await confirmOrderForPayment(orderId);
    const first = await request(app.getHttpServer())
      .post(`/api/v1/orders/${orderId}/prepay`)
      .set("Authorization", `Bearer ${token}`)
      .expect(201);
    const firstTradeNo = first.body.data.payment.outTradeNo as string;
    await prisma.paymentTransaction.update({
      where: { outTradeNo: firstTradeNo },
      data: { expiresAt: new Date(Date.now() - 1) }
    });

    const replacement = await request(app.getHttpServer())
      .post(`/api/v1/orders/${orderId}/prepay`)
      .set("Authorization", `Bearer ${token}`)
      .expect(201);

    expect(replacement.body.data.payment.outTradeNo).not.toBe(firstTradeNo);
    const payments = await prisma.paymentTransaction.findMany({
      where: { orderId },
      orderBy: { createdAt: "asc" }
    });
    expect(payments.map((payment) => payment.status)).toEqual(["closed", "initiated"]);
    expect(payments[1].expiresAt?.getTime()).toBeGreaterThan(Date.now());
  });

  it("keeps an externally closed prepay closed when replacement creation fails", async () => {
    const { token } = await createUser("+8613800138021");
    const created = await request(app.getHttpServer())
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${token}`)
      .send({ companionId: "c1", themeId: "t1", durationMinutes: 30, scheduledAt: futureScheduledAt() })
      .expect(201);
    const orderId = created.body.data.id as string;
    await confirmOrderForPayment(orderId);
    const first = await request(app.getHttpServer())
      .post(`/api/v1/orders/${orderId}/prepay`)
      .set("Authorization", `Bearer ${token}`)
      .expect(201);
    await prisma.paymentTransaction.update({
      where: { outTradeNo: first.body.data.payment.outTradeNo },
      data: { expiresAt: new Date(Date.now() - 1) }
    });
    const createPrepay = jest.spyOn(wechat, "createAppPrepay")
      .mockRejectedValueOnce(new Error("replacement provider unavailable"));

    await request(app.getHttpServer())
      .post(`/api/v1/orders/${orderId}/prepay`)
      .set("Authorization", `Bearer ${token}`)
      .expect(500);

    const payments = await prisma.paymentTransaction.findMany({ where: { orderId } });
    expect(payments).toHaveLength(1);
    expect(payments[0].status).toBe("closed");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("pending");
    createPrepay.mockRestore();
  });

  it("closes an expired prepay before allowing cancellation", async () => {
    const { token } = await createUser();
    const createRes = await request(app.getHttpServer())
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${token}`)
      .send({ companionId: "c1", themeId: "t1", durationMinutes: 30, scheduledAt: futureScheduledAt() })
      .expect(201);
    const orderId = createRes.body.data.id as string;
    await confirmOrderForPayment(orderId);
    const prepay = await request(app.getHttpServer())
      .post(`/api/v1/orders/${orderId}/prepay`)
      .set("Authorization", `Bearer ${token}`)
      .expect(201);
    const outTradeNo = prepay.body.data.payment.outTradeNo as string;
    await prisma.paymentTransaction.update({
      where: { outTradeNo },
      data: { expiresAt: new Date(Date.now() - 1) }
    });

    const cancel = await request(app.getHttpServer())
      .post(`/api/v1/orders/${orderId}/cancel`)
      .set("Authorization", `Bearer ${token}`)
      .expect(201);

    expect(cancel.body.data.status).toBe("cancelled");
    const payment = await prisma.paymentTransaction.findUniqueOrThrow({ where: { outTradeNo } });
    expect(payment.status).toBe("closed");
    await request(app.getHttpServer())
      .post("/api/v1/payments/wechat/mock-notify")
      .set("Authorization", `Bearer ${token}`)
      .send({ outTradeNo })
      .expect(409);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe("cancelled");
  });

  it("rejects a callback for a locally closed payment", async () => {
    const { token } = await createUser();
    const createRes = await request(app.getHttpServer())
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${token}`)
      .send({ companionId: "c1", themeId: "t1", durationMinutes: 30, scheduledAt: futureScheduledAt() })
      .expect(201);
    const orderId = createRes.body.data.id as string;
    await confirmOrderForPayment(orderId);
    const prepay = await request(app.getHttpServer())
      .post(`/api/v1/orders/${orderId}/prepay`)
      .set("Authorization", `Bearer ${token}`)
      .expect(201);
    const outTradeNo = prepay.body.data.payment.outTradeNo as string;
    await prisma.paymentTransaction.update({ where: { outTradeNo }, data: { status: "closed" } });

    const notify = await request(app.getHttpServer())
      .post("/api/v1/payments/wechat/mock-notify")
      .set("Authorization", `Bearer ${token}`)
      .send({ outTradeNo });

    expect(notify.status).toBe(409);
    expect(notify.body.error.code).toBe("PAYMENT_INVALID_STATE");
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe("paying");
    expect(order.paidAt).toBeNull();
  });

  it("does not let cancellation race an initiated payment callback", async () => {
    const { token } = await createUser();
    const createRes = await request(app.getHttpServer())
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${token}`)
      .send({ companionId: "c1", themeId: "t1", durationMinutes: 30, scheduledAt: futureScheduledAt() })
      .expect(201);
    const orderId = createRes.body.data.id as string;
    await confirmOrderForPayment(orderId);
    const prepay = await request(app.getHttpServer())
      .post(`/api/v1/orders/${orderId}/prepay`)
      .set("Authorization", `Bearer ${token}`)
      .expect(201);
    const outTradeNo = prepay.body.data.payment.outTradeNo as string;

    const [cancel, notify] = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/v1/orders/${orderId}/cancel`)
        .set("Authorization", `Bearer ${token}`),
      request(app.getHttpServer())
        .post("/api/v1/payments/wechat/mock-notify")
        .set("Authorization", `Bearer ${token}`)
        .send({ outTradeNo })
    ]);

    expect(cancel.status).toBe(409);
    expect(notify.status).toBe(201);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    const payment = await prisma.paymentTransaction.findUniqueOrThrow({ where: { outTradeNo } });
    expect(order.status).toBe("paid");
    expect(payment.status).toBe("success");
  });

  it("cancels a pending order", async () => {
    const { token } = await createUser();

    const createRes = await request(app.getHttpServer())
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${token}`)
      .send({ companionId: "c2", themeId: "t2", durationMinutes: 60, scheduledAt: futureScheduledAt() })
      .expect(201);

    const orderId = createRes.body.data.id;

    const cancelRes = await request(app.getHttpServer())
      .post(`/api/v1/orders/${orderId}/cancel`)
      .set("Authorization", `Bearer ${token}`)
      .expect(201);

    expect(cancelRes.body.data.status).toBe("cancelled");
  });
});
