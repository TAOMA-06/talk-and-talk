import { PaymentsController } from "./payments.controller";

describe("PaymentsController WeChat callbacks", () => {
  it("writes the payment success acknowledgement as the raw WeChat response", async () => {
    const paymentsService = {
      handleWechatNotify: jest.fn().mockResolvedValue({ code: "SUCCESS", message: "成功" })
    } as any;
    const controller = new PaymentsController(paymentsService);
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    } as any;

    await controller.wechatNotify(
      { body: { id: "event-1" } } as any,
      { "wechatpay-signature": "signature" },
      response
    );

    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith({ code: "SUCCESS", message: "成功" });
  });

  it("writes the refund success acknowledgement as the raw WeChat response", async () => {
    const paymentsService = {
      handleWechatRefundNotify: jest.fn().mockResolvedValue({ code: "SUCCESS", message: "成功" })
    } as any;
    const controller = new PaymentsController(paymentsService);
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    } as any;

    await controller.refundNotify(
      { body: { id: "event-2" } } as any,
      { "wechatpay-signature": "signature" },
      response
    );

    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith({ code: "SUCCESS", message: "成功" });
  });
});
