import { AccountGovernanceService } from "./account-governance.service";

const mockPrisma = {
  refreshToken: {
    count: jest.fn(),
    findMany: jest.fn(),
    updateMany: jest.fn()
  },
  dataRightsRequest: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
    updateMany: jest.fn(),
    findUnique: jest.fn(),
    findUniqueOrThrow: jest.fn()
  },
  dataRightsRequestFollowUp: {
    create: jest.fn()
  },
  invoiceRequest: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    count: jest.fn(),
    updateMany: jest.fn(),
    findUniqueOrThrow: jest.fn()
  },
  order: {
    findMany: jest.fn(),
    count: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn()
  },
  $queryRaw: jest.fn(),
  $transaction: jest.fn()
};

const mockAudit = {
  record: jest.fn()
};

function expectActorOnlyAudit(action: string, actorId: string) {
  const auditInput = mockAudit.record.mock.calls.find(
    ([input]) => input.action === action
  )?.[0];

  expect(auditInput).toEqual(expect.objectContaining({ action, actorId }));
  expect(auditInput).not.toHaveProperty("subjectUserIds");
}

const date = (iso: string) => new Date(iso);

function dataRightsRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "rights-1",
    userId: "user-1",
    type: "export",
    status: "submitted",
    description: "请提供我的账户数据副本",
    statusReason: null,
    handledById: null,
    handledAt: null,
    resolvedAt: null,
    resolutionEvidenceReference: null,
    followUps: [],
    createdAt: date("2026-07-31T08:00:00.000Z"),
    updatedAt: date("2026-07-31T08:00:00.000Z"),
    ...overrides
  };
}

function invoiceRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "invoice-1",
    userId: "user-1",
    orderId: "2c42fb2c-8d75-4d65-8267-74d2da4f1391",
    paymentTransactionId: "payment-1",
    status: "submitted",
    invoiceTitle: "上海示例科技有限公司",
    amountCents: 12800,
    currency: "CNY",
    paymentPaidAt: date("2026-07-30T08:00:00.000Z"),
    serviceTitleSnapshot: "30 分钟语音陪伴",
    serviceDeliveryModeSnapshot: "voice",
    serviceDurationMinutesSnapshot: 30,
    companionNameSnapshot: "陪伴者",
    statusReason: null,
    handledById: null,
    handledAt: null,
    issuedAt: null,
    voidedAt: null,
    cancelledAt: null,
    issuanceEvidenceReference: null,
    voidEvidenceReference: null,
    createdAt: date("2026-07-31T08:00:00.000Z"),
    updatedAt: date("2026-07-31T08:00:00.000Z"),
    ...overrides
  };
}

function paidOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: "2c42fb2c-8d75-4d65-8267-74d2da4f1391",
    userId: "user-1",
    status: "completed",
    amountCents: 12800,
    currency: "CNY",
    serviceOfferingTitleSnapshot: "30 分钟语音陪伴",
    serviceOfferingDeliveryModeSnapshot: "voice",
    serviceOfferingDurationSnapshot: 30,
    durationMinutes: 30,
    themeNameSnapshot: "倾听陪伴",
    companionNameSnapshot: "陪伴者",
    payments: [
      {
        id: "payment-1",
        amountCents: 12800,
        paidAt: date("2026-07-30T08:00:00.000Z")
      }
    ],
    refunds: [],
    ...overrides
  };
}

