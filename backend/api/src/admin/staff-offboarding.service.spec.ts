import { AuditService } from "../common/audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { StaffOffboardingService } from "./staff-offboarding.service";

const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const TARGET_ID = "22222222-2222-4222-8222-222222222222";
const SUCCESSOR_ID = "33333333-3333-4333-8333-333333333333";
const OPERATION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function createDelegate() {
  return {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    count: jest.fn(),
    groupBy: jest.fn().mockResolvedValue([]),
    update: jest.fn(),
    updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    createMany: jest.fn().mockResolvedValue({ count: 0 }),
    upsert: jest.fn()
  };
}

function createDatabase() {
  const db: any = {
    staffCredential: createDelegate(),
    supportTicket: createDelegate(),
    refundTransaction: createDelegate(),
    paymentDispute: createDelegate(),
    attendanceDispute: createDelegate(),
    userAccountAppeal: createDelegate(),
    companionAccountAppeal: createDelegate(),
    dataRightsRequest: createDelegate(),
    invoiceRequest: createDelegate(),
    companionWithdrawalRequest: createDelegate(),
    companionIncidentReport: createDelegate(),
    refreshToken: createDelegate(),
    notification: createDelegate(),
    $queryRaw: jest.fn()
  };
  db.$transaction = jest.fn(async (callback: (tx: any) => Promise<unknown>) => callback(db));
  return db;
}

function activeCredential(userId: string, role: string, username: string) {
  return {
    id: `credential-${userId}`,
    userId,
    username,
    status: "active",
    offboardingOperationId: null,
    suspendedByUserId: null,
    user: {
      id: userId,
      role,
      accountStatus: "active",
      profile: { displayName: username }
    },
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-01T00:00:00.000Z"),
    lastLoginAt: new Date("2026-07-31T00:00:00.000Z"),
    suspendedAt: null,
    suspendedBy: null,
    suspensionReason: null,
    handoffTo: null
  };
}

function suspensionDto(replacementUserId?: string) {
  return {
    reason: "Employment ended and commercial access must be revoked.",
    replacementUserId,
    operationId: OPERATION_ID,
    confirmationCode: "222222"
  };
}

