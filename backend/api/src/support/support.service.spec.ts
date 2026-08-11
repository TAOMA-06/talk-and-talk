import { SupportService } from "./support.service";

describe("SupportService", () => {
  const prisma = {
    order: { findUnique: jest.fn() },
    supportTicket: { findFirst: jest.fn() },
    $transaction: jest.fn()
  } as any;
  const config = { get: jest.fn().mockReturnValue(24) } as any;
  const commercial = { holdForOrder: jest.fn().mockResolvedValue(1) } as any;
  const audit = { record: jest.fn().mockResolvedValue(undefined) } as any;
  const notifications = { createTransactional: jest.fn().mockResolvedValue(undefined) } as any;
  const caseEvidence = {
    attachmentInclude: jest.fn().mockReturnValue({ evidenceAttachments: { include: { mediaAsset: true } } }),
    attachmentDtos: jest.fn().mockReturnValue([]),
    assertAttachmentsAllowed: jest.fn(),
    bindSupportFact: jest.fn().mockResolvedValue([])
  } as any;
  let service: SupportService;

  beforeEach(() => {
    jest.clearAllMocks();
    caseEvidence.assertAttachmentsAllowed.mockReturnValue(undefined);
    service = new SupportService(prisma, config, commercial, audit, notifications, caseEvidence);
  });

  it("scopes canonical staff detail to the support assignee while allowing audited admin access", async () => {
    const ticket = {
      id: "ticket-detail",
      userId: "customer-1",
      orderId: null,
      category: "other",
      priority: "normal",
      status: "inProgress",
      subject: "需要帮助",
      body: "请查看工单详情",
      assignedToUserId: "support-1",
      dueAt: new Date("2026-08-02T00:00:00.000Z"),
      resolution: null,
      resolutionCode: null,
      resolvedAt: null,
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
      updatedAt: new Date("2026-08-01T01:00:00.000Z"),
      requester: { id: "customer-1", profile: { displayName: "用户" } },
      assignedTo: { id: "support-1", profile: { displayName: "客服一" } },
      order: null,
      orderFacts: []
    };
    prisma.supportTicket.findFirst
      .mockResolvedValueOnce(ticket)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(ticket);

    await expect(service.getAdmin({ id: "support-1", role: "support" } as any, ticket.id))
      .resolves.toMatchObject({ id: ticket.id, body: ticket.body });
    expect(prisma.supportTicket.findFirst).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: { id: ticket.id, assignedToUserId: "support-1" },
      include: expect.objectContaining({
        requester: { select: { id: true, profile: { select: { displayName: true } } } },
        assignedTo: { select: { id: true, profile: { select: { displayName: true } } } }
      })
    }));

    await expect(service.getAdmin({ id: "support-2", role: "support" } as any, ticket.id))
      .rejects.toMatchObject({ code: "SUPPORT_TICKET_NOT_FOUND", status: 404 });

    await expect(service.getAdmin({ id: "admin-1", role: "admin" } as any, ticket.id))
      .resolves.toMatchObject({ id: ticket.id });
    expect(prisma.supportTicket.findFirst).toHaveBeenNthCalledWith(3, expect.objectContaining({
      where: { id: ticket.id }
    }));
  });

  it("creates an order dispute and freezes its earning in the same transaction", async () => {
    const createdAt = new Date("2026-07-20T05:00:00.000Z");
    const ticket = {
      id: "ticket-1",
      userId: "customer-1",
      orderId: "order-1",
      category: "orderIssue",
      priority: "high",
      status: "open",
      subject: "服务时间异常",
      body: "预约服务没有按时开始。",
      assignedToUserId: "admin-1",
      dueAt: new Date("2026-07-21T05:00:00.000Z"),
      resolution: null,
      resolvedAt: null,
      createdAt,
      updatedAt: createdAt
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      order: { findUnique: jest.fn().mockResolvedValue({
        id: "order-1",
        userId: "customer-1",
        companion: { ownerUserId: "companion-owner" }
      }) },
      supportTicket: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue(ticket)
      }
    };
    prisma.$transaction.mockImplementation(async (callback: (db: any) => Promise<unknown>) => callback(tx));

    const result = await service.create(
      { id: "customer-1" } as any,
      {
        orderId: "order-1",
        category: "orderIssue",
        subject: "  服务时间异常  ",
        body: "  预约服务没有按时开始。  "
      }
    );

    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.supportTicket.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "customer-1",
        orderId: "order-1",
        priority: "high",
        subject: "服务时间异常",
        body: "预约服务没有按时开始。"
      })
    });
    expect(commercial.holdForOrder).toHaveBeenCalledWith("order-1", "unresolved_support_ticket", tx);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "support.ticket_created",
      resourceId: "ticket-1"
    }), tx);
    expect(result).toEqual(expect.objectContaining({ id: "ticket-1", status: "open" }));
  });

  it("does not disclose or freeze an order the requester does not participate in", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      order: { findUnique: jest.fn().mockResolvedValue({
        id: "order-1",
        userId: "customer-1",
        companion: { ownerUserId: "companion-owner" }
      }) },
      supportTicket: { count: jest.fn().mockResolvedValue(0), create: jest.fn() }
    };
    prisma.$transaction.mockImplementation(async (callback: (db: any) => Promise<unknown>) => callback(tx));

    await expect(service.create(
      { id: "unrelated-user" } as any,
      { orderId: "order-1", category: "orderIssue", subject: "问题", body: "需要帮助" }
    )).rejects.toMatchObject({ code: "ORDER_NOT_FOUND" });

    expect(tx.supportTicket.create).not.toHaveBeenCalled();
    expect(commercial.holdForOrder).not.toHaveBeenCalled();
  });

  it("bounds ordinary open support work per user while preserving the safety channel", async () => {
    config.get.mockImplementation((key: string) => key === "SUPPORT_MAX_OPEN_PER_USER" ? 2 : 24);
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      supportTicket: {
        count: jest.fn().mockResolvedValue(2),
        create: jest.fn()
      }
    };
    prisma.$transaction.mockImplementation(async (callback: (db: any) => Promise<unknown>) => callback(tx));

    await expect(service.create(
      { id: "customer-1" } as any,
      { category: "refund", subject: "退款问题", body: "请先处理现有工单" }
    )).rejects.toMatchObject({ code: "SUPPORT_OPEN_LIMIT_REACHED", details: { limit: 2 } });
    expect(tx.supportTicket.create).not.toHaveBeenCalled();

    tx.supportTicket.create.mockResolvedValue({
      id: "safety-1", userId: "customer-1", orderId: null, category: "safety", priority: "urgent",
      status: "open", subject: "紧急安全问题", body: "需要帮助", dueAt: new Date(),
      resolution: null, resolvedAt: null, createdAt: new Date(), updatedAt: new Date()
    });
    await expect(service.create(
      { id: "customer-1" } as any,
      { category: "safety", subject: "紧急安全问题", body: "需要帮助" }
    )).resolves.toMatchObject({ id: "safety-1", priority: "urgent" });
  });

  it("adds a bounded private order fact under Order then SupportTicket locks without changing settlement", async () => {
    const createdAt = new Date("2026-07-20T07:00:00.000Z");
    const ticket = {
      id: "ticket-1",
      userId: "customer-1",
      orderId: "order-1",
      category: "orderIssue",
      status: "inProgress",
      order: {
        id: "order-1",
        userId: "customer-1",
        companion: { ownerUserId: "companion-owner" }
      }
    };
    const queryCalls: string[] = [];
    const tx = {
      $queryRaw: jest.fn().mockImplementation(async (strings: TemplateStringsArray) => {
        queryCalls.push(String(strings[0]));
        return [];
      }),
      supportTicket: {
        findUnique: jest.fn()
          .mockResolvedValueOnce({ orderId: "order-1" })
          .mockResolvedValueOnce(ticket),
        update: jest.fn().mockResolvedValue({ id: "ticket-1" })
      },
      orderSupportFact: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue({
          id: "fact-1",
          supportTicketId: "ticket-1",
          orderId: "order-1",
          submittedByUserId: "customer-1",
          statement: "我在约定时间进入平台会话，服务没有开始。",
          createdAt
        }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: "fact-1",
          supportTicketId: "ticket-1",
          orderId: "order-1",
          submittedByUserId: "customer-1",
          statement: "我在约定时间进入平台会话，服务没有开始。",
          evidenceAttachments: [],
          createdAt
        })
      }
    };
    prisma.$transaction.mockImplementation(async (callback: (db: any) => Promise<unknown>) => callback(tx));

    const result = await service.addOrderFact(
      { id: "customer-1" } as any,
      "ticket-1",
      { statement: "  我在约定时间进入平台会话，服务没有开始。  " }
    );

    expect(queryCalls[0]).toContain('"Order"');
    expect(queryCalls[1]).toContain('"SupportTicket"');
    expect(tx.orderSupportFact.create).toHaveBeenCalledWith({
      data: {
        supportTicketId: "ticket-1",
        orderId: "order-1",
        submittedByUserId: "customer-1",
        statement: "我在约定时间进入平台会话，服务没有开始。"
      }
    });
    expect(tx.supportTicket.update).toHaveBeenCalledWith({
      where: { id: "ticket-1" },
      data: { updatedAt: expect.any(Date) }
    });
    expect(commercial.holdForOrder).not.toHaveBeenCalled();
    const auditInput = audit.record.mock.calls.at(-1)?.[0];
    expect(auditInput).toEqual(expect.objectContaining({
      action: "support.order_fact_added",
      resourceId: "ticket-1",
      metadata: expect.objectContaining({ orderId: "order-1", orderSupportFactId: "fact-1" })
    }));
    expect(auditInput.metadata).not.toHaveProperty("statement");
    expect(result).toEqual({
      id: "fact-1",
      statement: "我在约定时间进入平台会话，服务没有开始。",
      evidenceAttachments: [],
      createdAt: createdAt.toISOString()
    });
  });

  it("rejects obvious identity, contact, document, and health material before it enters the support record", async () => {
    await expect(service.addOrderFact(
      { id: "customer-1" } as any,
      "ticket-1",
      { statement: "我的身份证号是 11010519491231002X，请按这个处理。" }
    )).rejects.toMatchObject({ code: "SUPPORT_ORDER_FACT_SENSITIVE_CONTENT" });

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects media evidence before an order fact transaction can create any business record", async () => {
    const unavailable = Object.assign(new Error("media disabled"), {
      code: "MEDIA_FEATURE_DISABLED",
      status: 503
    });
    caseEvidence.assertAttachmentsAllowed.mockImplementation(() => {
      throw unavailable;
    });

    await expect(service.addOrderFact(
      { id: "customer-1" } as any,
      "ticket-1",
      {
        statement: "我需要补充一段可核对的履约事实。",
        evidenceAssetIds: ["11111111-1111-4111-8111-111111111111"]
      }
    )).rejects.toBe(unavailable);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(caseEvidence.bindSupportFact).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(notifications.createTransactional).not.toHaveBeenCalled();
  });

  it("does not let another person probe or append to a requester's order support ticket", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      supportTicket: {
        findUnique: jest.fn()
          .mockResolvedValueOnce({ orderId: "order-1" })
          .mockResolvedValueOnce({
            id: "ticket-1",
            userId: "customer-1",
            orderId: "order-1",
            category: "orderIssue",
            status: "open",
            order: {
              id: "order-1",
              userId: "customer-1",
              companion: { ownerUserId: "companion-owner" }
            }
          }),
        update: jest.fn()
      },
      orderSupportFact: { count: jest.fn(), create: jest.fn() }
    };
    prisma.$transaction.mockImplementation(async (callback: (db: any) => Promise<unknown>) => callback(tx));

    await expect(service.addOrderFact(
      { id: "unrelated-user" } as any,
      "ticket-1",
      { statement: "我不应能查看或补充该工单。" }
    )).rejects.toMatchObject({ code: "SUPPORT_TICKET_NOT_FOUND" });

    expect(tx.orderSupportFact.create).not.toHaveBeenCalled();
    expect(tx.supportTicket.update).not.toHaveBeenCalled();
  });

  it("keeps closed order support tickets immutable and lists only the requester's own facts", async () => {
    const createdAt = new Date("2026-07-20T08:00:00.000Z");
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      supportTicket: {
        findUnique: jest.fn()
          .mockResolvedValueOnce({ orderId: "order-1" })
          .mockResolvedValueOnce({
            id: "ticket-1",
            userId: "customer-1",
            orderId: "order-1",
            category: "refund",
            status: "resolved",
            order: {
              id: "order-1",
              userId: "customer-1",
              companion: { ownerUserId: "companion-owner" }
            }
          }),
        update: jest.fn()
      },
      orderSupportFact: { count: jest.fn(), create: jest.fn() }
    };
    prisma.$transaction.mockImplementation(async (callback: (db: any) => Promise<unknown>) => callback(tx));

    await expect(service.addOrderFact(
      { id: "customer-1" } as any,
      "ticket-1",
      { statement: "客服结论作出后不应继续追加事实。" }
    )).rejects.toMatchObject({ code: "SUPPORT_TICKET_CLOSED" });
    expect(tx.orderSupportFact.create).not.toHaveBeenCalled();

    const findMany = jest.fn().mockResolvedValue([{
      id: "ticket-1",
      userId: "customer-1",
      orderId: "order-1",
      category: "refund",
      priority: "high",
      status: "inProgress",
      subject: "退款情况",
      body: "请核对退款进度。",
      dueAt: null,
      resolution: null,
      resolutionCode: null,
      resolvedAt: null,
      createdAt,
      updatedAt: createdAt,
      order: null,
      orderFacts: [{
        id: "fact-own",
        submittedByUserId: "customer-1",
        statement: "我已核对到账记录。",
        createdAt
      }]
    }]);
    prisma.supportTicket = { findMany, count: jest.fn().mockResolvedValue(1) };

    const listed = await service.listMine("customer-1");
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: "customer-1" },
      include: expect.objectContaining({
        orderFacts: expect.objectContaining({
          where: { submittedByUserId: "customer-1" },
          orderBy: { createdAt: "asc" }
        })
      })
    }));
    const listedOrderFacts = (listed.items[0] as any).orderFacts;
    expect(listedOrderFacts).toEqual([{
      id: "fact-own",
      statement: "我已核对到账记录。",
      evidenceAttachments: [],
      createdAt: createdAt.toISOString()
    }]);
    expect(listedOrderFacts[0]).not.toHaveProperty("submittedByUserId");
  });

  it("provides stable requester-owned detail and paginated by-order tickets without operational identities", async () => {
    const createdAt = new Date("2026-08-01T08:00:00.000Z");
    const ticket = {
      id: "ticket-owned",
      userId: "customer-1",
      orderId: "order-1",
      category: "orderIssue",
      priority: "normal",
      status: "open",
      subject: "订单状态核对",
      body: "请核对订单当前处理状态。",
      dueAt: null,
      resolution: null,
      resolutionCode: null,
      resolvedAt: null,
      createdAt,
      updatedAt: createdAt,
      order: null,
      requester: { id: "customer-1" },
      assignedTo: { id: "support-private" },
      orderFacts: []
    };
    const findMany = jest.fn().mockResolvedValue([ticket]);
    const findFirst = jest.fn().mockResolvedValue(ticket);
    prisma.supportTicket = {
      findMany,
      findFirst,
      count: jest.fn().mockResolvedValue(6)
    };

    const page = await service.listMine(
      "customer-1",
      { page: 2, pageSize: 5, status: "open" },
      "order-1"
    );
    const detail = await service.getMine("customer-1", "ticket-owned");

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: "customer-1", orderId: "order-1", status: "open" },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      skip: 5,
      take: 5
    }));
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "ticket-owned", userId: "customer-1" },
      include: expect.objectContaining({
        orderFacts: expect.objectContaining({
          where: { submittedByUserId: "customer-1" },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }]
        })
      })
    }));
    expect(page.pagination).toEqual({ page: 2, pageSize: 5, total: 6, totalPages: 2 });
    expect(detail).toMatchObject({ id: "ticket-owned", orderId: "order-1" });
    expect(detail).not.toHaveProperty("requester");
    expect(detail).not.toHaveProperty("assignedTo");
  });

  it("caps repeated facts on one private support ticket without creating a new dispute", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      supportTicket: {
        findUnique: jest.fn()
          .mockResolvedValueOnce({ orderId: "order-1" })
          .mockResolvedValueOnce({
            id: "ticket-1",
            userId: "customer-1",
            orderId: "order-1",
            category: "orderIssue",
            status: "open",
            order: {
              id: "order-1",
              userId: "customer-1",
              companion: { ownerUserId: "companion-owner" }
            }
          }),
        update: jest.fn()
      },
      orderSupportFact: { count: jest.fn().mockResolvedValue(10), create: jest.fn() }
    };
    prisma.$transaction.mockImplementation(async (callback: (db: any) => Promise<unknown>) => callback(tx));

    await expect(service.addOrderFact(
      { id: "customer-1" } as any,
      "ticket-1",
      { statement: "我还需要补充一次履约时间记录。" }
    )).rejects.toMatchObject({ code: "SUPPORT_ORDER_FACT_LIMIT_REACHED", details: { limit: 10 } });
    expect(tx.orderSupportFact.create).not.toHaveBeenCalled();
    expect(commercial.holdForOrder).not.toHaveBeenCalled();
  });

  it("limits a support operator's queue to tickets assigned to that operator", async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(0);
    prisma.supportTicket = { findMany, count };

    await service.listAdmin(
      { id: "support-1", role: "support" } as any,
      { page: 1, pageSize: 50, status: "inProgress" }
    );

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        status: "inProgress",
        assignedToUserId: "support-1"
      }
    }));
    expect(count).toHaveBeenCalledWith({
      where: {
        status: "inProgress",
        assignedToUserId: "support-1"
      }
    });
  });

  it("lets an administrator request the assigned queue independently from claimable tickets", async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(0);
    prisma.supportTicket = { findMany, count };

    await service.listAdmin(
      { id: "admin-1", role: "admin" } as any,
      { page: 3, pageSize: 25, assignedOnly: true }
    );

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { assignedToUserId: { not: null } },
      orderBy: [{ priority: "desc" }, { dueAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      skip: 50,
      take: 25
    }));
    expect(count).toHaveBeenCalledWith({ where: { assignedToUserId: { not: null } } });
  });

  it("returns only a minimal anonymous summary for unassigned claimable tickets", async () => {
    const dueAt = new Date("2026-08-01T08:00:00.000Z");
    const findMany = jest.fn().mockResolvedValue([{
      id: "ticket-claimable",
      category: "refund",
      priority: "high",
      dueAt,
      orderId: "order-1",
      subject: "must-not-leak",
      body: "must-not-leak",
      requester: { id: "customer-1" }
    }]);
    const count = jest.fn().mockResolvedValue(1);
    prisma.supportTicket = { findMany, count };

    const result = await service.listClaimable({ page: 1, pageSize: 50 });

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        assignedToUserId: null,
        status: { in: ["open", "inProgress"] }
      },
      select: {
        id: true,
        category: true,
        priority: true,
        dueAt: true,
        orderId: true
      }
    }));
    expect(result.items).toEqual([{
      id: "ticket-claimable",
      category: "refund",
      priority: "high",
      dueAt: dueAt.toISOString(),
      hasOrder: true
    }]);
    expect(JSON.stringify(result)).not.toContain("must-not-leak");
    expect(JSON.stringify(result)).not.toContain("customer-1");
    expect(JSON.stringify(result)).not.toContain("order-1");
  });

  it("claims an anonymous ticket with a compare-and-set update before returning its details", async () => {
    const createdAt = new Date("2026-07-31T08:00:00.000Z");
    const updated = {
      id: "ticket-1",
      userId: "customer-1",
      orderId: null,
      category: "general",
      priority: "normal",
      status: "inProgress",
      subject: "需要帮助",
      body: "请协助处理。",
      assignedToUserId: "support-1",
      assignedTo: { id: "support-1", profile: { displayName: "客服一" } },
      requester: { id: "customer-1", profile: { displayName: "用户" } },
      orderFacts: [],
      order: null,
      dueAt: null,
      resolution: null,
      resolutionCode: null,
      resolvedAt: null,
      createdAt,
      updatedAt: createdAt
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: "support-1",
          role: "support",
          accountStatus: "active"
        })
      },
      supportTicket: {
        findUnique: jest.fn().mockResolvedValue({ orderId: null }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(updated)
      }
    };
    prisma.$transaction.mockImplementation(async (callback: (db: any) => Promise<unknown>) => callback(tx));

    await expect(service.claim("support-1", "ticket-1")).resolves.toMatchObject({
      id: "ticket-1",
      status: "inProgress",
      body: "请协助处理。"
    });
    expect(tx.supportTicket.updateMany).toHaveBeenCalledWith({
      where: {
        id: "ticket-1",
        assignedToUserId: null,
        status: { in: ["open", "inProgress"] }
      },
      data: { assignedToUserId: "support-1", status: "inProgress" }
    });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      actorId: "support-1",
      action: "support.ticket_claimed"
    }), tx);
  });

  it("allows an administrator to assign a ticket to active support staff and audits the ownership change", async () => {
    const createdAt = new Date("2026-07-31T08:00:00.000Z");
    const ticket = {
      id: "ticket-1",
      userId: "customer-1",
      orderId: null,
      category: "general",
      priority: "normal",
      status: "open",
      subject: "需要帮助",
      body: "请协助处理。",
      assignedToUserId: null,
      dueAt: null,
      resolution: null,
      resolutionCode: null,
      resolvedAt: null,
      createdAt,
      updatedAt: createdAt
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      supportTicket: {
        findUnique: jest.fn()
          .mockResolvedValueOnce({ orderId: null })
          .mockResolvedValueOnce(ticket),
        update: jest.fn().mockResolvedValue({
          ...ticket,
          assignedToUserId: "support-1",
          status: "inProgress"
        })
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: "support-1",
          role: "support",
          accountStatus: "active"
        })
      }
    };
    prisma.$transaction.mockImplementation(async (callback: (db: any) => Promise<unknown>) => callback(tx));

    await expect(service.assign(
      { id: "admin-1", role: "admin" } as any,
      "ticket-1",
      "support-1"
    )).resolves.toMatchObject({ id: "ticket-1", status: "inProgress" });

    expect(tx.supportTicket.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "ticket-1" },
      data: { assignedToUserId: "support-1", status: "inProgress" }
    }));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      actorId: "admin-1",
      action: "support.ticket_assigned",
      metadata: {
        actorRole: "admin",
        previousAssignedToUserId: null,
        assignedToUserId: "support-1"
      }
    }), tx);
  });

  it("prevents support staff from assigning a ticket to another operator", async () => {
    await expect(service.assign(
      { id: "support-1", role: "support" } as any,
      "ticket-1",
      "support-2"
    )).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("does not let support staff steal a ticket already assigned to another operator", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      supportTicket: {
        findUnique: jest.fn()
          .mockResolvedValueOnce({ orderId: null })
          .mockResolvedValueOnce({
            status: "inProgress",
            assignedToUserId: "support-2"
          }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUniqueOrThrow: jest.fn()
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: "support-1",
          role: "support",
          accountStatus: "active"
        })
      }
    };
    prisma.$transaction.mockImplementation(async (callback: (db: any) => Promise<unknown>) => callback(tx));

    await expect(service.claim("support-1", "ticket-1"))
      .rejects.toMatchObject({ code: "SUPPORT_TICKET_ALREADY_ASSIGNED" });
    expect(tx.supportTicket.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it("rejects assigning a commercial support ticket to a content-only moderator", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      supportTicket: {
        findUnique: jest.fn()
          .mockResolvedValueOnce({ orderId: null })
          .mockResolvedValueOnce({ id: "ticket-1", status: "open" }),
        update: jest.fn()
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: "moderator-1", role: "moderator", accountStatus: "active" })
      }
    };
    prisma.$transaction.mockImplementation(async (callback: (db: any) => Promise<unknown>) => callback(tx));

    await expect(service.assign(
      { id: "admin-1", role: "admin" } as any,
      "ticket-1",
      "moderator-1"
    ))
      .rejects.toMatchObject({ code: "SUPPORT_ASSIGNEE_INVALID" });
    expect(tx.supportTicket.update).not.toHaveBeenCalled();
  });

  it("resolves an order-linked ticket under Order then SupportTicket locks", async () => {
    const createdAt = new Date("2026-07-20T05:00:00.000Z");
    const ticket = {
      id: "ticket-1",
      userId: "customer-1",
      orderId: "order-1",
      category: "orderIssue",
      priority: "high",
      status: "open",
      subject: "服务时间异常",
      body: "预约服务没有按时开始。",
      assignedToUserId: "admin-1",
      dueAt: new Date("2026-07-21T05:00:00.000Z"),
      resolution: null,
      resolvedAt: null,
      createdAt,
      updatedAt: createdAt,
      order: { status: "completed", amountCents: 10000, scheduledAt: createdAt }
    };
    const updated = {
      ...ticket,
      status: "resolved",
      resolution: "已核实并补偿",
      resolvedAt: new Date("2026-07-20T06:00:00.000Z")
    };
    const queryCalls: string[] = [];
    const tx = {
      $queryRaw: jest.fn().mockImplementation(async (strings: TemplateStringsArray) => {
        queryCalls.push(String(strings[0]));
        return [];
      }),
      supportTicket: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({ orderId: "order-1" })
          .mockResolvedValueOnce(ticket),
        update: jest.fn().mockResolvedValue(updated)
      }
    };
    prisma.$transaction.mockImplementation(async (callback: (db: any) => Promise<unknown>) => callback(tx));

    const result = await service.resolve("admin-1", "ticket-1", {
      status: "resolved",
      resolution: "  已核实并补偿  ",
      resolutionCode: "noRefund"
    });

    expect(queryCalls[0]).toContain('"Order"');
    expect(queryCalls[1]).toContain('"SupportTicket"');
    expect(tx.supportTicket.update).toHaveBeenCalledWith({
      where: { id: "ticket-1" },
      data: expect.objectContaining({
        status: "resolved",
        resolution: "已核实并补偿",
        resolutionCode: "noRefund"
      }),
      include: { order: true }
    });
    expect(notifications.createTransactional).toHaveBeenCalledWith(tx, expect.objectContaining({
      type: "supportUpdate",
      eventKey: "support:ticket-1:resolved"
    }));
    expect(result).toEqual(expect.objectContaining({ id: "ticket-1", status: "resolved" }));
  });

  it("keeps resolution restricted to the current assignee after the ticket lock", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      supportTicket: {
        findUnique: jest.fn()
          .mockResolvedValueOnce({ orderId: "order-1" })
          .mockResolvedValueOnce({
            id: "ticket-1",
            orderId: "order-1",
            status: "inProgress",
            assignedToUserId: "support-2",
            order: { id: "order-1" }
          }),
        update: jest.fn()
      }
    };
    prisma.$transaction.mockImplementation(async (callback: (db: any) => Promise<unknown>) => callback(tx));

    await expect(service.resolve("support-1", "ticket-1", {
      status: "resolved",
      resolution: "已完成核验",
      resolutionCode: "noRefund"
    })).rejects.toMatchObject({ code: "SUPPORT_TICKET_ASSIGNEE_REQUIRED" });
    expect(tx.supportTicket.update).not.toHaveBeenCalled();
  });
});
