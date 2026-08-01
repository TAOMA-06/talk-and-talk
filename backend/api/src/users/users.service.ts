import { HttpStatus, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { AuthIdentityTombstoneService } from "../auth/auth-identity-tombstone.service";
import { AuditService } from "../common/audit/audit.service";
import {
  ACCOUNT_DELETION_POLICY_VERSION,
  ACCOUNT_DELETION_PUBLIC_POLICY,
  accountDeletionDueAt,
  isAccountDeletionOverdue
} from "../common/account-deletion-policy";
import {
  ACCOUNT_DELETION_RETENTION_CATEGORIES,
  ACCOUNT_DELETION_RETENTION_POLICY_VERSION,
  retentionEndsAt
} from "../common/account-deletion-retention-policy";
import { AppException } from "../common/errors/app.exception";
import { maskPhone } from "../common/logging/redact";
import { PrismaService } from "../database/prisma.service";
import { LegalDocumentArchiveService } from "../legal/legal-document-archive.service";
import { ModerationCaseService } from "../moderation/moderation-case.service";
import { ModerationService } from "../moderation/moderation.service";
import {
  ACCOUNT_DELETION_RETAINED_SNAPSHOT_REGISTRY,
  AccountDeletionRetainedSnapshotCategory,
  AccountDeletionRetainedSnapshotProgress,
  validateAccountDeletionRetainedSnapshotProgress
} from "./account-deletion-retained-snapshot.registry";
import { CreateLegalConsentDto } from "./dto/legal-consent.dto";
import { UpdateMeDto } from "./dto/update-me.dto";

const LEGAL_CONSENT_CLOCK_SKEW_MS = 5 * 60 * 1000;
const DELETION_PROCESSING_COOLDOWN_MS = 60 * 1000;
const CONSUMER_DELETION_ROLES = new Set(["user", "companion"]);

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    private readonly legalArchive: LegalDocumentArchiveService,
    private readonly moderation: ModerationService,
    private readonly moderationCases: ModerationCaseService,
    private readonly authTombstones: AuthIdentityTombstoneService
  ) {}

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true }
    });

    if (!user) {
      throw new AppException("UNAUTHORIZED", "User not found", HttpStatus.UNAUTHORIZED);
    }

    return {
      id: user.id,
      role: user.role,
      profile: user.profile
        ? {
            displayName: user.profile.displayName,
            phone: user.profile.phone ? maskPhone(user.profile.phone) : null,
            age: user.profile.age,
            gender: user.profile.gender,
            isVerified: user.profile.isVerified,
            safetyScore: user.profile.safetyScore
          }
        : null
    };
  }

  async updateMe(userId: string, dto: UpdateMeDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new AppException("UNAUTHORIZED", "User not found", HttpStatus.UNAUTHORIZED);
    }

    const profileData: {
      displayName?: string;
      gender?: string | null;
      age?: number;
    } = {};

    if (dto.displayName !== undefined) {
      const displayName = dto.displayName.trim();
      if (!displayName) {
        throw new AppException("DISPLAY_NAME_REQUIRED", "Display name is required", HttpStatus.BAD_REQUEST);
      }
      const moderation = await this.moderation.moderateAsync(displayName, "profile");
      if (moderation.decision !== "allow") {
        const moderationCase = await this.moderationCases.createFromResult({
          result: moderation,
          source: "profile",
          content: displayName,
          targetId: userId,
          subjectUserId: userId,
          actorId: userId,
          title: "公开昵称待处理",
          forceCreate: true
        });
        throw new AppException(
          "DISPLAY_NAME_REQUIRES_REVISION",
          "Display name cannot be published; revise it and try again",
          HttpStatus.UNPROCESSABLE_ENTITY,
          { moderationCaseId: moderationCase?.id ?? null, decision: moderation.decision }
        );
      }
      profileData.displayName = displayName;
    }
    if (dto.gender !== undefined) {
      // null is the only persisted representation of "prefer not to say".
      // Never manufacture a third demographic category as a display sentinel.
      profileData.gender = dto.gender;
    }
    if (dto.age !== undefined) {
      profileData.age = dto.age;
    }

    if (Object.keys(profileData).length > 0) {
      await this.prisma.userProfile.upsert({
        where: { userId },
        create: {
          userId,
          ...profileData
        },
        update: profileData
      });
    }

    return this.getMe(userId);
  }

  async requestDeletion(userId: string) {
    const request = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      // New order intake uses the same transaction-scoped lock. Once this
      // request commits, no concurrent order can slip between settlement
      // inspection and creation of the deletion-drain state.
      await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('talk-and-talk:order-intake'))::text AS "lock"`;
      await db.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
      const subject = await db.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          role: true,
          staffCredential: { select: { id: true } },
          companionProfile: { select: { id: true } }
        }
      });
      if (!subject) {
        throw new AppException("UNAUTHORIZED", "User not found", HttpStatus.UNAUTHORIZED);
      }
      this.assertConsumerDeletionSubject(subject);
      const completed = await db.accountDeletionRequest.findFirst({
        where: { userId, status: "completed" },
        orderBy: { updatedAt: "desc" }
      });
      if (completed) {
        throw new AppException(
          "DELETION_ALREADY_COMPLETED",
          "This account deletion has already been completed",
          HttpStatus.CONFLICT
        );
      }
      if (subject.companionProfile?.id) {
        await this.suspendCompanionSupplyForDeletion(
          db,
          subject.companionProfile.id,
          userId,
          new Date(),
          "account_deletion_draining"
        );
      }
      const existing = await db.accountDeletionRequest.findFirst({
        where: { userId, status: { in: ["pending", "processing"] } },
        orderBy: { createdAt: "desc" }
      });
      if (existing) return existing;

      const createdAt = new Date();
      const dueAt = accountDeletionDueAt(createdAt);
      const created = await db.accountDeletionRequest.create({
        data: {
          userId,
          status: "pending",
          createdAt,
          dueAt,
          policyVersion: ACCOUNT_DELETION_POLICY_VERSION
        }
      });
      await this.audit.record({
        actorId: userId,
        subjectUserIds: [userId],
        action: "account.deletion_requested",
        resourceType: "accountDeletionRequest",
        resourceId: created.id,
        metadata: {
          userId: created.userId,
          dueAt: created.dueAt.toISOString(),
          policyVersion: created.policyVersion
        }
      }, db);
      return created;
    });

    return {
      ...this.deletionRequestUserDto(request),
      message: "我们已收到你的注销申请，将按当前规则在 15 个工作日内处理；进入处理阶段前可在“账户与隐私”取消。",
      policy: ACCOUNT_DELETION_PUBLIC_POLICY
    };
  }

  async getMyDeletionRequest(userId: string) {
    const request = await this.prisma.accountDeletionRequest.findFirst({
      where: { userId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }]
    });

    return {
      request: request ? this.deletionRequestUserDto(request) : null,
      policy: ACCOUNT_DELETION_PUBLIC_POLICY
    };
  }

  async cancelMyDeletionRequest(userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      // Order intake and deletion submission take this lock first and then the
      // user row. Cancellation follows the same order so a new order can only
      // be created after the pending deletion state has committed as cancelled.
      await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('talk-and-talk:order-intake'))::text AS "lock"`;
      await db.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
      const subject = await db.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          role: true,
          accountStatus: true,
          staffCredential: { select: { id: true } },
          companionProfile: { select: { id: true } }
        }
      });
      if (!subject) {
        throw new AppException("UNAUTHORIZED", "User not found", HttpStatus.UNAUTHORIZED);
      }
      this.assertConsumerDeletionSubject(subject);

      const request = await db.accountDeletionRequest.findFirst({
        where: { userId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }]
      });
      if (!request) {
        throw new AppException(
          "DELETION_REQUEST_NOT_FOUND",
          "Account deletion request not found",
          HttpStatus.NOT_FOUND
        );
      }
      if (request.status === "cancelled") {
        return this.deletionCancellationResponse(request, subject, true);
      }
      if (request.status !== "pending") {
        throw new AppException(
          "DELETION_REQUEST_NOT_CANCELLABLE",
          "Only a pending account deletion request can be cancelled",
          HttpStatus.CONFLICT,
          {
            deletionRequestId: request.id,
            status: request.status,
            sessionsRestored: false
          }
        );
      }

      const cancelledAt = new Date();
      const companionId = subject.companionProfile?.id ?? null;
      let markedDeletionSuspensionForReview = false;
      if (companionId) {
        // Filing a deletion request destroys no commercial evidence, but it
        // deliberately retires live supply. We cannot infer whether each old
        // offering/window is still compliant, so cancellation reasserts the
        // drain and records a manual-reactivation state instead of restoring a
        // stale marketplace snapshot.
        await this.suspendCompanionSupplyForDeletion(
          db,
          companionId,
          userId,
          cancelledAt,
          "account_deletion_draining"
        );
        const marked = await db.companionCommercialProfile.updateMany({
          where: {
            companionId,
            status: "suspended",
            suspendedReason: {
              in: ["account_deletion_draining", "account_deletion_processing"]
            }
          },
          data: {
            suspendedAt: cancelledAt,
            suspendedById: userId,
            suspendedReason: "account_deletion_cancelled_requires_reactivation"
          }
        });
        markedDeletionSuspensionForReview = marked.count > 0;
      }

      const claimed = await db.accountDeletionRequest.updateMany({
        where: {
          id: request.id,
          userId,
          status: "pending",
          updatedAt: request.updatedAt
        },
        data: {
          status: "cancelled",
          cancelledAt,
          companionReactivationRequired: Boolean(companionId),
          updatedAt: cancelledAt
        }
      });
      if (claimed.count !== 1) {
        throw new AppException(
          "DELETION_REQUEST_STATE_CONFLICT",
          "Account deletion request changed while cancellation was being recorded",
          HttpStatus.CONFLICT
        );
      }

      const notificationEventKey = `account-deletion:${request.id}:cancelled`;
      await db.notification.upsert({
        where: { eventKey: notificationEventKey },
        create: {
          userId,
          type: "supportUpdate",
          title: "账号注销申请已取消",
          body: companionId
            ? "注销处理已停止。陪伴者供给保持暂停，完成重新审核和上架后才会恢复。"
            : "注销处理已停止。其他独立账号限制或处罚不会因此改变。",
          data: {
            deletionRequestId: request.id,
            status: "cancelled",
            companionReactivationRequired: Boolean(companionId)
          },
          eventKey: notificationEventKey
        },
        update: {}
      });
      await this.audit.record({
        actorId: userId,
        subjectUserIds: [userId],
        action: "account.deletion_cancelled",
        resourceType: "accountDeletionRequest",
        resourceId: request.id,
        metadata: {
          userId,
          previousStatus: "pending",
          cancelledAt: cancelledAt.toISOString(),
          accountStatusPreserved: subject.accountStatus,
          independentAccountActionsPreserved: true,
          sessionsRestored: false,
          companionId,
          companionReactivationRequired: Boolean(companionId),
          markedDeletionSuspensionForReview,
          notificationEventKey
        }
      }, db);

      request.status = "cancelled";
      request.cancelledAt = cancelledAt;
      request.companionReactivationRequired = Boolean(companionId);
      request.updatedAt = cancelledAt;
      return this.deletionCancellationResponse(request, subject, false);
    });
  }

  async listDeletionRequests(status?: "pending" | "processing", page = 1, pageSize = 50) {
    const where = status
      ? { status }
      : { status: { in: ["pending", "processing"] as Array<"pending" | "processing"> } };
    const [requests, total] = await Promise.all([
      this.prisma.accountDeletionRequest.findMany({
        where,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          user: {
            select: { id: true, role: true, accountStatus: true, createdAt: true }
          }
        }
      }),
      this.prisma.accountDeletionRequest.count({ where })
    ]);
    return {
      items: requests.map((request) => this.deletionRequestDto(request)),
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
      policy: ACCOUNT_DELETION_PUBLIC_POLICY
    };
  }

  async getDeletionSettlementUserId(requestId: string, orderId: string) {
    return this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      const candidate = await db.accountDeletionRequest.findUnique({
        where: { id: requestId },
        select: { userId: true }
      });
      if (!candidate) {
        throw new AppException("DELETION_REQUEST_NOT_FOUND", "Account deletion request not found", HttpStatus.NOT_FOUND);
      }
      await db.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${candidate.userId} FOR UPDATE`;
      const request = await db.accountDeletionRequest.findUnique({
        where: { id: requestId },
        select: {
          userId: true,
          status: true,
          user: { select: { companionProfile: { select: { id: true } } } }
        }
      });
      if (!request || request.status !== "processing") {
        throw new AppException(
          "DELETION_REQUEST_STATE_CONFLICT",
          "Only a processing deletion request may settle financial state",
          HttpStatus.CONFLICT
        );
      }
      await db.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
      const order = await db.order.findUnique({
        where: { id: orderId },
        select: { userId: true, companionId: true }
      });
      const ownsCustomerSide = order?.userId === request.userId;
      const ownsCompanionSide = Boolean(
        order && request.user.companionProfile?.id === order.companionId
      );
      if (!order || (!ownsCustomerSide && !ownsCompanionSide)) {
        throw new AppException("ORDER_NOT_FOUND", "Order not found for this deletion request", HttpStatus.NOT_FOUND);
      }
      // Payment/refund services authorize against the actual payer. A
      // companion deletion may settle a provider-side order, but it must never
      // impersonate the companion as the customer.
      return order.userId;
    });
  }

  async getDeletionSettlementDetails(requestId: string, page = 1, pageSize = 50) {
    const request: any = await this.prisma.accountDeletionRequest.findUnique({
      where: { id: requestId },
      include: {
        user: {
          select: {
            id: true,
            role: true,
            accountStatus: true,
            createdAt: true,
            staffCredential: { select: { id: true } },
            companionProfile: { select: { id: true } }
          }
        }
      }
    } as any);
    if (!request) {
      throw new AppException("DELETION_REQUEST_NOT_FOUND", "Account deletion request not found", HttpStatus.NOT_FOUND);
    }
    const companionId = request.user.companionProfile?.id ?? null;
    const orderWhere = companionId
      ? { OR: [{ userId: request.userId }, { companionId }] }
      : { userId: request.userId };
    const [orders, totalOrders]: [any[], number] = await Promise.all([
      this.prisma.order.findMany({
        where: orderWhere,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          payments: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1 },
          refunds: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1 }
        }
      } as any),
      this.prisma.order.count({ where: orderWhere } as any)
    ]);
    const blockingObligations = await this.activeDeletionObligations(
      this.prisma as any,
      request.userId,
      request.user
    );
    const retentionPolicyApproved = this.config.get<boolean>(
      "ACCOUNT_DELETION_RETENTION_POLICY_APPROVED"
    ) === true;
    const retentionPolicyApprovalReference = this.config.get<string>(
      "ACCOUNT_DELETION_RETENTION_POLICY_APPROVAL_REFERENCE"
    )?.trim() || null;
    return {
      request: this.deletionRequestDto(request),
      blockingObligations,
      retentionPolicy: {
        version: ACCOUNT_DELETION_RETENTION_POLICY_VERSION,
        approved: retentionPolicyApproved && Boolean(retentionPolicyApprovalReference),
        approvalReference: retentionPolicyApprovalReference
      },
      orders: orders.map((order) => ({
        id: order.id,
        relationship: order.userId === request.userId ? "customer" : "companion",
        status: order.status,
        amountCents: order.amountCents,
        scheduledAt: order.scheduledAt.toISOString(),
        payment: order.payments[0]
          ? {
              id: order.payments[0].id,
              outTradeNo: order.payments[0].outTradeNo,
              status: order.payments[0].status,
              expiresAt: order.payments[0].expiresAt?.toISOString() ?? null
            }
          : null,
        refund: order.refunds[0]
          ? {
              id: order.refunds[0].id,
              status: order.refunds[0].status,
              outRefundNo: order.refunds[0].outRefundNo
            }
          : null
      })),
      pagination: {
        page,
        pageSize,
        total: totalOrders,
        totalPages: Math.ceil(totalOrders / pageSize)
      }
    };
  }

  async startDeletionRequest(requestId: string, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      const candidate = await db.accountDeletionRequest.findUnique({
        where: { id: requestId },
        select: { userId: true }
      });
      if (!candidate) {
        throw new AppException("DELETION_REQUEST_NOT_FOUND", "Account deletion request not found", HttpStatus.NOT_FOUND);
      }
      await db.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${candidate.userId} FOR UPDATE`;
      const request = await db.accountDeletionRequest.findUnique({
        where: { id: requestId },
        include: {
          user: {
            select: {
              id: true,
              role: true,
              accountStatus: true,
              createdAt: true,
              staffCredential: { select: { id: true } },
              companionProfile: { select: { id: true } }
            }
          }
        }
      });
      if (!request) {
        throw new AppException("DELETION_REQUEST_NOT_FOUND", "Account deletion request not found", HttpStatus.NOT_FOUND);
      }
      this.assertConsumerDeletionSubject(request.user);
      if (request.status === "processing") return this.deletionRequestDto(request);
      if (request.status !== "pending") {
        throw new AppException(
          "DELETION_REQUEST_STATE_CONFLICT",
          `Cannot start an account deletion request with status ${request.status}`,
          HttpStatus.CONFLICT
        );
      }

      // Keep the account usable while it drains existing commitments. Supply
      // was already unpublished when the request was filed, and new customer
      // orders are rejected by OrdersService. Restricting before this reaches
      // zero would strand paid/in-service orders and create a deletion deadlock.
      const activeObligations = await this.activeDeletionObligations(db, request.userId, request.user);
      if (activeObligations.total > 0) {
        throw new AppException(
          "DELETION_HAS_ACTIVE_OBLIGATIONS",
          "Account deletion cannot enter processing while obligations still require the account to remain operational",
          HttpStatus.CONFLICT,
          { total: activeObligations.total, counts: activeObligations.counts }
        );
      }

      const restrictedAt = new Date();
      const authTombstoneCount = await this.authTombstones.installForDeletionTx(
        db,
        request.id,
        request.userId,
        restrictedAt
      );
      const claimed = await db.accountDeletionRequest.updateMany({
        where: { id: requestId, status: "pending", updatedAt: request.updatedAt },
        data: {
          status: "processing",
          processingStartedById: actorId,
          processingStartedAt: restrictedAt,
          updatedAt: restrictedAt
        }
      });
      if (claimed.count !== 1) {
        throw new AppException(
          "DELETION_REQUEST_STATE_CONFLICT",
          "Account deletion request changed while processing was started",
          HttpStatus.CONFLICT
        );
      }
      request.status = "processing";
      request.processingStartedById = actorId;
      request.processingStartedAt = restrictedAt;
      request.updatedAt = restrictedAt;
      const restricted = await db.user.updateMany({
        where: { id: request.userId, accountStatus: "active" },
        data: { accountStatus: "restricted" }
      });
      const companionId = request.user.companionProfile?.id ?? null;
      let companionSupplySuspended = false;
      if (companionId) {
        await this.suspendCompanionSupplyForDeletion(
          db,
          companionId,
          actorId,
          restrictedAt,
          "account_deletion_processing"
        );
        companionSupplySuspended = true;
      }
      const revocableSessions: Array<{ id: string }> = await db.refreshToken.findMany({
        where: { userId: request.userId, revokedAt: null },
        select: { id: true },
        orderBy: { id: "asc" },
        take: 250
      });
      // Account status closes ordinary access immediately. Revoke at most one
      // bounded session batch in this settlement transaction; the persisted
      // deletion worker drains every remaining token in independent batches.
      const revoked = revocableSessions.length
        ? await db.refreshToken.updateMany({
            where: { id: { in: revocableSessions.map((session) => session.id) } },
            data: { revokedAt: restrictedAt }
          })
        : { count: 0 };
      if (restricted.count === 1) request.user.accountStatus = "restricted";
      await this.audit.record({
        actorId,
        subjectUserIds: [request.userId],
        action: "account.deletion_processing_started",
        resourceType: "accountDeletionRequest",
        resourceId: request.id,
        metadata: {
          userId: request.userId,
          processingStartedById: actorId,
          accountRestricted: restricted.count === 1,
          companionSupplySuspended,
          revokedRefreshTokenCount: revoked.count,
          refreshTokenRevocationBatchLimit: 250,
          remainingRefreshTokensDrainedByExecutionWorker: true,
          authTombstoneCount,
          processingCooldownSeconds: DELETION_PROCESSING_COOLDOWN_MS / 1000
        }
      }, db);
      return this.deletionRequestDto(request);
    });
  }

  async completeDeletionRequest(requestId: string, actorId: string, note: string) {
    const normalizedNote = note.trim();
    if (!normalizedNote) {
      throw new AppException("DELETION_NOTE_REQUIRED", "A completion note is required", HttpStatus.BAD_REQUEST);
    }
    const policyApproved = this.config.get<boolean>(
      "ACCOUNT_DELETION_RETENTION_POLICY_APPROVED"
    ) === true;
    const policyApprovalReference = this.config.get<string>(
      "ACCOUNT_DELETION_RETENTION_POLICY_APPROVAL_REFERENCE"
    )?.trim() || "";
    if (!policyApproved || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{5,159}$/.test(policyApprovalReference)) {
      throw new AppException(
        "DELETION_RETENTION_POLICY_NOT_APPROVED",
        "Account deletion cannot be approved until the retention schedule has external legal approval",
        HttpStatus.SERVICE_UNAVAILABLE,
        { policyVersion: ACCOUNT_DELETION_RETENTION_POLICY_VERSION }
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      const approvedAt = new Date();
      const candidate = await db.accountDeletionRequest.findUnique({
        where: { id: requestId },
        select: { userId: true }
      });
      if (!candidate) {
        throw new AppException("DELETION_REQUEST_NOT_FOUND", "Account deletion request not found", HttpStatus.NOT_FOUND);
      }
      await db.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${candidate.userId} FOR UPDATE`;
      const request = await db.accountDeletionRequest.findUnique({
        where: { id: requestId },
        include: {
          user: {
            select: {
              id: true,
              role: true,
              accountStatus: true,
              createdAt: true,
              staffCredential: { select: { id: true } },
              companionProfile: { select: { id: true } }
            }
          }
        }
      });
      if (!request) {
        throw new AppException("DELETION_REQUEST_NOT_FOUND", "Account deletion request not found", HttpStatus.NOT_FOUND);
      }
      if (request.status === "completed") {
        const repairedLedger: Array<{ recordCount: string }> = await db.$queryRaw`
          SELECT ensure_completed_account_deletion_retention_ledger(
            ${request.id},
            ${policyApprovalReference}
          )::text AS "recordCount"
        `;
        const ledgerRecordCount = Number.parseInt(repairedLedger?.[0]?.recordCount ?? "", 10);
        if (ledgerRecordCount !== ACCOUNT_DELETION_RETENTION_CATEGORIES.length) {
          throw new AppException(
            "DELETION_RETENTION_LEDGER_INCOMPLETE",
            "The completed deletion retention ledger could not be repaired safely",
            HttpStatus.SERVICE_UNAVAILABLE
          );
        }
        return this.deletionRequestDto(request);
      }
      if (request.status !== "processing") {
        throw new AppException(
          "DELETION_REQUEST_STATE_CONFLICT",
          `Cannot approve an account deletion request with status ${request.status}`,
          HttpStatus.CONFLICT
        );
      }
      if (request.userId === actorId) {
        throw new AppException(
          "SELF_DELETION_COMPLETION_FORBIDDEN",
          "Administrators cannot approve their own account deletion",
          HttpStatus.CONFLICT
        );
      }
      if (!request.processingStartedById) {
        throw new AppException(
          "DELETION_PROCESSING_ACTOR_UNKNOWN",
          "The processing operator is not recorded; migrate or restart this request before approval",
          HttpStatus.CONFLICT
        );
      }
      if (request.processingStartedById === actorId) {
        throw new AppException(
          "DELETION_SECOND_REVIEW_REQUIRED",
          "A different administrator must approve the account deletion",
          HttpStatus.FORBIDDEN
        );
      }

      // Approval is idempotent. A retry never changes the immutable second
      // reviewer, legal reference, subject or companion snapshot.
      if (request.approvedAt || (request.executionStatus ?? "idle") !== "idle") {
        if (request.approvedAt) {
          await this.authTombstones.sealExpiryForDeletionTx(db, request.id, request.approvedAt);
        }
        return this.deletionRequestDto(request);
      }
      const processingStartedAt = request.processingStartedAt ?? request.updatedAt;
      if (approvedAt.getTime() - processingStartedAt.getTime() < DELETION_PROCESSING_COOLDOWN_MS) {
        throw new AppException(
          "DELETION_PROCESSING_COOLDOWN",
          "Wait for in-flight account operations to settle before approving deletion",
          HttpStatus.CONFLICT
        );
      }
      const activeObligations = await this.activeDeletionObligations(db, request.userId, request.user);
      if (activeObligations.total > 0) {
        throw new AppException(
          "DELETION_HAS_ACTIVE_OBLIGATIONS",
          "Account deletion cannot be approved while financial, service, complaint, appeal or rights obligations remain active",
          HttpStatus.CONFLICT,
          { total: activeObligations.total, counts: activeObligations.counts }
        );
      }

      const authTombstoneCount = await this.authTombstones.assertCoverageTx(
        db,
        request.id,
        request.userId
      );
      const authTombstoneExpiresAt = await this.authTombstones.sealExpiryForDeletionTx(
        db,
        request.id,
        approvedAt
      );

      const companionId = request.user.companionProfile?.id ?? null;
      const queued = await db.accountDeletionRequest.updateMany({
        where: {
          id: request.id,
          status: "processing",
          approvedAt: null,
          executionStatus: "idle",
          updatedAt: request.updatedAt
        },
        data: {
          approvedById: actorId,
          approvedAt,
          approvalNote: normalizedNote,
          retentionApprovalReference: policyApprovalReference,
          companionIdSnapshot: companionId,
          executionStatus: "queued",
          executionPhase: "pending_customer_adult_eligibility",
          executionNextAttemptAt: approvedAt,
          executionLastErrorCode: null,
          executionFailedAt: null,
          executionDeletedCounts: {},
          executionRetainedCounts: {},
          note: normalizedNote
        }
      });
      if (queued.count !== 1) {
        throw new AppException(
          "DELETION_REQUEST_STATE_CONFLICT",
          "Account deletion request changed while approval was being recorded",
          HttpStatus.CONFLICT
        );
      }
      await this.audit.record({
        actorId,
        subjectUserIds: [request.userId],
        action: "account.deletion_execution_queued",
        resourceType: "accountDeletionRequest",
        resourceId: request.id,
        metadata: {
          userId: request.userId,
          processingStartedById: request.processingStartedById,
          approvedById: actorId,
          approvedAt: approvedAt.toISOString(),
          retentionPolicyVersion: ACCOUNT_DELETION_RETENTION_POLICY_VERSION,
          retentionPolicyApprovalReference: policyApprovalReference,
          authTombstoneCount,
          authTombstoneExpiresAt: authTombstoneExpiresAt.toISOString(),
          companionId,
          firstPhase: "pending_customer_adult_eligibility"
        }
      }, db);

      Object.assign(request, {
        approvedById: actorId,
        approvedAt,
        approvalNote: normalizedNote,
        retentionApprovalReference: policyApprovalReference,
        companionIdSnapshot: companionId,
        executionStatus: "queued",
        executionPhase: "pending_customer_adult_eligibility",
        executionNextAttemptAt: approvedAt,
        executionDeletedCounts: {},
        executionRetainedCounts: {},
        note: normalizedNote,
        updatedAt: approvedAt
      });
      return this.deletionRequestDto(request);
    });
  }

  async retryDeletionExecution(requestId: string, actorId: string, reason: string) {
    const normalizedReason = reason.trim();
    if (!normalizedReason) {
      throw new AppException("DELETION_RETRY_REASON_REQUIRED", "A retry reason is required", HttpStatus.BAD_REQUEST);
    }
    return this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      const candidate = await db.accountDeletionRequest.findUnique({
        where: { id: requestId },
        select: { userId: true }
      });
      if (!candidate) {
        throw new AppException("DELETION_REQUEST_NOT_FOUND", "Account deletion request not found", HttpStatus.NOT_FOUND);
      }
      await db.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${candidate.userId} FOR UPDATE`;
      const request = await db.accountDeletionRequest.findUnique({
        where: { id: requestId },
        include: {
          user: { select: { id: true, role: true, accountStatus: true, createdAt: true } }
        }
      });
      if (!request || request.status !== "processing" || request.executionStatus !== "failed") {
        throw new AppException(
          "DELETION_EXECUTION_NOT_RETRYABLE",
          "Only a failed in-progress account deletion execution can be retried",
          HttpStatus.CONFLICT
        );
      }
      if (!request.approvedAt || !request.approvedById || !request.retentionApprovalReference) {
        throw new AppException(
          "DELETION_EXECUTION_APPROVAL_MISSING",
          "The immutable second-review approval is missing",
          HttpStatus.CONFLICT
        );
      }
      const retriedAt = new Date();
      await db.accountDeletionRequest.update({
        where: { id: request.id },
        data: {
          executionStatus: "queued",
          executionNextAttemptAt: retriedAt,
          executionLastErrorCode: null,
          executionFailedAt: null,
          executionLeaseToken: null,
          executionLeaseExpiresAt: null
        }
      });
      await this.audit.record({
        actorId,
        subjectUserIds: [request.userId],
        action: "account.deletion_execution_retry_queued",
        resourceType: "accountDeletionRequest",
        resourceId: request.id,
        metadata: {
          userId: request.userId,
          phase: request.executionPhase,
          priorAttemptCount: request.executionAttemptCount,
          reason: normalizedReason,
          retriedAt: retriedAt.toISOString()
        }
      }, db);
      Object.assign(request, {
        executionStatus: "queued",
        executionNextAttemptAt: retriedAt,
        executionLastErrorCode: null,
        executionFailedAt: null,
        updatedAt: retriedAt
      });
      return this.deletionRequestDto(request);
    });
  }

  async finalizeDeletionExecution(requestId: string, leaseToken: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      const candidate = await db.accountDeletionRequest.findUnique({
        where: { id: requestId },
        select: { userId: true }
      });
      if (!candidate) return false;

      // Preserve the global ownership-sensitive lock order used by settlement
      // and retention processing: User -> deletion request -> companion.
      await db.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${candidate.userId} FOR UPDATE`;
      const claimed = await db.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "AccountDeletionRequest"
        WHERE "id" = ${requestId}
          AND "status" = 'processing'
          AND "executionStatus" = 'processing'
          AND "executionPhase" = 'final_verification'
          AND "executionLeaseToken" = ${leaseToken}
        FOR UPDATE
      `;
      if (!claimed.length) return false;
      const request = await db.accountDeletionRequest.findUnique({
        where: { id: requestId },
        include: {
          user: {
            select: {
              id: true,
              role: true,
              accountStatus: true,
              createdAt: true,
              staffCredential: { select: { id: true } },
              companionProfile: { select: { id: true } }
            }
          }
        }
      });
      if (!request) return false;
      if (!request.approvedById
        || !request.approvedAt
        || !request.approvalNote
        || !request.retentionApprovalReference) {
        throw new Error("Account deletion finalization approval provenance is missing");
      }
      if (request.processingStartedById === request.approvedById) {
        throw new Error("Account deletion finalization violates second-person control");
      }
      const configuredApproval = this.config.get<string>(
        "ACCOUNT_DELETION_RETENTION_POLICY_APPROVAL_REFERENCE"
      )?.trim() || "";
      if (this.config.get<boolean>("ACCOUNT_DELETION_RETENTION_POLICY_APPROVED") !== true
        || configuredApproval !== request.retentionApprovalReference) {
        throw new Error("Account deletion retention approval is no longer valid");
      }
      this.assertConsumerDeletionSubject(request.user);

      const currentCompanionId = request.user.companionProfile?.id ?? null;
      if (currentCompanionId !== request.companionIdSnapshot) {
        throw new Error("Account deletion companion linkage changed after approval");
      }
      if (request.companionIdSnapshot) {
        await db.$queryRaw`
          SELECT "id"
          FROM "CompanionProfile"
          WHERE "id" = ${request.companionIdSnapshot}
          FOR UPDATE
        `;
      }

      const verifiedRetainedCategoryCounts = await this.assertRetainedSnapshotFinalGate(
        db,
        {
          id: request.id,
          userId: request.userId,
          companionIdSnapshot: request.companionIdSnapshot,
          approvedAt: request.approvedAt,
          executionRetainedCounts: request.executionRetainedCounts
        }
      );

      const activeObligations = await this.activeDeletionObligations(
        db,
        request.userId,
        request.user
      );
      if (activeObligations.total > 0) {
        throw new Error(`Account deletion finalization obligations reappeared: ${activeObligations.total}`);
      }

      const companionId = request.companionIdSnapshot ?? null;
      const postconditions = await db.$queryRaw<Array<{
        purposeEndedRemaining: boolean;
        ratingRefreshRemaining: boolean;
        companionPublicRemaining: boolean;
        mediaDeadlineRemaining: boolean;
      }>>`
        SELECT
          (
            EXISTS (SELECT 1 FROM "CustomerAdultEligibility" WHERE "userId" = ${request.userId} AND "status" = 'pending')
            OR EXISTS (SELECT 1 FROM "NotificationDelivery" WHERE "userId" = ${request.userId})
            OR EXISTS (SELECT 1 FROM "Notification" WHERE "userId" = ${request.userId})
            OR EXISTS (SELECT 1 FROM "WeChatSubscriptionGrant" WHERE "userId" = ${request.userId})
            OR EXISTS (SELECT 1 FROM "RecommendationRequest" WHERE "userId" = ${request.userId})
            OR EXISTS (SELECT 1 FROM "UserRecommendationTag" WHERE "userId" = ${request.userId})
            OR EXISTS (SELECT 1 FROM "UserRecommendationPreference" WHERE "userId" = ${request.userId})
            OR EXISTS (SELECT 1 FROM "UserCompanionRecommendationExclusion" WHERE "userId" = ${request.userId})
            OR EXISTS (SELECT 1 FROM "CompanionFavorite" WHERE "userId" = ${request.userId})
            OR EXISTS (SELECT 1 FROM "CompanionRecentView" WHERE "userId" = ${request.userId})
            OR EXISTS (SELECT 1 FROM "MessageReadState" WHERE "userId" = ${request.userId})
            OR EXISTS (SELECT 1 FROM "ConversationNotificationPreference" WHERE "userId" = ${request.userId})
            OR EXISTS (SELECT 1 FROM "ConversationBlock" WHERE "blockedByUserId" = ${request.userId})
            OR EXISTS (SELECT 1 FROM "RefreshToken" WHERE "userId" = ${request.userId})
            OR EXISTS (SELECT 1 FROM "AuthIdentity" WHERE "userId" = ${request.userId})
            OR EXISTS (SELECT 1 FROM "StaffCredential" WHERE "userId" = ${request.userId})
            OR EXISTS (SELECT 1 FROM "UserProfile" WHERE "userId" = ${request.userId})
            OR EXISTS (SELECT 1 FROM "CommunityLike" WHERE "userId" = ${request.userId})
            OR EXISTS (SELECT 1 FROM "CommunityPostReport" WHERE "reporterUserId" = ${request.userId})
            OR EXISTS (SELECT 1 FROM "CommunityPost" WHERE "authorId" = ${request.userId})
            OR EXISTS (SELECT 1 FROM "Review" WHERE "userId" = ${request.userId})
          ) AS "purposeEndedRemaining",
          EXISTS (
            SELECT 1 FROM "AccountDeletionRatingRefreshJob"
            WHERE "deletionRequestId" = ${request.id} AND "completedAt" IS NULL
          ) AS "ratingRefreshRemaining",
          CASE WHEN ${companionId}::TEXT IS NULL THEN FALSE ELSE (
            EXISTS (SELECT 1 FROM "AvailabilityReminderCandidate" WHERE "companionId" = ${companionId})
            OR EXISTS (SELECT 1 FROM "AvailabilityReminderFanoutJob" WHERE "companionId" = ${companionId})
            OR EXISTS (SELECT 1 FROM "CompanionAvailabilityWindow" window WHERE window."companionId" = ${companionId} AND (window."isActive" OR NOT EXISTS (SELECT 1 FROM "Order" orders WHERE orders."availabilityWindowId" = window."id")))
            OR EXISTS (SELECT 1 FROM "CompanionRecurringAvailabilityRule" WHERE "companionId" = ${companionId})
            OR EXISTS (SELECT 1 FROM "CompanionAvailabilityBlackout" WHERE "companionId" = ${companionId})
            OR EXISTS (SELECT 1 FROM "CompanionRecommendationPolicy" WHERE "companionId" = ${companionId})
            OR EXISTS (SELECT 1 FROM "CompanionServiceOffering" WHERE "companionId" = ${companionId})
            OR EXISTS (SELECT 1 FROM "CompanionServiceTag" WHERE "companionId" = ${companionId})
            OR EXISTS (
              SELECT 1 FROM "CompanionProfile"
              WHERE "id" = ${companionId}
                AND (
                  "isPublished" OR "isOnline" OR "isVerified"
                  OR "voiceIntroAssetRef" IS NOT NULL OR "name" <> '已注销陪伴者'
                )
            )
          ) END AS "companionPublicRemaining",
          EXISTS (
            SELECT 1 FROM "MediaAsset"
            WHERE "uploaderId" = ${request.userId}
              AND (
                "expiresAt" IS NULL
                OR "expiresAt" > ${retentionEndsAt(
                  request.approvedAt,
                  ACCOUNT_DELETION_RETENTION_CATEGORIES.find((entry) => entry.code === "support_disputes_safety")!.retentionDays
                )}
              )
          ) AS "mediaDeadlineRemaining"
      `;
      const observed = postconditions[0];
      if (!observed
        || observed.purposeEndedRemaining
        || observed.ratingRefreshRemaining
        || observed.companionPublicRemaining
        || observed.mediaDeadlineRemaining) {
        throw new Error("Account deletion final postconditions failed");
      }

      const deletedPhaseCounts = request.executionDeletedCounts
        && typeof request.executionDeletedCounts === "object"
        ? request.executionDeletedCounts as Record<string, unknown>
        : {};
      const count = (key: string) => {
        const value = Number(deletedPhaseCounts[key] ?? 0);
        return Number.isSafeInteger(value) && value >= 0 ? value : 0;
      };
      const authTombstoneCount = await this.authTombstones.assertPersistedCoverageTx(
        db,
        request.id,
        count("auth_identity"),
        request.approvedAt
      );
      const deletedCategoryCounts = {
        identity_authentication_profile:
          count("pending_customer_adult_eligibility") + count("refresh_token")
          + count("auth_identity") + count("staff_credential") + count("user_profile"),
        preferences_behavior_notifications:
          count("notification_delivery") + count("notification") + count("subscription_grant")
          + count("recommendation_impression") + count("recommendation_request")
          + count("recommendation_tag") + count("recommendation_preference")
          + count("recommendation_exclusion") + count("availability_reminder_candidate")
          + count("availability_reminder_fanout_job") + count("companion_favorite")
          + count("companion_recent_view") + count("message_read_state")
          + count("conversation_notification_preference") + count("conversation_block")
          + count("companion_availability_window") + count("companion_recurring_rule")
          + count("companion_blackout") + count("companion_recommendation_policy"),
        public_user_content:
          count("community_like") + count("community_report")
          + count("authored_post_like") + count("authored_post_report")
          + count("community_post") + count("review") + count("companion_offering")
          + count("companion_service_tag") + count("companion_profile")
      };
      const retainedCategoryCounts = {
        ...verifiedRetainedCategoryCounts,
        deletion_audit_evidence: 1 + authTombstoneCount
      };
      const existingLedger = await db.accountDataRetentionRecord.count({
        where: { deletionRequestId: request.id }
      });
      if (existingLedger !== 0) {
        throw new Error("Account deletion retention ledger already exists before finalization");
      }

      const completedAt = new Date();
      const safetyDeadline = retentionEndsAt(
        request.approvedAt,
        ACCOUNT_DELETION_RETENTION_CATEGORIES.find((entry) => entry.code === "support_disputes_safety")!.retentionDays
      );
      const ledger = await db.accountDataRetentionRecord.createMany({
        data: ACCOUNT_DELETION_RETENTION_CATEGORIES.map((category) => ({
          deletionRequestId: request.id,
          userId: request.userId,
          category: category.code,
          disposition: category.disposition,
          legalBasisCode: category.legalBasisCode,
          policyVersion: ACCOUNT_DELETION_RETENTION_POLICY_VERSION,
          policyApprovalStatus: "approved",
          policyApprovalReference: request.retentionApprovalReference,
          recordCount: category.disposition === "deleted"
            ? deletedCategoryCounts[category.code as keyof typeof deletedCategoryCounts] ?? 0
            : retainedCategoryCounts[category.code as keyof typeof retainedCategoryCounts] ?? 0,
          processingRestrictedAt: request.approvedAt,
          retentionEndsAt: category.disposition === "retainedRestricted"
            ? retentionEndsAt(request.approvedAt, category.retentionDays)
            : completedAt,
          expiryProcessedAt: category.disposition === "deleted" ? completedAt : null,
          details: {
            description: category.description,
            subjectRole: request.user.role,
            companionId,
            approvalRecordedAt: request.approvedAt.toISOString(),
            erasureFinishedAt: completedAt.toISOString(),
            executionAttemptCount: request.executionAttemptCount,
            boundedBatchSize: 250,
            authIdentityTombstoneCount: category.code === "deletion_audit_evidence"
              ? authTombstoneCount
              : undefined,
            mediaRecordsBoundedToSafetyDeadline: category.code === "support_disputes_safety"
              ? count("media_retention")
              : 0,
            mediaSafetyDeadline: category.code === "support_disputes_safety"
              ? safetyDeadline.toISOString()
              : undefined
          },
          createdAt: completedAt,
          updatedAt: completedAt
        }))
      });
      if (ledger.count !== ACCOUNT_DELETION_RETENTION_CATEGORIES.length) {
        throw new Error("Account deletion retention ledger is incomplete");
      }
      await db.user.update({
        where: { id: request.userId },
        data: {
          accountStatus: "banned",
          dataProcessingRestrictedAt: request.approvedAt,
          deletionCompletedAt: completedAt
        }
      });
      await db.accountDeletionRequest.update({
        where: { id: request.id },
        data: {
          status: "completed",
          completedById: request.approvedById,
          completedAt,
          executionStatus: "completed",
          executionPhase: "completed",
          executionCursor: null,
          executionNextAttemptAt: null,
          executionLastErrorCode: null,
          executionFailedAt: null,
          executionLeaseToken: null,
          executionLeaseExpiresAt: null,
          executionFinishedAt: completedAt
        }
      });
      await this.audit.record({
        actorId: request.approvedById,
        subjectUserIds: [request.userId],
        action: "account.deletion_completed",
        resourceType: "accountDeletionRequest",
        resourceId: request.id,
        metadata: {
          userId: request.userId,
          processingStartedById: request.processingStartedById,
          completedById: request.approvedById,
          completedAt: completedAt.toISOString(),
          executionAttemptCount: request.executionAttemptCount,
          executionProcessedCount: request.executionProcessedCount,
          deletedCategoryCounts,
          retainedCategoryCounts,
          retentionPolicyVersion: ACCOUNT_DELETION_RETENTION_POLICY_VERSION,
          retentionPolicyApprovalReference: request.retentionApprovalReference,
          finalPostconditions: "passed"
        }
      }, db);
      return true;
    }, { timeout: 20_000 });
  }

  private async assertRetainedSnapshotFinalGate(
    db: any,
    request: {
      id: string;
      userId: string;
      companionIdSnapshot: string | null;
      approvedAt: Date;
      executionRetainedCounts: unknown;
    }
  ): Promise<Record<AccountDeletionRetainedSnapshotCategory, number>> {
    await db.$executeRawUnsafe("SET LOCAL statement_timeout = '3000ms'");
    await db.$executeRawUnsafe("SET LOCAL lock_timeout = '500ms'");
    const progressRows: AccountDeletionRetainedSnapshotProgress[] = await db.$queryRaw`
      SELECT
        "id",
        "category",
        "sourceKey",
        "highWaterAt",
        "cursorCreatedAt",
        "cursorId",
        "observedCount",
        "completedAt"
      FROM "AccountDeletionRetentionSnapshotProgress"
      WHERE "deletionRequestId" = ${request.id}
      ORDER BY "category", "sourceKey"
      FOR UPDATE
    `;
    if (progressRows.length !== ACCOUNT_DELETION_RETAINED_SNAPSHOT_REGISTRY.length) {
      throw new Error("Account deletion retained snapshot final registry is incomplete");
    }

    const retainedCounts = request.executionRetainedCounts
      && typeof request.executionRetainedCounts === "object"
      && !Array.isArray(request.executionRetainedCounts)
      ? request.executionRetainedCounts as Record<string, unknown>
      : {};
    const categories = [
      "transactions_tax_invoices",
      "support_disputes_safety",
      "consent_rights_account_governance"
    ] as const;
    const retainedKeys = Object.keys(retainedCounts).sort();
    if (retainedKeys.length !== categories.length
      || categories.some((category) => !retainedKeys.includes(category))) {
      throw new Error("Account deletion retained snapshot aggregate registry is invalid");
    }

    const totals = {} as Record<AccountDeletionRetainedSnapshotCategory, number>;
    for (const category of categories) {
      const sources = ACCOUNT_DELETION_RETAINED_SNAPSHOT_REGISTRY.filter(
        (source) => source.category === category
      );
      const rows = progressRows.filter((row) => row.category === category);
      validateAccountDeletionRetainedSnapshotProgress(
        rows,
        sources,
        request.approvedAt,
        true
      );
      const total = rows.reduce((sum, row) => sum + row.observedCount, 0);
      const recordedTotal = Number(retainedCounts[category]);
      if (!Number.isSafeInteger(total)
        || !Number.isSafeInteger(recordedTotal)
        || recordedTotal < 0
        || recordedTotal !== total) {
        throw new Error(`Account deletion retained snapshot aggregate mismatch: ${category}`);
      }
      totals[category] = total;
    }

    const subject = {
      userId: request.userId,
      companionId: request.companionIdSnapshot
    };
    for (const source of ACCOUNT_DELETION_RETAINED_SNAPSHOT_REGISTRY) {
      if (await source.hasLateArrival(db, subject, request.approvedAt)) {
        throw new Error(
          `Account deletion retained snapshot late arrival: ${source.category}/${source.sourceKey}`
        );
      }
    }
    return totals;
  }

  private async suspendCompanionSupplyForDeletion(
    db: any,
    companionId: string,
    actorId: string,
    suspendedAt: Date,
    reason: "account_deletion_draining" | "account_deletion_processing"
  ) {
    // CompanionProfile and CompanionCommercialProfile are each unique by
    // companion id, so these are strict constant-cardinality writes. Public
    // intake is closed by the profile flag immediately; potentially large
    // offerings/schedules are erased later by the leased bounded worker.
    await Promise.all([
      db.companionProfile.update({
        where: { id: companionId },
        data: { isPublished: false, isOnline: false, availability: "busy" }
      }),
      db.companionCommercialProfile.updateMany({
        where: { companionId, status: { not: "suspended" } },
        data: {
          status: "suspended",
          suspendedAt,
          suspendedById: actorId,
          suspendedReason: reason
        }
      })
    ]);
  }

  private assertConsumerDeletionSubject(subject: {
    role: string;
    staffCredential?: { id: string } | null;
  }) {
    if (!CONSUMER_DELETION_ROLES.has(subject.role) || subject.staffCredential) {
      throw new AppException(
        "DELETION_STAFF_OFFBOARDING_REQUIRED",
        "Workforce accounts require controlled staff offboarding and assignment transfer",
        HttpStatus.CONFLICT
      );
    }
  }

  private async activeDeletionObligations(
    db: any,
    userId: string,
    subject?: {
      role: string;
      staffCredential?: { id: string } | null;
      companionProfile?: { id: string } | null;
    }
  ) {
    const resolvedSubject = subject ?? await db.user.findUnique({
      where: { id: userId },
      select: {
        role: true,
        staffCredential: { select: { id: true } },
        companionProfile: { select: { id: true } }
      }
    });
    const companionId = resolvedSubject?.companionProfile?.id ?? null;
    const staffOffboarding = !resolvedSubject
      || !CONSUMER_DELETION_ROLES.has(resolvedSubject.role)
      || Boolean(resolvedSubject.staffCredential)
      ? 1
      : 0;
    const partyOrderWhere = companionId
      ? { OR: [{ userId }, { companionId }] }
      : { userId };
    const [
      orders,
      refunds,
      supportTickets,
      paymentDisputes,
      attendanceDisputes,
      orderReschedules,
      voiceSessions,
      moderationCases,
      moderationAppeals,
      accountAppeals,
      dataRightsRequests,
      invoiceRequests,
      identityVerificationRequests,
      companionEarnings,
      companionWithdrawals,
      companionRecoveries,
      companionAppeals,
      companionIncidents
    ] = await Promise.all([
      db.order.count({
        where: { ...partyOrderWhere, status: { in: ["pending", "paying", "paid", "inService"] } }
      }),
      db.refundTransaction.count({
        where: {
          order: partyOrderWhere,
          status: { in: ["pendingReview", "pending", "processing", "failed"] }
        }
      }),
      db.supportTicket.count({
        where: {
          OR: companionId ? [{ userId }, { order: { companionId } }] : [{ userId }],
          status: { in: ["open", "inProgress"] }
        }
      }),
      db.paymentDispute.count({ where: { order: partyOrderWhere, status: { not: "resolved" } } }),
      db.attendanceDispute.count({ where: { order: partyOrderWhere, status: { not: "final" } } }),
      db.orderRescheduleRequest.count({
        where: { order: partyOrderWhere, status: "pending" }
      }),
      db.voiceSession.count({
        where: { order: partyOrderWhere, terminationCompletedAt: null }
      }),
      db.moderationCase.count({
        where: {
          OR: [{ subjectUserId: userId }, { reporterUserId: userId }],
          status: { in: ["pending", "autoReviewing", "humanReview"] }
        }
      }),
      db.moderationAppeal.count({ where: { subjectUserId: userId, status: "pending" } }),
      db.userAccountAppeal.count({ where: { userId, status: "pending" } }),
      db.dataRightsRequest.count({
        where: { userId, status: { in: ["submitted", "inReview", "needsInformation"] } }
      }),
      db.invoiceRequest.count({ where: { userId, status: { in: ["submitted", "inReview"] } } }),
      db.identityVerificationRequest.count({ where: { userId, status: "pending" } }),
      companionId
        ? db.companionEarning.count({
            where: { companionId, status: { in: ["pending", "available", "held"] } }
          })
        : Promise.resolve(0),
      companionId
        ? db.companionWithdrawalRequest.count({
            where: { companionId, status: { in: ["requested", "reviewing", "approved", "processing"] } }
          })
        : Promise.resolve(0),
      companionId
        ? db.companionRecovery.count({
            where: { companionId, status: { in: ["due", "pendingVerification"] } }
          })
        : Promise.resolve(0),
      companionId
        ? db.companionAccountAppeal.count({ where: { companionId, status: "pending" } })
        : Promise.resolve(0),
      companionId
        ? db.companionIncidentReport.count({
            where: { companionId, status: { in: ["open", "inReview"] } }
          })
        : Promise.resolve(0)
    ]);
    const counts = {
      staffOffboarding,
      orders,
      refunds,
      supportTickets,
      paymentDisputes,
      attendanceDisputes,
      orderReschedules,
      voiceSessions,
      moderationCases,
      moderationAppeals,
      accountAppeals,
      dataRightsRequests,
      invoiceRequests,
      identityVerificationRequests,
      companionEarnings,
      companionWithdrawals,
      companionRecoveries,
      companionAppeals,
      companionIncidents
    };
    const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
    return { clear: total === 0, total, counts };
  }

  async recordLegalConsent(userId: string, dto: CreateLegalConsentDto) {
    const definition = this.currentLegalConsentDefinition();
    if (
      dto.version !== definition.version ||
      dto.privacyUrl !== definition.privacyUrl ||
      dto.termsUrl !== definition.termsUrl
    ) {
      throw new AppException(
        "LEGAL_CONSENT_DOCUMENT_MISMATCH",
        "Legal consent must reference the current server-published documents",
        HttpStatus.BAD_REQUEST
      );
    }
    await this.legalArchive.assertVersionPublished(definition.version, ["privacy", "terms"]);
    const acceptedAt = new Date(dto.acceptedAt);
    if (
      !Number.isFinite(acceptedAt.getTime()) ||
      acceptedAt.getTime() > Date.now() + LEGAL_CONSENT_CLOCK_SKEW_MS
    ) {
      throw new AppException(
        "LEGAL_CONSENT_ACCEPTED_AT_INVALID",
        "Legal consent acceptedAt cannot be in the future",
        HttpStatus.BAD_REQUEST
      );
    }

    const receipt = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await db.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
      const existing = await db.legalConsentReceipt.findFirst({
        where: {
          userId,
          version: definition.version,
          withdrawnAt: null
        },
        orderBy: [{ consentedAt: "desc" }, { id: "desc" }]
      });
      if (existing) {
        return existing;
      }

      const previous = await db.legalConsentReceipt.findFirst({
        where: { userId },
        orderBy: [{ consentedAt: "desc" }, { id: "desc" }]
      });
      const created = await db.legalConsentReceipt.create({
        data: {
          userId,
          version: definition.version,
          privacyVersion: definition.version,
          termsVersion: definition.version,
          privacyAccepted: true,
          termsAccepted: true,
          adultConfirmed: true,
          acceptedAt,
          privacyUrl: definition.privacyUrl,
          termsUrl: definition.termsUrl,
          source: dto.source
        }
      });

      await this.audit.record({
        actorId: userId,
        subjectUserIds: [userId],
        action: previous?.withdrawnAt
          ? "legal.consent_reaccepted"
          : previous
            ? "legal.consent_upgraded"
            : "legal.consent_recorded",
        resourceType: "legalConsentReceipt",
        resourceId: created.id,
        metadata: {
          version: created.version,
          privacyVersion: created.privacyVersion,
          termsVersion: created.termsVersion,
          adultConfirmed: created.adultConfirmed,
          source: created.source,
          acceptedAt: created.acceptedAt.toISOString(),
          consentedAt: created.consentedAt.toISOString(),
          privacyArchiveUrl: this.legalArchiveUrl(created.privacyUrl, created.privacyVersion),
          termsArchiveUrl: this.legalArchiveUrl(created.termsUrl, created.termsVersion),
          previousVersion: previous?.version ?? null,
          previousReceiptId: previous?.id ?? null
        }
      }, db);

      return created;
    });

    return { receipt: this.legalConsentReceiptDto(receipt) };
  }

  private legalArchiveUrl(currentUrl: string, version: string) {
    const url = new URL(currentUrl);
    const sourcePath = url.pathname;
    let archivePath = sourcePath.replace(/\.html$/, "");
    // The public consent URLs intentionally remain stable .html entry points.
    // Those files redirect into Nest under API_PREFIX, so audit evidence must
    // point at the real immutable endpoint rather than a non-existent
    // /legal/.../versions route at the site root.
    if (sourcePath.endsWith(".html")) {
      const apiPrefix = this.config.getOrThrow<string>("API_PREFIX").replace(/^\/+|\/+$/g, "");
      const prefixedPath = `/${apiPrefix}`;
      if (!archivePath.startsWith(`${prefixedPath}/`)) {
        archivePath = `${prefixedPath}${archivePath}`;
      }
    }
    url.pathname = `${archivePath}/versions/${encodeURIComponent(version)}`;
    url.search = "";
    url.hash = "";
    return url.toString();
  }

  async getLegalConsent(userId: string, version?: string) {
    const definition = this.currentLegalConsentDefinition();
    const receipt = await this.prisma.legalConsentReceipt.findFirst({
      where: { userId, ...(version ? { version } : {}) },
      orderBy: [{ consentedAt: "desc" }, { id: "desc" }]
    });

    if (!receipt) {
      return { valid: false, receipt: null };
    }
    const valid =
      receipt.privacyAccepted === true &&
      receipt.termsAccepted === true &&
      receipt.adultConfirmed === true &&
      receipt.withdrawnAt === null &&
      ["wechatMiniProgram", "web"].includes(receipt.source) &&
      receipt.version === definition.version &&
      receipt.privacyVersion === definition.version &&
      receipt.termsVersion === definition.version &&
      receipt.privacyUrl === definition.privacyUrl &&
      receipt.termsUrl === definition.termsUrl;
    return { valid, receipt: this.legalConsentReceiptDto(receipt) };
  }

  async withdrawLegalConsent(userId: string) {
    const definition = this.currentLegalConsentDefinition();
    const result = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await db.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
      const receipt = await db.legalConsentReceipt.findFirst({
        where: { userId, version: definition.version, withdrawnAt: null },
        orderBy: [{ consentedAt: "desc" }, { id: "desc" }]
      });
      if (!receipt) {
        return { withdrawn: false, withdrawnAt: null };
      }
      const withdrawnAt = new Date();
      await db.legalConsentReceipt.update({
        where: { id: receipt.id },
        data: { withdrawnAt }
      });
      await db.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: withdrawnAt }
      });
      await this.audit.record({
        actorId: userId,
        subjectUserIds: [userId],
        action: "legal.consent_withdrawn",
        resourceType: "legalConsentReceipt",
        resourceId: receipt.id,
        metadata: { version: receipt.version, withdrawnAt: withdrawnAt.toISOString() }
      }, db);
      return { withdrawn: true, withdrawnAt: withdrawnAt.toISOString() };
    });
    return result;
  }

  private deletionRequestDto(request: {
    id: string;
    userId: string;
    status: string;
    note: string | null;
    processingStartedById?: string | null;
    processingStartedAt?: Date | null;
    approvedById?: string | null;
    approvedAt?: Date | null;
    executionStatus?: string;
    executionPhase?: string;
    executionCursor?: string | null;
    executionAttemptCount?: number;
    executionFailureCount?: number;
    executionNextAttemptAt?: Date | null;
    executionLastErrorCode?: string | null;
    executionFailedAt?: Date | null;
    executionProcessedCount?: number;
    executionStartedAt?: Date | null;
    executionFinishedAt?: Date | null;
    completedById?: string | null;
    completedAt?: Date | null;
    cancelledAt?: Date | null;
    companionReactivationRequired?: boolean;
    dueAt?: Date;
    policyVersion?: string;
    createdAt: Date;
    updatedAt: Date;
    user?: {
      id: string;
      role: string;
      accountStatus: string;
      createdAt: Date;
    };
  }) {
    const dueAt = request.dueAt ?? accountDeletionDueAt(request.createdAt);
    return {
      id: request.id,
      userId: request.userId,
      status: request.status,
      note: request.note,
      processingStartedById: request.processingStartedById ?? null,
      processingStartedAt: request.processingStartedAt?.toISOString() ?? null,
      approvedById: request.approvedById ?? null,
      approvedAt: request.approvedAt?.toISOString() ?? null,
      execution: {
        status: request.executionStatus ?? (request.status === "completed" ? "completed" : "idle"),
        phase: request.executionPhase ?? (request.status === "completed" ? "completed" : "awaiting_second_review"),
        cursor: request.executionCursor ?? null,
        attemptCount: request.executionAttemptCount ?? 0,
        failureCount: request.executionFailureCount ?? 0,
        processedCount: request.executionProcessedCount ?? 0,
        nextAttemptAt: request.executionNextAttemptAt?.toISOString() ?? null,
        lastErrorCode: request.executionLastErrorCode ?? null,
        failedAt: request.executionFailedAt?.toISOString() ?? null,
        startedAt: request.executionStartedAt?.toISOString() ?? null,
        finishedAt: request.executionFinishedAt?.toISOString() ?? null
      },
      completedById: request.completedById ?? null,
      completedAt: request.completedAt?.toISOString() ?? null,
      cancelledAt: request.cancelledAt?.toISOString() ?? null,
      companionReactivationRequired: request.companionReactivationRequired ?? false,
      dueAt: dueAt.toISOString(),
      policyVersion: request.policyVersion ?? ACCOUNT_DELETION_POLICY_VERSION,
      overdue: isAccountDeletionOverdue(request.status, dueAt),
      createdAt: request.createdAt.toISOString(),
      updatedAt: request.updatedAt.toISOString(),
      ...(request.user
        ? {
            user: {
              id: request.user.id,
              role: request.user.role,
              accountStatus: request.user.accountStatus,
              createdAt: request.user.createdAt.toISOString()
            }
          }
        : {})
    };
  }

  private deletionRequestUserDto(request: {
    id: string;
    status: string;
    processingStartedAt?: Date | null;
    completedAt?: Date | null;
    cancelledAt?: Date | null;
    companionReactivationRequired?: boolean;
    dueAt?: Date;
    policyVersion?: string;
    createdAt: Date;
    updatedAt: Date;
  }) {
    const dueAt = request.dueAt ?? accountDeletionDueAt(request.createdAt);
    return {
      id: request.id,
      status: request.status,
      processingStartedAt: request.processingStartedAt?.toISOString() ?? null,
      completedAt: request.completedAt?.toISOString() ?? null,
      cancelledAt: request.cancelledAt?.toISOString() ?? null,
      canCancel: request.status === "pending",
      companionReactivationRequired: request.companionReactivationRequired ?? false,
      dueAt: dueAt.toISOString(),
      policyVersion: request.policyVersion ?? ACCOUNT_DELETION_POLICY_VERSION,
      overdue: isAccountDeletionOverdue(request.status, dueAt),
      createdAt: request.createdAt.toISOString(),
      updatedAt: request.updatedAt.toISOString()
    };
  }

  private deletionCancellationResponse(
    request: Parameters<UsersService["deletionRequestUserDto"]>[0],
    subject: {
      accountStatus: string;
      companionProfile?: { id: string } | null;
    },
    idempotent: boolean
  ) {
    const companionReactivationRequired =
      request.companionReactivationRequired ?? Boolean(subject.companionProfile?.id);
    return {
      ...this.deletionRequestUserDto({
        ...request,
        companionReactivationRequired
      }),
      message: companionReactivationRequired
        ? "注销申请已取消。陪伴者供给不会自动恢复，请重新提交商业资料并完成资格复核后再上架。"
        : "注销申请已取消。其他独立账号限制或处罚保持不变。",
      policy: ACCOUNT_DELETION_PUBLIC_POLICY,
      cancellation: {
        idempotent,
        accountStatusPreserved: subject.accountStatus,
        independentAccountActionsPreserved: true,
        sessionsRestored: false,
        companionSupply: {
          automaticRestore: false,
          reactivationRequired: companionReactivationRequired,
          state: companionReactivationRequired ? "manualReviewRequired" : "notApplicable",
          requirements: companionReactivationRequired
            ? [
                "activeAccount",
                "currentAdultEligibility",
                "verifiedCommercialProfile",
                "currentServiceAgreement",
                "reviewedOfferingsAndAvailability",
                "operationsRepublish"
              ]
            : []
        }
      }
    };
  }

  private currentLegalConsentDefinition() {
    return {
      version: this.config.getOrThrow<string>("LEGAL_CONSENT_VERSION"),
      privacyUrl: this.config.getOrThrow<string>("LEGAL_PRIVACY_URL"),
      termsUrl: this.config.getOrThrow<string>("LEGAL_TERMS_URL")
    };
  }

  private legalConsentReceiptDto(receipt: {
    id: string;
    userId: string;
    version: string;
    privacyVersion: string;
    termsVersion: string;
    privacyAccepted: boolean;
    termsAccepted: boolean;
    adultConfirmed: boolean;
    acceptedAt: Date;
    consentedAt: Date;
    withdrawnAt: Date | null;
    privacyUrl: string;
    termsUrl: string;
    source: string;
  }) {
    const recordedAt = receipt.consentedAt.toISOString();
    return {
      id: receipt.id,
      userId: receipt.userId,
      version: receipt.version,
      privacyVersion: receipt.privacyVersion,
      termsVersion: receipt.termsVersion,
      privacyAccepted: receipt.privacyAccepted,
      termsAccepted: receipt.termsAccepted,
      adultConfirmed: receipt.adultConfirmed,
      acceptedAt: receipt.acceptedAt.toISOString(),
      consentedAt: recordedAt,
      recordedAt,
      withdrawnAt: receipt.withdrawnAt?.toISOString() ?? null,
      privacyUrl: receipt.privacyUrl,
      termsUrl: receipt.termsUrl,
      source: receipt.source
    };
  }
}
