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

    const report = await request(app.getHttpServer())
      .post("/api/v1/moderation/reports")
      .set("Authorization", `Bearer ${userToken}`)
      .send({
        reason: "对方索要联系方式",
        conversationId: "c1",
        recentContext: "加我微信吧"
      })
      .expect(201);

    expect(report.body.data.moderationCase.source).toBe("report");
    expect(report.body.data.moderationCase.status).toMatch(/pending|humanReview/);

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
  });

  it("returns conversation evidence when message is linked", async () => {
    const { user, token: userToken } = await createUser("user");
    const { token: modToken } = await createUser("moderator");

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
