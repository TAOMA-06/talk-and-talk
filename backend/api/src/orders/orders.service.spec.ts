import { HttpStatus } from "@nestjs/common";

import { AppException } from "../common/errors/app.exception";
import { OrdersService } from "./orders.service";

describe("OrdersService", () => {
  const prisma = {
    companionProfile: {
      findFirst: jest.fn(),
      findUnique: jest.fn()
    },
    companionServiceOffering: {
      findFirst: jest.fn()
    },
    companionAvailabilityWindow: {
      findFirst: jest.fn()
    },
    orderTimelineEvent: {
      create: jest.fn(),
      findMany: jest.fn()
    },
    orderRescheduleRequest: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn()
    },
    order: {
      create: jest.fn(),
      count: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn()
    },
    paymentTransaction: {
      findFirst: jest.fn(),
      updateMany: jest.fn()
    },
    refundTransaction: {
      findFirst: jest.fn(),
      create: jest.fn()
    },
    $transaction: jest.fn()
  } as any;

  const notifications = { create: jest.fn().mockResolvedValue({}) } as any;
  const wechat = { closePayment: jest.fn().mockResolvedValue(undefined) } as any;
  let service: OrdersService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.order.findFirst.mockResolvedValue(null);
    prisma.order.count.mockResolvedValue(0);
    prisma.$transaction.mockImplementation(async (fn: any) => fn({
      ...prisma,
      $queryRaw: jest.fn().mockResolvedValue([])
    }));
    service = new OrdersService(prisma, notifications, wechat);
  });

  it("creates a pending order with server-side pricing in cents", async () => {
    prisma.companionProfile.findFirst.mockResolvedValue({
      id: "c1",
      pricePerHalfHour: 39,
      isPublished: true
    });
    prisma.order.create.mockResolvedValue({
      id: "o1",
      userId: "u1",
      companionId: "c1",
      themeId: "t1",
      durationMinutes: 60,
      amountCents: 7800,
      currency: "CNY",
      status: "pending",
      conversationId: null,
      paidAt: null,
      cancelledAt: null,
      completedAt: null,
      createdAt: new Date("2026-07-09T00:00:00.000Z"),
      updatedAt: new Date("2026-07-09T00:00:00.000Z")
    });

    const result = await service.create("u1", {
      companionId: "c1",
      themeId: "t1",
      durationMinutes: 60,
      scheduledAt: new Date(Date.now() + 3_600_000).toISOString()
    });

    expect(prisma.order.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          amountCents: 7800,
          status: "pending",
          durationMinutes: 60
        })
      })
    );
    expect(result.amountYuan).toBe(78);
    expect(result.status).toBe("pending");
    expect(prisma.orderTimelineEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        orderId: "o1",
        type: "orderCreated",
        actorId: "u1",
        actorRole: "customer"
      })
    }));
    expect(prisma.companionProfile.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: "c1",
        commercialProfile: { status: "verified" }
      })
    }));
  });

  it("binds an active service offering and freezes its commercial snapshot", async () => {
    const config = {
      get: jest.fn((key: string, fallback?: unknown) => key === "TRTC_ENABLED" ? true : fallback)
    } as any;
    service = new OrdersService(prisma, notifications, wechat, undefined, config);
    prisma.companionProfile.findFirst.mockResolvedValue({
      id: "c1", name: "林屿", role: "温柔倾听者", initials: "LY", pricePerHalfHour: 39
    });
    prisma.companionServiceOffering.findFirst.mockResolvedValue({
      id: "offer-voice", companionId: "c1", code: "voice-60", title: "60 分钟语音陪伴",
      description: null, deliveryMode: "voice", durationMinutes: 60, priceCents: 6900,
      currency: "CNY", topicIds: ["t1"], isActive: true
    });
    prisma.order.create.mockResolvedValue({
      id: "o-offer", userId: "u1", companionId: "c1", serviceOfferingId: "offer-voice",
      serviceOfferingCodeSnapshot: "voice-60", serviceOfferingTitleSnapshot: "60 分钟语音陪伴",
      serviceOfferingDeliveryModeSnapshot: "voice", serviceOfferingDurationSnapshot: 60,
      serviceOfferingPriceCentsSnapshot: 6900, serviceOfferingCurrencySnapshot: "CNY",
      themeId: "t1", durationMinutes: 60, amountCents: 6900, currency: "CNY", status: "pending",
      conversationId: null, paidAt: null, cancelledAt: null, completedAt: null,
      createdAt: new Date("2026-07-20T00:00:00.000Z"), updatedAt: new Date("2026-07-20T00:00:00.000Z")
    });

    const result = await service.create("u1", {
      companionId: "c1", serviceOfferingId: "offer-voice", themeId: "t1", durationMinutes: 60,
      scheduledAt: new Date(Date.now() + 3_600_000).toISOString()
    });

    expect(prisma.companionServiceOffering.findFirst).toHaveBeenCalledWith({
      where: { id: "offer-voice", companionId: "c1", isActive: true }
    });
    expect(prisma.order.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        serviceOfferingId: "offer-voice",
        serviceOfferingTitleSnapshot: "60 分钟语音陪伴",
        serviceOfferingDurationSnapshot: 60,
        serviceOfferingPriceCentsSnapshot: 6900,
        durationMinutes: 60,
        amountCents: 6900
      })
    }));
    expect(result.serviceOfferingSnapshot).toEqual({
      id: "offer-voice", code: "voice-60", title: "60 分钟语音陪伴", deliveryMode: "voice",
      durationMinutes: 60, priceCents: 6900, currency: "CNY"
    });
  });

  it("rejects a voice offering before it creates an order when real-time voice is disabled", async () => {
    const config = {
      get: jest.fn((key: string, fallback?: unknown) => key === "TRTC_ENABLED" ? false : fallback)
    } as any;
    service = new OrdersService(prisma, notifications, wechat, undefined, config);
    prisma.companionProfile.findFirst.mockResolvedValue({
      id: "c1", name: "林屿", role: "温柔倾听者", initials: "LY", pricePerHalfHour: 39
    });
    prisma.companionServiceOffering.findFirst.mockResolvedValue({
      id: "offer-voice", companionId: "c1", code: "voice-60", title: "60 分钟语音陪伴",
      description: null, deliveryMode: "voice", durationMinutes: 60, priceCents: 6900,
      currency: "CNY", topicIds: ["t1"], isActive: true
    });

    await expect(service.create("u1", {
      companionId: "c1", serviceOfferingId: "offer-voice", themeId: "t1", durationMinutes: 60,
      scheduledAt: new Date(Date.now() + 3_600_000).toISOString()
    })).rejects.toMatchObject({
      code: "VOICE_FEATURE_DISABLED",
      status: HttpStatus.SERVICE_UNAVAILABLE
    });
    expect(prisma.order.create).not.toHaveBeenCalled();
  });

  it("binds a structured availability candidate and freezes its scheduling snapshot", async () => {
    const scheduledAt = new Date(Math.ceil((Date.now() + 3 * 60 * 60_000) / (30 * 60_000)) * (30 * 60_000));
    const window = {
      id: "window-1",
      companionId: "c1",
      startsAt: new Date(scheduledAt.getTime() - 30 * 60_000),
      endsAt: new Date(scheduledAt.getTime() + 90 * 60_000),
      capacity: 2,
      isActive: true
    };
    prisma.companionProfile.findFirst.mockResolvedValue({
      id: "c1", name: "林屿", role: "温柔倾听者", initials: "LY", pricePerHalfHour: 39
    });
    prisma.companionAvailabilityWindow.findFirst.mockResolvedValue(window);
    prisma.order.create.mockResolvedValue({
      id: "o-window", userId: "u1", companionId: "c1", availabilityWindowId: "window-1",
      availabilityWindowStartsAtSnapshot: window.startsAt,
      availabilityWindowEndsAtSnapshot: window.endsAt,
      availabilityWindowCapacitySnapshot: 2,
      themeId: "t1", durationMinutes: 60, amountCents: 7800, currency: "CNY", status: "pending",
      scheduledAt, conversationId: null, paidAt: null, cancelledAt: null, completedAt: null,
      createdAt: new Date(), updatedAt: new Date()
    });

    const result = await service.create("u1", {
      companionId: "c1", availabilityWindowId: "window-1", themeId: "t1", durationMinutes: 60,
      scheduledAt: scheduledAt.toISOString()
    });

    expect(prisma.order.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        availabilityWindowId: "window-1",
        availabilityWindowStartsAtSnapshot: window.startsAt,
        availabilityWindowEndsAtSnapshot: window.endsAt,
        availabilityWindowCapacitySnapshot: 2
      })
    }));
    expect(result.availabilitySnapshot).toEqual({
      availabilityWindowId: "window-1",
      startsAt: window.startsAt.toISOString(),
      endsAt: window.endsAt.toISOString(),
      capacity: 2
    });
  });

  it("rejects a full structured availability candidate before creating a new request", async () => {
    const scheduledAt = new Date(Math.ceil((Date.now() + 3 * 60 * 60_000) / (30 * 60_000)) * (30 * 60_000));
    const window = {
      id: "window-1", companionId: "c1", startsAt: new Date(scheduledAt.getTime() - 30 * 60_000),
      endsAt: new Date(scheduledAt.getTime() + 60 * 60_000), capacity: 1, isActive: true
    };
    prisma.companionProfile.findFirst.mockResolvedValue({
      id: "c1", name: "林屿", role: "温柔倾听者", initials: "LY", pricePerHalfHour: 39
    });
    prisma.companionAvailabilityWindow.findFirst.mockResolvedValue(window);
    prisma.order.findUnique.mockResolvedValue({
      id: "o-reserved", companionId: "c1", status: "paid", scheduledAt,
      durationMinutes: 30, companionConfirmedAt: new Date(), paymentReservationExpiresAt: new Date(Date.now() + 60_000)
    });
    const db = {
      ...prisma,
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: "o-reserved" }])
        .mockResolvedValueOnce([])
    };
    prisma.$transaction.mockImplementation(async (fn: any) => fn(db));

    await expect(service.create("u1", {
      companionId: "c1", availabilityWindowId: "window-1", themeId: "t1", durationMinutes: 30,
      scheduledAt: scheduledAt.toISOString()
    })).rejects.toMatchObject({ code: "COMPANION_SLOT_UNAVAILABLE", status: HttpStatus.CONFLICT });
    expect(prisma.order.create).not.toHaveBeenCalled();
  });

  it("rejects an unavailable service offering before it can create an order", async () => {
    prisma.companionProfile.findFirst.mockResolvedValue({
      id: "c1", name: "林屿", role: "温柔倾听者", initials: "LY", pricePerHalfHour: 39
    });
    prisma.companionServiceOffering.findFirst.mockResolvedValue(null);

    await expect(service.create("u1", {
      companionId: "c1", serviceOfferingId: "inactive-offer", themeId: "t1", durationMinutes: 30,
      scheduledAt: new Date(Date.now() + 3_600_000).toISOString()
    })).rejects.toMatchObject({ code: "SERVICE_OFFERING_UNAVAILABLE", status: HttpStatus.CONFLICT });
    expect(prisma.order.create).not.toHaveBeenCalled();
  });

  it("rejects a stale duration instead of trusting the client for a selected service offering", async () => {
    prisma.companionProfile.findFirst.mockResolvedValue({
      id: "c1", name: "林屿", role: "温柔倾听者", initials: "LY", pricePerHalfHour: 39
    });
    prisma.companionServiceOffering.findFirst.mockResolvedValue({
      id: "offer-voice", companionId: "c1", code: "voice-60", title: "60 分钟语音陪伴",
      description: null, deliveryMode: "voice", durationMinutes: 60, priceCents: 6900,
      currency: "CNY", topicIds: ["t1"], isActive: true
    });

    await expect(service.create("u1", {
      companionId: "c1", serviceOfferingId: "offer-voice", themeId: "t1", durationMinutes: 30,
      scheduledAt: new Date(Date.now() + 3_600_000).toISOString()
    })).rejects.toMatchObject({
      code: "SERVICE_OFFERING_DURATION_MISMATCH",
      status: HttpStatus.CONFLICT,
      details: { expectedDurationMinutes: 60 }
    });
    expect(prisma.order.create).not.toHaveBeenCalled();
  });

  it("returns the original order for a matching client retry without duplicating side effects", async () => {
    const scheduledAt = new Date(Date.now() + 3_600_000);
    prisma.order.findFirst.mockResolvedValue({
      id: "o-existing", userId: "u1", companionId: "c1", themeId: "t1", durationMinutes: 30,
      amountCents: 3900, currency: "CNY", status: "pending", scheduledAt,
      companionNameSnapshot: "林屿", companionRoleSnapshot: "倾听者", companionInitialsSnapshot: "LY",
      themeNameSnapshot: "轻松闲聊", conversationId: null, companionConfirmedAt: null,
      paymentReservationExpiresAt: null, paidAt: null, cancelledAt: null, completedAt: null,
      clientRequestId: "order_retry_1234567890", refunds: [], createdAt: new Date(), updatedAt: new Date()
    });

    const result = await service.create("u1", {
      companionId: "c1", themeId: "t1", durationMinutes: 30,
      scheduledAt: scheduledAt.toISOString(), clientRequestId: "order_retry_1234567890"
    });

    expect(result.id).toBe("o-existing");
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.order.create).not.toHaveBeenCalled();
  });

  it("returns an existing idempotent order even while new intake is paused", async () => {
    const scheduledAt = new Date(Date.now() + 3_600_000);
    const config = { get: jest.fn((key: string, fallback?: unknown) => key === "ORDER_INTAKE_ENABLED" ? false : fallback) } as any;
    service = new OrdersService(prisma, notifications, wechat, undefined, config);
    prisma.order.findFirst.mockResolvedValue({
      id: "o-existing", userId: "u1", companionId: "c1", themeId: "t1", durationMinutes: 30,
      amountCents: 3900, currency: "CNY", status: "pending", scheduledAt,
      companionNameSnapshot: "林屿", companionRoleSnapshot: "倾听者", companionInitialsSnapshot: "LY",
      themeNameSnapshot: "轻松闲聊", conversationId: null, refunds: [],
      clientRequestId: "order_retry_1234567890", createdAt: new Date(), updatedAt: new Date()
    });

    await expect(service.create("u1", {
      companionId: "c1", themeId: "t1", durationMinutes: 30,
      scheduledAt: scheduledAt.toISOString(), clientRequestId: "order_retry_1234567890"
    })).resolves.toMatchObject({ id: "o-existing" });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("requires a client idempotency key when commercial release mode is enabled", async () => {
    const config = {
      get: jest.fn((key: string, fallback?: unknown) => key === "COMMERCIAL_RELEASE_MODE" ? "commercial" : fallback)
    } as any;
    service = new OrdersService(prisma, notifications, wechat, undefined, config);

    await expect(service.create("u1", {
      companionId: "c1", themeId: "t1", durationMinutes: 30,
      scheduledAt: new Date(Date.now() + 3_600_000).toISOString()
    })).rejects.toMatchObject({
      code: "ORDER_CLIENT_REQUEST_ID_REQUIRED",
      status: HttpStatus.UNPROCESSABLE_ENTITY
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects reservations beyond the controlled booking horizon", async () => {
    const config = {
      get: jest.fn((key: string, fallback?: unknown) => key === "ORDER_MAX_SCHEDULE_DAYS" ? 14 : fallback)
    } as any;
    service = new OrdersService(prisma, notifications, wechat, undefined, config);

    await expect(service.create("u1", {
      companionId: "c1",
      themeId: "t1",
      durationMinutes: 30,
      scheduledAt: new Date(Date.now() + 15 * 24 * 60 * 60_000).toISOString()
    })).rejects.toMatchObject({
      code: "ORDER_SCHEDULE_TOO_FAR",
      status: HttpStatus.BAD_REQUEST,
      details: { maxScheduleDays: 14 }
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects reusing an order idempotency key with different business input", async () => {
    prisma.order.findFirst.mockResolvedValue({
      companionId: "c-other", themeId: "t1", durationMinutes: 30,
      scheduledAt: new Date(Date.now() + 3_600_000)
    });

    await expect(service.create("u1", {
      companionId: "c1", themeId: "t1", durationMinutes: 30,
      scheduledAt: new Date(Date.now() + 3_600_000).toISOString(),
      clientRequestId: "order_retry_1234567890"
    })).rejects.toMatchObject({ code: "ORDER_IDEMPOTENCY_KEY_REUSED" });
  });

  it("treats the selected service offering as idempotency business input", async () => {
    const scheduledAt = new Date(Date.now() + 3_600_000);
    prisma.order.findFirst.mockResolvedValue({
      companionId: "c1", serviceOfferingId: "offer-text", themeId: "t1", durationMinutes: 30, scheduledAt
    });

    await expect(service.create("u1", {
      companionId: "c1", serviceOfferingId: "offer-voice", themeId: "t1", durationMinutes: 30,
      scheduledAt: scheduledAt.toISOString(), clientRequestId: "order_retry_1234567890"
    })).rejects.toMatchObject({ code: "ORDER_IDEMPOTENCY_KEY_REUSED" });
  });

  it("treats the selected availability window as idempotency business input", async () => {
    const scheduledAt = new Date(Date.now() + 3_600_000);
    prisma.order.findFirst.mockResolvedValue({
      companionId: "c1", availabilityWindowId: "window-a", themeId: "t1", durationMinutes: 30, scheduledAt
    });

    await expect(service.create("u1", {
      companionId: "c1", availabilityWindowId: "window-b", themeId: "t1", durationMinutes: 30,
      scheduledAt: scheduledAt.toISOString(), clientRequestId: "order_retry_1234567890"
    })).rejects.toMatchObject({ code: "ORDER_IDEMPOTENCY_KEY_REUSED" });
  });

  it("enforces the controlled global open-order capacity under the intake lock", async () => {
    const config = {
      get: jest.fn((key: string, fallback?: unknown) => ({
        ORDER_INTAKE_ENABLED: true,
        ORDER_MAX_OPEN_TOTAL: 2,
        ORDER_MAX_OPEN_PER_USER: 3,
        ORDER_MAX_PENDING_PER_COMPANION: 20,
        ORDER_RESPONSE_WINDOW_MINUTES: 10,
        PLATFORM_FEE_BPS: 0
      } as Record<string, unknown>)[key] ?? fallback)
    } as any;
    service = new OrdersService(prisma, notifications, wechat, undefined, config);
    prisma.companionProfile.findFirst.mockResolvedValue({
      id: "c1", name: "林屿", role: "倾听者", initials: "LY", pricePerHalfHour: 39,
      commercialProfile: { status: "verified" }
    });
    prisma.order.count
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);

    await expect(service.create("u1", {
      companionId: "c1", themeId: "t1", durationMinutes: 30,
      scheduledAt: new Date(Date.now() + 3_600_000).toISOString()
    })).rejects.toMatchObject({ code: "ORDER_INTAKE_CAPACITY_REACHED" });
    expect(prisma.order.create).not.toHaveBeenCalled();
  });

  it("persists validated recommendation attribution without changing old order inputs", async () => {
    const recommendations = { validateOrderAttribution: jest.fn().mockResolvedValue("impression-1") } as any;
    service = new OrdersService(prisma, notifications, wechat, recommendations);
    prisma.companionProfile.findFirst.mockResolvedValue({
      id: "c1", name: "林屿", role: "温柔倾听者", initials: "LY", pricePerHalfHour: 39
    });
    prisma.order.create.mockResolvedValue({
      id: "o-attributed", userId: "u1", companionId: "c1", themeId: "t1", durationMinutes: 30,
      amountCents: 3900, currency: "CNY", status: "pending", conversationId: null,
      paidAt: null, cancelledAt: null, completedAt: null, createdAt: new Date(), updatedAt: new Date()
    });

    await service.create("u1", {
      companionId: "c1", themeId: "t1", durationMinutes: 30,
      scheduledAt: new Date(Date.now() + 3_600_000).toISOString(), recommendationImpressionId: "impression-1"
    });

    expect(recommendations.validateOrderAttribution).toHaveBeenCalledWith("u1", "impression-1", "c1");
    expect(prisma.order.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ recommendationImpressionId: "impression-1" })
    }));
  });

  it("rejects unpublished companion", async () => {
    prisma.companionProfile.findFirst.mockResolvedValue(null);

    await expect(
      service.create("u1", { companionId: "c9", themeId: "t1", durationMinutes: 30, scheduledAt: new Date(Date.now() + 3_600_000).toISOString() })
    ).rejects.toMatchObject({ code: "COMPANION_NOT_FOUND", status: HttpStatus.NOT_FOUND });
  });

  it("returns a participant-safe timeline with linked reschedule facts", async () => {
    prisma.order.findUnique.mockResolvedValue({
      id: "o1", userId: "u-customer", companion: { ownerUserId: "u-companion" }
    });
    prisma.orderTimelineEvent.findMany.mockResolvedValue([
      {
        id: "timeline-created", type: "orderCreated", actorId: "u-customer", actorRole: "customer",
        createdAt: new Date("2026-07-20T00:00:00.000Z"), rescheduleRequest: null
      },
      {
        id: "timeline-reschedule", type: "rescheduleRequested", actorId: "u-companion", actorRole: "companion",
        createdAt: new Date("2026-07-20T01:00:00.000Z"),
        rescheduleRequest: {
          id: "reschedule-1", requestedByUserId: "u-companion", requestedByRole: "companion",
          originalScheduledAt: new Date("2026-07-21T01:00:00.000Z"),
          requestedScheduledAt: new Date("2026-07-22T02:00:00.000Z"),
          requestedAvailabilityWindowId: "window-2",
          requestedAvailabilityWindowStartsAtSnapshot: new Date("2026-07-22T01:00:00.000Z"),
          requestedAvailabilityWindowEndsAtSnapshot: new Date("2026-07-22T03:00:00.000Z"),
          requestedAvailabilityWindowCapacitySnapshot: 2,
          status: "pending", expiresAt: new Date("2026-07-20T02:00:00.000Z"), respondedAt: null,
          respondedByUserId: null
        }
      }
    ]);

    await expect(service.timeline("u-companion", "o1")).resolves.toEqual({
      orderId: "o1",
      items: [
        {
          id: "timeline-created", type: "orderCreated", actorRole: "customer",
          occurredAt: "2026-07-20T00:00:00.000Z", rescheduleRequest: null
        },
        {
          id: "timeline-reschedule", type: "rescheduleRequested", actorRole: "companion",
          occurredAt: "2026-07-20T01:00:00.000Z",
          rescheduleRequest: {
            id: "reschedule-1", requestedByRole: "companion",
            originalScheduledAt: "2026-07-21T01:00:00.000Z",
            requestedScheduledAt: "2026-07-22T02:00:00.000Z",
            requestedAvailabilitySnapshot: {
              availabilityWindowId: "window-2",
              startsAt: "2026-07-22T01:00:00.000Z",
              endsAt: "2026-07-22T03:00:00.000Z",
              capacity: 2
            },
            status: "pending", expiresAt: "2026-07-20T02:00:00.000Z", respondedAt: null
          }
        }
      ]
    });
    expect(prisma.orderTimelineEvent.findMany).toHaveBeenCalledWith({
      where: { orderId: "o1" },
      include: { rescheduleRequest: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }]
    });
  });

  it("does not disclose an order timeline to a non-participant", async () => {
    prisma.order.findUnique.mockResolvedValue({
      id: "o1", userId: "u-customer", companion: { ownerUserId: "u-companion" }
    });

    await expect(service.timeline("u-outsider", "o1")).rejects.toMatchObject({
      code: "ORDER_NOT_FOUND", status: HttpStatus.NOT_FOUND
    });
    expect(prisma.orderTimelineEvent.findMany).not.toHaveBeenCalled();
  });

  it("allows the customer to read their own order timeline", async () => {
    prisma.order.findUnique.mockResolvedValue({
      id: "o1", userId: "u-customer", companion: { ownerUserId: "u-companion" }
    });
    prisma.orderTimelineEvent.findMany.mockResolvedValue([]);

    await expect(service.timeline("u-customer", "o1")).resolves.toEqual({ orderId: "o1", items: [] });
  });

  it("records a structured reschedule proposal without changing the original order", async () => {
    const requestedScheduledAt = new Date(
      Math.ceil((Date.now() + 3 * 24 * 60 * 60_000) / (30 * 60_000)) * (30 * 60_000)
    );
    const currentScheduledAt = new Date(requestedScheduledAt.getTime() + 24 * 60 * 60_000);
    const window = {
      id: "window-new", companionId: "c1",
      startsAt: new Date(requestedScheduledAt.getTime() - 30 * 60_000),
      endsAt: new Date(requestedScheduledAt.getTime() + 90 * 60_000),
      capacity: 2, isActive: true
    };
    const order = {
      id: "o-reschedule", userId: "u-customer", companionId: "c1", status: "paid",
      scheduledAt: currentScheduledAt, durationMinutes: 60, availabilityWindowId: "window-current",
      availabilityWindowStartsAtSnapshot: new Date(currentScheduledAt.getTime() - 30 * 60_000),
      availabilityWindowEndsAtSnapshot: new Date(currentScheduledAt.getTime() + 90 * 60_000),
      companionConfirmedAt: new Date(), companionResponseDeadlineAt: null,
      companion: { ownerUserId: "u-companion" }, refunds: []
    };
    prisma.order.findUnique.mockResolvedValue(order);
    prisma.companionAvailabilityWindow.findFirst.mockResolvedValue(window);
    prisma.orderRescheduleRequest.findFirst.mockResolvedValue(null);
    prisma.orderRescheduleRequest.create.mockImplementation(({ data }: any) => ({
      id: "reschedule-1", ...data, respondedAt: null, createdAt: new Date(), updatedAt: new Date()
    }));

    const result = await service.requestReschedule("u-customer", order.id, {
      requestedScheduledAt: requestedScheduledAt.toISOString(), availabilityWindowId: window.id
    });

    expect(result).toEqual(expect.objectContaining({
      id: "reschedule-1", requestedByRole: "customer", status: "pending",
      originalScheduledAt: currentScheduledAt.toISOString(),
      requestedScheduledAt: requestedScheduledAt.toISOString(),
      requestedAvailabilitySnapshot: {
        availabilityWindowId: window.id,
        startsAt: window.startsAt.toISOString(),
        endsAt: window.endsAt.toISOString(),
        capacity: 2
      }
    }));
    expect(prisma.orderRescheduleRequest.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        orderId: order.id,
        requestedByUserId: "u-customer",
        requestedByRole: "customer",
        originalScheduledAt: currentScheduledAt,
        requestedScheduledAt,
        requestedAvailabilityWindowId: window.id,
        requestedAvailabilityWindowCapacitySnapshot: 2,
        status: "pending"
      })
    }));
    expect(prisma.orderTimelineEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: "rescheduleRequested", actorRole: "customer", rescheduleRequestId: "reschedule-1" })
    }));
    expect(notifications.create).toHaveBeenCalledWith(
      "u-companion", "orderStatus", "有新的改期请求", expect.any(String), expect.objectContaining({ orderId: order.id })
    );
    expect(prisma.order.update).not.toHaveBeenCalled();
  });

  it("lets the companion propose a legacy appointment and notifies the customer", async () => {
    const now = Date.now();
    const order = {
      id: "o-legacy-reschedule", userId: "u-customer", companionId: "c1", status: "pending",
      scheduledAt: new Date(now + 3 * 24 * 60 * 60_000), durationMinutes: 30,
      availabilityWindowId: null, companionConfirmedAt: null,
      companionResponseDeadlineAt: new Date(now + 10 * 60_000),
      companion: { ownerUserId: "u-companion" }, refunds: []
    };
    prisma.order.findUnique.mockResolvedValue(order);
    prisma.orderRescheduleRequest.findFirst.mockResolvedValue(null);
    prisma.orderRescheduleRequest.create.mockImplementation(({ data }: any) => ({
      id: "reschedule-legacy", ...data, respondedAt: null, createdAt: new Date(), updatedAt: new Date()
    }));

    await service.requestReschedule("u-companion", order.id, {
      requestedScheduledAt: new Date(now + 4 * 24 * 60 * 60_000).toISOString()
    });

    expect(prisma.orderRescheduleRequest.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ requestedByRole: "companion", requestedAvailabilityWindowId: null })
    }));
    expect(notifications.create).toHaveBeenCalledWith(
      "u-customer", "orderStatus", "有新的改期请求", expect.any(String), expect.objectContaining({ orderId: order.id })
    );
  });

  it("rejects a second live reschedule proposal without changing the order", async () => {
    const order = {
      id: "o-pending-reschedule", userId: "u-customer", companionId: "c1", status: "paid",
      scheduledAt: new Date(Date.now() + 3 * 24 * 60 * 60_000), durationMinutes: 30,
      availabilityWindowId: null, companion: { ownerUserId: "u-companion" }, refunds: []
    };
    prisma.order.findUnique.mockResolvedValue(order);
    prisma.orderRescheduleRequest.findFirst.mockResolvedValue({
      id: "reschedule-existing", expiresAt: new Date(Date.now() + 60 * 60_000)
    });

    await expect(service.requestReschedule("u-customer", order.id, {
      requestedScheduledAt: new Date(Date.now() + 4 * 24 * 60 * 60_000).toISOString()
    })).rejects.toMatchObject({ code: "RESCHEDULE_REQUEST_PENDING", status: HttpStatus.CONFLICT });
    expect(prisma.orderRescheduleRequest.create).not.toHaveBeenCalled();
    expect(prisma.order.update).not.toHaveBeenCalled();
  });

  it("refuses to create a reschedule proposal while a refund is active", async () => {
    const order = {
      id: "o-refund-reschedule", userId: "u-customer", companionId: "c1", status: "paid",
      scheduledAt: new Date(Date.now() + 3 * 24 * 60 * 60_000), durationMinutes: 30,
      availabilityWindowId: null, companion: { ownerUserId: "u-companion" }, refunds: [{ id: "refund-1" }]
    };
    prisma.order.findUnique.mockResolvedValue(order);

    await expect(service.requestReschedule("u-customer", order.id, {
      requestedScheduledAt: new Date(Date.now() + 4 * 24 * 60 * 60_000).toISOString()
    })).rejects.toMatchObject({ code: "ORDER_REFUND_IN_PROGRESS", status: HttpStatus.CONFLICT });
    expect(prisma.orderRescheduleRequest.create).not.toHaveBeenCalled();
  });

  it("requires a new structured availability candidate for a structured order", async () => {
    const order = {
      id: "o-structured-required", userId: "u-customer", companionId: "c1", status: "paid",
      scheduledAt: new Date(Date.now() + 3 * 24 * 60 * 60_000), durationMinutes: 30,
      availabilityWindowId: "window-current", companion: { ownerUserId: "u-companion" }, refunds: []
    };
    prisma.order.findUnique.mockResolvedValue(order);

    await expect(service.requestReschedule("u-customer", order.id, {
      requestedScheduledAt: new Date(Date.now() + 4 * 24 * 60 * 60_000).toISOString()
    })).rejects.toMatchObject({ code: "RESCHEDULE_AVAILABILITY_REQUIRED", status: HttpStatus.UNPROCESSABLE_ENTITY });
    expect(prisma.orderRescheduleRequest.create).not.toHaveBeenCalled();
  });

  it("rejects a structured reschedule candidate whose live capacity is already full", async () => {
    const requestedScheduledAt = new Date(
      Math.ceil((Date.now() + 3 * 24 * 60 * 60_000) / (30 * 60_000)) * (30 * 60_000)
    );
    const order = {
      id: "o-full-reschedule", userId: "u-customer", companionId: "c1", status: "paid",
      scheduledAt: new Date(requestedScheduledAt.getTime() + 24 * 60 * 60_000), durationMinutes: 30,
      availabilityWindowId: "window-current", companion: { ownerUserId: "u-companion" }, refunds: []
    };
    const window = {
      id: "window-full", companionId: "c1",
      startsAt: new Date(requestedScheduledAt.getTime() - 30 * 60_000),
      endsAt: new Date(requestedScheduledAt.getTime() + 60 * 60_000), capacity: 1, isActive: true
    };
    const blockingOrder = {
      id: "o-blocking", companionId: "c1", status: "paid", scheduledAt: requestedScheduledAt,
      durationMinutes: 30, companionConfirmedAt: new Date(), paymentReservationExpiresAt: null
    };
    const db = {
      ...prisma,
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: blockingOrder.id }])
        .mockResolvedValueOnce([]),
      order: {
        ...prisma.order,
        findUnique: jest.fn()
          .mockResolvedValueOnce(order)
          .mockResolvedValueOnce(blockingOrder)
      },
      companionAvailabilityWindow: { findFirst: jest.fn().mockResolvedValue(window) }
    };
    prisma.$transaction.mockImplementation(async (fn: any) => fn(db));
    prisma.orderRescheduleRequest.findFirst.mockResolvedValue(null);

    await expect(service.requestReschedule("u-customer", order.id, {
      requestedScheduledAt: requestedScheduledAt.toISOString(), availabilityWindowId: window.id
    })).rejects.toMatchObject({ code: "COMPANION_SLOT_UNAVAILABLE", status: HttpStatus.CONFLICT });
    expect(prisma.orderRescheduleRequest.create).not.toHaveBeenCalled();
    expect(db.order.update).not.toHaveBeenCalled();
  });

  it("lets the other participant accept a structured proposal and atomically replace the appointment snapshot", async () => {
    const requestedScheduledAt = new Date(
      Math.ceil((Date.now() + 3 * 24 * 60 * 60_000) / (30 * 60_000)) * (30 * 60_000)
    );
    const originalScheduledAt = new Date(requestedScheduledAt.getTime() + 24 * 60 * 60_000);
    const window = {
      id: "window-accepted", companionId: "c1",
      startsAt: new Date(requestedScheduledAt.getTime() - 30 * 60_000),
      endsAt: new Date(requestedScheduledAt.getTime() + 90 * 60_000), capacity: 2, isActive: true
    };
    const order = {
      id: "o-accept-reschedule", userId: "u-customer", companionId: "c1", status: "paid",
      themeId: "t1", durationMinutes: 60, amountCents: 6900, currency: "CNY",
      scheduledAt: originalScheduledAt, availabilityWindowId: "window-original",
      availabilityWindowStartsAtSnapshot: new Date(originalScheduledAt.getTime() - 30 * 60_000),
      availabilityWindowEndsAtSnapshot: new Date(originalScheduledAt.getTime() + 90 * 60_000),
      availabilityWindowCapacitySnapshot: 2,
      companionNameSnapshot: "林屿", companionRoleSnapshot: "温柔倾听者", companionInitialsSnapshot: "LY",
      themeNameSnapshot: "情绪倾听", conversationId: null, companionConfirmedAt: new Date(),
      companionResponseDeadlineAt: null, paymentReservationExpiresAt: null, serviceStartedAt: null,
      paidAt: new Date(), cancelledAt: null, completedAt: null, customerConfirmedAt: null,
      refundRequestDeadlineAt: null, createdAt: new Date(), updatedAt: new Date(),
      companion: { ownerUserId: "u-companion" }, refunds: []
    };
    const request = {
      id: "reschedule-accept", orderId: order.id, requestedByUserId: "u-customer", requestedByRole: "customer",
      originalScheduledAt, requestedScheduledAt, requestedAvailabilityWindowId: window.id,
      requestedAvailabilityWindowStartsAtSnapshot: window.startsAt,
      requestedAvailabilityWindowEndsAtSnapshot: window.endsAt,
      requestedAvailabilityWindowCapacitySnapshot: 2, status: "pending",
      expiresAt: new Date(Date.now() + 60 * 60_000), respondedAt: null, respondedByUserId: null
    };
    const accepted = { ...request, status: "accepted", respondedAt: new Date(), respondedByUserId: "u-companion" };
    const updatedOrder = {
      ...order,
      scheduledAt: requestedScheduledAt,
      availabilityWindowId: window.id,
      availabilityWindowStartsAtSnapshot: window.startsAt,
      availabilityWindowEndsAtSnapshot: window.endsAt,
      availabilityWindowCapacitySnapshot: window.capacity,
      updatedAt: new Date()
    };
    prisma.order.findUnique.mockResolvedValue(order);
    prisma.orderRescheduleRequest.findUnique.mockResolvedValue(request);
    prisma.companionAvailabilityWindow.findFirst.mockResolvedValue(window);
    prisma.order.update.mockResolvedValue(updatedOrder);
    prisma.orderRescheduleRequest.update.mockResolvedValue(accepted);

    const result = await service.acceptReschedule("u-companion", order.id, request.id);

    expect(result.rescheduleRequest).toEqual(expect.objectContaining({
      id: request.id, status: "accepted", respondedAt: accepted.respondedAt.toISOString()
    }));
    expect(result.order.scheduledAt).toBe(requestedScheduledAt.toISOString());
    expect(result.order.availabilitySnapshot).toEqual({
      availabilityWindowId: window.id,
      startsAt: window.startsAt.toISOString(),
      endsAt: window.endsAt.toISOString(),
      capacity: window.capacity
    });
    const orderUpdate = prisma.order.update.mock.calls.at(-1)[0];
    expect(orderUpdate.data).toEqual(expect.objectContaining({
      scheduledAt: requestedScheduledAt,
      availabilityWindowId: window.id,
      availabilityWindowStartsAtSnapshot: window.startsAt,
      availabilityWindowEndsAtSnapshot: window.endsAt,
      availabilityWindowCapacitySnapshot: window.capacity
    }));
    expect(Object.hasOwn(orderUpdate.data, "status")).toBe(false);
    expect(prisma.orderRescheduleRequest.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: request.id },
      data: expect.objectContaining({ status: "accepted", respondedByUserId: "u-companion" })
    }));
    expect(prisma.orderTimelineEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: "rescheduleAccepted", actorRole: "companion", rescheduleRequestId: request.id })
    }));
    expect(notifications.create).toHaveBeenCalledWith(
      "u-customer", "orderStatus", "改期请求已接受", expect.any(String), expect.objectContaining({ scheduledAt: requestedScheduledAt.toISOString() })
    );
  });

  it("does not let the requester accept their own reschedule proposal", async () => {
    const order = {
      id: "o-self-accept", userId: "u-customer", companionId: "c1", status: "paid",
      scheduledAt: new Date(Date.now() + 3 * 24 * 60 * 60_000),
      companion: { ownerUserId: "u-companion" }, refunds: []
    };
    const request = {
      id: "reschedule-self", orderId: order.id, requestedByUserId: "u-customer", status: "pending"
    };
    prisma.order.findUnique.mockResolvedValue(order);
    prisma.orderRescheduleRequest.findUnique.mockResolvedValue(request);

    await expect(service.acceptReschedule("u-customer", order.id, request.id)).rejects.toMatchObject({
      code: "RESCHEDULE_REQUEST_SELF_RESPONSE_FORBIDDEN", status: HttpStatus.FORBIDDEN
    });
    expect(prisma.order.update).not.toHaveBeenCalled();
  });

  it("expires a stale proposal instead of accepting it", async () => {
    const originalScheduledAt = new Date(Date.now() + 3 * 24 * 60 * 60_000);
    const order = {
      id: "o-expire-accept", userId: "u-customer", companionId: "c1", status: "paid",
      scheduledAt: originalScheduledAt, companion: { ownerUserId: "u-companion" }, refunds: []
    };
    const request = {
      id: "reschedule-expired", orderId: order.id, requestedByUserId: "u-customer", status: "pending",
      originalScheduledAt, requestedScheduledAt: new Date(originalScheduledAt.getTime() + 24 * 60 * 60_000),
      expiresAt: new Date(Date.now() - 1_000)
    };
    prisma.order.findUnique.mockResolvedValue(order);
    prisma.orderRescheduleRequest.findUnique.mockResolvedValue(request);
    prisma.orderRescheduleRequest.update.mockResolvedValue({ ...request, status: "expired", respondedAt: new Date() });

    await expect(service.acceptReschedule("u-companion", order.id, request.id)).rejects.toMatchObject({
      code: "RESCHEDULE_REQUEST_EXPIRED", status: HttpStatus.CONFLICT
    });
    expect(prisma.orderRescheduleRequest.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "expired" })
    }));
    expect(prisma.orderTimelineEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: "rescheduleExpired", actorRole: "system" })
    }));
    expect(prisma.order.update).not.toHaveBeenCalled();
  });

  it("rechecks live capacity when accepting a proposal", async () => {
    const requestedScheduledAt = new Date(
      Math.ceil((Date.now() + 3 * 24 * 60 * 60_000) / (30 * 60_000)) * (30 * 60_000)
    );
    const order = {
      id: "o-accept-full", userId: "u-customer", companionId: "c1", status: "paid",
      scheduledAt: new Date(requestedScheduledAt.getTime() + 24 * 60 * 60_000), durationMinutes: 30,
      availabilityWindowId: "window-original", companion: { ownerUserId: "u-companion" }, refunds: []
    };
    const window = {
      id: "window-accept-full", companionId: "c1",
      startsAt: new Date(requestedScheduledAt.getTime() - 30 * 60_000),
      endsAt: new Date(requestedScheduledAt.getTime() + 60 * 60_000), capacity: 1, isActive: true
    };
    const request = {
      id: "reschedule-accept-full", orderId: order.id, requestedByUserId: "u-customer", requestedByRole: "customer",
      originalScheduledAt: order.scheduledAt, requestedScheduledAt, requestedAvailabilityWindowId: window.id,
      status: "pending", expiresAt: new Date(Date.now() + 60 * 60_000)
    };
    const blockingOrder = {
      id: "o-accept-blocking", companionId: "c1", status: "paid", scheduledAt: requestedScheduledAt,
      durationMinutes: 30, companionConfirmedAt: new Date(), paymentReservationExpiresAt: null
    };
    const db = {
      ...prisma,
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: blockingOrder.id }])
        .mockResolvedValueOnce([]),
      order: {
        ...prisma.order,
        findUnique: jest.fn()
          .mockResolvedValueOnce(order)
          .mockResolvedValueOnce(blockingOrder)
      },
      orderRescheduleRequest: {
        ...prisma.orderRescheduleRequest,
        findUnique: jest.fn().mockResolvedValue(request)
      },
      companionAvailabilityWindow: { findFirst: jest.fn().mockResolvedValue(window) }
    };
    prisma.$transaction.mockImplementation(async (fn: any) => fn(db));

    await expect(service.acceptReschedule("u-companion", order.id, request.id)).rejects.toMatchObject({
      code: "COMPANION_SLOT_UNAVAILABLE", status: HttpStatus.CONFLICT
    });
    expect(db.order.update).not.toHaveBeenCalled();
    expect(db.orderRescheduleRequest.update).not.toHaveBeenCalled();
  });

  it("lets the other participant reject a proposal without changing the appointment", async () => {
    const originalScheduledAt = new Date(Date.now() + 3 * 24 * 60 * 60_000);
    const requestedScheduledAt = new Date(originalScheduledAt.getTime() + 24 * 60 * 60_000);
    const order = {
      id: "o-reject-reschedule", userId: "u-customer", companionId: "c1", status: "paid",
      scheduledAt: originalScheduledAt, companion: { ownerUserId: "u-companion" }
    };
    const request = {
      id: "reschedule-reject", orderId: order.id, requestedByUserId: "u-customer", requestedByRole: "customer",
      originalScheduledAt, requestedScheduledAt, requestedAvailabilityWindowId: null,
      requestedAvailabilityWindowStartsAtSnapshot: null, requestedAvailabilityWindowEndsAtSnapshot: null,
      requestedAvailabilityWindowCapacitySnapshot: null, status: "pending",
      expiresAt: new Date(Date.now() + 60 * 60_000), respondedAt: null, respondedByUserId: null
    };
    const rejected = { ...request, status: "rejected", respondedAt: new Date(), respondedByUserId: "u-companion" };
    const audit = { record: jest.fn().mockResolvedValue(undefined) } as any;
    const auditedService = new OrdersService(prisma, notifications, wechat, undefined, undefined, audit);
    prisma.order.findUnique.mockResolvedValue(order);
    prisma.orderRescheduleRequest.findUnique.mockResolvedValue(request);
    prisma.orderRescheduleRequest.update.mockResolvedValue(rejected);

    const result = await auditedService.rejectReschedule("u-companion", order.id, request.id);

    expect(result).toEqual(expect.objectContaining({
      id: request.id, status: "rejected", originalScheduledAt: originalScheduledAt.toISOString(),
      respondedAt: rejected.respondedAt.toISOString()
    }));
    expect(prisma.orderRescheduleRequest.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: request.id },
      data: expect.objectContaining({ status: "rejected", respondedByUserId: "u-companion" })
    }));
    expect(prisma.orderTimelineEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: "rescheduleRejected", actorRole: "companion", rescheduleRequestId: request.id })
    }));
    expect(notifications.create).toHaveBeenCalledWith(
      "u-customer", "orderStatus", "改期请求已被拒绝", expect.any(String),
      expect.objectContaining({ orderId: order.id, status: "rejected", scheduledAt: originalScheduledAt.toISOString() })
    );
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "order.reschedule_rejected", resourceId: request.id
    }), expect.anything());
    expect(prisma.order.update).not.toHaveBeenCalled();
  });

  it("does not let the requester reject their own reschedule proposal", async () => {
    const order = {
      id: "o-self-reject", userId: "u-customer", companionId: "c1", status: "paid",
      scheduledAt: new Date(Date.now() + 3 * 24 * 60 * 60_000), companion: { ownerUserId: "u-companion" }
    };
    const request = {
      id: "reschedule-self-reject", orderId: order.id, requestedByUserId: "u-customer", status: "pending"
    };
    prisma.order.findUnique.mockResolvedValue(order);
    prisma.orderRescheduleRequest.findUnique.mockResolvedValue(request);

    await expect(service.rejectReschedule("u-customer", order.id, request.id)).rejects.toMatchObject({
      code: "RESCHEDULE_REQUEST_SELF_RESPONSE_FORBIDDEN", status: HttpStatus.FORBIDDEN
    });
    expect(prisma.orderRescheduleRequest.update).not.toHaveBeenCalled();
    expect(prisma.order.update).not.toHaveBeenCalled();
  });

  it("expires a stale proposal instead of rejecting it", async () => {
    const originalScheduledAt = new Date(Date.now() + 3 * 24 * 60 * 60_000);
    const order = {
      id: "o-expire-reject", userId: "u-customer", companionId: "c1", status: "paid",
      scheduledAt: originalScheduledAt, companion: { ownerUserId: "u-companion" }
    };
    const request = {
      id: "reschedule-expired-reject", orderId: order.id, requestedByUserId: "u-customer", status: "pending",
      originalScheduledAt, requestedScheduledAt: new Date(originalScheduledAt.getTime() + 24 * 60 * 60_000),
      expiresAt: new Date(Date.now() - 1_000)
    };
    prisma.order.findUnique.mockResolvedValue(order);
    prisma.orderRescheduleRequest.findUnique.mockResolvedValue(request);
    prisma.orderRescheduleRequest.update.mockResolvedValue({ ...request, status: "expired", respondedAt: new Date() });

    await expect(service.rejectReschedule("u-companion", order.id, request.id)).rejects.toMatchObject({
      code: "RESCHEDULE_REQUEST_EXPIRED", status: HttpStatus.CONFLICT
    });
    expect(prisma.orderRescheduleRequest.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "expired" })
    }));
    expect(prisma.orderTimelineEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: "rescheduleExpired", actorRole: "system" })
    }));
    expect(notifications.create).not.toHaveBeenCalled();
    expect(prisma.order.update).not.toHaveBeenCalled();
  });

  it("does not allow a participant to reject a request belonging to another order", async () => {
    const order = {
      id: "o-reject-owned", userId: "u-customer", companionId: "c1", status: "paid",
      scheduledAt: new Date(Date.now() + 3 * 24 * 60 * 60_000), companion: { ownerUserId: "u-companion" }
    };
    prisma.order.findUnique.mockResolvedValue(order);
    prisma.orderRescheduleRequest.findUnique.mockResolvedValue({
      id: "reschedule-other-order", orderId: "o-other", requestedByUserId: "u-customer", status: "pending"
    });

    await expect(service.rejectReschedule("u-companion", order.id, "reschedule-other-order")).rejects.toMatchObject({
      code: "RESCHEDULE_REQUEST_NOT_FOUND", status: HttpStatus.NOT_FOUND
    });
    expect(prisma.orderRescheduleRequest.update).not.toHaveBeenCalled();
    expect(prisma.order.update).not.toHaveBeenCalled();
  });

  it("rejects starting a paid service before the 15-minute window", async () => {
    prisma.order.findUnique.mockResolvedValue({
      id: "o-future",
      userId: "u-customer",
      companionId: "c1",
      durationMinutes: 30,
      status: "paid",
      scheduledAt: new Date(Date.now() + 60 * 60 * 1000),
      companion: { ownerUserId: "u-companion" },
      conversation: null
    });

    await expect(service.startService("u-companion", "o-future")).rejects.toMatchObject({
      code: "ORDER_SERVICE_NOT_READY",
      status: HttpStatus.CONFLICT
    });
    expect(prisma.order.update).not.toHaveBeenCalled();
  });

  it("starts the service and cancels a pending reschedule request in the same transaction", async () => {
    const scheduledAt = new Date(Date.now() - 5 * 60_000);
    const order = {
      id: "o-start-reschedule", userId: "u-customer", companionId: "c1", themeId: "t1", durationMinutes: 30,
      amountCents: 3900, currency: "CNY", status: "paid", scheduledAt, conversationId: null,
      companionConfirmedAt: new Date(), paymentReservationExpiresAt: null, paidAt: new Date(), cancelledAt: null,
      completedAt: null, createdAt: new Date(), updatedAt: new Date(),
      companion: { ownerUserId: "u-companion" }, conversation: null
    };
    const updated = { ...order, status: "inService", serviceStartedAt: new Date() };
    const request = {
      id: "reschedule-start-service", orderId: order.id, requestedByUserId: "u-customer", requestedByRole: "customer",
      originalScheduledAt: scheduledAt, requestedScheduledAt: new Date(scheduledAt.getTime() + 24 * 60 * 60_000),
      status: "pending", expiresAt: new Date(Date.now() + 60 * 60_000), respondedAt: null, respondedByUserId: null
    };
    const resolved = { ...request, status: "cancelled", respondedAt: new Date(), respondedByUserId: "u-companion" };
    const transactionalNotifications = { createTransactional: jest.fn().mockResolvedValue({}) } as any;
    const audit = { record: jest.fn().mockResolvedValue(undefined) } as any;
    const lifecycleService = new OrdersService(prisma, transactionalNotifications, wechat, undefined, undefined, audit);
    const db = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      order: { findUnique: jest.fn().mockResolvedValue(order), update: jest.fn().mockResolvedValue(updated) },
      refundTransaction: { findFirst: jest.fn().mockResolvedValue(null) },
      orderRescheduleRequest: {
        findFirst: jest.fn().mockResolvedValue(request),
        findUnique: jest.fn().mockResolvedValue(request),
        update: jest.fn().mockResolvedValue(resolved)
      },
      orderTimelineEvent: { create: jest.fn().mockResolvedValue({}) }
    };
    prisma.$transaction.mockImplementation(async (fn: any) => fn(db));

    await expect(lifecycleService.startService("u-companion", order.id)).resolves.toMatchObject({ status: "inService" });

    expect(db.order.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "inService", serviceStartedAt: expect.any(Date) })
    }));
    expect(db.orderRescheduleRequest.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: request.id },
      data: expect.objectContaining({ status: "cancelled", respondedByUserId: "u-companion" })
    }));
    expect(db.orderTimelineEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: "rescheduleCancelled", actorRole: "companion", rescheduleRequestId: request.id })
    }));
    expect(transactionalNotifications.createTransactional).toHaveBeenCalledWith(db, expect.objectContaining({
      userId: "u-customer", templateKey: "rescheduleCancelled",
      body: "服务已开始，原改期协商已自动关闭。",
      data: expect.objectContaining({ reason: "service_started" })
    }));
    expect(transactionalNotifications.createTransactional).toHaveBeenCalledWith(db, expect.objectContaining({
      userId: "u-companion", templateKey: "rescheduleCancelled"
    }));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "order.reschedule_cancelled", resourceId: request.id,
      metadata: expect.objectContaining({ reason: "service_started" })
    }), db);
  });

  it("rejects cancellation after an order has been paid", async () => {
    const paidOrder = {
      id: "o1",
      userId: "u1",
      companionId: "c1",
      themeId: "t1",
      durationMinutes: 30,
      amountCents: 3900,
      currency: "CNY",
      status: "paid",
      conversationId: null,
      paidAt: new Date(),
      cancelledAt: null,
      completedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      conversation: null
    };
    prisma.$transaction.mockImplementation(async (fn: any) => fn({
      $queryRaw: jest.fn().mockResolvedValue([]),
      order: { findUnique: jest.fn().mockResolvedValue(paidOrder) },
      paymentTransaction: { findFirst: jest.fn() }
    }));

    await expect(service.cancel("u1", "o1")).rejects.toBeInstanceOf(AppException);
    await expect(service.cancel("u1", "o1")).rejects.toMatchObject({
      code: "ORDER_INVALID_STATE"
    });
  });

  it("cancels a pending order only when no active payment exists", async () => {
    const pendingOrder = {
      id: "o1",
      userId: "u1",
      companionId: "c1",
      themeId: "t1",
      durationMinutes: 30,
      amountCents: 3900,
      currency: "CNY",
      status: "pending",
      conversationId: null,
      paidAt: null,
      cancelledAt: null,
      completedAt: null,
      createdAt: new Date("2026-07-09T00:00:00.000Z"),
      updatedAt: new Date("2026-07-09T00:00:00.000Z"),
      conversation: null
    };

    const updated = {
      id: "o1",
      userId: "u1",
      companionId: "c1",
      themeId: "t1",
      durationMinutes: 30,
      amountCents: 3900,
      currency: "CNY",
      status: "cancelled",
      conversationId: null,
      paidAt: null,
      cancelledAt: new Date("2026-07-09T01:00:00.000Z"),
      completedAt: null,
      createdAt: new Date("2026-07-09T00:00:00.000Z"),
      updatedAt: new Date("2026-07-09T01:00:00.000Z"),
      conversation: null
    };

    prisma.$transaction.mockImplementation(async (fn: any) =>
      fn({
        $queryRaw: jest.fn().mockResolvedValue([]),
        paymentTransaction: { findFirst: jest.fn().mockResolvedValue(null) },
        order: {
          findUnique: jest.fn().mockResolvedValue(pendingOrder),
          update: jest.fn().mockResolvedValue(updated)
        },
        orderRescheduleRequest: { findFirst: jest.fn().mockResolvedValue(null) }
      })
    );

    const result = await service.cancel("u1", "o1");
    expect(result.status).toBe("cancelled");
  });

  it("cancels the pending reschedule request atomically when the customer cancels an order", async () => {
    const scheduledAt = new Date(Date.now() + 3 * 24 * 60 * 60_000);
    const order = {
      id: "o-cancel-reschedule", userId: "u-customer", companionId: "c1", themeId: "t1", durationMinutes: 30,
      amountCents: 3900, currency: "CNY", status: "pending", scheduledAt, conversationId: null,
      companionConfirmedAt: null, paymentReservationExpiresAt: null, companionResponseDeadlineAt: new Date(Date.now() + 60_000),
      paidAt: null, cancelledAt: null, completedAt: null, createdAt: new Date(), updatedAt: new Date(),
      companion: { ownerUserId: "u-companion" }, conversation: null
    };
    const updated = { ...order, status: "cancelled", cancelledAt: new Date(), companionResponseDeadlineAt: null };
    const request = {
      id: "reschedule-cancel-order", orderId: order.id, requestedByUserId: "u-customer", requestedByRole: "customer",
      originalScheduledAt: scheduledAt, requestedScheduledAt: new Date(scheduledAt.getTime() + 24 * 60 * 60_000),
      status: "pending", expiresAt: new Date(Date.now() + 60 * 60_000), respondedAt: null, respondedByUserId: null
    };
    const resolved = { ...request, status: "cancelled", respondedAt: new Date(), respondedByUserId: "u-customer" };
    const transactionalNotifications = { createTransactional: jest.fn().mockResolvedValue({}) } as any;
    const audit = { record: jest.fn().mockResolvedValue(undefined) } as any;
    const lifecycleService = new OrdersService(prisma, transactionalNotifications, wechat, undefined, undefined, audit);
    const db = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      paymentTransaction: { findFirst: jest.fn().mockResolvedValue(null) },
      order: { findUnique: jest.fn().mockResolvedValue(order), update: jest.fn().mockResolvedValue(updated) },
      orderRescheduleRequest: {
        findFirst: jest.fn().mockResolvedValue(request),
        findUnique: jest.fn().mockResolvedValue(request),
        update: jest.fn().mockResolvedValue(resolved)
      },
      orderTimelineEvent: { create: jest.fn().mockResolvedValue({}) }
    };
    prisma.$transaction.mockImplementation(async (fn: any) => fn(db));

    await expect(lifecycleService.cancel("u-customer", order.id)).resolves.toMatchObject({ status: "cancelled" });

    expect(db.order.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "cancelled" })
    }));
    expect(db.orderRescheduleRequest.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: request.id },
      data: expect.objectContaining({ status: "cancelled", respondedByUserId: "u-customer" })
    }));
    expect(db.orderTimelineEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: "rescheduleCancelled", actorRole: "customer", rescheduleRequestId: request.id })
    }));
    expect(transactionalNotifications.createTransactional).toHaveBeenCalledWith(db, expect.objectContaining({
      userId: "u-customer", templateKey: "rescheduleCancelled",
      eventKey: `order:${order.id}:reschedule:${request.id}:cancelled:u-customer`
    }));
    expect(transactionalNotifications.createTransactional).toHaveBeenCalledWith(db, expect.objectContaining({
      userId: "u-companion", templateKey: "rescheduleCancelled",
      eventKey: `order:${order.id}:reschedule:${request.id}:cancelled:u-companion`
    }));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "order.reschedule_cancelled", resourceId: request.id,
      metadata: expect.objectContaining({ reason: "order_cancelled" })
    }), db);
  });

  it("cancels the pending reschedule request atomically when the companion rejects an order", async () => {
    const scheduledAt = new Date(Date.now() + 3 * 24 * 60 * 60_000);
    const order = {
      id: "o-reject-reschedule", userId: "u-customer", companionId: "c1", themeId: "t1", durationMinutes: 30,
      amountCents: 3900, currency: "CNY", status: "pending", scheduledAt, conversationId: null,
      companionConfirmedAt: null, paymentReservationExpiresAt: null, companionResponseDeadlineAt: new Date(Date.now() + 60_000),
      paidAt: null, cancelledAt: null, completedAt: null, createdAt: new Date(), updatedAt: new Date(),
      companion: { ownerUserId: "u-companion" }, conversation: null
    };
    const updated = { ...order, status: "cancelled", cancelledAt: new Date(), companionResponseDeadlineAt: null };
    const request = {
      id: "reschedule-reject-order", orderId: order.id, requestedByUserId: "u-customer", requestedByRole: "customer",
      originalScheduledAt: scheduledAt, requestedScheduledAt: new Date(scheduledAt.getTime() + 24 * 60 * 60_000),
      status: "pending", expiresAt: new Date(Date.now() + 60 * 60_000), respondedAt: null, respondedByUserId: null
    };
    const resolved = { ...request, status: "cancelled", respondedAt: new Date(), respondedByUserId: "u-companion" };
    const transactionalNotifications = { createTransactional: jest.fn().mockResolvedValue({}) } as any;
    const audit = { record: jest.fn().mockResolvedValue(undefined) } as any;
    const lifecycleService = new OrdersService(prisma, transactionalNotifications, wechat, undefined, undefined, audit);
    const db = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      paymentTransaction: { findFirst: jest.fn().mockResolvedValue(null) },
      order: { findUnique: jest.fn().mockResolvedValue(order), update: jest.fn().mockResolvedValue(updated) },
      orderRescheduleRequest: {
        findFirst: jest.fn().mockResolvedValue(request),
        findUnique: jest.fn().mockResolvedValue(request),
        update: jest.fn().mockResolvedValue(resolved)
      },
      orderTimelineEvent: { create: jest.fn().mockResolvedValue({}) }
    };
    prisma.$transaction.mockImplementation(async (fn: any) => fn(db));

    await expect(lifecycleService.rejectOrder("u-companion", order.id)).resolves.toMatchObject({ status: "cancelled" });

    expect(db.orderRescheduleRequest.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: request.id },
      data: expect.objectContaining({ status: "cancelled", respondedByUserId: "u-companion" })
    }));
    expect(db.orderTimelineEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: "rescheduleCancelled", actorRole: "companion", rescheduleRequestId: request.id })
    }));
    expect(transactionalNotifications.createTransactional).toHaveBeenCalledWith(db, expect.objectContaining({
      userId: "u-customer", templateKey: "rescheduleCancelled",
      eventKey: `order:${order.id}:reschedule:${request.id}:cancelled:u-customer`
    }));
    expect(transactionalNotifications.createTransactional).toHaveBeenCalledWith(db, expect.objectContaining({
      userId: "u-companion", templateKey: "rescheduleCancelled",
      eventKey: `order:${order.id}:reschedule:${request.id}:cancelled:u-companion`
    }));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "order.reschedule_cancelled", resourceId: request.id,
      metadata: expect.objectContaining({ reason: "order_rejected" })
    }), db);
  });

  it("does not let either participant respond to a lifecycle-cancelled reschedule request", async () => {
    const order = {
      id: "o-lifecycle-cancelled", userId: "u-customer", companionId: "c1", status: "pending",
      scheduledAt: new Date(Date.now() + 3 * 24 * 60 * 60_000), companion: { ownerUserId: "u-companion" }, refunds: []
    };
    const request = {
      id: "reschedule-lifecycle-cancelled", orderId: order.id, requestedByUserId: "u-customer", status: "cancelled"
    };
    prisma.order.findUnique.mockResolvedValue(order);
    prisma.orderRescheduleRequest.findUnique.mockResolvedValue(request);

    await expect(service.acceptReschedule("u-companion", order.id, request.id)).rejects.toMatchObject({
      code: "RESCHEDULE_REQUEST_INVALID_STATE", status: HttpStatus.CONFLICT
    });
    await expect(service.rejectReschedule("u-companion", order.id, request.id)).rejects.toMatchObject({
      code: "RESCHEDULE_REQUEST_INVALID_STATE", status: HttpStatus.CONFLICT
    });
    expect(prisma.orderRescheduleRequest.update).not.toHaveBeenCalled();
    expect(prisma.order.update).not.toHaveBeenCalled();
  });

  it("records a system cancellation and bilateral outbox notices when a refund starts", async () => {
    const scheduledAt = new Date(Date.now() + 3 * 24 * 60 * 60_000);
    const order = {
      id: "o-refund-reschedule", userId: "u-customer", companionId: "c1", scheduledAt,
      companion: { ownerUserId: "u-companion" }
    };
    const request = {
      id: "reschedule-refund", orderId: order.id, requestedByRole: "customer",
      originalScheduledAt: scheduledAt, requestedScheduledAt: new Date(scheduledAt.getTime() + 24 * 60 * 60_000),
      status: "pending", expiresAt: new Date(Date.now() + 60 * 60_000)
    };
    const resolved = { ...request, status: "cancelled", respondedAt: new Date(), respondedByUserId: null };
    const transactionalNotifications = { createTransactional: jest.fn().mockResolvedValue({}) } as any;
    const audit = { record: jest.fn().mockResolvedValue(undefined) } as any;
    const lifecycleService = new OrdersService(prisma, transactionalNotifications, wechat, undefined, undefined, audit);
    const db = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      orderRescheduleRequest: {
        findFirst: jest.fn().mockResolvedValue(request),
        findUnique: jest.fn().mockResolvedValue(request),
        update: jest.fn().mockResolvedValue(resolved)
      },
      orderTimelineEvent: { create: jest.fn().mockResolvedValue({}) }
    };

    await lifecycleService.cancelPendingRescheduleRequest(db, {
      order,
      actorId: null,
      actorRole: "system",
      reason: "refund_requested"
    });

    expect(db.orderRescheduleRequest.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "cancelled", respondedByUserId: null })
    }));
    expect(db.orderTimelineEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: "rescheduleCancelled", actorId: null, actorRole: "system" })
    }));
    expect(transactionalNotifications.createTransactional).toHaveBeenCalledWith(db, expect.objectContaining({
      userId: "u-customer", templateKey: "rescheduleCancelled",
      body: "退款申请已发起，原改期协商已自动关闭。",
      data: expect.objectContaining({ reason: "refund_requested" })
    }));
    expect(transactionalNotifications.createTransactional).toHaveBeenCalledWith(db, expect.objectContaining({
      userId: "u-companion", templateKey: "rescheduleCancelled"
    }));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      actorId: null, action: "order.reschedule_cancelled",
      metadata: expect.objectContaining({ reason: "refund_requested", actorRole: "system" })
    }), db);
  });

  it("refuses to cancel when an initiated payment exists", async () => {
    const pendingOrder = {
      id: "o1",
      userId: "u1",
      status: "pending",
      conversation: null
    };
    prisma.$transaction.mockImplementation(async (fn: any) => fn({
      $queryRaw: jest.fn().mockResolvedValue([]),
      order: { findUnique: jest.fn().mockResolvedValue(pendingOrder), update: jest.fn() },
      paymentTransaction: { findFirst: jest.fn().mockResolvedValue({
        id: "p1",
        outTradeNo: "T1",
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000)
      }) }
    }));

    await expect(service.cancel("u1", "o1")).rejects.toMatchObject({
      code: "ORDER_PAYMENT_IN_PROGRESS",
      status: HttpStatus.CONFLICT
    });
  });

  it("closes an expired WeChat prepay before cancelling the order", async () => {
    const payingOrder = {
      id: "o1",
      userId: "u1",
      companionId: "c1",
      themeId: "t1",
      durationMinutes: 30,
      amountCents: 3900,
      currency: "CNY",
      status: "paying",
      conversationId: null,
      paidAt: null,
      cancelledAt: null,
      completedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      conversation: null
    };
    const cancelledOrder = { ...payingOrder, status: "cancelled", cancelledAt: new Date() };
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    prisma.$transaction.mockImplementation(async (fn: any) => fn({
      $queryRaw: jest.fn().mockResolvedValue([]),
      order: {
        findUnique: jest.fn().mockResolvedValue(payingOrder),
        update: jest.fn().mockResolvedValue(cancelledOrder)
      },
      paymentTransaction: {
        findFirst: jest.fn().mockResolvedValue({
          id: "p1",
          outTradeNo: "T-expired",
          createdAt: new Date(Date.now() - 120_000),
          expiresAt: new Date(Date.now() - 1)
        }),
        updateMany
      },
      orderRescheduleRequest: { findFirst: jest.fn().mockResolvedValue(null) }
    }));

    const result = await service.cancel("u1", "o1");

    expect(wechat.closePayment).toHaveBeenCalledWith("T-expired");
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "p1", status: "initiated" },
      data: { status: "closed" }
    }));
    expect(result.status).toBe("cancelled");
  });

  it("atomically refuses an overlapping active companion reservation during confirmation", async () => {
    const scheduledAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const order = {
      id: "o-target",
      userId: "u-customer",
      companionId: "c1",
      status: "pending",
      scheduledAt,
      durationMinutes: 60,
      companionConfirmedAt: null,
      paymentReservationExpiresAt: null,
      companion: {
        ownerUserId: "u-companion",
        availability: "online",
        availableTimes: ["全天"],
        owner: { accountStatus: "active", profile: { isVerified: true } },
        commercialProfile: { status: "verified" }
      },
      conversation: null
    };
    const reserved = {
      id: "o-reserved",
      companionId: "c1",
      status: "pending",
      scheduledAt: new Date(scheduledAt.getTime() + 15 * 60_000),
      durationMinutes: 30,
      companionConfirmedAt: new Date(),
      paymentReservationExpiresAt: new Date(Date.now() + 10 * 60_000)
    };
    const db = {
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: "o-reserved" }])
        .mockResolvedValueOnce([]),
      order: {
        findUnique: jest.fn()
          .mockResolvedValueOnce({ companionId: "c1" })
          .mockResolvedValueOnce(order)
          .mockResolvedValueOnce(reserved),
        update: jest.fn(),
        updateMany: jest.fn()
      }
    };
    prisma.$transaction.mockImplementation(async (fn: any) => fn(db));

    await expect(service.confirmOrder("u-companion", "o-target")).rejects.toMatchObject({
      code: "COMPANION_SLOT_UNAVAILABLE",
      status: HttpStatus.CONFLICT
    });
    expect(db.order.update).not.toHaveBeenCalled();
  });

  it("confirms a structured reservation from its window even when legacy availableTimes is empty", async () => {
    const scheduledAt = new Date(Math.ceil((Date.now() + 3 * 60 * 60_000) / (30 * 60_000)) * (30 * 60_000));
    const window = {
      id: "window-2",
      companionId: "c1",
      startsAt: new Date(scheduledAt.getTime() - 30 * 60_000),
      endsAt: new Date(scheduledAt.getTime() + 60 * 60_000),
      capacity: 2,
      isActive: true
    };
    const order = {
      id: "o-structured",
      userId: "u-customer",
      companionId: "c1",
      availabilityWindowId: "window-2",
      availabilityWindowStartsAtSnapshot: window.startsAt,
      availabilityWindowEndsAtSnapshot: window.endsAt,
      availabilityWindowCapacitySnapshot: 2,
      status: "pending",
      scheduledAt,
      durationMinutes: 30,
      companionConfirmedAt: null,
      companionResponseDeadlineAt: new Date(Date.now() + 10 * 60_000),
      paymentReservationExpiresAt: null,
      companion: {
        ownerUserId: "u-companion",
        availability: "online",
        availableTimes: [],
        owner: { accountStatus: "active", profile: { isVerified: true } },
        commercialProfile: { status: "verified" }
      },
      conversation: null,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    const confirmed = {
      ...order,
      companionConfirmedAt: new Date(),
      companionResponseDeadlineAt: null,
      paymentReservationExpiresAt: new Date(Date.now() + 10 * 60_000)
    };
    const db = {
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]),
      companionAvailabilityWindow: { findFirst: jest.fn().mockResolvedValue(window) },
      order: {
        findUnique: jest.fn()
          .mockResolvedValueOnce({ companionId: "c1" })
          .mockResolvedValueOnce(order),
        update: jest.fn().mockResolvedValue(confirmed),
        updateMany: jest.fn()
      }
    };
    prisma.$transaction.mockImplementation(async (fn: any) => fn(db));

    const result = await service.confirmOrder("u-companion", "o-structured");

    expect(db.order.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ companionConfirmedAt: expect.any(Date) })
    }));
    expect(result.availabilitySnapshot).toEqual(expect.objectContaining({
      availabilityWindowId: "window-2",
      capacity: 2
    }));
  });

  it("releases expired confirmation reservations once and notifies the customer", async () => {
    const audit = { record: jest.fn().mockResolvedValue(undefined) } as any;
    const expirationService = new OrdersService(prisma, notifications, wechat, undefined, undefined, audit);
    prisma.order.findMany.mockResolvedValue([{
      id: "o-expired", userId: "u1", paymentReservationExpiresAt: new Date(Date.now() - 1_000)
    }]);
    prisma.order.updateMany.mockResolvedValue({ count: 1 });

    await expect(expirationService.expireUnpaidReservations()).resolves.toBe(1);

    expect(prisma.order.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "o-expired", status: "pending" }),
      data: { companionConfirmedAt: null, paymentReservationExpiresAt: null }
    }));
    expect(notifications.create).toHaveBeenCalledWith(
      "u1",
      "orderStatus",
      "预约保留已结束",
      expect.any(String),
      expect.objectContaining({ orderId: "o-expired", companionConfirmed: false })
    );
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      actorId: null,
      action: "order.payment_reservation_expired",
      resourceType: "order",
      resourceId: "o-expired",
      metadata: expect.objectContaining({ paymentReservationExpiresAt: expect.any(String), expiredAt: expect.any(String) })
    }), expect.anything());
  });

  it("expires a companion response deadline once, notifies the customer, and records the system action", async () => {
    const audit = { record: jest.fn().mockResolvedValue(undefined) } as any;
    const expirationService = new OrdersService(prisma, notifications, wechat, undefined, undefined, audit);
    prisma.order.findMany.mockResolvedValue([{
      id: "o-response-expired", userId: "u1", companionResponseDeadlineAt: new Date(Date.now() - 1_000)
    }]);
    prisma.order.updateMany.mockResolvedValue({ count: 1 });

    await expect(expirationService.expireUnconfirmedOrders()).resolves.toBe(1);

    expect(prisma.order.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: "o-response-expired",
        status: "pending",
        companionConfirmedAt: null
      }),
      data: expect.objectContaining({
        status: "cancelled",
        companionResponseDeadlineAt: null
      })
    }));
    expect(notifications.create).toHaveBeenCalledWith(
      "u1",
      "orderStatus",
      "预约请求已超时",
      expect.any(String),
      expect.objectContaining({ orderId: "o-response-expired", reason: "companion_response_timeout" })
    );
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      actorId: null,
      action: "order.companion_response_expired",
      resourceType: "order",
      resourceId: "o-response-expired",
      metadata: expect.objectContaining({ companionResponseDeadlineAt: expect.any(String), expiredAt: expect.any(String) })
    }), expect.anything());
  });

  it("does not duplicate an expiry notice or audit when another replica already owns the response-timeout transition", async () => {
    const audit = { record: jest.fn().mockResolvedValue(undefined) } as any;
    const expirationService = new OrdersService(prisma, notifications, wechat, undefined, undefined, audit);
    prisma.order.findMany.mockResolvedValue([{
      id: "o-response-raced", userId: "u1", companionResponseDeadlineAt: new Date(Date.now() - 1_000)
    }]);
    prisma.order.updateMany.mockResolvedValue({ count: 0 });

    await expect(expirationService.expireUnconfirmedOrders()).resolves.toBe(0);

    expect(notifications.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("expires a due reschedule proposal once, preserves the order, and queues idempotent notices for both participants", async () => {
    const originalScheduledAt = new Date(Date.now() + 3 * 24 * 60 * 60_000);
    const request = {
      id: "reschedule-worker-expired", orderId: "o-worker-expired", requestedByUserId: "u-customer",
      requestedByRole: "customer", originalScheduledAt,
      requestedScheduledAt: new Date(originalScheduledAt.getTime() + 24 * 60 * 60_000),
      requestedAvailabilityWindowId: null, status: "pending", expiresAt: new Date(Date.now() - 1_000),
      respondedAt: null, respondedByUserId: null
    };
    const order = {
      id: request.orderId, userId: "u-customer", companionId: "c1", status: "paid",
      scheduledAt: originalScheduledAt, companion: { ownerUserId: "u-companion" }
    };
    const resolved = { ...request, status: "expired", respondedAt: new Date() };
    const transactionalNotifications = { createTransactional: jest.fn().mockResolvedValue({}) } as any;
    const audit = { record: jest.fn().mockResolvedValue(undefined) } as any;
    const expirationService = new OrdersService(prisma, transactionalNotifications, wechat, undefined, undefined, audit);
    prisma.orderRescheduleRequest.findMany.mockResolvedValue([{ id: request.id, orderId: request.orderId }]);
    prisma.orderRescheduleRequest.findUnique.mockResolvedValue(request);
    prisma.orderRescheduleRequest.update.mockResolvedValue(resolved);
    prisma.order.findUnique.mockResolvedValue(order);

    await expect(expirationService.expirePendingRescheduleRequests(25)).resolves.toBe(1);

    expect(prisma.orderRescheduleRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: "pending", expiresAt: { lte: expect.any(Date) } }),
      take: 25
    }));
    expect(prisma.orderRescheduleRequest.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: request.id },
      data: expect.objectContaining({ status: "expired", respondedByUserId: null })
    }));
    expect(prisma.orderTimelineEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: "rescheduleExpired", actorRole: "system", rescheduleRequestId: request.id })
    }));
    expect(transactionalNotifications.createTransactional).toHaveBeenCalledTimes(2);
    expect(transactionalNotifications.createTransactional).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      userId: "u-customer", templateKey: "rescheduleExpired",
      eventKey: `order:${order.id}:reschedule:${request.id}:expired:u-customer`
    }));
    expect(transactionalNotifications.createTransactional).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      userId: "u-companion", templateKey: "rescheduleExpired",
      eventKey: `order:${order.id}:reschedule:${request.id}:expired:u-companion`
    }));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      actorId: null, action: "order.reschedule_expired", resourceId: request.id,
      metadata: expect.objectContaining({ notifiedUserIds: ["u-customer", "u-companion"] })
    }), expect.anything());
    expect(prisma.order.update).not.toHaveBeenCalled();
  });

  it("skips a stale expiry scan candidate when another replica has already kept it pending", async () => {
    const request = {
      id: "reschedule-worker-stale", orderId: "o-worker-stale", status: "pending",
      expiresAt: new Date(Date.now() + 60 * 60_000)
    };
    prisma.orderRescheduleRequest.findMany.mockResolvedValue([{ id: request.id, orderId: request.orderId }]);
    prisma.orderRescheduleRequest.findUnique.mockResolvedValue(request);

    await expect(service.expirePendingRescheduleRequests()).resolves.toBe(0);

    expect(prisma.orderRescheduleRequest.update).not.toHaveBeenCalled();
    expect(prisma.orderTimelineEvent.create).not.toHaveBeenCalled();
    expect(notifications.create).not.toHaveBeenCalled();
    expect(prisma.order.findUnique).not.toHaveBeenCalled();
  });

  it("creates a held-period settlement ledger entry atomically when a service completes", async () => {
    const config = { get: jest.fn((key: string) => key === "COMPANION_SETTLEMENT_HOLD_HOURS" ? 24 : 0) } as any;
    const voiceRoomControl = { terminateForOrder: jest.fn().mockResolvedValue({ state: "terminated" }) } as any;
    service = new OrdersService(
      prisma, notifications, wechat, undefined, config, undefined, undefined, undefined, voiceRoomControl
    );
    const completedAt = new Date();
    const serviceStartedAt = new Date(completedAt.getTime() - 31 * 60 * 1000);
    const order = {
      id: "o-complete", userId: "u1", companionId: "c1", amountCents: 10000,
      platformFeeBps: 1000, platformFeeCents: 1000, companionPayableCents: 9000,
      status: "inService", companion: {
        ownerUserId: "u-companion"
      }, conversation: null,
      settlementRecipientRefSnapshot: "recipient-c1",
      settlementRecipientMaskedSnapshot: "****1234",
      taxProfileRefSnapshot: "tax-c1",
      identityEvidenceRefSnapshot: "identity-evidence-c1",
      serviceAgreementVersionSnapshot: "v1",
      serviceAgreementEvidenceRefSnapshot: "agreement-evidence-c1",
      durationMinutes: 30, scheduledAt: serviceStartedAt, serviceStartedAt,
      createdAt: completedAt, updatedAt: completedAt
    };
    const db = {
      $queryRaw: jest.fn(),
      order: {
        findUnique: jest.fn().mockResolvedValue(order),
        update: jest.fn().mockResolvedValue({ ...order, status: "completed", completedAt })
      },
      orderRescheduleRequest: { findFirst: jest.fn().mockResolvedValue(null) },
      companionEarning: { upsert: jest.fn().mockResolvedValue({ id: "earning-1" }) }
    };
    prisma.$transaction.mockImplementation(async (fn: any) => fn(db));

    await service.completeService("u-companion", "o-complete");

    expect(db.companionEarning.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { orderId: "o-complete" },
      create: expect.objectContaining({ payableCents: 9000, platformFeeCents: 1000, status: "pending" })
    }));
    expect(notifications.create).toHaveBeenCalledWith(
      "u1", "orderStatus", "服务已完成", expect.any(String), expect.objectContaining({ orderId: "o-complete" })
    );
    expect(voiceRoomControl.terminateForOrder).toHaveBeenCalledWith("o-complete", "service_completed");
  });

  it("holds a historical order instead of reconstructing missing settlement evidence from the current profile", async () => {
    const config = { get: jest.fn((key: string) => key === "COMPANION_SETTLEMENT_HOLD_HOURS" ? 24 : 72) } as any;
    service = new OrdersService(prisma, notifications, wechat, undefined, config);
    const startedAt = new Date(Date.now() - 31 * 60 * 1000);
    const order = {
      id: "o-historical", userId: "u1", companionId: "c1", amountCents: 10000,
      platformFeeBps: 0, platformFeeCents: 0, companionPayableCents: 10000,
      status: "inService", durationMinutes: 30, scheduledAt: startedAt, serviceStartedAt: startedAt,
      settlementRecipientRefSnapshot: null, settlementRecipientMaskedSnapshot: null,
      taxProfileRefSnapshot: null, identityEvidenceRefSnapshot: null,
      serviceAgreementVersionSnapshot: null, serviceAgreementEvidenceRefSnapshot: null,
      companion: {
        ownerUserId: "u-companion",
        commercialProfile: {
          status: "verified",
          settlementRecipientRef: "current-recipient-must-not-be-used",
          settlementRecipientMasked: "****9999",
          taxProfileRef: "current-tax-must-not-be-used",
          serviceAgreementVersion: "current-agreement-must-not-be-used"
        }
      },
      conversation: null,
      createdAt: startedAt,
      updatedAt: startedAt
    };
    const db = {
      $queryRaw: jest.fn(),
      order: {
        findUnique: jest.fn().mockResolvedValue(order),
        update: jest.fn().mockResolvedValue({ ...order, status: "completed", completedAt: new Date() })
      },
      orderRescheduleRequest: { findFirst: jest.fn().mockResolvedValue(null) },
      companionEarning: { upsert: jest.fn().mockResolvedValue({ id: "earning-historical" }) }
    };
    prisma.$transaction.mockImplementation(async (fn: any) => fn(db));

    await service.completeService("u-companion", "o-historical");

    expect(db.companionEarning.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        status: "held",
        holdReason: "commercial_profile_snapshot_missing",
        settlementRecipientRefSnapshot: null,
        taxProfileRefSnapshot: null
      })
    }));
  });

  it("cancels a legacy pending reschedule atomically when a service completes", async () => {
    const audit = { record: jest.fn().mockResolvedValue(undefined) } as any;
    const config = { get: jest.fn((key: string) => key === "COMPANION_SETTLEMENT_HOLD_HOURS" ? 24 : 72) } as any;
    service = new OrdersService(prisma, notifications, wechat, undefined, config, audit);
    const completedAt = new Date();
    const serviceStartedAt = new Date(completedAt.getTime() - 31 * 60 * 1000);
    const request = {
      id: "reschedule-legacy-complete", orderId: "o-legacy-complete", requestedByUserId: "u1",
      requestedByRole: "customer", originalScheduledAt: serviceStartedAt,
      requestedScheduledAt: new Date(serviceStartedAt.getTime() + 24 * 60 * 60_000),
      requestedAvailabilityWindowId: null, status: "pending", expiresAt: new Date(completedAt.getTime() + 60 * 60_000),
      respondedAt: null, respondedByUserId: null
    };
    const order = {
      id: request.orderId, userId: "u1", companionId: "c1", amountCents: 10000,
      platformFeeBps: 0, platformFeeCents: 0, companionPayableCents: 10000,
      status: "inService", durationMinutes: 30, scheduledAt: serviceStartedAt, serviceStartedAt,
      companion: { ownerUserId: "u-companion" }, conversation: null,
      settlementRecipientRefSnapshot: "recipient-c1", settlementRecipientMaskedSnapshot: "****1234",
      taxProfileRefSnapshot: "tax-c1", identityEvidenceRefSnapshot: "identity-evidence-c1",
      serviceAgreementVersionSnapshot: "v1", serviceAgreementEvidenceRefSnapshot: "agreement-evidence-c1",
      createdAt: serviceStartedAt, updatedAt: completedAt
    };
    const resolvedRequest = { ...request, status: "cancelled", respondedAt: completedAt, respondedByUserId: "u-companion" };
    const db = {
      $queryRaw: jest.fn(),
      order: {
        findUnique: jest.fn().mockResolvedValue(order),
        update: jest.fn().mockResolvedValue({ ...order, status: "completed", completedAt })
      },
      orderRescheduleRequest: {
        findFirst: jest.fn().mockResolvedValue(request),
        findUnique: jest.fn().mockResolvedValue(request),
        update: jest.fn().mockResolvedValue(resolvedRequest)
      },
      orderTimelineEvent: { create: jest.fn().mockResolvedValue({}) },
      companionEarning: { upsert: jest.fn().mockResolvedValue({ id: "earning-legacy-complete" }) }
    };
    prisma.$transaction.mockImplementation(async (fn: any) => fn(db));

    await service.completeService("u-companion", order.id);

    expect(db.order.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: order.id },
      data: expect.objectContaining({ status: "completed" })
    }));
    expect(db.orderRescheduleRequest.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: request.id },
      data: expect.objectContaining({ status: "cancelled", respondedByUserId: "u-companion" })
    }));
    expect(db.orderTimelineEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        type: "rescheduleCancelled", actorId: "u-companion", actorRole: "companion", rescheduleRequestId: request.id
      })
    }));
    expect(notifications.create).toHaveBeenCalledWith(
      "u1", "orderStatus", "改期请求已取消", "服务已完成，原改期协商已自动关闭。",
      expect.objectContaining({ orderId: order.id, rescheduleRequestId: request.id, reason: "service_completed" })
    );
    expect(notifications.create).toHaveBeenCalledWith(
      "u-companion", "orderStatus", "改期请求已取消", "服务已完成，原改期协商已自动关闭。",
      expect.objectContaining({ orderId: order.id, rescheduleRequestId: request.id, reason: "service_completed" })
    );
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      actorId: "u-companion", action: "order.reschedule_cancelled", resourceId: request.id,
      metadata: expect.objectContaining({ orderId: order.id, reason: "service_completed" })
    }), db);
  });

  it("records independent pre-service guideline acknowledgements for the customer and companion", async () => {
    const audit = { record: jest.fn().mockResolvedValue(undefined) } as any;
    const auditedService = new OrdersService(prisma, notifications, wechat, undefined, undefined, audit);
    const createdAt = new Date("2026-07-20T08:00:00.000Z");
    const baseOrder: any = {
      id: "o-service-guidelines", userId: "u-customer", companionId: "c1",
      themeId: "t1", durationMinutes: 30, amountCents: 3900, currency: "CNY", status: "paid",
      scheduledAt: new Date("2026-07-20T10:00:00.000Z"),
      companionNameSnapshot: "林安", companionRoleSnapshot: "倾听陪伴", companionInitialsSnapshot: "林安",
      themeNameSnapshot: "情绪倾听", conversationId: "conversation-1", companionConfirmedAt: createdAt,
      companionResponseDeadlineAt: null, paymentReservationExpiresAt: null, serviceStartedAt: null,
      platformFeeBps: 0, platformFeeCents: 0, companionPayableCents: 3900,
      paidAt: createdAt, cancelledAt: null, completedAt: null, customerConfirmedAt: null,
      customerServiceGuidelinesConfirmedAt: null, companionServiceGuidelinesConfirmedAt: null,
      refundRequestDeadlineAt: null, createdAt, updatedAt: createdAt,
      companion: { ownerUserId: "u-companion" }, conversation: { externalId: "c1" }, refunds: []
    };
    let currentOrder: any = { ...baseOrder };
    const db = {
      $queryRaw: jest.fn(),
      order: {
        findUnique: jest.fn().mockImplementation(async () => currentOrder),
        update: jest.fn().mockImplementation(async ({ data }: any) => ({ ...currentOrder, ...data }))
      },
      refundTransaction: { findFirst: jest.fn().mockResolvedValue(null) }
    };
    prisma.$transaction.mockImplementation(async (fn: any) => fn(db));

    const customerResult = await auditedService.confirmServiceGuidelines("u-customer", baseOrder.id);
    expect(customerResult.customerServiceGuidelinesConfirmedAt).toEqual(expect.any(String));
    expect(customerResult.companionServiceGuidelinesConfirmedAt).toBeNull();
    expect(db.order.update).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { id: baseOrder.id },
      data: expect.objectContaining({ customerServiceGuidelinesConfirmedAt: expect.any(Date) })
    }));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      actorId: "u-customer", action: "order.customer_confirmed_service_guidelines", resourceId: baseOrder.id,
      metadata: expect.objectContaining({ actorRole: "customer" })
    }), db);

    const customerGuidelinesConfirmedAt = customerResult.customerServiceGuidelinesConfirmedAt;
    currentOrder = {
      ...baseOrder,
      customerServiceGuidelinesConfirmedAt: new Date(customerGuidelinesConfirmedAt!)
    };
    const companionResult = await auditedService.confirmServiceGuidelines("u-companion", baseOrder.id);
    expect(companionResult.customerServiceGuidelinesConfirmedAt).toEqual(customerResult.customerServiceGuidelinesConfirmedAt);
    expect(companionResult.companionServiceGuidelinesConfirmedAt).toEqual(expect.any(String));
    expect(db.order.update).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { id: baseOrder.id },
      data: expect.objectContaining({ companionServiceGuidelinesConfirmedAt: expect.any(Date) })
    }));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      actorId: "u-companion", action: "order.companion_confirmed_service_guidelines", resourceId: baseOrder.id,
      metadata: expect.objectContaining({ actorRole: "companion" })
    }), db);
  });

  it("only permits a service-guidelines acknowledgement before the paid order has started", async () => {
    const db = {
      $queryRaw: jest.fn(),
      order: {
        findUnique: jest.fn().mockResolvedValue({
          id: "o-started-service", userId: "u-customer", companionId: "c1", status: "inService",
          serviceStartedAt: new Date(), companion: { ownerUserId: "u-companion" }
        }),
        update: jest.fn()
      },
      refundTransaction: { findFirst: jest.fn() }
    };
    prisma.$transaction.mockImplementation(async (fn: any) => fn(db));

    await expect(service.confirmServiceGuidelines("u-customer", "o-started-service")).rejects.toMatchObject({
      code: "ORDER_SERVICE_GUIDELINES_INVALID_STATE", status: HttpStatus.CONFLICT
    });
    expect(db.order.update).not.toHaveBeenCalled();
    expect(db.refundTransaction.findFirst).not.toHaveBeenCalled();
  });

  it("does not create a new service-guidelines acknowledgement while a refund is active", async () => {
    const db = {
      $queryRaw: jest.fn(),
      order: {
        findUnique: jest.fn().mockResolvedValue({
          id: "o-refund-guidelines", userId: "u-customer", companionId: "c1", status: "paid",
          serviceStartedAt: null, customerServiceGuidelinesConfirmedAt: null,
          companionServiceGuidelinesConfirmedAt: null, companion: { ownerUserId: "u-companion" }
        }),
        update: jest.fn()
      },
      refundTransaction: { findFirst: jest.fn().mockResolvedValue({ id: "refund-live" }) }
    };
    prisma.$transaction.mockImplementation(async (fn: any) => fn(db));

    await expect(service.confirmServiceGuidelines("u-customer", "o-refund-guidelines")).rejects.toMatchObject({
      code: "ORDER_REFUND_IN_PROGRESS", status: HttpStatus.CONFLICT
    });
    expect(db.order.update).not.toHaveBeenCalled();
  });

  it("records one private completed-order feedback submission without changing the order state", async () => {
    const audit = { record: jest.fn().mockResolvedValue(undefined) } as any;
    const moderation = { moderateAsync: jest.fn().mockResolvedValue({ decision: "allow" }) } as any;
    const moderationCases = { createFromResult: jest.fn() } as any;
    const feedbackService = new OrdersService(
      prisma, notifications, wechat, undefined, undefined, audit, moderation, moderationCases
    );
    const createdAt = new Date("2026-07-20T12:00:00.000Z");
    const order: any = {
      id: "o-experience-feedback", userId: "u-customer", companionId: "c1",
      themeId: "t1", durationMinutes: 30, amountCents: 3900, currency: "CNY", status: "completed",
      scheduledAt: new Date("2026-07-20T10:00:00.000Z"),
      companionNameSnapshot: "林安", companionRoleSnapshot: "倾听陪伴", companionInitialsSnapshot: "林安",
      themeNameSnapshot: "情绪倾听", conversationId: "conversation-1", companionConfirmedAt: createdAt,
      companionResponseDeadlineAt: null, paymentReservationExpiresAt: null, serviceStartedAt: createdAt,
      platformFeeBps: 0, platformFeeCents: 0, companionPayableCents: 3900,
      paidAt: createdAt, cancelledAt: null, completedAt: createdAt, customerConfirmedAt: null,
      customerServiceGuidelinesConfirmedAt: null, companionServiceGuidelinesConfirmedAt: null,
      refundRequestDeadlineAt: null, createdAt, updatedAt: createdAt,
      conversation: { externalId: "c1" }, refunds: [], experienceFeedback: null
    };
    const feedback = {
      id: "feedback-1", orderId: order.id, rating: 4,
      tags: ["communicationClear", "onTime"], note: "沟通节奏很舒服。",
      createdAt, updatedAt: createdAt
    };
    const db = {
      $queryRaw: jest.fn(),
      order: { findUnique: jest.fn().mockResolvedValue(order) },
      orderExperienceFeedback: { create: jest.fn().mockResolvedValue(feedback) }
    };
    prisma.order.findUnique.mockResolvedValue(order);
    prisma.$transaction.mockImplementation(async (fn: any) => fn(db));

    const result = await feedbackService.submitExperienceFeedback(order.userId, order.id, {
      rating: 4, tags: ["onTime", "communicationClear"], note: feedback.note
    });

    expect(moderation.moderateAsync).toHaveBeenCalledWith(feedback.note, "profile");
    expect(db.orderExperienceFeedback.create).toHaveBeenCalledWith({
      data: {
        orderId: order.id,
        rating: 4,
        tags: ["communicationClear", "onTime"],
        note: feedback.note
      }
    });
    expect(result.status).toBe("completed");
    expect(result.experienceFeedback).toEqual({
      id: feedback.id,
      rating: 4,
      tags: feedback.tags,
      note: feedback.note,
      createdAt: createdAt.toISOString()
    });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      actorId: order.userId,
      action: "order.customer_submitted_experience_feedback",
      resourceType: "orderExperienceFeedback",
      resourceId: feedback.id,
      metadata: expect.objectContaining({ orderId: order.id, rating: 4, hasNote: true })
    }), db);

    prisma.order.findUnique.mockResolvedValue({ ...order, experienceFeedback: feedback });
    const retried = await feedbackService.submitExperienceFeedback(order.userId, order.id, { rating: 1 });
    expect(retried.experienceFeedback?.id).toBe(feedback.id);
    expect(db.orderExperienceFeedback.create).toHaveBeenCalledTimes(1);
  });

  it("keeps private feedback out of companion order-list queries", async () => {
    prisma.companionProfile.findUnique.mockResolvedValue({ id: "c-feedback" });
    prisma.order.findMany.mockResolvedValue([]);

    await service.listForCompanion("u-companion");

    expect(prisma.order.findMany).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.not.objectContaining({ experienceFeedback: expect.anything() })
    }));
  });

  it("lists only the eligible companion's Beijing-today service facts in appointment order", async () => {
    const now = new Date("2026-07-20T16:00:00.000Z"); // 2026-07-21 00:00 in Beijing
    prisma.companionProfile.findUnique.mockResolvedValue({
      id: "c-workbench",
      isVerified: true,
      owner: { accountStatus: "active", profile: { isVerified: true } }
    });
    prisma.order.findMany.mockResolvedValue([
      {
        id: "o-today-1",
        scheduledAt: new Date("2026-07-20T17:30:00.000Z"),
        durationMinutes: 60,
        status: "paid",
        serviceOfferingTitleSnapshot: "60 分钟语音陪伴",
        themeNameSnapshot: "情绪倾听",
        userId: "must-not-leak",
        conversationId: "must-not-leak"
      }
    ]);
    prisma.order.count.mockResolvedValue(2);

    await expect(service.listTodayForCompanion("u-companion", now)).resolves.toEqual({
      date: "2026-07-21",
      timezone: "Asia/Shanghai",
      pendingConfirmationCount: 2,
      items: [{
        id: "o-today-1",
        scheduledAt: "2026-07-20T17:30:00.000Z",
        durationMinutes: 60,
        status: "paid",
        serviceTitle: "60 分钟语音陪伴"
      }]
    });

    expect(prisma.order.findMany).toHaveBeenCalledWith({
      where: {
        companionId: "c-workbench",
        status: { in: ["pending", "paying", "paid", "inService", "completed"] },
        scheduledAt: {
          gte: new Date("2026-07-20T16:00:00.000Z"),
          lt: new Date("2026-07-21T16:00:00.000Z")
        }
      },
      select: {
        id: true,
        scheduledAt: true,
        durationMinutes: true,
        status: true,
        serviceOfferingTitleSnapshot: true,
        themeNameSnapshot: true
      },
      orderBy: [{ scheduledAt: "asc" }, { id: "asc" }]
    });
    expect(prisma.order.count).toHaveBeenCalledWith({
      where: { companionId: "c-workbench", status: "pending", companionConfirmedAt: null }
    });
    const query = prisma.order.findMany.mock.calls.at(-1)?.[0];
    expect(query).not.toHaveProperty("include");
    expect(JSON.stringify(query)).not.toMatch(/user|customer|conversation|refund|settlement/i);
  });

  it("rejects the workbench day feed before reading orders when the owner is not an eligible companion", async () => {
    prisma.companionProfile.findUnique.mockResolvedValue({
      id: "c-unverified",
      isVerified: false,
      owner: { accountStatus: "active", profile: { isVerified: true } }
    });

    await expect(service.listTodayForCompanion("u-customer", new Date("2026-07-20T16:00:00.000Z")))
      .rejects.toMatchObject({ code: "COMPANION_OWNER_NOT_ELIGIBLE", status: HttpStatus.FORBIDDEN });
    expect(prisma.order.findMany).not.toHaveBeenCalled();
    expect(prisma.order.count).not.toHaveBeenCalled();
  });

  it("rejects post-service feedback before completion and sends risky notes through the existing moderation case flow", async () => {
    const completedOrder = {
      id: "o-feedback-moderation", userId: "u-customer", companionId: "c1", status: "completed",
      experienceFeedback: null
    };
    const moderation = { moderateAsync: jest.fn().mockResolvedValue({ decision: "review" }) } as any;
    const moderationCases = { createFromResult: jest.fn().mockResolvedValue({ id: "case-feedback-1" }) } as any;
    const feedbackService = new OrdersService(
      prisma, notifications, wechat, undefined, undefined, undefined, moderation, moderationCases
    );
    prisma.order.findUnique.mockResolvedValue({ ...completedOrder, status: "paid" });

    await expect(feedbackService.submitExperienceFeedback("u-customer", completedOrder.id, { rating: 3 })).rejects.toMatchObject({
      code: "ORDER_FEEDBACK_INVALID_STATE", status: HttpStatus.CONFLICT
    });

    prisma.order.findUnique.mockResolvedValue(completedOrder);
    await expect(feedbackService.submitExperienceFeedback("u-customer", completedOrder.id, {
      rating: 2, note: "需要人工核对这段说明。"
    })).rejects.toMatchObject({
      code: "ORDER_FEEDBACK_NOTE_REQUIRES_REVISION", status: HttpStatus.UNPROCESSABLE_ENTITY
    });
    expect(moderation.moderateAsync).toHaveBeenCalledWith("需要人工核对这段说明。", "profile");
    expect(moderationCases.createFromResult).toHaveBeenCalledWith(expect.objectContaining({
      targetId: completedOrder.id,
      subjectUserId: "u-customer",
      title: "服务反馈内容待处理"
    }));
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("refuses to complete a service before its booked duration has elapsed", async () => {
    const startedAt = new Date(Date.now() - 5 * 60 * 1000);
    const db = {
      $queryRaw: jest.fn(),
      order: {
        findUnique: jest.fn().mockResolvedValue({
          id: "o-too-early", userId: "u1", companionId: "c1", status: "inService",
          durationMinutes: 30, scheduledAt: startedAt, serviceStartedAt: startedAt,
          companion: { ownerUserId: "u-companion" }, conversation: null
        }),
        update: jest.fn()
      },
      companionEarning: { upsert: jest.fn() }
    };
    prisma.$transaction.mockImplementation(async (fn: any) => fn(db));

    await expect(service.completeService("u-companion", "o-too-early")).rejects.toMatchObject({
      code: "ORDER_SERVICE_NOT_COMPLETE",
      status: HttpStatus.CONFLICT
    });
    expect(db.order.update).not.toHaveBeenCalled();
    expect(db.companionEarning.upsert).not.toHaveBeenCalled();
  });
});
