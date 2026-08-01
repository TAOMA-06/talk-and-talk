import { PaymentDisputesService } from "./payment-disputes.service";
import { MOCK_WECHAT_NOTIFY_TOKEN, MockWeChatPayProvider } from "./wechat/mock-wechat-pay.provider";

describe("PaymentDisputesService", () => {
  it("paginates participant-owned disputes and keeps direct lookups on the same sanitized scope", async () => {
    const now = new Date("2026-08-01T08:00:00.000Z");
    const row = {
      id: "dispute-owned",
      channel: "wechat",
      type: "consumer_complaint",
      orderId: "order-1",
      status: "open",
      providerStatus: "PROCESSING",
      providerDisputeId: "provider-secret",
      complaintDetail: "private complaint body",
      complaintOccurredAt: now,
      firstResponseDueAt: now,
      resolutionDueAt: now,
      firstRespondedAt: null,
      resolvedAt: null,
      updatedAt: now,
      order: {
        id: "order-1",
        userId: "customer-owner",
        companion: { ownerUserId: "companion-owner" }
      },
      complaintOrders: [{ orderId: "order-1" }]
    };
    const prisma: any = {
      paymentDispute: {
        findMany: jest.fn().mockResolvedValue([row]),
        count: jest.fn().mockResolvedValue(6),
        findFirst: jest.fn().mockResolvedValue(row)
      }
    };
    const service = new PaymentDisputesService(
      prisma,
      { record: jest.fn() } as any,
      new MockWeChatPayProvider()
    );

    const list = await service.listMine("companion-owner", {
      page: 2,
      pageSize: 5,
      status: "open"
    });
    const byOrder = await service.getMineByOrder("companion-owner", "order-1");
    const byId = await service.getMine("companion-owner", "dispute-owned");

    expect(prisma.paymentDispute.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        AND: [
          { OR: [
            { order: { userId: "companion-owner" } },
            { order: { companion: { ownerUserId: "companion-owner" } } },
            { complaintOrders: { some: { order: { userId: "companion-owner" } } } },
            { complaintOrders: { some: { order: { companion: { ownerUserId: "companion-owner" } } } } }
          ] },
          { status: "open" }
        ]
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      skip: 5,
      take: 5
    }));
    expect(list.pagination).toEqual({ page: 2, pageSize: 5, total: 6, totalPages: 2 });
    expect(byOrder.item).toMatchObject({ id: "dispute-owned", orderId: "order-1" });
    expect(byId).toMatchObject({ id: "dispute-owned", status: "open" });
    expect(JSON.stringify({ list, byOrder, byId })).not.toContain("provider-secret");
    expect(JSON.stringify({ list, byOrder, byId })).not.toContain("private complaint body");
    expect(prisma.paymentDispute.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: expect.arrayContaining([
          { order: { userId: "companion-owner" } },
          { complaintOrders: { some: { order: { userId: "companion-owner" } } } }
        ])
      })
    }));
  });

  it("returns every actor-owned order in a multi-order complaint without exposing another account's primary order", async () => {
    const now = new Date("2026-08-01T08:00:00.000Z");
    const row: any = {
      id: "dispute-multi-owner",
      channel: "wechat",
      type: "consumer_complaint",
      orderId: "foreign-primary-order",
      status: "open",
      providerStatus: "PROCESSING",
      complaintOccurredAt: now,
      firstResponseDueAt: now,
      resolutionDueAt: now,
      firstRespondedAt: null,
      resolvedAt: null,
      updatedAt: now,
      order: {
        id: "foreign-primary-order",
        userId: "other-customer",
        companion: { ownerUserId: "other-companion" }
      },
      // Prisma has already applied userOwnershipInclude here: a foreign linked
      // order cannot reach the DTO even when the provider complaint spans it.
      complaintOrders: [{ orderId: "owned-order-2" }, { orderId: "owned-order-1" }],
      providerDisputeId: "provider-secret",
      complaintDetail: "foreign and provider-private content"
    };
    const prisma: any = {
      paymentDispute: {
        findMany: jest.fn().mockResolvedValue([row]),
        count: jest.fn().mockResolvedValue(1)
      }
    };
    const service = new PaymentDisputesService(
      prisma,
      { record: jest.fn() } as any,
      new MockWeChatPayProvider()
    );

    const result = await service.listMine("customer-owner", { page: 1, pageSize: 20 });

    expect(result.items[0]).toMatchObject({
      orderId: null,
      ownedOrderIds: ["owned-order-2", "owned-order-1"],
      ownedOrders: [{ orderId: "owned-order-2" }, { orderId: "owned-order-1" }]
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("foreign-primary-order");
    expect(serialized).not.toContain("provider-secret");
    expect(serialized).not.toContain("provider-private");
  });

  it("loads unmatched counts for a full admin page in one grouped query and signals every bounded evidence window", async () => {
    const now = new Date("2026-08-01T08:00:00.000Z");
    const bounded = Array.from({ length: 10 }, (_, index) => ({
      id: `evidence-${index}`,
      createdAt: now,
      updatedAt: now,
      receivedAt: now,
      providerSeenAt: now,
      mediaDigests: []
    }));
    const items = Array.from({ length: 30 }, (_, index) => ({
      id: `dispute-${index}`,
      channel: "wechat",
      type: "consumer_complaint",
      status: "open",
      providerStatus: "PROCESSING",
      firstRespondedAt: null,
      firstResponseDueAt: new Date(now.getTime() + 60_000),
      resolutionDueAt: new Date(now.getTime() + 120_000),
      createdAt: now,
      updatedAt: now,
      replies: bounded,
      attachments: bounded,
      notifications: bounded,
      negotiationEvents: bounded,
      recoveries: bounded,
      complaintOrders: bounded.map((item) => ({
        ...item,
        orderId: `order-${index}`,
        paymentId: `payment-${index}`,
        outTradeNo: `T-${index}`,
        transactionId: `WX-${index}`,
        amountCents: 100,
        matchedAt: now
      })),
      _count: {
        replies: 21,
        attachments: 22,
        notifications: 23,
        negotiationEvents: 24,
        recoveries: 25,
        complaintOrders: 26
      }
    }));
    const prisma: any = {
      paymentDispute: {
        findMany: jest.fn(async () => items),
        count: jest.fn(async () => 75)
      },
      paymentDisputeOrder: {
        groupBy: jest.fn(async () => [{ disputeId: "dispute-0", _count: { _all: 2 } }]),
        count: jest.fn()
      }
    };
    const service = new PaymentDisputesService(
      prisma,
      { record: jest.fn() } as any,
      new MockWeChatPayProvider()
    );

    const result = await service.listAdmin(
      { id: "admin-1", role: "admin" },
      { page: 2, pageSize: 30 }
    );

    expect(prisma.paymentDispute.findMany).toHaveBeenCalledWith(expect.objectContaining({
      skip: 30,
      take: 30
    }));
    expect(prisma.paymentDisputeOrder.groupBy).toHaveBeenCalledTimes(1);
    expect(prisma.paymentDisputeOrder.count).not.toHaveBeenCalled();
    expect(prisma.paymentDisputeOrder.groupBy).toHaveBeenCalledWith({
      by: ["disputeId"],
      where: {
        disputeId: { in: items.map((item) => item.id) },
        OR: [{ orderId: null }, { paymentId: null }]
      },
      _count: { _all: true }
    });
    expect(result).toMatchObject({ page: 2, pageSize: 30, total: 75 });
    expect(result.items[0].unmatchedComplaintOrderCount).toBe(2);
    expect(result.items[1].unmatchedComplaintOrderCount).toBe(0);
    expect(Object.keys(result.items[0].evidenceWindows).sort()).toEqual([
      "attachments",
      "complaintOrders",
      "negotiationEvents",
      "notifications",
      "recoveries",
      "replies"
    ]);
    expect(Object.values(result.items[0].evidenceWindows)
      .every((window: any) => window.limit === 10 && window.hasMore === true)).toBe(true);
  });

  it("persists only compact complaint notification metadata and is idempotent", async () => {
    const disputes = new Map<string, any>();
    const notices = new Map<string, any>();
    const db: any = {
      paymentDispute: {
        findUnique: jest.fn(async ({ where }: any) => {
          const key = where.channel_providerDisputeId;
          return key ? disputes.get(`${key.channel}:${key.providerDisputeId}`) ?? null : null;
        }),
        create: jest.fn(async ({ data }: any) => {
          const row = { id: "dispute-1", ...data };
          disputes.set(`${data.channel}:${data.providerDisputeId}`, row);
          return row;
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const row = [...disputes.values()].find((item) => item.id === where.id);
          Object.assign(row, data);
          return row;
        })
      },
      paymentDisputeNotification: {
        findUnique: jest.fn(async ({ where }: any) => notices.get(where.providerNotificationId) ?? null),
        create: jest.fn(async ({ data }: any) => {
          notices.set(data.providerNotificationId, data);
          return data;
        })
      },
      auditLog: { create: jest.fn(async () => ({})) }
    };
    const prisma: any = { $transaction: (callback: any) => callback(db) };
    const audit: any = { record: jest.fn(async () => ({})) };
    const provider = new MockWeChatPayProvider();
    const service = new PaymentDisputesService(prisma, audit, provider);
    jest.spyOn(service as any, "reconcileById").mockResolvedValue(true);
    const rawBody = JSON.stringify({
      id: "notice-1",
      create_time: "2026-07-31T12:00:00+08:00",
      event_type: "COMPLAINT.CREATE",
      summary: "new complaint",
      resource: { plaintext: { complaint_id: "complaint-1", action_type: "CREATE_COMPLAINT" } }
    });

    await service.handleWechatComplaintNotify({ "x-mock-wechat-token": MOCK_WECHAT_NOTIFY_TOKEN }, rawBody);
    await service.handleWechatComplaintNotify({ "x-mock-wechat-token": MOCK_WECHAT_NOTIFY_TOKEN }, rawBody);

    expect(db.paymentDispute.create).toHaveBeenCalledTimes(1);
    expect(db.paymentDisputeNotification.create).toHaveBeenCalledTimes(1);
    const persisted = notices.get("notice-1");
    expect(persisted).toMatchObject({
      eventType: "COMPLAINT.CREATE",
      actionType: "CREATE_COMPLAINT",
      summary: "new complaint"
    });
    expect(persisted.rawDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(persisted)).not.toContain("ciphertext");
  });

  it("moves an already-paid earning to the manual recovery boundary", async () => {
    const provider = new MockWeChatPayProvider();
    const service = new PaymentDisputesService({} as any, {} as any, provider);
    const db: any = {
      $queryRaw: jest.fn(async () => []),
      companionEarning: {
        findUnique: jest.fn(async () => ({
          id: "earning-1",
          status: "paid",
          companionId: "companion-1",
          payableCents: 8000,
          paidAmountCents: 8000
        }))
      },
      companionRecovery: { upsert: jest.fn(async () => ({})) },
      paymentDispute: { update: jest.fn(async () => ({})) }
    };

    await (service as any).holdOrRecoverFunding(db, "dispute-1", "order-1");

    expect(db.companionRecovery.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        disputeId: "dispute-1",
        reason: "paymentDisputeAfterPayout",
        amountCents: 8000
      })
    }));
    expect(await (service as any).holdOrRecoverFunding(db, "dispute-1", "order-1"))
      .toBe("recoveryRequired");
  });

  it("does not release a held earning while another dispute or refund blocks settlement", async () => {
    const service = new PaymentDisputesService({} as any, {} as any, new MockWeChatPayProvider());
    const db: any = {
      $queryRaw: jest.fn(async () => []),
      paymentDispute: {
        findUnique: jest.fn(async () => ({ id: "d1", orderId: "o1", fundingStatus: "held" })),
        count: jest.fn(async () => 1),
        update: jest.fn()
      },
      refundTransaction: { count: jest.fn(async () => 0) },
      companionEarning: {
        findUnique: jest.fn(async () => ({ id: "e1", status: "held", holdReason: "payment_dispute:d1" })),
        update: jest.fn()
      }
    };

    await (service as any).releaseFundingIfSafe(db, "d1", "o1");

    expect(db.companionEarning.update).not.toHaveBeenCalled();
    expect(db.paymentDispute.update).not.toHaveBeenCalled();
  });

  it("keeps claimable support and finance views inside their minimum data scopes", () => {
    const service = new PaymentDisputesService({} as any, {} as any, new MockWeChatPayProvider());
    const now = new Date("2026-07-31T10:00:00.000Z");
    const item: any = {
      id: "dispute-1",
      channel: "wechat",
      type: "consumer_complaint",
      providerDisputeId: "provider-secret",
      idempotencyKey: "idempotency-secret",
      orderId: "order-1",
      paymentId: "payment-1",
      outTradeNo: "trade-secret",
      status: "open",
      providerStatus: "PENDING",
      problemType: "SERVICE_NOT_RECEIVED",
      complaintDetail: "private complaint body",
      complaintOccurredAt: now,
      firstResponseDueAt: now,
      resolutionDueAt: now,
      firstRespondedAt: null,
      resolvedAt: null,
      incomingUserResponse: true,
      complaintCount: 1,
      requiresImmediateService: true,
      inPlatformService: false,
      applyRefundAmountCents: 100,
      latestActionType: "CREATE_COMPLAINT",
      fundingStatus: "held",
      assignedSupportUserId: null,
      providerQueryAttempts: 0,
      reconcileLeaseToken: "lease-secret",
      replies: [{ id: "reply-1", content: "merchant private reply" }],
      attachments: [{ id: "attachment-1", providerMediaId: "media-secret" }],
      notifications: [],
      recoveries: [],
      createdAt: now,
      updatedAt: now
    };

    const claimable = (service as any).toScopedAdminDto(item, { id: "support-1", role: "support" });
    expect(claimable).toMatchObject({ detailAvailable: false, dataScope: "claimableSummary", hasOrder: true });
    expect(JSON.stringify(claimable)).not.toContain("private complaint body");
    expect(JSON.stringify(claimable)).not.toContain("provider-secret");
    expect(JSON.stringify(claimable)).not.toContain("trade-secret");

    const finance = (service as any).toScopedAdminDto(item, { id: "finance-1", role: "finance" });
    expect(finance).toMatchObject({ detailAvailable: false, dataScope: "financial", outTradeNo: "trade-secret" });
    expect(JSON.stringify(finance)).not.toContain("private complaint body");
    expect(JSON.stringify(finance)).not.toContain("merchant private reply");

    const admin = (service as any).toScopedAdminDto(item, { id: "admin-1", role: "admin" });
    expect(admin).toMatchObject({ detailAvailable: true, dataScope: "all", complaintDetail: "private complaint body" });
    expect(JSON.stringify(admin)).not.toContain("idempotency-secret");
    expect(JSON.stringify(admin)).not.toContain("lease-secret");
  });

  it("requires support to claim a dispute before submitting a reply", async () => {
    const db: any = {
      $queryRaw: jest.fn(async () => []),
      paymentDispute: {
        findUnique: jest.fn(async () => ({
          id: "dispute-1",
          status: "open",
          inPlatformService: false,
          assignedSupportUserId: null
        }))
      },
      paymentDisputeReply: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn() }
    };
    const prisma: any = { $transaction: (callback: any) => callback(db) };
    const service = new PaymentDisputesService(prisma, { record: jest.fn() } as any, new MockWeChatPayProvider());

    await expect(service.reply(
      { id: "support-1", role: "support" },
      "dispute-1",
      { clientRequestId: "f9246aa6-7871-4ba7-93aa-9b38bb7bc60e", content: "已收到，我们正在处理。" }
    )).rejects.toMatchObject({ code: "PAYMENT_DISPUTE_CLAIM_REQUIRED" });
    expect(db.paymentDisputeReply.create).not.toHaveBeenCalled();
  });

  it("reconciles an outcome-unknown local reply from signed provider negotiation history", async () => {
    const now = new Date("2026-07-31T04:00:00.000Z");
    const current = {
      id: "dispute-1",
      orderId: null,
      paymentId: null,
      outTradeNo: null,
      firstRespondedAt: null,
      resolvedAt: null,
      completionStatus: null,
      fundingStatus: "unlinked"
    };
    const db: any = {
      $queryRaw: jest.fn(async () => []),
      paymentDispute: {
        findUnique: jest.fn(async () => current),
        update: jest.fn(async () => current)
      },
      paymentDisputeAttachment: {
        deleteMany: jest.fn(async () => ({})),
        createMany: jest.fn(async () => ({}))
      },
      paymentDisputeNegotiationEvent: { createMany: jest.fn(async () => ({})) },
      paymentDisputeReply: {
        findMany: jest.fn(async () => [{
          id: "reply-1",
          actorId: "support-1",
          content: "我们正在核实。",
          submittedAt: null,
          providerReference: null
        }]),
        update: jest.fn(async () => ({}))
      },
      companionEarning: { findUnique: jest.fn(async () => null) },
      auditLog: { create: jest.fn(async () => ({})) }
    };
    const prisma: any = {
      paymentTransaction: { findFirst: jest.fn(async () => null) },
      $transaction: (callback: any) => callback(db)
    };
    const audit: any = { record: jest.fn(async () => ({})) };
    const service = new PaymentDisputesService(prisma, audit, new MockWeChatPayProvider());

    await (service as any).applyProviderDetail("dispute-1", {
      complaintId: "complaint-1",
      complaintTime: "2026-07-31T10:00:00+08:00",
      complaintDetail: "service issue",
      complaintState: "PROCESSING",
      complaintOrders: [],
      complaintFullRefunded: false,
      incomingUserResponse: false,
      userComplaintTimes: 1,
      complaintMedia: [],
      inPlatformService: false,
      needImmediateService: false
    }, [{
      logId: "provider-log-1",
      operator: "商户",
      operateTime: now.toISOString(),
      operateType: "MERCHANT_RESPONSE",
      operateDetails: "我们正在核实。",
      mediaUrls: []
    }]);

    expect(db.paymentDisputeReply.update).toHaveBeenCalledWith({
      where: { id: "reply-1" },
      data: {
        status: "submitted",
        submittedAt: now,
        providerReference: "provider-log-1"
      }
    });
    expect(db.paymentDispute.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "dispute-1" },
      data: expect.objectContaining({ status: "processing", firstRespondedAt: now })
    }));
  });

  it("persists every provider complaint order, holds each match, recovers paid earnings, and makes repeat sync immutable", async () => {
    const complaintOrders = [
      { outTradeNo: "T-B", transactionId: "WX-B", amountCents: 2_000 },
      { outTradeNo: "T-UNMATCHED", transactionId: "WX-U", amountCents: 3_000 },
      { outTradeNo: "T-A", transactionId: "WX-A", amountCents: 1_000 }
    ];
    const paymentRows = [
      { id: "payment-a", orderId: "order-a", outTradeNo: "T-A", transactionId: "WX-A", amountCents: 1_000 },
      { id: "payment-b", orderId: "order-b", outTradeNo: "T-B", transactionId: "WX-B", amountCents: 2_000 }
    ];
    const disputeOrderRows = new Map<string, any>();
    const earnings = new Map<string, any>([
      ["order-a", {
        id: "earning-a", orderId: "order-a", companionId: "companion-a",
        status: "pending", holdReason: null, payableCents: 800, paidAmountCents: null
      }],
      ["order-b", {
        id: "earning-b", orderId: "order-b", companionId: "companion-b",
        status: "paid", holdReason: null, payableCents: 1_600, paidAmountCents: 1_600
      }]
    ]);
    const current: any = {
      id: "dispute-multi",
      orderId: null,
      paymentId: null,
      outTradeNo: null,
      firstRespondedAt: null,
      resolvedAt: null,
      completionStatus: null,
      fundingStatus: "unlinked"
    };
    const db: any = {
      $queryRaw: jest.fn(async () => []),
      paymentDispute: {
        findUnique: jest.fn(async () => current),
        update: jest.fn(async ({ data }: any) => Object.assign(current, data))
      },
      paymentDisputeOrder: {
        findUnique: jest.fn(async ({ where }: any) => (
          disputeOrderRows.get(where.disputeId_outTradeNo.outTradeNo) ?? null
        )),
        create: jest.fn(async ({ data }: any) => {
          const row = { ...data, providerSeenAt: new Date(), matchedAt: data.matchedAt ?? null };
          disputeOrderRows.set(data.outTradeNo, row);
          return row;
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const row = [...disputeOrderRows.values()].find((item) => item.id === where.id);
          Object.assign(row, data);
          return row;
        })
      },
      paymentDisputeAttachment: {
        deleteMany: jest.fn(async () => ({})),
        createMany: jest.fn(async () => ({}))
      },
      paymentDisputeNegotiationEvent: { createMany: jest.fn(async () => ({})) },
      companionEarning: {
        findUnique: jest.fn(async ({ where }: any) => earnings.get(where.orderId) ?? null),
        update: jest.fn(async ({ where, data }: any) => {
          const earning = [...earnings.values()].find((item) => item.id === where.id);
          Object.assign(earning, data);
          return earning;
        })
      },
      companionRecovery: { upsert: jest.fn(async () => ({})) },
      auditLog: { create: jest.fn(async () => ({})) }
    };
    const prisma: any = {
      paymentTransaction: { findMany: jest.fn(async () => paymentRows) },
      $transaction: (callback: any) => callback(db)
    };
    const audit: any = { record: jest.fn(async () => ({})) };
    const service = new PaymentDisputesService(prisma, audit, new MockWeChatPayProvider());
    const detail: any = {
      complaintId: "provider-dispute-multi",
      complaintTime: "2026-08-01T10:00:00+08:00",
      complaintDetail: "multi-order complaint",
      complaintState: "PROCESSING",
      complaintOrders,
      complaintFullRefunded: false,
      incomingUserResponse: false,
      userComplaintTimes: 1,
      complaintMedia: [],
      inPlatformService: false,
      needImmediateService: false
    };

    await (service as any).applyProviderDetail(current.id, detail, []);

    expect(disputeOrderRows.size).toBe(3);
    expect(disputeOrderRows.get("T-UNMATCHED")).toMatchObject({
      orderId: null,
      paymentId: null,
      outTradeNo: "T-UNMATCHED",
      transactionId: "WX-U",
      amountCents: 3_000,
      matchedAt: null
    });
    expect(earnings.get("order-a")).toMatchObject({
      status: "held",
      holdReason: `payment_dispute:${current.id}`
    });
    expect(db.companionRecovery.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { disputeId_earningId: { disputeId: current.id, earningId: "earning-b" } },
      create: expect.objectContaining({ amountCents: 1_600, reason: "paymentDisputeAfterPayout" })
    }));
    expect(current.fundingStatus).toBe("recoveryRequired");
    // Sorted order locks precede the dispute and earning locks.
    expect(db.$queryRaw.mock.calls.slice(0, 3).map((call: any[]) => call[1]))
      .toEqual(["order-a", "order-b", current.id]);

    db.paymentDisputeOrder.create.mockClear();
    db.paymentDisputeOrder.update.mockClear();
    await (service as any).applyProviderDetail(current.id, detail, []);
    expect(db.paymentDisputeOrder.create).not.toHaveBeenCalled();
    expect(db.paymentDisputeOrder.update).not.toHaveBeenCalled();
  });

  it("rejects crossed or amount-mismatched provider payment bindings before any dispute mutation", async () => {
    const prisma: any = {
      paymentTransaction: {
        findMany: jest.fn(async () => [{
          id: "payment-1",
          orderId: "order-1",
          outTradeNo: "T-1",
          transactionId: "WX-DIFFERENT",
          amountCents: 1_000
        }])
      },
      $transaction: jest.fn()
    };
    const service = new PaymentDisputesService(
      prisma,
      { record: jest.fn() } as any,
      new MockWeChatPayProvider()
    );

    await expect((service as any).applyProviderDetail("dispute-1", {
      complaintId: "complaint-1",
      complaintTime: "2026-08-01T10:00:00+08:00",
      complaintDetail: "binding conflict",
      complaintState: "PROCESSING",
      complaintOrders: [{ outTradeNo: "T-1", transactionId: "WX-1", amountCents: 1_000 }],
      complaintFullRefunded: false,
      incomingUserResponse: false,
      userComplaintTimes: 1,
      complaintMedia: [],
      inPlatformService: false,
      needImmediateService: false
    }, [])).rejects.toMatchObject({ code: "WECHAT_COMPLAINT_PAYMENT_BINDING_CONFLICT" });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("paginates typed evidence under role scope and blocks finance from complaint text", async () => {
    const prisma: any = {
      paymentDispute: {
        findUnique: jest.fn(async () => ({ id: "dispute-1", assignedSupportUserId: "support-1" }))
      },
      paymentDisputeOrder: {
        findMany: jest.fn(async () => [{
          id: "link-1",
          orderId: "order-1",
          paymentId: "payment-1",
          outTradeNo: "T-VERY-SECRET-1",
          transactionId: "WX-VERY-SECRET-1",
          amountCents: 1_000,
          providerSeenAt: new Date("2026-08-01T02:00:00.000Z"),
          matchedAt: new Date("2026-08-01T02:01:00.000Z")
        }]),
        count: jest.fn(async () => 3)
      }
    };
    const service = new PaymentDisputesService(
      prisma,
      { record: jest.fn() } as any,
      new MockWeChatPayProvider()
    );

    const page = await service.listAdminEvidence(
      { id: "finance-1", role: "finance" },
      "dispute-1",
      "complaint-orders",
      { page: 2, pageSize: 1 }
    );
    expect(page).toMatchObject({
      resource: "complaint-orders",
      pagination: { page: 2, pageSize: 1, total: 3, totalPages: 3, nextPage: 3 },
      items: [{ matched: true, amountCents: 1_000 }]
    });
    expect(page.items[0].outTradeNoMasked).not.toBe("T-VERY-SECRET-1");
    expect(prisma.paymentDisputeOrder.findMany).toHaveBeenCalledWith(expect.objectContaining({
      skip: 1,
      take: 1
    }));
    await expect(service.listAdminEvidence(
      { id: "finance-1", role: "finance" },
      "dispute-1",
      "replies",
      { page: 1, pageSize: 25 }
    )).rejects.toMatchObject({ code: "PAYMENT_DISPUTE_EVIDENCE_FORBIDDEN" });
  });

  it("blocks completion when any complaint order has a partial local link and rejects closed claims", async () => {
    const provider = new MockWeChatPayProvider();
    const completeComplaint = jest.spyOn(provider, "completeComplaint");
    const current: any = {
      id: "dispute-1",
      status: "processing",
      providerStatus: "PROCESSING",
      assignedSupportUserId: "support-1",
      firstRespondedAt: new Date(),
      incomingUserResponse: false,
      inPlatformService: false,
      completionStatus: null
    };
    const db: any = {
      $queryRaw: jest.fn(async () => []),
      paymentDispute: { findUnique: jest.fn(async () => current), update: jest.fn() },
      paymentDisputeOrder: { count: jest.fn(async () => 1) }
    };
    const prisma: any = {
      $transaction: (callback: any) => callback(db),
      paymentDispute: { findUnique: jest.fn() }
    };
    const service = new PaymentDisputesService(prisma, { record: jest.fn() } as any, provider);

    await expect(service.complete(
      { id: "support-1", role: "support" },
      current.id,
      { clientRequestId: "f9246aa6-7871-4ba7-93aa-9b38bb7bc60e" }
    )).rejects.toMatchObject({ code: "PAYMENT_DISPUTE_ORDERS_UNLINKED" });
    expect(db.paymentDisputeOrder.count).toHaveBeenCalledWith({
      where: { disputeId: current.id, OR: [{ orderId: null }, { paymentId: null }] }
    });
    expect(completeComplaint).not.toHaveBeenCalled();

    current.status = "resolved";
    current.completionStatus = "submitted";
    db.paymentDisputeOrder.count.mockResolvedValue(0);
    await expect(service.claim(
      { id: "support-1", role: "support" },
      current.id
    )).rejects.toMatchObject({ code: "PAYMENT_DISPUTE_CLOSED" });
    expect(db.$queryRaw).toHaveBeenCalled();
  });
});
