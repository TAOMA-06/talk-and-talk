import { UserAccountActionsService } from "./user-account-actions.service";

const prisma = {
  user: {
    findUnique: jest.fn(),
    update: jest.fn()
  },
  accountDeletionRequest: {
    findFirst: jest.fn()
  },
  userAccountAction: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn()
  },
  userAccountAppeal: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn()
  },
  refreshToken: {
    updateMany: jest.fn()
  },
  order: {
    count: jest.fn()
  },
  refundTransaction: {
    count: jest.fn()
  },
  paymentDispute: {
    count: jest.fn(),
    findFirst: jest.fn()
  },
  attendanceDispute: {
    count: jest.fn(),
    findFirst: jest.fn()
  },
  supportTicket: {
    count: jest.fn(),
    findFirst: jest.fn()
  },
  moderationCase: {
    findFirst: jest.fn()
  },
  conversation: {
    findFirst: jest.fn()
  },
  $queryRaw: jest.fn(),
  $transaction: jest.fn()
};

const audit = { record: jest.fn() };
const notifications = { create: jest.fn() };

const ordinaryUser = (overrides: Record<string, unknown> = {}) => ({
  id: "user-1",
  role: "user",
  accountStatus: "restricted",
  companionProfile: null,
  staffCredential: null,
  ...overrides
});

const administrator = (id = "admin-2") => ({
  id,
  role: "admin",
  accountStatus: "active"
});

const action = (overrides: Record<string, unknown> = {}) => ({
  id: "action-1",
  userId: "user-1",
  kind: "restriction",
  reasonCode: "POLICY_BOUNDARY",
  message: "多次违反平台安全边界，账号暂时受限。",
  policyVersion: "2026.1",
  sourceType: "manualSafetyReview",
  sourceReference: "safety-review/case-1",
  evidenceReference: "evidence-vault/item-1",
  evidenceDigest: "a".repeat(64),
  evidenceAnonymizedAt: null,
  startsAt: new Date("2026-08-01T00:00:00.000Z"),
  endsAt: null,
  appealDeadlineAt: new Date("2026-08-31T00:00:00.000Z"),
  createdById: "admin-1",
  revokedAt: null,
  revokedById: null,
  createdAt: new Date("2026-08-01T00:00:00.000Z"),
  updatedAt: new Date("2026-08-01T00:00:00.000Z"),
  appeal: null,
  ...overrides
});

const appeal = (overrides: Record<string, unknown> = {}) => ({
  id: "appeal-1",
  actionId: "action-1",
  userId: "user-1",
  statement: "我认为该处置依据不完整，请重新核验全部事实。",
  status: "pending",
  reviewDueAt: new Date("2026-08-04T00:00:00.000Z"),
  assignedToUserId: null,
  assignedAt: null,
  resolution: null,
  resolvedAt: null,
  resolvedById: null,
  policyVersion: "2026.1",
  createdAt: new Date("2026-08-01T00:00:00.000Z"),
  updatedAt: new Date("2026-08-01T00:00:00.000Z"),
  ...overrides
});

