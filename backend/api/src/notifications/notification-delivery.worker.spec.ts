import { NotificationDeliveryWorker } from "./notification-delivery.worker";

describe("NotificationDeliveryWorker", () => {
  it("does not retry an unknown state after the remote delivery POST may have happened", async () => {
    const config = {
      get: jest.fn((key: string) => ({
        NOTIFICATION_DELIVERY_ENABLED: true,
        NOTIFICATION_DELIVERY_BATCH_SIZE: 20,
        WECHAT_SUBSCRIBE_TEMPLATES: [{ key: "paymentSuccess", templateId: "tmpl-payment" }]
      } as Record<string, unknown>)[key])
    } as any;
    const prisma = {
      notificationDelivery: {
        updateMany: jest.fn()
          .mockResolvedValueOnce({ count: 0 }) // recover expired leases
          .mockResolvedValueOnce({ count: 1 }) // claim the pending row
          .mockResolvedValueOnce({ count: 1 }), // finish failed
        findMany: jest.fn().mockResolvedValue([{ id: "d1" }])
      },
      $transaction: jest.fn()
    } as any;
    const db = {
      notificationDelivery: {
        findUnique: jest.fn().mockResolvedValue({
          id: "d1", status: "processing", leaseToken: expect.any(String), userId: "u1", templateKey: "paymentSuccess",
          attemptCount: 0, createdAt: new Date(), notification: { title: "支付成功", body: "订单已支付", data: { orderId: "o1" } }
        })
      },
      $queryRaw: jest.fn().mockResolvedValue([{ id: "g1", templateId: "tmpl-payment" }]),
      weChatSubscriptionGrant: { update: jest.fn() }
    } as any;
    // The lease token is generated inside the worker, so the mock reads it
    // from the preceding claim update instead of attempting to predict UUID.
    db.notificationDelivery.findUnique.mockImplementation(async () => ({
      id: "d1",
      status: "processing",
      leaseToken: prisma.notificationDelivery.updateMany.mock.calls[1][0].data.leaseToken,
      userId: "u1",
      templateKey: "paymentSuccess",
      attemptCount: 0,
      createdAt: new Date(),
      notification: { title: "支付成功", body: "订单已支付", data: { orderId: "o1" } }
    }));
    prisma.$transaction.mockImplementation(async (fn: any) => fn(db));
    const provider = { send: jest.fn().mockResolvedValue({
      outcome: "failed", attempted: true, errorCode: "DELIVERY_UNKNOWN", message: "TypeError"
    }) } as any;
    const metrics = {
      recordNotificationDeliveryFailure: jest.fn(),
      recordNotificationDeliverySuccess: jest.fn(),
      recordNotificationDeliverySkipped: jest.fn()
    } as any;
    const worker = new NotificationDeliveryWorker(config, prisma, provider, metrics);

    await expect(worker.deliverDue()).resolves.toEqual({ scanned: 1, sent: 0, failed: 1, skipped: 0, recovered: 0 });
    expect(provider.send).toHaveBeenCalledTimes(1);
    expect(prisma.notificationDelivery.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "failed", errorCode: "DELIVERY_UNKNOWN" })
    }));
    expect(metrics.recordNotificationDeliveryFailure).toHaveBeenCalledTimes(1);
  });

  it("reports a deployment template mismatch as a failed delivery, not a skipped authorization", async () => {
    const config = {
      get: jest.fn((key: string) => ({
        NOTIFICATION_DELIVERY_ENABLED: true,
        NOTIFICATION_DELIVERY_BATCH_SIZE: 20,
        WECHAT_SUBSCRIBE_TEMPLATES: []
      } as Record<string, unknown>)[key])
    } as any;
    const prisma = {
      notificationDelivery: {
        updateMany: jest.fn()
          .mockResolvedValueOnce({ count: 0 })
          .mockResolvedValueOnce({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([{ id: "d-missing-template" }])
      },
      $transaction: jest.fn()
    } as any;
    const db = {
      notificationDelivery: {
        findUnique: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      }
    } as any;
    db.notificationDelivery.findUnique.mockImplementation(async () => ({
      id: "d-missing-template",
      status: "processing",
      leaseToken: prisma.notificationDelivery.updateMany.mock.calls[1][0].data.leaseToken,
      userId: "u1",
      templateKey: "paymentSuccess",
      attemptCount: 0,
      createdAt: new Date(),
      notification: { title: "支付成功", body: "订单已支付", data: null }
    }));
    prisma.$transaction.mockImplementation(async (fn: any) => fn(db));
    const provider = { send: jest.fn() } as any;
    const metrics = {
      recordNotificationDeliveryFailure: jest.fn(),
      recordNotificationDeliverySuccess: jest.fn(),
      recordNotificationDeliverySkipped: jest.fn()
    } as any;
    const worker = new NotificationDeliveryWorker(config, prisma, provider, metrics);

    await expect(worker.deliverDue()).resolves.toEqual({
      scanned: 1, sent: 0, failed: 1, skipped: 0, recovered: 0
    });
    expect(provider.send).not.toHaveBeenCalled();
    expect(db.notificationDelivery.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "failed", errorCode: "UNKNOWN_TEMPLATE" })
    }));
    expect(metrics.recordNotificationDeliveryFailure).toHaveBeenCalledTimes(1);
    expect(metrics.recordNotificationDeliverySkipped).not.toHaveBeenCalled();
  });
});
