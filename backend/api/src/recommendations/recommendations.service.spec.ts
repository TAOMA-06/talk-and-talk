import { RecommendationsService } from "./recommendations.service";

const companion = {
  id: "c1",
  name: "林屿",
  role: "温柔倾听者",
  initials: "LY",
  rating: 4.9,
  reviewCount: 168,
  pricePerHalfHour: 39,
  isOnline: true,
  isVerified: true,
  bio: "擅长倾听和梳理情绪。",
  availableTimes: ["21:00"],
  languages: ["中文"],
  specialties: ["情绪倾听"],
  topicIds: ["t1"],
  completedOrders: 426,
  responseTime: "约30秒",
  distanceKm: 1.2,
  availability: "online",
  cityDistrict: "南山区",
  isPublished: true,
  createdAt: new Date("2026-07-01T00:00:00.000Z"),
  updatedAt: new Date("2026-07-01T00:00:00.000Z"),
  serviceTags: [{ tag: { name: "心理学背景" } }],
  recommendationPolicies: []
};
const sellableMatch = {
  id: "c1",
  earliestStartsAt: new Date("2026-07-26T02:00:00.000Z"),
  startingPriceCents: 3900,
  startingDurationMinutes: 30,
  currency: "CNY",
  deliveryModes: ["text"] as Array<"text" | "voice">
};

