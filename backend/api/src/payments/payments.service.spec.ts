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
    companionAvailabilityWindow: {
      findFirst: jest.fn()
    },
    paymentTransaction: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn()
    },
    refundTransaction: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn()
    },
    supportTicket: { findUnique: jest.fn() },
    $queryRaw: jest.fn(),
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
    })),
    cancelPendingRescheduleRequest: jest.fn().mockResolvedValue(undefined)
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
    scheduledAt: new Date(Date.now() + 60 * 60_000),
    companionConfirmedAt: new Date(),
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
    prisma.paymentTransaction.updateMany.mockResolvedValue({ count: 1 });
    service = new PaymentsService(prisma, config, ordersService, wechat, notifications, audit, metrics);
  });

  it("reports the active provider mode for deployment readiness", () => {
    expect(service.status()).toEqual({
      module: "payments",
      status: "active",
      provider: "mock",
      productionReady: false
    });
  });

  it("warms WeChat platform certificates before a real provider accepts traffic", async () => {
    const provider = new MockWeChatPayProvider();
    Object.defineProperty(provider, "mode", { value: "real" });
    const ensurePlatformCertificates = jest.fn().mockResolvedValue(undefined);
    (provider as any).ensurePlatformCertificates = ensurePlatformCertificates;
    const bootService = new PaymentsService(
      prisma,
      config,
      ordersService,
      provider,
      notifications,
      audit,
      metrics
    );

    await expect(bootService.onModuleInit()).resolves.toBeUndefined();
    expect(ensurePlatformCertificates).toHaveBeenCalledTimes(1);
  });

  it("rejects a new completed-order refund after the immutable request window closes", async () => {
    const completedAt = new Date(Date.now() - 100 * 60 * 60_000);
    const db = {
      $queryRaw: jest.fn(),
      order: { findUnique: jest.fn().mockResolvedValue({
        ...baseOrder,
        status: "completed",
        completedAt,
        refundRequestDeadlineAt: new Date(Date.now() - 60_000)
      }) },
      refundTransaction: { findFirst: jest.fn().mockResolvedValue(null) }
    };
    prisma.$transaction.mockImplementation(async (fn: any) => fn(db));

    await expect(service.requestRefund("u1", "o1", "late request")).rejects.toMatchObject({
      code: "REFUND_REQUEST_WINDOW_CLOSED",
      status: HttpStatus.CONFLICT
    });
  });

  it("does not let a customer resubmit a failed provider refund", async () => {
    const failedRefund = {
      id: "r-failed",
      orderId: "o1",
      paymentId: "p1",
      outRefundNo: "R-failed",
      amountCents: 3900,
      status: "failed",
      reason: "用户申请",
      failureReason: "provider rejected",
      createdAt: new Date(),
      updatedAt: new Date()
    };
    prisma.$transaction.mockResolvedValueOnce({
      order: { ...baseOrder, status: "paid" },
      refund: failedRefund,
      created: false
    });
    const providerRetry = jest.spyOn(wechat, "createRefund");

    await expect(service.requestRefund("u1", "o1", "retry")).resolves.toEqual(expect.objectContaining({
      created: false,
      refund: expect.objectContaining({ id: "r-failed", status: "failed" })
    }));
    expect(providerRetry).not.toHaveBeenCalled();
    expect(prisma.refundTransaction.updateMany).not.toHaveBeenCalled();
  });

  it("cancels a pending reschedule inside the same transaction that creates a customer refund", async () => {
    const order = {
      ...baseOrder,
      status: "paid",
      companion: { ownerUserId: "u-companion" }
    };
    const refund = {
      id: "r-reschedule-cancel", orderId: order.id, paymentId: "p1", outRefundNo: "R-reschedule-cancel",
      amountCents: order.amountCents, status: "pending", reason: "改期协商终止后退款", createdAt: new Date(), updatedAt: new Date()
    };
    const db = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      order: { findUnique: jest.fn().mockResolvedValue(order) },
      refundTransaction: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(refund)
      },
      paymentTransaction: { findFirst: jest.fn().mockResolvedValue({ id: "p1", transactionId: "wx-txn-1" }) },
      companionEarning: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) }
    } as any;
    prisma.$transaction.mockImplementation(async (fn: any) => fn(db));
    jest.spyOn(service as any, "submitRefundToWechat").mockResolvedValue({
      refund: { id: refund.id, status: "processing" },
      order: ordersService.toDto(order)
    });

    await expect(service.requestRefund("u1", order.id, "改期协商终止后退款")).resolves.toEqual(expect.objectContaining({
      created: true,
      refund: expect.objectContaining({ id: refund.id })
    }));

    expect(ordersService.cancelPendingRescheduleRequest).toHaveBeenCalledWith(db, {
      order,
      actorId: "u1",
      actorRole: "customer",
      reason: "refund_requested"
    });
    expect(db.refundTransaction.create.mock.invocationCallOrder[0])
      .toBeLessThan(ordersService.cancelPendingRescheduleRequest.mock.invocationCallOrder[0]);
  });

  it("uses a system lifecycle cleanup when a refund is already in progress", async () => {
    const order = {
      ...baseOrder,
      status: "paid",
      companion: { ownerUserId: "u-companion" }
    };
    const existingRefund = {
      id: "r-existing-reschedule", orderId: order.id, paymentId: "p1", outRefundNo: "R-existing-reschedule",
      amountCents: order.amountCents, status: "processing", reason: "已有退款", createdAt: new Date(), updatedAt: new Date()
    };
    const db = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      order: { findUnique: jest.fn().mockResolvedValue(order) },
      refundTransaction: { findFirst: jest.fn().mockResolvedValue(existingRefund) },
      companionEarning: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) }
    } as any;
    prisma.$transaction.mockImplementation(async (fn: any) => fn(db));

    await expect(service.requestRefund("u1", order.id, "重复提交")).resolves.toEqual(expect.objectContaining({
      created: false,
      refund: expect.objectContaining({ id: existingRefund.id, status: "processing" })
    }));

    expect(ordersService.cancelPendingRescheduleRequest).toHaveBeenCalledWith(db, {
      order,
      actorId: null,
      actorRole: "system",
      reason: "refund_requested"
    });
    expect(db.refundTransaction.create).toBeUndefined();
  });

  it("rejects a refund query response bound to another provider refund number", async () => {
    prisma.refundTransaction.findFirst.mockResolvedValue({
      id: "r1",
      orderId: "o1",
      outRefundNo: "R-local",
      status: "processing"
    });
    jest.spyOn(wechat, "queryRefund").mockResolvedValueOnce({
      outRefundNo: "R-other",
      refundId: "wx-refund-other",
      status: "SUCCESS"
    });

    await expect(service.syncRefund("u1", "o1")).rejects.toMatchObject({
      code: "REFUND_BINDING_MISMATCH",
      status: HttpStatus.BAD_GATEWAY
    });
  });

  it("lets an administrator query a stale submitted refund with an audit trail", async () => {
    const refund = {
      id: "r-stale",
      orderId: "o1",
      outRefundNo: "R-stale",
      amountCents: 3900,
      status: "processing",
      reason: "用户申请",
      providerRefundId: null,
      reviewNote: null,
      failureReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      order: { ...baseOrder, status: "paid" }
    };
    prisma.refundTransaction.findUnique
      .mockResolvedValueOnce(refund)
      .mockResolvedValueOnce({ ...refund, status: "success" });
    jest.spyOn(wechat, "queryRefund").mockResolvedValueOnce({
      outRefundNo: "R-stale",
      refundId: "wx-refund-stale",
      status: "SUCCESS"
    });
    const apply = jest.spyOn(service as any, "applyRefundResult").mockResolvedValue(undefined);

    await expect(service.syncRefundForAdmin("admin-1", "r-stale")).resolves.toEqual(expect.objectContaining({
      refund: expect.objectContaining({ id: "r-stale", status: "success" })
    }));
    expect(apply).toHaveBeenCalledWith("r-stale", "SUCCESS", "wx-refund-stale", true);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      actorId: "admin-1",
      action: "refund.provider_sync_requested",
      resourceId: "r-stale"
    }));
  });

  it("recovers pending and authoritatively absent processing refunds with the same refund id", async () => {
    const dueAt = new Date(Date.now() - 60_000);
    const claimedAt = new Date();
    prisma.refundTransaction.findMany
      .mockResolvedValueOnce([{ id: "r-pending" }])
      .mockResolvedValueOnce([{
        id: "r-processing",
        outRefundNo: "R-processing",
        status: "processing",
        nextReconcileAt: dueAt
      }]);
    prisma.refundTransaction.updateMany.mockResolvedValue({ count: 1 });
    prisma.refundTransaction.findUnique.mockResolvedValue({
      id: "r-processing",
      outRefundNo: "R-processing",
      status: "processing",
      updatedAt: claimedAt,
      providerQueryAttempts: 0
    });
    jest.spyOn(wechat, "queryRefund").mockResolvedValueOnce({
      outRefundNo: "R-processing",
      refundId: "",
      status: "NOTEXIST"
    });
    const submit = jest.spyOn(service as any, "submitRefundToWechat").mockResolvedValue({});

    await expect(service.reconcileStaleRefunds(25)).resolves.toEqual({
      scanned: 2,
      submissions: 2,
      queries: 1,
      failures: 0
    });
    expect(submit).toHaveBeenNthCalledWith(1, "r-pending");
    expect(submit).toHaveBeenNthCalledWith(2, "r-processing");
    expect(prisma.refundTransaction.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: "r-processing",
        status: "processing",
        updatedAt: claimedAt
      }),
      data: expect.objectContaining({ status: "pending", providerQueryAttempts: 0 })
    }));
  });

  it("keeps a failed refund behind the explicit audited retry gate when WeChat reports it absent", async () => {
    prisma.refundTransaction.updateMany.mockResolvedValue({ count: 1 });
    const submit = jest.spyOn(service as any, "submitRefundToWechat").mockResolvedValue({});

    await expect((service as any).applyQueriedRefundResult({
      id: "r-failed",
      outRefundNo: "R-failed",
      status: "failed",
      updatedAt: new Date()
    }, "NOTEXIST", "")).resolves.toEqual({ resubmitted: false });

    expect(submit).not.toHaveBeenCalled();
    expect(prisma.refundTransaction.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "r-failed", status: "failed" },
      data: expect.objectContaining({
        failureReason: expect.stringContaining("explicit audited retry")
      })
    }));
  });

  it("persists a provider binding mismatch and backs off the refund query", async () => {
    const dueAt = new Date(Date.now() - 60_000);
    prisma.refundTransaction.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: "r-mismatch",
        outRefundNo: "R-local",
        status: "processing",
        nextReconcileAt: dueAt
      }]);
    prisma.refundTransaction.updateMany.mockResolvedValue({ count: 1 });
    prisma.refundTransaction.findUnique
      .mockResolvedValueOnce({
        id: "r-mismatch",
        outRefundNo: "R-local",
        status: "processing",
        updatedAt: new Date(),
        providerQueryAttempts: 0
      })
      .mockResolvedValueOnce({ status: "processing", providerQueryAttempts: 0 });
    jest.spyOn(wechat, "queryRefund").mockResolvedValueOnce({
      outRefundNo: "R-other",
      refundId: "wx-other",
      status: "SUCCESS"
    });

    await expect(service.reconcileStaleRefunds(1)).resolves.toEqual({
      scanned: 1,
      submissions: 0,
      queries: 1,
      failures: 1
    });
    expect(prisma.refundTransaction.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { id: "r-mismatch", status: "processing" },
      data: expect.objectContaining({
        providerQueryAttempts: 1,
        nextReconcileAt: expect.any(Date),
        failureReason: expect.stringContaining("binding rejected")
      })
    }));
  });

  it("routes an assigned support exception through the reviewed refund path", async () => {
    prisma.supportTicket.findUnique.mockResolvedValue({ id: "ticket-1", userId: "u1", orderId: "o1" });
    const requestRefund = jest.spyOn(service, "requestRefund").mockResolvedValue({ created: true } as any);

    await expect(service.requestSupportRefund("admin-1", "ticket-1", "履约争议复核后同意退款"))
      .resolves.toEqual({ created: true });
    expect(requestRefund).toHaveBeenCalledWith(
      "u1",
      "o1",
      "履约争议复核后同意退款",
      {
        actorId: "admin-1",
        requestId: "ticket-1",
        reasonCode: "SUPPORT_APPROVED_AFTER_WINDOW"
      }
    );
  });

  it("bypasses the self-service deadline only for the active support assignee and preserves ticket evidence", async () => {
    const completedAt = new Date(Date.now() - 10 * 24 * 60 * 60_000);
    const order = {
      ...baseOrder,
      status: "completed",
      completedAt,
      refundRequestDeadlineAt: new Date(Date.now() - 7 * 24 * 60 * 60_000)
    };
    const refund = {
      id: "refund-support-1",
      orderId: "o1",
      paymentId: "p1",
      outRefundNo: "R-SUPPORT-1",
      amountCents: 3900,
      status: "pendingReview",
      reason: "履约争议复核后同意退款",
      providerRefundId: null,
      initiatedById: "admin-1",
      supportTicketId: "ticket-1",
      exceptionReasonCode: "SUPPORT_APPROVED_AFTER_WINDOW",
      reviewNote: null,
      failureReason: null,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    const db = {
      $queryRaw: jest.fn(),
      order: { findUnique: jest.fn().mockResolvedValue(order) },
      supportTicket: { findUnique: jest.fn().mockResolvedValue({
        id: "ticket-1",
        orderId: "o1",
        userId: "u1",
        status: "inProgress",
        assignedToUserId: "admin-1"
      }) },
      refundTransaction: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(refund)
      },
      paymentTransaction: { findFirst: jest.fn().mockResolvedValue({ id: "p1", transactionId: "wx-txn-1" }) },
      companionEarning: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) }
    } as any;
    prisma.$transaction.mockImplementation(async (fn: any) => fn(db));

    const result = await service.requestRefund(
      "u1",
      "o1",
      "履约争议复核后同意退款",
      { actorId: "admin-1", requestId: "ticket-1", reasonCode: "SUPPORT_APPROVED_AFTER_WINDOW" }
    );

    expect(result.created).toBe(true);
    expect(result.refund).toEqual(expect.objectContaining({
      status: "pendingReview"
    }));
    expect(db.refundTransaction.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "pendingReview",
        initiatedById: "admin-1",
        supportTicketId: "ticket-1",
        exceptionReasonCode: "SUPPORT_APPROVED_AFTER_WINDOW"
      })
    }));
  });

  it("requires a different administrator to review a staff-initiated refund", async () => {
    const db = {
      $queryRaw: jest.fn(),
      refundTransaction: {
        findUnique: jest.fn().mockResolvedValue({
          id: "refund-support-1",
          status: "pendingReview",
          initiatedById: "admin-1",
          order: { id: "o1" }
        })
      }
    } as any;
    prisma.$transaction.mockImplementation(async (fn: any) => fn(db));

    await expect(service.approveRefund("admin-1", "refund-support-1"))
      .rejects.toMatchObject({ code: "REFUND_SECOND_REVIEW_REQUIRED", status: HttpStatus.FORBIDDEN });
  });

  it("refuses the mock payment callback whenever the active provider is real", async () => {
    const realProvider = { isMock: false, mode: "real" } as any;
    const realService = new PaymentsService(
      prisma,
      config,
      ordersService,
      realProvider,
      notifications,
      audit,
      metrics
    );

    await expect(realService.mockNotify("u1", { outTradeNo: "T100" })).rejects.toMatchObject({
      code: "MOCK_PAY_DISABLED",
      status: HttpStatus.FORBIDDEN
    });
    expect(prisma.paymentTransaction.findUnique).not.toHaveBeenCalled();
  });

  it("reconciles paid orders whose service window has elapsed", async () => {
    prisma.$queryRaw.mockResolvedValue([{ id: "o-expired" }]);
    prisma.order.findUnique.mockResolvedValue({
      id: "o-expired",
      userId: "u1",
      status: "paid",
      scheduledAt: new Date(Date.now() - 2 * 60 * 60_000),
      durationMinutes: 30
    });
    const refund = jest.spyOn(service, "requestRefund").mockResolvedValue({} as any);

    await expect(service.reconcileExpiredServiceWindows(10)).resolves.toEqual({
      scanned: 1,
      refundAttempts: 1,
      failures: 0
    });
    expect(refund).toHaveBeenCalledWith(
      "u1",
      "o-expired",
      "支付回调到达时预约服务窗口已结束，系统自动原路退款"
    );
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
      }),
      expect.anything()
    );
    expect(notifications.create).toHaveBeenCalledWith(
      "u1",
      "paymentSuccess",
      "支付成功",
      "订单已支付，平台内沟通已开启。",
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

  it("commits the local trade number before WeChat and preserves an ambiguous failed create", async () => {
    const pendingOrder = { ...baseOrder, status: "pending" };
    const createLocal = jest.fn().mockResolvedValue({
      id: "p-ambiguous",
      orderId: "o1",
      outTradeNo: "T-ambiguous",
      status: "initiated"
    });
    prisma.$transaction.mockImplementationOnce(async (fn: any) => fn({
      $queryRaw: jest.fn().mockResolvedValue([]),
      paymentTransaction: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: createLocal
      },
      order: {
        findUnique: jest.fn().mockResolvedValue(pendingOrder),
        update: jest.fn().mockResolvedValue({ ...pendingOrder, status: "paying" })
      }
    }));
    const createRemote = jest.spyOn(wechat, "createAppPrepay")
      .mockRejectedValueOnce(new Error("socket timed out after submit"));
    const closeRemote = jest.spyOn(wechat, "closePayment");

    await expect(service.prepay("u1", "o1", "app")).rejects.toThrow("socket timed out after submit");

    expect(createLocal).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ outTradeNo: expect.stringMatching(/^T/), status: "initiated" })
    }));
    expect(createLocal.mock.invocationCallOrder[0]).toBeLessThan(createRemote.mock.invocationCallOrder[0]);
    expect(closeRemote).not.toHaveBeenCalled();
    expect(prisma.paymentTransaction.updateMany).not.toHaveBeenCalled();
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

  it("queries every expired durable prepay and only closes authoritative unpaid state", async () => {
    prisma.paymentTransaction.findMany.mockResolvedValue([
      { id: "p-paid", outTradeNo: "T-paid", orderId: "o-paid" },
      { id: "p-unpaid", outTradeNo: "T-unpaid", orderId: "o-unpaid" }
    ]);
    const query = jest.spyOn(wechat, "queryPayment")
      .mockResolvedValueOnce({
        appId: "wx-mini-app",
        mchId: "1900000000",
        outTradeNo: "T-paid",
        transactionId: "wx-paid",
        tradeState: "SUCCESS",
        amountCents: 3900,
        currency: "CNY",
        raw: {}
      })
      .mockResolvedValueOnce({
        appId: "",
        mchId: "",
        outTradeNo: "T-unpaid",
        transactionId: "",
        tradeState: "NOTEXIST",
        amountCents: 0,
        currency: "",
        raw: {}
      });
    const fulfill = jest.spyOn(service as any, "fulfillPayment").mockResolvedValue({ data: { orderId: "o-paid" } });
    const refundExpired = jest.spyOn(service as any, "refundIfServiceWindowExpired").mockResolvedValue(false);
    const reconcileClosed = jest.spyOn(service as any, "reconcileRemotelyClosedPrepay").mockResolvedValue(undefined);
    const close = jest.spyOn(wechat, "closePayment");

    await expect(service.reconcileExpiredPrepays(25)).resolves.toEqual({
      scanned: 2,
      paidRecovered: 1,
      closed: 1,
      failures: 0
    });
    expect(query).toHaveBeenCalledTimes(2);
    expect(fulfill).toHaveBeenCalledWith(expect.objectContaining({ outTradeNo: "T-paid" }));
    expect(refundExpired).toHaveBeenCalledWith("o-paid");
    expect(close).toHaveBeenCalledWith("T-unpaid");
    expect(reconcileClosed).toHaveBeenCalledWith({ id: "p-unpaid", outTradeNo: "T-unpaid", orderId: "o-unpaid" });
  });

  it("keeps an unexpectedly refunded orphan prepay visible for manual reconciliation", async () => {
    prisma.paymentTransaction.findMany.mockResolvedValue([
      { id: "p-refund", outTradeNo: "T-refund", orderId: "o-refund" }
    ]);
    jest.spyOn(wechat, "queryPayment").mockResolvedValueOnce({
      appId: "wx-mini-app",
      mchId: "1900000000",
      outTradeNo: "T-refund",
      transactionId: "wx-refund",
      tradeState: "REFUND",
      amountCents: 3900,
      currency: "CNY",
      raw: {}
    });
    const close = jest.spyOn(wechat, "closePayment");

    await expect(service.reconcileExpiredPrepays(1)).resolves.toEqual({
      scanned: 1,
      paidRecovered: 0,
      closed: 0,
      failures: 1
    });
    expect(close).not.toHaveBeenCalled();
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

  it("rechecks structured-window capacity before prepay", async () => {
    const scheduledAt = new Date(Math.ceil((Date.now() + 3 * 60 * 60_000) / (30 * 60_000)) * (30 * 60_000));
    const structuredOrder = {
      ...baseOrder,
      status: "pending",
      scheduledAt,
      availabilityWindowId: "window-1",
      availabilityWindowStartsAtSnapshot: new Date(scheduledAt.getTime() - 30 * 60_000),
      availabilityWindowEndsAtSnapshot: new Date(scheduledAt.getTime() + 60 * 60_000),
      availabilityWindowCapacitySnapshot: 1,
      paymentReservationExpiresAt: new Date(Date.now() + 10 * 60_000)
    };
    const createSpy = jest.spyOn(wechat, "createAppPrepay");
    prisma.$transaction.mockImplementation(async (fn: any) => fn({
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: "o-conflict" }])
        .mockResolvedValueOnce([]),
      companionAvailabilityWindow: {
        findFirst: jest.fn().mockResolvedValue({
          id: "window-1", companionId: "c1", startsAt: structuredOrder.availabilityWindowStartsAtSnapshot,
          endsAt: structuredOrder.availabilityWindowEndsAtSnapshot, capacity: 1, isActive: true
        })
      },
      order: {
        findUnique: jest.fn()
          .mockResolvedValueOnce(structuredOrder)
          .mockResolvedValueOnce({ ...baseOrder, id: "o-conflict", status: "paid", scheduledAt, payments: [] })
      },
      paymentTransaction: { findFirst: jest.fn(), create: jest.fn() }
    }));

    await expect(service.prepay("u1", "o1", "app")).rejects.toMatchObject({
      code: "COMPANION_SLOT_UNAVAILABLE",
      status: HttpStatus.CONFLICT,
      details: expect.objectContaining({ availabilityWindowId: "window-1", capacity: 1 })
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

  it("opens an uncertain-payout recovery when a refund succeeds after a manual payout claim", async () => {
    const recovery = { id: "recovery-1", amountCents: 3000, reason: "payoutStateUncertain" };
    const db = {
      companionEarning: {
        findUnique: jest.fn().mockResolvedValue({
          id: "earning-1",
          orderId: "o1",
          companionId: "c1",
          payableCents: 3000,
          status: "held",
          holdReason: "payout_execution_claimed",
          payoutSubmittedAt: new Date(),
          payoutSubmittedById: "admin-1",
          paidReference: null
        }),
        updateMany: jest.fn()
      },
      companionRecovery: { upsert: jest.fn().mockResolvedValue(recovery) }
    } as any;

    await expect((service as any).voidEarningForRefund(db, "o1", "refund-1")).resolves.toEqual(recovery);
    expect(db.companionRecovery.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        refundId: "refund-1",
        reason: "payoutStateUncertain",
        amountCents: 3000
      })
    }));
    expect(db.companionEarning.updateMany).not.toHaveBeenCalled();
  });
});
