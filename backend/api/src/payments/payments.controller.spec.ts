import { PaymentsController } from "./payments.controller";

describe("PaymentsController WeChat callbacks", () => {
  it("passes bounded refund queue pagination and filters to the service", async () => {
    const paymentsService = {
      listRefundsAwaitingReview: jest.fn().mockResolvedValue({
        items: [],
        pagination: { page: 2, pageSize: 25, total: 0, totalPages: 0 }
      })
    } as any;
    const controller = new PaymentsController(paymentsService);

    await expect(controller.refundReviewQueue({
      page: 2,
      pageSize: 25,
      status: "failed"
    })).resolves.toEqual(expect.objectContaining({ items: [] }));
    expect(paymentsService.listRefundsAwaitingReview).toHaveBeenCalledWith(2, 25, "failed");
  });

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
