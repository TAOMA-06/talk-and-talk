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
import * as publicInteractionIdentity from "../src/users/public-interaction-identity.gate";
import {
  grantCurrentCustomerAdultEligibility,
  grantCurrentLegalConsent
} from "./legal-consent-fixture";
import { issueSessionBoundAccessToken } from "./session-token-fixture";

describe("Conversations (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let identityGateSpy: jest.SpyInstance;

  beforeAll(async () => {
    // Downstream chat state-machine integration behind a hypothetical approved
    // identity adapter. The real first-release rejection is covered by the
    // orders/payments E2E plus the shared gate and conversation unit suites.
    identityGateSpy = jest.spyOn(publicInteractionIdentity, "assertPublicInteractionIdentity")
      .mockImplementation(() => undefined);
    process.env.NODE_ENV = "test";
    process.env.API_PREFIX = "api/v1";
    process.env.CORS_ORIGINS = "http://localhost:3000";
    process.env.JWT_ACCESS_SECRET = "e2e-access-secret";
    process.env.JWT_REFRESH_SECRET = "e2e-refresh-secret";
    process.env.SMS_PROVIDER = "mock";
    // Keep the API-created paid-chat scenario inside the default 15-minute
    // chat window while still leaving a deterministic confirmation/payment gap.
    process.env.ORDER_RESPONSE_WINDOW_MINUTES = "5";

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
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
    identityGateSpy.mockRestore();
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
        await prisma.userAccountAppeal.deleteMany().catch(() => undefined);
    await prisma.customerAdultEligibility.deleteMany().catch(() => undefined);
    await prisma.userAccountAction.deleteMany().catch(() => undefined);
    await prisma.identityVerificationRequest.deleteMany().catch(() => undefined);
    await prisma.staffCredential.deleteMany().catch(() => undefined);
    await prisma.legalConsentReceipt.deleteMany().catch(() => undefined);
    await prisma.userProfile.deleteMany();
    await prisma.user.deleteMany();
  }

  async function createUser(displayName = "小楷", role: "user" | "companion" = "user") {
    const user = await prisma.user.create({
      data: {
        role,
        profile: {
          create: {
            displayName,
            phone: "+8613800138000",
            age: 22,
            gender: "male"
          }
        }
      }
    });
    await grantCurrentLegalConsent(prisma, user.id);
    await grantCurrentCustomerAdultEligibility(prisma, user.id);

    const token = await issueSessionBoundAccessToken(prisma, jwt, user);
    return { user, token };
  }

  async function attachPaidOrder(userId: string, companionId: string, conversationId: string) {
    const companion = await prisma.companionProfile.findUniqueOrThrow({ where: { id: companionId } });
    return prisma.order.create({
      data: {
        userId,
        companionId,
        themeId: "t1",
        durationMinutes: 30,
        amountCents: companion.pricePerHalfHour * 100,
        currency: "CNY",
        status: "paid",
        // Paid chat opens only inside the configured pre-service window.
        scheduledAt: new Date(Date.now() + 5 * 60 * 1000),
        companionNameSnapshot: companion.name,
        companionRoleSnapshot: companion.role,
        companionInitialsSnapshot: companion.initials,
        themeNameSnapshot: "情绪倾听",
        refundPolicyVersionSnapshot: "e2e-test-v1",
        refundRequestWindowHoursSnapshot: 72,
        conversationId,
        paidAt: new Date()
      }
    });
  }

  async function activateConversation(userId: string, companionId: string) {
    const conversation = await prisma.conversation.create({
      data: {
        externalId: companionId,
        userId,
        companionId
      }
    });
    await attachPaidOrder(userId, companionId, conversation.id);
    return conversation;
  }

  it("keeps the legacy text request compatible while returning delivery state without internal evidence", async () => {
    const { user, token } = await createUser();
    await activateConversation(user.id, "c1");

    await request(app.getHttpServer())
      .post("/api/v1/conversations/c1/messages")
      .set("Authorization", `Bearer ${token}`)
      .send({ content: "今天有点累，想有人听我说。", senderId: "client-user" })
      .expect(201)
      .expect(({ body }) => {
        expect(body.data.moderation.decision).toBe("allow");
        expect(body.data.moderation).toEqual({
          decision: "allow",
          riskLevel: "low",
          deliveryStatus: "published",
          caseId: null,
          appealEligible: false
        });
        expect(body.data.message.content).toBe("今天有点累，想有人听我说。");
        expect(body.data.safetyMessage).toBeNull();
        expect(body.data.companionReply).toBeNull();
        expect(body.data.moderationCase).toBeUndefined();
      });

    await request(app.getHttpServer())
      .get("/api/v1/conversations/c1/messages")
      .set("Authorization", `Bearer ${token}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.messages.map((item: { content: string }) => item.content)).toEqual([
          "今天有点累，想有人听我说。"
        ]);
      });
  });

  it("keeps a blocked message sender-only while never delivering it to the other participant", async () => {
    const { user, token } = await createUser();
    await activateConversation(user.id, "c1");

    await request(app.getHttpServer())
      .post("/api/v1/conversations/c1/messages")
      .set("Authorization", `Bearer ${token}`)
      .send({ content: "我们加微信线下见面吧", senderId: "client-user" })
      .expect(201)
      .expect(({ body }) => {
        expect(body.data.moderation.decision).toBe("block");
        expect(body.data.message).toBeNull();
        expect(body.data.safetyMessage.type).toBe("safety");
        expect(body.data.companionReply).toBeNull();
        expect(body.data.moderationCase).toBeUndefined();
      });

    await request(app.getHttpServer())
      .get("/api/v1/conversations/c1/messages")
      .set("Authorization", `Bearer ${token}`)
      .expect(200)
      .expect(({ body }) => {
        const messages = body.data.messages as Array<{ content: string; moderationStatus: string; visibility: string }>;
        const blocked = messages.find((item) => item.content === "我们加微信线下见面吧");
        expect(blocked).toEqual(expect.objectContaining({ moderationStatus: "blocked", visibility: "senderOnly" }));
        const contents = messages.map((item) => item.content);
        expect(contents.some((content: string) => content.includes("安全提醒"))).toBe(true);
      });
  });

  it("stores risky cases internally while denying the user access to the case queue", async () => {
    const { user, token } = await createUser();
    await activateConversation(user.id, "c1");

    await request(app.getHttpServer())
      .post("/api/v1/conversations/c1/messages")
      .set("Authorization", `Bearer ${token}`)
      .send({ content: "我们加微信聊吧", senderId: "client-user" })
      .expect(201)
      .expect(({ body }) => {
        expect(body.data.moderation.decision).toBe("block");
        expect(body.data.message).toBeNull();
        expect(body.data.safetyMessage.type).toBe("safety");
        expect(body.data.companionReply).toBeNull();
        expect(body.data.moderationCase).toBeUndefined();
        expect(body.data.moderation.matchedRules).toBeUndefined();
        expect(body.data.moderation.reasons).toBeUndefined();
      });

    await request(app.getHttpServer())
      .get("/api/v1/moderation/cases")
      .set("Authorization", `Bearer ${token}`)
      .expect(403);

    const internalCase = await prisma.moderationCase.findFirst({
      where: { content: "我们加微信聊吧", decision: "block" }
    });
    expect(internalCase).not.toBeNull();
  });

  it("returns conversations with the actual last message and unread count", async () => {
    const { user, token } = await createUser();
    await activateConversation(user.id, "c2");

    await request(app.getHttpServer())
      .post("/api/v1/conversations/c2/messages")
      .set("Authorization", `Bearer ${token}`)
      .send({ content: "可以聊聊职场压力吗" })
      .expect(201);

    await request(app.getHttpServer())
      .get("/api/v1/conversations")
      .set("Authorization", `Bearer ${token}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.conversations[0].id).toBe("c2");
        expect(body.data.conversations[0].participant.name).toBe("许澈");
        expect(body.data.conversations[0].lastMessage.content).toBe("可以聊聊职场压力吗");
        expect(body.data.conversations[0].unreadCount).toBe(0);
      });
  });

  it("does not expose a sender's pending-review message or safety notice to the companion owner", async () => {
    const customer = await createUser("待审客户");
    const owner = await createUser("陪伴者实名", "companion");
    await prisma.companionProfile.update({ where: { id: "c1" }, data: { ownerUserId: owner.user.id } });
    const conversation = await activateConversation(customer.user.id, "c1");

    await request(app.getHttpServer())
      .post("/api/v1/conversations/c1/messages")
      .set("Authorization", `Bearer ${customer.token}`)
      .send({ content: "你真废物" })
      .expect(201)
      .expect(({ body }) => {
        expect(body.data.moderation.deliveryStatus).toBe("pendingReview");
        expect(body.data.message).toMatchObject({ visibility: "senderOnly" });
      });

    await request(app.getHttpServer())
      .get(`/api/v1/conversations/${conversation.id}/messages`)
      .set("Authorization", `Bearer ${owner.token}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.messages.map((item: { content: string }) => item.content)).not.toContain("你真废物");
        expect(body.data.messages.some((item: { type: string }) => item.type === "safety")).toBe(false);
      });
  });

  it("returns the newest messages first and paginates toward older messages with stable ordering", async () => {
    const { user, token } = await createUser();
    const conversation = await prisma.conversation.create({
      data: {
        id: "conv-stable",
        externalId: "c1",
        userId: user.id,
        companionId: "c1"
      }
    });
    await attachPaidOrder(user.id, "c1", conversation.id);
    const createdAt = new Date("2026-07-09T02:00:00.000Z");
    await prisma.message.createMany({
      data: [
        { id: "m-a", conversationId: conversation.id, senderId: "other-user", content: "A", type: "text", createdAt },
        { id: "m-b", conversationId: conversation.id, senderId: "other-user", content: "B", type: "text", createdAt },
        { id: "m-c", conversationId: conversation.id, senderId: "other-user", content: "C", type: "text", createdAt }
      ]
    });

    await request(app.getHttpServer())
      .get("/api/v1/conversations/c1/messages")
      .query({ limit: 2 })
      .set("Authorization", `Bearer ${token}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.messages.map((item: { id: string }) => item.id)).toEqual(["m-b", "m-c"]);
        expect(body.data.pagination.nextCursor).toBe("m-b");
        expect(body.data.pagination.hasMore).toBe(true);
      });

    await request(app.getHttpServer())
      .get("/api/v1/conversations")
      .set("Authorization", `Bearer ${token}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.conversations[0].unreadCount).toBe(0);
      });

    // A later message in the same millisecond is still unread because the read
    // cursor includes the stable id tie-breaker.
    await prisma.message.create({
      data: {
        id: "m-d",
        conversationId: conversation.id,
        senderId: "other-user",
        content: "D",
        type: "text",
        createdAt
      }
    });
    await request(app.getHttpServer())
      .get("/api/v1/conversations")
      .set("Authorization", `Bearer ${token}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.conversations[0].unreadCount).toBe(1);
      });

    await request(app.getHttpServer())
      .get("/api/v1/conversations/c1/messages")
      .query({ limit: 2, cursor: "m-b" })
      .set("Authorization", `Bearer ${token}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.messages.map((item: { id: string }) => item.id)).toEqual(["m-a"]);
        expect(body.data.pagination.hasMore).toBe(false);
      });

    // Loading history must not move the read cursor backward.
    await request(app.getHttpServer())
      .get("/api/v1/conversations")
      .set("Authorization", `Bearer ${token}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.conversations[0].unreadCount).toBe(1);
      });

    await request(app.getHttpServer())
      .get("/api/v1/conversations/c1/messages")
      .query({ limit: 2 })
      .set("Authorization", `Bearer ${token}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.messages.map((item: { id: string }) => item.id)).toEqual(["m-c", "m-d"]);
      });
    await request(app.getHttpServer())
      .get("/api/v1/conversations")
      .set("Authorization", `Bearer ${token}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.conversations[0].unreadCount).toBe(0);
      });
  });

  it("keeps the latest message visible when a conversation has more than fifty messages", async () => {
    const { user, token } = await createUser("长会话客户");
    const conversation = await activateConversation(user.id, "c2");
    const baseTime = new Date("2026-07-09T03:00:00.000Z").getTime();
    await prisma.message.createMany({
      data: Array.from({ length: 55 }, (_, index) => {
        const sequence = String(index + 1).padStart(3, "0");
        return {
          id: `bulk-${sequence}`,
          conversationId: conversation.id,
          senderId: "other-user",
          content: `消息 ${sequence}`,
          type: "text" as const,
          createdAt: new Date(baseTime + index * 1_000)
        };
      })
    });

    const latest = await request(app.getHttpServer())
      .get("/api/v1/conversations/c2/messages")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(latest.body.data.messages).toHaveLength(50);
    expect(latest.body.data.messages[0].id).toBe("bulk-006");
    expect(latest.body.data.messages.at(-1)).toMatchObject({
      id: "bulk-055",
      content: "消息 055"
    });
    expect(latest.body.data.pagination).toMatchObject({
      nextCursor: "bulk-006",
      hasMore: true
    });

    await request(app.getHttpServer())
      .get("/api/v1/conversations/c2/messages")
      .query({ cursor: latest.body.data.pagination.nextCursor })
      .set("Authorization", `Bearer ${token}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.messages.map((item: { id: string }) => item.id)).toEqual([
          "bulk-001",
          "bulk-002",
          "bulk-003",
          "bulk-004",
          "bulk-005"
        ]);
        expect(body.data.pagination.hasMore).toBe(false);
      });
  });

  it("requires payment, then lets the customer and companion owner chat while rejecting a third party", async () => {
    const customer = await createUser("付费客户");
    const companionOwner = await createUser("服务者实名", "companion");
    const thirdParty = await createUser("无关用户");
    await prisma.userProfile.update({
      where: { userId: companionOwner.user.id },
      data: { isVerified: true, safetyScore: 100 }
    });
    await prisma.companionProfile.update({
      where: { id: "c1" },
      data: { ownerUserId: companionOwner.user.id }
    });

    await request(app.getHttpServer())
      .post("/api/v1/conversations/c1/messages")
      .set("Authorization", `Bearer ${customer.token}`)
      .send({ content: "未支付不能开聊" })
      .expect(403)
      .expect(({ body }) => {
        expect(body.error.code).toBe("PAYMENT_REQUIRED");
      });

    const order = await request(app.getHttpServer())
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${customer.token}`)
      .send({
        companionId: "c1",
        themeId: "t1",
        durationMinutes: 30,
        scheduledAt: new Date(Date.now() + 12 * 60 * 1000).toISOString()
      })
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

    // Reading once marks the payment activation message as read for the customer.
    await request(app.getHttpServer())
      .get("/api/v1/conversations/c1/messages")
      .set("Authorization", `Bearer ${customer.token}`)
      .expect(200);

    await request(app.getHttpServer())
      .post("/api/v1/conversations/c1/messages")
      .set("Authorization", `Bearer ${customer.token}`)
      .send({ content: "支付完成，请问可以开始了吗？", senderId: companionOwner.user.id })
      .expect(201)
      .expect(({ body }) => {
        expect(body.data.message.senderId).toBe(customer.user.id);
        expect(body.data.message.senderName).toBe("付费客户");
        expect(body.data.message.conversationId).toBe("c1");
      });

    const ownerList = await request(app.getHttpServer())
      .get("/api/v1/conversations")
      .set("Authorization", `Bearer ${companionOwner.token}`)
      .expect(200);
    expect(ownerList.body.data.conversations).toHaveLength(1);
    const ownerConversation = ownerList.body.data.conversations[0];
    expect(ownerConversation.id).not.toBe("c1");
    expect(ownerConversation.viewerRole).toBe("companion");
    expect(ownerConversation.companionId).toBe("c1");
    expect(ownerConversation.participant).toMatchObject({
      id: customer.user.id,
      kind: "customer",
      name: "付费客户"
    });
    expect(ownerConversation.unreadCount).toBe(2);

    await request(app.getHttpServer())
      .get(`/api/v1/conversations/${ownerConversation.id}/messages`)
      .set("Authorization", `Bearer ${companionOwner.token}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.messages.at(-1)).toMatchObject({
          conversationId: ownerConversation.id,
          senderId: customer.user.id,
          content: "支付完成，请问可以开始了吗？"
        });
      });

    await request(app.getHttpServer())
      .get("/api/v1/conversations")
      .set("Authorization", `Bearer ${companionOwner.token}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.conversations[0].unreadCount).toBe(0);
      });

    await request(app.getHttpServer())
      .post(`/api/v1/conversations/${ownerConversation.id}/messages`)
      .set("Authorization", `Bearer ${companionOwner.token}`)
      .send({ content: "可以，我已经看到你的订单。", senderId: customer.user.id })
      .expect(201)
      .expect(({ body }) => {
        expect(body.data.message).toMatchObject({
          conversationId: ownerConversation.id,
          senderId: companionOwner.user.id,
          senderName: "林屿"
        });
      });

    await request(app.getHttpServer())
      .get("/api/v1/conversations")
      .set("Authorization", `Bearer ${customer.token}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.conversations[0]).toMatchObject({
          id: "c1",
          viewerRole: "customer",
          unreadCount: 1
        });
        expect(body.data.conversations[0].lastMessage).toMatchObject({
          conversationId: "c1",
          senderId: companionOwner.user.id
        });
      });

    await request(app.getHttpServer())
      .get("/api/v1/conversations/c1/messages")
      .set("Authorization", `Bearer ${customer.token}`)
      .expect(200);
    await request(app.getHttpServer())
      .get("/api/v1/conversations")
      .set("Authorization", `Bearer ${customer.token}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.conversations[0].unreadCount).toBe(0);
      });

    await request(app.getHttpServer())
      .get(`/api/v1/conversations/${ownerConversation.id}/messages`)
      .set("Authorization", `Bearer ${thirdParty.token}`)
      .expect(404);
    await request(app.getHttpServer())
      .post(`/api/v1/conversations/${ownerConversation.id}/messages`)
      .set("Authorization", `Bearer ${thirdParty.token}`)
      .send({ content: "尝试越权" })
      .expect(404);
  });
});
