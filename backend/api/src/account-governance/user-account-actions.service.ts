import { HttpStatus, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";

import { AuditService } from "../common/audit/audit.service";
import { AppException } from "../common/errors/app.exception";
import {
  USER_ACCOUNT_ACTION_EVIDENCE_SOURCE_TYPES,
  USER_ACCOUNT_ACTION_POLICY_VERSION,
  USER_ACCOUNT_ACTION_RESTORATION_SOURCE_TYPE,
  type UserAccountActionSourceType,
  userAccountAppealDeadline,
  userAccountAppealReviewDueAt
} from "../common/user-account-action-policy";
import { PrismaService } from "../database/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import {
  AssignUserAccountAppealDto,
  CreateUserAccountAppealDto,
  ListUserAccountAppealsDto,
  ResolveUserAccountAppealDto
} from "./dto/user-account-appeal.dto";

type AccountStatusUpdate = {
  status: "active" | "restricted" | "banned";
  reason: string;
  reasonCode?: string;
  sourceType?: UserAccountActionSourceType;
  sourceReference?: string;
  evidenceReference?: string;
};

type NormalizedAccountActionEvidence = {
  sourceType: UserAccountActionSourceType | null;
  sourceReference: string | null;
  evidenceReference: string | null;
};

const REASON_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const EVIDENCE_REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;

const ACTIVE_COMMERCIAL_OBLIGATION_STATUSES = {
  orders: ["paying", "paid", "inService"],
  refunds: ["pendingReview", "pending", "processing"],
  supportTickets: ["open", "inProgress"]
} as const;

