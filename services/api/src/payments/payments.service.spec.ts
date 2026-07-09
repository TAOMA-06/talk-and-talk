import { HttpStatus } from "@nestjs/common";

import { AppException } from "../common/errors/app.exception";
import { MockWeChatPayProvider } from "./wechat/mock-wechat-pay.provider";
import { PaymentsService } from "./payments.service";

describe("PaymentsService", () => {
  const prisma = {
    order: {
      findUnique: jest.fn()
    },
    paymentTransaction: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn()
    },
    $transaction: jest.fn()
  } as any;

  const config = {
    getOrThrow: jest.fn((key: string) => {
      if (key === "NODE_ENV") return "test";
      if (key === "API_PREFIX") return "api/v1";
      throw new Error(`missing ${key}`);
    }),
    get: jest.fn()
  } as any;

  const ordersService = {
    toDto: jest.fn((order: any) => ({
      id: order.id,
      status: order.status,
      amountCents: order.amountCents,
      companionId: order.companionId
    }))
  } as any;

  const notifications = {
    create: jest.fn().mockResolvedValue({})
  } as any;

  const audit = {
    record: jest.fn().mockResolvedValue({})
  } as any;

  const wechat = new MockWeChatPayProvider();
  let service: PaymentsService;

  const baseOrder = {
    id: "o1",
    userId: "u1",
    companionId: "c1",
    themeId: "t1",
    durationMinutes: 30,
    amountCents: 3900,
    currency: "CNY",
    status: "paying",
    conversationId: null as string | null,
    paidAt: null,
    cancelledAt: null,
    completedAt: null,
    createdAt: new Date("2026-07-09T00:00:00.000Z"),
    updatedAt: new Date("2026-07-09T00:00:00.000Z")
  };

  const basePayment = {
    id: "p1",
    orderId: "o1",
    outTradeNo: "T100",
    provider: "wechat",
    amountCents: 3900,
    status: "initiated",
    prepayId: "mock_prepay_T100",
    transactionId: null as string | null,
    order: { ...baseOrder }
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PaymentsService(prisma, config, ordersService, wechat, notifications, audit);
  });

  it("fulfills mock notify: paying -> paid and activates conversation once", async () => {
    prisma.$transaction.mockImplementation(async (fn: any) => {
      const payment = {
        ...basePayment,
        status: "initiated",
        order: { ...baseOrder, status: "paying", conversationId: null }
      };
      const db = {
        paymentTransaction: {
          findUnique: jest.fn().mockResolvedValue(payment),
          update: jest.fn().mockResolvedValue({})
        },
        conversation: {
          findUnique: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({ id: "conv1", externalId: "c1" }),
          update: jest.fn().mockResolvedValue({})
        },
        message: {
          create: jest.fn().mockResolvedValue({})
        },
        order: {
          update: jest.fn().mockResolvedValue({})
        }
      };
      return fn(db);
    });

    const result = await service.handleWechatNotify(
      { "wechatpay-signature": "MOCK_OK" },
      JSON.stringify({
        out_trade_no: "T100",
        transaction_id: "wx_txn_1",
        trade_state: "SUCCESS",
        amount: { total: 3900 }
      })
    );

    expect(result.code).toBe("SUCCESS");
    expect(result.data.alreadyProcessed).toBe(false);
    expect(result.data.orderStatus).toBe("paid");
    expect(result.data.conversationCreated).toBe(true);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: "u1",
        action: "payment.fulfilled",
        resourceId: "o1"
      })
    );
    expect(notifications.create).toHaveBeenCalledWith(
      "u1",
      "paymentSuccess",
      "支付成功",
      "订单已支付，平台担保沟通已开启。",
      { orderId: "o1", status: "paid" }
    );
  });

  it("is idempotent on duplicate notify", async () => {
    prisma.$transaction.mockImplementation(async (fn: any) => {
      const payment = {
        ...basePayment,
        status: "success",
        transactionId: "wx_txn_1",
        order: { ...baseOrder, status: "paid", conversationId: "conv1" }
      };
      const db = {
        paymentTransaction: {
          findUnique: jest.fn().mockResolvedValue(payment),
          update: jest.fn()
        },
        conversation: {
          findUnique: jest.fn(),
          create: jest.fn(),
          update: jest.fn()
        },
        message: { create: jest.fn() },
        order: { update: jest.fn() }
      };
      return fn(db);
    });

    const result = await service.handleWechatNotify(
      { "wechatpay-signature": "MOCK_OK" },
      JSON.stringify({
        out_trade_no: "T100",
        transaction_id: "wx_txn_1",
        trade_state: "SUCCESS",
        amount: { total: 3900 }
      })
    );

    expect(result.data.alreadyProcessed).toBe(true);
    expect(result.data.conversationCreated).toBe(false);
    expect(audit.record).not.toHaveBeenCalled();
    expect(notifications.create).not.toHaveBeenCalled();
  });

  it("rejects amount mismatch", async () => {
    prisma.$transaction.mockImplementation(async (fn: any) => {
      const payment = {
        ...basePayment,
        status: "initiated",
        order: { ...baseOrder, status: "paying" }
      };
      const db = {
        paymentTransaction: {
          findUnique: jest.fn().mockResolvedValue(payment)
        }
      };
      return fn(db);
    });

    await expect(
      service.handleWechatNotify(
        { "wechatpay-signature": "MOCK_OK" },
        JSON.stringify({
          out_trade_no: "T100",
          transaction_id: "wx_txn_1",
          trade_state: "SUCCESS",
          amount: { total: 1 }
        })
      )
    ).rejects.toMatchObject({
      code: "PAYMENT_AMOUNT_MISMATCH",
      status: HttpStatus.BAD_REQUEST
    });
  });

  it("rejects invalid signature", async () => {
    await expect(
      service.handleWechatNotify(
        { "wechatpay-signature": "BAD" },
        JSON.stringify({ out_trade_no: "T100", amount: { total: 3900 }, trade_state: "SUCCESS" })
      )
    ).rejects.toBeInstanceOf(AppException);
  });
});
