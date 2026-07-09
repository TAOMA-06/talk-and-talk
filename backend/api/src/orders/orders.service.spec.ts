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
  const audit = { record: jest.fn().mockResolvedValue({}) } as any;
  let service: OrdersService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new OrdersService(prisma, notifications, audit);
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
      durationMinutes: 60
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
      service.create("u1", { companionId: "c9", themeId: "t1", durationMinutes: 30 })
    ).rejects.toMatchObject({ code: "COMPANION_NOT_FOUND", status: HttpStatus.NOT_FOUND });
  });

  it("cancels only pending or paying orders", async () => {
    prisma.order.findUnique.mockResolvedValue({
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
    });

    await expect(service.cancel("u1", "o1")).rejects.toBeInstanceOf(AppException);
    await expect(service.cancel("u1", "o1")).rejects.toMatchObject({
      code: "ORDER_INVALID_STATE"
    });
  });

  it("cancels pending order and closes open payments", async () => {
    prisma.order.findUnique.mockResolvedValue({
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
      createdAt: new Date("2026-07-09T00:00:00.000Z"),
      updatedAt: new Date("2026-07-09T00:00:00.000Z"),
      conversation: null
    });

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
        paymentTransaction: { updateMany: prisma.paymentTransaction.updateMany },
        order: { update: jest.fn().mockResolvedValue(updated) }
      })
    );

    const result = await service.cancel("u1", "o1");
    expect(result.status).toBe("cancelled");
  });
});