@Injectable()
export class UserAccountActionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService
  ) {}

  async setAccountStatus(
    actorId: string,
    userId: string,
    input: AccountStatusUpdate
  ) {
    if (actorId === userId && input.status !== "active") {
      throw new AppException(
        "SELF_LOCKOUT_FORBIDDEN",
        "Administrators cannot restrict their own account",
        HttpStatus.CONFLICT
      );
    }
    const message = input.reason.trim();
    if (message.length < 3 || message.length > 500) {
      throw new AppException(
        "ACCOUNT_ACTION_MESSAGE_INVALID",
        "A user-facing account action message is required",
        HttpStatus.BAD_REQUEST
      );
    }
    const reasonCode = input.reasonCode?.trim() ?? "";
    if (
      input.status !== "active"
      && (
        reasonCode.length < 3
        || reasonCode.length > 80
        || !REASON_CODE_PATTERN.test(reasonCode)
      )
    ) {
      throw new AppException(
        "ACCOUNT_ACTION_REASON_CODE_REQUIRED",
        "A controlled reason code is required for an account action",
        HttpStatus.BAD_REQUEST
      );
    }
    const evidence = this.normalizeEvidenceInput(input);
    const evidenceDigest = input.status === "active"
      ? null
      : this.createEvidenceDigest({
          kind: input.status === "banned" ? "ban" : "restriction",
          reasonCode,
          message,
          sourceType: evidence.sourceType!,
          sourceReference: evidence.sourceReference!,
          evidenceReference: evidence.evidenceReference!
        });

    try {
      return await this.prisma.$transaction(async (tx) => {
        const db = tx as any;
        await this.assertEligibleAdmin(db, actorId);
        await db.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
        const user = await db.user.findUnique({
          where: { id: userId },
          select: {
            id: true,
            role: true,
            accountStatus: true,
            companionProfile: { select: { id: true } },
            staffCredential: { select: { id: true } }
          }
        });
        if (!user) {
          throw new AppException("USER_NOT_FOUND", "User not found", HttpStatus.NOT_FOUND);
        }

        const deletion = await db.accountDeletionRequest.findFirst({
          where: { userId, status: { in: ["processing", "completed"] } },
          select: { id: true, status: true },
          orderBy: { updatedAt: "desc" }
        });
        if (deletion?.status === "completed") {
          throw new AppException(
            "ACCOUNT_DELETION_FINALIZED",
            "A completed account deletion cannot be changed or reactivated",
            HttpStatus.CONFLICT
          );
        }
        if (deletion?.status === "processing") {
          throw new AppException(
            "ACCOUNT_DELETION_IN_PROGRESS",
            "An account being deleted cannot be changed or reactivated",
            HttpStatus.CONFLICT
          );
        }

        const ordinaryConsumer = this.isOrdinaryConsumer(user);
        if (input.status !== "active" && !ordinaryConsumer) {
          throw new AppException(
            "CONSUMER_ACCOUNT_ACTION_ROUTE_FORBIDDEN",
            "Companion and staff accounts must use their dedicated lifecycle workflow",
            HttpStatus.CONFLICT
          );
        }

        if (ordinaryConsumer) {
          await db.$queryRaw`
            SELECT "id" FROM "UserAccountAction"
            WHERE "userId" = ${userId} AND "revokedAt" IS NULL
            FOR UPDATE
          `;
        }
        const activeAction = ordinaryConsumer
          ? await db.userAccountAction.findFirst({
              where: { userId, revokedAt: null },
              include: { appeal: true },
              orderBy: [{ startsAt: "desc" }, { id: "desc" }]
            })
          : null;
        const expectedKind = input.status === "banned" ? "ban" : "restriction";

        if (
          input.status !== "active"
          && user.accountStatus === input.status
          && activeAction?.kind === expectedKind
        ) {
          if (!this.matchesEvidenceSnapshot(activeAction, evidence, evidenceDigest!)) {
            throw new AppException(
              "ACCOUNT_ACTION_EVIDENCE_IMMUTABLE_CONFLICT",
              "The current account action has a different immutable evidence snapshot",
              HttpStatus.CONFLICT,
              { actionId: activeAction.id }
            );
          }
          return {
            userId,
            accountStatus: user.accountStatus,
            action: this.actionDto(activeAction)
          };
        }
        if (
          input.status === "active"
          && evidence.sourceReference
          && evidence.sourceReference !== activeAction?.id
        ) {
          throw new AppException(
            "ACCOUNT_ACTION_RESTORATION_SOURCE_MISMATCH",
            "An explicit restoration source must reference the active account action",
            HttpStatus.CONFLICT,
            { actionId: activeAction?.id ?? null }
          );
        }
        if (input.status === "active" && user.accountStatus === "active" && !activeAction) {
          return { userId, accountStatus: "active", action: null };
        }
        if (activeAction?.appeal?.status === "pending") {
          throw new AppException(
            "ACCOUNT_ACTION_APPEAL_RESOLUTION_REQUIRED",
            "A pending appeal must be resolved through the independent review workflow",
            HttpStatus.CONFLICT,
            { appealId: activeAction.appeal.id }
          );
        }

        if (input.status !== "active") {
          // The subject User row is already locked above. Keep the commercial
          // obligation read in this same transaction so a new restriction or ban
          // cannot sever an existing paid-service, dispute, refund, or support path.
          await this.assertNoActiveCommercialObligations(db, userId);
          await this.assertEvidenceSourceBelongsToSubject(db, userId, evidence);
        }

        const now = new Date();
        if (input.status === "active") {
          if (activeAction) {
            await db.userAccountAction.update({
              where: { id: activeAction.id },
              data: { revokedAt: now, revokedById: actorId }
            });
          }
          await db.user.update({
            where: { id: userId },
            data: { accountStatus: "active" }
          });
          await this.notifications.create(
            userId,
            "safetyAlert",
            "账号状态已恢复",
            message,
            { route: "account", accountStatus: "active", actionId: activeAction?.id ?? null },
            db
          );
          await this.audit.record({
            actorId,
            subjectUserIds: [userId],
            action: "account.user_action_revoked",
            resourceType: "userAccountAction",
            resourceId: activeAction?.id ?? null,
            metadata: {
              userId,
              previousStatus: user.accountStatus,
              reason: message,
              restorationSourceType:
                activeAction ? USER_ACCOUNT_ACTION_RESTORATION_SOURCE_TYPE : null,
              restorationSourceReference: activeAction?.id ?? null,
              originalEvidenceDigest: activeAction?.evidenceDigest ?? null
            }
          }, db);
          await this.audit.record({
            actorId,
            subjectUserIds: [userId],
            action: "account.status_updated",
            resourceType: "user",
            metadata: {
              previousStatus: user.accountStatus,
              nextStatus: "active",
              userId,
              reason: message,
              actionId: activeAction?.id ?? null,
              restorationSourceType:
                activeAction ? USER_ACCOUNT_ACTION_RESTORATION_SOURCE_TYPE : null,
              restorationSourceReference: activeAction?.id ?? null
            }
          }, db);
          return { userId, accountStatus: "active", action: null };
        }

        if (activeAction) {
          await db.userAccountAction.update({
            where: { id: activeAction.id },
            data: { revokedAt: now, revokedById: actorId }
          });
        }

        const action = await db.userAccountAction.create({
          data: {
            userId,
            kind: expectedKind,
            reasonCode,
            message,
            policyVersion: USER_ACCOUNT_ACTION_POLICY_VERSION,
            sourceType: evidence.sourceType,
            sourceReference: evidence.sourceReference,
            evidenceReference: evidence.evidenceReference,
            evidenceDigest,
            startsAt: now,
            endsAt: null,
            appealDeadlineAt: userAccountAppealDeadline(now),
            createdById: actorId
          }
        });
        await db.user.update({
          where: { id: userId },
          data: { accountStatus: input.status }
        });
        await db.refreshToken.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: now }
        });
        await this.notifications.create(
          userId,
          "safetyAlert",
          input.status === "banned" ? "账号已被封禁" : "账号已被限制",
          message,
          {
            route: "account",
            accountStatus: input.status,
            actionId: action.id,
            appealDeadlineAt: action.appealDeadlineAt.toISOString(),
            policyVersion: action.policyVersion
          },
          db
        );
        await this.audit.record({
          actorId,
          subjectUserIds: [userId],
          action: "account.user_action_created",
          resourceType: "userAccountAction",
          resourceId: action.id,
          metadata: {
            userId,
            kind: action.kind,
            reasonCode: action.reasonCode,
            policyVersion: action.policyVersion,
            sourceType: action.sourceType,
            sourceReference: action.sourceReference,
            evidenceReference: action.evidenceReference,
            evidenceDigest: action.evidenceDigest,
            appealDeadlineAt: action.appealDeadlineAt.toISOString(),
            replacedActionId: activeAction?.id ?? null
          }
        }, db);
        await this.audit.record({
          actorId,
          subjectUserIds: [userId],
          action: "account.status_updated",
          resourceType: "user",
          metadata: {
            previousStatus: user.accountStatus,
            nextStatus: input.status,
            userId,
            reasonCode,
            reason: message,
            actionId: action.id
          }
        }, db);
        return {
          userId,
          accountStatus: input.status,
          action: this.actionDto(action)
        };
      });
    } catch (error: any) {
      if (error?.code === "P2002") {
        throw new AppException(
          "ACCOUNT_ACTION_CONCURRENT_UPDATE",
          "The account action changed concurrently; reload before retrying",
          HttpStatus.CONFLICT
        );
      }
      throw error;
    }
  }

  async listMy(
    userId: string,
    query: ListUserAccountAppealsDto = Object.assign(new ListUserAccountAppealsDto(), { page: 1, pageSize: 50 })
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        accountStatus: true,
        companionProfile: { select: { id: true } },
        staffCredential: { select: { id: true } }
      }
    } as any);
    if (!user) {
      throw new AppException("USER_NOT_FOUND", "User not found", HttpStatus.NOT_FOUND);
    }
    this.assertOrdinaryConsumer(user);
    const where: any = {
      userId,
      ...(query.actionId ? { id: query.actionId } : {}),
      ...(query.appealId || query.status ? {
        appeal: {
          is: {
            ...(query.appealId ? { id: query.appealId } : {}),
            ...(query.status ? { status: query.status } : {})
          }
        }
      } : {})
    };
    const [items, total] = await Promise.all([
      this.prisma.userAccountAction.findMany({
      where,
      include: { appeal: true },
      orderBy: [{ startsAt: "desc" }, { id: "desc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize
    } as any),
      this.prisma.userAccountAction.count({ where } as any)
    ]);
    return {
      accountStatus: user.accountStatus,
      items: items.map((item: any) => this.actionDto(item)),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize)
      }
    };
  }

  async createAppeal(
    userId: string,
    actionId: string,
    input: CreateUserAccountAppealDto
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const db = tx as any;
        // Account status changes take the same subject-then-action lock order.
        // This prevents a status restoration from racing past a newly inserted
        // appeal that was invisible to its earlier snapshot.
        await db.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
        await db.$queryRaw`
          SELECT "id" FROM "UserAccountAction"
          WHERE "id" = ${actionId} AND "userId" = ${userId}
          FOR UPDATE
        `;
        const user = await db.user.findUnique({
          where: { id: userId },
          select: {
            id: true,
            role: true,
            accountStatus: true,
            companionProfile: { select: { id: true } },
            staffCredential: { select: { id: true } }
          }
        });
        if (!user) {
          throw new AppException("USER_NOT_FOUND", "User not found", HttpStatus.NOT_FOUND);
        }
        this.assertOrdinaryConsumer(user);
        const action = await db.userAccountAction.findFirst({
          where: { id: actionId, userId },
          include: { appeal: true }
        });
        if (!action) {
          throw new AppException(
            "USER_ACCOUNT_ACTION_NOT_FOUND",
            "Account action not found",
            HttpStatus.NOT_FOUND
          );
        }
        if (action.revokedAt) {
          throw new AppException(
            "USER_ACCOUNT_ACTION_REVOKED",
            "A revoked account action no longer requires an appeal",
            HttpStatus.CONFLICT
          );
        }
        if (action.appeal) {
          throw new AppException(
            "USER_ACCOUNT_APPEAL_EXISTS",
            "An appeal already exists for this account action",
            HttpStatus.CONFLICT,
            { appealId: action.appeal.id }
          );
        }
        const now = new Date();
        if (action.appealDeadlineAt.getTime() <= now.getTime()) {
          throw new AppException(
            "USER_ACCOUNT_APPEAL_WINDOW_CLOSED",
            "The appeal submission window has closed",
            HttpStatus.CONFLICT,
            { appealDeadlineAt: action.appealDeadlineAt.toISOString() }
          );
        }
        const appeal = await db.userAccountAppeal.create({
          data: {
            actionId,
            userId,
            statement: input.statement.trim(),
            status: "pending",
            reviewDueAt: userAccountAppealReviewDueAt(now),
            policyVersion: USER_ACCOUNT_ACTION_POLICY_VERSION
          }
        });
        await this.notifications.create(
          userId,
          "supportUpdate",
          "账号处置申诉已提交",
          "平台已受理，将由非原处置人员独立复核。",
          {
            route: "account",
            actionId,
            appealId: appeal.id,
            reviewDueAt: appeal.reviewDueAt.toISOString()
          },
          db
        );
        await this.audit.record({
          actorId: userId,
          action: "account.user_action_appealed",
          resourceType: "userAccountAppeal",
          resourceId: appeal.id,
          metadata: {
            actionId,
            policyVersion: appeal.policyVersion,
            reviewDueAt: appeal.reviewDueAt.toISOString()
          }
        }, db);
        return this.appealDto(appeal);
      });
    } catch (error: any) {
      if (error?.code === "P2002") {
        throw new AppException(
          "USER_ACCOUNT_APPEAL_EXISTS",
          "An appeal already exists for this account action",
          HttpStatus.CONFLICT
        );
      }
      throw error;
    }
  }

  async listAdmin(actorId: string, query: ListUserAccountAppealsDto) {
    await this.assertEligibleAdmin(this.prisma as any, actorId);
    const status = query.status ?? "pending";
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    const where = { status };
    const [items, total] = await Promise.all([
      this.prisma.userAccountAppeal.findMany({
        where,
        include: { action: true },
        orderBy: [{ reviewDueAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize
      } as any),
      this.prisma.userAccountAppeal.count({ where } as any)
    ]);
    return {
      items: items.map((item: any) => this.adminAppealDto(item, actorId)),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize)
      }
    };
  }

  async claim(actorId: string, appealId: string) {
    return this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await this.assertEligibleAdmin(db, actorId);
      const identity = await db.userAccountAppeal.findUnique({
        where: { id: appealId },
        select: { userId: true }
      });
      if (!identity) {
        throw new AppException(
          "USER_ACCOUNT_APPEAL_NOT_FOUND",
          "Account appeal not found",
          HttpStatus.NOT_FOUND
        );
      }
      // Match the account-status transition lock order (subject User first,
      // then Appeal) so a concurrent escalation and an overturn cannot deadlock
      // or restore an account underneath a newer action.
      await db.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${identity.userId} FOR UPDATE`;
      await db.$queryRaw`SELECT "id" FROM "UserAccountAppeal" WHERE "id" = ${appealId} FOR UPDATE`;
      const existing = await db.userAccountAppeal.findUnique({
        where: { id: appealId },
        include: { action: true }
      });
      this.assertReviewable(existing, actorId);
      if (existing.assignedToUserId === actorId) {
        return this.adminAppealDto(existing, actorId);
      }
      if (existing.assignedToUserId) {
        throw new AppException(
          "USER_ACCOUNT_APPEAL_ALREADY_ASSIGNED",
          "The appeal is already assigned to another administrator",
          HttpStatus.CONFLICT
        );
      }
      const now = new Date();
      const updated = await db.userAccountAppeal.update({
        where: { id: appealId },
        data: { assignedToUserId: actorId, assignedAt: now }
      });
      await this.audit.record({
        actorId,
        subjectUserIds: [existing.userId, existing.action.createdById],
        action: "account.user_action_appeal_claimed",
        resourceType: "userAccountAppeal",
        resourceId: appealId,
        metadata: {
          userId: existing.userId,
          actionId: existing.actionId,
          originalActionCreatedById: existing.action.createdById,
          independentReview: true
        }
      }, db);
      return this.adminAppealDto({ ...updated, action: existing.action }, actorId);
    });
  }

  async assign(
    actorId: string,
    appealId: string,
    input: AssignUserAccountAppealDto
  ) {
    return this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await db.$queryRaw`SELECT "id" FROM "UserAccountAppeal" WHERE "id" = ${appealId} FOR UPDATE`;
      await this.assertEligibleAdmin(db, actorId);
      const existing = await db.userAccountAppeal.findUnique({
        where: { id: appealId },
        include: { action: true }
      });
      this.assertReviewable(existing, actorId);
      await this.assertEligibleAdmin(db, input.assignedToUserId);
      if (existing.action.createdById === input.assignedToUserId) {
        throw new AppException(
          "USER_ACCOUNT_APPEAL_INDEPENDENT_REVIEW_REQUIRED",
          "The original account-action creator cannot be assigned its appeal",
          HttpStatus.CONFLICT
        );
      }
      if (existing.assignedToUserId === input.assignedToUserId) {
        return this.adminAppealDto(existing, actorId);
      }
      const updated = await db.userAccountAppeal.update({
        where: { id: appealId },
        data: { assignedToUserId: input.assignedToUserId, assignedAt: new Date() }
      });
      await this.audit.record({
        actorId,
        subjectUserIds: [
          existing.userId,
          input.assignedToUserId,
          existing.action.createdById,
          ...(existing.assignedToUserId ? [existing.assignedToUserId] : [])
        ],
        action: "account.user_action_appeal_assigned",
        resourceType: "userAccountAppeal",
        resourceId: appealId,
        metadata: {
          userId: existing.userId,
          actionId: existing.actionId,
          previousAssignedToUserId: existing.assignedToUserId ?? null,
          assignedToUserId: input.assignedToUserId,
          originalActionCreatedById: existing.action.createdById,
          independentReview: true
        }
      }, db);
      return this.adminAppealDto({ ...updated, action: existing.action }, actorId);
    });
  }

  async resolve(
    actorId: string,
    appealId: string,
    input: ResolveUserAccountAppealDto
  ) {
    return this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await db.$queryRaw`SELECT "id" FROM "UserAccountAppeal" WHERE "id" = ${appealId} FOR UPDATE`;
      await this.assertEligibleAdmin(db, actorId);
      const existing = await db.userAccountAppeal.findUnique({
        where: { id: appealId },
        include: { action: true }
      });
      this.assertReviewable(existing, actorId);
      if (existing.assignedToUserId !== actorId) {
        throw new AppException(
          "USER_ACCOUNT_APPEAL_NOT_ASSIGNED_TO_ACTOR",
          "Claim or receive assignment before resolving this appeal",
          HttpStatus.CONFLICT
        );
      }

      const now = new Date();
      if (input.status === "overturned") {
        const deletion = await db.accountDeletionRequest.findFirst({
          where: {
            userId: existing.userId,
            status: { in: ["processing", "completed"] }
          },
          select: { id: true, status: true },
          orderBy: { updatedAt: "desc" }
        });
        if (deletion?.status === "completed") {
          throw new AppException(
            "ACCOUNT_DELETION_FINALIZED",
            "A completed account deletion cannot be reactivated",
            HttpStatus.CONFLICT
          );
        }
        if (deletion?.status === "processing") {
          throw new AppException(
            "ACCOUNT_DELETION_IN_PROGRESS",
            "An account being deleted cannot be reactivated",
            HttpStatus.CONFLICT
          );
        }
      }

      const updated = await db.userAccountAppeal.update({
        where: { id: appealId },
        data: {
          status: input.status,
          resolution: input.resolution.trim(),
          resolvedAt: now,
          resolvedById: actorId
        }
      });
      if (input.status === "overturned") {
        await db.userAccountAction.updateMany({
          where: { id: existing.actionId, revokedAt: null },
          data: { revokedAt: now, revokedById: actorId }
        });
        await db.user.update({
          where: { id: existing.userId },
          data: { accountStatus: "active" }
        });
      }
      await this.notifications.create(
        existing.userId,
        "supportUpdate",
        input.status === "overturned" ? "账号处置申诉已撤销原决定" : "账号处置申诉已有结果",
        input.resolution.trim(),
        {
          route: "account",
          actionId: existing.actionId,
          appealId,
          appealStatus: input.status
        },
        db
      );
      await this.audit.record({
        actorId,
        subjectUserIds: [existing.userId, existing.action.createdById],
        action: "account.user_action_appeal_resolved",
        resourceType: "userAccountAppeal",
        resourceId: appealId,
        metadata: {
          userId: existing.userId,
          actionId: existing.actionId,
          status: input.status,
          originalActionCreatedById: existing.action.createdById,
          independentReview: true,
          overdue: existing.reviewDueAt.getTime() < now.getTime()
        }
      }, db);
      return this.adminAppealDto({ ...updated, action: existing.action }, actorId);
    });
  }

  private isOrdinaryConsumer(user: any) {
    return user.role === "user" && !user.companionProfile && !user.staffCredential;
  }

  private assertOrdinaryConsumer(user: any) {
    if (!this.isOrdinaryConsumer(user)) {
      throw new AppException(
        "CONSUMER_ACCOUNT_ACTION_ROUTE_FORBIDDEN",
        "This account uses a dedicated staff or companion lifecycle workflow",
        HttpStatus.FORBIDDEN
      );
    }
  }

  private async assertEligibleAdmin(db: any, userId: string) {
    const actor = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, accountStatus: true }
    });
    if (!actor || actor.role !== "admin" || actor.accountStatus !== "active") {
      throw new AppException(
        "USER_ACCOUNT_APPEAL_REVIEWER_INELIGIBLE",
        "An active administrator is required for this review operation",
        HttpStatus.FORBIDDEN
      );
    }
  }

  private normalizeEvidenceInput(
    input: AccountStatusUpdate
  ): NormalizedAccountActionEvidence {
    const sourceType = input.sourceType ?? null;
    const sourceReference = input.sourceReference?.trim() || null;
    const evidenceReference = input.evidenceReference?.trim() || null;
    if (input.status !== "active") {
      if (
        !sourceType
        || !USER_ACCOUNT_ACTION_EVIDENCE_SOURCE_TYPES.some((value) => value === sourceType)
        || !this.isControlledEvidenceReference(sourceReference)
        || !this.isControlledEvidenceReference(evidenceReference)
      ) {
        throw new AppException(
          "ACCOUNT_ACTION_EVIDENCE_REQUIRED",
          "A controlled source type, source reference, and evidence reference are required for a new account action",
          HttpStatus.BAD_REQUEST,
          { allowedSourceTypes: USER_ACCOUNT_ACTION_EVIDENCE_SOURCE_TYPES }
        );
      }
      return { sourceType, sourceReference, evidenceReference };
    }

    if (!sourceType && !sourceReference && !evidenceReference) {
      return { sourceType: null, sourceReference: null, evidenceReference: null };
    }
    if (
      sourceType !== USER_ACCOUNT_ACTION_RESTORATION_SOURCE_TYPE
      || !this.isControlledEvidenceReference(sourceReference)
      || evidenceReference !== null
    ) {
      throw new AppException(
        "ACCOUNT_ACTION_RESTORATION_SOURCE_INVALID",
        "Restoration may optionally reference only the active user account action",
        HttpStatus.BAD_REQUEST
      );
    }
    return { sourceType, sourceReference, evidenceReference: null };
  }

  private isControlledEvidenceReference(value: string | null): value is string {
    return Boolean(
      value
      && value.length >= 6
      && value.length <= 160
      && EVIDENCE_REFERENCE_PATTERN.test(value)
    );
  }

  private createEvidenceDigest(input: {
    kind: "restriction" | "ban";
    reasonCode: string;
    message: string;
    sourceType: UserAccountActionSourceType;
    sourceReference: string;
    evidenceReference: string;
  }) {
    const snapshot = JSON.stringify({
      schema: "user-account-action-evidence/v1",
      policyVersion: USER_ACCOUNT_ACTION_POLICY_VERSION,
      kind: input.kind,
      reasonCode: input.reasonCode,
      message: input.message,
      sourceType: input.sourceType,
      sourceReference: input.sourceReference,
      evidenceReference: input.evidenceReference
    });
    return createHash("sha256").update(snapshot, "utf8").digest("hex");
  }

  private matchesEvidenceSnapshot(
    action: any,
    evidence: NormalizedAccountActionEvidence,
    evidenceDigest: string
  ) {
    return action.sourceType === evidence.sourceType
      && action.sourceReference === evidence.sourceReference
      && action.evidenceReference === evidence.evidenceReference
      && action.evidenceDigest === evidenceDigest
      && !action.evidenceAnonymizedAt;
  }

  private async assertEvidenceSourceBelongsToSubject(
    db: any,
    userId: string,
    evidence: NormalizedAccountActionEvidence
  ) {
    let source: unknown;
    switch (evidence.sourceType) {
      case "moderationCase":
        source = await db.moderationCase.findFirst({
          where: { id: evidence.sourceReference, subjectUserId: userId },
          select: { id: true }
        });
        break;
      case "supportTicket":
        source = await db.supportTicket.findFirst({
          where: { id: evidence.sourceReference, userId },
          select: { id: true }
        });
        break;
      case "paymentDispute":
        source = await db.paymentDispute.findFirst({
          where: { id: evidence.sourceReference, order: { userId } },
          select: { id: true }
        });
        break;
      case "attendanceDispute":
        source = await db.attendanceDispute.findFirst({
          where: { id: evidence.sourceReference, order: { userId } },
          select: { id: true }
        });
        break;
      case "conversationSafety":
        source = await db.conversation.findFirst({
          where: { id: evidence.sourceReference, userId },
          select: { id: true }
        });
        break;
      case "manualSafetyReview":
      case "legalCompliance":
        return;
      default:
        source = null;
    }
    if (!source) {
      throw new AppException(
        "ACCOUNT_ACTION_SOURCE_NOT_FOUND",
        "The controlled source reference does not belong to the target user",
        HttpStatus.CONFLICT,
        {
          sourceType: evidence.sourceType,
          sourceReference: evidence.sourceReference
        }
      );
    }
  }

  private async assertNoActiveCommercialObligations(db: any, userId: string) {
    const [orders, refunds, paymentDisputes, attendanceDisputes, supportTickets] =
      await Promise.all([
        db.order.count({
          where: {
            userId,
            status: { in: [...ACTIVE_COMMERCIAL_OBLIGATION_STATUSES.orders] }
          }
        }),
        db.refundTransaction.count({
          where: {
            order: { userId },
            status: { in: [...ACTIVE_COMMERCIAL_OBLIGATION_STATUSES.refunds] }
          }
        }),
        db.paymentDispute.count({
          where: { order: { userId }, status: { not: "resolved" } }
        }),
        db.attendanceDispute.count({
          where: { order: { userId }, status: { not: "final" } }
        }),
        db.supportTicket.count({
          where: {
            userId,
            status: { in: [...ACTIVE_COMMERCIAL_OBLIGATION_STATUSES.supportTickets] }
          }
        })
      ]);
    const counts = {
      orders,
      refunds,
      paymentDisputes,
      attendanceDisputes,
      supportTickets
    };
    const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
    if (total > 0) {
      throw new AppException(
        "ACCOUNT_ACTION_HAS_ACTIVE_COMMERCIAL_OBLIGATIONS",
        "Settle active paid-service, refund, dispute, and support obligations before restricting or banning the account",
        HttpStatus.CONFLICT,
        { total, counts }
      );
    }
  }

  private assertReviewable(existing: any, actorId: string): asserts existing {
    if (!existing) {
      throw new AppException(
        "USER_ACCOUNT_APPEAL_NOT_FOUND",
        "Account appeal not found",
        HttpStatus.NOT_FOUND
      );
    }
    if (existing.status !== "pending") {
      throw new AppException(
        "USER_ACCOUNT_APPEAL_ALREADY_RESOLVED",
        "Account appeal is already resolved",
        HttpStatus.CONFLICT
      );
    }
    if (existing.action?.createdById && existing.action.createdById === actorId) {
      throw new AppException(
        "USER_ACCOUNT_APPEAL_INDEPENDENT_REVIEW_REQUIRED",
        "The original account-action creator cannot claim, assign, or resolve its appeal",
        HttpStatus.CONFLICT
      );
    }
  }

  private appealDto(appeal: any) {
    const now = new Date();
    return {
      id: appeal.id,
      status: appeal.status,
      statement: appeal.statement,
      reviewDueAt: appeal.reviewDueAt.toISOString(),
      overdue:
        appeal.status === "pending" && appeal.reviewDueAt.getTime() < now.getTime(),
      resolution: appeal.resolution ?? null,
      resolvedAt: appeal.resolvedAt?.toISOString() ?? null,
      policyVersion: appeal.policyVersion,
      createdAt: appeal.createdAt.toISOString()
    };
  }

  private actionDto(action: any) {
    const now = new Date();
    return {
      id: action.id,
      kind: action.kind,
      reasonCode: action.reasonCode,
      message: action.message,
      policyVersion: action.policyVersion,
      startsAt: action.startsAt.toISOString(),
      endsAt: action.endsAt?.toISOString() ?? null,
      appealDeadlineAt: action.appealDeadlineAt.toISOString(),
      revokedAt: action.revokedAt?.toISOString() ?? null,
      canAppeal:
        !action.revokedAt
        && !action.appeal
        && action.appealDeadlineAt.getTime() > now.getTime(),
      appeal: action.appeal ? this.appealDto(action.appeal) : null
    };
  }

  private adminEvidenceDto(action: any) {
    if (action.evidenceAnonymizedAt) {
      return {
        status: "anonymized",
        sourceType: null,
        sourceReference: null,
        evidenceReference: null,
        evidenceDigest: null,
        anonymizedAt: action.evidenceAnonymizedAt.toISOString()
      };
    }
    if (!action.sourceType) {
      return {
        status: "legacyUnavailable",
        sourceType: null,
        sourceReference: null,
        evidenceReference: null,
        evidenceDigest: null,
        anonymizedAt: null
      };
    }
    return {
      status: "available",
      sourceType: action.sourceType,
      sourceReference: action.sourceReference,
      evidenceReference: action.evidenceReference,
      evidenceDigest: action.evidenceDigest,
      anonymizedAt: null
    };
  }

  private adminAppealDto(appeal: any, actorId: string) {
    return {
      ...this.appealDto(appeal),
      userId: appeal.userId,
      actionId: appeal.actionId,
      assignedToUserId: appeal.assignedToUserId ?? null,
      assignedAt: appeal.assignedAt?.toISOString() ?? null,
      independentReviewEligible:
        !appeal.action?.createdById || appeal.action.createdById !== actorId,
      action: appeal.action
        ? {
            id: appeal.action.id,
            kind: appeal.action.kind,
            reasonCode: appeal.action.reasonCode,
            message: appeal.action.message,
            policyVersion: appeal.action.policyVersion,
            startsAt: appeal.action.startsAt.toISOString(),
            endsAt: appeal.action.endsAt?.toISOString() ?? null,
            appealDeadlineAt: appeal.action.appealDeadlineAt.toISOString(),
            revokedAt: appeal.action.revokedAt?.toISOString() ?? null,
            createdById: appeal.action.createdById ?? null,
            evidence: this.adminEvidenceDto(appeal.action)
          }
        : null
    };
  }
}
