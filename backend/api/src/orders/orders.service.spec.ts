import { HttpStatus } from "@nestjs/common";

import { AppException } from "../common/errors/app.exception";
import { OrdersService } from "./orders.service";

describe("OrdersService", () => {
  const prisma = {
    companionProfile: {
      findFirst: jest.fn()
    },
    order: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn()
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
  });

  it("rejects unpublished companion", async () => {
    prisma.companionProfile.findFirst.mockResolvedValue(null);

    await expect(
      service.create("u1", { companionId: "c9", themeId: "t1", durationMinutes: 30, scheduledAt: new Date(Date.now() + 3_600_000).toISOString() })
    ).rejects.toMatchObject({ code: "COMPANION_NOT_FOUND", status: HttpStatus.NOT_FOUND });
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
        }
      })
    );

    const result = await service.cancel("u1", "o1");
    expect(result.status).toBe("cancelled");
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
      }
    }));

    const result = await service.cancel("u1", "o1");

    expect(wechat.closePayment).toHaveBeenCalledWith("T-expired");
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "p1", status: "initiated" },
      data: { status: "closed" }
    }));
    expect(result.status).toBe("cancelled");
  });
});
