import { MAX_BEHAVIOR_ORDER_FACTS, RecommendationsService } from "./recommendations.service";

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
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
    userRecommendationPreference: { findUnique: jest.fn(), upsert: jest.fn() },
    userRecommendationTag: { findMany: jest.fn(), findUnique: jest.fn(), upsert: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    userCompanionRecommendationExclusion: {
      findMany: jest.fn(),
      count: jest.fn(),
      upsert: jest.fn(),
      deleteMany: jest.fn()
    },
    companionCustomerFutureBoundary: { findMany: jest.fn() },
    companionProfile: { findMany: jest.fn(), findUnique: jest.fn() },
    order: { findMany: jest.fn() },
    auditLog: { findMany: jest.fn() },
    recommendationRequest: { create: jest.fn(), findFirst: jest.fn(), updateMany: jest.fn() },
    recommendationImpression: {
      findMany: jest.fn(),
      groupBy: jest.fn(),
      createMany: jest.fn(),
      count: jest.fn(),
      updateMany: jest.fn(),
      findFirst: jest.fn()
    },
    companionRecommendationPolicy: { upsert: jest.fn() }
  } as any;
  const companions = { findSellableCompanions: jest.fn(), getPublished: jest.fn() } as any;

  let service: RecommendationsService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(async (callback: (tx: typeof prisma) => unknown) => callback(prisma));
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.userCompanionRecommendationExclusion.findMany.mockResolvedValue([]);
    prisma.companionCustomerFutureBoundary.findMany.mockResolvedValue([]);
    prisma.userCompanionRecommendationExclusion.count.mockResolvedValue(0);
    prisma.recommendationRequest.updateMany.mockResolvedValue({ count: 0 });
    prisma.recommendationImpression.groupBy.mockResolvedValue([]);
    companions.findSellableCompanions.mockResolvedValue([sellableMatch]);
    companions.getPublished.mockResolvedValue(companion);
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
        commercialProfile: {
          status: "verified",
          adultEligibilityVerdict: "adult",
          adultEligibilityValidUntil: { gt: expect.any(Date) }
        }
      }),
      orderBy: [
        { isOnline: "desc" },
        { rating: "desc" },
        { reviewCount: "desc" },
        { id: "asc" }
      ],
      take: 200
    }));
    expect(prisma.recommendationImpression.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        requestId: "request-1",
        companion: expect.objectContaining({
          commercialProfile: expect.objectContaining({
            status: "verified",
            adultEligibilityVerdict: "adult",
            adultEligibilityValidUntil: { gt: expect.any(Date) }
          })
        })
      })
    }));
    expect(prisma.recommendationRequest.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: "u1", placement: "discoverHome", personalized: true })
    }));
    expect(prisma.recommendationImpression.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({ requestId: "request-1", companionId: "c1", position: 1 })]
    }));
    expect(prisma.order.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: MAX_BEHAVIOR_ORDER_FACTS
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

  it("bounds recent order behavior facts to the newest stable one thousand records", async () => {
    prisma.userRecommendationPreference.findUnique.mockResolvedValue(null);
    prisma.userRecommendationTag.findMany.mockResolvedValue([]);
    prisma.order.findMany.mockResolvedValue([]);

    await service.getPreferences("u1");

    expect(prisma.order.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ userId: "u1", createdAt: { gte: expect.any(Date) } }),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: MAX_BEHAVIOR_ORDER_FACTS
    }));
  });

  it("aggregates large exposure volumes in the database without materializing impression rows", async () => {
    prisma.recommendationImpression.groupBy
      .mockResolvedValueOnce([{ companionId: "c1", _count: { _all: 75_000 } }])
      .mockResolvedValueOnce([{ companionId: "c1", _count: { _all: 12_500 } }])
      .mockResolvedValueOnce([{ companionId: "c1", _count: { _all: 250_000 } }]);

    const exposure = await (service as any).collectExposure(
      "u1",
      ["c1", "c2"],
      new Date("2026-08-01T12:00:00.000Z")
    );

    expect(exposure.get("c1")).toEqual({
      views24Hours: 12_500,
      views7Days: 75_000,
      servedToday: 250_000
    });
    expect(exposure.get("c2")).toEqual({ views24Hours: 0, views7Days: 0, servedToday: 0 });
    expect(prisma.recommendationImpression.groupBy).toHaveBeenCalledTimes(3);
    expect(prisma.recommendationImpression.groupBy).toHaveBeenNthCalledWith(1, expect.objectContaining({
      by: ["companionId"],
      _count: { _all: true },
      where: expect.objectContaining({ request: { userId: "u1" } })
    }));
    expect(prisma.recommendationImpression.groupBy).toHaveBeenNthCalledWith(3, expect.objectContaining({
      by: ["companionId"],
      _count: { _all: true },
      where: expect.not.objectContaining({ request: expect.anything() })
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

  it("excludes a private user-selected companion before candidate ranking while leaving the public catalog out of scope", async () => {
    prisma.userRecommendationPreference.findUnique.mockResolvedValue({ personalizationEnabled: false });
    prisma.userCompanionRecommendationExclusion.findMany.mockResolvedValue([{ companionId: "c1" }]);

    const result = await service.listCompanions("u1", { placement: "discoverHome", pageSize: 10 });

    expect(result).toEqual(expect.objectContaining({
      personalized: false,
      items: [],
      pagination: expect.objectContaining({ total: 0, nextCursor: null })
    }));
    expect(prisma.companionProfile.findMany).not.toHaveBeenCalled();
    expect(prisma.recommendationRequest.create).not.toHaveBeenCalled();
    // This service never mutates a profile, conversation block, report or order;
    // ordinary /companions catalog lookup remains a separate controller path.
    expect(companions.getPublished).not.toHaveBeenCalled();
  });

  it("creates, lists and idempotently removes a recommendation-only exclusion", async () => {
    const stored = {
      id: "exclude-1",
      userId: "u1",
      companionId: "c1",
      companionNameSnapshot: "林屿",
      companionRoleSnapshot: "温柔倾听者",
      companionInitialsSnapshot: "LY",
      createdAt: new Date("2026-07-31T08:00:00.000Z"),
      companion: {
        id: "c1",
        isPublished: true,
        isVerified: true,
        ownerUserId: "owner-1",
        owner: { accountStatus: "active", profile: { isVerified: true } },
        commercialProfile: {
          status: "verified",
          adultEligibilityVerdict: "adult",
          adultEligibilityValidUntil: new Date("2027-07-31T08:00:00.000Z")
        }
      }
    };
    prisma.userCompanionRecommendationExclusion.upsert.mockResolvedValue(stored);
    prisma.userCompanionRecommendationExclusion.findMany.mockResolvedValue([stored]);
    prisma.userCompanionRecommendationExclusion.count.mockResolvedValue(41);
    prisma.userCompanionRecommendationExclusion.deleteMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    await expect(service.excludeCompanion("u1", " c1 ")).resolves.toEqual({
      excluded: true,
      item: {
        companionId: "c1",
        excludedAt: "2026-07-31T08:00:00.000Z",
        companion: {
          id: "c1", name: "林屿", role: "温柔倾听者", initials: "LY", currentlyPublic: true
        }
      }
    });
    expect(companions.getPublished).toHaveBeenCalledWith("c1");
    expect(prisma.userCompanionRecommendationExclusion.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId_companionId: { userId: "u1", companionId: "c1" } },
      create: {
        userId: "u1",
        companionId: "c1",
        companionNameSnapshot: "林屿",
        companionRoleSnapshot: "温柔倾听者",
        companionInitialsSnapshot: "LY"
      },
      update: {}
    }));
    expect(prisma.recommendationRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: "u1", expiresAt: { gt: expect.any(Date) } },
      data: { expiresAt: expect.any(Date) }
    }));

    await expect(service.listCompanionExclusions("u1", 3, 20)).resolves.toEqual({
      items: [expect.objectContaining({ companionId: "c1", companion: expect.objectContaining({ currentlyPublic: true }) })],
      pagination: { page: 3, pageSize: 20, total: 41, totalPages: 3 }
    });
    expect(prisma.userCompanionRecommendationExclusion.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: "u1" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: 40,
      take: 20
    }));
    expect(prisma.userCompanionRecommendationExclusion.count).toHaveBeenCalledWith({ where: { userId: "u1" } });
    stored.companion.isPublished = false;
    await expect(service.listCompanionExclusions("u1")).resolves.toEqual({
      items: [expect.objectContaining({
        companionId: "c1",
        companion: {
          id: "c1",
          name: "林屿",
          role: "温柔倾听者",
          initials: "LY",
          currentlyPublic: false
        }
      })],
      pagination: { page: 1, pageSize: 20, total: 41, totalPages: 3 }
    });
    await expect(service.restoreCompanionRecommendations("u1", "c1")).resolves.toEqual({
      excluded: false,
      removed: true,
      companionId: "c1"
    });
    expect(prisma.userCompanionRecommendationExclusion.deleteMany).toHaveBeenCalledWith({
      where: { userId: "u1", companionId: "c1" }
    });
    await expect(service.restoreCompanionRecommendations("u1", "c1")).resolves.toEqual({
      excluded: false,
      removed: false,
      companionId: "c1"
    });
  });

  it("rechecks exclusions before serving a stored cursor page", async () => {
    const request = {
      id: "request-cursor",
      algorithmVersion: "companion-ranking-v1",
      personalized: true,
      context: { themeId: "t1" },
      expiresAt: new Date(Date.now() + 60_000)
    };
    prisma.recommendationRequest.findFirst.mockResolvedValue(request);
    prisma.userCompanionRecommendationExclusion.findMany.mockResolvedValue([{ companionId: "c1" }]);
    prisma.recommendationImpression.findMany.mockResolvedValue([]);
    prisma.recommendationImpression.count.mockResolvedValue(0);
    const cursor = Buffer.from(JSON.stringify({ requestId: request.id, offset: 0 })).toString("base64url");

    const result = await service.listCompanions("u1", { cursor, pageSize: 10 });

    expect(result.items).toEqual([]);
    expect(result.pagination).toEqual({ pageSize: 10, total: 0, nextCursor: null });
    expect(prisma.recommendationImpression.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        requestId: request.id,
        companion: expect.objectContaining({ id: { in: [] } })
      })
    }));
    expect(prisma.userCompanionRecommendationExclusion.findMany).toHaveBeenCalledWith({
      where: { userId: "u1", companionId: { in: ["c1"] } },
      select: { companionId: true }
    });
  });

  it("privately removes companion-declined customers from fresh and stored recommendation pages", async () => {
    prisma.userRecommendationPreference.findUnique.mockResolvedValue(null);
    prisma.companionCustomerFutureBoundary.findMany.mockResolvedValue([{ companionId: "c1" }]);

    const fresh = await service.listCompanions("u1", {
      placement: "discoverHome",
      pageSize: 10
    });

    expect(fresh.items).toEqual([]);
    expect(prisma.recommendationRequest.create).not.toHaveBeenCalled();
    expect(prisma.companionCustomerFutureBoundary.findMany).toHaveBeenCalledWith({
      where: { customerUserId: "u1", companionId: { in: ["c1"] } },
      select: { companionId: true }
    });

    const request = {
      id: "request-private-boundary",
      algorithmVersion: "companion-ranking-v1",
      personalized: false,
      context: {},
      expiresAt: new Date(Date.now() + 60_000)
    };
    prisma.recommendationRequest.findFirst.mockResolvedValue(request);
    prisma.recommendationImpression.findMany.mockResolvedValue([]);
    prisma.recommendationImpression.count.mockResolvedValue(0);
    const cursor = Buffer.from(JSON.stringify({ requestId: request.id, offset: 0 }))
      .toString("base64url");

    const stored = await service.listCompanions("u1", { cursor, pageSize: 10 });
    expect(stored.items).toEqual([]);
    expect(stored.pagination.total).toBe(0);
  });

  it("rechecks the private future boundary under the customer lock before persisting a recommendation snapshot", async () => {
    prisma.userRecommendationPreference.findUnique.mockResolvedValue(null);
    prisma.companionProfile.findMany.mockResolvedValue([companion]);
    prisma.companionCustomerFutureBoundary.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ companionId: "c1" }]);

    const result = await service.listCompanions("u1", {
      placement: "discoverHome",
      pageSize: 10
    });

    expect(result.items).toEqual([]);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.recommendationRequest.create).not.toHaveBeenCalled();
    expect(prisma.recommendationImpression.createMany).not.toHaveBeenCalled();
    expect(prisma.companionCustomerFutureBoundary.findMany).toHaveBeenNthCalledWith(2, {
      where: { customerUserId: "u1", companionId: { in: ["c1"] } },
      select: { companionId: true }
    });
  });

  it("rejects an invalid companion id before reading profile, block or report state", async () => {
    await expect(service.excludeCompanion("u1", "\u0000bad"))
      .rejects.toMatchObject({ code: "INVALID_COMPANION_ID" });
    expect(companions.getPublished).not.toHaveBeenCalled();
    expect(prisma.userCompanionRecommendationExclusion.upsert).not.toHaveBeenCalled();
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
    expect(prisma.recommendationImpression.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [{ servedAt: "desc" }, { id: "desc" }],
      take: 5001
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
