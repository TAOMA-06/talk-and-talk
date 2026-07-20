import { ReviewsService } from "./reviews.service";

describe("ReviewsService", () => {
  const prisma = {
    order: { findUnique: jest.fn() },
    companionProfile: { findFirst: jest.fn() },
    review: { findMany: jest.fn() },
    $transaction: jest.fn()
  } as any;
  const moderation = { moderateAsync: jest.fn() } as any;
  const moderationCases = { createFromResult: jest.fn() } as any;
  const service = new ReviewsService(prisma, moderation, moderationCases);

  beforeEach(() => {
    jest.clearAllMocks();
    moderation.moderateAsync.mockResolvedValue({ decision: "allow" });
  });

  it("creates a review only for the user's completed order and refreshes the companion aggregate", async () => {
    prisma.order.findUnique.mockResolvedValue({ id: "order-1", userId: "user-1", companionId: "companion-1", status: "completed" });
    const db = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      order: {
        findUnique: jest.fn().mockResolvedValue({
          id: "order-1", userId: "user-1", companionId: "companion-1", status: "completed"
        })
      },
      review: {
        create: jest.fn().mockResolvedValue({
          id: "review-1", orderId: "order-1", companionId: "companion-1", rating: 5, content: "很耐心", createdAt: new Date(),
          user: { profile: { displayName: "小安" } }
        }),
        aggregate: jest.fn().mockResolvedValue({ _avg: { rating: 5 }, _count: 1 })
      },
      companionProfile: { update: jest.fn().mockResolvedValue({}) }
    };
    prisma.$transaction.mockImplementation((work: any) => work(db));

    const result = await service.create("user-1", { orderId: "order-1", rating: 5, content: "很耐心" });

    expect(result).toEqual(expect.objectContaining({ id: "review-1", userName: "小安", rating: 5 }));
    expect(db.companionProfile.update).toHaveBeenCalledWith({
      where: { id: "companion-1" }, data: { rating: 5, reviewCount: 1 }
    });
    expect(db.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it("fails closed and records a case when review content is not publishable", async () => {
    prisma.order.findUnique.mockResolvedValue({
      id: "order-1", userId: "user-1", companionId: "companion-1", status: "completed"
    });
    moderation.moderateAsync.mockResolvedValue({
      decision: "block",
      riskLevel: "high",
      priority: "critical",
      score: 0.95,
      reasons: ["私下联系方式"],
      matchedRules: ["contact.phone"],
      categories: ["privateContact"],
      policyVersion: "chat-v2",
      usedAI: false
    });
    moderationCases.createFromResult.mockResolvedValue({ id: "case-review-1" });

    await expect(service.create("user-1", {
      orderId: "order-1", rating: 5, content: "加我 13800138000"
    })).rejects.toMatchObject({
      code: "REVIEW_CONTENT_REQUIRES_REVISION",
      details: { moderationCaseId: "case-review-1", decision: "block" }
    });
    expect(moderationCases.createFromResult).toHaveBeenCalledWith(expect.objectContaining({
      source: "profile",
      targetId: "order-1",
      subjectUserId: "user-1"
    }));
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects reviews for incomplete orders", async () => {
    prisma.order.findUnique.mockResolvedValue({ id: "order-1", userId: "user-1", companionId: "companion-1", status: "paid" });

    await expect(service.create("user-1", { orderId: "order-1", rating: 5, content: "很耐心" }))
      .rejects.toMatchObject({ code: "ORDER_INVALID_STATE" });
  });

  it("does not expose reviews for a companion that is not commercially publishable", async () => {
    prisma.companionProfile.findFirst.mockResolvedValue(null);

    await expect(service.list("companion-suspended"))
      .rejects.toMatchObject({ code: "COMPANION_NOT_FOUND", status: 404 });
    expect(prisma.review.findMany).not.toHaveBeenCalled();
  });
});
