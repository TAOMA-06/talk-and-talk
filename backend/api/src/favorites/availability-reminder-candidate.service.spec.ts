import { AvailabilityReminderCandidateService } from "./availability-reminder-candidate.service";

describe("AvailabilityReminderCandidateService", () => {
  const db = {
    companionFavorite: { findMany: jest.fn() },
    availabilityReminderCandidate: { createMany: jest.fn() },
    availabilityReminderFanoutJob: { createMany: jest.fn() }
  } as any;
  const service = new AvailabilityReminderCandidateService();

  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.useRealTimers());

  it("writes exactly one idempotent fanout job and never scans bookmarks in the window transaction", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-07-21T08:00:00.000Z"));
    db.availabilityReminderFanoutJob.createMany.mockResolvedValue({ count: 1 });

    await expect(service.recordWindowBecameAvailable(db, {
      id: "window-1",
      companionId: "companion-1",
      startsAt: new Date("2026-07-21T10:00:00.000Z"),
      capacity: 2,
      isActive: true,
      updatedAt: new Date("2026-07-21T08:00:00.000Z")
    })).resolves.toEqual({ created: 0, queued: 1 });

    expect(db.availabilityReminderFanoutJob.createMany).toHaveBeenCalledWith({
      data: [{
        companionId: "companion-1",
        availabilityWindowId: "window-1",
        availabilityWindowUpdatedAt: new Date("2026-07-21T08:00:00.000Z"),
        audienceCutoffAt: new Date("2026-07-21T08:00:00.000Z")
      }],
      skipDuplicates: true
    });
    expect(db.companionFavorite.findMany).not.toHaveBeenCalled();
    expect(db.availabilityReminderCandidate.createMany).not.toHaveBeenCalled();
  });

  it("returns the existing idempotent outcome when the same window version was already queued", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-07-21T08:00:00.000Z"));
    db.availabilityReminderFanoutJob.createMany.mockResolvedValue({ count: 0 });

    await expect(service.recordWindowBecameAvailable(db, {
      id: "window-1",
      companionId: "companion-1",
      startsAt: new Date("2026-07-21T10:00:00.000Z"),
      capacity: 1,
      isActive: true,
      updatedAt: new Date("2026-07-21T08:00:00.000Z")
    })).resolves.toEqual({ created: 0, queued: 0 });
  });

  it("does not write a job for inactive, empty-capacity, or nonfuture windows", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-07-21T08:00:00.000Z"));

    await expect(service.recordWindowBecameAvailable(db, {
      id: "window-retired", companionId: "companion-1", startsAt: new Date("2026-07-21T10:00:00.000Z"), capacity: 2, isActive: false, updatedAt: new Date("2026-07-21T08:00:00.000Z")
    })).resolves.toEqual({ created: 0, queued: 0 });
    await expect(service.recordWindowBecameAvailable(db, {
      id: "window-empty", companionId: "companion-1", startsAt: new Date("2026-07-21T10:00:00.000Z"), capacity: 0, isActive: true, updatedAt: new Date("2026-07-21T08:00:00.000Z")
    })).resolves.toEqual({ created: 0, queued: 0 });
    await expect(service.recordWindowBecameAvailable(db, {
      id: "window-past", companionId: "companion-1", startsAt: new Date("2026-07-21T08:00:00.000Z"), capacity: 2, isActive: true, updatedAt: new Date("2026-07-21T08:00:00.000Z")
    })).resolves.toEqual({ created: 0, queued: 0 });

    expect(db.availabilityReminderFanoutJob.createMany).not.toHaveBeenCalled();
    expect(db.companionFavorite.findMany).not.toHaveBeenCalled();
  });
});