describe("UserAccountActionsService", () => {
  let service: UserAccountActionsService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date("2026-08-01T00:00:00.000Z"));
    prisma.$transaction.mockImplementation(async (callback: (db: typeof prisma) => unknown) => callback(prisma));
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.accountDeletionRequest.findFirst.mockResolvedValue(null);
    prisma.userAccountAction.findFirst.mockResolvedValue(null);
    prisma.userAccountAction.findMany.mockResolvedValue([]);
    prisma.userAccountAppeal.findMany.mockResolvedValue([]);
    prisma.userAccountAppeal.count.mockResolvedValue(0);
    prisma.user.update.mockImplementation(async ({ data }: any) => ({ id: "user-1", ...data }));
    prisma.userAccountAction.updateMany.mockResolvedValue({ count: 1 });
    prisma.userAccountAction.count.mockResolvedValue(0);
    prisma.refreshToken.updateMany.mockResolvedValue({ count: 2 });
    prisma.order.count.mockResolvedValue(0);
    prisma.refundTransaction.count.mockResolvedValue(0);
    prisma.paymentDispute.count.mockResolvedValue(0);
    prisma.attendanceDispute.count.mockResolvedValue(0);
    prisma.supportTicket.count.mockResolvedValue(0);
    prisma.moderationCase.findFirst.mockResolvedValue(null);
    prisma.supportTicket.findFirst.mockResolvedValue(null);
    prisma.paymentDispute.findFirst.mockResolvedValue(null);
    prisma.attendanceDispute.findFirst.mockResolvedValue(null);
    prisma.conversation.findFirst.mockResolvedValue(null);
    audit.record.mockResolvedValue({});
    notifications.create.mockResolvedValue({});
    service = new UserAccountActionsService(prisma as any, audit as any, notifications as any);
  });

  afterEach(() => jest.useRealTimers());

  it("returns the stable locked-account action and appeal contract without staff identities", async () => {
    prisma.user.findUnique.mockResolvedValue(ordinaryUser());
    const pendingAppeal = appeal();
    prisma.userAccountAction.findMany.mockResolvedValue([
      action({ appeal: pendingAppeal })
    ]);
    prisma.userAccountAction.count.mockResolvedValue(1);

    await expect(service.listMy("user-1")).resolves.toEqual({
      accountStatus: "restricted",
      items: [{
        id: "action-1",
        kind: "restriction",
        reasonCode: "POLICY_BOUNDARY",
        message: "多次违反平台安全边界，账号暂时受限。",
        policyVersion: "2026.1",
        startsAt: "2026-08-01T00:00:00.000Z",
        endsAt: null,
        appealDeadlineAt: "2026-08-31T00:00:00.000Z",
        revokedAt: null,
        canAppeal: false,
        appeal: {
          id: "appeal-1",
          status: "pending",
          statement: "我认为该处置依据不完整，请重新核验全部事实。",
          reviewDueAt: "2026-08-04T00:00:00.000Z",
          overdue: false,
          resolution: null,
          resolvedAt: null,
          policyVersion: "2026.1",
          createdAt: "2026-08-01T00:00:00.000Z"
        }
      }],
      pagination: { page: 1, pageSize: 50, total: 1, totalPages: 1 }
    });
  });

  it("creates a formal ban, revokes refresh tokens, notifies the subject and audits both records", async () => {
    prisma.user.findUnique.mockImplementation(async ({ where }: any) =>
      where.id === "admin-1"
        ? administrator("admin-1")
        : ordinaryUser({ accountStatus: "active" })
    );
    prisma.userAccountAction.create.mockImplementation(async ({ data }: any) => action({
      ...data,
      id: "action-new",
      kind: "ban",
      appeal: null
    }));

    const result = await service.setAccountStatus("admin-1", "user-1", {
      status: "banned",
      reasonCode: "COMMERCIAL_ABUSE",
      reason: "核验到持续性商业滥用行为，账号现已封禁。",
      sourceType: "manualSafetyReview",
      sourceReference: "safety-review/case-100",
      evidenceReference: "evidence-vault/item-100"
    });

    expect(result).toEqual(expect.objectContaining({
      userId: "user-1",
      accountStatus: "banned",
      action: expect.objectContaining({
        id: "action-new",
        kind: "ban",
        reasonCode: "COMMERCIAL_ABUSE",
        policyVersion: "2026.1",
        appealDeadlineAt: "2026-08-31T00:00:00.000Z",
        canAppeal: true
      })
    }));
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: "user-1", revokedAt: null },
      data: { revokedAt: new Date("2026-08-01T00:00:00.000Z") }
    });
    expect(notifications.create).toHaveBeenCalledWith(
      "user-1",
      "safetyAlert",
      "账号已被封禁",
      expect.any(String),
      expect.objectContaining({ actionId: "action-new", policyVersion: "2026.1" }),
      prisma
    );
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      subjectUserIds: ["user-1"],
      action: "account.user_action_created",
      resourceId: "action-new",
      metadata: expect.objectContaining({
        sourceType: "manualSafetyReview",
        sourceReference: "safety-review/case-100",
        evidenceReference: "evidence-vault/item-100",
        evidenceDigest: expect.stringMatching(/^[a-f0-9]{64}$/)
      })
    }), prisma);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      subjectUserIds: ["user-1"],
      action: "account.status_updated",
      resourceId: "user-1"
    }), prisma);
    expect(prisma.order.count).toHaveBeenCalledWith({
      where: { userId: "user-1", status: { in: ["paying", "paid", "inService"] } }
    });
    expect(prisma.refundTransaction.count).toHaveBeenCalledWith({
      where: {
        order: { userId: "user-1" },
        status: { in: ["pendingReview", "pending", "processing"] }
      }
    });
    expect(prisma.paymentDispute.count).toHaveBeenCalledWith({
      where: { order: { userId: "user-1" }, status: { not: "resolved" } }
    });
    expect(prisma.attendanceDispute.count).toHaveBeenCalledWith({
      where: { order: { userId: "user-1" }, status: { not: "final" } }
    });
    expect(prisma.supportTicket.count).toHaveBeenCalledWith({
      where: { userId: "user-1", status: { in: ["open", "inProgress"] } }
    });
    expect(prisma.$queryRaw.mock.invocationCallOrder[0])
      .toBeLessThan(prisma.order.count.mock.invocationCallOrder[0]);
    expect(prisma.userAccountAction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sourceType: "manualSafetyReview",
        sourceReference: "safety-review/case-100",
        evidenceReference: "evidence-vault/item-100",
        evidenceDigest: expect.stringMatching(/^[a-f0-9]{64}$/)
      })
    });
  });

  it.each([
    { category: "orders", counter: prisma.order.count },
    { category: "refunds", counter: prisma.refundTransaction.count },
    { category: "paymentDisputes", counter: prisma.paymentDispute.count },
    { category: "attendanceDisputes", counter: prisma.attendanceDispute.count },
    { category: "supportTickets", counter: prisma.supportTicket.count }
  ])("blocks a new restriction while $category remain active", async ({ category, counter }) => {
    prisma.user.findUnique.mockImplementation(async ({ where }: any) =>
      where.id === "admin-1"
        ? administrator("admin-1")
        : ordinaryUser({ accountStatus: "active" })
    );
    counter.mockResolvedValue(1);

    await expect(service.setAccountStatus("admin-1", "user-1", {
      status: "restricted",
      reasonCode: "SAFETY_ESCALATION",
      reason: "安全事件先进入隔离和客服流程，商业义务结清后再执行账号处置。",
      sourceType: "manualSafetyReview",
      sourceReference: "safety-review/case-200",
      evidenceReference: "evidence-vault/item-200"
    })).rejects.toMatchObject({
      code: "ACCOUNT_ACTION_HAS_ACTIVE_COMMERCIAL_OBLIGATIONS",
      status: 409,
      details: {
        total: 1,
        counts: {
          orders: category === "orders" ? 1 : 0,
          refunds: category === "refunds" ? 1 : 0,
          paymentDisputes: category === "paymentDisputes" ? 1 : 0,
          attendanceDisputes: category === "attendanceDisputes" ? 1 : 0,
          supportTickets: category === "supportTickets" ? 1 : 0
        }
      }
    });
    expect(prisma.userAccountAction.create).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
    expect(notifications.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("restores account access without letting active commercial obligations block fulfillment", async () => {
    prisma.user.findUnique.mockImplementation(async ({ where }: any) =>
      where.id === "admin-2" ? administrator("admin-2") : ordinaryUser()
    );
    prisma.userAccountAction.findFirst.mockResolvedValue(action());
    prisma.order.count.mockResolvedValue(1);
    prisma.refundTransaction.count.mockResolvedValue(1);
    prisma.paymentDispute.count.mockResolvedValue(1);
    prisma.attendanceDispute.count.mockResolvedValue(1);
    prisma.supportTicket.count.mockResolvedValue(1);

    await expect(service.setAccountStatus("admin-2", "user-1", {
      status: "active",
      reason: "恢复账号访问以继续履行已付款服务和争议处理义务。",
      sourceType: "userAccountAction",
      sourceReference: "action-1"
    })).resolves.toEqual({
      userId: "user-1",
      accountStatus: "active",
      action: null
    });
    expect(prisma.userAccountAction.update).toHaveBeenCalledWith({
      where: { id: "action-1" },
      data: {
        revokedAt: new Date("2026-08-01T00:00:00.000Z"),
        revokedById: "admin-2"
      }
    });
    for (const counter of [
      prisma.order.count,
      prisma.refundTransaction.count,
      prisma.paymentDispute.count,
      prisma.attendanceDispute.count,
      prisma.supportTicket.count
    ]) {
      expect(counter).not.toHaveBeenCalled();
    }
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      subjectUserIds: ["user-1"],
      action: "account.user_action_revoked",
      metadata: expect.objectContaining({
        restorationSourceType: "userAccountAction",
        restorationSourceReference: "action-1",
        originalEvidenceDigest: "a".repeat(64)
      })
    }), prisma);
  });

  it("requires a complete controlled evidence reference before opening a new action", async () => {
    await expect(service.setAccountStatus("admin-1", "user-1", {
      status: "restricted",
      reasonCode: "POLICY_BOUNDARY",
      reason: "已完成安全事实核验，但请求没有受控证据引用。"
    })).rejects.toMatchObject({
      code: "ACCOUNT_ACTION_EVIDENCE_REQUIRED",
      status: 400,
      details: expect.objectContaining({
        allowedSourceTypes: expect.arrayContaining(["moderationCase", "supportTicket"])
      })
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("returns only an identical immutable action snapshot and keeps evidence out of the user DTO", async () => {
    const input = {
      status: "restricted" as const,
      reasonCode: "POLICY_BOUNDARY",
      reason: "多次违反平台安全边界，账号暂时受限。",
      sourceType: "manualSafetyReview" as const,
      sourceReference: "safety-review/case-1",
      evidenceReference: "evidence-vault/item-1"
    };
    const evidenceDigest = (service as any).createEvidenceDigest({
      kind: "restriction",
      reasonCode: input.reasonCode,
      message: input.reason,
      sourceType: input.sourceType,
      sourceReference: input.sourceReference,
      evidenceReference: input.evidenceReference
    });
    prisma.user.findUnique.mockImplementation(async ({ where }: any) =>
      where.id === "admin-1" ? administrator("admin-1") : ordinaryUser()
    );
    prisma.userAccountAction.findFirst.mockResolvedValue(action({ evidenceDigest }));

    const current = await service.setAccountStatus("admin-1", "user-1", input);
    expect(current.action).not.toHaveProperty("sourceType");
    expect(current.action).not.toHaveProperty("sourceReference");
    expect(current.action).not.toHaveProperty("evidenceReference");
    expect(current.action).not.toHaveProperty("evidenceDigest");
    expect(prisma.userAccountAction.create).not.toHaveBeenCalled();

    await expect(service.setAccountStatus("admin-1", "user-1", {
      ...input,
      evidenceReference: "evidence-vault/item-other"
    })).rejects.toMatchObject({
      code: "ACCOUNT_ACTION_EVIDENCE_IMMUTABLE_CONFLICT",
      status: 409,
      details: { actionId: "action-1" }
    });
  });

  it("rejects an internal source reference that does not belong to the target user", async () => {
    prisma.user.findUnique.mockImplementation(async ({ where }: any) =>
      where.id === "admin-1"
        ? administrator("admin-1")
        : ordinaryUser({ accountStatus: "active" })
    );
    prisma.moderationCase.findFirst.mockResolvedValue(null);

    await expect(service.setAccountStatus("admin-1", "user-1", {
      status: "banned",
      reasonCode: "SAFETY_CASE_CONFIRMED",
      reason: "独立安全案件已核验，按规则执行账号处置。",
      sourceType: "moderationCase",
      sourceReference: "case-verified-100",
      evidenceReference: "evidence-vault/item-500"
    })).rejects.toMatchObject({
      code: "ACCOUNT_ACTION_SOURCE_NOT_FOUND",
      status: 409,
      details: {
        sourceType: "moderationCase",
        sourceReference: "case-verified-100"
      }
    });
    expect(prisma.moderationCase.findFirst).toHaveBeenCalledWith({
      where: { id: "case-verified-100", subjectUserId: "user-1" },
      select: { id: true }
    });
    expect(prisma.userAccountAction.create).not.toHaveBeenCalled();
  });

  it("rejects a restoration reference that does not identify the active action", async () => {
    prisma.user.findUnique.mockImplementation(async ({ where }: any) =>
      where.id === "admin-2" ? administrator("admin-2") : ordinaryUser()
    );
    prisma.userAccountAction.findFirst.mockResolvedValue(action());

    await expect(service.setAccountStatus("admin-2", "user-1", {
      status: "active",
      reason: "恢复账号状态并保留原处置审计链。",
      sourceType: "userAccountAction",
      sourceReference: "action-other"
    })).rejects.toMatchObject({
      code: "ACCOUNT_ACTION_RESTORATION_SOURCE_MISMATCH",
      status: 409,
      details: { actionId: "action-1" }
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("fails closed when the generic route targets a companion or staff account", async () => {
    prisma.user.findUnique.mockImplementation(async ({ where }: any) =>
      where.id === "admin-1"
        ? administrator("admin-1")
        : ordinaryUser({
            role: "companion",
            companionProfile: { id: "companion-1" }
          })
    );

    await expect(service.setAccountStatus("admin-1", "user-1", {
      status: "restricted",
      reasonCode: "POLICY_BOUNDARY",
      reason: "应由陪伴者专用生命周期流程完成该处置。",
      sourceType: "manualSafetyReview",
      sourceReference: "safety-review/case-300",
      evidenceReference: "evidence-vault/item-300"
    })).rejects.toMatchObject({
      code: "CONSUMER_ACCOUNT_ACTION_ROUTE_FORBIDDEN",
      status: 409
    });
    expect(prisma.userAccountAction.create).not.toHaveBeenCalled();
    expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
  });

  it("requires the independent appeal workflow instead of manually restoring an appealed action", async () => {
    prisma.user.findUnique.mockImplementation(async ({ where }: any) =>
      where.id === "admin-2" ? administrator("admin-2") : ordinaryUser()
    );
    prisma.userAccountAction.findFirst.mockResolvedValue(action({ appeal: appeal() }));

    await expect(service.setAccountStatus("admin-2", "user-1", {
      status: "active",
      reason: "尝试直接恢复账号状态"
    })).rejects.toMatchObject({
      code: "ACCOUNT_ACTION_APPEAL_RESOLUTION_REQUIRED",
      status: 409
    });
    await expect(service.setAccountStatus("admin-2", "user-1", {
      status: "banned",
      reasonCode: "NEW_ESCALATION",
      reason: "不得用新的处置绕过仍在等待独立复核的申诉。",
      sourceType: "manualSafetyReview",
      sourceReference: "safety-review/case-400",
      evidenceReference: "evidence-vault/item-400"
    })).rejects.toMatchObject({
      code: "ACCOUNT_ACTION_APPEAL_RESOLUTION_REQUIRED",
      status: 409
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("creates exactly one appeal with a 72-hour review SLA and returns the public DTO", async () => {
    prisma.user.findUnique.mockResolvedValue(ordinaryUser());
    prisma.userAccountAction.findFirst.mockResolvedValue(action());
    prisma.userAccountAppeal.create.mockImplementation(async ({ data }: any) => appeal(data));

    await expect(service.createAppeal("user-1", "action-1", {
      statement: "我认为该处置依据不完整，请重新核验全部事实。"
    })).resolves.toEqual({
      id: "appeal-1",
      status: "pending",
      statement: "我认为该处置依据不完整，请重新核验全部事实。",
      reviewDueAt: "2026-08-04T00:00:00.000Z",
      overdue: false,
      resolution: null,
      resolvedAt: null,
      policyVersion: "2026.1",
      createdAt: "2026-08-01T00:00:00.000Z"
    });
    expect(prisma.userAccountAppeal.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actionId: "action-1",
        userId: "user-1",
        reviewDueAt: new Date("2026-08-04T00:00:00.000Z"),
        policyVersion: "2026.1"
      })
    });
    expect(notifications.create).toHaveBeenCalledWith(
      "user-1",
      "supportUpdate",
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ appealId: "appeal-1" }),
      prisma
    );
    const auditInput = audit.record.mock.calls.find(
      ([input]) => input.action === "account.user_action_appealed"
    )?.[0];
    expect(auditInput).toEqual(expect.objectContaining({
      actorId: "user-1",
      action: "account.user_action_appealed"
    }));
    expect(auditInput).not.toHaveProperty("subjectUserIds");
  });

  it("normalizes a uniqueness race into the documented single-appeal conflict", async () => {
    prisma.user.findUnique.mockResolvedValue(ordinaryUser());
    prisma.userAccountAction.findFirst.mockResolvedValue(action());
    prisma.userAccountAppeal.create.mockRejectedValue({ code: "P2002" });

    await expect(service.createAppeal("user-1", "action-1", {
      statement: "我认为该处置依据不完整，请重新核验全部事实。"
    })).rejects.toMatchObject({ code: "USER_ACCOUNT_APPEAL_EXISTS", status: 409 });
  });

  it("prevents the original action creator from claiming, assigning or resolving the appeal", async () => {
    prisma.user.findUnique.mockResolvedValue(administrator("admin-1"));
    prisma.userAccountAppeal.findUnique.mockResolvedValue({
      ...appeal(),
      action: action({ createdById: "admin-1" })
    });

    await expect(service.claim("admin-1", "appeal-1"))
      .rejects.toMatchObject({ code: "USER_ACCOUNT_APPEAL_INDEPENDENT_REVIEW_REQUIRED" });
    await expect(service.assign("admin-1", "appeal-1", {
      assignedToUserId: "d50fb824-a1c6-4dc6-9e36-8fbd0ee3a760"
    })).rejects.toMatchObject({ code: "USER_ACCOUNT_APPEAL_INDEPENDENT_REVIEW_REQUIRED" });
    await expect(service.resolve("admin-1", "appeal-1", {
      status: "upheld",
      resolution: "复核后确认原处置事实和适用规则均成立。"
    })).rejects.toMatchObject({ code: "USER_ACCOUNT_APPEAL_INDEPENDENT_REVIEW_REQUIRED" });
    expect(prisma.userAccountAppeal.update).not.toHaveBeenCalled();
  });

  it("serializes claims and refuses to steal an appeal already owned by another reviewer", async () => {
    prisma.user.findUnique.mockResolvedValue(administrator("admin-2"));
    prisma.userAccountAppeal.findUnique.mockResolvedValue({
      ...appeal({ assignedToUserId: "admin-3", assignedAt: new Date() }),
      action: action()
    });

    await expect(service.claim("admin-2", "appeal-1"))
      .rejects.toMatchObject({ code: "USER_ACCOUNT_APPEAL_ALREADY_ASSIGNED", status: 409 });
    expect(prisma.userAccountAppeal.update).not.toHaveBeenCalled();
  });

  it("overturns through the assigned independent reviewer, restores active and revokes the action", async () => {
    prisma.user.findUnique.mockResolvedValue(administrator("admin-2"));
    const existing = {
      ...appeal({ assignedToUserId: "admin-2", assignedAt: new Date("2026-08-01T01:00:00.000Z") }),
      action: action()
    };
    prisma.userAccountAppeal.findUnique.mockResolvedValue(existing);
    prisma.userAccountAppeal.update.mockImplementation(async ({ data }: any) => ({
      ...existing,
      ...data
    }));

    const result = await service.resolve("admin-2", "appeal-1", {
      status: "overturned",
      resolution: "复核后确认原处置证据不足，撤销原决定并恢复账号。"
    });

    expect(result).toEqual(expect.objectContaining({
      status: "overturned",
      resolvedAt: "2026-08-01T00:00:00.000Z"
    }));
    expect(prisma.userAccountAction.updateMany).toHaveBeenCalledWith({
      where: { id: "action-1", revokedAt: null },
      data: {
        revokedAt: new Date("2026-08-01T00:00:00.000Z"),
        revokedById: "admin-2"
      }
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { accountStatus: "active" }
    });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      subjectUserIds: ["user-1", "admin-1"],
      action: "account.user_action_appeal_resolved",
      metadata: expect.objectContaining({ independentReview: true, status: "overturned" })
    }), prisma);
  });

  it("never reactivates an account whose deletion is processing or completed", async () => {
    prisma.user.findUnique.mockResolvedValue(administrator("admin-2"));
    prisma.userAccountAppeal.findUnique.mockResolvedValue({
      ...appeal({ assignedToUserId: "admin-2", assignedAt: new Date() }),
      action: action()
    });
    prisma.accountDeletionRequest.findFirst.mockResolvedValue({
      id: "deletion-1",
      status: "completed"
    });

    await expect(service.resolve("admin-2", "appeal-1", {
      status: "overturned",
      resolution: "复核后确认原处置证据不足，申请恢复账号状态。"
    })).rejects.toMatchObject({ code: "ACCOUNT_DELETION_FINALIZED", status: 409 });
    expect(prisma.userAccountAppeal.update).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("keeps an upheld action in force and exposes bounded queue pagination", async () => {
    prisma.user.findUnique.mockResolvedValue(administrator("admin-2"));
    const existing = {
      ...appeal({ assignedToUserId: "admin-2", assignedAt: new Date() }),
      action: action()
    };
    prisma.userAccountAppeal.findUnique.mockResolvedValue(existing);
    prisma.userAccountAppeal.update.mockImplementation(async ({ data }: any) => ({
      ...existing,
      ...data
    }));
    await service.resolve("admin-2", "appeal-1", {
      status: "upheld",
      resolution: "复核后确认原处置事实和适用规则均成立。"
    });
    expect(prisma.userAccountAction.updateMany).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();

    prisma.userAccountAppeal.findMany.mockResolvedValue([existing]);
    prisma.userAccountAppeal.count.mockResolvedValue(1);
    const queue = await service.listAdmin("admin-2", {
      status: "pending",
      page: 2,
      pageSize: 25
    });
    expect(queue).toEqual(expect.objectContaining({
      pagination: { page: 2, pageSize: 25, total: 1, totalPages: 1 }
    }));
    expect(queue.items[0].action!.evidence).toEqual({
      status: "available",
      sourceType: "manualSafetyReview",
      sourceReference: "safety-review/case-1",
      evidenceReference: "evidence-vault/item-1",
      evidenceDigest: "a".repeat(64),
      anonymizedAt: null
    });
    expect(prisma.userAccountAppeal.findMany).toHaveBeenCalledWith(expect.objectContaining({
      skip: 25,
      take: 25
    }));
  });

  it("shows an irreversible evidence tombstone to reviewers after retention anonymization", async () => {
    prisma.user.findUnique.mockResolvedValue(administrator("admin-2"));
    prisma.userAccountAppeal.findMany.mockResolvedValue([{
      ...appeal(),
      action: action({
        sourceType: null,
        sourceReference: null,
        evidenceReference: null,
        evidenceDigest: null,
        evidenceAnonymizedAt: new Date("2028-08-01T00:00:00.000Z")
      })
    }]);
    prisma.userAccountAppeal.count.mockResolvedValue(1);

    const queue = await service.listAdmin("admin-2", {
      status: "pending",
      page: 1,
      pageSize: 50
    });
    expect(queue.items[0].action!.evidence).toEqual({
      status: "anonymized",
      sourceType: null,
      sourceReference: null,
      evidenceReference: null,
      evidenceDigest: null,
      anonymizedAt: "2028-08-01T00:00:00.000Z"
    });
  });
});
