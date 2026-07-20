import { CompanionsService } from "./companions.service";

const companionRecord = {
  id: "c1",
  name: "林屿",
  role: "温柔倾听者",
  initials: "LY",
  rating: 4.9,
  reviewCount: 168,
  pricePerHalfHour: 39,
  isOnline: true,
  isVerified: true,
  bio: "擅长倾听和梳理情绪，尊重边界，仅平台内沟通。",
  availableTimes: ["20:00"],
  languages: ["中文"],
  specialties: ["情绪倾听"],
  completedOrders: 426,
  responseTime: "约30秒",
  distanceKm: 1.2,
  availability: "online",
  cityDistrict: "南山区",
  isPublished: true,
  createdAt: new Date("2026-07-09T00:00:00.000Z"),
  updatedAt: new Date("2026-07-09T00:00:00.000Z"),
  serviceTags: [{ tag: { id: "tag-1", name: "心理学背景" } }]
};

describe("CompanionsService", () => {
  const prisma = {
    user: {
      findUnique: jest.fn()
    },
    companionProfile: {
      findMany: jest.fn(),
      count: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn()
    },
    companionServiceTag: {
      deleteMany: jest.fn(),
      create: jest.fn()
    },
    serviceTag: {
      upsert: jest.fn()
    },
    companionCommercialProfile: {
      findUnique: jest.fn()
    }
  } as any;
  const moderation = { moderateAsync: jest.fn() } as any;
  const moderationCases = { createFromResult: jest.fn() } as any;

  let service: CompanionsService;

  beforeEach(() => {
    jest.clearAllMocks();
    moderation.moderateAsync.mockResolvedValue({ decision: "allow" });
    service = new CompanionsService(prisma, moderation, moderationCases);
  });

  it("lists published companions with filters and pagination", async () => {
    prisma.companionProfile.findMany.mockResolvedValue([companionRecord] as any);
    prisma.companionProfile.count.mockResolvedValue(1 as any);

    const result = await service.list({
      page: 2,
      pageSize: 10,
      tag: "心理学背景",
      availability: "online",
      isOnline: "true"
    });

    expect(prisma.companionProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          isPublished: true,
          availability: "online",
          isOnline: true,
          serviceTags: expect.any(Object)
        }),
        skip: 10,
        take: 10
      })
    );
    expect(result.items[0].id).toBe("c1");
    expect(result.items[0].tags).toEqual(["心理学背景"]);
    expect(result.pagination.total).toBe(1);
  });

  it("throws a domain 404 when a published companion is missing", async () => {
    prisma.companionProfile.findFirst.mockResolvedValue(null);

    await expect(service.getPublished("missing")).rejects.toMatchObject({
      code: "COMPANION_NOT_FOUND"
    });
  });

  it("unpublishes a companion", async () => {
    prisma.companionProfile.findUnique
      .mockResolvedValueOnce(companionRecord as any)
      .mockResolvedValueOnce({ ...companionRecord, isPublished: false } as any);
    prisma.companionProfile.update.mockResolvedValue({ ...companionRecord, isPublished: false } as any);

    const result = await service.unpublish("c1");

    expect(prisma.companionProfile.update).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { isPublished: false }
    });
    expect(result.isPublished).toBe(false);
  });

  it("lists unpublished profiles with owner eligibility for the admin review queue", async () => {
    prisma.companionProfile.findMany.mockResolvedValue([{
      ...companionRecord,
      isPublished: false,
      owner: {
        id: "owner-1",
        accountStatus: "active",
        profile: { isVerified: true, displayName: "林屿" }
      }
    }] as any);
    prisma.companionProfile.count.mockResolvedValue(1);

    const result = await service.listAdmin();

    expect(prisma.companionProfile.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [{ isPublished: "asc" }, { createdAt: "asc" }],
      take: 50
    }));
    expect(result.items[0]).toEqual(expect.objectContaining({
      id: "c1",
      isPublished: false,
      owner: { id: "owner-1", accountStatus: "active", isVerified: true, displayName: "林屿" }
    }));
  });

  it("blocks an unsafe self-service edit before it changes a public companion profile", async () => {
    prisma.companionProfile.findUnique.mockResolvedValue(companionRecord as any);
    moderation.moderateAsync.mockResolvedValue({
      decision: "review",
      riskLevel: "low",
      priority: "normal",
      score: 0.45,
      reasons: ["疑似引流"],
      matchedRules: ["ads.promo"],
      categories: ["fraudOrSpam"],
      policyVersion: "chat-v2",
      usedAI: false
    });
    moderationCases.createFromResult.mockResolvedValue({ id: "case-profile-1" });

    await expect(service.updateOwn("owner-1", { bio: "加我了解更多" }))
      .rejects.toMatchObject({
        code: "COMPANION_PROFILE_CONTENT_REQUIRES_REVISION",
        details: { moderationCaseId: "case-profile-1", decision: "review" }
      });
    expect(prisma.companionProfile.update).not.toHaveBeenCalled();
  });

  it("screens every public field before accepting a companion application", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "owner-1",
      profile: { displayName: "林屿", isVerified: true }
    });
    prisma.companionProfile.findUnique.mockResolvedValue(null);
    moderation.moderateAsync.mockResolvedValue({
      decision: "review",
      riskLevel: "low",
      priority: "normal",
      score: 0.45,
      reasons: ["疑似引流"],
      matchedRules: ["ads.promo"],
      categories: ["fraudOrSpam"],
      policyVersion: "chat-v2",
      usedAI: true
    });
    moderationCases.createFromResult.mockResolvedValue({ id: "case-application-1" });

    await expect(service.apply("owner-1", {
      role: " 倾听者 ",
      bio: " 加我了解更多 ",
      pricePerHalfHour: 39,
      tags: [" 情绪倾听 "],
      availableTimes: [" 20:00 "],
      languages: [" 中文 "],
      specialties: [" 职场减压 "],
      cityDistrict: " 南山区 "
    })).rejects.toMatchObject({
      code: "COMPANION_PROFILE_CONTENT_REQUIRES_REVISION",
      details: { moderationCaseId: "case-application-1", decision: "review" }
    });

    expect(moderation.moderateAsync).toHaveBeenCalledWith(
      expect.stringContaining("情绪倾听"),
      "profile"
    );
    expect(moderation.moderateAsync).toHaveBeenCalledWith(
      expect.stringContaining("职场减压"),
      "profile"
    );
    expect(prisma.companionProfile.create).not.toHaveBeenCalled();
  });
});
