import {
  CompanionRecurringAvailabilityDraftMaterializerService,
  COMPANION_RECURRING_AVAILABILITY_DRAFT_HORIZON_DAYS
} from "./companion-recurring-availability-draft-materializer.service";

const NOW = new Date("2026-07-21T00:00:00.000Z");

function createService() {
  const prisma = {
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
    companionProfile: { findUnique: jest.fn() },
    companionRecurringAvailabilityRule: { findMany: jest.fn() },
    companionAvailabilityBlackout: { findMany: jest.fn() },
    companionAvailabilityWindow: {
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn()
    },
    order: { findMany: jest.fn() }
  } as any;
  prisma.$transaction.mockImplementation(async (callback: (db: typeof prisma) => unknown) => callback(prisma));
  prisma.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
    const sql = Array.from(strings).join("");
    return sql.includes('AS "blackout"')
      ? [{ blackout: false, window: false, order: false }]
      : [];
  });
  prisma.companionProfile.findUnique.mockResolvedValue({ id: "c1" });
  prisma.companionRecurringAvailabilityRule.findMany.mockResolvedValue([]);
  prisma.companionAvailabilityBlackout.findMany.mockResolvedValue([]);
  prisma.companionAvailabilityWindow.findMany.mockResolvedValue([]);
  prisma.companionAvailabilityWindow.count.mockResolvedValue(0);
  prisma.companionAvailabilityWindow.create.mockImplementation(async ({ data }: any) => ({ id: "draft", ...data }));
  return { prisma, service: new CompanionRecurringAvailabilityDraftMaterializerService(prisma) };
}

