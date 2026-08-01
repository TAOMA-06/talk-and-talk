import { HttpStatus, Injectable } from "@nestjs/common";

import { AppException } from "../common/errors/app.exception";
import { PrismaService } from "../database/prisma.service";
import {
  ReviewStaffHandoffMode,
  SuspendReviewStaffDto
} from "./dto/suspend-review-staff.dto";
import { ListReviewStaffOffboardingQueryDto } from "./dto/list-review-staff.dto";
import { AuthenticatedReviewer } from "./review-auth.types";

const OPEN_MODERATION_CASE_STATUSES = ["pending", "autoReviewing", "humanReview"] as const;
const OFFBOARDING_AUDIT_ACTIONS = [
  "review.staff.suspended",
  "review.staff.suspension_confirmed",
  "review.staff.suspension_remediated"
] as const;

@Injectable()
export class ReviewStaffOffboardingService {
  constructor(private readonly prisma: PrismaService) {}

  async listStaff(actor: AuthenticatedReviewer, query: ListReviewStaffOffboardingQueryDto) {
    await this.assertActiveLead(this.prisma, actor.id);
    const keyword = query.keyword?.trim();
    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.role ? { role: query.role } : {}),
      ...(keyword
        ? {
            OR: [
              { displayName: { contains: keyword, mode: "insensitive" } },
              { username: { contains: keyword, mode: "insensitive" } }
            ]
          }
        : {})
    };
    const [items, total, activeLeadCount] = await Promise.all([
      this.prisma.reviewStaff.findMany({
        where,
        select: {
          id: true,
          username: true,
          displayName: true,
          role: true,
          status: true,
          lastLoginAt: true,
          createdAt: true,
          updatedAt: true
        },
        orderBy: [
          { status: "asc" },
          { role: "desc" },
          { displayName: "asc" },
          { username: "asc" },
          { id: "asc" }
        ],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize
      } as any),
      this.prisma.reviewStaff.count({ where } as any),
      this.prisma.reviewStaff.count({ where: { status: "active", role: "lead" } })
    ]);
    const reviewerIds = items.map((item) => item.id);
    const [openCaseGroups, sessionGroups, suspensionGroups] = reviewerIds.length
      ? await Promise.all([
          this.prisma.moderationCase.groupBy({
            by: ["assignedToUserId"],
            where: {
              assignedToUserId: { in: reviewerIds },
              status: { in: [...OPEN_MODERATION_CASE_STATUSES] }
            },
            _count: { _all: true }
          } as any),
          this.prisma.reviewSession.groupBy({
            by: ["reviewerId"],
            where: { reviewerId: { in: reviewerIds }, revokedAt: null },
            _count: { _all: true }
          } as any),
          this.prisma.reviewAuditLog.groupBy({
            by: ["resourceId"],
            where: {
              resourceType: "review_staff",
              resourceId: { in: reviewerIds },
              action: { in: [...OFFBOARDING_AUDIT_ACTIONS] }
            },
            _max: { createdAt: true }
          } as any)
        ])
      : [[], [], []];
    const openCaseCounts = new Map(openCaseGroups.map((row: any) => [
      row.assignedToUserId,
      Number(row._count?._all ?? 0)
    ]));
    const sessionCounts = new Map(sessionGroups.map((row: any) => [
      row.reviewerId,
      Number(row._count?._all ?? 0)
    ]));
    const suspensionTimes = new Map(suspensionGroups.map((row: any) => [
      row.resourceId,
      row._max?.createdAt ?? null
    ]));
    const enriched = items.map((item) => {
      const latestSuspension = suspensionTimes.get(item.id) as Date | null | undefined;
      return {
        ...item,
        lastLoginAt: item.lastLoginAt?.toISOString() ?? null,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
        suspendedAt: latestSuspension?.toISOString() ?? null,
        openCaseCount: openCaseCounts.get(item.id) ?? 0,
        unrevokedSessionCount: sessionCounts.get(item.id) ?? 0
      };
    });
    return {
      items: enriched,
      activeLeadCount,
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize)
      }
    };
  }

  async suspend(
    actor: AuthenticatedReviewer,
    targetReviewerId: string,
    dto: SuspendReviewStaffDto
  ) {
    if (actor.id === targetReviewerId) {
      throw new AppException(
        "REVIEW_STAFF_SELF_SUSPENSION_FORBIDDEN",
        "A review lead cannot suspend their own review identity",
        HttpStatus.CONFLICT
      );
    }
    const reason = dto.reason.trim();
    return this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await this.lockStaffRows(db, [actor.id, targetReviewerId, dto.replacementReviewerId]);
      const lead = await this.assertActiveLead(db, actor.id);
      const target = await db.reviewStaff.findUnique({
        where: { id: targetReviewerId },
        select: {
          id: true,
          username: true,
          displayName: true,
          role: true,
          status: true
        }
      });
      if (!target) {
        throw new AppException(
          "REVIEW_STAFF_NOT_FOUND",
          "Review staff member was not found",
          HttpStatus.NOT_FOUND
        );
      }

      const latestSuspension = await db.reviewAuditLog.findFirst({
        where: {
          resourceType: "review_staff",
          resourceId: target.id,
          action: { in: [...OFFBOARDING_AUDIT_ACTIONS] }
        },
        select: { id: true, createdAt: true, metadata: true },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }]
      });
      const [openCaseCount, unrevokedSessionCount] = await Promise.all([
        db.moderationCase.count({
          where: {
            assignedToUserId: target.id,
            status: { in: [...OPEN_MODERATION_CASE_STATUSES] }
          }
        }),
        db.reviewSession.count({
          where: { reviewerId: target.id, revokedAt: null }
        })
      ]);

      if (
        target.status === "suspended"
        && openCaseCount === 0
        && unrevokedSessionCount === 0
        && latestSuspension
      ) {
        return this.resultDto({
          target,
          handoffMode: dto.handoffMode,
          replacementReviewerId: dto.replacementReviewerId ?? null,
          revokedSessionCount: 0,
          reassignedCaseCount: 0,
          suspendedAt: latestSuspension.createdAt,
          idempotent: true
        });
      }

      if (target.status === "active" && target.role === "lead") {
        const activeLeadCount = await db.reviewStaff.count({
          where: { role: "lead", status: "active" }
        });
        if (activeLeadCount <= 1) {
          throw new AppException(
            "REVIEW_LAST_ACTIVE_LEAD_SUSPENSION_FORBIDDEN",
            "The final active review lead cannot be suspended",
            HttpStatus.CONFLICT
          );
        }
      }

      const replacement = await this.validateHandoff(
        db,
        target.id,
        dto.handoffMode,
        dto.replacementReviewerId,
        openCaseCount
      );
      const now = new Date();
      if (target.status !== "suspended") {
        await db.reviewStaff.update({
          where: { id: target.id },
          data: {
            status: "suspended",
            failedAttempts: 0,
            lockedUntil: null
          }
        });
      }
      const sessions = await db.reviewSession.updateMany({
        where: { reviewerId: target.id, revokedAt: null },
        data: { revokedAt: now }
      });
      const cases = await db.moderationCase.updateMany({
        where: {
          assignedToUserId: target.id,
          status: { in: [...OPEN_MODERATION_CASE_STATUSES] }
        },
        data: { assignedToUserId: replacement?.id ?? null }
      });
      const wasAlreadySuspended = target.status === "suspended";
      const auditAction = wasAlreadySuspended
        ? openCaseCount > 0 || unrevokedSessionCount > 0
          ? "review.staff.suspension_remediated"
          : "review.staff.suspension_confirmed"
        : "review.staff.suspended";
      const audit = await db.reviewAuditLog.create({
        data: {
          reviewerId: lead.id,
          action: auditAction,
          resourceType: "review_staff",
          resourceId: target.id,
          metadata: {
            targetUsername: target.username,
            targetDisplayName: target.displayName,
            targetRole: target.role,
            previousStatus: target.status,
            nextStatus: "suspended",
            handoffMode: dto.handoffMode,
            replacementReviewerId: replacement?.id ?? null,
            reassignedCaseCount: cases.count,
            revokedSessionCount: sessions.count,
            reason,
            tombstone: true,
            historicalAuditPreserved: true
          }
        }
      });
      return this.resultDto({
        target,
        handoffMode: dto.handoffMode,
        replacementReviewerId: replacement?.id ?? null,
        revokedSessionCount: sessions.count,
        reassignedCaseCount: cases.count,
        suspendedAt: audit.createdAt,
        idempotent: wasAlreadySuspended
      });
    });
  }

  private async assertActiveLead(db: any, reviewerId: string) {
    const reviewer = await db.reviewStaff.findUnique({
      where: { id: reviewerId },
      select: { id: true, role: true, status: true }
    });
    if (!reviewer || reviewer.role !== "lead" || reviewer.status !== "active") {
      throw new AppException(
        "REVIEW_ACTIVE_LEAD_REQUIRED",
        "An active review-department lead is required",
        HttpStatus.FORBIDDEN
      );
    }
    return reviewer;
  }

  private async lockStaffRows(db: any, reviewerIds: Array<string | undefined>) {
    if (typeof db.$queryRaw !== "function") return;
    const ids = [...new Set(reviewerIds.filter((id): id is string => Boolean(id)))].sort();
    for (const id of ids) {
      await db.$queryRaw`SELECT "id" FROM "ReviewStaff" WHERE "id" = ${id} FOR UPDATE`;
    }
  }

  private async validateHandoff(
    db: any,
    targetReviewerId: string,
    handoffMode: ReviewStaffHandoffMode,
    replacementReviewerId: string | undefined,
    openCaseCount: number
  ) {
    if (handoffMode === "unassign") {
      if (replacementReviewerId) {
        throw new AppException(
          "REVIEW_STAFF_HANDOFF_INVALID",
          "Unassignment cannot include a replacement reviewer",
          HttpStatus.BAD_REQUEST
        );
      }
      return null;
    }
    if (!replacementReviewerId || replacementReviewerId === targetReviewerId) {
      throw new AppException(
        "REVIEW_STAFF_HANDOFF_INVALID",
        "Reassignment requires a different replacement reviewer",
        HttpStatus.BAD_REQUEST
      );
    }
    const replacement = await db.reviewStaff.findUnique({
      where: { id: replacementReviewerId },
      select: { id: true, role: true, status: true }
    });
    if (!replacement || replacement.status !== "active") {
      throw new AppException(
        "REVIEW_STAFF_HANDOFF_ASSIGNEE_INVALID",
        "The replacement must be an active review staff member",
        HttpStatus.BAD_REQUEST
      );
    }
    if (openCaseCount > 0) {
      const independentReviewConflicts = await db.moderationCase.count({
        where: {
          assignedToUserId: targetReviewerId,
          status: { in: [...OPEN_MODERATION_CASE_STATUSES] },
          appeals: {
            some: {
              status: "pending",
              originalReviewerId: replacement.id
            }
          }
        }
      });
      if (independentReviewConflicts > 0) {
        throw new AppException(
          "REVIEW_STAFF_HANDOFF_INDEPENDENCE_CONFLICT",
          "The replacement is the original reviewer for an open appeal; choose another reviewer or unassign",
          HttpStatus.CONFLICT,
          { conflictingCaseCount: independentReviewConflicts }
        );
      }
    }
    return replacement;
  }

  private resultDto(input: {
    target: { id: string; username: string; displayName: string; role: string };
    handoffMode: ReviewStaffHandoffMode;
    replacementReviewerId: string | null;
    revokedSessionCount: number;
    reassignedCaseCount: number;
    suspendedAt: Date;
    idempotent: boolean;
  }) {
    return {
      staff: {
        id: input.target.id,
        username: input.target.username,
        displayName: input.target.displayName,
        role: input.target.role,
        status: "suspended",
        suspendedAt: input.suspendedAt.toISOString()
      },
      handoff: {
        mode: input.handoffMode,
        replacementReviewerId: input.replacementReviewerId,
        reassignedCaseCount: input.reassignedCaseCount
      },
      revokedSessionCount: input.revokedSessionCount,
      idempotent: input.idempotent,
      tombstone: true
    };
  }
}
