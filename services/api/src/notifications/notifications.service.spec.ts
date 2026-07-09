import { NotificationsService } from "./notifications.service";

describe("NotificationsService", () => {
  const prisma = {
    notification: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn()
    }
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
});
