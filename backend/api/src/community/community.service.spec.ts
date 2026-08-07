import { CommunityService } from "./community.service";

describe("CommunityService", () => {
  const prisma = {
    communityPost: { findMany: jest.fn(), create: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn(), count: jest.fn() },
    communityLike: { upsert: jest.fn(), deleteMany: jest.fn() },
    communityPostReport: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), count: jest.fn() },
    moderationCase: { findFirst: jest.fn(), findUnique: jest.fn() },
    user: { findUnique: jest.fn() },
    $transaction: jest.fn(),
    $queryRaw: jest.fn().mockResolvedValue([])
  } as any;
  const moderation = { moderateAsync: jest.fn() } as any;
  const moderationCases = {
    createFromResult: jest.fn().mockResolvedValue({ id: "case-1" }),
    createReportCase: jest.fn().mockResolvedValue({ id: "report-case-1" }),
    appendCommunityReportToCase: jest.fn().mockResolvedValue(undefined)
  } as any;
  const service = new CommunityService(prisma, moderation, moderationCases);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(async (callback: any) => callback(prisma));
    prisma.moderationCase.findFirst.mockResolvedValue(null);
    prisma.moderationCase.findUnique.mockResolvedValue(null);
    prisma.communityPost.count.mockResolvedValue(0);
    prisma.communityPostReport.count.mockResolvedValue(0);
  });

  it("returns the caller's persisted like state", async () => {
    prisma.communityPost.findMany.mockResolvedValue([{
      id: "post-1", authorId: "author-1", kind: "femaleRequest", topic: "聊天", content: "今晚想找人聊聊",
      coverImageUrl: null, status: "approved", createdAt: new Date("2026-07-12T00:00:00Z"),
      author: { profile: { displayName: "小安" }, companionProfile: null }, likes: [{ userId: "viewer-1" }]
    }]);

    const result = await service.list("viewer-1");

    expect(prisma.communityPost.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: expect.arrayContaining([expect.objectContaining({ kind: "malePromotion" })])
      })
    }));
    expect(result.items[0]).toEqual(expect.objectContaining({ id: "post-1", isLiked: true, likeCount: 1 }));
  });

  it("lists only the caller's private report receipt ids and submission times", async () => {
    const createdAt = new Date("2026-07-21T01:00:00.000Z");
    prisma.communityPostReport.findMany.mockResolvedValue([{ id: "receipt-1", createdAt }]);
    prisma.communityPostReport.count.mockResolvedValue(1);

    await expect(service.listMyReportReceipts("reporter-1")).resolves.toEqual({
      items: [{ id: "receipt-1", submittedAt: createdAt.toISOString(), status: "received" }],
      pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 }
    });
    expect(prisma.communityPostReport.findMany).toHaveBeenCalledWith({
      where: { reporterUserId: "reporter-1" },
      select: { id: true, createdAt: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: 0,
      take: 20
    });
  });

  it("rejects a male promotion when the companion commercial profile is not verified", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "companion-user",
      accountStatus: "active",
      profile: { isVerified: true },
      companionProfile: {
        isVerified: true,
        isPublished: true,
        commercialProfile: { status: "suspended" }
      }
    });

    await expect(service.create("companion-user", {
      kind: "malePromotion",
      topic: "情绪倾听",
      content: "今晚可预约"
    })).rejects.toMatchObject({ code: "COMPANION_PROFILE_REQUIRED" });
    expect(moderation.moderateAsync).not.toHaveBeenCalled();
    expect(prisma.communityPost.create).not.toHaveBeenCalled();
  });

  it("rejects an unverified femaleRequest before moderation or any write", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      accountStatus: "active",
      profile: { displayName: "小安", isVerified: false },
      companionProfile: null
    });

    await expect(service.create("user-1", {
      kind: "femaleRequest",
      topic: "聊天",
      content: "今晚想找人聊聊"
    })).rejects.toMatchObject({
      code: "PUBLIC_INTERACTION_IDENTITY_REQUIRED",
      status: 403
    });
    expect(moderation.moderateAsync).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.communityPost.create).not.toHaveBeenCalled();
    expect(moderationCases.createFromResult).not.toHaveBeenCalled();
  });

  it("persists allowed posts after moderation", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      accountStatus: "active",
      profile: { displayName: "小安", isVerified: true },
      companionProfile: null
    });
    moderation.moderateAsync.mockResolvedValue({ decision: "allow" });
    prisma.communityPost.create.mockResolvedValue({
      id: "post-1", authorId: "user-1", kind: "femaleRequest", topic: "聊天", content: "今晚想找人聊聊",
      coverImageUrl: null, status: "approved", createdAt: new Date(),
      author: { profile: { displayName: "小安" }, companionProfile: null }, likes: []
    });

    const result = await service.create("user-1", { kind: "femaleRequest", topic: "聊天", content: "今晚想找人聊聊" });

    expect(moderation.moderateAsync).toHaveBeenCalledWith("聊天 今晚想找人聊聊", "community");
    expect(result.moderationStatus).toBe("approved");
    expect(moderationCases.createFromResult).not.toHaveBeenCalled();
  });

  it("throttles a new community post under the caller lock without changing account or content state", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      accountStatus: "active",
      profile: { displayName: "小安", isVerified: true },
      companionProfile: null
    });
    moderation.moderateAsync.mockResolvedValue({ decision: "allow" });
    prisma.communityPost.count.mockResolvedValue(3);

    await expect(service.create("user-1", {
      kind: "femaleRequest",
      topic: "聊天",
      content: "想找人聊聊"
    })).rejects.toMatchObject({ code: "COMMUNITY_WRITE_RATE_LIMITED", status: 429 });

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.communityPost.count).toHaveBeenCalledWith({
      where: { authorId: "user-1", createdAt: { gte: expect.any(Date) } }
    });
    expect(prisma.communityPost.create).not.toHaveBeenCalled();
    expect(moderationCases.createFromResult).not.toHaveBeenCalled();
  });

  it("rejects client-supplied cover URLs while the reviewed media pipeline is disabled", async () => {
    await expect(service.create("user-1", {
      kind: "malePromotion",
      topic: "倾听",
      content: "今晚可预约",
      coverImageUrl: "https://unreviewed.example/cover.jpg"
    })).rejects.toMatchObject({ code: "COMMUNITY_MEDIA_UNAVAILABLE", status: 409 });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.communityPost.create).not.toHaveBeenCalled();
  });

  it("keeps warned community posts out of the public feed and creates a review case", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      accountStatus: "active",
      profile: { displayName: "小安", isVerified: true },
      companionProfile: null
    });
    moderation.moderateAsync.mockResolvedValue({
      decision: "warn",
      riskLevel: "medium",
      priority: "high",
      score: 0.7,
      reasons: ["疑似引流"],
      matchedRules: ["community.promotion"],
      categories: ["fraudOrSpam"],
      policyVersion: "chat-v2",
      usedAI: false
    });
    prisma.communityPost.create.mockResolvedValue({
      id: "post-pending", authorId: "user-1", kind: "femaleRequest", topic: "兼职", content: "请私聊我",
      coverImageUrl: null, status: "pending", createdAt: new Date(),
      author: { profile: { displayName: "小安" }, companionProfile: null }, likes: []
    });

    const result = await service.create("user-1", { kind: "femaleRequest", topic: "兼职", content: "请私聊我" });

    expect(result.moderationStatus).toBe("pending");
    expect(moderationCases.createFromResult).toHaveBeenCalledWith(expect.objectContaining({
      source: "community",
      targetId: "post-pending",
      subjectUserId: "user-1"
    }));
  });

  it("creates one private, auditable report receipt for a currently visible post", async () => {
    const visiblePost = {
      id: "post-1",
      authorId: "author-1",
      topic: "聊天",
      content: "这是一条当前可见的公开内容"
    };
    const createdAt = new Date("2026-07-21T00:00:00.000Z");
    prisma.communityPost.findFirst
      .mockResolvedValueOnce(visiblePost)
      .mockResolvedValueOnce(visiblePost);
    prisma.communityPostReport.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    prisma.communityPostReport.create.mockResolvedValue({ id: "community-report-1", createdAt });
    prisma.communityPostReport.update.mockResolvedValue({ id: "community-report-1", createdAt, moderationCaseId: "report-case-1" });
    moderation.moderateAsync.mockResolvedValue({
      decision: "allow", riskLevel: "low", priority: "normal", score: 0.05,
      reasons: ["内容正常"], matchedRules: [], categories: ["normal"], policyVersion: "chat-v2", usedAI: false
    });

    await expect(service.reportPost("reporter-1", "post-1", { reason: "疑似在内容中引导私下联系" })).resolves.toEqual({
      report: { id: "community-report-1", submittedAt: createdAt.toISOString(), duplicate: false }
    });

    expect(prisma.communityPostReport.create).toHaveBeenCalledWith({
      data: { postId: "post-1", reporterUserId: "reporter-1" }
    });
    expect(moderation.moderateAsync).toHaveBeenCalledWith(expect.stringContaining("公开内容：这是一条当前可见的公开内容"), "report");
    expect(moderationCases.createReportCase).toHaveBeenCalledWith(expect.objectContaining({
      targetId: "post-1",
      subjectUserId: "author-1",
      actorId: "reporter-1",
      db: prisma,
      auditMetadata: {
        source: "community_post_report",
        targetType: "community_post",
        postId: "post-1",
        reportId: "community-report-1"
      }
    }));
    expect(prisma.communityPostReport.update).toHaveBeenCalledWith({
      where: { id: "community-report-1" },
      data: { moderationCaseId: "report-case-1" }
    });
    expect(moderationCases.appendCommunityReportToCase).not.toHaveBeenCalled();
  });

  it("attaches a later independent report to the same locked, still-open community case", async () => {
    const visiblePost = {
      id: "post-1",
      authorId: "author-1",
      topic: "聊天",
      content: "这是一条当前可见的公开内容"
    };
    const createdAt = new Date("2026-07-21T00:05:00.000Z");
    prisma.communityPost.findFirst
      .mockResolvedValueOnce(visiblePost)
      .mockResolvedValueOnce(visiblePost);
    prisma.communityPostReport.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    prisma.communityPostReport.create.mockResolvedValue({ id: "community-report-2", createdAt });
    prisma.communityPostReport.update.mockResolvedValue({ id: "community-report-2", createdAt, moderationCaseId: "report-case-1" });
    prisma.moderationCase.findFirst.mockResolvedValue({ id: "report-case-1", status: "pending" });
    prisma.moderationCase.findUnique.mockResolvedValue({ id: "report-case-1", status: "pending" });
    moderation.moderateAsync.mockResolvedValue({
      decision: "review", riskLevel: "low", priority: "normal", score: 0.42,
      reasons: ["疑似广告"], matchedRules: ["ads.promo"], categories: ["fraudOrSpam"], policyVersion: "chat-v2", usedAI: false
    });

    await expect(service.reportPost("reporter-2", "post-1", { reason: "疑似重复引流" })).resolves.toEqual({
      report: { id: "community-report-2", submittedAt: createdAt.toISOString(), duplicate: false }
    });

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(3);
    expect(prisma.moderationCase.findFirst).toHaveBeenCalledWith({
      where: {
        source: "report",
        status: { in: ["pending", "autoReviewing", "humanReview"] },
        communityPostReports: { some: { postId: "post-1" } }
      },
      orderBy: { createdAt: "asc" },
      select: { id: true, status: true }
    });
    expect(prisma.communityPostReport.update).toHaveBeenCalledWith({
      where: { id: "community-report-2" },
      data: { moderationCaseId: "report-case-1" }
    });
    expect(moderationCases.createReportCase).not.toHaveBeenCalled();
    expect(moderationCases.appendCommunityReportToCase).toHaveBeenCalledWith(expect.objectContaining({
      caseId: "report-case-1",
      reportId: "community-report-2",
      postId: "post-1",
      reporterUserId: "reporter-2",
      db: prisma
    }));
  });

  it("starts a new case when an administrator closed the selected case before the shared case lock", async () => {
    const visiblePost = { id: "post-1", authorId: "author-1", topic: "聊天", content: "公开内容" };
    const createdAt = new Date("2026-07-21T00:10:00.000Z");
    prisma.communityPost.findFirst
      .mockResolvedValueOnce(visiblePost)
      .mockResolvedValueOnce(visiblePost);
    prisma.communityPostReport.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    prisma.communityPostReport.create.mockResolvedValue({ id: "community-report-3", createdAt });
    prisma.communityPostReport.update.mockResolvedValue({ id: "community-report-3", createdAt, moderationCaseId: "report-case-2" });
    prisma.moderationCase.findFirst.mockResolvedValue({ id: "report-case-1", status: "pending" });
    prisma.moderationCase.findUnique.mockResolvedValue({ id: "report-case-1", status: "resolved" });
    moderation.moderateAsync.mockResolvedValue({
      decision: "allow", riskLevel: "low", priority: "normal", score: 0.05,
      reasons: ["内容正常"], matchedRules: [], categories: ["normal"], policyVersion: "chat-v2", usedAI: false
    });
    moderationCases.createReportCase.mockResolvedValue({ id: "report-case-2" });

    await service.reportPost("reporter-3", "post-1", { reason: "再次发现可疑内容" });

    expect(moderationCases.appendCommunityReportToCase).not.toHaveBeenCalled();
    expect(moderationCases.createReportCase).toHaveBeenCalledWith(expect.objectContaining({
      targetId: "post-1",
      auditMetadata: expect.objectContaining({ reportId: "community-report-3" }),
      db: prisma
    }));
  });

  it("returns the caller's prior receipt without re-moderating or exposing other reports", async () => {
    const createdAt = new Date("2026-07-21T00:00:00.000Z");
    prisma.communityPost.findFirst.mockResolvedValue({
      id: "post-1", authorId: "author-1", topic: "聊天", content: "公开内容"
    });
    prisma.communityPostReport.findUnique.mockResolvedValue({ id: "community-report-1", createdAt });

    await expect(service.reportPost("reporter-1", "post-1", { reason: "疑似骚扰内容" })).resolves.toEqual({
      report: { id: "community-report-1", submittedAt: createdAt.toISOString(), duplicate: true }
    });
    expect(moderation.moderateAsync).not.toHaveBeenCalled();
    expect(prisma.communityPostReport.create).not.toHaveBeenCalled();
    expect(prisma.communityPostReport.count).not.toHaveBeenCalled();
  });

  it("keeps a repeat discovered inside the locked report transaction free of the report quota", async () => {
    const visiblePost = { id: "post-1", authorId: "author-1", topic: "聊天", content: "公开内容" };
    const createdAt = new Date("2026-07-21T00:20:00.000Z");
    prisma.communityPost.findFirst
      .mockResolvedValueOnce(visiblePost)
      .mockResolvedValueOnce(visiblePost);
    prisma.communityPostReport.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "community-report-existing", createdAt });
    moderation.moderateAsync.mockResolvedValue({
      decision: "allow", riskLevel: "low", priority: "normal", score: 0.05,
      reasons: ["内容正常"], matchedRules: [], categories: ["normal"], policyVersion: "chat-v2", usedAI: false
    });

    await expect(service.reportPost("reporter-1", "post-1", { reason: "疑似违规内容" })).resolves.toEqual({
      report: { id: "community-report-existing", submittedAt: createdAt.toISOString(), duplicate: true }
    });
    expect(prisma.communityPostReport.count).not.toHaveBeenCalled();
    expect(prisma.communityPostReport.create).not.toHaveBeenCalled();
  });

  it("throttles only a new distinct report after the duplicate check under the same caller lock", async () => {
    const visiblePost = { id: "post-1", authorId: "author-1", topic: "聊天", content: "公开内容" };
    prisma.communityPost.findFirst
      .mockResolvedValueOnce(visiblePost)
      .mockResolvedValueOnce(visiblePost);
    prisma.communityPostReport.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    prisma.communityPostReport.count.mockResolvedValue(8);
    moderation.moderateAsync.mockResolvedValue({
      decision: "allow", riskLevel: "low", priority: "normal", score: 0.05,
      reasons: ["内容正常"], matchedRules: [], categories: ["normal"], policyVersion: "chat-v2", usedAI: false
    });

    await expect(service.reportPost("reporter-1", "post-1", { reason: "疑似违规内容" }))
      .rejects.toMatchObject({ code: "COMMUNITY_WRITE_RATE_LIMITED", status: 429 });

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    expect(prisma.communityPostReport.count).toHaveBeenCalledWith({
      where: { reporterUserId: "reporter-1", createdAt: { gte: expect.any(Date) } }
    });
    expect(prisma.communityPostReport.create).not.toHaveBeenCalled();
    expect(moderationCases.createReportCase).not.toHaveBeenCalled();
    expect(moderationCases.appendCommunityReportToCase).not.toHaveBeenCalled();
  });

  it("rejects stale, own, or sensitive-data reports before creating an intake signal", async () => {
    prisma.communityPost.findFirst.mockResolvedValue(null);
    await expect(service.reportPost("reporter-1", "missing-post", { reason: "疑似违规" }))
      .rejects.toMatchObject({ code: "POST_NOT_FOUND" });

    prisma.communityPost.findFirst.mockResolvedValue({
      id: "post-1", authorId: "reporter-1", topic: "聊天", content: "公开内容"
    });
    await expect(service.reportPost("reporter-1", "post-1", { reason: "疑似违规" }))
      .rejects.toMatchObject({ code: "CANNOT_REPORT_OWN_POST" });

    await expect(service.reportPost("reporter-1", "post-1", { reason: "请联系 13800138000" }))
      .rejects.toMatchObject({ code: "REPORT_REASON_SENSITIVE_DATA" });
    expect(prisma.communityPostReport.create).not.toHaveBeenCalled();
    expect(moderation.moderateAsync).not.toHaveBeenCalled();
  });
});
