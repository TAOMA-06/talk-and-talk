import { OrdersController } from "./orders.controller";

describe("OrdersController", () => {
  it("forwards the authenticated participant to the role-aware order detail service", async () => {
    const expected = { id: "order-1", viewerRole: "companion" };
    const ordersService = { get: jest.fn().mockResolvedValue(expected) };
    const controller = new OrdersController(ordersService as any, {} as any, {} as any, { getOrThrow: () => "development" } as any);

    await expect(controller.get({ id: "companion-owner-1" } as any, "order-1"))
      .resolves.toEqual(expected);
    expect(ordersService.get).toHaveBeenCalledWith("companion-owner-1", "order-1");
  });

  it("forwards an authenticated participant and order id to the voice authorization service", async () => {
    const expected = { roomId: "tt_voice_order", userSig: "ephemeral" };
    const voiceService = {
      issueRoomAccess: jest.fn().mockResolvedValue(expected)
    };
    const controller = new OrdersController({} as any, {} as any, voiceService as any, { getOrThrow: () => "development" } as any);

    await expect(controller.voiceRoomAccess({ id: "customer-1" } as any, "order-1"))
      .resolves.toEqual(expected);
    expect(voiceService.issueRoomAccess).toHaveBeenCalledWith("customer-1", "order-1");
  });

  it("forwards validated timeline pagination to the order service", async () => {
    const expected = { orderId: "order-1", items: [], pagination: { page: 2, pageSize: 10, total: 0, totalPages: 0 } };
    const ordersService = { timeline: jest.fn().mockResolvedValue(expected) };
    const controller = new OrdersController(ordersService as any, {} as any, {} as any, { getOrThrow: () => "development" } as any);

    await expect(controller.timeline(
      { id: "customer-1" } as any,
      "order-1",
      { page: 2, pageSize: 10 }
    )).resolves.toEqual(expected);
    expect(ordersService.timeline).toHaveBeenCalledWith(
      "customer-1",
      "order-1",
      { page: 2, pageSize: 10 }
    );
  });

  it("forwards the authenticated customer and order id to the refund-sync service", async () => {
    const expected = { refund: { id: "refund-1", status: "processing" }, order: { id: "order-1" } };
    const paymentsService = { syncRefund: jest.fn().mockResolvedValue(expected) };
    const controller = new OrdersController(
      {} as any,
      paymentsService as any,
      {} as any,
      { getOrThrow: () => "development" } as any
    );

    await expect(controller.syncRefund({ id: "customer-1" } as any, "order-1"))
      .resolves.toEqual(expected);
    expect(paymentsService.syncRefund).toHaveBeenCalledWith("customer-1", "order-1");
  });
});
