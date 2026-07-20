import { CommunityService } from "./community.service";

describe("CommunityService", () => {
  const prisma = {
    communityPost: { findMany: jest.fn(), create: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn() },
    communityLike: { upsert: jest.fn(), deleteMany: jest.fn() },
    user: { findUnique: jest.fn() },
    $transaction: jest.fn()
  } as any;
  const moderation = { moderateAsync: jest.fn() } as any;
  const moderationCases = { createFromResult: jest.fn().mockResolvedValue({ id: "case-1" }) } as any;
  const service = new CommunityService(prisma, moderation, moderationCases);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(async (callback: any) => callback(prisma));
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

  it("persists allowed posts after moderation", async () => {
    prisma.user.findUnique.mockResolvedValue({ id: "user-1", profile: { displayName: "小安" }, companionProfile: null });
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
    prisma.user.findUnique.mockResolvedValue({ id: "user-1", profile: { displayName: "小安" }, companionProfile: null });
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
});
