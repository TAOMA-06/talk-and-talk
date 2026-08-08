import { AdminOperationsController } from "./admin-operations.controller";
import { ROLES_KEY } from "../auth/decorators/roles.decorator";

describe("AdminOperationsController", () => {
  const prisma = {
    order: { findMany: jest.fn(), count: jest.fn() },
    user: { findMany: jest.fn(), count: jest.fn() },
    auditLog: { findMany: jest.fn(), count: jest.fn() }
  };
  const controller = new AdminOperationsController(prisma as any);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns an explicitly separate review boundary", () => {
    const result = controller.context({ id: "admin-1", role: "admin" });
    expect(result.operator).toEqual({ id: "admin-1", role: "admin" });
    expect(result.dataScopes).toEqual({
      orders: "all",
      supportTickets: "all",
      claimableSupportTickets: "allViaFullQueue",
      paymentDisputes: "all",
      paymentReconciliation: "allFinancial",
      dataRights: "all",
      identityVerification: "allKycWorkflow",
      customerAdultEligibility: "allAdultEligibilityWorkflow",
      staffCredentials: "allCommercialStaff",
      users: "all"
    });
    expect(result.boundaries).toEqual({
      reviewDepartment: "separateIdentityDomain",
      destructiveActionsDefault: "readOnly"
    });
  });

  it("publishes scoped capabilities and data boundaries for each commercial role", () => {
    const support = controller.context({ id: "support-1", role: "support" });
    expect(support.capabilities).toEqual(expect.arrayContaining([
      "support.ticket.assigned.read",
      "support.ticket.claimable-summary.read",
      "support.order.assigned.read",
      "support.claim.self",
      "support.resolve.assigned",
      "support.refund.assigned",
      "payment-dispute.queue.read",
      "payment-dispute.claim.self",
      "payment-dispute.reply.assigned",
      "payment-dispute.sync",
      "data-rights.assigned.manage",
      "data-rights.claimable-summary.read",
      "data-rights.claim.self"
    ]));
    expect(support.capabilities).not.toEqual(expect.arrayContaining([
      "order.read.all",
      "user.read.all",
      "support.ticket.all.read"
    ]));
    expect(support.dataScopes).toEqual({
      orders: "assignedSupportTickets",
      supportTickets: "assignedToOperator",
      claimableSupportTickets: "unassignedSummaryOnly",
      paymentDisputes: "assignedToOperatorPlusUnassignedSummary",
      paymentReconciliation: "none",
      dataRights: "assignedToOperatorPlusUnassignedSummary",
      identityVerification: "none",
      customerAdultEligibility: "none",
      staffCredentials: "none",
      users: "none"
    });

    for (const role of ["finance", "supply", "operations"]) {
      const context = controller.context({ id: `${role}-1`, role });
      expect(context.capabilities).not.toContain("user.read.all");
      expect(context.dataScopes.users).toBe("none");
    }
    const supply = controller.context({ id: "supply-1", role: "supply" });
    expect(supply.dataScopes.orders).toBe("none");
    expect(supply.dataScopes.identityVerification).toBe("allKycWorkflow");
    expect(supply.capabilities).toContain("companion.verification.manage");
    expect(supply.capabilities).toContain("companion.lifecycle.supply.manage");
    expect(supply.capabilities).not.toContain("companion.lifecycle.manage");
    expect(supply.capabilities).not.toContain("companion.withdrawal.manage");

    const finance = controller.context({ id: "finance-1", role: "finance" });
    expect(finance.capabilities).toContain("companion.withdrawal.manage");
    expect(finance.capabilities).toContain("payment-dispute.financial.read");
    expect(finance.capabilities).toContain("payment-reconciliation.manage");
    expect(finance.capabilities).toContain("commercial.ops-metrics.read");
    expect(finance.dataScopes.paymentDisputes).toBe("financialFactsOnly");
    expect(finance.capabilities).not.toContain("companion.lifecycle.supply.manage");
  });

  it("declares full order and user enumeration only on the intended route roles", () => {
    expect(Reflect.getMetadata(ROLES_KEY, controller.orders)).toEqual([
      "finance",
      "operations",
      "admin"
    ]);
    expect(Reflect.getMetadata(ROLES_KEY, controller.supportOrders)).toEqual(["support"]);
    expect(Reflect.getMetadata(ROLES_KEY, controller.users)).toEqual(["admin"]);
    expect(Reflect.getMetadata(ROLES_KEY, controller.supportAssignees)).toEqual(["admin"]);
  });

  it("searches only active support or admin assignees with bounded pagination and a minimal response", async () => {
    prisma.user.findMany.mockResolvedValue([{
      id: "support-1",
      role: "support",
      profile: { displayName: "客服小林" },
      createdAt: new Date("2026-07-31T00:00:00.000Z")
    }]);
    prisma.user.count.mockResolvedValue(1);

    const result = await controller.supportAssignees({ keyword: "小林", page: 2, pageSize: 20 });

    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        role: { in: ["support", "admin"] },
        accountStatus: "active",
        OR: expect.any(Array)
      }),
      select: {
        id: true,
        role: true,
        profile: { select: { displayName: true } },
        createdAt: true
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: 20,
      take: 20
    }));
    expect(result).toEqual({
      items: [{ id: "support-1", role: "support", displayName: "客服小林" }],
      pagination: { page: 2, pageSize: 20, total: 1, totalPages: 1 }
    });
    expect(JSON.stringify(result)).not.toContain("phone");
  });

  it("scopes the support order endpoint to orders and active ticket facts assigned to the actor", async () => {
    prisma.order.findMany.mockResolvedValue([]);
    prisma.order.count.mockResolvedValue(0);

    await controller.supportOrders(
      { id: "support-1", role: "support" },
      { page: 1, pageSize: 50 }
    );

    const findManyInput = prisma.order.findMany.mock.calls[0][0];
    const countInput = prisma.order.count.mock.calls[0][0];
    expect(findManyInput.where).toEqual(expect.objectContaining({
      supportTickets: { some: { assignedToUserId: "support-1" } }
    }));
    expect(findManyInput.include.supportTickets.where).toEqual({
      status: { in: ["open", "inProgress"] },
      assignedToUserId: "support-1"
    });
    expect(countInput.where).toEqual(expect.objectContaining({
      supportTickets: { some: { assignedToUserId: "support-1" } }
    }));
  });

  it("masks payment references in the order workbench response", async () => {
    prisma.order.findMany.mockResolvedValue([{
      id: "order-1",
      status: "paid",
      amountCents: 12_800,
      currency: "CNY",
      serviceOfferingTitleSnapshot: "30 分钟语音陪伴",
      serviceOfferingDeliveryModeSnapshot: "voice",
      durationMinutes: 30,
      scheduledAt: new Date("2026-07-31T10:00:00.000Z"),
      createdAt: new Date("2026-07-30T10:00:00.000Z"),
      updatedAt: new Date("2026-07-30T10:05:00.000Z"),
      user: { id: "user-1", profile: { displayName: "匿名用户" } },
      companion: { id: "companion-1", name: "陪伴者" },
      payments: [{
        id: "payment-1",
        status: "success",
        outTradeNo: "TALK202607310000123456",
        amountCents: 12_800,
        paidAt: new Date("2026-07-30T10:04:00.000Z"),
        updatedAt: new Date("2026-07-30T10:04:00.000Z")
      }],
      refunds: [],
      supportTickets: []
    }]);
    prisma.order.count.mockResolvedValue(1);

    const result = await controller.orders(
      { id: "finance-1", role: "finance" },
      { page: 1, pageSize: 50 }
    );

    expect(result.items[0].payment?.referenceMasked).toBe("TALK20••••3456");
    expect(JSON.stringify(result)).not.toContain("TALK202607310000123456");
    const orderQuery = prisma.order.findMany.mock.calls[0][0];
    expect(orderQuery.include).not.toHaveProperty("supportTickets");
    expect(orderQuery.include.payments.orderBy).toEqual([
      { createdAt: "desc" },
      { id: "desc" }
    ]);
    expect(orderQuery.include.refunds.orderBy).toEqual([
      { createdAt: "desc" },
      { id: "desc" }
    ]);
    expect(result.items[0]).not.toHaveProperty("activeSupportTickets");
  });

  it("removes customer identity, financial references, and ticket details from operations orders", async () => {
    prisma.order.findMany.mockResolvedValue([{
      id: "order-1",
      status: "paid",
      amountCents: 12_800,
      currency: "CNY",
      serviceOfferingTitleSnapshot: "30 分钟语音陪伴",
      serviceOfferingDeliveryModeSnapshot: "voice",
      durationMinutes: 30,
      scheduledAt: new Date("2026-07-31T10:00:00.000Z"),
      createdAt: new Date("2026-07-30T10:00:00.000Z"),
      updatedAt: new Date("2026-07-30T10:05:00.000Z"),
      companion: { id: "companion-1", name: "陪伴者" },
      payments: [{
        id: "payment-secret",
        status: "success",
        outTradeNo: "TALK202607310000123456",
        amountCents: 12_800,
        paidAt: new Date("2026-07-30T10:04:00.000Z"),
        updatedAt: new Date("2026-07-30T10:04:00.000Z")
      }],
      refunds: [{
        id: "refund-secret",
        status: "pending",
        outRefundNo: "REFUND202607310000123456",
        amountCents: 12_800,
        failureReason: "internal-detail",
        updatedAt: new Date("2026-07-30T10:04:00.000Z")
      }],
      _count: { supportTickets: 2 },
      user: { id: "customer-secret", profile: { displayName: "客户秘密" } },
      supportTickets: [{ id: "ticket-secret" }]
    }]);
    prisma.order.count.mockResolvedValue(1);

    const result = await controller.orders(
      { id: "operations-1", role: "operations" },
      { page: 1, pageSize: 50, keyword: "陪伴" }
    );

    const query = prisma.order.findMany.mock.calls[0][0];
    expect(query.include).not.toHaveProperty("user");
    expect(query.include).not.toHaveProperty("supportTickets");
    expect(query.include.payments.select).not.toHaveProperty("id");
    expect(query.include.payments.select).not.toHaveProperty("outTradeNo");
    expect(query.include.refunds.select).not.toHaveProperty("id");
    expect(query.include.refunds.select).not.toHaveProperty("outRefundNo");
    expect(query.where.OR).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ user: expect.anything() })
    ]));
    expect(result.items[0]).toMatchObject({ activeSupportTicketCount: 2 });
    expect(JSON.stringify(result)).not.toContain("customer-secret");
    expect(JSON.stringify(result)).not.toContain("客户秘密");
    expect(JSON.stringify(result)).not.toContain("TALK202607310000123456");
    expect(JSON.stringify(result)).not.toContain("REFUND202607310000123456");
    expect(JSON.stringify(result)).not.toContain("ticket-secret");
    expect(JSON.stringify(result)).not.toContain("internal-detail");
  });

  it("masks phone numbers and never returns identity providers", async () => {
    prisma.user.findMany.mockResolvedValue([{
      id: "user-1",
      role: "user",
      accountStatus: "active",
      profile: {
        displayName: "用户",
        phone: "+8613800000001",
        isVerified: true,
        safetyScore: 90
      },
      companionProfile: null,
      _count: { orders: 2, supportTickets: 1, deletionRequests: 0 },
      createdAt: new Date("2026-07-01T00:00:00.000Z"),
      updatedAt: new Date("2026-07-02T00:00:00.000Z")
    }]);
    prisma.user.count.mockResolvedValue(1);

    const result = await controller.users({ page: 1, pageSize: 50 });

    expect(result.items[0].phoneMasked).toBe("138****0001");
    expect(JSON.stringify(result)).not.toContain("+8613800000001");
  });

  it("redacts sensitive audit metadata before returning it", async () => {
    prisma.auditLog.findMany.mockResolvedValue([{
      id: "audit-1",
      actorId: "admin-1",
      action: "test",
      resourceType: "order",
      resourceId: "order-1",
      metadata: { accessToken: "secret-token", phone: "13800000001" },
      createdAt: new Date("2026-07-31T00:00:00.000Z")
    }]);
    prisma.auditLog.count.mockResolvedValue(1);

    const result = await controller.auditLogs({ page: 1, pageSize: 50 });

    expect(result.items[0].metadata).toEqual({
      accessToken: "[REDACTED]",
      phone: "138****0001"
    });
  });
});
