import { CommercialOpsMetricsService } from "./commercial-ops-metrics.service";

describe("CommercialOpsMetricsService", () => {
  const prisma = {
    order: { findMany: jest.fn() },
    auditLog: { findMany: jest.fn() },
    companionCommercialProfile: { count: jest.fn() },
    companionTrainingRecord: { findMany: jest.fn() },
    companionProfile: { count: jest.fn() },
    companionAvailabilityWindow: { findMany: jest.fn() },
    refundTransaction: { findMany: jest.fn() },
    paymentDispute: { findMany: jest.fn() },
    companionFavorite: { findMany: jest.fn() },
    moderationCase: { count: jest.fn() },
    moderationAppeal: { count: jest.fn() }
  } as any;
  const reminderFanout = { operationalReadiness: jest.fn() };
  const reminderPipeline = { operationalReadiness: jest.fn() };
  const service = new CommercialOpsMetricsService(
    prisma,
    reminderFanout as any,
    reminderPipeline as any
  );

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-08-04T12:00:00.000Z"));

    prisma.companionCommercialProfile.count.mockImplementation((args?: any) => {
      if (args?.where?.status === "verified") return Promise.resolve(6);
      return Promise.resolve(10);
    });
    prisma.companionTrainingRecord.findMany.mockResolvedValue([
      { companionId: "c1" },
      { companionId: "c2" }
    ]);
    prisma.companionProfile.count.mockResolvedValue(4);
    prisma.companionAvailabilityWindow.findMany.mockImplementation((args?: any) => {
      if (args?.select?.orders) {
        return Promise.resolve([
          { id: "w1", capacity: 2, orders: [{ id: "o1" }] },
          { id: "w2", capacity: 1, orders: [] }
        ]);
      }
      return Promise.resolve([{ companionId: "c1" }, { companionId: "c2" }]);
    });
    prisma.order.findMany.mockImplementation((args?: any) => {
      if (args?.distinct?.includes("companionId")) {
        return Promise.resolve([{ companionId: "c1" }]);
      }
      if (args?.where?.paidAt) {
        return Promise.resolve([
          { userId: "u1", companionId: "c1", paidAt: new Date("2026-07-25T02:00:00.000Z") }
        ]);
      }
      return Promise.resolve([
        {
          id: "o1",
          userId: "u1",
          companionId: "c1",
          createdAt: new Date("2026-07-20T00:00:00.000Z"),
          paidAt: new Date("2026-07-20T01:00:00.000Z"),
          companionConfirmedAt: new Date("2026-07-20T00:30:00.000Z"),
          refunds: [{ id: "r1" }]
        },
        {
          id: "o2",
          userId: "u1",
          companionId: "c1",
          createdAt: new Date("2026-07-25T00:00:00.000Z"),
          paidAt: new Date("2026-07-25T01:00:00.000Z"),
          companionConfirmedAt: null,
          refunds: []
        },
        {
          id: "o3",
          userId: "u2",
          companionId: "c2",
          createdAt: new Date("2026-07-26T00:00:00.000Z"),
          paidAt: null,
          companionConfirmedAt: null,
          refunds: []
        }
      ]);
    });
    prisma.refundTransaction.findMany.mockResolvedValue([
      { reason: "customer_request", exceptionReasonCode: null },
      { reason: "Late and rude feedback with phone 13800138000", exceptionReasonCode: "support_exception" }
    ]);
    prisma.paymentDispute.findMany.mockResolvedValue([
      {
        firstResponseDueAt: new Date("2026-07-21T00:00:00.000Z"),
        resolutionDueAt: new Date("2026-07-23T00:00:00.000Z"),
        firstRespondedAt: new Date("2026-07-20T12:00:00.000Z"),
        resolvedAt: new Date("2026-07-22T00:00:00.000Z")
      },
      {
        firstResponseDueAt: new Date("2026-07-21T00:00:00.000Z"),
        resolutionDueAt: new Date("2026-07-23T00:00:00.000Z"),
        firstRespondedAt: null,
        resolvedAt: null
      }
    ]);
    prisma.companionFavorite.findMany.mockResolvedValue([
      { userId: "u1", companionId: "c1", createdAt: new Date("2026-07-19T00:00:00.000Z") },
      { userId: "u3", companionId: "c2", createdAt: new Date("2026-07-19T00:00:00.000Z") }
    ]);
    prisma.moderationCase.count.mockImplementation((args?: any) => {
      if (args?.where?.dueAt) return Promise.resolve(1);
      return Promise.resolve(3);
    });
    prisma.moderationAppeal.count.mockImplementation((args?: any) => {
      if (args?.where?.reviewDueAt) return Promise.resolve(1);
      return Promise.resolve(2);
    });
    reminderFanout.operationalReadiness.mockResolvedValue({
      status: "clear",
      backlog: { failed: 0, expiredLeases: 0, due: 0 }
    });
    reminderPipeline.operationalReadiness.mockResolvedValue({
      status: "attentionRequired",
      preparationRunnerEnabled: true,
      deliveryRunnerEnabled: false,
      failedPreparation: 0,
      failedReservation: 0,
      failedDelivery: 1,
      dueAttempts: 2,
      dueCandidates: 0,
      dueReservations: 0,
      terminalAttempts: { unresolved: 1, resolved: 0 }
    });
    prisma.auditLog.findMany.mockImplementation((args?: any) => {
      if (args?.where?.action === "order.companion_rejected") {
        return Promise.resolve([{ resourceId: "o3" }]);
      }
      if (args?.where?.action === "order.companion_response_expired") {
        return Promise.resolve([{ resourceId: "o2" }]);
      }
      return Promise.resolve([]);
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("aggregates privacy-safe ops metrics without free-text PII reasons", async () => {
    const result = await service.get({
      from: "2026-07-01T00:00:00.000Z",
      to: "2026-08-04T12:00:00.000Z"
    });

    expect(result.response).toEqual(expect.objectContaining({
      requested: 3,
      accepted: 1,
      rejected: 1,
      timedOut: 1,
      confirmationRate: 0.3333,
      rejectRate: 0.3333,
      responseTimeoutRate: 0.3333
    }));
    expect(result.supplyFunnel).toEqual(expect.objectContaining({
      profilesSubmitted: 10,
      profilesVerified: 6,
      trainingCurrent: 2,
      published: 4,
      withFutureCapacity: 2,
      firstAccepted: 1
    }));
    expect(result.slots).toEqual(expect.objectContaining({
      releasedCapacity: 3,
      bookedUnits: 1,
      idleCapacity: 2,
      utilizationRate: 0.3333
    }));
    expect(result.refunds.byReason).toEqual(
      expect.arrayContaining([
        { key: "customer_request", count: 1 },
        { key: "free_text", count: 1 }
      ])
    );
    expect(JSON.stringify(result)).not.toContain("13800138000");
    expect(result.complaints).toEqual(expect.objectContaining({
      disputes: 2,
      firstResponseHitRate: 0.5,
      overdueFirstResponse: 1,
      overdueResolution: 1
    }));
    expect(result.repurchase).toEqual({
      payingPairs: 1,
      repeatPairs: 1,
      sameCompanionRepurchaseRate: 1
    });
    expect(result.bookmarks).toEqual({
      favoritesCreated: 2,
      convertedToPaid: 1,
      conversionRate: 0.5
    });
    expect(result.moderation).toEqual({
      openCases: 3,
      overdueCases: 1,
      openAppeals: 2,
      overdueAppeals: 1
    });
    expect(result.availabilityReminders).toEqual(expect.objectContaining({
      status: "attentionRequired",
      pipeline: expect.objectContaining({
        deliveryRunnerEnabled: false,
        unresolvedTerminalAttempts: 1,
        stageFailures: 1
      })
    }));
  });

  it("rejects oversized ranges", async () => {
    await expect(service.get({
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-08-04T12:00:00.000Z"
    })).rejects.toMatchObject({ code: "COMMERCIAL_OPS_METRICS_RANGE_TOO_LARGE" });
  });

  it("returns empty-safe aggregates for an empty cohort", async () => {
    prisma.order.findMany.mockResolvedValue([]);
    prisma.companionAvailabilityWindow.findMany.mockResolvedValue([]);
    prisma.refundTransaction.findMany.mockResolvedValue([]);
    prisma.paymentDispute.findMany.mockResolvedValue([]);
    prisma.companionFavorite.findMany.mockResolvedValue([]);
    prisma.auditLog.findMany.mockResolvedValue([]);

    const result = await service.get({
      from: "2026-07-01T00:00:00.000Z",
      to: "2026-08-04T12:00:00.000Z"
    });

    expect(result.response.requested).toBe(0);
    expect(result.refunds.refundOrderRate).toBe(0);
    expect(result.bookmarks.conversionRate).toBe(0);
    expect(result.truncated).toBe(false);
  });
});
