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

describe("Conversations (e2e)", () => {
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

  async function createUser() {
    const user = await prisma.user.create({
      data: {
        role: "user",
        profile: {
          create: {
            displayName: "小楷",
            phone: "+8613800138000",
            age: 22,
            gender: "male"
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

  it("writes a normal user message without exposing internal moderation data", async () => {
    const { token } = await createUser();

    await request(app.getHttpServer())
      .post("/api/v1/conversations/c1/messages")
      .set("Authorization", `Bearer ${token}`)
      .send({ content: "今天有点累，想有人听我说。", senderId: "client-user" })
      .expect(201)
      .expect(({ body }) => {
        expect(body.data.moderation.decision).toBe("allow");
        expect(Object.keys(body.data.moderation).sort()).toEqual(["decision", "riskLevel"]);
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

  it("blocks risky content without writing the original chat message", async () => {
    const { token } = await createUser();

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
        const contents = body.data.messages.map((item: { content: string }) => item.content);
        expect(contents).not.toContain("我们加微信线下见面吧");
        expect(contents.some((content: string) => content.includes("安全提醒"))).toBe(true);
      });
  });

  it("stores risky cases internally while denying the user access to the case queue", async () => {
    const { token } = await createUser();

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

  it("returns conversations with last message and unread count", async () => {
    const { token } = await createUser();

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
        expect(body.data.conversations[0].lastMessage.content).toBe("我在，先慢慢说。我们可以继续在平台内沟通。");
        expect(body.data.conversations[0].unreadCount).toBeGreaterThanOrEqual(1);
      });
  });

  it("paginates messages with stable createdAt and id ordering", async () => {
    const { user, token } = await createUser();
    const conversation = await prisma.conversation.create({
      data: {
        id: "conv-stable",
        externalId: "c1",
        userId: user.id,
        companionId: "c1"
      }
    });
    const createdAt = new Date("2026-07-09T02:00:00.000Z");
    await prisma.message.createMany({
      data: [
        { id: "m-a", conversationId: conversation.id, senderId: user.id, content: "A", type: "text", createdAt },
        { id: "m-b", conversationId: conversation.id, senderId: user.id, content: "B", type: "text", createdAt },
        { id: "m-c", conversationId: conversation.id, senderId: user.id, content: "C", type: "text", createdAt }
      ]
    });

    await request(app.getHttpServer())
      .get("/api/v1/conversations/c1/messages")
      .query({ limit: 2 })
      .set("Authorization", `Bearer ${token}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.messages.map((item: { id: string }) => item.id)).toEqual(["m-a", "m-b"]);
        expect(body.data.pagination.nextCursor).toBe("m-b");
        expect(body.data.pagination.hasMore).toBe(true);
      });

    await request(app.getHttpServer())
      .get("/api/v1/conversations/c1/messages")
      .query({ limit: 2, cursor: "m-b" })
      .set("Authorization", `Bearer ${token}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.messages.map((item: { id: string }) => item.id)).toEqual(["m-c"]);
        expect(body.data.pagination.hasMore).toBe(false);
      });
  });
});
