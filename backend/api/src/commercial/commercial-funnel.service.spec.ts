import { CommercialFunnelService } from "./commercial-funnel.service";

describe("CommercialFunnelService", () => {
  const prisma = {
    order: { findMany: jest.fn() },
    auditLog: { findMany: jest.fn() }
  } as any;
  const service = new CommercialFunnelService(prisma);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.auditLog.findMany.mockResolvedValue([]);
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-07-25T12:00:00.000Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("builds a privacy-safe operating funnel from authoritative transaction facts", async () => {
    prisma.order.findMany
      .mockResolvedValueOnce([
        {
          id: "o1",
          userId: "u1",
          amountCents: 10_000,
          currency: "CNY",
          createdAt: new Date("2026-07-10T00:00:00.000Z"),
          scheduledAt: new Date("2026-07-10T08:00:00.000Z"),
          durationMinutes: 30,
          companionConfirmedAt: new Date("2026-07-10T00:05:00.000Z"),
          paidAt: new Date("2026-07-10T00:10:00.000Z"),
          serviceStartedAt: new Date("2026-07-10T08:03:00.000Z"),
          completedAt: new Date("2026-07-10T08:35:00.000Z"),
          recommendationImpressionId: "i1",
          serviceOfferingDeliveryModeSnapshot: "text",
          reviews: [{ id: "r1" }],
          refunds: [{ amountCents: 1000 }]
        },
        {
          id: "o2",
          userId: "u1",
          amountCents: 6000,
          currency: "CNY",
          createdAt: new Date("2026-07-20T00:00:00.000Z"),
          scheduledAt: new Date("2026-07-20T08:00:00.000Z"),
          durationMinutes: 30,
          companionConfirmedAt: null,
          paidAt: new Date("2026-07-20T00:10:00.000Z"),
          serviceStartedAt: new Date("2026-07-20T08:10:00.000Z"),
          completedAt: new Date("2026-07-20T08:40:00.000Z"),
          recommendationImpressionId: null,
          serviceOfferingDeliveryModeSnapshot: "voice",
          reviews: [],
          refunds: []
        },
        {
          id: "o3",
          userId: "u2",
          amountCents: 3900,
          currency: "CNY",
          createdAt: new Date("2026-07-21T00:00:00.000Z"),
          scheduledAt: new Date("2026-07-21T08:00:00.000Z"),
          durationMinutes: 30,
          companionConfirmedAt: null,
          paidAt: null,
          serviceStartedAt: null,
          completedAt: null,
          recommendationImpressionId: null,
          serviceOfferingDeliveryModeSnapshot: "text",
          reviews: [],
          refunds: []
        }
      ])
      .mockResolvedValueOnce([{ userId: "u1" }]);
    prisma.auditLog.findMany.mockResolvedValue([{ resourceId: "o2" }]);

    const result = await service.get({
      from: "2026-07-01T00:00:00.000Z",
      to: "2026-07-25T12:00:00.000Z"
    });

    expect(result.stages).toEqual({
      requested: 3,
      accepted: 2,
      paid: 2,
      startEligible: 2,
      started: 2,
      onTimeStarted: 1,
      completionEligible: 2,
      completed: 2,
      reviewed: 1,
      refunded: 1
    });
    expect(result.rates).toEqual(expect.objectContaining({
      acceptanceRate: 0.6667,
      paymentRateFromRequest: 0.6667,
      onTimeStartRate: 0.5,
      reviewRate: 0.5,
      refundOrderRate: 0.5
    }));
    expect(result.acquisition).toEqual(expect.objectContaining({
      recommendationAttributedOrders: 1,
      orderAttributionCoverage: 0.3333,
      paidAttributionCoverage: 0.5
    }));
    expect(result.customers).toEqual({
      payingCustomers: 1,
      repeatPayingCustomers: 1,
      repeatCustomerRate: 1
    });
    expect(result.financials).toEqual({
      currency: "CNY",
      grossPaidCents: 16_000,
      refundedCents: 1000,
      netCollectedCents: 15_000,
      averagePaidOrderCents: 8000
    });
    expect(result.paidDeliveryModes).toEqual({ text: 1, voice: 1, legacy: 0 });
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        action: "order.companion_confirmed",
        resourceId: { in: ["o1", "o2", "o3"] }
      })
    }));
    expect(prisma.order.findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 10_001
    }));
    expect(JSON.stringify(result)).not.toMatch(/userId|chat|content|message/i);
  });

  it("rejects executive queries wider than the bounded reporting window", async () => {
    await expect(service.get({
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-07-25T12:00:00.000Z"
    })).rejects.toMatchObject({ code: "COMMERCIAL_FUNNEL_RANGE_TOO_LARGE" });
    expect(prisma.order.findMany).not.toHaveBeenCalled();
  });

  it("keeps eligibility-based rates within the cohort denominator", async () => {
    prisma.order.findMany.mockResolvedValueOnce([
      {
        id: "future-start",
        userId: "u1",
        amountCents: 3900,
        currency: "CNY",
        createdAt: new Date("2026-07-25T10:00:00.000Z"),
        scheduledAt: new Date("2026-07-25T12:05:00.000Z"),
        durationMinutes: 30,
        companionConfirmedAt: null,
        paidAt: new Date("2026-07-25T10:05:00.000Z"),
        serviceStartedAt: new Date("2026-07-25T11:55:00.000Z"),
        completedAt: null,
        recommendationImpressionId: null,
        serviceOfferingDeliveryModeSnapshot: "text",
        reviews: [],
        refunds: []
      }
    ]).mockResolvedValueOnce([]);

    const result = await service.get({
      from: "2026-07-25T00:00:00.000Z",
      to: "2026-07-25T12:00:00.000Z"
    });

    expect(result.stages).toEqual(expect.objectContaining({
      accepted: 0,
      paid: 1,
      startEligible: 0,
      started: 1,
      completionEligible: 0
    }));
    expect(result.rates).toEqual(expect.objectContaining({
      paymentRateFromAccepted: 0,
      serviceStartRate: 0,
      completionRate: 0
    }));
  });
});