describe("RecommendationsService", () => {
  const prisma = {
    userRecommendationPreference: { findUnique: jest.fn(), upsert: jest.fn() },
    userRecommendationTag: { findMany: jest.fn(), findUnique: jest.fn(), upsert: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    companionProfile: { findMany: jest.fn(), findUnique: jest.fn() },
    order: { findMany: jest.fn() },
    auditLog: { findMany: jest.fn() },
    recommendationRequest: { create: jest.fn(), findFirst: jest.fn() },
    recommendationImpression: { findMany: jest.fn(), createMany: jest.fn(), count: jest.fn(), updateMany: jest.fn(), findFirst: jest.fn() },
    companionRecommendationPolicy: { upsert: jest.fn() }
  } as any;
  const companions = { findSellableCompanions: jest.fn() } as any;

  let service: RecommendationsService;

  beforeEach(() => {
    jest.clearAllMocks();
    companions.findSellableCompanions.mockResolvedValue([sellableMatch]);
    service = new RecommendationsService(prisma, companions);
  });

  it("persists a ranked request snapshot and returns an opaque impression id", async () => {
    const request = {
      id: "request-1",
      algorithmVersion: "companion-ranking-v1",
      personalized: true,
      context: { themeId: "t1" },
      expiresAt: new Date(Date.now() + 60_000)
    };
    prisma.userRecommendationPreference.findUnique.mockResolvedValue({
      personalizationEnabled: true,
      topicIds: ["t1"],
      city: null,
      maxPricePerHalfHour: 50,
      preferredTimeSlots: ["21:00"]
    });
    prisma.companionProfile.findMany.mockResolvedValue([companion]);
    prisma.userRecommendationTag.findMany.mockResolvedValue([]);
    prisma.order.findMany.mockResolvedValue([]);
    prisma.recommendationImpression.findMany.mockImplementation((input: any) => {
      if (input.where?.requestId) {
        return Promise.resolve([{
          id: "00000000-0000-4000-8000-000000000001",
          position: 1,
          score: 0.9,
          reasonCodes: ["theme", "quality"],
          companion
        }]);
      }
      return Promise.resolve([]);
    });
    prisma.recommendationRequest.create.mockResolvedValue(request);
    prisma.recommendationRequest.findFirst.mockResolvedValue(request);
    prisma.recommendationImpression.createMany.mockResolvedValue({ count: 1 });
    prisma.recommendationImpression.count.mockResolvedValue(1);

    const result = await service.listCompanions("u1", { placement: "discoverHome", themeId: "t1", pageSize: 10 });

    expect(prisma.companionProfile.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: { in: ["c1"] },
        commercialProfile: { status: "verified" }
      })
    }));
    expect(prisma.recommendationImpression.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        requestId: "request-1",
        companion: expect.objectContaining({ commercialProfile: { status: "verified" } })
      })
    }));
    expect(prisma.recommendationRequest.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: "u1", placement: "discoverHome", personalized: true })
    }));
    expect(prisma.recommendationImpression.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({ requestId: "request-1", companionId: "c1", position: 1 })]
    }));
    expect(result.items[0]).toEqual(expect.objectContaining({
      id: "c1",
      impressionId: "00000000-0000-4000-8000-000000000001",
      reasonText: "适合情绪倾听",
      catalog: expect.objectContaining({
        startingPriceCents: 3900,
        nextAvailableAt: "2026-07-26T02:00:00.000Z"
      })
    }));
  });

  it("returns an empty discovery page when no companion has current sellable capacity", async () => {
    companions.findSellableCompanions.mockResolvedValue([]);
    prisma.userRecommendationPreference.findUnique.mockResolvedValue(null);

    const result = await service.listCompanions("u1", { placement: "discoverHome", pageSize: 10 });

    expect(result).toEqual(expect.objectContaining({
      personalized: true,
      items: [],
      pagination: expect.objectContaining({ pageSize: 10, total: 0, nextCursor: null })
    }));
    expect(prisma.companionProfile.findMany).not.toHaveBeenCalled();
    expect(prisma.recommendationRequest.create).not.toHaveBeenCalled();
  });

  it("keeps accepted recommendation attribution after a reservation releases its current confirmation field", async () => {
    prisma.recommendationImpression.findMany.mockResolvedValue([{
      companionId: "c1",
      servedAt: new Date("2026-07-20T00:00:00.000Z"),
      viewedAt: new Date("2026-07-20T00:01:00.000Z"),
      clickedAt: new Date("2026-07-20T00:02:00.000Z"),
      request: { placement: "discoverHome" },
      companion: { id: "c1", name: "林屿" },
      order: {
        id: "o1",
        amountCents: 3900,
        companionConfirmedAt: null,
        paidAt: new Date("2026-07-20T00:05:00.000Z"),
        serviceStartedAt: null,
        completedAt: null,
        reviews: [],
        refunds: []
      }
    }]);
    prisma.auditLog.findMany.mockResolvedValue([{ resourceId: "o1" }]);

    const result = await service.metrics({
      from: "2026-07-01T00:00:00.000Z",
      to: "2026-07-25T00:00:00.000Z"
    });

    expect(result.items[0]).toEqual(expect.objectContaining({
      served: 1,
      clicked: 1,
      orderCreated: 1,
      accepted: 1,
      paid: 1,
      acceptanceRate: 1
    }));
  });

  it("records a first click once and builds behavioral topics without using message content", async () => {
    prisma.userRecommendationPreference.findUnique.mockResolvedValue({ personalizationEnabled: true });
    prisma.recommendationImpression.findMany.mockResolvedValue([{
      id: "00000000-0000-4000-8000-000000000001",
      viewedAt: null,
      companion: { topicIds: ["t1"], specialties: ["情绪倾听"], serviceTags: [] }
    }]);
    prisma.recommendationImpression.updateMany.mockResolvedValue({ count: 1 });
    prisma.userRecommendationTag.findUnique.mockResolvedValue(null);
    prisma.userRecommendationTag.upsert.mockResolvedValue({ id: "tag-1" });

    const result = await service.recordEvents("u1", {
      events: [{ impressionId: "00000000-0000-4000-8000-000000000001", type: "click" }]
    });

    expect(result).toEqual({ updated: 1 });
    expect(prisma.recommendationImpression.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "00000000-0000-4000-8000-000000000001", clickedAt: null }
    }));
    expect(prisma.userRecommendationTag.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ userId: "u1", topicId: "t1", weight: 1 })
    }));
  });

  it("turns inferred-tag deletion into a durable disabled-topic marker", async () => {
    prisma.userRecommendationTag.upsert.mockResolvedValue({});

    await expect(service.deleteBehavioralTag("u1", "inferred:t1")).resolves.toEqual({ deleted: true, topicId: "t1" });

    expect(prisma.userRecommendationTag.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ userId: "u1", topicId: "t1", weight: 0 }),
      update: expect.objectContaining({ weight: 0, disabledAt: expect.any(Date) })
    }));
  });
});
