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

const eligibleOwnCompanion = {
  id: "c1",
  isVerified: true,
  owner: { accountStatus: "active", profile: { isVerified: true } }
};

const serviceOfferingRecord = {
  id: "offer-1",
  companionId: "c1",
  code: "service-offer-1",
  title: "晚间文字陪伴",
  description: "在平台内慢慢聊一聊。",
  deliveryMode: "text" as const,
  durationMinutes: 30,
  priceCents: 3900,
  currency: "CNY",
  topicIds: ["t1"],
  isActive: true,
  sortOrder: 1,
  createdAt: new Date("2026-07-09T00:00:00.000Z"),
  updatedAt: new Date("2026-07-09T00:00:00.000Z")
};

function sellableCapacityRecord(input: {
  id?: string;
  deliveryMode?: "text" | "voice";
  durationMinutes?: number;
  priceCents?: number;
} = {}) {
  const startsAt = new Date(Math.ceil((Date.now() + 60 * 60_000) / (30 * 60_000)) * (30 * 60_000));
  return {
    id: input.id ?? "c1",
    serviceOfferings: [{
      id: `offer-${input.id ?? "c1"}`,
      durationMinutes: input.durationMinutes ?? 30,
      priceCents: input.priceCents ?? 3900,
      currency: "CNY",
      deliveryMode: input.deliveryMode ?? "text"
    }],
    availabilityWindows: [{
      id: `window-${input.id ?? "c1"}`,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 3 * 60 * 60_000),
      capacity: 1
    }],
    orders: []
  };
}

const availabilityWindowRecord = {
  id: "window-1",
  companionId: "c1",
  startsAt: new Date("2026-07-20T10:00:00.000Z"),
  endsAt: new Date("2026-07-20T12:00:00.000Z"),
  capacity: 2,
  isActive: true,
  createdAt: new Date("2026-07-09T00:00:00.000Z"),
  updatedAt: new Date("2026-07-09T00:00:00.000Z")
};

const recurringAvailabilityRuleRecord = {
  id: "rule-1",
  companionId: "c1",
  weekday: 1,
  startsAtMinute: 540,
  endsAtMinute: 720,
  capacity: 2,
  timezone: "Asia/Shanghai",
  isActive: true,
  createdAt: new Date("2026-07-09T00:00:00.000Z"),
  updatedAt: new Date("2026-07-09T00:00:00.000Z")
};

const availabilityBlackoutRecord = {
  id: "blackout-1",
  companionId: "c1",
  startsAt: new Date("2026-07-23T01:00:00.000Z"),
  endsAt: new Date("2026-07-23T04:00:00.000Z"),
  timezone: "Asia/Shanghai",
  isActive: true,
  createdAt: new Date("2026-07-09T00:00:00.000Z"),
  updatedAt: new Date("2026-07-09T00:00:00.000Z")
};

const recurringAvailabilityDraftRecord = {
  id: "draft-1",
  companionId: "c1",
  startsAt: new Date("2026-07-22T02:00:00.000Z"),
  endsAt: new Date("2026-07-22T03:00:00.000Z"),
  capacity: 2,
  isActive: false,
  recurringAvailabilityRuleId: "rule-1",
  recurringOccurrenceStartsAt: new Date("2026-07-22T02:00:00.000Z"),
  createdAt: new Date("2026-07-09T00:00:00.000Z"),
  updatedAt: new Date("2026-07-09T00:00:00.000Z")
};

