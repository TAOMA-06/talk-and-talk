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

describe("Admin Moderation (e2e)", () => {
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
    await prisma.auditLog.deleteMany();
    await prisma.moderationLabel.deleteMany();
    await prisma.moderationActionLog.deleteMany();
    await prisma.moderationEvidence.deleteMany();
    await prisma.moderationCase.deleteMany();
    await prisma.messageReadState.deleteMany();
    await prisma.message.deleteMany();
    await prisma.conversation.deleteMany();
    await prisma.companionServiceTag.deleteMany();
    await prisma.serviceTag.deleteMany();
    await prisma.companionProfile.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.verificationCode.deleteMany();
    await prisma.authIdentity.deleteMany();
    await prisma.userProfile.deleteMany();
    await prisma.user.deleteMany();
  }

  async function createUser(role: "user" | "moderator" | "admin" = "user") {
    const user = await prisma.user.create({
      data: {
        role,
        profile: {
          create: {
            displayName: role === "user" ? "普通用户" : role,
            phone: role === "user" ? "+8613800138000" : `+8613800${role === "admin" ? "000001" : "000002"}`,
            age: 22,
            gender: "female"
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

  async function createOpenCase() {
    return prisma.moderationCase.create({
      data: {
        title: "聊天拦截：加我微信私下聊",
        category: "实时风控",
        riskLevel: "high",
        status: "pending",
        source: "chat",
        content: "加我微信私下聊",
        targetId: "c1",
        aiScore: 0.92,
        aiReason: "疑似私联",
        decision: "block",
        matchedRules: ["private.contact"],
        usedAI: false
      }
    });
  }

  it("forbids normal users from admin moderation endpoints", async () => {
    const { token } = await createUser("user");

    await request(app.getHttpServer())
      .get("/api/v1/admin/moderation/overview")
      .set("Authorization", `Bearer ${token}`)
      .expect(403);

    await request(app.getHttpServer())
      .get("/api/v1/admin/moderation/cases")
      .set("Authorization", `Bearer ${token}`)
      .expect(403);

    await request(app.getHttpServer())
      .get("/api/v1/moderation/cases")
      .set("Authorization", `Bearer ${token}`)
      .expect(403);
  });

  it("lets an admin ban an account and invalidates its existing access token", async () => {
    const { token: adminToken } = await createUser("admin");
    const { user, token: userToken } = await createUser("user");

    await request(app.getHttpServer())
      .patch(`/api/v1/admin/users/${user.id}/account-status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "banned", reason: "confirmed commercial abuse" })
      .expect(200)
      .expect(({ body }) => expect(body.data.accountStatus).toBe("banned"));

    const denied = await request(app.getHttpServer())
      .get("/api/v1/notifications")
      .set("Authorization", `Bearer ${userToken}`)
      .expect(403);
    expect(denied.body.error.code).toBe("ACCOUNT_BANNED");
  });

  it("runs the deletion queue from pending to completed exactly once while retaining finance records", async () => {
    const { token: adminToken } = await createUser("admin");
    const { user, token: userToken } = await createUser("user");
    const companion = await prisma.companionProfile.findFirstOrThrow();
    await prisma.authIdentity.create({
      data: { userId: user.id, provider: "wechatMiniProgram", providerId: "deletion-open-id" }
    });
    await prisma.staffCredential.create({
      data: {
        userId: user.id,
        username: "deletion-target-staff",
        passwordHash: "irreversible-test-password-hash",
        totpSecretCiphertext: "encrypted-test-totp-secret"
      }
    });
    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: "deletion-refresh-token-hash",
        expiresAt: new Date(Date.now() + 86_400_000)
      }
    });
    const retainedOrder = await prisma.order.create({
      data: {
        userId: user.id,
        companionId: companion.id,
        themeId: "deletion-retention-theme",
        durationMinutes: 30,
        amountCents: 9900,
        status: "completed",
        scheduledAt: new Date(Date.now() - 86_400_000),
        completedAt: new Date(),
        companionNameSnapshot: companion.name,
        companionRoleSnapshot: companion.role,
        companionInitialsSnapshot: companion.initials,
        themeNameSnapshot: "注销留存测试"
      }
    });
    const retainedPayment = await prisma.paymentTransaction.create({
      data: {
        orderId: retainedOrder.id,
        outTradeNo: "DELETION_RETAINED_PAYMENT",
        amountCents: 9900,
        status: "success",
        transactionId: "DELETION_RETAINED_TXN",
        paidAt: new Date()
      }
    });
    await prisma.refundTransaction.create({
      data: {
        orderId: retainedOrder.id,
        paymentId: retainedPayment.id,
        outRefundNo: "DELETION_RETAINED_REFUND",
        amountCents: 9900,
        status: "success",
        reason: "retention verification"
      }
    });

    const requested = await request(app.getHttpServer())
      .post("/api/v1/me/deletion-request")
      .set("Authorization", `Bearer ${userToken}`)
      .expect(201);
    const requestId = requested.body.data.id as string;

    const queue = await request(app.getHttpServer())
      .get("/api/v1/admin/account-deletions")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(queue.body.data.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: requestId, status: "pending", userId: user.id })
    ]));

    await request(app.getHttpServer())
      .post(`/api/v1/admin/account-deletions/${requestId}/start`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(201)
      .expect(({ body }) => expect(body.data.status).toBe("processing"));
    await request(app.getHttpServer())
      .post(`/api/v1/admin/account-deletions/${requestId}/start`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(201)
      .expect(({ body }) => expect(body.data.status).toBe("processing"));

    const [restrictedUser, restrictedRefresh] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
      prisma.refreshToken.findMany({ where: { userId: user.id } })
    ]);
    expect(restrictedUser.accountStatus).toBe("restricted");
    expect(restrictedRefresh.every((token) => token.revokedAt !== null)).toBe(true);
    const restrictedMutation = await request(app.getHttpServer())
      .post("/api/v1/notifications/read-all")
      .set("Authorization", `Bearer ${userToken}`)
      .expect(403);
    expect(restrictedMutation.body.error.code).toBe("ACCOUNT_RESTRICTED");
    const prematureReactivation = await request(app.getHttpServer())
      .patch(`/api/v1/admin/users/${user.id}/account-status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "active", reason: "must use deletion settlement operations" })
      .expect(409);
    expect(prematureReactivation.body.error.code).toBe("ACCOUNT_DELETION_IN_PROGRESS");
    await prisma.accountDeletionRequest.update({
      where: { id: requestId },
      data: { updatedAt: new Date(Date.now() - 61_000) }
    });

    const completed = await request(app.getHttpServer())
      .post(`/api/v1/admin/account-deletions/${requestId}/complete`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ note: "support verified identity and statutory retention" })
      .expect(201);
    expect(completed.body.data).toEqual(expect.objectContaining({
      status: "completed",
      user: expect.objectContaining({ accountStatus: "banned" }),
      retainedRecords: { orders: 1, payments: 1, refunds: 1 }
    }));
    await request(app.getHttpServer())
      .post(`/api/v1/admin/account-deletions/${requestId}/complete`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ note: "duplicate retry must stay idempotent" })
      .expect(201)
      .expect(({ body }) => expect(body.data.status).toBe("completed"));

    const [storedUser, storedProfile, storedRequest, refreshTokens, identities, staffCredentials, orders, payments, refunds] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
      prisma.userProfile.findUniqueOrThrow({ where: { userId: user.id } }),
      prisma.accountDeletionRequest.findUniqueOrThrow({ where: { id: requestId } }),
      prisma.refreshToken.findMany({ where: { userId: user.id } }),
      prisma.authIdentity.findMany({ where: { userId: user.id } }),
      prisma.staffCredential.findMany({ where: { userId: user.id } }),
      prisma.order.count({ where: { userId: user.id } }),
      prisma.paymentTransaction.count({ where: { order: { userId: user.id } } }),
      prisma.refundTransaction.count({ where: { order: { userId: user.id } } })
    ]);
    expect(storedUser.accountStatus).toBe("banned");
    expect(storedProfile).toEqual(expect.objectContaining({
      displayName: null,
      phone: null,
      age: null,
      gender: null,
      isVerified: false
    }));
    expect(storedRequest).toEqual(expect.objectContaining({
      status: "completed",
      note: "support verified identity and statutory retention"
    }));
    expect(refreshTokens.every((token) => token.revokedAt !== null)).toBe(true);
    expect(identities).toHaveLength(0);
    expect(staffCredentials).toHaveLength(0);
    expect({ orders, payments, refunds }).toEqual({ orders: 1, payments: 1, refunds: 1 });
    const replacementStaffUser = await prisma.user.create({
      data: {
        role: "admin",
        accountStatus: "active",
        staffCredential: {
          create: {
            username: "deletion-target-staff",
            passwordHash: "new-user-password-hash",
            totpSecretCiphertext: "new-user-totp-ciphertext"
          }
        }
      }
    });
    expect(replacementStaffUser.id).not.toBe(user.id);

    const audits = await prisma.auditLog.findMany({
      where: { resourceType: "accountDeletionRequest", resourceId: requestId }
    });
    expect(audits.filter((item) => item.action === "account.deletion_processing_started")).toHaveLength(1);
    expect(audits.filter((item) => item.action === "account.deletion_completed")).toHaveLength(1);

    const reactivation = await request(app.getHttpServer())
      .patch(`/api/v1/admin/users/${user.id}/account-status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "active", reason: "completed deletion must remain final" })
      .expect(409);
    expect(reactivation.body.error.code).toBe("ACCOUNT_DELETION_FINALIZED");

    const denied = await request(app.getHttpServer())
      .get("/api/v1/notifications")
      .set("Authorization", `Bearer ${userToken}`)
      .expect(403);
    expect(denied.body.error.code).toBe("ACCOUNT_BANNED");

    const repeatedRequest = await request(app.getHttpServer())
      .post("/api/v1/me/deletion-request")
      .set("Authorization", `Bearer ${userToken}`)
      .expect(409);
    expect(repeatedRequest.body.error.code).toBe("DELETION_ALREADY_COMPLETED");
    expect(await prisma.accountDeletionRequest.count({ where: { userId: user.id } })).toBe(1);
  });

  it("keeps a deletion request processing while active financial obligations remain", async () => {
    const { token: adminToken } = await createUser("admin");
    const { user, token: userToken } = await createUser("user");
    const companion = await prisma.companionProfile.findFirstOrThrow();
    await prisma.authIdentity.create({
      data: { userId: user.id, provider: "wechatMiniProgram", providerId: "active-order-open-id" }
    });
    const activeOrder = await prisma.order.create({
      data: {
        userId: user.id,
        companionId: companion.id,
        themeId: "active-deletion-theme",
        durationMinutes: 30,
        amountCents: 9900,
        status: "paid",
        scheduledAt: new Date(Date.now() + 86_400_000),
        paidAt: new Date(),
        companionNameSnapshot: companion.name,
        companionRoleSnapshot: companion.role,
        companionInitialsSnapshot: companion.initials,
        themeNameSnapshot: "活跃订单阻断测试"
      }
    });
    await prisma.paymentTransaction.create({
      data: {
        orderId: activeOrder.id,
        outTradeNo: "DELETION_ACTIVE_PAYMENT",
        amountCents: 9900,
        status: "success",
        transactionId: "DELETION_ACTIVE_TXN",
        paidAt: new Date()
      }
    });
    const requested = await request(app.getHttpServer())
      .post("/api/v1/me/deletion-request")
      .set("Authorization", `Bearer ${userToken}`)
      .expect(201);
    const requestId = requested.body.data.id as string;
    await request(app.getHttpServer())
      .post(`/api/v1/admin/account-deletions/${requestId}/start`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(201);
    await prisma.accountDeletionRequest.update({
      where: { id: requestId },
      data: { updatedAt: new Date(Date.now() - 61_000) }
    });

    const blocked = await request(app.getHttpServer())
      .post(`/api/v1/admin/account-deletions/${requestId}/complete`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ note: "must wait for settlement" })
      .expect(409);
    expect(blocked.body.error.code).toBe("DELETION_HAS_ACTIVE_FINANCIAL_OBLIGATIONS");

    const [storedUser, storedProfile, storedRequest, identities] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
      prisma.userProfile.findUniqueOrThrow({ where: { userId: user.id } }),
      prisma.accountDeletionRequest.findUniqueOrThrow({ where: { id: requestId } }),
      prisma.authIdentity.findMany({ where: { userId: user.id } })
    ]);
    expect(storedUser.accountStatus).toBe("restricted");
    expect(storedProfile.displayName).toBe("普通用户");
    expect(storedRequest.status).toBe("processing");
    expect(identities).toHaveLength(1);
    await request(app.getHttpServer())
      .get("/api/v1/notifications")
      .set("Authorization", `Bearer ${userToken}`)
      .expect(200);
  });

  it("settles deletion payment and refund callbacks without enabling new money movement", async () => {
    const { token: adminToken } = await createUser("admin");
    const { user, token: userToken } = await createUser("user");
    const companion = await prisma.companionProfile.findFirstOrThrow();
    const expiredPayingOrder = await prisma.order.create({
      data: {
        userId: user.id,
        companionId: companion.id,
        themeId: "deletion-expired-payment-theme",
        durationMinutes: 30,
        amountCents: 9900,
        status: "paying",
        scheduledAt: new Date(Date.now() + 86_400_000),
        companionNameSnapshot: companion.name,
        companionRoleSnapshot: companion.role,
        companionInitialsSnapshot: companion.initials,
        themeNameSnapshot: "过期支付同步"
      }
    });
    const expiredPayment = await prisma.paymentTransaction.create({
      data: {
        orderId: expiredPayingOrder.id,
        outTradeNo: "DELETION_EXPIRED_UNPAID_CALLBACK",
        amountCents: 9900,
        status: "initiated",
        expiresAt: new Date(Date.now() - 60_000)
      }
    });
    const refundingOrder = await prisma.order.create({
      data: {
        userId: user.id,
        companionId: companion.id,
        themeId: "deletion-refund-callback-theme",
        durationMinutes: 30,
        amountCents: 12900,
        status: "paid",
        scheduledAt: new Date(Date.now() + 172_800_000),
        paidAt: new Date(),
        companionNameSnapshot: companion.name,
        companionRoleSnapshot: companion.role,
        companionInitialsSnapshot: companion.initials,
        themeNameSnapshot: "退款回调同步"
      }
    });
    const paidPayment = await prisma.paymentTransaction.create({
      data: {
        orderId: refundingOrder.id,
        outTradeNo: "DELETION_REFUND_PAYMENT",
        amountCents: 12900,
        status: "success",
        transactionId: "DELETION_REFUND_PAYMENT_TXN",
        paidAt: new Date()
      }
    });
    const processingRefund = await prisma.refundTransaction.create({
      data: {
        orderId: refundingOrder.id,
        paymentId: paidPayment.id,
        outRefundNo: "DELETION_LOST_REFUND_CALLBACK",
        amountCents: 12900,
        status: "processing",
        reason: "callback reconciliation test"
      }
    });
    const remotelyPaidOrder = await prisma.order.create({
      data: {
        userId: user.id,
        companionId: companion.id,
        themeId: "deletion-paid-callback-theme",
        durationMinutes: 30,
        amountCents: 15900,
        status: "pending",
        scheduledAt: new Date(Date.now() + 2_592_000_000),
        companionConfirmedAt: new Date(),
        companionNameSnapshot: companion.name,
        companionRoleSnapshot: companion.role,
        companionInitialsSnapshot: companion.initials,
        themeNameSnapshot: "支付成功回调丢失"
      }
    });
    await request(app.getHttpServer())
      .post(`/api/v1/orders/${remotelyPaidOrder.id}/prepay`)
      .set("Authorization", `Bearer ${userToken}`)
      .send({ channel: "app" })
      .expect(201);

    const requested = await request(app.getHttpServer())
      .post("/api/v1/me/deletion-request")
      .set("Authorization", `Bearer ${userToken}`)
      .expect(201);
    const requestId = requested.body.data.id as string;
    await request(app.getHttpServer())
      .post(`/api/v1/admin/account-deletions/${requestId}/start`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(201);

    const paymentSettlement = await request(app.getHttpServer())
      .post(`/api/v1/admin/account-deletions/${requestId}/orders/${expiredPayingOrder.id}/payment/sync`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(201);
    expect(paymentSettlement.body.data).toEqual(expect.objectContaining({
      closedExpiredPayment: true,
      order: expect.objectContaining({ status: "cancelled" })
    }));

    const refundSettlement = await request(app.getHttpServer())
      .post(`/api/v1/admin/account-deletions/${requestId}/orders/${refundingOrder.id}/refund/sync`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(201);
    expect(refundSettlement.body.data).toEqual(expect.objectContaining({
      refund: expect.objectContaining({ id: processingRefund.id, status: "success" }),
      order: expect.objectContaining({ status: "refunded" })
    }));

    const paidSettlement = await request(app.getHttpServer())
      .post(`/api/v1/admin/account-deletions/${requestId}/orders/${remotelyPaidOrder.id}/payment/sync`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(201);
    expect(paidSettlement.body.data).toEqual(expect.objectContaining({
      closedExpiredPayment: false,
      sync: expect.objectContaining({ code: "SUCCESS" })
    }));
    expect((await prisma.order.findUniqueOrThrow({ where: { id: remotelyPaidOrder.id } })).status).toBe("paid");

    const initiatedRefund = await request(app.getHttpServer())
      .post(`/api/v1/admin/account-deletions/${requestId}/orders/${remotelyPaidOrder.id}/refund/initiate`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(201);
    expect(initiatedRefund.body.data).toEqual(expect.objectContaining({
      created: true,
      refund: expect.objectContaining({
        status: "success",
        reason: "ACCOUNT_DELETION_SETTLEMENT",
        amountCents: 15900
      }),
      order: expect.objectContaining({ status: "refunded" })
    }));
    const repeatedRefund = await request(app.getHttpServer())
      .post(`/api/v1/admin/account-deletions/${requestId}/orders/${remotelyPaidOrder.id}/refund/initiate`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(201);
    expect(repeatedRefund.body.data.created).toBe(false);

    const [closedPayment, cancelledOrder, successfulRefund, refundedOrder] = await Promise.all([
      prisma.paymentTransaction.findUniqueOrThrow({ where: { id: expiredPayment.id } }),
      prisma.order.findUniqueOrThrow({ where: { id: expiredPayingOrder.id } }),
      prisma.refundTransaction.findUniqueOrThrow({ where: { id: processingRefund.id } }),
      prisma.order.findUniqueOrThrow({ where: { id: refundingOrder.id } })
    ]);
    expect(closedPayment.status).toBe("closed");
    expect(cancelledOrder.status).toBe("cancelled");
    expect(successfulRefund.status).toBe("success");
    expect(refundedOrder.status).toBe("refunded");

    const syncAudits = await prisma.auditLog.findMany({
      where: {
        resourceType: "accountDeletionRequest",
        resourceId: requestId,
        action: { in: ["account.deletion_payment_synced", "account.deletion_refund_synced"] }
      }
    });
    expect(syncAudits).toHaveLength(3);
    expect(await prisma.auditLog.count({
      where: {
        action: "account.deletion_refund_initiated",
        resourceType: "accountDeletionRequest",
        resourceId: requestId
      }
    })).toBe(1);

    await prisma.accountDeletionRequest.update({
      where: { id: requestId },
      data: { updatedAt: new Date(Date.now() - 61_000) }
    });
    const completedAfterSettlement = await request(app.getHttpServer())
      .post(`/api/v1/admin/account-deletions/${requestId}/complete`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ note: "provider states reconciled; financial records retained" });
    expect(completedAfterSettlement.body).toEqual(expect.objectContaining({
      data: expect.objectContaining({ status: "completed" })
    }));
    expect(completedAfterSettlement.status).toBe(201);
  });

  it("allows moderator to list cases, resolve, and update overview stats", async () => {
    const { token } = await createUser("moderator");
    const openCase = await createOpenCase();

    const before = await request(app.getHttpServer())
      .get("/api/v1/admin/moderation/overview")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(before.body.data.overview.pendingCases).toBeGreaterThanOrEqual(1);
    expect(before.body.data.overview.resolved).toBe(0);

    const detail = await request(app.getHttpServer())
      .get(`/api/v1/admin/moderation/cases/${openCase.id}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(detail.body.data.case.id).toBe(openCase.id);
    expect(detail.body.data.case.status).toBe("pending");

    const resolved = await request(app.getHttpServer())
      .post(`/api/v1/admin/moderation/cases/${openCase.id}/actions`)
      .set("Authorization", `Bearer ${token}`)
      .send({ action: "confirmViolation", note: "确认私联违规" })
      .expect(201);

    expect(resolved.body.data.case.status).toBe("resolved");
    expect(resolved.body.data.action.action).toBe("confirmViolation");
    expect(resolved.body.data.overview.resolved).toBeGreaterThanOrEqual(1);
    expect(resolved.body.data.overview.pendingCases).toBe(0);

    const logs = await prisma.moderationActionLog.findMany({ where: { caseId: openCase.id } });
    expect(logs.some((item) => item.action === "confirmViolation")).toBe(true);

    const audits = await prisma.auditLog.findMany({
      where: { resourceType: "moderation_case", resourceId: openCase.id }
    });
    expect(audits.some((item) => item.action === "confirmViolation")).toBe(true);
  });

  it("supports dismiss and escalate actions", async () => {
    const { token } = await createUser("admin");
    const dismissCase = await createOpenCase();
    const escalateCase = await prisma.moderationCase.create({
      data: {
        title: "聊天预警：边界内容",
        category: "实时风控",
        riskLevel: "medium",
        status: "pending",
        source: "chat",
        content: "能不能线下见一面",
        targetId: "c2",
        aiScore: 0.7,
        aiReason: "线下邀约倾向",
        decision: "warn",
        matchedRules: ["offline.meetup"],
        usedAI: false
      }
    });

    const dismissed = await request(app.getHttpServer())
      .post(`/api/v1/admin/moderation/cases/${dismissCase.id}/actions`)
      .set("Authorization", `Bearer ${token}`)
      .send({ action: "dismiss", note: "误报" })
      .expect(201);
    expect(dismissed.body.data.case.status).toBe("dismissed");

    const escalated = await request(app.getHttpServer())
      .post(`/api/v1/admin/moderation/cases/${escalateCase.id}/actions`)
      .set("Authorization", `Bearer ${token}`)
      .send({ action: "escalate" })
      .expect(201);
    expect(escalated.body.data.case.status).toBe("humanReview");
  });

  it("filters cases by status and keyword", async () => {
    const { token } = await createUser("moderator");
    await createOpenCase();
    await prisma.moderationCase.create({
      data: {
        title: "已处理工单",
        category: "实时风控",
        riskLevel: "low",
        status: "resolved",
        source: "community",
        content: "普通内容",
        aiScore: 0.1,
        aiReason: "内容正常",
        decision: "review",
        matchedRules: [],
        usedAI: false,
        resolvedAt: new Date()
      }
    });

    const filtered = await request(app.getHttpServer())
      .get("/api/v1/admin/moderation/cases")
      .query({ status: "pending", keyword: "微信" })
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(filtered.body.data.cases.length).toBe(1);
    expect(filtered.body.data.cases[0].content).toContain("微信");
  });

  it("creates and exports labels", async () => {
    const { token } = await createUser("moderator");

    const created = await request(app.getHttpServer())
      .post("/api/v1/admin/moderation/labels")
      .set("Authorization", `Bearer ${token}`)
      .send({
        text: "代理兼职赚钱，加我了解",
        expectedDecision: "review",
        actualDecision: "allow",
        note: "规则漏检"
      })
      .expect(201);

    expect(created.body.data.label.expectedDecision).toBe("review");
    expect(created.body.data.count).toBe(1);

    const exported = await request(app.getHttpServer())
      .get("/api/v1/admin/moderation/labels/export")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(exported.body.data.schemaVersion).toBe(1);
    expect(exported.body.data.count).toBe(1);
    expect(exported.body.data.samples[0].text).toContain("代理兼职");
  });

  it("allows users to submit reports while keeping case list staff-only", async () => {
    const { token: userToken } = await createUser("user");
    const { token: modToken } = await createUser("moderator");
    const { token: adminToken } = await createUser("admin");

    const report = await request(app.getHttpServer())
      .post("/api/v1/moderation/reports")
      .set("Authorization", `Bearer ${userToken}`)
      .send({
        reason: "对方索要联系方式",
        conversationId: "c1",
        recentContext: "加我微信吧"
      })
      .expect(201);

    expect(report.body.data.report.id).toBeTruthy();
    expect(report.body.data.report.source).toBe("report");
    expect(report.body.data.report.status).toMatch(/pending|humanReview/);
    expect(report.body.data.moderationCase).toBeUndefined();

    await request(app.getHttpServer())
      .get("/api/v1/moderation/cases")
      .set("Authorization", `Bearer ${userToken}`)
      .expect(403);

    const staffList = await request(app.getHttpServer())
      .get("/api/v1/admin/moderation/cases")
      .query({ source: "report" })
      .set("Authorization", `Bearer ${modToken}`)
      .expect(200);

    expect(staffList.body.data.cases.length).toBeGreaterThanOrEqual(1);

    await request(app.getHttpServer())
      .post("/api/v1/moderation/check")
      .set("Authorization", `Bearer ${userToken}`)
      .send({ text: "测试内容", source: "chat" })
      .expect(403);

    await request(app.getHttpServer())
      .post("/api/v1/moderation/check")
      .set("Authorization", `Bearer ${modToken}`)
      .send({ text: "测试内容", source: "chat" })
      .expect(201);

    await request(app.getHttpServer())
      .get("/api/v1/payments/refunds/review-queue")
      .set("Authorization", `Bearer ${userToken}`)
      .expect(403);

    await request(app.getHttpServer())
      .get("/api/v1/payments/refunds/review-queue")
      .set("Authorization", `Bearer ${modToken}`)
      .expect(403);

    await request(app.getHttpServer())
      .get("/api/v1/payments/refunds/review-queue")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
  });

  it("returns conversation evidence when message is linked", async () => {
    const { user, token: userToken } = await createUser("user");
    const { token: modToken } = await createUser("moderator");
    const companion = await prisma.companionProfile.findUniqueOrThrow({ where: { id: "c1" } });
    const conversation = await prisma.conversation.create({
      data: { externalId: "c1", userId: user.id, companionId: "c1" }
    });
    await prisma.order.create({
      data: {
        userId: user.id,
        companionId: "c1",
        themeId: "moderation-evidence-theme",
        durationMinutes: 30,
        amountCents: companion.pricePerHalfHour * 100,
        status: "paid",
        // Moderation evidence must be produced through a currently open paid chat window.
        scheduledAt: new Date(Date.now() + 5 * 60 * 1000),
        paidAt: new Date(),
        conversationId: conversation.id,
        companionNameSnapshot: companion.name,
        companionRoleSnapshot: companion.role,
        companionInitialsSnapshot: companion.initials,
        themeNameSnapshot: "审核证据测试"
      }
    });

    await request(app.getHttpServer())
      .post("/api/v1/conversations/c1/messages")
      .set("Authorization", `Bearer ${userToken}`)
      .send({ content: "加我微信私下聊转账", senderId: user.id })
      .expect(201);

    const openCases = await prisma.moderationCase.findMany({
      where: { source: "chat" },
      orderBy: { createdAt: "desc" },
      take: 1
    });
    expect(openCases.length).toBe(1);

    const evidence = await request(app.getHttpServer())
      .get(`/api/v1/admin/moderation/cases/${openCases[0].id}/conversation`)
      .set("Authorization", `Bearer ${modToken}`)
      .expect(200);

    expect(evidence.body.data.caseId).toBe(openCases[0].id);
    // targetId is external conversation id; messages may exist if message was stored
    expect(Array.isArray(evidence.body.data.messages)).toBe(true);
  });
});
