import { SupportService } from "./support.service";

describe("SupportService", () => {
  const prisma = {
    order: { findUnique: jest.fn() },
    $transaction: jest.fn()
  } as any;
  const config = { get: jest.fn().mockReturnValue(24) } as any;
  const commercial = { holdForOrder: jest.fn().mockResolvedValue(1) } as any;
  const audit = { record: jest.fn().mockResolvedValue(undefined) } as any;
  const notifications = { createTransactional: jest.fn().mockResolvedValue(undefined) } as any;
  let service: SupportService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SupportService(prisma, config, commercial, audit, notifications);
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
    prisma.supportTicket = { findMany };

    const listed = await service.listMine("customer-1");
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: "customer-1" },
      include: expect.objectContaining({
        orderFacts: { where: { submittedByUserId: "customer-1" }, orderBy: { createdAt: "asc" } }
      })
    }));
    const listedOrderFacts = (listed.items[0] as any).orderFacts;
    expect(listedOrderFacts).toEqual([{
      id: "fact-own",
      statement: "我已核对到账记录。",
      createdAt: createdAt.toISOString()
    }]);
    expect(listedOrderFacts[0]).not.toHaveProperty("submittedByUserId");
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

    await expect(service.assign("admin-1", "ticket-1", "moderator-1"))
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
});
