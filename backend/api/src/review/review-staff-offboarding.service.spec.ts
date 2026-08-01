import { PrismaService } from "../database/prisma.service";
import { AuthenticatedReviewer } from "./review-auth.types";
import { ReviewStaffOffboardingService } from "./review-staff-offboarding.service";

describe("ReviewStaffOffboardingService", () => {
  const lead: AuthenticatedReviewer = {
    id: "11111111-1111-4111-8111-111111111111",
    username: "lead.chen",
    displayName: "陈负责人",
    role: "lead"
  };
  const target = {
    id: "22222222-2222-4222-8222-222222222222",
    username: "reviewer.liu",
    displayName: "刘审核",
    role: "reviewer",
    status: "active"
  };
  const replacement = {
    id: "33333333-3333-4333-8333-333333333333",
    username: "reviewer.wang",
    displayName: "王审核",
    role: "reviewer",
    status: "active"
  };
  const now = new Date("2026-08-01T08:00:00.000Z");
  const prisma: any = {
    $queryRaw: jest.fn(),
    $transaction: jest.fn(async (callback: (tx: unknown) => unknown) => callback(prisma)),
    reviewStaff: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn()
    },
    reviewSession: {
      count: jest.fn(),
      groupBy: jest.fn(),
      updateMany: jest.fn()
    },
    moderationCase: {
      count: jest.fn(),
      groupBy: jest.fn(),
      updateMany: jest.fn()
    },
    reviewAuditLog: {
      findFirst: jest.fn(),
      groupBy: jest.fn(),
      create: jest.fn()
    }
  };
  let service: ReviewStaffOffboardingService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ReviewStaffOffboardingService(prisma as unknown as PrismaService);
    prisma.reviewAuditLog.findFirst.mockResolvedValue(null);
    prisma.reviewAuditLog.groupBy.mockResolvedValue([]);
    prisma.reviewSession.groupBy.mockResolvedValue([]);
    prisma.moderationCase.groupBy.mockResolvedValue([]);
    prisma.reviewStaff.update.mockResolvedValue({});
    prisma.reviewSession.updateMany.mockResolvedValue({ count: 0 });
    prisma.moderationCase.updateMany.mockResolvedValue({ count: 0 });
    prisma.reviewAuditLog.create.mockResolvedValue({ id: "audit-1", createdAt: now });
  });

  it("atomically tombstones a reviewer, revokes every session, hands off open cases, and audits", async () => {
    prisma.reviewStaff.findUnique
      .mockResolvedValueOnce({ id: lead.id, role: "lead", status: "active" })
      .mockResolvedValueOnce(target)
      .mockResolvedValueOnce(replacement);
    prisma.moderationCase.count
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(0);
    prisma.reviewSession.count.mockResolvedValue(3);
    prisma.reviewSession.updateMany.mockResolvedValue({ count: 3 });
    prisma.moderationCase.updateMany.mockResolvedValue({ count: 2 });

    const result = await service.suspend(lead, target.id, {
      handoffMode: "reassign",
      replacementReviewerId: replacement.id,
      reason: "审核员已完成安全离职交接"
    });

    expect(prisma.reviewStaff.update).toHaveBeenCalledWith({
      where: { id: target.id },
      data: { status: "suspended", failedAttempts: 0, lockedUntil: null }
    });
    expect(prisma.reviewSession.updateMany).toHaveBeenCalledWith({
      where: { reviewerId: target.id, revokedAt: null },
      data: { revokedAt: expect.any(Date) }
    });
    expect(prisma.moderationCase.updateMany).toHaveBeenCalledWith({
      where: {
        assignedToUserId: target.id,
        status: { in: ["pending", "autoReviewing", "humanReview"] }
      },
      data: { assignedToUserId: replacement.id }
    });
    expect(prisma.reviewAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        reviewerId: lead.id,
        action: "review.staff.suspended",
        resourceType: "review_staff",
        resourceId: target.id,
        metadata: expect.objectContaining({
          handoffMode: "reassign",
          replacementReviewerId: replacement.id,
          reassignedCaseCount: 2,
          revokedSessionCount: 3,
          tombstone: true,
          historicalAuditPreserved: true
        })
      })
    });
    expect(result).toEqual(expect.objectContaining({
      staff: expect.objectContaining({ id: target.id, status: "suspended" }),
      handoff: { mode: "reassign", replacementReviewerId: replacement.id, reassignedCaseCount: 2 },
      revokedSessionCount: 3,
      idempotent: false,
      tombstone: true
    }));
  });

  it("supports an explicit controlled unassignment instead of inventing a successor", async () => {
    prisma.reviewStaff.findUnique
      .mockResolvedValueOnce({ id: lead.id, role: "lead", status: "active" })
      .mockResolvedValueOnce(target);
    prisma.moderationCase.count.mockResolvedValue(1);
    prisma.reviewSession.count.mockResolvedValue(0);
    prisma.moderationCase.updateMany.mockResolvedValue({ count: 1 });

    await service.suspend(lead, target.id, {
      handoffMode: "unassign",
      reason: "交回未分配队列等待负责人重新排班"
    });

    expect(prisma.moderationCase.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { assignedToUserId: null }
    }));
  });

  it("is idempotent after the tombstone, session revocation, and handoff already exist", async () => {
    prisma.reviewStaff.findUnique
      .mockResolvedValueOnce({ id: lead.id, role: "lead", status: "active" })
      .mockResolvedValueOnce({ ...target, status: "suspended" });
    prisma.reviewAuditLog.findFirst.mockResolvedValue({
      id: "audit-original",
      createdAt: now,
      metadata: { handoffMode: "unassign", replacementReviewerId: null }
    });
    prisma.moderationCase.count.mockResolvedValue(0);
    prisma.reviewSession.count.mockResolvedValue(0);

    const result = await service.suspend(lead, target.id, {
      handoffMode: "unassign",
      reason: "重复确认离职状态"
    });

    expect(result.idempotent).toBe(true);
    expect(prisma.reviewStaff.update).not.toHaveBeenCalled();
    expect(prisma.reviewSession.updateMany).not.toHaveBeenCalled();
    expect(prisma.moderationCase.updateMany).not.toHaveBeenCalled();
    expect(prisma.reviewAuditLog.create).not.toHaveBeenCalled();
  });

  it("forbids self-suspension before opening a transaction", async () => {
    await expect(service.suspend(lead, lead.id, {
      handoffMode: "unassign",
      reason: "不允许自停用"
    })).rejects.toMatchObject({ code: "REVIEW_STAFF_SELF_SUSPENSION_FORBIDDEN" });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("forbids suspending the final active review lead", async () => {
    prisma.reviewStaff.findUnique
      .mockResolvedValueOnce({ id: lead.id, role: "lead", status: "active" })
      .mockResolvedValueOnce({ ...target, role: "lead" });
    prisma.moderationCase.count.mockResolvedValue(0);
    prisma.reviewSession.count.mockResolvedValue(0);
    prisma.reviewStaff.count.mockResolvedValue(1);

    await expect(service.suspend(lead, target.id, {
      handoffMode: "unassign",
      reason: "负责人离职"
    })).rejects.toMatchObject({ code: "REVIEW_LAST_ACTIVE_LEAD_SUSPENSION_FORBIDDEN" });
    expect(prisma.reviewStaff.update).not.toHaveBeenCalled();
  });

  it("rechecks the caller as an active lead inside the offboarding transaction", async () => {
    prisma.reviewStaff.findUnique.mockResolvedValueOnce({
      id: lead.id,
      role: "lead",
      status: "suspended"
    });

    await expect(service.suspend(lead, target.id, {
      handoffMode: "unassign",
      reason: "无效负责人不能操作"
    })).rejects.toMatchObject({ code: "REVIEW_ACTIVE_LEAD_REQUIRED" });
    expect(prisma.reviewSession.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a successor who would violate independent appeal review", async () => {
    prisma.reviewStaff.findUnique
      .mockResolvedValueOnce({ id: lead.id, role: "lead", status: "active" })
      .mockResolvedValueOnce(target)
      .mockResolvedValueOnce(replacement);
    prisma.moderationCase.count
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1);
    prisma.reviewSession.count.mockResolvedValue(1);

    await expect(service.suspend(lead, target.id, {
      handoffMode: "reassign",
      replacementReviewerId: replacement.id,
      reason: "尝试交接申诉案件"
    })).rejects.toMatchObject({ code: "REVIEW_STAFF_HANDOFF_INDEPENDENCE_CONFLICT" });
    expect(prisma.reviewStaff.update).not.toHaveBeenCalled();
  });

  it("lists filtered staff with batch aggregates, stable pagination, and a global active-lead count", async () => {
    prisma.reviewStaff.findUnique.mockResolvedValue({ id: lead.id, role: "lead", status: "active" });
    prisma.reviewStaff.findMany.mockResolvedValue([{
      ...target,
      lastLoginAt: null,
      createdAt: new Date("2026-07-01T00:00:00.000Z"),
      updatedAt: new Date("2026-07-31T00:00:00.000Z")
    }]);
    prisma.reviewStaff.count
      .mockResolvedValueOnce(101)
      .mockResolvedValueOnce(3);
    prisma.moderationCase.groupBy.mockResolvedValue([
      { assignedToUserId: target.id, _count: { _all: 2 } }
    ]);
    prisma.reviewSession.groupBy.mockResolvedValue([
      { reviewerId: target.id, _count: { _all: 1 } }
    ]);
    prisma.reviewAuditLog.groupBy.mockResolvedValue([
      { resourceId: target.id, _max: { createdAt: now } }
    ]);

    const result = await service.listStaff(lead, {
      keyword: "刘",
      status: "active",
      role: "reviewer",
      page: 2,
      pageSize: 25
    });

    expect(result.items[0]).toEqual(expect.objectContaining({
      id: target.id,
      openCaseCount: 2,
      unrevokedSessionCount: 1,
      suspendedAt: now.toISOString()
    }));
    expect(result.activeLeadCount).toBe(3);
    expect(result.pagination).toEqual({ page: 2, pageSize: 25, total: 101, totalPages: 5 });
    expect(prisma.reviewStaff.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [
        { status: "asc" },
        { role: "desc" },
        { displayName: "asc" },
        { username: "asc" },
        { id: "asc" }
      ],
      skip: 25,
      take: 25
    }));
    expect(prisma.reviewStaff.count).toHaveBeenNthCalledWith(1, {
      where: {
        status: "active",
        role: "reviewer",
        OR: [
          { displayName: { contains: "刘", mode: "insensitive" } },
          { username: { contains: "刘", mode: "insensitive" } }
        ]
      }
    });
    expect(prisma.reviewStaff.count).toHaveBeenNthCalledWith(2, {
      where: { status: "active", role: "lead" }
    });
    expect(prisma.moderationCase.count).not.toHaveBeenCalled();
    expect(prisma.reviewSession.count).not.toHaveBeenCalled();
    expect(prisma.reviewAuditLog.findFirst).not.toHaveBeenCalled();
    expect(result.items[0]).not.toHaveProperty("passwordHash");
    expect(result.items[0]).not.toHaveProperty("totpSecretCiphertext");
  });
});
