import { CommunityService } from "./community.service";

describe("CommunityService", () => {
  const prisma = {
    communityPost: { findMany: jest.fn(), create: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn() },
    communityLike: { upsert: jest.fn(), deleteMany: jest.fn() },
    user: { findUnique: jest.fn() }
  } as any;
  const moderation = { moderateAsync: jest.fn() } as any;
  const moderationCases = { createFromResult: jest.fn().mockResolvedValue({ id: "case-1" }) } as any;
  const service = new CommunityService(prisma, moderation, moderationCases);

  beforeEach(() => jest.clearAllMocks());

  it("returns the caller's persisted like state", async () => {
    prisma.communityPost.findMany.mockResolvedValue([{
      id: "post-1", authorId: "author-1", kind: "femaleRequest", topic: "聊天", content: "今晚想找人聊聊",
      coverImageUrl: null, status: "approved", createdAt: new Date("2026-07-12T00:00:00Z"),
      author: { profile: { displayName: "小安" }, companionProfile: null }, likes: [{ userId: "viewer-1" }]
    }]);

    const result = await service.list("viewer-1");

    expect(result.items[0]).toEqual(expect.objectContaining({ id: "post-1", isLiked: true, likeCount: 1 }));
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
