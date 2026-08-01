import { NotificationsService } from "./notifications.service";

describe("NotificationsService", () => {
  const prisma = {
    notification: {
      create: jest.fn(),
      upsert: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn()
    },
    notificationDelivery: { upsert: jest.fn() },
    conversationNotificationPreference: { findUnique: jest.fn() },
    conversationBlock: { findFirst: jest.fn() }
  } as any;

  let service: NotificationsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new NotificationsService(prisma);
  });

  it("creates a notification", async () => {
    prisma.notification.create.mockResolvedValue({
      id: "n1",
      userId: "u1",
      type: "paymentSuccess",
      title: "支付成功",
      body: "订单已支付",
      data: { orderId: "o1" },
      readAt: null,
      createdAt: new Date("2026-07-09T00:00:00.000Z")
    });

    const result = await service.create("u1", "paymentSuccess", "支付成功", "订单已支付", {
      orderId: "o1"
    });

    expect(result.id).toBe("n1");
    expect(result.readAt).toBeNull();
  });

  it("marks all unread as read", async () => {
    prisma.notification.updateMany.mockResolvedValue({ count: 3 });
    const result = await service.markAllRead("u1");
    expect(result.updated).toBe(3);
  });

  it("returns a bounded unread page with a deterministic id tie-breaker", async () => {
    const createdAt = new Date("2026-08-01T08:00:00.000Z");
    prisma.notification.findMany.mockResolvedValue([{
      id: "n-page",
      userId: "u1",
      type: "supportUpdate",
      title: "客服状态更新",
      body: "请查看最新处理进度。",
      data: null,
      readAt: null,
      createdAt
    }]);
    prisma.notification.count.mockResolvedValue(6);

    const result = await service.list("u1", { page: 2, pageSize: 5, unreadOnly: true });

    expect(prisma.notification.findMany).toHaveBeenCalledWith({
      where: { userId: "u1", readAt: null },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: 5,
      take: 5
    });
    expect(result.pagination).toEqual({ page: 2, pageSize: 5, total: 6, totalPages: 2 });
    expect(result.items).toHaveLength(1);
  });

  it("persists an idempotent delivery intent with the notification transaction", async () => {
    prisma.notification.upsert.mockResolvedValue({
      id: "n-outbox", userId: "u1", type: "orderStatus", title: "预约已确认", body: "请支付",
      data: { orderId: "o1" }, eventKey: "order:o1:confirmed", readAt: null, createdAt: new Date()
    });
    prisma.notificationDelivery.upsert.mockResolvedValue({ id: "d1" });

    await service.createTransactional(prisma, {
      userId: "u1", type: "orderStatus", title: "预约已确认", body: "请支付",
      data: { orderId: "o1" }, eventKey: "order:o1:confirmed", templateKey: "orderConfirmed"
    });

    expect(prisma.notification.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { eventKey: "order:o1:confirmed" },
      create: expect.objectContaining({ eventKey: "order:o1:confirmed" })
    }));
    expect(prisma.notificationDelivery.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { notificationId_templateKey: { notificationId: "n-outbox", templateKey: "orderConfirmed" } }
    }));
  });

  it("creates a generic new-message delivery only when the recipient has not muted that conversation", async () => {
    prisma.conversationBlock.findFirst.mockResolvedValue(null);
    prisma.conversationNotificationPreference.findUnique.mockResolvedValue(null);
    prisma.notification.upsert.mockResolvedValue({
      id: "n-message", userId: "u-recipient", type: "messageReceived", title: "收到一条新消息",
      body: "打开 Talk&Talk 的平台内会话查看。", data: { conversationId: "c1" },
      eventKey: "conversation:conv-1:message:message-1:recipient:u-recipient", readAt: null, createdAt: new Date()
    });
    prisma.notificationDelivery.upsert.mockResolvedValue({ id: "d-message" });

    await expect(service.createConversationMessageReceivedIfUnmuted(prisma, {
      conversationId: "conv-1",
      messageId: "message-1",
      recipientUserId: "u-recipient",
      recipientConversationId: "c1"
    })).resolves.toEqual({ queued: true });

    expect(prisma.notification.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        type: "messageReceived",
        title: "收到一条新消息",
        body: "打开 Talk&Talk 的平台内会话查看。",
        data: { conversationId: "c1" },
        eventKey: "conversation:conv-1:message:message-1:recipient:u-recipient"
      })
    }));
  });

  it("does not create an inbox item or delivery intent for a muted conversation", async () => {
    prisma.conversationBlock.findFirst.mockResolvedValue(null);
    prisma.conversationNotificationPreference.findUnique.mockResolvedValue({ mutedAt: new Date() });

    await expect(service.createConversationMessageReceivedIfUnmuted(prisma, {
      conversationId: "conv-1",
      messageId: "message-1",
      recipientUserId: "u-recipient",
      recipientConversationId: "c1"
    })).resolves.toEqual({ queued: false });

    expect(prisma.notification.upsert).not.toHaveBeenCalled();
    expect(prisma.notificationDelivery.upsert).not.toHaveBeenCalled();
  });

  it("does not create an inbox item or delivery intent after either side blocks the conversation", async () => {
    prisma.conversationBlock.findFirst.mockResolvedValue({ id: "block-1" });

    await expect(service.createConversationMessageReceivedIfUnmuted(prisma, {
      conversationId: "conv-1",
      messageId: "message-1",
      recipientUserId: "u-recipient",
      recipientConversationId: "c1"
    })).resolves.toEqual({ queued: false });

    expect(prisma.conversationNotificationPreference.findUnique).not.toHaveBeenCalled();
    expect(prisma.notification.upsert).not.toHaveBeenCalled();
    expect(prisma.notificationDelivery.upsert).not.toHaveBeenCalled();
  });
});