describe("AccountGovernanceService", () => {
  let service: AccountGovernanceService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation(async (callback: (tx: typeof mockPrisma) => unknown) => {
      return callback(mockPrisma);
    });
    mockAudit.record.mockResolvedValue({});
    mockPrisma.$queryRaw.mockResolvedValue([{ lock: "" }]);
    service = new AccountGovernanceService(mockPrisma as any, mockAudit as any);
  });

  it("lists only safe session fields and identifies the current session", async () => {
    mockPrisma.refreshToken.count.mockResolvedValue(1);
    mockPrisma.refreshToken.findMany.mockResolvedValue([
      {
        id: "session-1",
        tokenHash: "must-not-leak",
        sessionLabel: "微信小程序",
        clientPlatform: "wechat",
        lastUsedAt: date("2026-07-31T08:10:00.000Z"),
        createdAt: date("2026-07-31T08:00:00.000Z"),
        expiresAt: date("2026-08-30T08:00:00.000Z")
      }
    ]);

    const result = await service.listSessions("user-1", "session-1", 2, 25);

    expect(result.items).toEqual([
      {
        id: "session-1",
        sessionLabel: "微信小程序",
        clientPlatform: "wechat",
        lastUsedAt: "2026-07-31T08:10:00.000Z",
        createdAt: "2026-07-31T08:00:00.000Z",
        expiresAt: "2026-08-30T08:00:00.000Z",
        current: true
      }
    ]);
    expect(result.items[0]).not.toHaveProperty("tokenHash");
    expect(result.pagination).toEqual({
      page: 2,
      pageSize: 25,
      total: 1,
      totalPages: 1
    });
    expect(mockPrisma.refreshToken.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [{ lastUsedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      skip: 25,
      take: 25
    }));
  });

  it("revokes exactly one owned active session and audits the action", async () => {
    mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });

    await expect(service.revokeSession("user-1", "session-1")).resolves.toEqual({
      success: true,
      id: "session-1"
    });
    expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "session-1", userId: "user-1", revokedAt: null })
    }));
    expect(mockAudit.record).toHaveBeenCalledWith(expect.objectContaining({
      actorId: "user-1",
      action: "account.session_revoked",
      resourceId: "session-1"
    }), mockPrisma);
    expectActorOnlyAudit("account.session_revoked", "user-1");
  });

  it("does not reveal whether a non-owned session id exists", async () => {
    mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.revokeSession("user-1", "another-session")).rejects.toMatchObject({
      code: "SESSION_NOT_FOUND",
      status: 404
    });
    expect(mockAudit.record).not.toHaveBeenCalled();
  });

  it("revokes every other active session while preserving the current one", async () => {
    mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 3 });

    await expect(service.revokeOtherSessions("user-1", "session-current")).resolves.toEqual({
      success: true,
      revokedCount: 3
    });
    expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        id: { not: "session-current" },
        revokedAt: null,
        expiresAt: { gt: expect.any(Date) }
      },
      data: { revokedAt: expect.any(Date) }
    });
    expect(mockAudit.record).toHaveBeenCalledWith(expect.objectContaining({
      actorId: "user-1",
      action: "account.other_sessions_revoked",
      metadata: { currentSessionId: "session-current", revokedCount: 3 }
    }), mockPrisma);
    expectActorOnlyAudit("account.other_sessions_revoked", "user-1");
  });

  it("fails closed when an access token lacks current-session assurance", async () => {
    await expect(service.revokeOtherSessions("user-1")).rejects.toMatchObject({
      code: "SESSION_ASSURANCE_REQUIRED",
      status: 401
    });
    expect(mockPrisma.refreshToken.updateMany).not.toHaveBeenCalled();
  });

  it("normalizes and stores a low-sensitivity data-rights request without inventing an export file", async () => {
    mockPrisma.dataRightsRequest.findFirst.mockResolvedValue(null);
    mockPrisma.dataRightsRequest.create.mockResolvedValue(dataRightsRecord());

    const result = await service.createDataRightsRequest("user-1", {
      type: "export",
      description: "  请提供我的账户数据副本  "
    });

    expect(mockPrisma.dataRightsRequest.create).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        type: "export",
        description: "请提供我的账户数据副本"
      }
    });
    expect(result).not.toHaveProperty("downloadUrl");
    expect(result).not.toHaveProperty("file");
    expect(mockAudit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "account.data_rights_requested",
      metadata: { type: "export" }
    }), mockPrisma);
    expectActorOnlyAudit("account.data_rights_requested", "user-1");
  });

  it.each([
    "身份证号 11010519491231002X",
    "银行卡 6222 0201 2345 6789",
    "password: hunter2"
  ])("rejects obvious sensitive literals before persisting: %s", async (description) => {
    await expect(service.createDataRightsRequest("user-1", {
      type: "access",
      description
    })).rejects.toMatchObject({ code: "DATA_RIGHTS_SENSITIVE_CONTENT" });
    expect(mockPrisma.dataRightsRequest.create).not.toHaveBeenCalled();
  });

  it("prevents parallel unresolved requests of the same data-rights type", async () => {
    mockPrisma.dataRightsRequest.findFirst.mockResolvedValue(dataRightsRecord({ status: "inReview" }));

    await expect(service.createDataRightsRequest("user-1", {
      type: "export",
      description: "请提供我的账户数据副本"
    })).rejects.toMatchObject({
      code: "DATA_RIGHTS_REQUEST_ALREADY_OPEN",
      status: 409
    });
  });

  it("accepts append-only information from the owner and returns the request to the queue", async () => {
    const followUp = {
      id: "follow-up-1",
      requestId: "rights-1",
      userId: "user-1",
      requestedInformation: "请说明需要导出的时间范围",
      statement: "补充说明：请包含我最近一年的订单记录。",
      createdAt: date("2026-07-31T08:30:00.000Z")
    };
    mockPrisma.dataRightsRequest.findFirst.mockResolvedValue(dataRightsRecord({
      status: "needsInformation",
      statusReason: "请说明需要导出的时间范围",
      followUps: []
    }));
    mockPrisma.dataRightsRequestFollowUp.create.mockResolvedValue(followUp);
    mockPrisma.dataRightsRequest.update.mockResolvedValue(dataRightsRecord({
      status: "submitted",
      statusReason: null,
      followUps: [followUp],
      updatedAt: followUp.createdAt
    }));

    const result = await service.addDataRightsFollowUp("user-1", "rights-1", {
      statement: "  补充说明：请包含我最近一年的订单记录。 "
    });

    expect(mockPrisma.dataRightsRequest.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "rights-1", userId: "user-1" }
    }));
    expect(mockPrisma.dataRightsRequestFollowUp.create).toHaveBeenCalledWith({
      data: {
        requestId: "rights-1",
        userId: "user-1",
        requestedInformation: "请说明需要导出的时间范围",
        statement: "补充说明：请包含我最近一年的订单记录。"
      }
    });
    expect(mockPrisma.dataRightsRequest.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "rights-1" },
      data: expect.objectContaining({
        status: "submitted",
        handledById: null,
        handledAt: null,
        statusReason: null
      })
    }));
    expect(result).toMatchObject({
      request: { status: "submitted" },
      followUp: { id: "follow-up-1" }
    });
    expectActorOnlyAudit("account.data_rights_information_added", "user-1");
  });

  it("requires the assigned support owner and completion evidence for data-rights transitions", async () => {
    const completed = dataRightsRecord({
      status: "completed",
      statusReason: "身份已核验，申请已处理",
      handledById: "support-1",
      resolutionEvidenceReference: "vault:data-rights/export-1",
      resolvedAt: date("2026-07-31T09:00:00.000Z"),
      updatedAt: date("2026-07-31T09:00:00.000Z")
    });
    mockPrisma.dataRightsRequest.findUnique.mockResolvedValue({
      status: "inReview",
      handledById: "support-1"
    });
    mockPrisma.dataRightsRequest.update.mockResolvedValue(completed);
    mockPrisma.dataRightsRequest.findUniqueOrThrow.mockResolvedValue(completed);

    const result = await service.transitionDataRightsRequest("support-1", "support", "rights-1", {
      expectedStatus: "inReview",
      nextStatus: "completed",
      reason: "身份已核验，申请已处理",
      resolutionEvidenceReference: "vault:data-rights/export-1"
    });

    expect(mockPrisma.dataRightsRequest.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "rights-1" },
      data: expect.objectContaining({
        status: "completed",
        handledById: "support-1",
        resolvedAt: expect.any(Date),
        resolutionEvidenceReference: "vault:data-rights/export-1"
      })
    }));
    expect(result).toMatchObject({
      id: "rights-1",
      userId: "user-1",
      handledById: "support-1",
      status: "completed"
    });
  });

  it("reports the current status when a data-rights transition loses a race", async () => {
    mockPrisma.dataRightsRequest.findUnique.mockResolvedValue({
      status: "completed",
      handledById: "support-1"
    });

    await expect(service.transitionDataRightsRequest("support-1", "support", "rights-1", {
      expectedStatus: "inReview",
      nextStatus: "completed",
      reason: "处理完成",
      resolutionEvidenceReference: "vault:data-rights/export-1"
    })).rejects.toMatchObject({
      code: "DATA_RIGHTS_STATUS_CONFLICT",
      details: { expectedStatus: "inReview", currentStatus: "completed" }
    });
  });

  it("does not let support transition another staff member's data-rights request", async () => {
    mockPrisma.dataRightsRequest.findUnique.mockResolvedValue({
      status: "inReview",
      handledById: "support-2"
    });

    await expect(service.transitionDataRightsRequest("support-1", "support", "rights-1", {
      expectedStatus: "inReview",
      nextStatus: "needsInformation",
      reason: "请补充订单时间范围"
    })).rejects.toMatchObject({
      code: "DATA_RIGHTS_ASSIGNEE_REQUIRED",
      status: 403
    });
    expect(mockPrisma.dataRightsRequest.update).not.toHaveBeenCalled();
  });

  it("creates an invoice request only from the authoritative successful payment and frozen order facts", async () => {
    mockPrisma.order.findFirst.mockResolvedValue(paidOrder());
    mockPrisma.invoiceRequest.findFirst.mockResolvedValue(null);
    mockPrisma.invoiceRequest.create.mockResolvedValue(invoiceRecord());

    const result = await service.createInvoiceRequest("user-1", {
      orderId: "2c42fb2c-8d75-4d65-8267-74d2da4f1391",
      invoiceTitle: "上海示例科技有限公司"
    });

    expect(mockPrisma.invoiceRequest.create).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        orderId: "2c42fb2c-8d75-4d65-8267-74d2da4f1391",
        paymentTransactionId: "payment-1",
        invoiceTitle: "上海示例科技有限公司",
        amountCents: 12800,
        currency: "CNY",
        paymentPaidAt: date("2026-07-30T08:00:00.000Z"),
        serviceTitleSnapshot: "30 分钟语音陪伴",
        serviceDeliveryModeSnapshot: "voice",
        serviceDurationMinutesSnapshot: 30,
        companionNameSnapshot: "陪伴者"
      }
    });
    expect(result).toMatchObject({
      status: "submitted",
      amountCents: 12800,
      service: {
        title: "30 分钟语音陪伴",
        deliveryMode: "voice",
        durationMinutes: 30,
        companionName: "陪伴者"
      },
      issuedAt: null
    });
    expect(result).not.toHaveProperty("downloadUrl");
  });

  it("paginates the complete invoice-candidate domain and returns authoritative eligibility reasons", async () => {
    mockPrisma.order.findMany.mockResolvedValue([
      {
        id: "order-eligible",
        status: "completed",
        scheduledAt: date("2026-07-30T08:00:00.000Z"),
        amountCents: 12800,
        currency: "CNY",
        serviceOfferingTitleSnapshot: "30 分钟语音陪伴",
        themeNameSnapshot: "情绪陪伴",
        companionNameSnapshot: "陪伴者",
        payments: [{ id: "payment-1", amountCents: 12800, paidAt: date("2026-07-30T07:00:00.000Z") }],
        refunds: [],
        invoiceRequests: []
      },
      {
        id: "order-refunding",
        status: "paid",
        scheduledAt: date("2026-07-31T08:00:00.000Z"),
        amountCents: 3900,
        currency: "CNY",
        serviceOfferingTitleSnapshot: null,
        themeNameSnapshot: "倾听",
        companionNameSnapshot: "另一位陪伴者",
        payments: [{ id: "payment-2", amountCents: 3900, paidAt: date("2026-07-31T07:00:00.000Z") }],
        refunds: [{ id: "refund-1" }],
        invoiceRequests: []
      }
    ]);
    mockPrisma.order.count.mockResolvedValue(12);

    const result = await service.listInvoiceCandidateOrders("user-1", { page: 2, pageSize: 2 });

    expect(result.items).toEqual([
      expect.objectContaining({ id: "order-eligible", eligible: true, ineligibleReason: null }),
      expect.objectContaining({
        id: "order-refunding",
        eligible: false,
        ineligibleReason: "refundInProgressOrCompleted"
      })
    ]);
    expect(result.pagination).toEqual({ page: 2, pageSize: 2, total: 12, totalPages: 6 });
    expect(mockPrisma.order.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: "user-1", status: { in: ["paid", "inService", "completed"] } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: 2,
      take: 2
    }));
  });

  it("rejects an invoice when payment amount is inconsistent or any active/successful refund exists", async () => {
    mockPrisma.order.findFirst.mockResolvedValue(paidOrder({
      payments: [{ id: "payment-1", amountCents: 12799, paidAt: new Date() }]
    }));
    await expect(service.createInvoiceRequest("user-1", {
      orderId: "2c42fb2c-8d75-4d65-8267-74d2da4f1391",
      invoiceTitle: "上海示例科技有限公司"
    })).rejects.toMatchObject({ code: "INVOICE_PAYMENT_NOT_CONFIRMED" });

    mockPrisma.order.findFirst.mockResolvedValue(paidOrder({
      refunds: [{ id: "refund-1", status: "processing" }]
    }));
    await expect(service.createInvoiceRequest("user-1", {
      orderId: "2c42fb2c-8d75-4d65-8267-74d2da4f1391",
      invoiceTitle: "上海示例科技有限公司"
    })).rejects.toMatchObject({ code: "INVOICE_REFUND_IN_PROGRESS_OR_COMPLETED" });

    mockPrisma.order.findFirst.mockResolvedValue(paidOrder({
      refunds: [{ id: "refund-2", status: "failed" }]
    }));
    await expect(service.createInvoiceRequest("user-1", {
      orderId: "2c42fb2c-8d75-4d65-8267-74d2da4f1391",
      invoiceTitle: "上海示例科技有限公司"
    })).rejects.toMatchObject({ code: "INVOICE_REFUND_IN_PROGRESS_OR_COMPLETED" });
  });

  it("allows a corrected invoice request after a rejected request while blocking live or issued duplicates", async () => {
    mockPrisma.order.findFirst.mockResolvedValue(paidOrder());
    mockPrisma.invoiceRequest.findFirst.mockResolvedValue(null);
    mockPrisma.invoiceRequest.create.mockResolvedValue(invoiceRecord({ id: "invoice-2" }));

    await service.createInvoiceRequest("user-1", {
      orderId: "2c42fb2c-8d75-4d65-8267-74d2da4f1391",
      invoiceTitle: "更正后的个人抬头"
    });

    expect(mockPrisma.invoiceRequest.findFirst).toHaveBeenCalledWith({
      where: {
        orderId: "2c42fb2c-8d75-4d65-8267-74d2da4f1391",
        status: { in: ["submitted", "inReview", "issued"] }
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }]
    });
    expect(mockPrisma.invoiceRequest.create).toHaveBeenCalled();
    expectActorOnlyAudit("account.invoice_requested", "user-1");
  });

  it.each([
    "某公司 税号 91310000123456789X",
    "某公司 银行卡 6222020123456789",
    "某公司 password: secret"
  ])("rejects tax, identity, bank, or credential material in invoiceTitle: %s", async (invoiceTitle) => {
    await expect(service.createInvoiceRequest("user-1", {
      orderId: "2c42fb2c-8d75-4d65-8267-74d2da4f1391",
      invoiceTitle
    })).rejects.toMatchObject({ code: "INVOICE_TITLE_SENSITIVE_CONTENT" });
    expect(mockPrisma.order.findFirst).not.toHaveBeenCalled();
  });

  it("lets the requester cancel only a submitted invoice request", async () => {
    mockPrisma.invoiceRequest.findFirst.mockResolvedValue({
      id: "invoice-1",
      orderId: "2c42fb2c-8d75-4d65-8267-74d2da4f1391",
      status: "submitted"
    });
    mockPrisma.invoiceRequest.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.invoiceRequest.findUniqueOrThrow.mockResolvedValue(invoiceRecord({
      status: "cancelled",
      statusReason: "Cancelled by requester",
      cancelledAt: date("2026-07-31T09:00:00.000Z")
    }));

    await expect(service.cancelInvoiceRequest("user-1", "invoice-1")).resolves.toMatchObject({
      status: "cancelled",
      cancelledAt: "2026-07-31T09:00:00.000Z"
    });
    expect(mockPrisma.invoiceRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: "invoice-1",
        userId: "user-1",
        status: "submitted"
      },
      data: expect.objectContaining({
        status: "cancelled",
        cancelledAt: expect.any(Date)
      })
    }));
    expect(mockAudit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "account.invoice_cancelled",
      actorId: "user-1"
    }), mockPrisma);
    expectActorOnlyAudit("account.invoice_cancelled", "user-1");
  });

  it("requires invoice review before an operator can certify it as issued", async () => {
    await expect(service.transitionInvoiceRequest("finance-1", "invoice-1", {
      expectedStatus: "submitted",
      nextStatus: "issued",
      reason: "已开具"
    })).rejects.toMatchObject({ code: "INVOICE_STATUS_TRANSITION_INVALID" });

    const issued = invoiceRecord({
      status: "issued",
      statusReason: "已通过合规开票渠道开具",
      handledById: "finance-1",
      issuedAt: date("2026-07-31T09:00:00.000Z"),
      issuanceEvidenceReference: "tax-platform:invoice/20260731-1",
      updatedAt: date("2026-07-31T09:00:00.000Z")
    });
    mockPrisma.invoiceRequest.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.invoiceRequest.findUnique.mockResolvedValue({
      id: "invoice-1",
      orderId: "2c42fb2c-8d75-4d65-8267-74d2da4f1391",
      status: "inReview"
    });
    mockPrisma.order.findUnique.mockResolvedValue(paidOrder());
    mockPrisma.invoiceRequest.findUniqueOrThrow.mockResolvedValue(issued);

    const result = await service.transitionInvoiceRequest("finance-1", "invoice-1", {
      expectedStatus: "inReview",
      nextStatus: "issued",
      reason: "已通过合规开票渠道开具",
      evidenceReference: "tax-platform:invoice/20260731-1"
    });

    expect(mockPrisma.invoiceRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "invoice-1", status: "inReview" },
      data: expect.objectContaining({
        issuedAt: expect.any(Date),
        handledById: "finance-1",
        issuanceEvidenceReference: "tax-platform:invoice/20260731-1"
      })
    }));
    expect(result).toMatchObject({
      status: "issued",
      userId: "user-1",
      paymentTransactionId: "payment-1",
      handledById: "finance-1"
    });
  });

  it("rechecks refunds under the order lock before issuance and supports a controlled void state", async () => {
    mockPrisma.invoiceRequest.findUnique.mockResolvedValue({
      id: "invoice-1",
      orderId: "2c42fb2c-8d75-4d65-8267-74d2da4f1391",
      status: "inReview"
    });
    mockPrisma.order.findUnique.mockResolvedValue(paidOrder({
      refunds: [{ id: "refund-1", status: "failed" }]
    }));

    await expect(service.transitionInvoiceRequest("finance-1", "invoice-1", {
      expectedStatus: "inReview",
      nextStatus: "issued",
      reason: "准备开具",
      evidenceReference: "tax-platform:invoice/20260731-1"
    })).rejects.toMatchObject({ code: "INVOICE_REFUND_IN_PROGRESS_OR_COMPLETED" });
    expect(mockPrisma.invoiceRequest.updateMany).not.toHaveBeenCalled();

    mockPrisma.invoiceRequest.findUnique.mockResolvedValue({
      id: "invoice-1",
      orderId: "2c42fb2c-8d75-4d65-8267-74d2da4f1391",
      status: "issued"
    });
    mockPrisma.invoiceRequest.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.invoiceRequest.findUniqueOrThrow.mockResolvedValue(invoiceRecord({
      status: "voided",
      issuedAt: date("2026-07-31T09:00:00.000Z"),
      voidedAt: date("2026-07-31T10:00:00.000Z"),
      issuanceEvidenceReference: "tax-platform:invoice/20260731-1",
      voidEvidenceReference: "tax-platform:void/20260731-1"
    }));

    await expect(service.transitionInvoiceRequest("finance-1", "invoice-1", {
      expectedStatus: "issued",
      nextStatus: "voided",
      reason: "外部票据已完成作废或红冲",
      evidenceReference: "tax-platform:void/20260731-1"
    })).resolves.toMatchObject({
      status: "voided",
      issuedAt: "2026-07-31T09:00:00.000Z",
      voidedAt: "2026-07-31T10:00:00.000Z"
    });
  });

  it("paginates only the support assignee's full queue and the finance queue", async () => {
    mockPrisma.dataRightsRequest.findMany.mockResolvedValue([dataRightsRecord()]);
    mockPrisma.dataRightsRequest.count.mockResolvedValue(1);
    mockPrisma.invoiceRequest.findMany.mockResolvedValue([invoiceRecord()]);
    mockPrisma.invoiceRequest.count.mockResolvedValue(1);

    await expect(service.listDataRightsForAdmin(
      "support-1",
      "support",
      { page: 1, pageSize: 20, status: "submitted" }
    ))
      .resolves.toMatchObject({ pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 } });
    await expect(service.listInvoicesForAdmin({ page: 1, pageSize: 20, status: "submitted" }))
      .resolves.toMatchObject({ pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 } });
    expect(mockPrisma.dataRightsRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: "submitted", handledById: "support-1" },
      take: 20
    }));
    expect(mockPrisma.invoiceRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: "submitted" },
      take: 20
    }));
  });

  it("exposes only a minimal unassigned data-rights summary before claim", async () => {
    mockPrisma.dataRightsRequest.findMany.mockResolvedValue([{
      id: "rights-1",
      type: "export",
      status: "submitted",
      createdAt: date("2026-07-31T08:00:00.000Z"),
      updatedAt: date("2026-07-31T08:10:00.000Z")
    }]);
    mockPrisma.dataRightsRequest.count.mockResolvedValue(1);

    const result = await service.listClaimableDataRights({
      page: 1,
      pageSize: 20,
      status: "submitted"
    });

    expect(result.items[0]).toEqual({
      id: "rights-1",
      type: "export",
      status: "submitted",
      createdAt: "2026-07-31T08:00:00.000Z",
      updatedAt: "2026-07-31T08:10:00.000Z"
    });
    expect(result.items[0]).not.toHaveProperty("description");
    expect(result.items[0]).not.toHaveProperty("userId");
    expect(result.items[0]).not.toHaveProperty("followUps");
  });

  it("lets support claim an unassigned data-rights request before reading the full record", async () => {
    mockPrisma.dataRightsRequest.findUnique
      .mockResolvedValueOnce(dataRightsRecord())
      .mockResolvedValueOnce(dataRightsRecord({ handledById: "support-1" }));
    mockPrisma.dataRightsRequest.update.mockResolvedValue(
      dataRightsRecord({ handledById: "support-1" })
    );
    mockPrisma.dataRightsRequest.findUniqueOrThrow.mockResolvedValue(
      dataRightsRecord({ handledById: "support-1" })
    );

    await expect(service.claimDataRightsRequest("support-1", "support", "rights-1"))
      .resolves.toMatchObject({
        id: "rights-1",
        description: "请提供我的账户数据副本",
        handledById: "support-1"
      });
    expect(mockAudit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "account.data_rights_claimed",
      actorId: "support-1",
      subjectUserIds: ["user-1"]
    }), mockPrisma);
  });
});
