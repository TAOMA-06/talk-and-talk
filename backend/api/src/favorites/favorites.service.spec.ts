import { FavoritesService } from "./favorites.service";

const companion = {
  id: "companion-1",
  name: "林屿",
  role: "温柔倾听者",
  initials: "LY",
  rating: 4.9,
  reviewCount: 168,
  pricePerHalfHour: 39,
  isOnline: true,
  isVerified: true,
  bio: "在线上留出一段安全、清晰的倾听时间。",
  availableTimes: ["21:00"],
  languages: ["中文"],
  specialties: ["情绪倾听"],
  topicIds: ["t1"],
  completedOrders: 426,
  responseTime: "约30秒",
  distanceKm: 1.2,
  availability: "online",
  cityDistrict: "平台内",
  isPublished: true,
  createdAt: new Date("2026-07-20T00:00:00.000Z"),
  updatedAt: new Date("2026-07-20T00:00:00.000Z"),
  serviceTags: [{ tag: { name: "情绪倾听" } }]
};

describe("FavoritesService", () => {
  const prisma = {
    $queryRaw: jest.fn(),
    companionFavorite: { findMany: jest.fn(), upsert: jest.fn(), deleteMany: jest.fn(), updateMany: jest.fn() },
    companionRecentView: { findMany: jest.fn(), upsert: jest.fn(), deleteMany: jest.fn() },
    companionProfile: { findFirst: jest.fn() },
    weChatSubscriptionGrant: { findFirst: jest.fn() }
  } as any;
  prisma.$transaction = jest.fn((callback: (transaction: typeof prisma) => unknown) => callback(prisma));
  const audit = { record: jest.fn() } as any;
  const service = new FavoritesService(prisma, audit);

  beforeEach(() => jest.clearAllMocks());

  it("returns only currently public favorites in the customer's private list", async () => {
    prisma.companionFavorite.findMany.mockResolvedValue([{
      companion,
      availabilityReminderEnabled: true,
      availabilityReminderUpdatedAt: new Date("2026-07-21T01:00:00.000Z")
    }]);

    const result = await service.listCompanions("customer-1");

    expect(prisma.companionFavorite.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        userId: "customer-1",
        companion: {
          is: expect.objectContaining({
            isPublished: true,
            isVerified: true,
            ownerUserId: { not: null },
            owner: { accountStatus: "active", profile: { isVerified: true } },
            commercialProfile: { status: "verified" }
          })
        }
      }),
      orderBy: [{ createdAt: "desc" }, { id: "asc" }]
    }));
    expect(result.items).toEqual([expect.objectContaining({
      id: "companion-1",
      tags: ["情绪倾听"],
      name: "林屿",
      availabilityReminderEnabled: true,
      availabilityReminderUpdatedAt: "2026-07-21T01:00:00.000Z",
      availabilityReminderMinimumIntervalHours: 24
    })]);
    expect(result.items[0]).not.toHaveProperty("ownerUserId");
    expect(result.items[0]).not.toHaveProperty("favoriteCount");
    expect(result.items[0]).not.toHaveProperty("availabilityReminderGrantId");
  });

  it("saves only a currently public companion and leaves an internal audit record", async () => {
    prisma.companionProfile.findFirst.mockResolvedValue(companion);
    prisma.companionFavorite.upsert.mockResolvedValue({ id: "favorite-1" });

    const result = await service.saveCompanion("customer-1", "companion-1");

    expect(prisma.companionProfile.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: "companion-1",
        isPublished: true,
        isVerified: true,
        ownerUserId: { not: null },
        owner: { accountStatus: "active", profile: { isVerified: true } },
        commercialProfile: { status: "verified" }
      })
    }));
    expect(prisma.companionFavorite.upsert).toHaveBeenCalledWith({
      where: { userId_companionId: { userId: "customer-1", companionId: "companion-1" } },
      create: { userId: "customer-1", companionId: "companion-1" },
      update: {}
    });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      actorId: "customer-1",
      action: "favorite.companion_saved",
      resourceType: "companionFavorite",
      metadata: { companionId: "companion-1" }
    }));
    expect(result).toEqual(expect.objectContaining({ favorited: true, companion: expect.objectContaining({ id: "companion-1" }) }));
  });

  it("does not allow a bookmark request to probe unpublished or otherwise ineligible supply", async () => {
    prisma.companionProfile.findFirst.mockResolvedValue(null);

    await expect(service.saveCompanion("customer-1", "hidden-companion"))
      .rejects.toMatchObject({ code: "COMPANION_NOT_FOUND", status: 404 });
    expect(prisma.companionFavorite.upsert).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("removes only the caller's bookmark and does not emit a no-op audit event", async () => {
    prisma.companionFavorite.deleteMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });

    await expect(service.removeCompanion("customer-1", "companion-1"))
      .resolves.toEqual({ favorited: false, removed: true });
    expect(prisma.companionFavorite.deleteMany).toHaveBeenCalledWith({
      where: { userId: "customer-1", companionId: "companion-1" }
    });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      actorId: "customer-1",
      action: "favorite.companion_removed",
      metadata: { companionId: "companion-1" }
    }));

    audit.record.mockClear();
    await expect(service.removeCompanion("customer-1", "companion-1"))
      .resolves.toEqual({ favorited: false, removed: false });
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("arms a reminder only for the caller's still-public bookmark and its own unconsumed grant", async () => {
    const grantId = "00000000-0000-4000-8000-000000000010";
    prisma.weChatSubscriptionGrant.findFirst.mockResolvedValue({ id: grantId });
    prisma.companionFavorite.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.setAvailabilityReminder("customer-1", "companion-1", {
      enabled: true,
      subscriptionGrantId: grantId
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    expect(prisma.weChatSubscriptionGrant.findFirst).toHaveBeenCalledWith({
      where: {
        id: grantId,
        userId: "customer-1",
        templateKey: "availabilityReminder",
        consumedAt: null,
        availabilityReminderAttempt: null
      },
      select: { id: true }
    });
    expect(prisma.companionFavorite.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        userId: "customer-1",
        companionId: "companion-1",
        companion: { is: expect.objectContaining({
          isPublished: true,
          isVerified: true,
          ownerUserId: { not: null },
          owner: { accountStatus: "active", profile: { isVerified: true } },
          commercialProfile: { status: "verified" }
        }) }
      }),
      data: {
        availabilityReminderEnabled: true,
        availabilityReminderGrantId: grantId,
        availabilityReminderUpdatedAt: expect.any(Date)
      }
    }));
    expect(result).toEqual(expect.objectContaining({
      companionId: "companion-1",
      enabled: true,
      minimumIntervalHours: 24
    }));
    expect(result).not.toHaveProperty("subscriptionGrantId");
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      actorId: "customer-1",
      action: "favorite.availability_reminder_enabled",
      resourceType: "companionFavorite",
      metadata: { companionId: "companion-1", minimumIntervalHours: 24 }
    }));
  });

  it("lets the caller disarm their still-public bookmark without another grant", async () => {
    prisma.companionFavorite.updateMany.mockResolvedValue({ count: 1 });

    await expect(service.setAvailabilityReminder("customer-1", "companion-1", { enabled: false }))
      .resolves.toEqual(expect.objectContaining({ enabled: false, minimumIntervalHours: 24 }));

    expect(prisma.weChatSubscriptionGrant.findFirst).not.toHaveBeenCalled();
    expect(prisma.companionFavorite.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: {
        availabilityReminderEnabled: false,
        availabilityReminderGrantId: null,
        availabilityReminderUpdatedAt: expect.any(Date)
      }
    }));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "favorite.availability_reminder_disabled",
      metadata: { companionId: "companion-1", minimumIntervalHours: 24 }
    }));
  });

  it("rejects a client-only reminder preference when no caller-owned authorization remains", async () => {
    prisma.weChatSubscriptionGrant.findFirst.mockResolvedValue(null);

    await expect(service.setAvailabilityReminder("customer-1", "companion-1", {
      enabled: true,
      subscriptionGrantId: "00000000-0000-4000-8000-000000000010"
    })).rejects.toMatchObject({ code: "FAVORITE_REMINDER_AUTHORIZATION_REQUIRED", status: 409 });

    expect(prisma.companionFavorite.updateMany).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("does not rebind an authorization already held by a private reminder reservation", async () => {
    const grantId = "00000000-0000-4000-8000-000000000010";
    // A reservation is intentionally represented only by the grant relation at
    // this boundary; the preference route must not learn its handoff or owner.
    prisma.weChatSubscriptionGrant.findFirst.mockResolvedValue(null);

    await expect(service.setAvailabilityReminder("customer-1", "companion-1", {
      enabled: true,
      subscriptionGrantId: grantId
    })).rejects.toMatchObject({ code: "FAVORITE_REMINDER_AUTHORIZATION_REQUIRED", status: 409 });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    expect(prisma.weChatSubscriptionGrant.findFirst).toHaveBeenCalledWith({
      where: {
        id: grantId,
        userId: "customer-1",
        templateKey: "availabilityReminder",
        consumedAt: null,
        availabilityReminderAttempt: null
      },
      select: { id: true }
    });
    expect(prisma.companionFavorite.updateMany).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("does not reveal whether a missing, removed, or hidden profile had a reminder preference", async () => {
    prisma.companionFavorite.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.setAvailabilityReminder("customer-1", "hidden-companion", { enabled: false }))
      .rejects.toMatchObject({ code: "FAVORITE_REMINDER_NOT_FOUND", status: 404 });

    expect(prisma.companionFavorite.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        userId: "customer-1",
        companionId: "hidden-companion",
        companion: { is: expect.objectContaining({ isPublished: true, isVerified: true }) }
      })
    }));
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("lists only currently public recent views in descending view order", async () => {
    prisma.companionRecentView.findMany.mockResolvedValue([{ companion }]);

    const result = await service.listRecentlyViewedCompanions("customer-1");

    expect(prisma.companionRecentView.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        userId: "customer-1",
        companion: { is: expect.objectContaining({
          isPublished: true,
          isVerified: true,
          ownerUserId: { not: null },
          owner: { accountStatus: "active", profile: { isVerified: true } },
          commercialProfile: { status: "verified" }
        }) }
      }),
      orderBy: [{ viewedAt: "desc" }, { id: "asc" }],
      take: 20
    }));
    expect(result.items).toEqual([expect.objectContaining({ id: "companion-1", name: "林屿" })]);
    expect(result.items[0]).not.toHaveProperty("ownerUserId");
    expect(result.items[0]).not.toHaveProperty("viewedAt");
  });

  it("upserts a public recent view, keeps at most twenty records, and emits no behavioral event", async () => {
    prisma.companionProfile.findFirst.mockResolvedValue(companion);
    prisma.companionRecentView.upsert.mockResolvedValue({ id: "recent-view-1" });
    prisma.companionRecentView.findMany.mockResolvedValue([{ id: "stale-view-1" }, { id: "stale-view-2" }]);
    prisma.companionRecentView.deleteMany.mockResolvedValue({ count: 2 });

    await expect(service.recordRecentlyViewedCompanion("customer-1", "companion-1"))
      .resolves.toEqual({ recorded: true });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.companionRecentView.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId_companionId: { userId: "customer-1", companionId: "companion-1" } },
      create: { userId: "customer-1", companionId: "companion-1" },
      update: { viewedAt: expect.any(Date) }
    }));
    expect(prisma.companionRecentView.findMany).toHaveBeenCalledWith({
      where: { userId: "customer-1" },
      orderBy: [{ viewedAt: "desc" }, { id: "asc" }],
      skip: 20,
      select: { id: true }
    });
    expect(prisma.companionRecentView.deleteMany).toHaveBeenCalledWith({
      where: { userId: "customer-1", id: { in: ["stale-view-1", "stale-view-2"] } }
    });
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("does not record a recently viewed profile that is unpublished or otherwise ineligible", async () => {
    prisma.companionProfile.findFirst.mockResolvedValue(null);

    await expect(service.recordRecentlyViewedCompanion("customer-1", "hidden-companion"))
      .rejects.toMatchObject({ code: "COMPANION_NOT_FOUND", status: 404 });
    expect(prisma.companionRecentView.upsert).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("clears only the caller's private recent views without creating an audit event", async () => {
    prisma.companionRecentView.deleteMany.mockResolvedValue({ count: 3 });

    await expect(service.clearRecentlyViewedCompanions("customer-1"))
      .resolves.toEqual({ cleared: 3 });
    expect(prisma.companionRecentView.deleteMany).toHaveBeenCalledWith({ where: { userId: "customer-1" } });
    expect(audit.record).not.toHaveBeenCalled();
  });
});
