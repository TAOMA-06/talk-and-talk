import {
  CompanionAvailabilityScheduleRuleService,
  COMPANION_AVAILABILITY_SCHEDULE_TIMEZONE
} from "./companion-availability-schedule-rule.service";

function createService() {
  const prisma = {
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
    companionProfile: { findUnique: jest.fn() },
    companionRecurringAvailabilityRule: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn()
    },
    companionAvailabilityBlackout: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn()
    }
  } as any;
  prisma.$transaction.mockImplementation(async (callback: (db: typeof prisma) => unknown) => callback(prisma));
  prisma.$queryRaw.mockResolvedValue([]);
  prisma.companionProfile.findUnique.mockResolvedValue({ id: "c1" });
  prisma.companionRecurringAvailabilityRule.findFirst.mockResolvedValue(null);
  prisma.companionAvailabilityBlackout.findFirst.mockResolvedValue(null);
  prisma.companionRecurringAvailabilityRule.create.mockImplementation(async ({ data }: any) => ({
    id: "rule-1",
    ...data
  }));
  prisma.companionAvailabilityBlackout.create.mockImplementation(async ({ data }: any) => ({
    id: "blackout-1",
    ...data
  }));
  prisma.companionRecurringAvailabilityRule.update.mockImplementation(async ({ where, data }: any) => ({
    id: where.id,
    companionId: "c1",
    isActive: false,
    ...data
  }));
  prisma.companionAvailabilityBlackout.update.mockImplementation(async ({ where, data }: any) => ({
    id: where.id,
    companionId: "c1",
    isActive: false,
    ...data
  }));
  return { prisma, service: new CompanionAvailabilityScheduleRuleService(prisma) };
}

