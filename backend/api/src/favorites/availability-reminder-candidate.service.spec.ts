import { AvailabilityReminderCandidateService } from "./availability-reminder-candidate.service";

describe("AvailabilityReminderCandidateService", () => {
  const db = {
    companionFavorite: { findMany: jest.fn() },
    availabilityReminderCandidate: { createMany: jest.fn() }
  } as any;
  const service = new AvailabilityReminderCandidateService();

  beforeEach(() => jest.clearAllMocks());

  it("creates deduplicated private candidates only for current public, armed bookmarks", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-07-21T08:00:00.000Z"));
    db.companionFavorite.findMany.mockResolvedValue([{ id: "favorite-1" }, { id: "favorite-2" }]);
    db.availabilityReminderCandidate.createMany.mockResolvedValue({ count: 2 });

    await expect(service.recordWindowBecameAvailable(db, {
      id: "window-1",
      companionId: "companion-1",
      startsAt: new Date("2026-07-21T10:00:00.000Z"),
      capacity: 2,
      isActive: true,
      updatedAt: new Date("2026-07-21T08:00:00.000Z")
    })).resolves.toEqual({ created: 2 });

    expect(db.companionFavorite.findMany).toHaveBeenCalledWith({
      where: {
        companionId: "companion-1",
        availabilityReminderEnabled: true,
        availabilityReminderGrantId: { not: null },
        companion: { is: {
          isPublished: true,
          isVerified: true,
          ownerUserId: { not: null },
          owner: { accountStatus: "active", profile: { isVerified: true } },
          commercialProfile: { status: "verified" }
        } }
      },
      select: { id: true }
    });
    expect(db.availabilityReminderCandidate.createMany).toHaveBeenCalledWith({
      data: [
        {
          favoriteId: "favorite-1", companionId: "companion-1", availabilityWindowId: "window-1",
          availabilityWindowUpdatedAt: new Date("2026-07-21T08:00:00.000Z")
        },
        {
          favoriteId: "favorite-2", companionId: "companion-1", availabilityWindowId: "window-1",
          availabilityWindowUpdatedAt: new Date("2026-07-21T08:00:00.000Z")
        }
      ],
      skipDuplicates: true
    });
    const favoriteQuery = db.companionFavorite.findMany.mock.calls[0][0];
    expect(favoriteQuery).not.toHaveProperty("include");
    expect(favoriteQuery.where).not.toHaveProperty("userId");
    expect(favoriteQuery.where).not.toHaveProperty("order");
    expect(favoriteQuery.where).not.toHaveProperty("conversation");
    expect(favoriteQuery.where).not.toHaveProperty("message");
    expect(favoriteQuery.select).toEqual({ id: true });
    jest.useRealTimers();
  });

  it("does not query or create anything for inactive, empty-capacity, or nonfuture windows", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-07-21T08:00:00.000Z"));

    await expect(service.recordWindowBecameAvailable(db, {
      id: "window-retired", companionId: "companion-1", startsAt: new Date("2026-07-21T10:00:00.000Z"), capacity: 2, isActive: false, updatedAt: new Date("2026-07-21T08:00:00.000Z")
    })).resolves.toEqual({ created: 0 });
    await expect(service.recordWindowBecameAvailable(db, {
      id: "window-empty", companionId: "companion-1", startsAt: new Date("2026-07-21T10:00:00.000Z"), capacity: 0, isActive: true, updatedAt: new Date("2026-07-21T08:00:00.000Z")
    })).resolves.toEqual({ created: 0 });
    await expect(service.recordWindowBecameAvailable(db, {
      id: "window-past", companionId: "companion-1", startsAt: new Date("2026-07-21T08:00:00.000Z"), capacity: 2, isActive: true, updatedAt: new Date("2026-07-21T08:00:00.000Z")
    })).resolves.toEqual({ created: 0 });

    expect(db.companionFavorite.findMany).not.toHaveBeenCalled();
    expect(db.availabilityReminderCandidate.createMany).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  it("does not create a record when no eligible armed bookmark remains", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-07-21T08:00:00.000Z"));
    db.companionFavorite.findMany.mockResolvedValue([]);

    await expect(service.recordWindowBecameAvailable(db, {
      id: "window-1", companionId: "companion-1", startsAt: new Date("2026-07-21T10:00:00.000Z"), capacity: 1, isActive: true, updatedAt: new Date("2026-07-21T08:00:00.000Z")
    })).resolves.toEqual({ created: 0 });

    expect(db.availabilityReminderCandidate.createMany).not.toHaveBeenCalled();
    jest.useRealTimers();
  });
});
