import { HttpStatus, Injectable } from "@nestjs/common";

import { AuditService } from "../common/audit/audit.service";
import { AppException } from "../common/errors/app.exception";
import { PrismaService } from "../database/prisma.service";
import {
  ListEligibleStaffSuccessorsDto,
  ListStaffCredentialsDto,
  SuspendStaffCredentialDto
} from "./dto/staff-offboarding.dto";

const ACTIVE_SUPPORT_STATUSES = ["open", "inProgress"];
const ACTIVE_REFUND_STATUSES = ["pendingReview", "pending", "processing", "failed"];
const ACTIVE_PAYMENT_DISPUTE_STATUSES = ["pendingSync", "open", "processing", "syncFailed"];
const ACTIVE_DATA_RIGHTS_STATUSES = ["submitted", "inReview", "needsInformation"];
const ACTIVE_INVOICE_STATUSES = ["submitted", "inReview"];

type AssignmentCounts = {
  supportTickets: number;
  refunds: number;
  paymentDisputes: number;
  attendanceReviews: number;
  attendanceAppeals: number;
  userAccountAppeals: number;
  dataRightsRequests: number;
  invoiceRequests: number;
  companionWithdrawals: number;
};

const ASSIGNMENT_KEYS: (keyof AssignmentCounts)[] = [
  "supportTickets",
  "refunds",
  "paymentDisputes",
  "attendanceReviews",
  "attendanceAppeals",
  "userAccountAppeals",
  "dataRightsRequests",
  "invoiceRequests",
  "companionWithdrawals"
];

function emptyAssignmentCounts(): AssignmentCounts {
  return {
    supportTickets: 0,
    refunds: 0,
    paymentDisputes: 0,
    attendanceReviews: 0,
    attendanceAppeals: 0,
    userAccountAppeals: 0,
    dataRightsRequests: 0,
    invoiceRequests: 0,
    companionWithdrawals: 0
  };
}

function assignmentTotal(counts: AssignmentCounts): number {
  return ASSIGNMENT_KEYS.reduce((total, key) => total + counts[key], 0);
}

function confirmationCode(userId: string): string {
  return userId.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(-6) || "CONFIRM";
}

