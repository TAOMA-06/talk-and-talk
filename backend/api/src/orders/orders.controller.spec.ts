import { OrdersController } from "./orders.controller";

describe("OrdersController", () => {
  it("forwards an authenticated participant and order id to the voice authorization service", async () => {
    const expected = { roomId: "tt_voice_order", userSig: "ephemeral" };
    const voiceService = {
      issueRoomAccess: jest.fn().mockResolvedValue(expected)
    };
    const controller = new OrdersController({} as any, {} as any, voiceService as any);

    await expect(controller.voiceRoomAccess({ id: "customer-1" } as any, "order-1"))
      .resolves.toEqual(expected);
    expect(voiceService.issueRoomAccess).toHaveBeenCalledWith("customer-1", "order-1");
  });
});
