import { AvailabilityReminderPreflightService } from "./availability-reminder-preflight.service";

const NOW = new Date("2026-07-21T07:00:00.000Z");
const WINDOW_UPDATED_AT = new Date("2026-07-21T06:30:00.000Z");

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    id: "candidate-1",
    favoriteId: "favorite-1",
    companionId: "companion-1",
    availabilityWindowId: "window-1",
    availabilityWindowUpdatedAt: WINDOW_UPDATED_AT,
    preflightDecision: "pending",
    preflightReason: null,
    preflightedAt: null,
    ...overrides
  };
}

function favorite(overrides: Record<string, unknown> = {}) {
  return {
    id: "favorite-1",
    userId: "customer-1",
    availabilityReminderGrantId: "grant-1",
    availabilityReminderLastDeliveredAt: null,
    ...overrides
  };
}

function availabilityWindow(overrides: Record<string, unknown> = {}) {
  return {
    id: "window-1",
    startsAt: new Date("2026-07-21T08:00:00.000Z"),
    endsAt: new Date("2026-07-21T09:00:00.000Z"),
    capacity: 1,
    ...overrides
  };
}

describe("AvailabilityReminderPreflightService", () => {
  const prisma = {
    $queryRaw: jest.fn(),
    availabilityReminderCandidate: { findUnique: jest.fn(), update: jest.fn() },
    companionFavorite: { findFirst: jest.fn() },
    weChatSubscriptionGrant: { findFirst: jest.fn() },
    companionAvailabilityWindow: { findFirst: jest.fn() },
    companionServiceOffering: { findMany: jest.fn() },
    order: { findMany: jest.fn() }
  } as any;
  prisma.$transaction = jest.fn((callback: (transaction: typeof prisma) => unknown) => callback(prisma));
  const service = new AvailabilityReminderPreflightService(prisma);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
      const sql = Array.from(strings).join("");
      return sql.includes('SELECT TRUE AS "available"') ? [{ available: true }] : [];
    });
    prisma.availabilityReminderCandidate.findUnique.mockResolvedValue(candidate());
    prisma.companionFavorite.findFirst.mockResolvedValue(favorite());
    prisma.weChatSubscriptionGrant.findFirst.mockResolvedValue({ id: "grant-1" });
    prisma.companionAvailabilityWindow.findFirst.mockResolvedValue(availabilityWindow());
    prisma.companionServiceOffering.findMany.mockResolvedValue([{ durationMinutes: 30 }]);
    prisma.order.findMany.mockResolvedValue([]);
    prisma.availabilityReminderCandidate.update.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({
      ...candidate(),
      ...data
    }));
  });

  it("records an eligible internal decision only after live favorite, grant, window, and capacity checks", async () => {
    const result = await service.evaluate("candidate-1", NOW);

    expect(result).toEqual({
      candidateId: "candidate-1",
      decision: "eligible",
      reason: null,
      decidedAt: NOW.toISOString()
    });
    expect(prisma.companionFavorite.findFirst).toHaveBeenCalledWith({
      where: {
        id: "favorite-1",
        companionId: "companion-1",
        availabilityReminderEnabled: true,
        availabilityReminderGrantId: { not: null },
        companion: {
          is: {
            isPublished: true,
            isVerified: true,
            ownerUserId: { not: null },
            owner: { accountStatus: "active", profile: { isVerified: true } },
            commercialProfile: { status: "verified" }
          }
        }
      },
      select: {
        id: true,
        userId: true,
        availabilityReminderGrantId: true,
        availabilityReminderLastDeliveredAt: true
      }
    });
    expect(prisma.weChatSubscriptionGrant.findFirst).toHaveBeenCalledWith({
      where: {
        id: "grant-1",
        userId: "customer-1",
        templateKey: "availabilityReminder",
        consumedAt: null
      },
      select: { id: true }
    });
    expect(prisma.companionAvailabilityWindow.findFirst).toHaveBeenCalledWith({
      where: {
        id: "window-1",
        companionId: "companion-1",
        updatedAt: WINDOW_UPDATED_AT,
        isActive: true,
        endsAt: { gt: new Date("2026-07-21T07:15:00.000Z") }
      },
      select: { id: true, startsAt: true, endsAt: true, capacity: true }
    });
    expect(prisma.order.findMany).not.toHaveBeenCalled();
    expect(prisma.availabilityReminderCandidate.update).toHaveBeenCalledWith({
      where: { id: "candidate-1" },
      data: {
        preflightDecision: "eligible",
        preflightReason: null,
        preflightedAt: NOW
      },
      select: {
        id: true,
        preflightDecision: true,
        preflightReason: true,
        preflightedAt: true
      }
    });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(5);
    expect(Array.from(prisma.$queryRaw.mock.calls[4][0] as string[]).join(""))
      .toContain('reservation."scheduledAt" + make_interval');
  });

  it("skips when the bookmark, preference, or live public profile is no longer eligible", async () => {
    prisma.companionFavorite.findFirst.mockResolvedValue(null);

    await expect(service.evaluate("candidate-1", NOW)).resolves.toEqual({
      candidateId: "candidate-1",
      decision: "skipped",
      reason: "favoriteUnavailable",
      decidedAt: NOW.toISOString()
    });

    expect(prisma.weChatSubscriptionGrant.findFirst).not.toHaveBeenCalled();
    expect(prisma.companionAvailabilityWindow.findFirst).not.toHaveBeenCalled();
    expect(prisma.companionServiceOffering.findMany).not.toHaveBeenCalled();
    expect(prisma.order.findMany).not.toHaveBeenCalled();
  });

  it("skips when the exact bound one-time authorization was already consumed or withdrawn", async () => {
    prisma.weChatSubscriptionGrant.findFirst.mockResolvedValue(null);

    await expect(service.evaluate("candidate-1", NOW)).resolves.toEqual(expect.objectContaining({
      decision: "skipped",
      reason: "authorizationUnavailable"
    }));

    expect(prisma.companionAvailabilityWindow.findFirst).not.toHaveBeenCalled();
    expect(prisma.companionServiceOffering.findMany).not.toHaveBeenCalled();
    expect(prisma.order.findMany).not.toHaveBeenCalled();
  });

  it("skips under the per-bookmark 24-hour successful-delivery frequency limit", async () => {
    prisma.companionFavorite.findFirst.mockResolvedValue(favorite({
      availabilityReminderLastDeliveredAt: new Date("2026-07-20T08:00:00.000Z")
    }));

    await expect(service.evaluate("candidate-1", NOW)).resolves.toEqual(expect.objectContaining({
      decision: "skipped",
      reason: "rateLimited"
    }));

    expect(prisma.companionAvailabilityWindow.findFirst).not.toHaveBeenCalled();
    expect(prisma.companionServiceOffering.findMany).not.toHaveBeenCalled();
    expect(prisma.order.findMany).not.toHaveBeenCalled();
  });

  it("skips when a current structured window has no remaining bookable capacity", async () => {
    prisma.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
      const sql = Array.from(strings).join("");
      return sql.includes('SELECT TRUE AS "available"') ? [] : [];
    });

    await expect(service.evaluate("candidate-1", NOW)).resolves.toEqual(expect.objectContaining({
      decision: "skipped",
      reason: "availabilityUnavailable"
    }));
  });

  it("skips a candidate whose source window changed, retired, or otherwise stopped being current", async () => {
    prisma.companionAvailabilityWindow.findFirst.mockResolvedValue(null);

    await expect(service.evaluate("candidate-1", NOW)).resolves.toEqual(expect.objectContaining({
      decision: "skipped",
      reason: "availabilityUnavailable"
    }));

    expect(prisma.companionServiceOffering.findMany).not.toHaveBeenCalled();
    expect(prisma.order.findMany).not.toHaveBeenCalled();
  });

  it("returns a previously persisted decision without rechecking or changing it", async () => {
    prisma.availabilityReminderCandidate.findUnique.mockResolvedValue(candidate({
      preflightDecision: "skipped",
      preflightReason: "rateLimited",
      preflightedAt: new Date("2026-07-21T06:00:00.000Z")
    }));

    await expect(service.evaluate("candidate-1", NOW)).resolves.toEqual({
      candidateId: "candidate-1",
      decision: "skipped",
      reason: "rateLimited",
      decidedAt: "2026-07-21T06:00:00.000Z"
    });

    expect(prisma.companionFavorite.findFirst).not.toHaveBeenCalled();
    expect(prisma.availabilityReminderCandidate.update).not.toHaveBeenCalled();
  });

  it("freshly rechecks an eligible candidate and returns ephemeral minimum preparation ids without rewriting preflight", async () => {
    prisma.availabilityReminderCandidate.findUnique.mockResolvedValue(candidate({
      preflightDecision: "eligible",
      preflightedAt: new Date("2026-07-21T06:00:00.000Z")
    }));

    await expect(service.recheckEligibleCandidate("candidate-1", NOW)).resolves.toEqual({
      candidateId: "candidate-1",
      decision: "eligible",
      reason: null,
      preparation: {
        favoriteId: "favorite-1",
        userId: "customer-1",
        subscriptionGrantId: "grant-1",
        companionId: "companion-1",
        availabilityWindowId: "window-1"
      }
    });

    expect(prisma.companionFavorite.findFirst).toHaveBeenCalled();
    expect(prisma.weChatSubscriptionGrant.findFirst).toHaveBeenCalled();
    expect(prisma.companionAvailabilityWindow.findFirst).toHaveBeenCalled();
    expect(prisma.order.findMany).not.toHaveBeenCalled();
    expect(prisma.availabilityReminderCandidate.update).not.toHaveBeenCalled();
  });

  it("uses the caller's transaction for a live recheck without opening another transaction or persisting a decision", async () => {
    prisma.availabilityReminderCandidate.findUnique.mockResolvedValue(candidate({
      preflightDecision: "eligible",
      preflightedAt: new Date("2026-07-21T06:00:00.000Z")
    }));

    await expect(service.recheckEligibleCandidateWithinTransaction(prisma, "candidate-1", NOW))
      .resolves.toEqual(expect.objectContaining({
        decision: "eligible",
        preparation: expect.objectContaining({ subscriptionGrantId: "grant-1" })
      }));

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(5);
    expect(prisma.$queryRaw.mock.calls.slice(0, 4).map((call: any[]) => (call[0] as TemplateStringsArray).join(""))).toEqual([
      expect.stringContaining('FROM "AvailabilityReminderCandidate"'),
      expect.stringContaining('FROM "CompanionFavorite"'),
      expect.stringContaining('FROM "WeChatSubscriptionGrant"'),
      expect.stringContaining('FROM "CompanionAvailabilityWindow"')
    ]);
    expect(prisma.availabilityReminderCandidate.update).not.toHaveBeenCalled();
  });

  it("does not treat pending or skipped candidates as ready for a later delivery stage", async () => {
    prisma.availabilityReminderCandidate.findUnique.mockResolvedValue(candidate({
      preflightDecision: "skipped",
      preflightReason: "availabilityUnavailable",
      preflightedAt: new Date("2026-07-21T06:00:00.000Z")
    }));

    await expect(service.recheckEligibleCandidate("candidate-1", NOW))
      .rejects.toMatchObject({ code: "AVAILABILITY_REMINDER_CANDIDATE_NOT_ELIGIBLE", status: 409 });
    expect(prisma.companionFavorite.findFirst).not.toHaveBeenCalled();
  });

  it("does not turn an internal candidate lookup into a permissive blank-id path", async () => {
    await expect(service.evaluate("   ", NOW))
      .rejects.toMatchObject({ code: "AVAILABILITY_REMINDER_CANDIDATE_NOT_FOUND", status: 404 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