describe("CompanionAvailabilityScheduleRuleService", () => {
  afterEach(() => jest.useRealTimers());

  it("stores a Shanghai-local weekly rule under the companion lock without touching bookable windows", async () => {
    const { prisma, service } = createService();

    await expect(service.createRecurringRule(" c1 ", {
      weekday: 1,
      startsAtMinute: 9 * 60,
      endsAtMinute: 12 * 60,
      capacity: 2
    })).resolves.toEqual(expect.objectContaining({
      id: "rule-1",
      companionId: "c1",
      weekday: 1,
      startsAtMinute: 540,
      endsAtMinute: 720,
      capacity: 2,
      timezone: COMPANION_AVAILABILITY_SCHEDULE_TIMEZONE,
      isActive: true
    }));

    expect(prisma.$queryRaw).toHaveBeenCalled();
    expect(prisma.companionProfile.findUnique).toHaveBeenCalledWith({
      where: { id: "c1" },
      select: { id: true }
    });
    expect(prisma.companionRecurringAvailabilityRule.findFirst).toHaveBeenCalledWith({
      where: {
        companionId: "c1",
        isActive: true,
        weekday: 1,
        startsAtMinute: { lt: 720 },
        endsAtMinute: { gt: 540 }
      },
      select: { id: true }
    });
    expect(prisma.companionRecurringAvailabilityRule.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ companionId: "c1", timezone: "Asia/Shanghai" })
    });
    expect(prisma).not.toHaveProperty("companionAvailabilityWindow");
  });

  it("rejects invalid weekly day, half-hour boundaries, overnight ranges, capacity, and timezone", async () => {
    const { service } = createService();
    const valid = { weekday: 1, startsAtMinute: 540, endsAtMinute: 720 };

    await expect(service.createRecurringRule("c1", { ...valid, weekday: 7 })).rejects.toMatchObject({
      code: "INVALID_RECURRING_AVAILABILITY_WEEKDAY"
    });
    await expect(service.createRecurringRule("c1", { ...valid, startsAtMinute: 545 })).rejects.toMatchObject({
      code: "INVALID_RECURRING_AVAILABILITY_TIME"
    });
    await expect(service.createRecurringRule("c1", { ...valid, endsAtMinute: 540 })).rejects.toMatchObject({
      code: "INVALID_RECURRING_AVAILABILITY_RANGE"
    });
    await expect(service.createRecurringRule("c1", { ...valid, capacity: 11 })).rejects.toMatchObject({
      code: "INVALID_RECURRING_AVAILABILITY_CAPACITY"
    });
    await expect(service.createRecurringRule("c1", { ...valid, timezone: "UTC" })).rejects.toMatchObject({
      code: "INVALID_AVAILABILITY_SCHEDULE_TIMEZONE"
    });
  });

  it("rejects an active overlapping weekly rule while allowing an explicitly inactive draft", async () => {
    const { prisma, service } = createService();
    prisma.companionRecurringAvailabilityRule.findFirst.mockResolvedValue({ id: "existing-rule" });

    await expect(service.createRecurringRule("c1", {
      weekday: 1,
      startsAtMinute: 600,
      endsAtMinute: 780
    })).rejects.toMatchObject({ code: "RECURRING_AVAILABILITY_RULE_OVERLAP" });

    await expect(service.createRecurringRule("c1", {
      weekday: 1,
      startsAtMinute: 600,
      endsAtMinute: 780,
      isActive: false
    })).resolves.toEqual(expect.objectContaining({ isActive: false }));
    expect(prisma.companionRecurringAvailabilityRule.findFirst).toHaveBeenCalledTimes(1);
  });

  it("stores a future, explicit-timezone blackout as a private exception without changing a window or booking", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-07-21T00:00:00.000Z"));
    const { prisma, service } = createService();

    await expect(service.createBlackout("c1", {
      startsAt: "2026-07-23T09:00:00+08:00",
      endsAt: "2026-07-23T12:00:00+08:00"
    })).resolves.toEqual(expect.objectContaining({
      id: "blackout-1",
      companionId: "c1",
      timezone: COMPANION_AVAILABILITY_SCHEDULE_TIMEZONE,
      isActive: true
    }));

    expect(prisma.companionAvailabilityBlackout.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        companionId: "c1",
        isActive: true,
        startsAt: { lt: new Date("2026-07-23T04:00:00.000Z") },
        endsAt: { gt: new Date("2026-07-23T01:00:00.000Z") }
      }),
      select: { id: true }
    });
    expect(prisma.companionAvailabilityBlackout.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ companionId: "c1", timezone: "Asia/Shanghai" })
    });
    expect(prisma).not.toHaveProperty("order");
  });

  it("rejects malformed, too-soon, unaligned, overlong, or overlapping blackouts", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-07-21T00:00:00.000Z"));
    const { prisma, service } = createService();
    const valid = {
      startsAt: "2026-07-23T09:00:00+08:00",
      endsAt: "2026-07-23T12:00:00+08:00"
    };

    await expect(service.createBlackout("c1", { ...valid, startsAt: "2026-07-23 09:00" }))
      .rejects.toMatchObject({ code: "INVALID_AVAILABILITY_BLACKOUT" });
    await expect(service.createBlackout("c1", {
      ...valid,
      startsAt: "2026-07-21T08:00:00+08:00",
      endsAt: "2026-07-21T09:00:00+08:00"
    })).rejects.toMatchObject({ code: "AVAILABILITY_BLACKOUT_TOO_SOON" });
    await expect(service.createBlackout("c1", { ...valid, endsAt: "2026-07-23T12:15:00+08:00" }))
      .rejects.toMatchObject({ code: "INVALID_AVAILABILITY_BLACKOUT_ALIGNMENT" });
    await expect(service.createBlackout("c1", {
      startsAt: "2026-07-23T09:00:00+08:00",
      endsAt: "2026-08-24T09:00:00+08:00"
    })).rejects.toMatchObject({ code: "INVALID_AVAILABILITY_BLACKOUT_RANGE" });

    prisma.companionAvailabilityBlackout.findFirst.mockResolvedValue({ id: "existing-blackout" });
    await expect(service.createBlackout("c1", valid)).rejects.toMatchObject({
      code: "AVAILABILITY_BLACKOUT_OVERLAP"
    });
  });

  it("retires only the current companion's planning inputs without changing drafts, windows, or orders", async () => {
    const { prisma, service } = createService();
    prisma.companionRecurringAvailabilityRule.findFirst.mockResolvedValue({
      id: "rule-1",
      companionId: "c1",
      isActive: true
    });
    prisma.companionAvailabilityBlackout.findFirst.mockResolvedValue({
      id: "blackout-1",
      companionId: "c1",
      isActive: true
    });

    await expect(service.deactivateRecurringRule(" c1 ", " rule-1 ")).resolves.toEqual(expect.objectContaining({
      id: "rule-1",
      companionId: "c1",
      isActive: false
    }));
    await expect(service.deactivateBlackout("c1", "blackout-1")).resolves.toEqual(expect.objectContaining({
      id: "blackout-1",
      companionId: "c1",
      isActive: false
    }));

    expect(prisma.companionRecurringAvailabilityRule.findFirst).toHaveBeenCalledWith({
      where: { id: "rule-1", companionId: "c1" }
    });
    expect(prisma.companionRecurringAvailabilityRule.update).toHaveBeenCalledWith({
      where: { id: "rule-1" },
      data: { isActive: false }
    });
    expect(prisma.companionAvailabilityBlackout.findFirst).toHaveBeenCalledWith({
      where: { id: "blackout-1", companionId: "c1" }
    });
    expect(prisma.companionAvailabilityBlackout.update).toHaveBeenCalledWith({
      where: { id: "blackout-1" },
      data: { isActive: false }
    });
    expect(prisma).not.toHaveProperty("companionAvailabilityWindow");
    expect(prisma).not.toHaveProperty("order");
  });

  it("does not reveal another companion's rule or blackout and leaves an already retired record unchanged", async () => {
    const { prisma, service } = createService();
    prisma.companionRecurringAvailabilityRule.findFirst.mockResolvedValue(null);

    await expect(service.deactivateRecurringRule("c1", "someone-elses-rule"))
      .rejects.toMatchObject({ code: "RECURRING_AVAILABILITY_RULE_NOT_FOUND" });
    expect(prisma.companionRecurringAvailabilityRule.update).not.toHaveBeenCalled();

    prisma.companionAvailabilityBlackout.findFirst.mockResolvedValue({
      id: "blackout-retired",
      companionId: "c1",
      isActive: false
    });
    await expect(service.deactivateBlackout("c1", "blackout-retired")).resolves.toEqual(expect.objectContaining({
      id: "blackout-retired",
      isActive: false
    }));
    expect(prisma.companionAvailabilityBlackout.update).not.toHaveBeenCalled();
  });

  it("does not create rules or blackouts for a missing companion", async () => {
    const { prisma, service } = createService();
    prisma.companionProfile.findUnique.mockResolvedValue(null);

    await expect(service.createRecurringRule("missing", {
      weekday: 1,
      startsAtMinute: 540,
      endsAtMinute: 720
    })).rejects.toMatchObject({ code: "COMPANION_NOT_FOUND" });
    expect(prisma.companionRecurringAvailabilityRule.create).not.toHaveBeenCalled();
  });
});