describe("CompanionRecurringAvailabilityDraftMaterializerService", () => {
  it("materializes only bounded inactive drafts with an idempotent rule-occurrence source", async () => {
    const { prisma, service } = createService();
    prisma.companionRecurringAvailabilityRule.findMany.mockResolvedValue([{
      id: "tuesday-rule",
      weekday: 2,
      startsAtMinute: 10 * 60,
      endsAtMinute: 11 * 60,
      capacity: 2
    }]);

    await expect(service.materialize(" c1 ", NOW)).resolves.toEqual({
      evaluatedRules: 1,
      consideredOccurrences: 2,
      created: 2,
      alreadyMaterialized: 0,
      skippedByBlackout: 0,
      skippedByExistingWindow: 0,
      skippedByOrder: 0,
      skippedOutsideHorizon: 0,
      skippedByDraftLimit: 0
    });

    expect(prisma.$queryRaw).toHaveBeenCalled();
    expect(prisma.companionAvailabilityWindow.create).toHaveBeenNthCalledWith(1, {
      data: {
        companionId: "c1",
        startsAt: new Date("2026-07-21T02:00:00.000Z"),
        endsAt: new Date("2026-07-21T03:00:00.000Z"),
        capacity: 2,
        isActive: false,
        recurringAvailabilityRuleId: "tuesday-rule",
        recurringOccurrenceStartsAt: new Date("2026-07-21T02:00:00.000Z")
      }
    });
    expect(prisma.companionAvailabilityWindow.create).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({
        isActive: false,
        recurringAvailabilityRuleId: "tuesday-rule",
        recurringOccurrenceStartsAt: new Date("2026-07-28T02:00:00.000Z")
      })
    });
    expect(prisma.companionAvailabilityWindow.count).toHaveBeenCalledWith({
      where: { companionId: "c1", isActive: false }
    });
    const sql = prisma.$queryRaw.mock.calls[1][0].join(" ");
    expect(sql).toContain('reservation."scheduledAt"');
    expect(sql).toContain("EXISTS");
    expect(COMPANION_RECURRING_AVAILABILITY_DRAFT_HORIZON_DAYS).toBe(14);
    expect(prisma).not.toHaveProperty("availabilityReminderCandidate");
  });

  it("skips blackouts, every existing window, and existing order coverage without mutating any of them", async () => {
    const { prisma, service } = createService();
    prisma.companionRecurringAvailabilityRule.findMany.mockResolvedValue([
      { id: "tuesday-rule", weekday: 2, startsAtMinute: 600, endsAtMinute: 660, capacity: 1 },
      { id: "wednesday-rule", weekday: 3, startsAtMinute: 600, endsAtMinute: 660, capacity: 1 }
    ]);
    prisma.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ blackout: true, window: false, order: false }])
      .mockResolvedValueOnce([{ blackout: false, window: true, order: false }])
      .mockResolvedValueOnce([{ blackout: false, window: false, order: true }])
      .mockResolvedValueOnce([{ blackout: false, window: false, order: false }]);

    await expect(service.materialize("c1", NOW)).resolves.toEqual({
      evaluatedRules: 2,
      consideredOccurrences: 4,
      created: 1,
      alreadyMaterialized: 0,
      skippedByBlackout: 1,
      skippedByExistingWindow: 1,
      skippedByOrder: 1,
      skippedOutsideHorizon: 0,
      skippedByDraftLimit: 0
    });

    expect(prisma.companionAvailabilityWindow.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        recurringAvailabilityRuleId: "wednesday-rule",
        recurringOccurrenceStartsAt: new Date("2026-07-29T02:00:00.000Z"),
        isActive: false
      })
    });
    expect(prisma.companionAvailabilityWindow).not.toHaveProperty("update");
    expect(prisma.companionAvailabilityWindow).not.toHaveProperty("delete");
  });

  it("preserves a legacy order longer than the current API maximum when its true end overlaps", async () => {
    const { prisma, service } = createService();
    prisma.companionRecurringAvailabilityRule.findMany.mockResolvedValue([{
      id: "tuesday-rule",
      weekday: 2,
      startsAtMinute: 10 * 60,
      endsAtMinute: 11 * 60,
      capacity: 1
    }]);
    prisma.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ blackout: false, window: false, order: true }])
      .mockResolvedValueOnce([{ blackout: false, window: false, order: false }]);

    await expect(service.materialize("c1", NOW)).resolves.toMatchObject({
      skippedByOrder: 1,
      created: 1
    });
    expect(prisma.companionAvailabilityWindow.create).toHaveBeenCalledTimes(1);
  });

  it("is idempotent when a repeated pass already sees its drafts or loses a source-key race", async () => {
    const { prisma, service } = createService();
    const rule = { id: "tuesday-rule", weekday: 2, startsAtMinute: 600, endsAtMinute: 660, capacity: 1 };
    prisma.companionRecurringAvailabilityRule.findMany.mockResolvedValue(rule ? [rule] : []);
    await service.materialize("c1", NOW);
    prisma.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ blackout: false, window: true, order: false }])
      .mockResolvedValueOnce([{ blackout: false, window: true, order: false }]);
    await expect(service.materialize("c1", NOW)).resolves.toEqual(expect.objectContaining({
      created: 0,
      skippedByExistingWindow: 2
    }));

    const raced = createService();
    raced.prisma.companionRecurringAvailabilityRule.findMany.mockResolvedValue([rule]);
    raced.prisma.companionAvailabilityWindow.create.mockRejectedValue({ code: "P2002" });
    await expect(raced.service.materialize("c1", NOW)).resolves.toEqual(expect.objectContaining({
      created: 0,
      alreadyMaterialized: 2
    }));
  });

  it("rejects a missing companion before any draft can be created", async () => {
    const { prisma, service } = createService();
    prisma.companionProfile.findUnique.mockResolvedValue(null);

    await expect(service.materialize("missing", NOW)).rejects.toMatchObject({ code: "COMPANION_NOT_FOUND" });
    expect(prisma.companionAvailabilityWindow.create).not.toHaveBeenCalled();
  });

  it("stops materializing when the durable inactive-window cap is reached", async () => {
    const { prisma, service } = createService();
    prisma.companionRecurringAvailabilityRule.findMany.mockResolvedValue([{
      id: "tuesday-rule", weekday: 2, startsAtMinute: 600, endsAtMinute: 660, capacity: 1
    }]);
    prisma.companionAvailabilityWindow.count.mockResolvedValue(500);

    await expect(service.materialize("c1", NOW)).resolves.toMatchObject({
      created: 0,
      skippedByDraftLimit: 2
    });
    expect(prisma.companionAvailabilityWindow.create).not.toHaveBeenCalled();
  });
});
