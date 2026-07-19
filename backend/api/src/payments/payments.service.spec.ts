import { HttpStatus } from "@nestjs/common";

import { AppException } from "../common/errors/app.exception";
import { MockWeChatPayProvider } from "./wechat/mock-wechat-pay.provider";
import { PaymentsService } from "./payments.service";

describe("PaymentsService", () => {
  const prisma = {
    authIdentity: {
      findFirst: jest.fn()
    },
    order: {
      findUnique: jest.fn()
    },
    paymentTransaction: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn()
    },
    refundTransaction: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn()
    },
    $transaction: jest.fn()
  } as any;

  const metrics = {
    recordWechatNotifyFailure: jest.fn(),
    recordWechatNotifySuccess: jest.fn()
  } as any;

  const config = {
    getOrThrow: jest.fn((key: string) => {
      if (key === "APP_ENV") return "staging";
      if (key === "API_PREFIX") return "api/v1";
      throw new Error(`missing ${key}`);
    }),
    get: jest.fn((key: string, fallback?: string) => {
      if (key === "WECHAT_MINIPROGRAM_APP_ID") return "wx-mini-app";
      if (key === "WECHAT_PAY_APP_ID") return "wx-app";
      if (key === "WECHAT_PAY_MCH_ID") return "1900000000";
      return fallback;
    })
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
    scheduledAt: new Date("2026-07-20T10:00:00.000Z"),
    companionConfirmedAt: new Date("2026-07-19T10:00:00.000Z"),
    companion: {
      owner: {
        accountStatus: "active",
        profile: { isVerified: true }
      }
    },
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
    expiresAt: new Date(Date.now() + 10 * 60_000),
    createdAt: new Date(),
    order: { ...baseOrder }
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.order.findUnique.mockResolvedValue(baseOrder);
    prisma.paymentTransaction.findUnique.mockResolvedValue({ orderId: "o1" });
    service = new PaymentsService(prisma, config, ordersService, wechat, notifications, audit, metrics);
  });

  it("fulfills mock notify: paying -> paid and activates conversation once", async () => {
    prisma.$transaction.mockImplementation(async (fn: any) => {
      const payment = {
        ...basePayment,
        status: "initiated",
        order: { ...baseOrder, status: "paying", conversationId: null }
      };
      const db = {
        $queryRaw: jest.fn().mockResolvedValue([]),
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
        appid: "wx-mini-app",
        mchid: "1900000000",
        out_trade_no: "T100",
        transaction_id: "wx_txn_1",
        trade_state: "SUCCESS",
        amount: { total: 3900, currency: "CNY" }
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
        $queryRaw: jest.fn().mockResolvedValue([]),
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
        appid: "wx-mini-app",
        mchid: "1900000000",
        out_trade_no: "T100",
        transaction_id: "wx_txn_1",
        trade_state: "SUCCESS",
        amount: { total: 3900, currency: "CNY" }
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
        $queryRaw: jest.fn().mockResolvedValue([]),
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
          appid: "wx-mini-app",
          mchid: "1900000000",
          out_trade_no: "T100",
          transaction_id: "wx_txn_1",
          trade_state: "SUCCESS",
          amount: { total: 1, currency: "CNY" }
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

  it.each([
    ["appid", "wx-other-app", "WECHAT_APP_ID_MISMATCH"],
    ["mchid", "other-merchant", "WECHAT_MCH_ID_MISMATCH"]
  ])("rejects a payment notify with the wrong %s", async (field, value, code) => {
    await expect(service.handleWechatNotify(
      { "wechatpay-signature": "MOCK_OK" },
      JSON.stringify({
        appid: "wx-mini-app",
        mchid: "1900000000",
        out_trade_no: "T100",
        transaction_id: "wx_txn_1",
        trade_state: "SUCCESS",
        amount: { total: 3900, currency: "CNY" },
        [field]: value
      })
    )).rejects.toMatchObject({ code, status: HttpStatus.BAD_REQUEST });
  });

  it("rejects a payment notify with the wrong currency", async () => {
    await expect(service.handleWechatNotify(
      { "wechatpay-signature": "MOCK_OK" },
      JSON.stringify({
        appid: "wx-mini-app",
        mchid: "1900000000",
        out_trade_no: "T100",
        transaction_id: "wx_txn_1",
        trade_state: "SUCCESS",
        amount: { total: 3900, currency: "USD" }
      })
    )).rejects.toMatchObject({ code: "PAYMENT_CURRENCY_MISMATCH", status: HttpStatus.BAD_REQUEST });
  });

  it("rejects a transaction id that conflicts with the local payment binding", async () => {
    prisma.$transaction.mockImplementation(async (fn: any) => fn({
      $queryRaw: jest.fn().mockResolvedValue([]),
      paymentTransaction: {
        findUnique: jest.fn()
          .mockResolvedValueOnce({ ...basePayment, transactionId: "wx_original_txn" })
          .mockResolvedValueOnce(null)
      }
    }));

    await expect(service.handleWechatNotify(
      { "wechatpay-signature": "MOCK_OK" },
      JSON.stringify({
        appid: "wx-mini-app",
        mchid: "1900000000",
        out_trade_no: "T100",
        transaction_id: "wx_different_txn",
        trade_state: "SUCCESS",
        amount: { total: 3900, currency: "CNY" }
      })
    )).rejects.toMatchObject({ code: "PAYMENT_TRANSACTION_MISMATCH", status: HttpStatus.BAD_REQUEST });
  });

  it("rejects a refund notify whose amount is not bound to the local refund", async () => {
    prisma.refundTransaction.findUnique.mockResolvedValue({
      id: "r1",
      orderId: "o1",
      paymentId: "p1",
      outRefundNo: "R100",
      amountCents: 3900,
      providerRefundId: null,
      payment: { ...basePayment, transactionId: "wx_txn_1" },
      order: { ...baseOrder }
    });

    await expect(service.handleWechatRefundNotify(
      { "wechatpay-signature": "MOCK_OK" },
      JSON.stringify({
        appid: "wx-mini-app",
        mchid: "1900000000",
        out_trade_no: "T100",
        transaction_id: "wx_txn_1",
        out_refund_no: "R100",
        refund_id: "wx_refund_1",
        status: "SUCCESS",
        amount: { total: 3900, refund: 1, currency: "CNY" }
      })
    )).rejects.toMatchObject({ code: "REFUND_AMOUNT_MISMATCH", status: HttpStatus.BAD_REQUEST });
  });

  it("rejects a refund notify whose transaction is not bound to the local payment", async () => {
    prisma.refundTransaction.findUnique.mockResolvedValue({
      id: "r1",
      orderId: "o1",
      paymentId: "p1",
      outRefundNo: "R100",
      amountCents: 3900,
      providerRefundId: null,
      payment: { ...basePayment, transactionId: "wx_txn_1" },
      order: { ...baseOrder }
    });

    await expect(service.handleWechatRefundNotify(
      { "wechatpay-signature": "MOCK_OK" },
      JSON.stringify({
        appid: "wx-mini-app",
        mchid: "1900000000",
        out_trade_no: "T100",
        transaction_id: "wx_other_txn",
        out_refund_no: "R100",
        refund_id: "wx_refund_1",
        status: "SUCCESS",
        amount: { total: 3900, refund: 3900, currency: "CNY" }
      })
    )).rejects.toMatchObject({ code: "REFUND_BINDING_MISMATCH", status: HttpStatus.BAD_REQUEST });
  });

  it("creates Mini Program params only for a user with a WeChat identity", async () => {
    const pendingOrder = { ...baseOrder, status: "pending" };
    prisma.authIdentity.findFirst.mockResolvedValue({ providerId: "openid-1" });
    prisma.$transaction.mockImplementation(async (fn: any) => fn({
      $queryRaw: jest.fn().mockResolvedValue([]),
      paymentTransaction: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: "p2", outTradeNo: "T200", status: "initiated" })
      },
      order: {
        findUnique: jest.fn().mockResolvedValue(pendingOrder),
        update: jest.fn().mockResolvedValue({ ...pendingOrder, status: "paying" })
      }
    }));

    const result = await service.prepay("u1", "o1", "miniProgram");

    expect(result.payment.channel).toBe("miniProgram");
    expect(result.payment.wechatMiniProgramParams).toEqual(expect.objectContaining({ package: expect.stringMatching(/^prepay_id=/) }));
    expect(result.payment.wechatAppParams).toBeUndefined();
  });

  it("reuses an initiated prepay instead of creating another WeChat order", async () => {
    const clientParams = {
      timeStamp: "1",
      nonceStr: "n",
      package: "prepay_id=existing",
      signType: "RSA",
      paySign: "sig"
    };
    const createSpy = jest.spyOn(wechat, "createMiniProgramPrepay");
    prisma.$transaction.mockImplementation(async (fn: any) => fn({
      $queryRaw: jest.fn().mockResolvedValue([]),
      paymentTransaction: {
        findFirst: jest.fn().mockResolvedValue({
          ...basePayment,
          clientParams,
          outTradeNo: "T-existing"
        }),
        create: jest.fn()
      },
      order: {
        findUnique: jest.fn().mockResolvedValue({ ...baseOrder, status: "paying" }),
        update: jest.fn()
      }
    }));

    const result = await service.prepay("u1", "o1", "miniProgram");

    expect(result.payment.outTradeNo).toBe("T-existing");
    expect(result.payment.wechatMiniProgramParams).toEqual(clientParams);
    expect(createSpy).not.toHaveBeenCalled();
  });

  it("closes an expired prepay at WeChat before creating a replacement", async () => {
    const pendingOrder = { ...baseOrder, status: "paying" };
    const closeSpy = jest.spyOn(wechat, "closePayment");
    const createSpy = jest.spyOn(wechat, "createAppPrepay");
    let transactionCount = 0;
    prisma.$transaction.mockImplementation(async (fn: any) => {
      transactionCount += 1;
      return fn({
      $queryRaw: jest.fn().mockResolvedValue([]),
      paymentTransaction: {
        findFirst: jest.fn().mockResolvedValue(transactionCount === 1 ? {
            ...basePayment,
            outTradeNo: "T-expired",
            expiresAt: new Date(Date.now() - 1)
          } : null),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue({
          id: "p-new",
          outTradeNo: "T-new",
          status: "initiated"
        })
      },
      order: {
        findUnique: jest.fn().mockResolvedValue(transactionCount === 1
          ? pendingOrder
          : { ...pendingOrder, status: "pending" }),
        update: jest.fn().mockResolvedValue(transactionCount === 1
          ? { ...pendingOrder, status: "pending" }
          : pendingOrder)
      }
      });
    });

    const result = await service.prepay("u1", "o1", "app");

    expect(closeSpy).toHaveBeenCalledWith("T-expired");
    expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({ expiresAt: expect.any(Date) }));
    expect(result.payment.outTradeNo).toBe("T-new");
  });

  it("rejects an overlapping companion slot before calling WeChat", async () => {
    const createSpy = jest.spyOn(wechat, "createAppPrepay");
    prisma.$transaction.mockImplementation(async (fn: any) => fn({
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: "o-conflict" }])
        .mockResolvedValueOnce([]),
      order: {
        findUnique: jest.fn()
          .mockResolvedValueOnce({ ...baseOrder, status: "pending" })
          .mockResolvedValueOnce({
            ...baseOrder,
            id: "o-conflict",
            status: "paid",
            payments: []
          })
      },
      paymentTransaction: { findFirst: jest.fn(), create: jest.fn() }
    }));

    await expect(service.prepay("u1", "o1", "app")).rejects.toMatchObject({
      code: "COMPANION_SLOT_UNAVAILABLE",
      status: HttpStatus.CONFLICT
    });
    expect(createSpy).not.toHaveBeenCalled();
  });

  it("rejects prepay until an active verified companion confirms the order", async () => {
    const createSpy = jest.spyOn(wechat, "createAppPrepay");
    prisma.$transaction.mockImplementation(async (fn: any) => fn({
      $queryRaw: jest.fn().mockResolvedValue([]),
      order: {
        findUnique: jest.fn().mockResolvedValue({
          ...baseOrder,
          status: "pending",
          companionConfirmedAt: null
        })
      }
    }));

    await expect(service.prepay("u1", "o1", "app")).rejects.toMatchObject({
      code: "ORDER_NOT_CONFIRMED",
      status: HttpStatus.CONFLICT
    });
    expect(createSpy).not.toHaveBeenCalled();
  });

  it.each(["closed", "failed"])("rejects a %s payment callback without reviving the order", async (status) => {
    prisma.$transaction.mockImplementation(async (fn: any) => fn({
      $queryRaw: jest.fn().mockResolvedValue([]),
      paymentTransaction: {
        findUnique: jest.fn()
          .mockResolvedValueOnce({ ...basePayment, status, order: { ...baseOrder, status: "paying" } })
          .mockResolvedValueOnce(null)
      }
    }));

    await expect(service.handleWechatNotify(
      { "wechatpay-signature": "MOCK_OK" },
      JSON.stringify({
        appid: "wx-mini-app",
        mchid: "1900000000",
        out_trade_no: "T100",
        transaction_id: "wx_stale_txn",
        trade_state: "SUCCESS",
        amount: { total: 3900, currency: "CNY" }
      })
    )).rejects.toMatchObject({ code: "PAYMENT_INVALID_STATE", status: HttpStatus.CONFLICT });
  });

  it("keeps an ambiguous refund submission processing and never creates a new attempt on retry", async () => {
    const refund = {
      id: "r1",
      orderId: "o1",
      paymentId: "p1",
      outRefundNo: "R100",
      amountCents: 3900,
      status: "processing",
      reason: "用户申请",
      providerRefundId: null,
      reviewNote: null,
      failureReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      payment: { ...basePayment, transactionId: "wx_txn_1" },
      order: { ...baseOrder, status: "paid" }
    };
    prisma.refundTransaction.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    prisma.refundTransaction.findUnique.mockResolvedValue(refund);
    prisma.refundTransaction.update.mockResolvedValue(refund);
    const createRefund = jest.spyOn(wechat, "createRefund")
      .mockRejectedValueOnce(new Error("socket closed after submit"));

    await expect((service as any).submitRefundToWechat("r1"))
      .rejects.toThrow("socket closed after submit");
    expect(prisma.refundTransaction.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "r1", status: "processing" },
      data: expect.objectContaining({
        failureReason: expect.stringContaining("outcome unknown")
      })
    }));

    await expect((service as any).submitRefundToWechat("r1")).resolves.toEqual(expect.objectContaining({
      refund: expect.objectContaining({ outRefundNo: "R100", status: "processing" })
    }));
    expect(createRefund).toHaveBeenCalledTimes(1);
  });
});