describe("StaffOffboardingService", () => {
  let db: any;
  let audit: { record: jest.Mock };
  let service: StaffOffboardingService;

  beforeEach(() => {
    db = createDatabase();
    audit = { record: jest.fn().mockResolvedValue({}) };
    service = new StaffOffboardingService(
      db as PrismaService,
      audit as unknown as AuditService
    );
  });

  it("lists commercial staff with bounded active-assignment counts and the separate review boundary", async () => {
    const target = activeCredential(TARGET_ID, "support", "support.one");
    db.staffCredential.findMany.mockResolvedValueOnce([target]);
    db.staffCredential.count.mockResolvedValue(1);
    db.supportTicket.groupBy.mockResolvedValue([
      { assignedToUserId: TARGET_ID, _count: { _all: 2 } }
    ]);

    const result = await service.list({ page: 1, pageSize: 50 });

    expect(result.items[0]).toMatchObject({
      userId: TARGET_ID,
      status: "active",
      activeAssignmentTotal: 2,
      activeAssignments: { supportTickets: 2 }
    });
    expect(result).not.toHaveProperty("eligibleSuccessors");
    expect(db.staffCredential.count).toHaveBeenCalledWith({ where: {} });
    expect(result.identityBoundary).toEqual({
      commercialStaff: "StaffCredential",
      independentReviewDepartment: "ReviewStaff",
      sharedIdentity: false
    });
  });

  it("searches eligible handoff administrators through a stable bounded endpoint", async () => {
    const successor = activeCredential(SUCCESSOR_ID, "admin", "security.lead");
    db.staffCredential.findMany.mockResolvedValue([successor]);
    db.staffCredential.count.mockResolvedValue(121);

    const result = await service.listEligibleSuccessors({
      keyword: "security",
      excludeUserId: TARGET_ID,
      page: 2,
      pageSize: 50
    });

    expect(db.staffCredential.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: "active",
        userId: { not: TARGET_ID },
        user: { role: "admin", accountStatus: "active" }
      }),
      orderBy: [
        { user: { createdAt: "asc" } },
        { id: "asc" }
      ],
      skip: 50,
      take: 50
    }));
    expect(db.staffCredential.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        status: "active",
        userId: { not: TARGET_ID },
        user: { role: "admin", accountStatus: "active" }
      })
    });
    expect(result.items).toEqual([
      expect.objectContaining({ userId: SUCCESSOR_ID, role: "admin" })
    ]);
    expect(result.pagination).toEqual({
      page: 2,
      pageSize: 50,
      total: 121,
      totalPages: 3
    });
  });

  it("notifies every active administrator through bounded keyset batches", async () => {
    const firstBatch = Array.from({ length: 100 }, (_, index) => ({
      id: `credential-${String(index + 1).padStart(3, "0")}`,
      userId: `user-${String(index + 1).padStart(3, "0")}`
    }));
    const finalLeader = { id: "credential-101", userId: "user-101" };
    db.staffCredential.findMany
      .mockResolvedValueOnce(firstBatch)
      .mockResolvedValueOnce([finalLeader]);
    db.notification.createMany.mockResolvedValue({ count: 0 });

    const count = await (service as any).notifyActiveLeaders(db, {
      credentialId: "credential-target",
      targetUserId: TARGET_ID,
      targetUsername: "support.one",
      replacementUserId: SUCCESSOR_ID,
      actorUserId: ACTOR_ID,
      operationId: OPERATION_ID
    });

    expect(count).toBe(101);
    expect(db.staffCredential.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: expect.objectContaining({ id: { gt: "credential-100" } }),
      orderBy: { id: "asc" },
      take: 100
    }));
    expect(db.notification.createMany).toHaveBeenCalledTimes(2);
  });

  it("hands off queues larger than any page with set updates and exact partition counts", async () => {
    db.supportTicket.updateMany.mockResolvedValue({ count: 12_001 });
    db.refundTransaction.updateMany.mockResolvedValue({ count: 12_002 });
    db.paymentDispute.updateMany.mockResolvedValue({ count: 12_003 });
    db.attendanceDispute.updateMany
      .mockResolvedValueOnce({ count: 12_004 })
      .mockResolvedValueOnce({ count: 12_005 })
      .mockResolvedValueOnce({ count: 12_006 });
    db.userAccountAppeal.updateMany
      .mockResolvedValueOnce({ count: 12_007 })
      .mockResolvedValueOnce({ count: 12_008 });
    db.companionAccountAppeal.updateMany
      .mockResolvedValueOnce({ count: 12_009 })
      .mockResolvedValueOnce({ count: 12_010 });
    db.dataRightsRequest.updateMany.mockResolvedValue({ count: 12_011 });
    db.invoiceRequest.updateMany.mockResolvedValue({ count: 12_012 });
    db.companionWithdrawalRequest.updateMany.mockResolvedValue({ count: 12_013 });
    db.companionIncidentReport.updateMany.mockResolvedValue({ count: 12_014 });

    const result = await (service as any).handoffAssignments(
      db,
      TARGET_ID,
      SUCCESSOR_ID
    );

    expect(result).toEqual({
      supportTickets: 12_001,
      refunds: 12_002,
      paymentDisputes: 12_003,
      attendanceReviews: 12_004,
      attendanceAppealsReassigned: 12_006,
      attendanceAppealsUnassignedForIndependence: 12_005,
      userAccountAppealsReassigned: 12_008,
      userAccountAppealsUnassignedForIndependence: 12_007,
      companionAccountAppealsReassigned: 12_010,
      companionAccountAppealsUnassignedForIndependence: 12_009,
      dataRightsRequests: 12_011,
      invoiceRequests: 12_012,
      companionWithdrawals: 12_013,
      companionIncidents: 12_014
    });
    expect(db.attendanceDispute.findMany).not.toHaveBeenCalled();
    expect(db.userAccountAppeal.findMany).not.toHaveBeenCalled();
    expect(db.companionAccountAppeal.findMany).not.toHaveBeenCalled();
    expect(db.attendanceDispute.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        appealAssignedToUserId: TARGET_ID,
        status: "appealed",
        decidedByUserId: SUCCESSOR_ID
      },
      data: { appealAssignedToUserId: null, appealAssignedAt: null }
    });
    expect(db.attendanceDispute.updateMany).toHaveBeenNthCalledWith(3, {
      where: {
        appealAssignedToUserId: TARGET_ID,
        status: "appealed",
        OR: [
          { decidedByUserId: null },
          { decidedByUserId: { not: SUCCESSOR_ID } }
        ]
      },
      data: { appealAssignedToUserId: SUCCESSOR_ID, appealAssignedAt: expect.any(Date) }
    });
    expect(db.userAccountAppeal.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        assignedToUserId: TARGET_ID,
        status: "pending",
        action: { createdById: SUCCESSOR_ID }
      },
      data: { assignedToUserId: null, assignedAt: null }
    });
    expect(db.userAccountAppeal.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        assignedToUserId: TARGET_ID,
        status: "pending",
        OR: [
          { action: { createdById: null } },
          { action: { createdById: { not: SUCCESSOR_ID } } }
        ]
      },
      data: { assignedToUserId: SUCCESSOR_ID, assignedAt: expect.any(Date) }
    });

    const orderedWrites = [
      db.supportTicket.updateMany,
      db.refundTransaction.updateMany,
      db.paymentDispute.updateMany,
      db.attendanceDispute.updateMany,
      db.userAccountAppeal.updateMany,
      db.dataRightsRequest.updateMany,
      db.invoiceRequest.updateMany,
      db.companionWithdrawalRequest.updateMany
    ].map((mock) => mock.mock.invocationCallOrder[0]);
    expect(orderedWrites).toEqual([...orderedWrites].sort((left, right) => left - right));
  });

  it("forbids self-suspension before opening a transaction", async () => {
    await expect(service.suspend(ACTOR_ID, ACTOR_ID, {
      ...suspensionDto(),
      confirmationCode: "111111"
    })).rejects.toMatchObject({ code: "STAFF_SELF_SUSPENSION_FORBIDDEN" });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("forbids suspending the last active administrator", async () => {
    db.staffCredential.findUnique
      .mockResolvedValueOnce(activeCredential(ACTOR_ID, "admin", "security.lead"))
      .mockResolvedValueOnce(activeCredential(TARGET_ID, "admin", "last.admin"))
      .mockResolvedValueOnce(null);
    db.staffCredential.count.mockResolvedValue(1);

    await expect(service.suspend(ACTOR_ID, TARGET_ID, suspensionDto()))
      .rejects.toMatchObject({ code: "STAFF_LAST_ADMIN_SUSPENSION_FORBIDDEN" });
    expect(db.staffCredential.update).not.toHaveBeenCalled();
  });

  it("requires an active administrator handoff when unresolved assignments exist", async () => {
    db.staffCredential.findUnique
      .mockResolvedValueOnce(activeCredential(ACTOR_ID, "admin", "security.lead"))
      .mockResolvedValueOnce(activeCredential(TARGET_ID, "support", "support.one"))
      .mockResolvedValueOnce(null);
    db.supportTicket.groupBy.mockResolvedValue([
      { assignedToUserId: TARGET_ID, _count: { _all: 1 } }
    ]);

    await expect(service.suspend(ACTOR_ID, TARGET_ID, suspensionDto()))
      .rejects.toMatchObject({
        code: "STAFF_HANDOFF_REQUIRED",
        details: { activeAssignmentTotal: 1 }
      });
    expect(db.staffCredential.update).not.toHaveBeenCalled();
  });

  it("atomically hands off commercial queues, preserves appeal independence, revokes sessions and audits", async () => {
    const actor = activeCredential(ACTOR_ID, "admin", "security.lead");
    const target = activeCredential(TARGET_ID, "support", "support.one");
    const successor = activeCredential(SUCCESSOR_ID, "admin", "operations.owner");
    db.staffCredential.findUnique
      .mockResolvedValueOnce(actor)
      .mockResolvedValueOnce(target)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(successor);
    db.staffCredential.count.mockResolvedValue(2);
    db.supportTicket.groupBy
      .mockResolvedValueOnce([{ assignedToUserId: TARGET_ID, _count: { _all: 1 } }])
      .mockResolvedValueOnce([]);
    db.attendanceDispute.groupBy
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ appealAssignedToUserId: TARGET_ID, _count: { _all: 2 } }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    db.userAccountAppeal.groupBy
      .mockResolvedValueOnce([{ assignedToUserId: TARGET_ID, _count: { _all: 2 } }])
      .mockResolvedValueOnce([]);
    db.userAccountAppeal.findMany.mockResolvedValue([
      { id: "account-appeal-reassign", action: { createdById: ACTOR_ID } },
      { id: "account-appeal-unassign", action: { createdById: SUCCESSOR_ID } }
    ]);
    db.attendanceDispute.findMany.mockResolvedValue([
      { id: "attendance-appeal-reassign", decidedByUserId: ACTOR_ID },
      { id: "attendance-appeal-unassign", decidedByUserId: SUCCESSOR_ID }
    ]);
    db.supportTicket.updateMany.mockResolvedValue({ count: 1 });
    db.attendanceDispute.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    db.userAccountAppeal.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    db.staffCredential.update.mockImplementation(({ data }: any) => Promise.resolve({
      id: target.id,
      status: data.status,
      suspendedAt: data.suspendedAt
    }));
    db.refreshToken.updateMany.mockResolvedValue({ count: 3 });
    db.staffCredential.findMany.mockResolvedValue([
      { userId: ACTOR_ID },
      { userId: SUCCESSOR_ID }
    ]);
    db.notification.upsert.mockResolvedValue({});
    db.notification.createMany.mockResolvedValue({ count: 2 });

    const result = await service.suspend(
      ACTOR_ID,
      TARGET_ID,
      suspensionDto(SUCCESSOR_ID)
    );

    expect(db.staffCredential.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: target.id },
      data: expect.objectContaining({
        status: "suspended",
        suspendedByUserId: ACTOR_ID,
        handoffToUserId: SUCCESSOR_ID,
        offboardingOperationId: OPERATION_ID
      })
    }));
    expect(db.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: TARGET_ID, revokedAt: null },
      data: { revokedAt: expect.any(Date) }
    });
    expect(result).toMatchObject({
      status: "suspended",
      revokedSessionCount: 3,
      notifiedLeaderCount: 2,
      assignmentHandoff: {
        supportTickets: 1,
        attendanceAppealsReassigned: 1,
        attendanceAppealsUnassignedForIndependence: 1,
        userAccountAppealsReassigned: 1,
        userAccountAppealsUnassignedForIndependence: 1
      },
      identityBoundary: { reviewStaffIdentityDomainTouched: false }
    });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "admin.staff_credential_suspended",
      metadata: expect.objectContaining({
        activeAssignmentsBefore: expect.objectContaining({
          supportTickets: 1,
          attendanceAppeals: 2,
          userAccountAppeals: 2
        }),
        reviewStaffIdentityDomainTouched: false
      })
    }), db);
    expect(db.notification.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          userId: ACTOR_ID,
          eventKey: expect.stringContaining(`leader:${ACTOR_ID}`)
        }),
        expect.objectContaining({
          userId: SUCCESSOR_ID,
          eventKey: expect.stringContaining(`leader:${SUCCESSOR_ID}`)
        })
      ]),
      skipDuplicates: true
    });
    expect(db.notification.upsert).not.toHaveBeenCalled();
    expect(db.$queryRaw).toHaveBeenCalledTimes(4);
    expect(db.$queryRaw.mock.invocationCallOrder[3])
      .toBeLessThan(db.supportTicket.updateMany.mock.invocationCallOrder[0]);
    const lastAssignmentCountRead = Math.max(
      ...[
        db.supportTicket,
        db.refundTransaction,
        db.paymentDispute,
        db.attendanceDispute,
        db.userAccountAppeal,
        db.dataRightsRequest,
        db.invoiceRequest,
        db.companionWithdrawalRequest
      ].flatMap((delegate) => delegate.groupBy.mock.invocationCallOrder)
    );
    expect(lastAssignmentCountRead)
      .toBeLessThan(db.staffCredential.update.mock.invocationCallOrder[0]);
  });

  it("accepts an exact operation retry without re-running handoff or revocation", async () => {
    const suspended = {
      ...activeCredential(TARGET_ID, "support", "support.one"),
      status: "suspended",
      suspendedAt: new Date("2026-08-01T10:00:00.000Z"),
      suspendedByUserId: ACTOR_ID,
      handoffToUserId: SUCCESSOR_ID,
      offboardingOperationId: OPERATION_ID
    };
    db.staffCredential.findUnique
      .mockResolvedValueOnce(activeCredential(ACTOR_ID, "admin", "security.lead"))
      .mockResolvedValueOnce(suspended);

    await expect(service.suspend(ACTOR_ID, TARGET_ID, suspensionDto(SUCCESSOR_ID)))
      .resolves.toMatchObject({ status: "suspended", idempotent: true });
    expect(db.staffCredential.update).not.toHaveBeenCalled();
    expect(db.refreshToken.updateMany).not.toHaveBeenCalled();
  });
});
