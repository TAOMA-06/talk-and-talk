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
        updateMany: jest.fn().mockResolvedValue({ count: 1 }) // finish failed
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
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([]) // bounded expired-lease recovery
        .mockResolvedValueOnce([{ id: "d1", leaseToken: "lease-d1" }]) // SKIP LOCKED claim
        .mockResolvedValueOnce([{ id: "g1", templateId: "tmpl-payment" }]),
      weChatSubscriptionGrant: { update: jest.fn() }
    } as any;
    db.notificationDelivery.findUnique.mockResolvedValue({
      id: "d1",
      status: "processing",
      leaseToken: "lease-d1",
      userId: "u1",
      templateKey: "paymentSuccess",
      attemptCount: 0,
      createdAt: new Date(),
      notification: { title: "支付成功", body: "订单已支付", data: { orderId: "o1" } }
    });
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
    expect(db.$queryRaw.mock.calls[1][0].join("")).toEqual(expect.stringContaining("FOR UPDATE SKIP LOCKED"));
    expect(db.$queryRaw.mock.calls[2][0].join("")).toEqual(expect.stringContaining("CompanionFavorite"));
    expect(db.$queryRaw.mock.calls[2][0].join("")).toEqual(expect.stringContaining("AvailabilityReminderAttempt"));
    expect(provider.send).toHaveBeenCalledTimes(1);
    expect(prisma.notificationDelivery.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "failed", errorCode: "DELIVERY_UNKNOWN" })
    }));
    expect(metrics.recordNotificationDeliveryFailure).toHaveBeenCalledTimes(1);
  });

  it("bounds expired-lease recovery and refills the claim scan after recovery", async () => {
    const config = {
      get: jest.fn((key: string) => ({
        NOTIFICATION_DELIVERY_ENABLED: true,
        NOTIFICATION_DELIVERY_BATCH_SIZE: 2
      } as Record<string, unknown>)[key])
    } as any;
    const prisma = {
      notificationDelivery: { updateMany: jest.fn() },
      $transaction: jest.fn()
    } as any;
    const db = {
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([{ id: "expired-1" }, { id: "expired-2" }])
        .mockResolvedValueOnce([{ id: "expired-3" }, { id: "expired-4" }])
        .mockResolvedValueOnce([{ id: "expired-5" }, { id: "expired-6" }])
        .mockResolvedValueOnce([{ id: "expired-7" }, { id: "expired-8" }])
        .mockResolvedValueOnce([])
    } as any;
    prisma.$transaction.mockImplementation(async (fn: any) => fn(db));
    const provider = { send: jest.fn() } as any;
    const metrics = {
      recordNotificationDeliveryFailure: jest.fn(),
      recordNotificationDeliverySuccess: jest.fn(),
      recordNotificationDeliverySkipped: jest.fn()
    } as any;
    const worker = new NotificationDeliveryWorker(config, prisma, provider, metrics);

    await expect(worker.deliverDue()).resolves.toEqual({
      scanned: 0, sent: 0, failed: 0, skipped: 0, recovered: 8
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(5);
    expect(db.$queryRaw.mock.calls[0][0].join("")).toEqual(expect.stringContaining(
      'delivery."leaseExpiresAt" IS NULL'
    ));
    expect(db.$queryRaw.mock.calls[0][0].join("")).toEqual(expect.stringContaining(
      "FOR UPDATE SKIP LOCKED"
    ));
    expect(db.$queryRaw.mock.calls[4][0].join("")).toEqual(expect.stringContaining(
      'delivery."status" = \'pending\''
    ));
    expect(metrics.recordNotificationDeliveryFailure).toHaveBeenCalledTimes(8);
    expect(provider.send).not.toHaveBeenCalled();
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
      notificationDelivery: { updateMany: jest.fn() },
      $transaction: jest.fn()
    } as any;
    const db = {
      notificationDelivery: {
        findUnique: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: "d-missing-template", leaseToken: "lease-missing" }])
    } as any;
    db.notificationDelivery.findUnique.mockResolvedValue({
      id: "d-missing-template",
      status: "processing",
      leaseToken: "lease-missing",
      userId: "u1",
      templateKey: "paymentSuccess",
      attemptCount: 0,
      createdAt: new Date(),
      notification: { title: "支付成功", body: "订单已支付", data: null }
    });
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

  it("skips a queued message reminder when its recipient muted the conversation before delivery", async () => {
    const config = {
      get: jest.fn((key: string) => ({
        NOTIFICATION_DELIVERY_ENABLED: true,
        NOTIFICATION_DELIVERY_BATCH_SIZE: 20,
        WECHAT_SUBSCRIBE_TEMPLATES: [{ key: "messageReceived", templateId: "tmpl-message" }]
      } as Record<string, unknown>)[key])
    } as any;
    const prisma = {
      notificationDelivery: { updateMany: jest.fn() },
      $transaction: jest.fn()
    } as any;
    const db = {
      notificationDelivery: {
        findUnique: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      conversationNotificationPreference: {
        findUnique: jest.fn().mockResolvedValue({ mutedAt: new Date() })
      },
      conversationBlock: { findFirst: jest.fn() },
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: "d-muted", leaseToken: "lease-muted" }])
        .mockResolvedValueOnce([])
    } as any;
    db.notificationDelivery.findUnique.mockResolvedValue({
      id: "d-muted",
      status: "processing",
      leaseToken: "lease-muted",
      userId: "u-recipient",
      templateKey: "messageReceived",
      attemptCount: 0,
      createdAt: new Date(),
      notification: {
        type: "messageReceived",
        eventKey: "conversation:conv-1:message:message-1:recipient:u-recipient",
        title: "收到一条新消息",
        body: "打开 Talk&Talk 的平台内会话查看。",
        data: { conversationId: "c1" }
      }
    });
    prisma.$transaction.mockImplementation(async (fn: any) => fn(db));
    const provider = { send: jest.fn() } as any;
    const metrics = {
      recordNotificationDeliveryFailure: jest.fn(),
      recordNotificationDeliverySuccess: jest.fn(),
      recordNotificationDeliverySkipped: jest.fn()
    } as any;
    const worker = new NotificationDeliveryWorker(config, prisma, provider, metrics);

    await expect(worker.deliverDue()).resolves.toEqual({ scanned: 1, sent: 0, failed: 0, skipped: 1, recovered: 0 });
    expect(db.conversationNotificationPreference.findUnique).toHaveBeenCalledWith({
      where: { conversationId_userId: { conversationId: "conv-1", userId: "u-recipient" } },
      select: { mutedAt: true }
    });
    expect(db.notificationDelivery.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "skipped", errorCode: "CONVERSATION_MUTED" })
    }));
    expect(provider.send).not.toHaveBeenCalled();
    expect(metrics.recordNotificationDeliverySkipped).toHaveBeenCalledTimes(1);
  });

  it("skips a queued message reminder when either participant blocks before delivery", async () => {
    const config = {
      get: jest.fn((key: string) => ({
        NOTIFICATION_DELIVERY_ENABLED: true,
        NOTIFICATION_DELIVERY_BATCH_SIZE: 20,
        WECHAT_SUBSCRIBE_TEMPLATES: [{ key: "messageReceived", templateId: "tmpl-message" }]
      } as Record<string, unknown>)[key])
    } as any;
    const prisma = {
      notificationDelivery: { updateMany: jest.fn() },
      $transaction: jest.fn()
    } as any;
    const db = {
      notificationDelivery: {
        findUnique: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      conversationNotificationPreference: { findUnique: jest.fn().mockResolvedValue(null) },
      conversationBlock: { findFirst: jest.fn().mockResolvedValue({ id: "block-1" }) },
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: "d-blocked", leaseToken: "lease-blocked" }])
        .mockResolvedValueOnce([])
    } as any;
    db.notificationDelivery.findUnique.mockResolvedValue({
      id: "d-blocked",
      status: "processing",
      leaseToken: "lease-blocked",
      userId: "u-recipient",
      templateKey: "messageReceived",
      attemptCount: 0,
      createdAt: new Date(),
      notification: {
        type: "messageReceived",
        eventKey: "conversation:conv-1:message:message-1:recipient:u-recipient",
        title: "收到一条新消息",
        body: "打开 Talk&Talk 的平台内会话查看。",
        data: { conversationId: "c1" }
      }
    });
    prisma.$transaction.mockImplementation(async (fn: any) => fn(db));
    const provider = { send: jest.fn() } as any;
    const metrics = {
      recordNotificationDeliveryFailure: jest.fn(),
      recordNotificationDeliverySuccess: jest.fn(),
      recordNotificationDeliverySkipped: jest.fn()
    } as any;
    const worker = new NotificationDeliveryWorker(config, prisma, provider, metrics);

    await expect(worker.deliverDue()).resolves.toEqual({ scanned: 1, sent: 0, failed: 0, skipped: 1, recovered: 0 });
    expect(db.conversationBlock.findFirst).toHaveBeenCalledWith({
      where: { conversationId: "conv-1" },
      select: { id: true }
    });
    expect(db.notificationDelivery.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "skipped", errorCode: "CONVERSATION_BLOCKED" })
    }));
    expect(provider.send).not.toHaveBeenCalled();
    expect(metrics.recordNotificationDeliverySkipped).toHaveBeenCalledTimes(1);
  });
});
