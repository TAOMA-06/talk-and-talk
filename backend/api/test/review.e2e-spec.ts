import { createHmac } from "node:crypto";

import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcrypt";
import request from "supertest";

import { AppModule } from "../src/app.module";
import { encryptTotpSecret } from "../src/auth/staff-auth.crypto";
import { EnvelopeInterceptor } from "../src/common/envelope/envelope.interceptor";
import { HttpExceptionFilter } from "../src/common/errors/http-exception.filter";
import { PrismaService } from "../src/database/prisma.service";
import { seedDatabase } from "../src/database/seed";

const TOTP_SECRET = "JBSWY3DPEHPK3PXP";
const REVIEW_PASSWORD = "review-e2e-password";
const REVIEW_TOTP_KEY = "review-e2e-totp-encryption-key";

describe("Independent review HTTP surface (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.API_PREFIX = "api/v1";
    process.env.JWT_ACCESS_SECRET = "e2e-access-secret";
    process.env.JWT_REFRESH_SECRET = "e2e-refresh-secret";
    process.env.REVIEW_JWT_ACCESS_SECRET = "e2e-review-access-secret";
    process.env.REVIEW_JWT_REFRESH_SECRET = "e2e-review-refresh-secret";
    process.env.REVIEW_TOTP_ENCRYPTION_KEY = REVIEW_TOTP_KEY;
    process.env.SMS_PROVIDER = "mock";

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    app.useGlobalInterceptors(new EnvelopeInterceptor());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    prisma = moduleRef.get(PrismaService);
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
    await prisma.reviewSession.deleteMany();
    await prisma.reviewAuditLog.deleteMany();
    await prisma.moderationActionLog.deleteMany();
    await prisma.moderationEvidence.deleteMany();
    await prisma.moderationCase.deleteMany();
    await prisma.messageReadState.deleteMany();
    await prisma.message.deleteMany();
    await prisma.conversation.deleteMany();
    await prisma.reviewStaff.deleteMany();
    await prisma.companionServiceTag.deleteMany();
    await prisma.serviceTag.deleteMany();
    await prisma.companionProfile.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.verificationCode.deleteMany();
    await prisma.authIdentity.deleteMany();
    await prisma.legalConsentReceipt.deleteMany().catch(() => undefined);
    await prisma.userProfile.deleteMany();
    await prisma.user.deleteMany();
  }

  it("logs in, lists cases, gates evidence, and dismisses a case", async () => {
    await prisma.reviewStaff.create({
      data: {
        username: "reviewer.e2e",
        displayName: "E2E 审核员",
        role: "reviewer",
        status: "active",
        passwordHash: await bcrypt.hash(REVIEW_PASSWORD, 12),
        totpSecretCiphertext: encryptTotpSecret(TOTP_SECRET, REVIEW_TOTP_KEY)
      }
    });
    const customer = await prisma.user.create({
      data: {
        role: "user",
        profile: { create: { displayName: "审核证据用户" } }
      }
    });
    const conversation = await prisma.conversation.create({
      data: {
        externalId: "review-e2e-conversation",
        userId: customer.id,
        companionId: "c1"
      }
    });
    const message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        senderId: customer.id,
        content: "这是一条待独立审核的测试消息",
        type: "text",
        moderationStatus: "pendingReview",
        visibility: "senderOnly",
        moderationDecision: "review"
      }
    });
    const moderationCase = await prisma.moderationCase.create({
      data: {
        title: "E2E 独立审核案件",
        category: "实时风控",
        riskLevel: "medium",
        status: "pending",
        source: "chat",
        content: message.content,
        targetId: "c1",
        conversationId: conversation.id,
        messageId: message.id,
        subjectUserId: customer.id,
        aiScore: 0.72,
        aiReason: "e2e review coverage",
        decision: "review",
        matchedRules: ["e2e.review"],
        usedAI: false
      }
    });

    const login = await request(app.getHttpServer())
      .post("/api/v1/review/auth/login")
      .send({
        username: "reviewer.e2e",
        password: REVIEW_PASSWORD,
        totpCode: currentTotp(TOTP_SECRET)
      })
      .expect(201);
    const reviewToken = login.body.data.accessToken as string;

    await request(app.getHttpServer())
      .get(`/api/v1/review/cases/${moderationCase.id}/conversation`)
      .expect(401);

    await request(app.getHttpServer())
      .get("/api/v1/review/cases")
      .set("Authorization", `Bearer ${reviewToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.cases).toEqual(expect.arrayContaining([
          expect.objectContaining({ id: moderationCase.id, status: "pending" })
        ]));
      });

    await request(app.getHttpServer())
      .get(`/api/v1/review/cases/${moderationCase.id}/conversation`)
      .set("Authorization", `Bearer ${reviewToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.anchorMessageId).toBe(message.id);
        expect(body.data.anchorMessage).toEqual(expect.objectContaining({
          id: message.id,
          content: message.content
        }));
      });

    await request(app.getHttpServer())
      .post(`/api/v1/review/cases/${moderationCase.id}/actions`)
      .set("Authorization", `Bearer ${reviewToken}`)
      .send({ action: "dismiss", note: "E2E evidence reviewed" })
      .expect(201)
      .expect(({ body }) => {
        expect(body.data.case.status).toBe("dismissed");
        expect(body.data.action.action).toBe("dismiss");
      });
  });
});

function currentTotp(secret: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const character of secret) {
    bits += alphabet.indexOf(character).toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  const counter = Math.floor(Date.now() / 30_000);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", Buffer.from(bytes)).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(binary).padStart(6, "0");
}