@Injectable()
export class StaffOffboardingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService
  ) {}

  async list(query: ListStaffCredentialsDto) {
    const db = this.prisma as any;
    const keyword = query.keyword?.trim();
    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.role ? { user: { role: query.role } } : {}),
      ...(keyword
        ? {
            OR: [
              { username: { contains: keyword, mode: "insensitive" } },
              { user: { profile: { is: { displayName: { contains: keyword, mode: "insensitive" } } } } }
            ]
          }
        : {})
    };
    const [credentials, total] = await Promise.all([
      db.staffCredential.findMany({
        where,
        include: {
          user: { include: { profile: true } },
          suspendedBy: { include: { profile: true } },
          handoffTo: { include: { profile: true } }
        },
        orderBy: [{ status: "asc" }, { updatedAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize
      }),
      db.staffCredential.count({ where })
    ]);
    const assignmentCounts = await this.activeAssignmentsByUser(
      db,
      credentials.map((credential: any) => credential.userId)
    );

    return {
      items: credentials.map((credential: any) => {
        const counts = assignmentCounts.get(credential.userId) ?? emptyAssignmentCounts();
        return {
          id: credential.userId,
          credentialId: credential.id,
          userId: credential.userId,
          username: credential.username,
          displayName: credential.user.profile?.displayName ?? null,
          role: credential.user.role,
          accountStatus: credential.user.accountStatus,
          status: credential.status,
          lastLoginAt: credential.lastLoginAt?.toISOString() ?? null,
          suspendedAt: credential.suspendedAt?.toISOString() ?? null,
          suspendedBy: credential.suspendedBy
            ? {
                userId: credential.suspendedBy.id,
                displayName: credential.suspendedBy.profile?.displayName ?? null
              }
            : null,
          suspensionReason: credential.suspensionReason ?? null,
          handoffTo: credential.handoffTo
            ? {
                userId: credential.handoffTo.id,
                displayName: credential.handoffTo.profile?.displayName ?? null
              }
            : null,
          activeAssignments: counts,
          activeAssignmentTotal: assignmentTotal(counts),
          createdAt: credential.createdAt.toISOString(),
          updatedAt: credential.updatedAt.toISOString()
        };
      }),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize)
      },
      identityBoundary: {
        commercialStaff: "StaffCredential",
        independentReviewDepartment: "ReviewStaff",
        sharedIdentity: false
      }
    };
  }

  async listEligibleSuccessors(query: ListEligibleStaffSuccessorsDto) {
    const db = this.prisma as any;
    const keyword = query.keyword?.trim();
    const where = {
      status: "active",
      ...(query.excludeUserId ? { userId: { not: query.excludeUserId } } : {}),
      user: { role: "admin", accountStatus: "active" },
      ...(keyword
        ? {
            OR: [
              { username: { contains: keyword, mode: "insensitive" } },
              { user: { profile: { is: { displayName: { contains: keyword, mode: "insensitive" } } } } }
            ]
          }
        : {})
    };
    const [credentials, total] = await Promise.all([
      db.staffCredential.findMany({
        where,
        include: { user: { include: { profile: true } } },
        orderBy: [
          { user: { createdAt: "asc" } },
          { id: "asc" }
        ],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize
      }),
      db.staffCredential.count({ where })
    ]);
    return {
      items: credentials.map((credential: any) => ({
        credentialId: credential.id,
        userId: credential.userId,
        username: credential.username,
        displayName: credential.user.profile?.displayName ?? null,
        role: credential.user.role
      })),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize)
      }
    };
  }

  async suspend(actorUserId: string, targetUserId: string, dto: SuspendStaffCredentialDto) {
    const reason = dto.reason.trim();
    if (reason.length < 10) {
      throw new AppException(
        "STAFF_SUSPENSION_REASON_REQUIRED",
        "A specific staff suspension reason of at least 10 characters is required",
        HttpStatus.BAD_REQUEST
      );
    }
    if (actorUserId === targetUserId) {
      throw new AppException(
        "STAFF_SELF_SUSPENSION_FORBIDDEN",
        "Administrators cannot suspend their own staff credential",
        HttpStatus.CONFLICT
      );
    }
    if (dto.confirmationCode.trim().toUpperCase() !== confirmationCode(targetUserId)) {
      throw new AppException(
        "STAFF_SUSPENSION_CONFIRMATION_INVALID",
        "The staff suspension confirmation code is invalid",
        HttpStatus.BAD_REQUEST
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      // All commercial-staff offboarding operations share one short lock so two
      // administrators cannot simultaneously remove the last active leader.
      await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('talk-and-talk:staff-offboarding'))::text AS "lock"`;
      await db.$queryRaw`SELECT "id" FROM "StaffCredential" WHERE "userId" = ${actorUserId} FOR UPDATE`;
      await db.$queryRaw`SELECT "id" FROM "StaffCredential" WHERE "userId" = ${targetUserId} FOR UPDATE`;

      const actor = await db.staffCredential.findUnique({
        where: { userId: actorUserId },
        include: { user: true }
      });
      if (
        !actor
        || actor.status !== "active"
        || actor.user.role !== "admin"
        || actor.user.accountStatus !== "active"
      ) {
        throw new AppException(
          "STAFF_OFFBOARDING_ADMIN_REQUIRED",
          "An active administrator credential is required to suspend commercial staff",
          HttpStatus.FORBIDDEN
        );
      }

      const target = await db.staffCredential.findUnique({
        where: { userId: targetUserId },
        include: { user: { include: { profile: true } } }
      });
      if (!target) {
        throw new AppException(
          "STAFF_CREDENTIAL_NOT_FOUND",
          "Commercial staff credential not found",
          HttpStatus.NOT_FOUND
        );
      }
      if (target.status === "suspended") {
        if (
          target.offboardingOperationId === dto.operationId
          && target.suspendedByUserId === actorUserId
        ) {
          return this.idempotentResult(target);
        }
        throw new AppException(
          "STAFF_CREDENTIAL_ALREADY_SUSPENDED",
          "The commercial staff credential is already suspended",
          HttpStatus.CONFLICT
        );
      }
      const operationOwner = await db.staffCredential.findUnique({
        where: { offboardingOperationId: dto.operationId },
        select: { id: true }
      });
      if (operationOwner && operationOwner.id !== target.id) {
        throw new AppException(
          "STAFF_OFFBOARDING_OPERATION_REUSED",
          "The offboarding operation identifier has already been used",
          HttpStatus.CONFLICT
        );
      }

      if (target.user.role === "admin" && target.user.accountStatus === "active") {
        const activeAdminCount = await db.staffCredential.count({
          where: {
            status: "active",
            user: { role: "admin", accountStatus: "active" }
          }
        });
        if (activeAdminCount <= 1) {
          throw new AppException(
            "STAFF_LAST_ADMIN_SUSPENSION_FORBIDDEN",
            "The last active administrator cannot be suspended",
            HttpStatus.CONFLICT
          );
        }
      }

      const beforeMap = await this.activeAssignmentsByUser(db, [targetUserId]);
      const before = beforeMap.get(targetUserId) ?? emptyAssignmentCounts();
      const beforeTotal = assignmentTotal(before);
      const replacement = dto.replacementUserId
        ? await this.loadAndLockReplacement(db, dto.replacementUserId, targetUserId)
        : null;
      if (beforeTotal > 0 && !replacement) {
        throw new AppException(
          "STAFF_HANDOFF_REQUIRED",
          "An active administrator must receive unresolved commercial assignments before suspension",
          HttpStatus.CONFLICT,
          { activeAssignments: before, activeAssignmentTotal: beforeTotal }
        );
      }

      const handoff = replacement
        ? await this.handoffAssignments(db, targetUserId, replacement.userId)
        : this.emptyHandoffResult();
      const remainingMap = await this.activeAssignmentsByUser(db, [targetUserId]);
      const remaining = remainingMap.get(targetUserId) ?? emptyAssignmentCounts();
      if (assignmentTotal(remaining) !== 0) {
        throw new AppException(
          "STAFF_HANDOFF_POSTCONDITION_FAILED",
          "Unresolved commercial assignments remain on the staff credential",
          HttpStatus.CONFLICT,
          { activeAssignments: remaining }
        );
      }

      const now = new Date();
      const suspended = await db.staffCredential.update({
        where: { id: target.id },
        data: {
          status: "suspended",
          suspendedAt: now,
          suspendedByUserId: actorUserId,
          suspensionReason: reason,
          handoffToUserId: replacement?.userId ?? null,
          offboardingOperationId: dto.operationId,
          failedAttempts: 0,
          lockedUntil: null
        }
      });
      const revokedSessions = await db.refreshToken.updateMany({
        where: { userId: targetUserId, revokedAt: null },
        data: { revokedAt: now }
      });

      await this.audit.record({
        actorId: actorUserId,
        subjectUserIds: [targetUserId],
        action: "admin.staff_credential_suspended",
        resourceType: "staffCredential",
        resourceId: target.id,
        metadata: {
          targetUserId,
          targetUsername: target.username,
          targetRole: target.user.role,
          reason,
          replacementUserId: replacement?.userId ?? null,
          operationId: dto.operationId,
          activeAssignmentsBefore: before,
          handoff,
          revokedSessionCount: revokedSessions.count,
          reviewStaffIdentityDomainTouched: false
        }
      }, db);

      const notifiedLeaderCount = await this.notifyActiveLeaders(db, {
        credentialId: target.id,
        targetUserId,
        targetUsername: target.username,
        replacementUserId: replacement?.userId ?? null,
        actorUserId,
        operationId: dto.operationId
      });

      return {
        credentialId: suspended.id,
        userId: targetUserId,
        username: target.username,
        status: suspended.status,
        suspendedAt: suspended.suspendedAt.toISOString(),
        suspendedByUserId: actorUserId,
        handoffToUserId: replacement?.userId ?? null,
        activeAssignmentsBefore: before,
        assignmentHandoff: handoff,
        revokedSessionCount: revokedSessions.count,
        notifiedLeaderCount,
        operationId: dto.operationId,
        idempotent: false,
        identityBoundary: {
          commercialStaff: "StaffCredential",
          independentReviewDepartment: "ReviewStaff",
          reviewStaffIdentityDomainTouched: false
        }
      };
    });
  }

  private async loadAndLockReplacement(db: any, replacementUserId: string, targetUserId: string) {
    if (replacementUserId === targetUserId) {
      throw new AppException(
        "STAFF_HANDOFF_ASSIGNEE_INVALID",
        "The suspended staff member cannot receive their own handoff",
        HttpStatus.CONFLICT
      );
    }
    await db.$queryRaw`SELECT "id" FROM "StaffCredential" WHERE "userId" = ${replacementUserId} FOR UPDATE`;
    const replacement = await db.staffCredential.findUnique({
      where: { userId: replacementUserId },
      include: { user: true }
    });
    if (
      !replacement
      || replacement.status !== "active"
      || replacement.user.role !== "admin"
      || replacement.user.accountStatus !== "active"
    ) {
      throw new AppException(
        "STAFF_HANDOFF_ASSIGNEE_INVALID",
        "The handoff recipient must be an active administrator",
        HttpStatus.CONFLICT
      );
    }
    return replacement;
  }

  private async activeAssignmentsByUser(db: any, userIds: string[]): Promise<Map<string, AssignmentCounts>> {
    const result = new Map<string, AssignmentCounts>();
    for (const userId of userIds) result.set(userId, emptyAssignmentCounts());
    if (userIds.length === 0) return result;

    const [
      supportTickets,
      refunds,
      paymentDisputes,
      attendanceReviews,
      attendanceAppeals,
      userAccountAppeals,
      dataRightsRequests,
      invoiceRequests,
      companionWithdrawals
    ] = await Promise.all([
      db.supportTicket.groupBy({
        by: ["assignedToUserId"],
        where: { assignedToUserId: { in: userIds }, status: { in: ACTIVE_SUPPORT_STATUSES } },
        _count: { _all: true }
      }),
      db.refundTransaction.groupBy({
        by: ["assignedToUserId"],
        where: { assignedToUserId: { in: userIds }, status: { in: ACTIVE_REFUND_STATUSES } },
        _count: { _all: true }
      }),
      db.paymentDispute.groupBy({
        by: ["assignedSupportUserId"],
        where: { assignedSupportUserId: { in: userIds }, status: { in: ACTIVE_PAYMENT_DISPUTE_STATUSES } },
        _count: { _all: true }
      }),
      db.attendanceDispute.groupBy({
        by: ["assignedToUserId"],
        where: { assignedToUserId: { in: userIds }, status: "review" },
        _count: { _all: true }
      }),
      db.attendanceDispute.groupBy({
        by: ["appealAssignedToUserId"],
        where: { appealAssignedToUserId: { in: userIds }, status: "appealed" },
        _count: { _all: true }
      }),
      db.userAccountAppeal.groupBy({
        by: ["assignedToUserId"],
        where: { assignedToUserId: { in: userIds }, status: "pending" },
        _count: { _all: true }
      }),
      db.dataRightsRequest.groupBy({
        by: ["handledById"],
        where: { handledById: { in: userIds }, status: { in: ACTIVE_DATA_RIGHTS_STATUSES } },
        _count: { _all: true }
      }),
      db.invoiceRequest.groupBy({
        by: ["handledById"],
        where: { handledById: { in: userIds }, status: { in: ACTIVE_INVOICE_STATUSES } },
        _count: { _all: true }
      }),
      db.companionWithdrawalRequest.groupBy({
        by: ["reviewedById"],
        where: { reviewedById: { in: userIds }, status: "reviewing" },
        _count: { _all: true }
      })
    ]);

    const apply = (rows: any[], field: string, key: keyof AssignmentCounts) => {
      for (const row of rows) {
        const userId = row[field];
        const counts = result.get(userId);
        if (counts) counts[key] = Number(row._count?._all ?? row._count ?? 0);
      }
    };
    apply(supportTickets, "assignedToUserId", "supportTickets");
    apply(refunds, "assignedToUserId", "refunds");
    apply(paymentDisputes, "assignedSupportUserId", "paymentDisputes");
    apply(attendanceReviews, "assignedToUserId", "attendanceReviews");
    apply(attendanceAppeals, "appealAssignedToUserId", "attendanceAppeals");
    apply(userAccountAppeals, "assignedToUserId", "userAccountAppeals");
    apply(dataRightsRequests, "handledById", "dataRightsRequests");
    apply(invoiceRequests, "handledById", "invoiceRequests");
    apply(companionWithdrawals, "reviewedById", "companionWithdrawals");
    return result;
  }

  private async handoffAssignments(db: any, targetUserId: string, replacementUserId: string) {
    const now = new Date();
    // These set updates execute in a fixed table/partition order on the same
    // transaction connection. They never materialize an operator's queue in
    // application memory, so a large handoff has no hidden page boundary.
    const supportTickets = await db.supportTicket.updateMany({
      where: { assignedToUserId: targetUserId, status: { in: ACTIVE_SUPPORT_STATUSES } },
      data: { assignedToUserId: replacementUserId }
    });
    const refunds = await db.refundTransaction.updateMany({
      where: { assignedToUserId: targetUserId, status: { in: ACTIVE_REFUND_STATUSES } },
      data: { assignedToUserId: replacementUserId, assignedAt: now }
    });
    const paymentDisputes = await db.paymentDispute.updateMany({
      where: { assignedSupportUserId: targetUserId, status: { in: ACTIVE_PAYMENT_DISPUTE_STATUSES } },
      data: { assignedSupportUserId: replacementUserId, assignedAt: now }
    });
    const attendanceReviews = await db.attendanceDispute.updateMany({
      where: { assignedToUserId: targetUserId, status: "review" },
      data: { assignedToUserId: replacementUserId, assignedAt: now }
    });

    // Independence exclusions are cleared first. The complementary set then
    // moves every remaining appeal, including rows whose original reviewer is
    // null, without collecting IDs or depending on page traversal.
    const attendanceAppealsUnassigned = await db.attendanceDispute.updateMany({
      where: {
        appealAssignedToUserId: targetUserId,
        status: "appealed",
        decidedByUserId: replacementUserId
      },
      data: { appealAssignedToUserId: null, appealAssignedAt: null }
    });
    const attendanceAppealsReassigned = await db.attendanceDispute.updateMany({
      where: {
        appealAssignedToUserId: targetUserId,
        status: "appealed",
        OR: [
          { decidedByUserId: null },
          { decidedByUserId: { not: replacementUserId } }
        ]
      },
      data: { appealAssignedToUserId: replacementUserId, appealAssignedAt: now }
    });
    const userAccountAppealsUnassigned = await db.userAccountAppeal.updateMany({
      where: {
        assignedToUserId: targetUserId,
        status: "pending",
        action: { createdById: replacementUserId }
      },
      data: { assignedToUserId: null, assignedAt: null }
    });
    const userAccountAppealsReassigned = await db.userAccountAppeal.updateMany({
      where: {
        assignedToUserId: targetUserId,
        status: "pending",
        OR: [
          { action: { createdById: null } },
          { action: { createdById: { not: replacementUserId } } }
        ]
      },
      data: { assignedToUserId: replacementUserId, assignedAt: now }
    });

    const dataRightsRequests = await db.dataRightsRequest.updateMany({
      where: { handledById: targetUserId, status: { in: ACTIVE_DATA_RIGHTS_STATUSES } },
      data: { handledById: replacementUserId, handledAt: now }
    });
    const invoiceRequests = await db.invoiceRequest.updateMany({
      where: { handledById: targetUserId, status: { in: ACTIVE_INVOICE_STATUSES } },
      data: { handledById: replacementUserId, handledAt: now }
    });
    const companionWithdrawals = await db.companionWithdrawalRequest.updateMany({
      where: { reviewedById: targetUserId, status: "reviewing" },
      data: { reviewedById: replacementUserId, reviewedAt: now }
    });

    return {
      supportTickets: supportTickets.count,
      refunds: refunds.count,
      paymentDisputes: paymentDisputes.count,
      attendanceReviews: attendanceReviews.count,
      attendanceAppealsReassigned: attendanceAppealsReassigned.count,
      attendanceAppealsUnassignedForIndependence: attendanceAppealsUnassigned.count,
      userAccountAppealsReassigned: userAccountAppealsReassigned.count,
      userAccountAppealsUnassignedForIndependence: userAccountAppealsUnassigned.count,
      dataRightsRequests: dataRightsRequests.count,
      invoiceRequests: invoiceRequests.count,
      companionWithdrawals: companionWithdrawals.count
    };
  }

  private emptyHandoffResult() {
    return {
      supportTickets: 0,
      refunds: 0,
      paymentDisputes: 0,
      attendanceReviews: 0,
      attendanceAppealsReassigned: 0,
      attendanceAppealsUnassignedForIndependence: 0,
      userAccountAppealsReassigned: 0,
      userAccountAppealsUnassignedForIndependence: 0,
      dataRightsRequests: 0,
      invoiceRequests: 0,
      companionWithdrawals: 0
    };
  }

  private async notifyActiveLeaders(db: any, input: {
    credentialId: string;
    targetUserId: string;
    targetUsername: string;
    replacementUserId: string | null;
    actorUserId: string;
    operationId: string;
  }): Promise<number> {
    const batchSize = 100;
    let afterId: string | undefined;
    let recipientCount = 0;
    while (true) {
      const leaders = await db.staffCredential.findMany({
        where: {
          status: "active",
          userId: { not: input.targetUserId },
          user: { role: "admin", accountStatus: "active" },
          ...(afterId ? { id: { gt: afterId } } : {})
        },
        select: { id: true, userId: true },
        orderBy: { id: "asc" },
        take: batchSize
      });
      if (!leaders.length) break;
      await db.notification.createMany({
        data: leaders.map((leader: { userId: string }) => ({
          userId: leader.userId,
          type: "supportUpdate",
          title: "商业后台员工已停权",
          body: "员工访问已撤销，未结商业任务已完成转交或解除分配；请在运营审计中复核。",
          data: {
            staffCredentialId: input.credentialId,
            targetUserId: input.targetUserId,
            replacementUserId: input.replacementUserId,
            actorUserId: input.actorUserId,
            operationId: input.operationId,
            route: "/admin/#audit"
          },
          eventKey: `staff-offboarding:${input.credentialId}:leader:${leader.userId}`
        })),
        skipDuplicates: true
      });
      recipientCount += leaders.length;
      if (leaders.length < batchSize) break;
      afterId = leaders[leaders.length - 1].id;
    }
    return recipientCount;
  }

  private idempotentResult(target: any) {
    if (!target.suspendedAt || !target.suspendedByUserId || !target.offboardingOperationId) {
      throw new AppException(
        "STAFF_SUSPENSION_EVIDENCE_INVALID",
        "The suspended credential is missing immutable offboarding evidence",
        HttpStatus.CONFLICT
      );
    }
    return {
      credentialId: target.id,
      userId: target.userId,
      username: target.username,
      status: target.status,
      suspendedAt: target.suspendedAt.toISOString(),
      suspendedByUserId: target.suspendedByUserId,
      handoffToUserId: target.handoffToUserId,
      activeAssignmentsBefore: emptyAssignmentCounts(),
      assignmentHandoff: this.emptyHandoffResult(),
      revokedSessionCount: 0,
      notifiedLeaderCount: 0,
      operationId: target.offboardingOperationId,
      idempotent: true,
      identityBoundary: {
        commercialStaff: "StaffCredential",
        independentReviewDepartment: "ReviewStaff",
        reviewStaffIdentityDomainTouched: false
      }
    };
  }
}