describe("CompanionsService", () => {
  const prisma = {
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
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
    },
    companionAvailabilityWindow: {
      findMany: jest.fn(),
      count: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn()
    },
    companionRecurringAvailabilityRule: {
      findMany: jest.fn(),
      findFirst: jest.fn()
    },
    companionAvailabilityBlackout: {
      findMany: jest.fn(),
      findFirst: jest.fn()
    },
    companionServiceOffering: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn()
    },
    order: {
      findMany: jest.fn(),
      findFirst: jest.fn()
    }
  } as any;
  const moderation = { moderateAsync: jest.fn() } as any;
  const moderationCases = { createFromResult: jest.fn() } as any;
  const availabilityReminderCandidates = { recordWindowBecameAvailable: jest.fn() } as any;
  const availabilityScheduleRules = {
    createRecurringRule: jest.fn(),
    deactivateRecurringRule: jest.fn(),
    createBlackout: jest.fn(),
    deactivateBlackout: jest.fn()
  } as any;
  const config = {
    get: jest.fn((key: string, fallback?: unknown) => key === "TRTC_ENABLED" ? true : fallback)
  } as any;

  let service: CompanionsService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.companionProfile.findMany.mockResolvedValue([]);
    prisma.companionProfile.count.mockResolvedValue(0);
    prisma.companionProfile.findFirst.mockResolvedValue(null);
    prisma.$transaction.mockImplementation(async (callback: (db: typeof prisma) => unknown) => callback(prisma));
    prisma.$queryRaw.mockResolvedValue([]);
    moderation.moderateAsync.mockResolvedValue({ decision: "allow" });
    availabilityReminderCandidates.recordWindowBecameAvailable.mockResolvedValue({ created: 0 });
    service = new CompanionsService(
      prisma,
      moderation,
      moderationCases,
      availabilityReminderCandidates,
      availabilityScheduleRules,
      config
    );
  });

  it("lists published companions with filters and pagination", async () => {
    prisma.companionProfile.findMany
      .mockResolvedValueOnce([sellableCapacityRecord({ deliveryMode: "voice", durationMinutes: 60, priceCents: 8800 })] as any)
      .mockResolvedValueOnce([companionRecord] as any);
    prisma.companionProfile.count.mockResolvedValue(1 as any);

    const result = await service.list({
      page: 2,
      pageSize: 10,
      tag: "心理学背景",
      availability: "online",
      isOnline: "true",
      topicId: "t1",
      deliveryMode: "voice",
      maxServicePriceCents: 8_800,
      keyword: "晚间"
    });

    expect(prisma.companionProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          isPublished: true,
          availability: "online",
          isOnline: true,
          serviceTags: expect.any(Object),
          serviceOfferings: {
            some: {
              isActive: true,
              topicIds: { has: "t1" },
              deliveryMode: "voice",
              priceCents: { lte: 8_800 }
            }
          },
          AND: [{
            OR: expect.arrayContaining([
              { name: { contains: "晚间", mode: "insensitive" } },
              { role: { contains: "晚间", mode: "insensitive" } },
              { serviceTags: { some: { tag: { name: { contains: "晚间", mode: "insensitive" } } } } },
              {
                serviceOfferings: {
                  some: {
                    isActive: true,
                    topicIds: { has: "t1" },
                    deliveryMode: "voice",
                    priceCents: { lte: 8_800 },
                    title: { contains: "晚间", mode: "insensitive" }
                  }
                }
              }
            ])
          }]
        }),
        skip: 10,
        take: 10
      })
    );
    expect(result.items[0].id).toBe("c1");
    expect(result.items[0].tags).toEqual(["心理学背景"]);
    expect(result.items[0].catalog).toEqual(expect.objectContaining({
      sellable: true,
      startingPriceCents: 8800,
      startingDurationMinutes: 60,
      deliveryModes: ["voice"]
    }));
    expect(result.pagination.total).toBe(1);
  });

  it("defaults the public catalog to currently sellable companions while preserving a stable public order", async () => {
    prisma.companionProfile.findMany
      .mockResolvedValueOnce([sellableCapacityRecord()] as any)
      .mockResolvedValueOnce([companionRecord] as any);
    prisma.companionProfile.count.mockResolvedValue(1 as any);

    await service.list({});

    const capacityQuery = prisma.companionProfile.findMany.mock.calls[0][0];
    expect(capacityQuery.where).toEqual(expect.objectContaining({
      serviceOfferings: { some: { isActive: true } },
      availabilityWindows: expect.objectContaining({ some: expect.any(Object) })
    }));
    expect(prisma.companionProfile.findMany.mock.calls[1][0]).toEqual(expect.objectContaining({
      where: expect.objectContaining({
        id: { in: ["c1"] },
        isPublished: true,
        isVerified: true,
        ownerUserId: { not: null },
        owner: { accountStatus: "active", profile: { isVerified: true } },
        commercialProfile: { status: "verified" }
      }),
      orderBy: [
        { isOnline: "desc" },
        { rating: "desc" },
        { reviewCount: "desc" },
        { pricePerHalfHour: "asc" }
      ]
    }));
  });

  it("orders price-selected results by the current sellable offering rather than editable profile price", async () => {
    prisma.companionProfile.findMany
      .mockResolvedValueOnce([sellableCapacityRecord({ priceCents: 2900 })] as any)
      .mockResolvedValueOnce([companionRecord] as any);

    await service.list({ keyword: "林", sortBy: "priceAsc" });

    const finalQuery = prisma.companionProfile.findMany.mock.calls[1][0];
    expect(finalQuery.where.id).toEqual({ in: ["c1"] });
    expect(finalQuery).not.toHaveProperty("orderBy");
    expect(prisma.companionProfile.count).not.toHaveBeenCalled();
  });

  it("searches only public name, role, tags, or the same current active service title", async () => {
    prisma.companionProfile.findMany
      .mockResolvedValueOnce([sellableCapacityRecord()] as any)
      .mockResolvedValueOnce([companionRecord] as any);
    prisma.companionProfile.count.mockResolvedValue(1 as any);

    await service.list({ keyword: "静文字", topicId: "t1", deliveryMode: "text" });

    const where = prisma.companionProfile.findMany.mock.calls[1][0].where;
    expect(where).toEqual(expect.objectContaining({
      isPublished: true,
      isVerified: true,
      ownerUserId: { not: null },
      serviceOfferings: {
        some: { isActive: true, topicIds: { has: "t1" }, deliveryMode: "text" }
      },
      AND: [{
        OR: expect.arrayContaining([
          { name: { contains: "静文字", mode: "insensitive" } },
          { role: { contains: "静文字", mode: "insensitive" } },
          { serviceTags: { some: { tag: { name: { contains: "静文字", mode: "insensitive" } } } } },
          {
            serviceOfferings: {
              some: {
                isActive: true,
                topicIds: { has: "t1" },
                deliveryMode: "text",
                title: { contains: "静文字", mode: "insensitive" }
              }
            }
          }
        ])
      }]
    }));
    expect(JSON.stringify(where)).not.toMatch(/recommendation|favorite|recent|conversation|order/i);
  });

  it("keeps a discovery result only when the same matching active service has a future structured candidate with capacity", async () => {
    jest.useFakeTimers();
    const now = new Date("2026-07-20T08:00:00.000Z");
    jest.setSystemTime(now);
    const startsAt = new Date("2026-07-20T10:00:00.000Z");
    const endsAt = new Date("2026-07-20T12:00:00.000Z");
    prisma.companionProfile.findMany
      .mockResolvedValueOnce([{
        id: "c1",
        serviceOfferings: [{
          id: "offer-voice",
          durationMinutes: 60,
          priceCents: 8800,
          currency: "CNY",
          deliveryMode: "voice"
        }],
        availabilityWindows: [{ id: "window-1", startsAt, endsAt, capacity: 1 }],
        // The first two 30-minute candidate starts overlap this booking, but
        // the 11:00 candidate is still genuinely available.
        orders: [{
          status: "paid",
          scheduledAt: startsAt,
          durationMinutes: 60,
          companionConfirmedAt: new Date("2026-07-20T09:00:00.000Z"),
          paymentReservationExpiresAt: null
        }]
      }] as any)
      .mockResolvedValueOnce([companionRecord] as any);
    prisma.companionProfile.count.mockResolvedValue(1 as any);

    const result = await service.list({
      topicId: "t1",
      deliveryMode: "voice",
      maxServicePriceCents: 8_800,
      availableWithinDays: 3,
      keyword: "语音"
    });

    const capacityQuery = prisma.companionProfile.findMany.mock.calls[0][0];
    expect(capacityQuery.where).toEqual(expect.objectContaining({
      isPublished: true,
      serviceOfferings: {
        some: {
          isActive: true,
          topicIds: { has: "t1" },
          deliveryMode: "voice",
          priceCents: { lte: 8_800 }
        }
      },
      AND: [{
        OR: expect.arrayContaining([
          {
            serviceOfferings: {
              some: expect.objectContaining({
                isActive: true,
                title: { contains: "语音", mode: "insensitive" }
              })
            }
          }
        ])
      }],
      availabilityWindows: expect.objectContaining({ some: expect.any(Object) })
    }));
    expect(prisma.companionProfile.findMany.mock.calls[1][0].where).toEqual(expect.objectContaining({
      id: { in: ["c1"] },
      serviceOfferings: capacityQuery.where.serviceOfferings
    }));
    expect(result.items).toHaveLength(1);
    jest.useRealTimers();
  });

  it("orders availability-priority results by each matching service's earliest structured candidate before paging", async () => {
    jest.useFakeTimers();
    const now = new Date("2026-07-20T08:00:00.000Z");
    jest.setSystemTime(now);
    const soonerStartsAt = new Date("2026-07-21T10:00:00.000Z");
    const laterStartsAt = new Date("2026-07-26T10:00:00.000Z");
    const fullStartsAt = new Date("2026-07-20T10:00:00.000Z");
    const soonerRecord = { ...companionRecord, id: "c-sooner", name: "最早可约" };
    const laterRecord = { ...companionRecord, id: "c-later", name: "稍后可约" };
    prisma.companionProfile.findMany
      .mockResolvedValueOnce([
        {
          id: "c-later",
          serviceOfferings: [{
            id: "offer-later",
            durationMinutes: 30,
            priceCents: 4900,
            currency: "CNY",
            deliveryMode: "text"
          }],
          availabilityWindows: [{
            id: "window-later",
            startsAt: laterStartsAt,
            endsAt: new Date("2026-07-26T12:00:00.000Z"),
            capacity: 1
          }],
          orders: []
        },
        {
          id: "c-sooner",
          serviceOfferings: [{
            id: "offer-sooner",
            durationMinutes: 30,
            priceCents: 3900,
            currency: "CNY",
            deliveryMode: "text"
          }],
          availabilityWindows: [{
            id: "window-sooner",
            startsAt: soonerStartsAt,
            endsAt: new Date("2026-07-21T12:00:00.000Z"),
            capacity: 1
          }],
          orders: []
        },
        {
          id: "c-full",
          serviceOfferings: [{
            id: "offer-full",
            durationMinutes: 60,
            priceCents: 5000,
            currency: "CNY",
            deliveryMode: "text"
          }],
          availabilityWindows: [{
            id: "window-full",
            startsAt: fullStartsAt,
            endsAt: new Date("2026-07-20T12:00:00.000Z"),
            capacity: 1
          }],
          orders: [{
            status: "paid",
            scheduledAt: fullStartsAt,
            durationMinutes: 120,
            companionConfirmedAt: new Date("2026-07-20T09:00:00.000Z"),
            paymentReservationExpiresAt: null
          }]
        },
        {
          id: "c-legacy-only",
          availableTimes: ["今晚 20:00 后"],
          serviceOfferings: [{
            id: "offer-legacy",
            durationMinutes: 30,
            priceCents: 3900,
            currency: "CNY",
            deliveryMode: "text"
          }],
          availabilityWindows: [],
          orders: []
        }
      ] as any)
      // Deliberately return the database rows in the opposite order. The
      // service must preserve the capacity-derived rank, not database order.
      .mockResolvedValueOnce([laterRecord, soonerRecord] as any);

    const result = await service.list({
      keyword: "文字",
      topicId: "t1",
      deliveryMode: "text",
      maxServicePriceCents: 5_000,
      sortBy: "soonestAvailable",
      page: 1,
      pageSize: 2
    });

    const capacityQuery = prisma.companionProfile.findMany.mock.calls[0][0];
    expect(capacityQuery.where).toEqual(expect.objectContaining({
      isPublished: true,
      isVerified: true,
      ownerUserId: { not: null },
      serviceOfferings: {
        some: {
          isActive: true,
          topicIds: { has: "t1" },
          deliveryMode: "text",
          priceCents: { lte: 5_000 }
        }
      },
      availabilityWindows: {
        some: expect.objectContaining({
          isActive: true,
          startsAt: { lt: new Date("2026-07-27T08:00:00.000Z") }
        })
      }
    }));
    expect(JSON.stringify(capacityQuery)).not.toMatch(/favorite|recent|recommendation|conversation|content|body/i);

    const finalQuery = prisma.companionProfile.findMany.mock.calls[1][0];
    expect(finalQuery).toEqual(expect.objectContaining({
      where: expect.objectContaining({ id: { in: ["c-sooner", "c-later"] } }),
      include: expect.any(Object)
    }));
    expect(finalQuery).not.toHaveProperty("orderBy");
    expect(finalQuery).not.toHaveProperty("skip");
    expect(prisma.companionProfile.count).not.toHaveBeenCalled();
    expect(result.items.map((item) => item.id)).toEqual(["c-sooner", "c-later"]);
    expect(result.pagination).toEqual(expect.objectContaining({ page: 1, pageSize: 2, total: 2, totalPages: 1 }));
    jest.useRealTimers();
  });

  it("uses a selected shorter availability window for availability-priority ordering", async () => {
    jest.useFakeTimers();
    const now = new Date("2026-07-20T08:00:00.000Z");
    jest.setSystemTime(now);
    prisma.companionProfile.findMany.mockResolvedValueOnce([] as any);

    const result = await service.list({ sortBy: "soonestAvailable", availableWithinDays: 3 });

    const capacityQuery = prisma.companionProfile.findMany.mock.calls[0][0];
    expect(capacityQuery.where.availabilityWindows.some.startsAt.lt).toEqual(new Date("2026-07-23T08:00:00.000Z"));
    expect(result).toEqual(expect.objectContaining({
      items: [],
      pagination: expect.objectContaining({ total: 0 })
    }));
    expect(prisma.companionProfile.count).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  it("excludes a full structured window from an availability-filtered discovery query", async () => {
    jest.useFakeTimers();
    const now = new Date("2026-07-20T08:00:00.000Z");
    jest.setSystemTime(now);
    const startsAt = new Date("2026-07-20T10:00:00.000Z");
    const endsAt = new Date("2026-07-20T12:00:00.000Z");
    prisma.companionProfile.findMany
      .mockResolvedValueOnce([{
        id: "c1",
        serviceOfferings: [{
          id: "offer-text",
          durationMinutes: 60,
          priceCents: 5000,
          currency: "CNY",
          deliveryMode: "text"
        }],
        availabilityWindows: [{ id: "window-full", startsAt, endsAt, capacity: 1 }],
        // One booking blocks every possible 60-minute candidate in this
        // two-hour window, so the profile must not masquerade as available.
        orders: [{
          status: "paid",
          scheduledAt: startsAt,
          durationMinutes: 120,
          companionConfirmedAt: new Date("2026-07-20T09:00:00.000Z"),
          paymentReservationExpiresAt: null
        }]
      }] as any)
      .mockResolvedValueOnce([] as any);
    prisma.companionProfile.count.mockResolvedValue(0 as any);

    const result = await service.list({ availableWithinDays: 3 });

    expect(prisma.companionProfile.findMany.mock.calls[1][0].where).toEqual(expect.objectContaining({
      id: { in: [] }
    }));
    expect(result).toEqual(expect.objectContaining({ items: [], pagination: expect.objectContaining({ total: 0 }) }));
    jest.useRealTimers();
  });

  it("throws a domain 404 when a published companion is missing", async () => {
    prisma.companionProfile.findFirst.mockResolvedValue(null);

    await expect(service.getPublished("missing")).rejects.toMatchObject({
      code: "COMPANION_NOT_FOUND"
    });
  });

  it("returns only active service offerings from a published companion", async () => {
    prisma.companionProfile.findFirst.mockResolvedValue({
      serviceOfferings: [{
        id: "offer-1",
        code: "legacy-standard",
        title: "线上文字陪伴",
        description: "在平台内进行一对一文字沟通。",
        deliveryMode: "text",
        durationMinutes: 30,
        priceCents: 3900,
        currency: "CNY",
        topicIds: ["t1"]
      }]
    } as any);

    const result = await service.listPublishedServiceOfferings("c1");

    expect(prisma.companionProfile.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "c1", isPublished: true }),
      select: expect.objectContaining({ serviceOfferings: expect.objectContaining({ where: { isActive: true } }) })
    }));
    expect(result).toEqual({
      items: [{
        id: "offer-1",
        code: "legacy-standard",
        title: "线上文字陪伴",
        description: "在平台内进行一对一文字沟通。",
        deliveryMode: "text",
        durationMinutes: 30,
        priceCents: 3900,
        currency: "CNY",
        topicIds: ["t1"]
      }]
    });
  });

  it("hides voice purchase entry points while real-time voice is disabled without changing owner catalog data", async () => {
    const disabledConfig = {
      get: jest.fn((key: string, fallback?: unknown) => key === "TRTC_ENABLED" ? false : fallback)
    } as any;
    const disabledService = new CompanionsService(
      prisma,
      moderation,
      moderationCases,
      availabilityReminderCandidates,
      availabilityScheduleRules,
      disabledConfig
    );
    prisma.companionProfile.findFirst.mockResolvedValue({
      serviceOfferings: [
        { ...serviceOfferingRecord, id: "offer-text", deliveryMode: "text" },
        { ...serviceOfferingRecord, id: "offer-voice", deliveryMode: "voice", title: "语音陪伴" }
      ]
    } as any);

    await expect(disabledService.list({ deliveryMode: "voice" })).resolves.toEqual({
      items: [],
      pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 }
    });
    await expect(disabledService.listPublishedServiceOfferings("c1")).resolves.toEqual({
      items: [expect.objectContaining({ id: "offer-text", deliveryMode: "text" })]
    });
    expect(prisma.companionProfile.findMany).not.toHaveBeenCalled();
    expect(prisma.companionProfile.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({ serviceOfferings: expect.objectContaining({ where: { isActive: true } }) })
    }));
  });

  it("does not expose a service catalog for an unpublished or missing companion", async () => {
    prisma.companionProfile.findFirst.mockResolvedValue(null);

    await expect(service.listPublishedServiceOfferings("missing")).rejects.toMatchObject({
      code: "COMPANION_NOT_FOUND"
    });
  });

  it("lets an eligible companion inspect both active and inactive service offerings", async () => {
    prisma.companionProfile.findUnique.mockResolvedValue(eligibleOwnCompanion as any);
    prisma.companionServiceOffering.findMany.mockResolvedValue([
      serviceOfferingRecord,
      { ...serviceOfferingRecord, id: "offer-retired", code: "service-retired", isActive: false, sortOrder: 2 }
    ] as any);

    const result = await service.listOwnServiceOfferings("owner-1");

    expect(prisma.companionServiceOffering.findMany).toHaveBeenCalledWith({
      where: { companionId: "c1" },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]
    });
    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "offer-1", isActive: true, sortOrder: 1 }),
      expect.objectContaining({ id: "offer-retired", isActive: false, sortOrder: 2 })
    ]));
  });

  it("requires both a verified companion profile and a verified active owner for catalog management", async () => {
    prisma.companionProfile.findUnique.mockResolvedValue({
      ...eligibleOwnCompanion,
      isVerified: false
    } as any);

    await expect(service.listOwnServiceOfferings("owner-1"))
      .rejects.toMatchObject({ code: "COMPANION_OWNER_NOT_ELIGIBLE" });

    expect(prisma.companionServiceOffering.findMany).not.toHaveBeenCalled();
  });

  it("creates a moderated, normalized service offering for its verified owner", async () => {
    prisma.companionProfile.findUnique.mockResolvedValue(eligibleOwnCompanion as any);
    prisma.companionServiceOffering.create.mockImplementation(async ({ data }: any) => ({
      ...serviceOfferingRecord,
      ...data,
      createdAt: serviceOfferingRecord.createdAt,
      updatedAt: serviceOfferingRecord.updatedAt
    }));

    const result = await service.createOwnServiceOffering("owner-1", {
      title: " 晚间语音陪伴 ",
      description: " 在平台内安心交流。 ",
      deliveryMode: "voice",
      durationMinutes: 60,
      priceCents: 8800,
      topicIds: [" t3 ", "t1", "t3"],
      sortOrder: 3
    });

    expect(moderation.moderateAsync).toHaveBeenCalledWith(expect.stringContaining("晚间语音陪伴"), "profile");
    expect(prisma.companionServiceOffering.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        id: expect.any(String),
        companionId: "c1",
        code: expect.stringMatching(/^service-/),
        title: "晚间语音陪伴",
        description: "在平台内安心交流。",
        deliveryMode: "voice",
        durationMinutes: 60,
        priceCents: 8800,
        topicIds: ["t3", "t1"],
        isActive: true,
        sortOrder: 3
      })
    }));
    expect(result).toEqual(expect.objectContaining({
      title: "晚间语音陪伴",
      deliveryMode: "voice",
      priceCents: 8800,
      isActive: true,
      sortOrder: 3
    }));
  });

  it("rejects unknown topics before creating a service offering", async () => {
    prisma.companionProfile.findUnique.mockResolvedValue(eligibleOwnCompanion as any);

    await expect(service.createOwnServiceOffering("owner-1", {
      title: "测试服务",
      deliveryMode: "text",
      durationMinutes: 30,
      priceCents: 3900,
      topicIds: ["not-a-topic"]
    })).rejects.toMatchObject({ code: "INVALID_RECOMMENDATION_TOPIC" });

    expect(prisma.companionServiceOffering.create).not.toHaveBeenCalled();
  });

  it("updates only the current companion's offering while preserving its stable code", async () => {
    prisma.companionProfile.findUnique.mockResolvedValue(eligibleOwnCompanion as any);
    prisma.companionServiceOffering.findFirst.mockResolvedValue(serviceOfferingRecord as any);
    prisma.companionServiceOffering.update.mockResolvedValue({
      ...serviceOfferingRecord,
      title: "新的文字陪伴",
      priceCents: 4200,
      sortOrder: 5
    } as any);

    const result = await service.updateOwnServiceOffering("owner-1", "offer-1", {
      title: " 新的文字陪伴 ",
      priceCents: 4200,
      sortOrder: 5
    });

    expect(prisma.companionServiceOffering.findFirst).toHaveBeenCalledWith({
      where: { id: "offer-1", companionId: "c1" }
    });
    expect(prisma.companionServiceOffering.update).toHaveBeenCalledWith({
      where: { id: "offer-1" },
      data: { title: "新的文字陪伴", priceCents: 4200, sortOrder: 5 }
    });
    expect(result).toEqual(expect.objectContaining({
      code: "service-offer-1",
      title: "新的文字陪伴",
      priceCents: 4200,
      sortOrder: 5
    }));
  });

  it("does not reveal or update another companion's service offering", async () => {
    prisma.companionProfile.findUnique.mockResolvedValue(eligibleOwnCompanion as any);
    prisma.companionServiceOffering.findFirst.mockResolvedValue(null);

    await expect(service.updateOwnServiceOffering("owner-1", "offer-from-another-owner", {
      isActive: false
    })).rejects.toMatchObject({ code: "SERVICE_OFFERING_NOT_FOUND" });

    expect(prisma.companionServiceOffering.update).not.toHaveBeenCalled();
  });

  it("screens a retired offering again before it can be reactivated", async () => {
    prisma.companionProfile.findUnique.mockResolvedValue(eligibleOwnCompanion as any);
    prisma.companionServiceOffering.findFirst.mockResolvedValue({
      ...serviceOfferingRecord,
      isActive: false,
      title: "加我私聊"
    } as any);
    moderation.moderateAsync.mockResolvedValue({ decision: "review" });
    moderationCases.createFromResult.mockResolvedValue({ id: "case-offering-1" });

    await expect(service.updateOwnServiceOffering("owner-1", "offer-1", { isActive: true }))
      .rejects.toMatchObject({
        code: "SERVICE_OFFERING_CONTENT_REQUIRES_REVISION",
        details: { moderationCaseId: "case-offering-1", decision: "review" }
      });

    expect(prisma.companionServiceOffering.update).not.toHaveBeenCalled();
  });

  it("lists active and retired availability windows for their verified owner", async () => {
    prisma.companionProfile.findUnique.mockResolvedValue(eligibleOwnCompanion as any);
    prisma.companionAvailabilityWindow.findMany.mockResolvedValue([
      availabilityWindowRecord,
      { ...availabilityWindowRecord, id: "window-retired", isActive: false }
    ] as any);

    const result = await service.listOwnAvailabilityWindows("owner-1");

    expect(prisma.companionAvailabilityWindow.findMany).toHaveBeenCalledWith({
      where: {
        companionId: "c1",
        NOT: {
          isActive: false,
          recurringOccurrenceStartsAt: { not: null }
        }
      },
      orderBy: [{ startsAt: "asc" }, { createdAt: "asc" }],
      take: 200
    });
    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "window-1", capacity: 2, isActive: true }),
      expect.objectContaining({ id: "window-retired", isActive: false })
    ]));
  });

  it("creates a future aligned window and serializes it against overlapping calendar writes", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-07-20T08:00:00.000Z"));
    prisma.companionProfile.findUnique.mockResolvedValue(eligibleOwnCompanion as any);
    prisma.companionAvailabilityWindow.findFirst.mockResolvedValue(null);
    prisma.companionAvailabilityWindow.create.mockImplementation(async ({ data }: any) => ({
      id: "window-new",
      ...data,
      createdAt: availabilityWindowRecord.createdAt,
      updatedAt: availabilityWindowRecord.updatedAt
    }));

    const result = await service.createOwnAvailabilityWindow("owner-1", {
      startsAt: "2026-07-20T10:00:00.000Z",
      endsAt: "2026-07-20T12:00:00.000Z",
      capacity: 3
    });

    expect(prisma.$transaction).toHaveBeenCalled();
    expect(prisma.companionAvailabilityWindow.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        companionId: "c1",
        isActive: true,
        startsAt: { lt: new Date("2026-07-20T12:00:00.000Z") },
        endsAt: { gt: new Date("2026-07-20T10:00:00.000Z") }
      })
    }));
    expect(prisma.companionAvailabilityWindow.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        companionId: "c1",
        startsAt: new Date("2026-07-20T10:00:00.000Z"),
        endsAt: new Date("2026-07-20T12:00:00.000Z"),
        capacity: 3,
        isActive: true
      })
    });
    expect(availabilityReminderCandidates.recordWindowBecameAvailable).toHaveBeenCalledWith(prisma, expect.objectContaining({
      id: "window-new",
      companionId: "c1",
      startsAt: new Date("2026-07-20T10:00:00.000Z"),
      capacity: 3,
      isActive: true,
      updatedAt: availabilityWindowRecord.updatedAt
    }));
    expect(result).toEqual(expect.objectContaining({
      id: "window-new",
      capacity: 3,
      isActive: true,
      startsAt: "2026-07-20T10:00:00.000Z"
    }));
    jest.useRealTimers();
  });

  it("rejects a misaligned or overlapping active availability window", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-07-20T08:00:00.000Z"));
    prisma.companionProfile.findUnique.mockResolvedValue(eligibleOwnCompanion as any);

    await expect(service.createOwnAvailabilityWindow("owner-1", {
      startsAt: "2026-07-20T10:15:00.000Z",
      endsAt: "2026-07-20T11:00:00.000Z"
    })).rejects.toMatchObject({ code: "INVALID_AVAILABILITY_WINDOW_ALIGNMENT" });

    prisma.companionAvailabilityWindow.findFirst.mockResolvedValue(availabilityWindowRecord as any);
    await expect(service.createOwnAvailabilityWindow("owner-1", {
      startsAt: "2026-07-20T11:00:00.000Z",
      endsAt: "2026-07-20T12:30:00.000Z"
    })).rejects.toMatchObject({
      code: "AVAILABILITY_WINDOW_OVERLAP",
      details: { overlappingWindowId: "window-1" }
    });
    expect(prisma.companionAvailabilityWindow.create).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  it("does not reveal another companion's window or silently change a window with an active order", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-07-20T08:00:00.000Z"));
    prisma.companionProfile.findUnique.mockResolvedValue(eligibleOwnCompanion as any);
    prisma.companionAvailabilityWindow.findFirst.mockResolvedValueOnce(null);

    await expect(service.updateOwnAvailabilityWindow("owner-1", "another-owner-window", {
      isActive: false
    })).rejects.toMatchObject({ code: "AVAILABILITY_WINDOW_NOT_FOUND" });

    prisma.companionAvailabilityWindow.findFirst.mockResolvedValueOnce(availabilityWindowRecord as any);
    prisma.order.findFirst.mockResolvedValue({
      id: "order-active",
      status: "paid",
      scheduledAt: new Date("2026-07-20T10:00:00.000Z")
    } as any);

    await expect(service.updateOwnAvailabilityWindow("owner-1", "window-1", {
      isActive: false
    })).rejects.toMatchObject({
      code: "AVAILABILITY_WINDOW_HAS_ACTIVE_ORDERS",
      details: { orderId: "order-active", orderStatus: "paid" }
    });
    expect(prisma.companionAvailabilityWindow.update).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  it("retires an unreserved window after checking its overlap and capacity-safe shape", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-07-20T08:00:00.000Z"));
    prisma.companionProfile.findUnique.mockResolvedValue(eligibleOwnCompanion as any);
    prisma.companionAvailabilityWindow.findFirst.mockResolvedValueOnce(availabilityWindowRecord as any);
    prisma.order.findFirst.mockResolvedValue(null);
    prisma.companionAvailabilityWindow.update.mockResolvedValue({
      ...availabilityWindowRecord,
      isActive: false,
      capacity: 3
    } as any);

    const result = await service.updateOwnAvailabilityWindow("owner-1", "window-1", {
      isActive: false,
      capacity: 3
    });

    expect(prisma.companionAvailabilityWindow.update).toHaveBeenCalledWith({
      where: { id: "window-1" },
      data: { isActive: false, capacity: 3 }
    });
    expect(availabilityReminderCandidates.recordWindowBecameAvailable).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({ id: "window-1", isActive: false, capacity: 3 }));
    jest.useRealTimers();
  });

  it("creates an internal candidate only when a future retired window is reactivated", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-07-20T08:00:00.000Z"));
    const retiredWindow = { ...availabilityWindowRecord, isActive: false };
    prisma.companionProfile.findUnique.mockResolvedValue(eligibleOwnCompanion as any);
    prisma.companionAvailabilityWindow.findFirst
      .mockResolvedValueOnce(retiredWindow as any)
      .mockResolvedValueOnce(null);
    prisma.order.findFirst.mockResolvedValue(null);
    prisma.companionAvailabilityWindow.update.mockResolvedValue({
      ...retiredWindow,
      isActive: true,
      updatedAt: new Date("2026-07-20T08:00:00.000Z")
    } as any);

    await service.updateOwnAvailabilityWindow("owner-1", "window-1", { isActive: true });

    expect(availabilityReminderCandidates.recordWindowBecameAvailable).toHaveBeenCalledWith(prisma, expect.objectContaining({
      id: "window-1",
      companionId: "c1",
      startsAt: availabilityWindowRecord.startsAt,
      capacity: 2,
      isActive: true,
      updatedAt: new Date("2026-07-20T08:00:00.000Z")
    }));
    jest.useRealTimers();
  });

  it("does not treat an ordinary edit of an already active window as a new candidate", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-07-20T08:00:00.000Z"));
    prisma.companionProfile.findUnique.mockResolvedValue(eligibleOwnCompanion as any);
    prisma.companionAvailabilityWindow.findFirst
      .mockResolvedValueOnce(availabilityWindowRecord as any)
      .mockResolvedValueOnce(null);
    prisma.order.findFirst.mockResolvedValue(null);
    prisma.companionAvailabilityWindow.update.mockResolvedValue({
      ...availabilityWindowRecord,
      capacity: 3,
      updatedAt: new Date("2026-07-20T08:00:00.000Z")
    } as any);

    await service.updateOwnAvailabilityWindow("owner-1", "window-1", { capacity: 3 });

    expect(availabilityReminderCandidates.recordWindowBecameAvailable).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  it("keeps recurring rules and blackouts private to the eligible owner without materializing, publishing, or notifying", async () => {
    prisma.companionProfile.findUnique.mockResolvedValue(eligibleOwnCompanion as any);
    prisma.companionRecurringAvailabilityRule.findMany.mockResolvedValue([
      recurringAvailabilityRuleRecord,
      { ...recurringAvailabilityRuleRecord, id: "rule-retired", isActive: false }
    ] as any);
    prisma.companionAvailabilityBlackout.findMany.mockResolvedValue([
      availabilityBlackoutRecord,
      { ...availabilityBlackoutRecord, id: "blackout-retired", isActive: false }
    ] as any);
    availabilityScheduleRules.createRecurringRule.mockResolvedValue({
      ...recurringAvailabilityRuleRecord,
      id: "rule-new"
    });
    availabilityScheduleRules.deactivateRecurringRule.mockResolvedValue({
      ...recurringAvailabilityRuleRecord,
      isActive: false
    });
    availabilityScheduleRules.createBlackout.mockResolvedValue({
      ...availabilityBlackoutRecord,
      id: "blackout-new"
    });
    availabilityScheduleRules.deactivateBlackout.mockResolvedValue({
      ...availabilityBlackoutRecord,
      isActive: false
    });

    const rules = await service.listOwnRecurringAvailabilityRules("owner-1");
    const createdRule = await service.createOwnRecurringAvailabilityRule("owner-1", {
      weekday: 1,
      startsAtMinute: 540,
      endsAtMinute: 720,
      capacity: 2
    });
    const retiredRule = await service.deactivateOwnRecurringAvailabilityRule("owner-1", "rule-1");
    const blackouts = await service.listOwnAvailabilityBlackouts("owner-1");
    const createdBlackout = await service.createOwnAvailabilityBlackout("owner-1", {
      startsAt: "2026-07-23T09:00:00+08:00",
      endsAt: "2026-07-23T12:00:00+08:00"
    });
    const retiredBlackout = await service.deactivateOwnAvailabilityBlackout("owner-1", "blackout-1");

    expect(prisma.companionRecurringAvailabilityRule.findMany).toHaveBeenCalledWith({
      where: { companionId: "c1" },
      orderBy: [
        { isActive: "desc" },
        { weekday: "asc" },
        { startsAtMinute: "asc" },
        { createdAt: "asc" }
      ],
      take: 200
    });
    expect(prisma.companionAvailabilityBlackout.findMany).toHaveBeenCalledWith({
      where: { companionId: "c1" },
      orderBy: [{ isActive: "desc" }, { startsAt: "asc" }, { createdAt: "asc" }],
      take: 200
    });
    expect(availabilityScheduleRules.createRecurringRule).toHaveBeenCalledWith("c1", {
      weekday: 1,
      startsAtMinute: 540,
      endsAtMinute: 720,
      capacity: 2,
      isActive: true
    });
    expect(availabilityScheduleRules.deactivateRecurringRule).toHaveBeenCalledWith("c1", "rule-1");
    expect(availabilityScheduleRules.createBlackout).toHaveBeenCalledWith("c1", {
      startsAt: "2026-07-23T09:00:00+08:00",
      endsAt: "2026-07-23T12:00:00+08:00",
      isActive: true
    });
    expect(availabilityScheduleRules.deactivateBlackout).toHaveBeenCalledWith("c1", "blackout-1");
    expect(rules.items[0]).toEqual(expect.objectContaining({ id: "rule-1", weekday: 1, isActive: true }));
    expect(rules.items[0]).not.toHaveProperty("companionId");
    expect(blackouts.items[0]).toEqual(expect.objectContaining({ id: "blackout-1", isActive: true }));
    expect(blackouts.items[0]).not.toHaveProperty("companionId");
    expect(createdRule).toEqual(expect.objectContaining({ id: "rule-new", isActive: true }));
    expect(retiredRule).toEqual(expect.objectContaining({ id: "rule-1", isActive: false }));
    expect(createdBlackout).toEqual(expect.objectContaining({ id: "blackout-new", isActive: true }));
    expect(retiredBlackout).toEqual(expect.objectContaining({ id: "blackout-1", isActive: false }));
    expect(prisma.companionAvailabilityWindow.findMany).not.toHaveBeenCalled();
    expect(availabilityReminderCandidates.recordWindowBecameAvailable).not.toHaveBeenCalled();
  });

  it("rejects a schedule operation before it can reach another companion's data", async () => {
    prisma.companionProfile.findUnique.mockResolvedValue(null);

    await expect(service.createOwnRecurringAvailabilityRule("owner-1", {
      weekday: 1,
      startsAtMinute: 540,
      endsAtMinute: 720
    })).rejects.toMatchObject({ code: "COMPANION_PROFILE_NOT_FOUND" });
    await expect(service.createOwnAvailabilityBlackout("owner-1", {
      startsAt: "2026-07-23T09:00:00+08:00",
      endsAt: "2026-07-23T12:00:00+08:00"
    })).rejects.toMatchObject({ code: "COMPANION_PROFILE_NOT_FOUND" });

    expect(availabilityScheduleRules.createRecurringRule).not.toHaveBeenCalled();
    expect(availabilityScheduleRules.createBlackout).not.toHaveBeenCalled();
  });

  it("lists only the verified owner's future generated drafts inside the fixed review horizon", async () => {
    jest.useFakeTimers();
    const now = new Date("2026-07-21T00:00:00.000Z");
    jest.setSystemTime(now);
    prisma.companionProfile.findUnique.mockResolvedValue(eligibleOwnCompanion as any);
    prisma.companionAvailabilityWindow.findMany.mockResolvedValue([recurringAvailabilityDraftRecord] as any);

    const result = await service.listOwnRecurringAvailabilityDrafts("owner-1");

    expect(prisma.companionAvailabilityWindow.findMany).toHaveBeenCalledWith({
      where: {
        companionId: "c1",
        isActive: false,
        recurringAvailabilityRuleId: { not: null },
        recurringOccurrenceStartsAt: { not: null },
        startsAt: { gt: now },
        endsAt: { lte: new Date("2026-08-04T00:00:00.000Z") }
      },
      orderBy: [{ startsAt: "asc" }, { createdAt: "asc" }],
      take: 200
    });
    expect(result).toEqual({
      horizonEndsAt: "2026-08-04T00:00:00.000Z",
      items: [expect.objectContaining({
        id: "draft-1",
        startsAt: "2026-07-22T02:00:00.000Z",
        recurringAvailabilityRuleId: "rule-1"
      })]
    });
    expect(result.items[0]).not.toHaveProperty("companionId");
    jest.useRealTimers();
  });

  it("activates one current draft only after rule, blackout, window, and order rechecks without creating a reminder candidate", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-07-21T00:00:00.000Z"));
    prisma.companionProfile.findUnique.mockResolvedValue(eligibleOwnCompanion as any);
    prisma.companionAvailabilityWindow.findFirst
      .mockResolvedValueOnce(recurringAvailabilityDraftRecord as any)
      .mockResolvedValueOnce(null);
    prisma.companionRecurringAvailabilityRule.findFirst.mockResolvedValue({
      id: "rule-1",
      weekday: 3,
      startsAtMinute: 600,
      endsAtMinute: 660,
      capacity: 2
    } as any);
    prisma.companionAvailabilityBlackout.findFirst.mockResolvedValue(null);
    prisma.order.findFirst.mockResolvedValue(null);
    prisma.order.findMany.mockResolvedValue([]);
    prisma.companionAvailabilityWindow.update.mockResolvedValue({
      ...recurringAvailabilityDraftRecord,
      isActive: true,
      updatedAt: new Date("2026-07-21T00:00:00.000Z")
    } as any);

    const result = await service.activateOwnRecurringAvailabilityDraft("owner-1", { id: "draft-1" });

    expect(prisma.$queryRaw).toHaveBeenCalled();
    expect(prisma.companionAvailabilityWindow.findFirst).toHaveBeenNthCalledWith(1, {
      where: {
        id: "draft-1",
        companionId: "c1",
        isActive: false,
        recurringAvailabilityRuleId: { not: null },
        recurringOccurrenceStartsAt: { not: null },
        startsAt: { gt: new Date("2026-07-21T00:00:00.000Z") },
        endsAt: { lte: new Date("2026-08-04T00:00:00.000Z") }
      }
    });
    expect(prisma.companionRecurringAvailabilityRule.findFirst).toHaveBeenCalledWith({
      where: {
        id: "rule-1",
        companionId: "c1",
        isActive: true,
        timezone: "Asia/Shanghai"
      },
      select: {
        id: true,
        weekday: true,
        startsAtMinute: true,
        endsAtMinute: true,
        capacity: true
      }
    });
    expect(prisma.companionAvailabilityBlackout.findFirst).toHaveBeenCalledWith({
      where: {
        companionId: "c1",
        isActive: true,
        startsAt: { lt: recurringAvailabilityDraftRecord.endsAt },
        endsAt: { gt: recurringAvailabilityDraftRecord.startsAt }
      },
      select: { id: true }
    });
    expect(prisma.order.findFirst).toHaveBeenCalledWith({
      where: {
        availabilityWindowId: "draft-1",
        status: { in: ["pending", "paying", "paid", "inService"] }
      },
      select: { id: true, status: true, scheduledAt: true }
    });
    expect(prisma.order.findMany).toHaveBeenCalledWith({
      where: {
        companionId: "c1",
        status: { in: ["pending", "paying", "paid", "inService"] },
        scheduledAt: { lt: recurringAvailabilityDraftRecord.endsAt }
      },
      select: { id: true, scheduledAt: true, durationMinutes: true }
    });
    expect(prisma.companionAvailabilityWindow.update).toHaveBeenCalledWith({
      where: { id: "draft-1" },
      data: { isActive: true }
    });
    expect(result).toEqual(expect.objectContaining({ id: "draft-1", isActive: true }));
    expect(availabilityReminderCandidates.recordWindowBecameAvailable).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  it("refuses a draft whose source rule, exception, open order, or ownership is no longer valid", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-07-21T00:00:00.000Z"));
    prisma.companionProfile.findUnique.mockResolvedValue(eligibleOwnCompanion as any);
    prisma.companionAvailabilityWindow.findFirst.mockResolvedValue(recurringAvailabilityDraftRecord as any);
    prisma.companionRecurringAvailabilityRule.findFirst.mockResolvedValue(null);

    await expect(service.activateOwnRecurringAvailabilityDraft("owner-1", { id: "draft-1" }))
      .rejects.toMatchObject({ code: "RECURRING_AVAILABILITY_DRAFT_SOURCE_UNAVAILABLE" });
    expect(prisma.companionAvailabilityWindow.update).not.toHaveBeenCalled();

    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(async (callback: (db: typeof prisma) => unknown) => callback(prisma));
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.companionProfile.findUnique.mockResolvedValue(eligibleOwnCompanion as any);
    prisma.companionAvailabilityWindow.findFirst.mockResolvedValue(recurringAvailabilityDraftRecord as any);
    prisma.companionRecurringAvailabilityRule.findFirst.mockResolvedValue({
      id: "rule-1",
      weekday: 3,
      startsAtMinute: 600,
      endsAtMinute: 660,
      capacity: 2
    } as any);
    prisma.companionAvailabilityBlackout.findFirst.mockResolvedValue({ id: "blackout-1" } as any);

    await expect(service.activateOwnRecurringAvailabilityDraft("owner-1", { id: "draft-1" }))
      .rejects.toMatchObject({ code: "RECURRING_AVAILABILITY_DRAFT_BLOCKED_BY_BLACKOUT" });
    expect(prisma.companionAvailabilityWindow.update).not.toHaveBeenCalled();

    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(async (callback: (db: typeof prisma) => unknown) => callback(prisma));
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.companionProfile.findUnique.mockResolvedValue(eligibleOwnCompanion as any);
    prisma.companionAvailabilityWindow.findFirst.mockResolvedValue(recurringAvailabilityDraftRecord as any);
    prisma.companionRecurringAvailabilityRule.findFirst.mockResolvedValue({
      id: "rule-1",
      weekday: 3,
      startsAtMinute: 600,
      endsAtMinute: 660,
      capacity: 2
    } as any);
    prisma.companionAvailabilityBlackout.findFirst.mockResolvedValue(null);
    prisma.order.findFirst.mockResolvedValue(null);
    prisma.order.findMany.mockResolvedValue([{
      id: "order-overlap",
      scheduledAt: new Date("2026-07-22T02:30:00.000Z"),
      durationMinutes: 30
    }] as any);

    await expect(service.activateOwnRecurringAvailabilityDraft("owner-1", { id: "draft-1" }))
      .rejects.toMatchObject({ code: "RECURRING_AVAILABILITY_DRAFT_HAS_OPEN_ORDER" });
    expect(prisma.companionAvailabilityWindow.update).not.toHaveBeenCalled();

    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(async (callback: (db: typeof prisma) => unknown) => callback(prisma));
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.companionProfile.findUnique.mockResolvedValue(eligibleOwnCompanion as any);
    prisma.companionAvailabilityWindow.findFirst.mockResolvedValue(null);

    await expect(service.activateOwnRecurringAvailabilityDraft("owner-1", { id: "another-owner-draft" }))
      .rejects.toMatchObject({ code: "RECURRING_AVAILABILITY_DRAFT_NOT_FOUND" });
    expect(prisma.companionAvailabilityWindow.update).not.toHaveBeenCalled();
    expect(availabilityReminderCandidates.recordWindowBecameAvailable).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  it("expands structured windows for the selected service and reports remaining capacity", async () => {
    jest.useFakeTimers();
    const now = new Date("2026-07-20T08:00:00.000Z");
    jest.setSystemTime(now);
    const startsAt = new Date("2026-07-20T10:00:00.000Z");
    const endsAt = new Date("2026-07-20T12:00:00.000Z");
    prisma.companionProfile.findFirst.mockResolvedValue({
      id: "c1",
      availableTimes: ["20:00"],
      serviceOfferings: [{ id: "offer-voice", durationMinutes: 60, topicIds: ["t1"] }]
    } as any);
    prisma.companionAvailabilityWindow.findMany.mockResolvedValue([
      { id: "window-1", startsAt, endsAt, capacity: 2 }
    ] as any);
    prisma.companionAvailabilityWindow.count.mockResolvedValue(1);
    prisma.order.findMany.mockResolvedValue([{
      status: "paid",
      scheduledAt: startsAt,
      durationMinutes: 60,
      companionConfirmedAt: new Date("2026-07-20T09:00:00.000Z"),
      paymentReservationExpiresAt: null
    }] as any);

    const result = await service.listPublishedAvailability("c1", {
      serviceOfferingId: "offer-voice",
      from: now.toISOString(),
      days: 1
    });

    expect(result).toMatchObject({
      source: "structured",
      timezone: "Asia/Shanghai",
      serviceOfferingId: "offer-voice",
      durationMinutes: 60
    });
    expect(result.items[0]).toEqual({
      id: `window-1:${startsAt.toISOString()}`,
      availabilityWindowId: "window-1",
      startsAt: startsAt.toISOString(),
      endsAt: new Date(startsAt.getTime() + 60 * 60_000).toISOString(),
      capacity: 2,
      reservedCount: 1,
      availableCapacity: 1
    });
    expect(prisma.companionAvailabilityWindow.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ companionId: "c1", isActive: true })
    }));
    jest.useRealTimers();
  });

  it("returns legacy availableTimes without fabricating candidates before a profile adopts structured availability", async () => {
    prisma.companionProfile.findFirst.mockResolvedValue({
      id: "c1",
      availableTimes: ["20:00", "21:30"],
      serviceOfferings: []
    } as any);
    prisma.companionAvailabilityWindow.findMany.mockResolvedValue([]);
    prisma.companionAvailabilityWindow.count.mockResolvedValue(0);
    prisma.order.findMany.mockResolvedValue([]);

    const result = await service.listPublishedAvailability("c1", { durationMinutes: 30 });

    expect(result).toEqual(expect.objectContaining({
      source: "legacy",
      serviceOfferingId: null,
      durationMinutes: 30,
      legacyAvailableTimes: ["20:00", "21:30"],
      items: []
    }));
  });

  it("rejects an unavailable service when resolving structured availability", async () => {
    prisma.companionProfile.findFirst.mockResolvedValue({
      id: "c1", availableTimes: ["20:00"], serviceOfferings: []
    } as any);

    await expect(service.listPublishedAvailability("c1", { serviceOfferingId: "retired-offering" }))
      .rejects.toMatchObject({ code: "SERVICE_OFFERING_UNAVAILABLE" });
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
