import { HttpStatus, Injectable, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { AuditService } from "../common/audit/audit.service";
import { AppException } from "../common/errors/app.exception";
import { PrismaService } from "../database/prisma.service";
import { AvailabilityReminderFanoutService } from "../favorites/availability-reminder-fanout.service";
import { AvailabilityReminderReservationService } from "../favorites/availability-reminder-reservation.service";
import { evaluateDataRetentionLegalHoldPolicy } from "../legal/data-retention-legal-hold.service";
import {
  notificationDeliveryIntervalSeconds,
  notificationDeliveryReadinessSlaSeconds
} from "../notifications/notification-delivery.policy";
import { WECHAT_PREPAY_TTL_MS } from "../payments/wechat/wechat-pay.provider";
import { evaluateWeChatReconciliationGate } from "../payments/wechat-reconciliation-gate";
import { PaymentDisputesService } from "../payments/payment-disputes.service";
import { PUBLIC_INTERACTION_IDENTITY_AUTHORITY_AVAILABLE } from "../users/public-interaction-identity.gate";

type ListEarningsQuery = { page?: number; pageSize?: number; status?: string };
type CommercialProfileInput = {
  settlementRecipientRef: string;
  settlementRecipientMasked: string;
  taxProfileRef: string;
  identityEvidenceRef: string;
  serviceAgreementVersion: string;
  serviceAgreementEvidenceRef: string;
};
export type CommercialReadinessBlockers = {
  orderIntakeDisabled: number;
  payoutClaimsDisabled: number;
  paymentDisputeIntakeDisabled: number;
  publicInteractionIdentityAuthorityUnavailable: number;
  refundPolicyUnapproved: number;
  refundPolicySnapshotGaps: number;
  wechatDailyBillReconciliationDisabled: number;
  wechatDailyBillReconciliationIncomplete: number;
  wechatDailyBillOpenIssues: number;
  wechatDailyBillPendingApprovals: number;
  wechatDailyBillProviderTimeUnknown: number;
  wechatCashLedgerUnclassified: number;
  failedRefunds: number;
  staleRefunds: number;
  overdueSupport: number;
  overdueAccountDeletions: number;
  accountDeletionExecutionFailed: number;
  accountDeletionExecutionExpiredLeases: number;
  accountDeletionExecutionBacklogSlaBreached: number;
  accountDeletionPendingErasure: number;
  accountDeletionRetentionApprovalBacklog: number;
  accountDeletionRetentionPolicyUnapproved: number;
  dataRetentionLegalHoldPolicyUnapproved: number;
  dataRetentionLegalHoldPendingActions: number;
  accountDeletionAuthTombstoneCoverageGaps: number;
  accountDeletionAuthTombstoneUnknownKeys: number;
  overdueRetainedExpiryBacklog: number;
  retainedExpiryFailures: number;
  overdueUserAccountAppeals: number;
  overdueCompanionAccountAppeals: number;
  expiredCompanionSuspensionReactivationPending: number;
  overduePaymentDisputes: number;
  paymentDisputeSyncFailures: number;
  notificationDeliveryDisabledWithPending: number;
  notificationDeliveryOverduePending: number;
  failedNotifications: number;
  staleNotificationLeases: number;
  availabilityReminderFanoutFailed: number;
  availabilityReminderFanoutExpiredLeases: number;
  availabilityReminderFanoutBacklogSlaBreached: number;
  availabilityReminderFanoutRunnerDisabledWithDueBacklog: number;
  availabilityReminderPreparationFailures: number;
  availabilityReminderReservationFailures: number;
  availabilityReminderDeliveryFailures: number;
  availabilityReminderPreparationExpiredLeases: number;
  availabilityReminderReservationExpiredLeases: number;
  availabilityReminderDeliveryClaimExpiredLeases: number;
  availabilityReminderAttemptExpiredLeases: number;
  availabilityReminderPipelineBacklogSlaBreached: number;
  availabilityReminderPreparationRunnerDisabledWithDueBacklog: number;
  availabilityReminderDeliveryRunnerDisabledWithDueBacklog: number;
  availabilityReminderTerminalUnresolved: number;
  pendingCommercialProfiles: number;
  unresolvedRecoveries: number;
  stalePayoutClaims: number;
  moderationProviderUnavailable: number;
  criticalModeration: number;
  overdueModeration: number;
  mediaDeletionBacklog: number;
  stalePrepays: number;
  expiredOrderRequests: number;
  expiredPaymentReservations: number;
  expiredPaidServiceWindows: number;
  staleInService: number;
  voiceRoomControlDisabled: number;
  voiceEmergencyStopActive: number;
  voiceTerminationBacklog: number;
  voiceEmergencyDrainPending: number;
};
export type CommercialReadinessResult = {
  status: "attentionRequired" | "clear";
  checkedAt: string;
  blockers: CommercialReadinessBlockers;
  voice: {
    enabled: boolean;
    roomControlEnabled: boolean;
    emergencyStopEnabled: boolean;
    terminationBacklog: number;
    emergencyDrainPending: number;
  };
  notificationDelivery: {
    enabled: boolean;
    intervalSeconds: number;
    slaSeconds: number;
    pendingTotal: number;
    duePending: number;
    overduePending: number;
    oldestDueAt: string | null;
    oldestDueAgeSeconds: number | null;
    processing: number;
    expiredProcessing: number;
    unreadFailed: number;
  };
  availabilityReminder: Awaited<
    ReturnType<AvailabilityReminderFanoutService["operationalReadiness"]>
  > & {
    status: "attentionRequired" | "processing" | "clear";
    pipeline: Awaited<ReturnType<AvailabilityReminderReservationService["operationalReadiness"]>>;
  };
  dailyBillReconciliation: {
    dueDate: string;
    configuredStartDate: string | null;
    coverageStartDate: string | null;
    providerCatchupStartDate: string | null;
    enabled: boolean;
    approved: boolean;
    requiredDates: number;
    completedRuns: number;
    requiredRuns: number;
    missingOrIncompleteRuns: number;
    unresolvedIssues: number;
    pendingApprovals: number;
    pendingBillImportApprovals: number;
    unknownProviderPaymentTimes: number;
    unknownProviderRefundTimes: number;
    unclassifiedCashLedgerEntries: number;
  };
  retentionExpiry: {
    overdueBacklog: number;
    failures: number;
    earliestOverdueAt: string | null;
    earliestRetryAt: string | null;
    latestErrorCode: string | null;
  };
  accountDeletionExecution: {
    dueBacklog: number;
    processing: number;
    failed: number;
    expiredLeases: number;
    oldestDueAt: string | null;
    oldestDueAgeSeconds: number | null;
    backlogSlaSeconds: number;
    backlogSlaBreached: boolean;
  };
  accountDeletionAuthTombstones: {
    coverageGaps: number;
    unknownKeyBacklog: number;
    expiredCleanupBacklog: number;
    configuredKeyIds: string[];
  };
  staleInServiceOrders: Array<{ id: string; scheduledAt: string }>;
  staleInServiceSampleLimit: number;
  staleInServiceSampleTruncated: boolean;
};
const EARNING_STATUSES = ["pending", "available", "held", "paid", "void"] as const;
export type CompanionEarningHoldProjection = {
  category: "afterSalesReview" | "serviceReview" | "eligibilityReview" | "paymentProcessing" | "accountReview";
  status: "underReview" | "actionRequired" | "verificationPending";
  nextAction: "waitForReview" | "openServiceCase" | "updateEligibility" | "contactSupport";
};
const ACTIVE_REFUND_STATUSES = ["pendingReview", "pending", "processing", "failed"] as const;
const STALE_IN_SERVICE_SAMPLE_LIMIT = 100;
const ACCOUNT_DELETION_EXECUTION_BACKLOG_SLA_MS = 5 * 60_000;
const REQUIRED_COMPANION_TRAINING = [
  { moduleCode: "service-boundaries", moduleVersion: "2026.1" },
  { moduleCode: "safety-escalation", moduleVersion: "2026.1" },
  { moduleCode: "privacy-refresh", moduleVersion: "2026.1" }
] as const;

export function companionEarningHoldProjection(
  holdReason: string | null | undefined
): CompanionEarningHoldProjection | null {
  if (!holdReason) return null;
  if (["payout_execution_claimed", "payout_verification_pending"].includes(holdReason)) {
    return { category: "paymentProcessing", status: "verificationPending", nextAction: "waitForReview" };
  }
  if ([
    "payment_dispute_live",
    "payment_dispute_transfer_outcome_unknown",
    "payment_dispute_provider_outcome_unknown",
    "refund_in_progress",
    "refund_attention_required",
    "refund_window_open",
    "refund_policy_snapshot_missing"
  ].includes(holdReason)) {
    return { category: "afterSalesReview", status: "underReview", nextAction: "waitForReview" };
  }
  if (["attendance_dispute", "unresolved_support_ticket"].includes(holdReason)) {
    return { category: "serviceReview", status: "underReview", nextAction: "openServiceCase" };
  }
  if ([
    "commercial_profile_snapshot_missing",
    "commercial_profile_not_verified",
    "companion_adult_eligibility_not_current"
  ].includes(holdReason)) {
    return { category: "eligibilityReview", status: "actionRequired", nextAction: "updateEligibility" };
  }
  // `companion_recovery_due` and any future internal reason stay generic until
  // a separately approved root-cause appeal policy exists. Never echo raw codes.
  return { category: "accountReview", status: "underReview", nextAction: "contactSupport" };
}

@Injectable()
export class CommercialService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    @Optional() private readonly paymentDisputes?: PaymentDisputesService,
    @Optional() private readonly availabilityReminderFanout?: AvailabilityReminderFanoutService,
    @Optional() private readonly availabilityReminderReservations?: AvailabilityReminderReservationService
  ) {}

  async listForCompanion(userId: string, query: ListEarningsQuery = {}) {
    const page = Number.isSafeInteger(query.page) && (query.page ?? 0) > 0 ? query.page! : 1;
    const pageSize = Number.isSafeInteger(query.pageSize) && (query.pageSize ?? 0) > 0
      ? Math.min(100, query.pageSize!)
      : 20;
    if (query.status && !EARNING_STATUSES.includes(query.status as typeof EARNING_STATUSES[number])) {
      throw new AppException("EARNING_STATUS_INVALID", "Unknown earning status", HttpStatus.BAD_REQUEST);
    }
    const companion = await this.prisma.companionProfile.findUnique({
      where: { ownerUserId: userId },
      select: { id: true }
    } as any);
    if (!companion) {
      return {
        items: [],
        pagination: { page, pageSize, total: 0, totalPages: 0 },
        summary: this.emptyEarningsSummary()
      };
    }
    const where = {
      companionId: companion.id,
      ...(query.status ? { status: query.status } : {})
    };
    const [earnings, total, summaryGroups] = await Promise.all([
      this.prisma.companionEarning.findMany({
        where,
        include: { order: true },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize
      } as any),
      this.prisma.companionEarning.count({ where } as any),
      this.prisma.companionEarning.groupBy({
        by: ["status"],
        where: { companionId: companion.id },
        _count: { _all: true },
        _sum: { payableCents: true }
      } as any)
    ]);
    const summary = this.emptyEarningsSummary();
    for (const group of summaryGroups as any[]) {
      const status = String(group.status);
      if (status in summary.byStatus) {
        summary.byStatus[status as keyof typeof summary.byStatus] = {
          count: Number(group._count?._all ?? 0),
          payableCents: Number(group._sum?.payableCents ?? 0)
        };
      }
    }
    summary.availableCents = summary.byStatus.available.payableCents;
    summary.pendingOrHeldCents =
      summary.byStatus.pending.payableCents + summary.byStatus.held.payableCents;
    summary.paidCents = summary.byStatus.paid.payableCents;
    summary.totalCount = Object.values(summary.byStatus).reduce((sum, item) => sum + item.count, 0);
    return {
      items: earnings.map((earning: any) => this.toDto(earning, false)),
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
      summary
    };
  }

  async listAdmin(query: ListEarningsQuery = {}) {
    const page = Number.isSafeInteger(query.page) && (query.page ?? 0) > 0 ? query.page! : 1;
    const pageSize = Number.isSafeInteger(query.pageSize) && (query.pageSize ?? 0) > 0
      ? Math.min(100, query.pageSize!)
      : 50;
    if (query.status && !EARNING_STATUSES.includes(query.status as typeof EARNING_STATUSES[number])) {
      throw new AppException("EARNING_STATUS_INVALID", "Unknown earning status", HttpStatus.BAD_REQUEST);
    }
    const where: any = query.status ? { status: query.status } : {};
    const [items, total] = await Promise.all([
      this.prisma.companionEarning.findMany({
        where,
        include: {
          order: true,
          companion: { select: { id: true, name: true, ownerUserId: true } }
        },
        orderBy: [{ availableAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize
      } as any),
      this.prisma.companionEarning.count({ where } as any)
    ]);
    return {
      items: items.map((earning: any) => this.toDto(earning, true)),
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) }
    };
  }

  async listCommercialProfiles(status?: string, page = 1, pageSize = 50) {
    if (status && !["pendingReview", "verified", "suspended"].includes(status)) {
      throw new AppException("COMMERCIAL_PROFILE_STATUS_INVALID", "Unknown commercial profile status", HttpStatus.BAD_REQUEST);
    }
    const safePage = Math.max(1, Math.floor(page) || 1);
    const safePageSize = Math.min(100, Math.max(1, Math.floor(pageSize) || 50));
    const where = status ? { status } : {};
    const [items, total] = await Promise.all([
      this.prisma.companionCommercialProfile.findMany({
        where,
        include: { companion: { select: { id: true, name: true, ownerUserId: true, isPublished: true } } },
        orderBy: [{ updatedAt: "asc" }, { companionId: "asc" }],
        skip: (safePage - 1) * safePageSize,
        take: safePageSize
      } as any),
      this.prisma.companionCommercialProfile.count({ where } as any)
    ]);
    return {
      items: items.map((item: any) => this.commercialProfileDto(item)),
      pagination: {
        page: safePage,
        pageSize: safePageSize,
        total,
        totalPages: Math.ceil(total / safePageSize)
      }
    };
  }

  async operationalReadiness(): Promise<CommercialReadinessResult> {
    const now = new Date();
    const notificationDeliveryEnabled =
      this.config.get<boolean>("NOTIFICATION_DELIVERY_ENABLED", false) === true;
    const notificationDeliveryInterval = notificationDeliveryIntervalSeconds(this.config);
    const notificationDeliverySla = notificationDeliveryReadinessSlaSeconds(this.config);
    const notificationDeliveryOverdueCutoff = new Date(
      now.getTime() - notificationDeliverySla * 1_000
    );
    if (!this.availabilityReminderFanout || !this.availabilityReminderReservations) {
      throw new Error("Availability reminder operational readiness providers are unavailable");
    }
    const [availabilityReminderFanout, availabilityReminderPipeline] = await Promise.all([
      this.availabilityReminderFanout.operationalReadiness(now),
      this.availabilityReminderReservations.operationalReadiness(now)
    ]);
    const optionalPrisma = this.prisma as any;
    const commercialMode =
      this.config.get<string>("COMMERCIAL_RELEASE_MODE", "internal") === "commercial";
    const refundPolicyVersion = String(
      this.config.get<string>("REFUND_POLICY_VERSION", "") || ""
    ).trim();
    const refundPolicyApproved =
      this.config.get<boolean>("REFUND_POLICY_APPROVED", false) === true;
    const refundPolicyApprovalReference = String(
      this.config.get<string>("REFUND_POLICY_APPROVAL_REFERENCE", "") || ""
    ).trim();
    const refundPolicyConfigurationApproved = !commercialMode || (
      refundPolicyApproved
      && /^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/.test(refundPolicyVersion)
      && refundPolicyApprovalReference.length > 0
    );
    const refundPolicySnapshotGapsPromise = this.prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::INTEGER AS count
      FROM "Order"
      WHERE "refundPolicyVersionSnapshot" IS NULL
        OR "refundPolicyVersionSnapshot" !~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$'
        OR "refundRequestWindowHoursSnapshot" IS NULL
        OR "refundRequestWindowHoursSnapshot" NOT BETWEEN 1 AND 720
        OR (
          "completedAt" IS NOT NULL
          AND "refundRequestDeadlineAt" IS DISTINCT FROM (
            "completedAt" + make_interval(hours => "refundRequestWindowHoursSnapshot")
          )
        )
    `;
    const [
      notificationPendingTotal,
      notificationDuePending,
      notificationOverduePending,
      notificationOldestDue,
      notificationProcessing
    ] = await Promise.all([
      this.prisma.notificationDelivery.count({ where: { status: "pending" } } as any),
      this.prisma.notificationDelivery.count({
        where: { status: "pending", nextAttemptAt: { lte: now } }
      } as any),
      this.prisma.notificationDelivery.count({
        where: { status: "pending", nextAttemptAt: { lte: notificationDeliveryOverdueCutoff } }
      } as any),
      typeof optionalPrisma.notificationDelivery?.findFirst === "function"
        ? optionalPrisma.notificationDelivery.findFirst({
            where: { status: "pending", nextAttemptAt: { lte: now } },
            select: { nextAttemptAt: true },
            orderBy: [{ nextAttemptAt: "asc" }, { id: "asc" }]
          })
        : Promise.resolve(null),
      this.prisma.notificationDelivery.count({ where: { status: "processing" } } as any)
    ]);
    const trtcEnabled = this.config.get<boolean>("TRTC_ENABLED", false) === true;
    const trtcRoomControlEnabled = this.config.get<boolean>("TRTC_ROOM_CONTROL_ENABLED", false) === true;
    const trtcEmergencyStopEnabled = this.config.get<boolean>("TRTC_EMERGENCY_STOP_ENABLED", false) === true;
    const accountDeletionRetentionPolicyApproved =
      this.config.get<boolean>("ACCOUNT_DELETION_RETENTION_POLICY_APPROVED", false) === true;
    const accountDeletionRetentionPolicyApprovalReference = String(
      this.config.get<string>("ACCOUNT_DELETION_RETENTION_POLICY_APPROVAL_REFERENCE", "") || ""
    ).trim();
    const dataRetentionLegalHoldPolicy = evaluateDataRetentionLegalHoldPolicy(this.config);
    let configuredTombstoneKeyIds: string[] = [];
    try {
      const parsed = JSON.parse(
        this.config.get<string>("AUTH_IDENTITY_TOMBSTONE_HMAC_KEYS", "{}") || "{}"
      );
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        configuredTombstoneKeyIds = Object.keys(parsed).sort();
      }
    } catch {
      configuredTombstoneKeyIds = [];
    }
    const tombstoneReadiness = typeof optionalPrisma.authIdentityTombstone?.count === "function"
      ? await Promise.all([
          this.prisma.$queryRaw<Array<{ count: number }>>`
            SELECT COUNT(*)::INTEGER AS count
            FROM "AccountDeletionRequest" request
            WHERE request."status"::TEXT IN ('processing', 'completed')
              AND (
                NOT EXISTS (
                  SELECT 1 FROM "AuthIdentityTombstone" tombstone
                  WHERE tombstone."deletionRequestId" = request."id"
                )
                OR EXISTS (
                  SELECT 1 FROM "AuthIdentity" identity
                  WHERE identity."userId" = request."userId"
                    AND NOT EXISTS (
                      SELECT 1 FROM "AuthIdentityTombstone" tombstone
                      WHERE tombstone."deletionRequestId" = request."id"
                        AND tombstone."sourceAuthIdentityId" = identity."id"
                        AND tombstone."provider" = identity."provider"
                    )
                )
              )
          `,
          optionalPrisma.authIdentityTombstone.count({
            where: {
              keyId: configuredTombstoneKeyIds.length
                ? { notIn: configuredTombstoneKeyIds }
                : { not: "" },
              OR: [
                { deletionRequest: { status: "processing" } },
                {
                  deletionRequest: { status: "completed" },
                  OR: [{ expiresAt: null }, { expiresAt: { gt: now } }]
                }
              ]
            }
          }),
          optionalPrisma.authIdentityTombstone.count({
            where: {
              expiresAt: { lte: now },
              deletionRequest: { status: "completed" }
            }
          })
        ])
      : [[{ count: 0 }], 0, 0] as const;
    const accountDeletionAuthTombstoneCoverageGaps = Number(tombstoneReadiness[0][0]?.count ?? 0);
    const accountDeletionAuthTombstoneUnknownKeys = Number(tombstoneReadiness[1] ?? 0);
    const accountDeletionAuthTombstoneExpiredCleanupBacklog = Number(tombstoneReadiness[2] ?? 0);
    const dailyBillGate = await evaluateWeChatReconciliationGate(
      this.prisma as any,
      this.config,
      now
    );
    const dailyBillConfigured = dailyBillGate.configurationReady;
    const retentionExpiryDueWhere = {
      disposition: { in: ["pendingErasure", "retainedRestricted"] },
      expiryProcessedAt: null,
      retentionEndsAt: { lte: now },
      // A pending placement is already a preservation barrier. A pending
      // release deliberately leaves the active hold in force.
      legalHolds: { none: { releasedAt: null } },
      legalHoldActions: { none: { action: "placement", status: "pending" } }
    };
    const accountDeletionExecutionDueWhere = {
      status: "processing",
      OR: [
        {
          executionStatus: { in: ["queued", "retryScheduled"] },
          OR: [
            { executionNextAttemptAt: null },
            { executionNextAttemptAt: { lte: now } }
          ]
        },
        {
          executionStatus: "processing",
          OR: [
            { executionLeaseExpiresAt: null },
            { executionLeaseExpiresAt: { lte: now } }
          ]
        }
      ]
    };
    const [
      failedRefunds,
      staleRefunds,
      overdueSupport,
      overdueAccountDeletions,
      accountDeletionExecutionDueBacklog,
      accountDeletionExecutionProcessing,
      accountDeletionExecutionFailed,
      accountDeletionExecutionExpiredLeases,
      accountDeletionExecutionOldestDue,
      accountDeletionPendingErasure,
      accountDeletionRetentionApprovalBacklog,
      dataRetentionLegalHoldPendingActions,
      overdueRetainedExpiryBacklog,
      retainedExpiryFailures,
      earliestOverdueRetention,
      earliestRetentionRetry,
      latestRetentionFailure,
      overdueUserAccountAppeals,
      overdueCompanionAccountAppeals,
      expiredCompanionSuspensionReactivationPending,
      overduePaymentDisputes,
      paymentDisputeSyncFailures,
      failedNotifications,
      staleNotificationLeases,
      pendingCommercialProfiles,
      unresolvedRecoveries,
      stalePayoutClaims,
      moderationProviderUnavailable,
      criticalModeration,
      overdueModeration,
      mediaDeletionBacklog,
      stalePrepays,
      expiredOrderRequests,
      expiredPaymentReservations,
      expiredPaidServiceWindows,
      staleInServiceCount,
      staleInService,
      voiceTerminationBacklog,
      voiceEmergencyDrainPending
    ] = await Promise.all([
      this.prisma.refundTransaction.count({ where: { status: "failed" } } as any),
      this.prisma.refundTransaction.count({
        where: {
          OR: [
            {
              status: "pendingReview",
              reviewDueAt: { lt: now }
            },
            {
              status: { in: ["pendingReview", "pending", "processing", "failed"] },
              resolutionDueAt: { lt: now }
            },
            { status: "pending", updatedAt: { lt: new Date(now.getTime() - 15 * 60_000) } },
            {
              status: "processing",
              nextReconcileAt: { lt: new Date(now.getTime() - 15 * 60_000) }
            },
            {
              status: "processing",
              createdAt: { lt: new Date(now.getTime() - 24 * 60 * 60_000) }
            }
          ]
        }
      } as any),
      this.prisma.supportTicket.count({
        where: { status: { in: ["open", "inProgress"] }, dueAt: { lt: now } }
      } as any),
      this.prisma.accountDeletionRequest.count({
        where: { status: { in: ["pending", "processing"] }, dueAt: { lt: now } }
      } as any),
      this.prisma.accountDeletionRequest.count({
        where: accountDeletionExecutionDueWhere
      } as any),
      this.prisma.accountDeletionRequest.count({
        where: { status: "processing", executionStatus: "processing" }
      } as any),
      this.prisma.accountDeletionRequest.count({
        where: { status: "processing", executionStatus: "failed" }
      } as any),
      this.prisma.accountDeletionRequest.count({
        where: {
          status: "processing",
          executionStatus: "processing",
          OR: [
            { executionLeaseExpiresAt: null },
            { executionLeaseExpiresAt: { lte: now } }
          ]
        }
      } as any),
      this.prisma.$queryRaw<Array<{ dueAt: Date }>>`
        SELECT CASE
          WHEN request."executionStatus" = 'processing'
            THEN COALESCE(request."executionLeaseExpiresAt", request."updatedAt")
          ELSE COALESCE(request."executionNextAttemptAt", request."approvedAt", request."updatedAt")
        END AS "dueAt"
        FROM "AccountDeletionRequest" request
        WHERE request."status" = 'processing'
          AND (
            (
              request."executionStatus" IN ('queued', 'retryScheduled')
              AND (
                request."executionNextAttemptAt" IS NULL
                OR request."executionNextAttemptAt" <= ${now}
              )
            )
            OR (
              request."executionStatus" = 'processing'
              AND (
                request."executionLeaseExpiresAt" IS NULL
                OR request."executionLeaseExpiresAt" <= ${now}
              )
            )
          )
        ORDER BY "dueAt" ASC, request."id" ASC
        LIMIT 1
      `,
      this.prisma.accountDataRetentionRecord.count({
        where: { disposition: "pendingErasure" }
      } as any),
      this.prisma.accountDataRetentionRecord.count({
        where: { policyApprovalStatus: "pendingLegalApproval" }
      } as any),
      this.prisma.accountDataRetentionLegalHoldAction.count({
        where: { status: "pending" }
      } as any),
      this.prisma.accountDataRetentionRecord.count({
        where: retentionExpiryDueWhere
      } as any),
      this.prisma.accountDataRetentionRecord.count({
        where: {
          ...retentionExpiryDueWhere,
          expiryLastErrorCode: { not: null }
        }
      } as any),
      (this.prisma as any).accountDataRetentionRecord.findFirst
        ? (this.prisma as any).accountDataRetentionRecord.findFirst({
            where: {
              ...retentionExpiryDueWhere
            },
            orderBy: [{ retentionEndsAt: "asc" }, { id: "asc" }],
            select: { retentionEndsAt: true }
          })
        : Promise.resolve(null),
      (this.prisma as any).accountDataRetentionRecord.findFirst
        ? (this.prisma as any).accountDataRetentionRecord.findFirst({
            where: {
              ...retentionExpiryDueWhere,
              expiryNextAttemptAt: { not: null }
            },
            orderBy: [{ expiryNextAttemptAt: "asc" }, { id: "asc" }],
            select: { expiryNextAttemptAt: true }
          })
        : Promise.resolve(null),
      (this.prisma as any).accountDataRetentionRecord.findFirst
        ? (this.prisma as any).accountDataRetentionRecord.findFirst({
            where: {
              ...retentionExpiryDueWhere,
              expiryLastErrorCode: { not: null }
            },
            orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
            select: { expiryLastErrorCode: true }
          })
        : Promise.resolve(null),
      this.prisma.userAccountAppeal.count({
        where: { status: "pending", reviewDueAt: { lt: now } }
      } as any),
      this.prisma.companionAccountAppeal.count({
        where: { status: "pending", reviewDueAt: { lt: now } }
      } as any),
      this.prisma.companionAccountAction.count({
        where: {
          kind: "suspension",
          revokedAt: null,
          endsAt: { lte: now },
          reactivationStatus: { in: ["notRequired", "required"] }
        }
      } as any),
      (this.prisma as any).paymentDispute.count({
        where: {
          status: { in: ["pendingSync", "open", "processing", "syncFailed"] },
          OR: [
            { resolutionDueAt: { lt: now } },
            { firstRespondedAt: null, firstResponseDueAt: { lt: now } }
          ]
        }
      }),
      (this.prisma as any).paymentDispute.count({
        where: {
          OR: [
            { status: "syncFailed" },
            { completionStatus: "outcomeUnknown" },
            { replies: { some: { status: "outcomeUnknown" } } }
          ]
        }
      }),
      // A failed WeChat push remains operationally actionable until the durable
      // in-app notification is read. Reading the in-app copy closes the user
      // communication gap without pretending the provider delivery succeeded.
      this.prisma.notificationDelivery.count({
        where: { status: "failed", notification: { readAt: null } }
      } as any),
      this.prisma.notificationDelivery.count({
        where: {
          status: "processing",
          OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }]
        }
      } as any),
      this.prisma.companionCommercialProfile.count({ where: { status: "pendingReview" } } as any),
      this.prisma.companionRecovery.count({ where: { status: { in: ["due", "pendingVerification"] } } } as any),
      this.prisma.companionEarning.count({
        where: {
          status: "held",
          holdReason: { in: ["payout_execution_claimed", "payout_verification_pending"] },
          payoutSubmittedAt: { lt: new Date(Date.now() - 30 * 60_000) }
        }
      } as any),
      this.prisma.moderationCase.count({
        where: {
          status: { in: ["pending", "autoReviewing", "humanReview"] },
          matchedRules: { has: "provider.unavailable" }
        }
      } as any),
      this.prisma.moderationCase.count({
        where: {
          status: { in: ["pending", "autoReviewing", "humanReview"] },
          priority: "critical"
        }
      } as any),
      this.prisma.moderationCase.count({
        where: {
          status: { in: ["pending", "autoReviewing", "humanReview"] },
          dueAt: { lt: now }
        }
      } as any),
      this.prisma.mediaAsset.count({
        where: {
          expiresAt: { lte: now },
          status: { not: "expired" },
          OR: [
            { storageDeleteLastErrorCode: { not: null } },
            { storageDeleteOutcomeUnknownAt: { not: null } },
            // Legacy rows used the moderation error field before the durable
            // storage-deletion state machine gained dedicated columns.
            { lastError: "storage_delete_failed" }
          ]
        }
      } as any),
      this.prisma.paymentTransaction.count({
        where: {
          status: "initiated",
          OR: [
            { expiresAt: { lte: now } },
            { expiresAt: null, createdAt: { lte: new Date(now.getTime() - WECHAT_PREPAY_TTL_MS) } }
          ]
        }
      } as any),
      this.prisma.order.count({
        where: {
          status: "pending",
          companionConfirmedAt: null,
          companionResponseDeadlineAt: { lte: now }
        }
      } as any),
      this.prisma.order.count({
        where: {
          status: "pending",
          companionConfirmedAt: { not: null },
          paymentReservationExpiresAt: { lte: now }
        }
      } as any),
      this.prisma.$queryRaw<Array<{ count: number }>>`
        SELECT COUNT(*)::int AS "count"
        FROM "Order"
        WHERE "status" = 'paid'
          AND "scheduledAt" + "durationMinutes" * INTERVAL '1 minute' + INTERVAL '10 minutes' < NOW()
      `,
      this.prisma.$queryRaw<Array<{ count: number }>>`
        SELECT COUNT(*)::int AS "count"
        FROM "Order"
        WHERE "status" = 'inService'
          AND "scheduledAt" + "durationMinutes" * INTERVAL '1 minute' + INTERVAL '30 minutes' < NOW()
      `,
      this.prisma.$queryRaw<Array<{ id: string; scheduledAt: Date }>>`
        SELECT "id", "scheduledAt"
        FROM "Order"
        WHERE "status" = 'inService'
          AND "scheduledAt" + "durationMinutes" * INTERVAL '1 minute' + INTERVAL '30 minutes' < NOW()
        ORDER BY "scheduledAt" ASC, "id" ASC
        LIMIT ${STALE_IN_SERVICE_SAMPLE_LIMIT}
      `,
      trtcEnabled
        ? this.prisma.voiceSession.count({
            where: {
              terminationCompletedAt: null,
              terminationRequestedAt: { not: null },
              AND: [
                { OR: [{ terminationLeaseUntil: null }, { terminationLeaseUntil: { lte: now } }] },
                { OR: [{ terminationNextAttemptAt: null }, { terminationNextAttemptAt: { lte: now } }] }
              ]
            }
          } as any)
        : Promise.resolve(0),
      trtcEnabled && trtcEmergencyStopEnabled
        ? this.prisma.voiceSession.count({ where: { terminationCompletedAt: null } } as any)
        : Promise.resolve(0)
    ]);
    const refundPolicySnapshotGaps = Number(
      (await refundPolicySnapshotGapsPromise)[0]?.count ?? 0
    );
    const accountDeletionExecutionOldestDueAt = accountDeletionExecutionOldestDue[0]?.dueAt ?? null;
    const accountDeletionExecutionOldestDueAgeSeconds = accountDeletionExecutionOldestDueAt
      ? Math.max(0, Math.floor(
          (now.getTime() - accountDeletionExecutionOldestDueAt.getTime()) / 1_000
        ))
      : null;
    const accountDeletionExecutionBacklogSlaBreached =
      accountDeletionExecutionOldestDueAgeSeconds !== null
      && accountDeletionExecutionOldestDueAgeSeconds * 1_000
        > ACCOUNT_DELETION_EXECUTION_BACKLOG_SLA_MS;
    const blockers: CommercialReadinessBlockers = {
      orderIntakeDisabled: this.config.get<boolean>("ORDER_INTAKE_ENABLED", true) ? 0 : 1,
      payoutClaimsDisabled: this.config.get<boolean>("PAYOUT_CLAIMS_ENABLED", true) ? 0 : 1,
      paymentDisputeIntakeDisabled: this.config.get<boolean>("WECHAT_PAY_COMPLAINTS_ENABLED", false) ? 0 : 1,
      publicInteractionIdentityAuthorityUnavailable:
        commercialMode && !PUBLIC_INTERACTION_IDENTITY_AUTHORITY_AVAILABLE ? 1 : 0,
      refundPolicyUnapproved: refundPolicyConfigurationApproved ? 0 : 1,
      refundPolicySnapshotGaps,
      wechatDailyBillReconciliationDisabled: dailyBillConfigured ? 0 : 1,
      wechatDailyBillReconciliationIncomplete:
        dailyBillConfigured ? dailyBillGate.missingOrIncompleteRuns : 0,
      wechatDailyBillOpenIssues: dailyBillConfigured ? dailyBillGate.unresolvedIssues : 0,
      wechatDailyBillPendingApprovals: dailyBillConfigured
        ? dailyBillGate.pendingApprovals + dailyBillGate.pendingBillImportApprovals
        : 0,
      wechatDailyBillProviderTimeUnknown: dailyBillConfigured
        ? dailyBillGate.unknownProviderPaymentTimes + dailyBillGate.unknownProviderRefundTimes
        : 0,
      wechatCashLedgerUnclassified: dailyBillConfigured
        ? dailyBillGate.unclassifiedCashLedgerEntries
        : 0,
      failedRefunds,
      staleRefunds,
      overdueSupport,
      overdueAccountDeletions,
      accountDeletionExecutionFailed,
      accountDeletionExecutionExpiredLeases,
      accountDeletionExecutionBacklogSlaBreached:
        accountDeletionExecutionBacklogSlaBreached ? 1 : 0,
      accountDeletionPendingErasure,
      accountDeletionRetentionApprovalBacklog,
      accountDeletionRetentionPolicyUnapproved:
        accountDeletionRetentionPolicyApproved && accountDeletionRetentionPolicyApprovalReference ? 0 : 1,
      dataRetentionLegalHoldPolicyUnapproved: dataRetentionLegalHoldPolicy.ready ? 0 : 1,
      dataRetentionLegalHoldPendingActions,
      accountDeletionAuthTombstoneCoverageGaps,
      accountDeletionAuthTombstoneUnknownKeys,
      overdueRetainedExpiryBacklog,
      retainedExpiryFailures,
      overdueUserAccountAppeals,
      overdueCompanionAccountAppeals,
      expiredCompanionSuspensionReactivationPending,
      overduePaymentDisputes,
      paymentDisputeSyncFailures,
      notificationDeliveryDisabledWithPending:
        notificationDeliveryEnabled ? 0 : notificationPendingTotal,
      notificationDeliveryOverduePending: notificationOverduePending,
      failedNotifications,
      staleNotificationLeases,
      availabilityReminderFanoutFailed: availabilityReminderFanout.backlog.failed,
      availabilityReminderFanoutExpiredLeases: availabilityReminderFanout.backlog.expiredLeases,
      availabilityReminderFanoutBacklogSlaBreached:
        availabilityReminderFanout.backlog.backlogSlaBreached ? 1 : 0,
      availabilityReminderFanoutRunnerDisabledWithDueBacklog:
        availabilityReminderFanout.backlog.runnerDisabledWithDueBacklog ? 1 : 0,
      availabilityReminderPreparationFailures: availabilityReminderPipeline.failedPreparation,
      availabilityReminderReservationFailures: availabilityReminderPipeline.failedReservation,
      availabilityReminderDeliveryFailures: availabilityReminderPipeline.failedDelivery,
      availabilityReminderPreparationExpiredLeases:
        availabilityReminderPipeline.expiredPreparationLeases,
      availabilityReminderReservationExpiredLeases:
        availabilityReminderPipeline.expiredReservationLeases,
      availabilityReminderDeliveryClaimExpiredLeases:
        availabilityReminderPipeline.expiredDeliveryClaimLeases,
      availabilityReminderAttemptExpiredLeases: availabilityReminderPipeline.expiredAttemptLeases,
      availabilityReminderPipelineBacklogSlaBreached:
        availabilityReminderPipeline.backlogSlaBreached ? 1 : 0,
      availabilityReminderPreparationRunnerDisabledWithDueBacklog:
        availabilityReminderPipeline.preparationRunnerDisabledWithDueBacklog ? 1 : 0,
      availabilityReminderDeliveryRunnerDisabledWithDueBacklog:
        availabilityReminderPipeline.deliveryRunnerDisabledWithDueBacklog ? 1 : 0,
      availabilityReminderTerminalUnresolved:
        availabilityReminderPipeline.terminalAttempts.unresolved,
      pendingCommercialProfiles,
      unresolvedRecoveries,
      stalePayoutClaims,
      moderationProviderUnavailable,
      criticalModeration,
      overdueModeration,
      mediaDeletionBacklog,
      stalePrepays,
      expiredOrderRequests,
      expiredPaymentReservations,
      expiredPaidServiceWindows: Number(expiredPaidServiceWindows[0]?.count ?? 0),
      staleInService: Number(staleInServiceCount[0]?.count ?? 0),
      voiceRoomControlDisabled: trtcEnabled && !trtcRoomControlEnabled ? 1 : 0,
      voiceEmergencyStopActive: trtcEmergencyStopEnabled ? 1 : 0,
      voiceTerminationBacklog,
      voiceEmergencyDrainPending
    };
    return {
      status: Object.values(blockers).some((value) => value > 0) ? "attentionRequired" : "clear",
      checkedAt: now.toISOString(),
      blockers,
      voice: {
        enabled: trtcEnabled,
        roomControlEnabled: trtcRoomControlEnabled,
        emergencyStopEnabled: trtcEmergencyStopEnabled,
        terminationBacklog: voiceTerminationBacklog,
        emergencyDrainPending: voiceEmergencyDrainPending
      },
      notificationDelivery: {
        enabled: notificationDeliveryEnabled,
        intervalSeconds: notificationDeliveryInterval,
        slaSeconds: notificationDeliverySla,
        pendingTotal: notificationPendingTotal,
        duePending: notificationDuePending,
        overduePending: notificationOverduePending,
        oldestDueAt: notificationOldestDue?.nextAttemptAt?.toISOString?.() ?? null,
        oldestDueAgeSeconds: notificationOldestDue?.nextAttemptAt
          ? Math.max(0, Math.floor(
              (now.getTime() - notificationOldestDue.nextAttemptAt.getTime()) / 1_000
            ))
          : null,
        processing: notificationProcessing,
        expiredProcessing: staleNotificationLeases,
        unreadFailed: failedNotifications
      },
      availabilityReminder: {
        ...availabilityReminderFanout,
        status: availabilityReminderFanout.status === "attentionRequired"
          || availabilityReminderPipeline.status === "attentionRequired"
          ? "attentionRequired"
          : availabilityReminderFanout.status === "processing"
            || availabilityReminderPipeline.status === "processing"
            ? "processing"
            : "clear",
        pipeline: availabilityReminderPipeline
      },
      dailyBillReconciliation: {
        dueDate: dailyBillGate.dueDate,
        configuredStartDate: dailyBillGate.configuredStartDate,
        coverageStartDate: dailyBillGate.coverageStartDate,
        providerCatchupStartDate: dailyBillGate.providerCatchupStartDate,
        enabled: dailyBillGate.enabled,
        approved: dailyBillGate.approved,
        requiredDates: dailyBillGate.requiredDates,
        completedRuns: dailyBillGate.completedRuns,
        requiredRuns: dailyBillGate.requiredRuns,
        missingOrIncompleteRuns: dailyBillGate.missingOrIncompleteRuns,
        unresolvedIssues: dailyBillGate.unresolvedIssues,
        pendingApprovals: dailyBillGate.pendingApprovals,
        pendingBillImportApprovals: dailyBillGate.pendingBillImportApprovals,
        unknownProviderPaymentTimes: dailyBillGate.unknownProviderPaymentTimes,
        unknownProviderRefundTimes: dailyBillGate.unknownProviderRefundTimes,
        unclassifiedCashLedgerEntries: dailyBillGate.unclassifiedCashLedgerEntries
      },
      retentionExpiry: {
        overdueBacklog: overdueRetainedExpiryBacklog,
        failures: retainedExpiryFailures,
        earliestOverdueAt: earliestOverdueRetention?.retentionEndsAt?.toISOString?.() ?? null,
        earliestRetryAt: earliestRetentionRetry?.expiryNextAttemptAt?.toISOString?.() ?? null,
        latestErrorCode: latestRetentionFailure?.expiryLastErrorCode ?? null
      },
      accountDeletionExecution: {
        dueBacklog: accountDeletionExecutionDueBacklog,
        processing: accountDeletionExecutionProcessing,
        failed: accountDeletionExecutionFailed,
        expiredLeases: accountDeletionExecutionExpiredLeases,
        oldestDueAt: accountDeletionExecutionOldestDueAt?.toISOString?.() ?? null,
        oldestDueAgeSeconds: accountDeletionExecutionOldestDueAgeSeconds,
        backlogSlaSeconds: ACCOUNT_DELETION_EXECUTION_BACKLOG_SLA_MS / 1_000,
        backlogSlaBreached: accountDeletionExecutionBacklogSlaBreached
      },
      accountDeletionAuthTombstones: {
        coverageGaps: accountDeletionAuthTombstoneCoverageGaps,
        unknownKeyBacklog: accountDeletionAuthTombstoneUnknownKeys,
        expiredCleanupBacklog: accountDeletionAuthTombstoneExpiredCleanupBacklog,
        configuredKeyIds: configuredTombstoneKeyIds
      },
      staleInServiceOrders: staleInService.map((order) => ({
        id: order.id,
        scheduledAt: order.scheduledAt.toISOString()
      })),
      staleInServiceSampleLimit: STALE_IN_SERVICE_SAMPLE_LIMIT,
      staleInServiceSampleTruncated:
        Number(staleInServiceCount[0]?.count ?? 0) > staleInService.length
    };
  }

  async upsertCommercialProfile(actorId: string, companionId: string, input: CommercialProfileInput) {
    const normalized = Object.fromEntries(
      Object.entries(input).map(([key, value]) => [key, value.trim()])
    ) as CommercialProfileInput;
    const result = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await db.$queryRaw`SELECT "id" FROM "CompanionProfile" WHERE "id" = ${companionId} FOR UPDATE`;
      const companion = await db.companionProfile.findUnique({ where: { id: companionId } });
      if (!companion) throw new AppException("COMPANION_NOT_FOUND", "Companion not found", HttpStatus.NOT_FOUND);
      const duplicate = await db.companionCommercialProfile.findFirst({
        where: { settlementRecipientRef: normalized.settlementRecipientRef, companionId: { not: companionId } },
        select: { companionId: true }
      });
      if (duplicate) {
        throw new AppException(
          "SETTLEMENT_RECIPIENT_ALREADY_BOUND",
          "Settlement recipient reference is already bound to another companion",
          HttpStatus.CONFLICT
        );
      }
      const now = new Date();
      const profile = await db.companionCommercialProfile.upsert({
        where: { companionId },
        create: {
          companionId,
          ...normalized,
          status: "pendingReview",
          submittedAt: now,
          submittedById: actorId
        },
        update: {
          ...normalized,
          status: "pendingReview",
          submittedAt: now,
          submittedById: actorId,
          verifiedAt: null,
          verifiedById: null,
          nextReviewDueAt: null,
          adultEligibilityVerdict: "pending",
          adultEligibilityVerifiedAt: null,
          adultEligibilityValidUntil: null,
          adultEligibilityEvidenceRef: null,
          suspendedAt: null,
          suspendedById: null,
          suspendedReason: null,
          suspendedByAccountActionId: null
        }
      });
      if (companion.isPublished) {
        await db.companionProfile.update({ where: { id: companionId }, data: { isPublished: false } });
      }
      await this.audit.record({
        actorId,
        subjectUserIds: companion.ownerUserId ? [companion.ownerUserId] : [],
        action: "commercial.companion_profile_submitted",
        resourceType: "companionCommercialProfile",
        resourceId: companionId,
        metadata: {
          companionId,
          settlementRecipientMasked: normalized.settlementRecipientMasked,
          serviceAgreementVersion: normalized.serviceAgreementVersion,
          unpublishedForReview: companion.isPublished
        }
      }, db);
      return profile;
    });
    return this.commercialProfileDto(result);
  }

  async verifyCommercialProfile(actorId: string, companionId: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await db.$queryRaw`SELECT "id" FROM "CompanionProfile" WHERE "id" = ${companionId} FOR UPDATE`;
      const companion = await db.companionProfile.findUnique({
        where: { id: companionId },
        include: { owner: { include: { profile: true } } }
      });
      const profile = await db.companionCommercialProfile.findUnique({ where: { companionId } });
      if (!companion || !profile) {
        throw new AppException("COMMERCIAL_PROFILE_NOT_FOUND", "Commercial profile not found", HttpStatus.NOT_FOUND);
      }
      if (profile.status !== "pendingReview") {
        throw new AppException("COMMERCIAL_PROFILE_INVALID_STATE", "Profile is not awaiting review", HttpStatus.CONFLICT);
      }
      if (profile.submittedById === actorId) {
        throw new AppException(
          "COMMERCIAL_PROFILE_SECOND_REVIEW_REQUIRED",
          "A different administrator must verify the commercial profile",
          HttpStatus.FORBIDDEN
        );
      }
      if (!companion.ownerUserId || companion.owner?.accountStatus !== "active" || companion.owner?.profile?.isVerified !== true) {
        throw new AppException(
          "COMPANION_OWNER_NOT_VERIFIED",
          "The companion owner must be active and identity-verified",
          HttpStatus.CONFLICT
        );
      }
      if (
        !Number.isInteger(companion.owner.profile.age)
        || companion.owner.profile.age < 18
      ) {
        throw new AppException(
          "COMPANION_ADULT_ELIGIBILITY_REQUIRED",
          "The identity-reviewed companion owner must have an adult eligibility result",
          HttpStatus.CONFLICT
        );
      }
      const now = new Date();
      const trainingRecords = await db.companionTrainingRecord.findMany({
        where: {
          companionId,
          status: "passed",
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }]
        },
        select: { moduleCode: true, moduleVersion: true, expiresAt: true }
      });
      const currentTraining = new Set(
        trainingRecords.map((record: any) => `${record.moduleCode}:${record.moduleVersion}`)
      );
      const missingTraining = REQUIRED_COMPANION_TRAINING.filter(
        (required) => !currentTraining.has(`${required.moduleCode}:${required.moduleVersion}`)
      );
      if (missingTraining.length) {
        throw new AppException(
          "COMPANION_TRAINING_REQUIRED",
          "Every required companion training module must be current before commercial verification",
          HttpStatus.CONFLICT,
          { missingModuleCodes: missingTraining.map((item) => item.moduleCode) }
        );
      }
      const trainingExpiryTimes = trainingRecords
        .map((record: any) => record.expiresAt?.getTime?.())
        .filter((value: unknown): value is number => typeof value === "number" && Number.isFinite(value));
      const annualReviewDueAt = new Date(now.getTime() + 365 * 24 * 60 * 60_000);
      const nextReviewDueAt = trainingExpiryTimes.length
        ? new Date(Math.min(annualReviewDueAt.getTime(), ...trainingExpiryTimes))
        : annualReviewDueAt;
      const updated = await db.companionCommercialProfile.update({
        where: { companionId },
        data: {
          status: "verified",
          verifiedAt: now,
          verifiedById: actorId,
          nextReviewDueAt,
          adultEligibilityVerdict: "adult",
          adultEligibilityVerifiedAt: now,
          adultEligibilityValidUntil: nextReviewDueAt,
          adultEligibilityEvidenceRef: profile.identityEvidenceRef
        }
      });
      await this.audit.record({
        actorId,
        subjectUserIds: companion.ownerUserId ? [companion.ownerUserId] : [],
        action: "commercial.companion_profile_verified",
        resourceType: "companionCommercialProfile",
        resourceId: companionId,
        metadata: {
          companionId,
          submittedById: profile.submittedById,
          adultEligibilityVerdict: "adult",
          adultEligibilityValidUntil: nextReviewDueAt.toISOString(),
          requiredTrainingVersions: REQUIRED_COMPANION_TRAINING,
          nextReviewDueAt: nextReviewDueAt.toISOString()
        }
      }, db);
      return updated;
    });
    return this.commercialProfileDto(result);
  }

  async suspendCommercialProfile(actorId: string, companionId: string, reason: string) {
    const normalizedReason = reason.trim();
    const result = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await db.$queryRaw`SELECT "id" FROM "CompanionProfile" WHERE "id" = ${companionId} FOR UPDATE`;
      const companion = await db.companionProfile.findUnique({
        where: { id: companionId },
        select: { ownerUserId: true }
      });
      const profile = await db.companionCommercialProfile.findUnique({ where: { companionId } });
      if (!profile) throw new AppException("COMMERCIAL_PROFILE_NOT_FOUND", "Commercial profile not found", HttpStatus.NOT_FOUND);
      const updated = await db.companionCommercialProfile.update({
        where: { companionId },
        data: {
          status: "suspended",
          suspendedAt: new Date(),
          suspendedById: actorId,
          suspendedReason: normalizedReason,
          suspendedByAccountActionId: null
        }
      });
      await db.companionProfile.updateMany({ where: { id: companionId }, data: { isPublished: false } });
      await this.audit.record({
        actorId,
        subjectUserIds: companion?.ownerUserId ? [companion.ownerUserId] : [],
        action: "commercial.companion_profile_suspended",
        resourceType: "companionCommercialProfile",
        resourceId: companionId,
        metadata: { companionId, reason: normalizedReason }
      }, db);
      return updated;
    });
    return this.commercialProfileDto(result);
  }

  /**
   * This deliberately never calls a payout provider. The first operator first
   * claims the payout under an Order → CompanionEarning lock, then performs
   * any external transfer. A separate evidence and second-review step are
   * required before a ledger row becomes paid.
   */
  async claimPayout(actorId: string, earningId: string) {
    if (this.config.get<boolean>("PAYOUT_CLAIMS_ENABLED", true) === false) {
      throw new AppException(
        "PAYOUT_CLAIMS_PAUSED",
        "New payout execution claims are temporarily paused",
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
    const providerGate = await this.livePayoutComplaintState(earningId);
    if (providerGate.state !== "clear") {
      await this.prisma.companionEarning.updateMany({
        where: { id: earningId, status: { in: ["pending", "available", "held"] } },
        data: {
          status: "held",
          holdReason: providerGate.state === "active"
            ? "payment_dispute_live"
            : "payment_dispute_provider_outcome_unknown"
        }
      } as any);
      this.throwPayoutHold(providerGate.state === "active"
        ? "payment_dispute_live"
        : "payment_dispute_provider_outcome_unknown");
    }
    const result = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      const earning = await this.lockPayoutEarning(db, earningId);
      if (earning.status !== "available") {
        throw new AppException(
          "EARNING_NOT_PAYABLE",
          "Only an available earning can be claimed for payout execution",
          HttpStatus.CONFLICT
        );
      }
      if (
        !earning.settlementRecipientRefSnapshot ||
        !earning.settlementRecipientMaskedSnapshot ||
        !earning.taxProfileRefSnapshot ||
        !earning.identityEvidenceRefSnapshot ||
        earning.order?.adultEligibilityVerdictSnapshot !== "adult" ||
        !earning.order?.adultEligibilityVerifiedAtSnapshot ||
        !earning.order?.adultEligibilityValidUntilSnapshot ||
        !earning.serviceAgreementVersionSnapshot ||
        !earning.serviceAgreementEvidenceRefSnapshot
      ) {
        throw new AppException(
          "EARNING_SETTLEMENT_SNAPSHOT_MISSING",
          "Settlement, tax and agreement snapshots are required before payout",
          HttpStatus.CONFLICT
        );
      }
      if (earning.companion?.commercialProfile?.status !== "verified") {
        throw new AppException(
          "EARNING_COMMERCIAL_PROFILE_NOT_VERIFIED",
          "The companion commercial profile must remain verified at payout time",
          HttpStatus.CONFLICT
        );
      }
      if (!this.isCurrentAdultEligibility(earning.companion?.commercialProfile)) {
        throw new AppException(
          "EARNING_ADULT_ELIGIBILITY_EXPIRED",
          "The companion adult eligibility must remain current at payout time",
          HttpStatus.CONFLICT
        );
      }
      const holdReason = await this.payoutHoldReason(db, earning.orderId);
      if (holdReason) {
        const held = await db.companionEarning.update({
          where: { id: earning.id },
          data: { status: "held", holdReason },
          include: { order: true, companion: { select: { id: true, name: true, ownerUserId: true, commercialProfile: true } } }
        });
        // Return rather than throw inside the transaction so the protective
        // hold commits before the caller receives the conflict response.
        return { holdReason, earning: held };
      }
      const updated = await db.companionEarning.update({
        where: { id: earning.id },
        data: {
          status: "held",
          holdReason: "payout_execution_claimed",
          payoutSubmittedAt: new Date(),
          payoutSubmittedById: actorId,
          paidReference: null,
          paidAmountCents: null,
          paidRecipientRef: null,
          payoutEvidenceDigest: null
        },
        include: { order: true, companion: { select: { id: true, name: true, ownerUserId: true, commercialProfile: true } } }
      });
      await this.audit.record({
        actorId,
        subjectUserIds: earning.companion?.ownerUserId
          ? [earning.companion.ownerUserId]
          : [],
        action: "commercial.earning_payout_claimed",
        resourceType: "companionEarning",
        resourceId: earning.id,
        metadata: {
          orderId: earning.orderId,
          companionId: earning.companionId,
          payableCents: earning.payableCents,
          payoutExecutionClaimed: true
        }
      }, db);
      return { holdReason: null, earning: updated };
    });
    this.throwPayoutHold(result.holdReason);
    return this.toDto(result.earning, true);
  }

  async cancelPayoutClaim(actorId: string, earningId: string, evidence: {
    reason: string;
    noTransferEvidenceReference: string;
    evidenceDigest: string;
  }) {
    const result = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      const earning = await this.lockPayoutEarning(db, earningId);
      if (earning.status !== "held" || earning.holdReason !== "payout_execution_claimed" || earning.paidReference) {
        throw new AppException(
          "EARNING_PAYOUT_CLAIM_NOT_CANCELLABLE",
          "Only an unsubmitted manual payout claim can be cancelled",
          HttpStatus.CONFLICT
        );
      }
      if (!earning.payoutSubmittedById || earning.payoutSubmittedById === actorId) {
        throw new AppException(
          "EARNING_PAYOUT_CANCELLATION_SECOND_REVIEW_REQUIRED",
          "A different administrator must verify that no transfer occurred",
          HttpStatus.FORBIDDEN
        );
      }
      const nextHoldReason = await this.payoutHoldReason(db, earning.orderId);
      const updated = await db.companionEarning.update({
        where: { id: earning.id },
        data: {
          status: nextHoldReason ? "held" : "available",
          holdReason: nextHoldReason,
          payoutSubmittedAt: null,
          payoutSubmittedById: null,
          paidReference: null,
          paidAmountCents: null,
          paidRecipientRef: null,
          payoutEvidenceDigest: null
        },
        include: {
          order: true,
          companion: { select: { id: true, name: true, ownerUserId: true, commercialProfile: true } }
        }
      });
      await this.audit.record({
        actorId,
        subjectUserIds: earning.companion?.ownerUserId
          ? [earning.companion.ownerUserId]
          : [],
        action: "commercial.earning_payout_claim_cancelled",
        resourceType: "companionEarning",
        resourceId: earning.id,
        metadata: {
          orderId: earning.orderId,
          companionId: earning.companionId,
          originalClaimantId: earning.payoutSubmittedById,
          reason: evidence.reason.trim(),
          noTransferEvidenceReference: evidence.noTransferEvidenceReference.trim(),
          evidenceDigest: evidence.evidenceDigest.toLowerCase(),
          resultingHoldReason: nextHoldReason
        }
      }, db);
      return updated;
    });
    return this.toDto(result, true);
  }

  async recordPayoutEvidence(actorId: string, earningId: string, evidence: {
    paidReference: string;
    paidAmountCents: number;
    paidRecipientRef: string;
    payoutEvidenceDigest: string;
  }) {
    const reference = evidence.paidReference.trim();
    if (!reference) {
      throw new AppException("EARNING_REFERENCE_REQUIRED", "A manual payout reference is required", HttpStatus.BAD_REQUEST);
    }
    // A transfer has already been attempted by the time this endpoint is
    // called. Even when provider complaint verification is unavailable, keep
    // the claim and evidence durable and move into outcome-unknown recovery.
    const providerGate = await this.livePayoutComplaintState(earningId);
    const result = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      const earning = await this.lockPayoutEarning(db, earningId);
      if (earning.status !== "held" || earning.holdReason !== "payout_execution_claimed") {
        throw new AppException(
          "EARNING_PAYOUT_CLAIM_REQUIRED",
          "This earning must be claimed before payout evidence can be recorded",
          HttpStatus.CONFLICT
        );
      }
      if (earning.payoutSubmittedById !== actorId) {
        throw new AppException(
          "EARNING_PAYOUT_CLAIM_OWNER_REQUIRED",
          "Only the administrator who claimed this payout can record transfer evidence",
          HttpStatus.FORBIDDEN
        );
      }
      if (evidence.paidAmountCents !== earning.payableCents) {
        throw new AppException(
          "EARNING_PAYOUT_AMOUNT_MISMATCH",
          "Payout evidence amount does not match the ledger",
          HttpStatus.CONFLICT
        );
      }
      if (evidence.paidRecipientRef.trim() !== earning.settlementRecipientRefSnapshot) {
        throw new AppException(
          "EARNING_PAYOUT_RECIPIENT_MISMATCH",
          "Payout recipient does not match the immutable order snapshot",
          HttpStatus.CONFLICT
        );
      }
      const duplicate = await db.companionEarning.findFirst({
        where: { paidReference: reference, id: { not: earning.id } },
        select: { id: true }
      });
      if (duplicate) {
        throw new AppException(
          "EARNING_PAYOUT_REFERENCE_DUPLICATE",
          "Payout reference is already in use",
          HttpStatus.CONFLICT
        );
      }
      if (providerGate.state !== "clear") {
        const holdReason = providerGate.state === "active"
          ? "payment_dispute_transfer_outcome_unknown"
          : "payment_dispute_provider_outcome_unknown";
        const held = await db.companionEarning.update({
          where: { id: earning.id },
          data: {
            status: "held",
            holdReason,
            payoutSubmittedAt: earning.payoutSubmittedAt ?? new Date(),
            paidReference: reference,
            paidAmountCents: evidence.paidAmountCents,
            paidRecipientRef: evidence.paidRecipientRef.trim(),
            payoutEvidenceDigest: evidence.payoutEvidenceDigest.toLowerCase()
          },
          include: {
            order: true,
            companion: { select: { id: true, name: true, ownerUserId: true, commercialProfile: true } }
          }
        });
        await this.persistPayoutOutcomeUnknownRecoveries(db, earning, providerGate.disputeIds);
        await this.audit.record({
          actorId,
          subjectUserIds: earning.companion?.ownerUserId
            ? [earning.companion.ownerUserId]
            : [],
          action: "commercial.earning_payout_evidence_held_outcome_unknown",
          resourceType: "companionEarning",
          resourceId: earning.id,
          metadata: {
            orderId: earning.orderId,
            companionId: earning.companionId,
            paidReference: reference,
            payoutEvidenceDigest: evidence.payoutEvidenceDigest.toLowerCase(),
            providerGate: providerGate.state,
            disputeIds: providerGate.disputeIds,
            paidConfirmed: false
          }
        }, db);
        return { holdReason, earning: held };
      }
      const holdReason = await this.payoutHoldReason(db, earning.orderId);
      if (holdReason) {
        if (holdReason === "payment_dispute_live") {
          const disputeIds = await this.activePaymentDisputeIds(db, earning.orderId);
          const outcomeUnknownReason = "payment_dispute_transfer_outcome_unknown";
          const held = await db.companionEarning.update({
            where: { id: earning.id },
            data: {
              status: "held",
              holdReason: outcomeUnknownReason,
              payoutSubmittedAt: earning.payoutSubmittedAt ?? new Date(),
              paidReference: reference,
              paidAmountCents: evidence.paidAmountCents,
              paidRecipientRef: evidence.paidRecipientRef.trim(),
              payoutEvidenceDigest: evidence.payoutEvidenceDigest.toLowerCase()
            },
            include: {
              order: true,
              companion: { select: { id: true, name: true, ownerUserId: true, commercialProfile: true } }
            }
          });
          await this.persistPayoutOutcomeUnknownRecoveries(db, earning, disputeIds);
          await this.audit.record({
            actorId,
            subjectUserIds: earning.companion?.ownerUserId
              ? [earning.companion.ownerUserId]
              : [],
            action: "commercial.earning_payout_evidence_held_for_concurrent_dispute",
            resourceType: "companionEarning",
            resourceId: earning.id,
            metadata: {
              orderId: earning.orderId,
              companionId: earning.companionId,
              paidReference: reference,
              payoutEvidenceDigest: evidence.payoutEvidenceDigest.toLowerCase(),
              disputeIds,
              paidConfirmed: false
            }
          }, db);
          return { holdReason: outcomeUnknownReason, earning: held };
        }
        const held = await db.companionEarning.update({
          where: { id: earning.id },
          data: { status: "held", holdReason },
          include: { order: true, companion: { select: { id: true, name: true, ownerUserId: true, commercialProfile: true } } }
        });
        return { holdReason, earning: held };
      }
      const updated = await db.companionEarning.update({
        where: { id: earning.id },
        data: {
          status: "held",
          holdReason: "payout_verification_pending",
          payoutSubmittedAt: new Date(),
          paidReference: reference,
          paidAmountCents: evidence.paidAmountCents,
          paidRecipientRef: evidence.paidRecipientRef.trim(),
          payoutEvidenceDigest: evidence.payoutEvidenceDigest.toLowerCase()
        },
        include: { order: true, companion: { select: { id: true, name: true, ownerUserId: true, commercialProfile: true } } }
      });
      await this.audit.record({
        actorId,
        subjectUserIds: earning.companion?.ownerUserId
          ? [earning.companion.ownerUserId]
          : [],
        action: "commercial.earning_payout_evidence_recorded",
        resourceType: "companionEarning",
        resourceId: earning.id,
        metadata: {
          orderId: earning.orderId,
          companionId: earning.companionId,
          payableCents: earning.payableCents,
          paidReference: reference,
          paidAmountCents: evidence.paidAmountCents,
          paidRecipientRef: evidence.paidRecipientRef.trim(),
          payoutEvidenceDigest: evidence.payoutEvidenceDigest.toLowerCase(),
          verificationRequired: true
        }
      }, db);
      return { holdReason: null, earning: updated };
    });
    this.throwPayoutHold(result.holdReason);
    return this.toDto(result.earning, true);
  }

  async verifyPayout(actorId: string, earningId: string) {
    const providerGate = await this.livePayoutComplaintState(earningId);
    const result = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      const earning = await this.lockPayoutEarning(db, earningId);
      if (earning.status !== "held" || earning.holdReason !== "payout_verification_pending") {
        throw new AppException(
          "EARNING_PAYOUT_REVIEW_REQUIRED",
          "This earning is not awaiting payout verification",
          HttpStatus.CONFLICT
        );
      }
      if (
        !earning.payoutSubmittedAt ||
        !earning.payoutSubmittedById ||
        !earning.paidReference ||
        earning.paidAmountCents !== earning.payableCents ||
        earning.paidRecipientRef !== earning.settlementRecipientRefSnapshot ||
        !/^[a-f0-9]{64}$/.test(earning.payoutEvidenceDigest ?? "")
      ) {
        throw new AppException(
          "EARNING_PAYOUT_EVIDENCE_MISSING",
          "Payout evidence must be recorded before verification",
          HttpStatus.CONFLICT
        );
      }
      if (earning.payoutSubmittedById === actorId) {
        throw new AppException(
          "EARNING_PAYOUT_SECOND_REVIEW_REQUIRED",
          "A different administrator must verify this payout",
          HttpStatus.FORBIDDEN
        );
      }
      if (providerGate.state !== "clear") {
        const holdReason = providerGate.state === "active"
          ? "payment_dispute_transfer_outcome_unknown"
          : "payment_dispute_provider_outcome_unknown";
        const held = await db.companionEarning.update({
          where: { id: earning.id },
          data: { status: "held", holdReason },
          include: {
            order: true,
            companion: { select: { id: true, name: true, ownerUserId: true, commercialProfile: true } }
          }
        });
        await this.persistPayoutOutcomeUnknownRecoveries(db, earning, providerGate.disputeIds);
        await this.audit.record({
          actorId,
          subjectUserIds: earning.companion?.ownerUserId
            ? [earning.companion.ownerUserId]
            : [],
          action: "commercial.earning_payout_verification_blocked_outcome_unknown",
          resourceType: "companionEarning",
          resourceId: earning.id,
          metadata: {
            orderId: earning.orderId,
            companionId: earning.companionId,
            providerGate: providerGate.state,
            disputeIds: providerGate.disputeIds,
            paidConfirmed: false
          }
        }, db);
        return { holdReason, earning: held };
      }
      const holdReason = await this.payoutHoldReason(db, earning.orderId);
      if (holdReason) {
        if (holdReason === "payment_dispute_live") {
          const disputeIds = await this.activePaymentDisputeIds(db, earning.orderId);
          const outcomeUnknownReason = "payment_dispute_transfer_outcome_unknown";
          const held = await db.companionEarning.update({
            where: { id: earning.id },
            data: { status: "held", holdReason: outcomeUnknownReason },
            include: {
              order: true,
              companion: { select: { id: true, name: true, ownerUserId: true, commercialProfile: true } }
            }
          });
          await this.persistPayoutOutcomeUnknownRecoveries(db, earning, disputeIds);
          await this.audit.record({
            actorId,
            subjectUserIds: earning.companion?.ownerUserId
              ? [earning.companion.ownerUserId]
              : [],
            action: "commercial.earning_payout_verification_blocked_by_concurrent_dispute",
            resourceType: "companionEarning",
            resourceId: earning.id,
            metadata: {
              orderId: earning.orderId,
              companionId: earning.companionId,
              disputeIds,
              paidConfirmed: false
            }
          }, db);
          return { holdReason: outcomeUnknownReason, earning: held };
        }
        const held = await db.companionEarning.update({
          where: { id: earning.id },
          data: { status: "held", holdReason },
          include: { order: true, companion: { select: { id: true, name: true, ownerUserId: true, commercialProfile: true } } }
        });
        return { holdReason, earning: held };
      }
      const updated = await db.companionEarning.update({
        where: { id: earning.id },
        data: { status: "paid", paidAt: new Date(), holdReason: null },
        include: { order: true, companion: { select: { id: true, name: true, ownerUserId: true, commercialProfile: true } } }
      });
      await this.audit.record({
        actorId,
        subjectUserIds: earning.companion?.ownerUserId
          ? [earning.companion.ownerUserId]
          : [],
        action: "commercial.earning_payout_verified",
        resourceType: "companionEarning",
        resourceId: earning.id,
        metadata: {
          orderId: earning.orderId,
          companionId: earning.companionId,
          payableCents: earning.payableCents,
          paidReference: earning.paidReference,
          submittedById: earning.payoutSubmittedById
        }
      }, db);
      return { holdReason: null, earning: updated };
    });
    this.throwPayoutHold(result.holdReason);
    return this.toDto(result.earning, true);
  }

  async listRecoveries(query: { status?: string; page?: number; pageSize?: number } = {}) {
    const { status } = query;
    if (status && !["due", "pendingVerification", "recovered"].includes(status)) {
      throw new AppException("RECOVERY_STATUS_INVALID", "Unknown recovery status", HttpStatus.BAD_REQUEST);
    }
    const page = Number.isSafeInteger(query.page) && (query.page ?? 0) > 0 ? query.page! : 1;
    const pageSize = Number.isSafeInteger(query.pageSize) && (query.pageSize ?? 0) > 0
      ? Math.min(100, query.pageSize!)
      : 50;
    const where = status ? { status } : {};
    const [items, total] = await Promise.all([
      this.prisma.companionRecovery.findMany({
        where,
        include: {
          companion: { select: { id: true, name: true, ownerUserId: true } },
          refund: { include: { order: true } }
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize
      } as any),
      this.prisma.companionRecovery.count({ where } as any)
    ]);
    return {
      items: items.map((item: any) => this.recoveryDto(item)),
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) }
    };
  }

  private emptyEarningsSummary() {
    return {
      totalCount: 0,
      availableCents: 0,
      pendingOrHeldCents: 0,
      paidCents: 0,
      byStatus: {
        pending: { count: 0, payableCents: 0 },
        available: { count: 0, payableCents: 0 },
        held: { count: 0, payableCents: 0 },
        paid: { count: 0, payableCents: 0 },
        void: { count: 0, payableCents: 0 }
      }
    };
  }

  async recordRecoveryEvidence(actorId: string, recoveryId: string, evidenceReference: string) {
    const reference = evidenceReference.trim();
    const result = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await db.$queryRaw`SELECT "id" FROM "CompanionRecovery" WHERE "id" = ${recoveryId} FOR UPDATE`;
      const recovery = await db.companionRecovery.findUnique({
        where: { id: recoveryId },
        include: { companion: { select: { ownerUserId: true } } }
      });
      if (!recovery) throw new AppException("RECOVERY_NOT_FOUND", "Companion recovery not found", HttpStatus.NOT_FOUND);
      if (recovery.status !== "due") {
        throw new AppException("RECOVERY_INVALID_STATE", "Only a due recovery can receive evidence", HttpStatus.CONFLICT);
      }
      const duplicate = await db.companionRecovery.findFirst({
        where: { evidenceReference: reference, id: { not: recoveryId } },
        select: { id: true }
      });
      if (duplicate) {
        throw new AppException("RECOVERY_REFERENCE_DUPLICATE", "Recovery evidence reference is already in use", HttpStatus.CONFLICT);
      }
      const updated = await db.companionRecovery.update({
        where: { id: recoveryId },
        data: {
          status: "pendingVerification",
          evidenceReference: reference,
          evidenceSubmittedAt: new Date(),
          evidenceSubmittedById: actorId
        }
      });
      await this.audit.record({
        actorId,
        subjectUserIds: recovery.companion?.ownerUserId
          ? [recovery.companion.ownerUserId]
          : [],
        action: "commercial.recovery_evidence_recorded",
        resourceType: "companionRecovery",
        resourceId: recoveryId,
        metadata: {
          companionId: recovery.companionId,
          amountCents: recovery.amountCents,
          evidenceReference: reference
        }
      }, db);
      return updated;
    });
    return this.recoveryDto(result);
  }

  async verifyRecovery(actorId: string, recoveryId: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await db.$queryRaw`SELECT "id" FROM "CompanionRecovery" WHERE "id" = ${recoveryId} FOR UPDATE`;
      const recovery = await db.companionRecovery.findUnique({
        where: { id: recoveryId },
        include: { companion: { select: { ownerUserId: true } } }
      });
      if (!recovery) throw new AppException("RECOVERY_NOT_FOUND", "Companion recovery not found", HttpStatus.NOT_FOUND);
      if (recovery.status !== "pendingVerification" || !recovery.evidenceReference || !recovery.evidenceSubmittedById) {
        throw new AppException("RECOVERY_INVALID_STATE", "Recovery evidence is not awaiting verification", HttpStatus.CONFLICT);
      }
      if (recovery.evidenceSubmittedById === actorId) {
        throw new AppException(
          "RECOVERY_SECOND_REVIEW_REQUIRED",
          "A different administrator must verify the recovery",
          HttpStatus.FORBIDDEN
        );
      }
      const updated = await db.companionRecovery.update({
        where: { id: recoveryId },
        data: { status: "recovered", verifiedAt: new Date(), verifiedById: actorId }
      });
      await this.audit.record({
        actorId,
        subjectUserIds: recovery.companion?.ownerUserId
          ? [recovery.companion.ownerUserId]
          : [],
        action: "commercial.recovery_verified",
        resourceType: "companionRecovery",
        resourceId: recoveryId,
        metadata: {
          companionId: recovery.companionId,
          amountCents: recovery.amountCents,
          evidenceReference: recovery.evidenceReference,
          evidenceSubmittedById: recovery.evidenceSubmittedById
        }
      }, db);
      return updated;
    });
    return this.recoveryDto(result);
  }

  async holdForOrder(orderId: string, reason = "unresolved_support_ticket", db: any = this.prisma) {
    const updated = await db.companionEarning.updateMany({
      where: { orderId, status: { in: ["pending", "available", "held"] } },
      data: { status: "held", holdReason: reason }
    } as any);
    return updated.count;
  }

  async reconcileOrderEarning(orderId: string) {
    return this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await db.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
      const earning = await db.companionEarning.findUnique({ where: { orderId } });
      if (!earning || !["pending", "available", "held"].includes(earning.status)) return null;
      await db.$queryRaw`SELECT "id" FROM "CompanionEarning" WHERE "id" = ${earning.id} FOR UPDATE`;
      const holdReason = await this.payoutHoldReason(db, orderId);
      if (holdReason) {
        return db.companionEarning.update({
          where: { id: earning.id },
          data: { status: "held", holdReason }
        });
      }
      if (earning.payoutSubmittedAt && earning.payoutSubmittedById) return earning;
      return db.companionEarning.update({
        where: { id: earning.id },
        data: {
          status: earning.availableAt.getTime() <= Date.now() ? "available" : "pending",
          holdReason: null
        }
      });
    });
  }

  /**
   * Promotes matured funds only when every order-linked ticket is resolved.
   * It also catches a ticket created after an earning became available and
   * moves it back to held before an operator can pay it out.
   */
  async reconcileEarnings(limit = 50) {
    const safeLimit = Math.min(Math.max(Math.floor(limit) || 1, 1), 200);
    const candidates: Array<{ id: string; status: string; orderId: string }> = await this.prisma.$queryRaw`
      SELECT earning."id", earning."status", earning."orderId"
      FROM "CompanionEarning" AS earning
      WHERE earning."status" IN ('pending', 'available', 'held')
      ORDER BY earning."availableAt" ASC, earning."id" ASC
      LIMIT ${safeLimit}
    `;
    let available = 0;
    let held = 0;
    for (const candidate of candidates ?? []) {
      const result = await this.prisma.$transaction(async (tx) => {
        const db = tx as any;
        await db.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${candidate.orderId} FOR UPDATE`;
        await db.$queryRaw`SELECT "id" FROM "CompanionEarning" WHERE "id" = ${candidate.id} FOR UPDATE`;
        const earning = await db.companionEarning.findUnique({ where: { id: candidate.id } });
        if (!earning || !["pending", "available", "held"].includes(earning.status)) return "unchanged";
        const holdReason = await this.payoutHoldReason(db, earning.orderId);
        if (holdReason) {
          if (earning.status !== "held" || earning.holdReason !== holdReason) {
            await db.companionEarning.update({
              where: { id: earning.id },
              data: { status: "held", holdReason }
            });
            return "held";
          }
          return "unchanged";
        }
        if (earning.payoutSubmittedAt && earning.payoutSubmittedById) {
          const payoutHoldReason = earning.paidReference
            ? "payout_verification_pending"
            : "payout_execution_claimed";
          if (earning.status !== "held" || earning.holdReason !== payoutHoldReason) {
            await db.companionEarning.update({
              where: { id: earning.id },
              data: { status: "held", holdReason: payoutHoldReason }
            });
            return "held";
          }
          return "unchanged";
        }
        if (earning.availableAt.getTime() > Date.now()) return "unchanged";
        if (earning.status !== "available") {
          await db.companionEarning.update({
            where: { id: earning.id },
            data: { status: "available", holdReason: null }
          });
          return "available";
        }
        return "unchanged";
      });
      if (result === "available") available += 1;
      if (result === "held") held += 1;
    }
    return { scanned: candidates?.length ?? 0, available, held };
  }

  private async lockPayoutEarning(db: any, earningId: string) {
    // All payout-affecting flows lock Order first, then CompanionEarning. Refund
    // and support creation use the same order lock, preventing a transfer from
    // racing a newly opened dispute or refund request.
    const pointer = await db.companionEarning.findUnique({
      where: { id: earningId },
      select: { orderId: true, companionId: true }
    });
    if (!pointer) {
      throw new AppException("EARNING_NOT_FOUND", "Companion earning not found", HttpStatus.NOT_FOUND);
    }
    await db.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${pointer.orderId} FOR UPDATE`;
    await db.$queryRaw`SELECT "id" FROM "CompanionEarning" WHERE "id" = ${earningId} FOR UPDATE`;
    // All commercial-profile mutations lock CompanionProfile. Taking that
    // lock before the final read serializes payout with suspension/review, so
    // a profile cannot be suspended concurrently after eligibility was read.
    await db.$queryRaw`SELECT "id" FROM "CompanionProfile" WHERE "id" = ${pointer.companionId} FOR UPDATE`;
    const earning = await db.companionEarning.findUnique({
      where: { id: earningId },
      include: {
        order: true,
        companion: { select: { id: true, name: true, ownerUserId: true, commercialProfile: true } }
      }
    });
    if (!earning) {
      throw new AppException("EARNING_NOT_FOUND", "Companion earning not found", HttpStatus.NOT_FOUND);
    }
    return earning;
  }

  private async livePayoutComplaintState(earningId: string): Promise<{
    state: "clear" | "active" | "outcomeUnknown";
    disputeIds: string[];
  }> {
    if (!this.paymentDisputes) {
      return this.config.get<string>("APP_ENV", "test") === "production"
        ? { state: "outcomeUnknown", disputeIds: [] }
        : { state: "clear", disputeIds: [] };
    }
    const pointer = await this.prisma.companionEarning.findUnique({
      where: { id: earningId },
      select: { orderId: true }
    } as any);
    if (!pointer) {
      throw new AppException("EARNING_NOT_FOUND", "Companion earning not found", HttpStatus.NOT_FOUND);
    }
    try {
      const result = await this.paymentDisputes.refreshActiveForOrder(pointer.orderId);
      return result.active
        ? { state: "active", disputeIds: result.disputeIds }
        : { state: "clear", disputeIds: [] };
    } catch {
      return { state: "outcomeUnknown", disputeIds: [] };
    }
  }

  private async persistPayoutOutcomeUnknownRecoveries(
    db: any,
    earning: any,
    disputeIds: string[]
  ) {
    if (disputeIds.length) {
      for (const disputeId of disputeIds) {
        await db.companionRecovery.upsert({
          where: { disputeId_earningId: { disputeId, earningId: earning.id } },
          create: {
            disputeId,
            earningId: earning.id,
            companionId: earning.companionId,
            amountCents: earning.paidAmountCents ?? earning.payableCents,
            reason: "payoutStateUncertain"
          },
          update: {}
        });
      }
      return;
    }
    const existing = await db.companionRecovery.findFirst({
      where: {
        earningId: earning.id,
        disputeId: null,
        refundId: null,
        reason: "payoutStateUncertain",
        status: { in: ["due", "pendingVerification"] }
      },
      select: { id: true }
    });
    if (!existing) {
      await db.companionRecovery.create({
        data: {
          earningId: earning.id,
          companionId: earning.companionId,
          amountCents: earning.paidAmountCents ?? earning.payableCents,
          reason: "payoutStateUncertain"
        }
      });
    }
  }

  private async activePaymentDisputeIds(db: any, orderId: string): Promise<string[]> {
    if (!db.paymentDispute?.findMany) return [];
    const disputes = await db.paymentDispute.findMany({
      where: {
        status: { in: ["pendingSync", "open", "processing", "syncFailed"] },
        OR: [
          { orderId },
          { complaintOrders: { some: { orderId } } }
        ]
      },
      select: { id: true },
      orderBy: { id: "asc" }
    });
    return disputes.map((dispute: any) => dispute.id);
  }

  private async payoutHoldReason(db: any, orderId: string): Promise<string | null> {
    const order = await db.order.findUnique({
      where: { id: orderId },
      select: {
        completedAt: true,
        refundRequestDeadlineAt: true,
        refundPolicyVersionSnapshot: true,
        refundRequestWindowHoursSnapshot: true,
        adultEligibilityVerdictSnapshot: true,
        adultEligibilityVerifiedAtSnapshot: true,
        adultEligibilityValidUntilSnapshot: true
      }
    });
    const earningRef = await db.companionEarning.findUnique({
      where: { orderId },
      select: {
        companionId: true,
        settlementRecipientRefSnapshot: true,
        settlementRecipientMaskedSnapshot: true,
        taxProfileRefSnapshot: true,
        identityEvidenceRefSnapshot: true,
        serviceAgreementVersionSnapshot: true,
        serviceAgreementEvidenceRefSnapshot: true
      }
    });
    const unresolved = await db.supportTicket.findFirst({
      where: { orderId, status: { in: ["open", "inProgress"] } },
      select: { id: true }
    });
    const unresolvedAttendance = db.attendanceDispute?.findFirst
      ? await db.attendanceDispute.findFirst({
          where: { orderId, status: { not: "final" } },
          select: { id: true }
        })
      : null;
    const activePaymentDispute = db.paymentDispute?.findFirst
      ? await db.paymentDispute.findFirst({
          where: {
            status: { in: ["pendingSync", "open", "processing", "syncFailed"] },
            OR: [
              { orderId },
              { complaintOrders: { some: { orderId } } }
            ]
          },
          select: { id: true }
        })
      : null;
    const activeRefund = await db.refundTransaction.findFirst({
      where: { orderId, status: { in: ACTIVE_REFUND_STATUSES } },
      select: { id: true, status: true }
    });
    const recovery = earningRef && db.companionRecovery?.findFirst
      ? await db.companionRecovery.findFirst({
          where: { companionId: earningRef.companionId, status: { in: ["due", "pendingVerification"] } },
          select: { id: true }
        })
      : null;
    const commercialProfile = earningRef && db.companionCommercialProfile?.findUnique
      ? await db.companionCommercialProfile.findUnique({
          where: { companionId: earningRef.companionId },
          select: {
            status: true,
            adultEligibilityVerdict: true,
            adultEligibilityValidUntil: true
          }
        })
      : null;
    if (recovery) return "companion_recovery_due";
    if (
      earningRef &&
      (!earningRef.settlementRecipientRefSnapshot ||
        !earningRef.settlementRecipientMaskedSnapshot ||
        !earningRef.taxProfileRefSnapshot ||
        !earningRef.identityEvidenceRefSnapshot ||
        order?.adultEligibilityVerdictSnapshot !== "adult" ||
        !order?.adultEligibilityVerifiedAtSnapshot ||
        !order?.adultEligibilityValidUntilSnapshot ||
        !earningRef.serviceAgreementVersionSnapshot ||
        !earningRef.serviceAgreementEvidenceRefSnapshot)
    ) {
      return "commercial_profile_snapshot_missing";
    }
    if (earningRef && commercialProfile?.status !== "verified") return "commercial_profile_not_verified";
    if (earningRef && !this.isCurrentAdultEligibility(commercialProfile)) {
      return "companion_adult_eligibility_not_current";
    }
    if (unresolvedAttendance) return "attendance_dispute";
    if (activePaymentDispute) return "payment_dispute_live";
    if (unresolved) return "unresolved_support_ticket";
    if (activeRefund?.status === "failed") return "refund_attention_required";
    if (activeRefund) return "refund_in_progress";
    if (!this.validCompletedOrderRefundPolicySnapshot(order)) {
      return "refund_policy_snapshot_missing";
    }
    return order.refundRequestDeadlineAt.getTime() > Date.now() ? "refund_window_open" : null;
  }

  private validCompletedOrderRefundPolicySnapshot(order: any): boolean {
    const version = typeof order?.refundPolicyVersionSnapshot === "string"
      ? order.refundPolicyVersionSnapshot.trim()
      : "";
    const hours = order?.refundRequestWindowHoursSnapshot;
    const completedAt = order?.completedAt instanceof Date ? order.completedAt : null;
    const deadline = order?.refundRequestDeadlineAt instanceof Date
      ? order.refundRequestDeadlineAt
      : null;
    return /^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/.test(version)
      && Number.isInteger(hours)
      && hours >= 1
      && hours <= 720
      && Boolean(completedAt)
      && Boolean(deadline)
      && deadline!.getTime() === completedAt!.getTime() + hours * 60 * 60_000;
  }

  private throwPayoutHold(holdReason: string | null) {
    if (holdReason === "payment_dispute_live") {
      throw new AppException(
        "EARNING_HELD_FOR_PAYMENT_DISPUTE",
        "This earning is held while an active provider payment complaint is investigated",
        HttpStatus.CONFLICT
      );
    }
    if (holdReason === "payment_dispute_transfer_outcome_unknown"
      || holdReason === "payment_dispute_provider_outcome_unknown") {
      throw new AppException(
        "EARNING_PAYOUT_OUTCOME_UNKNOWN",
        "Payout evidence was retained, but the earning cannot be marked paid until complaint and transfer outcomes are reconciled",
        HttpStatus.CONFLICT
      );
    }
    if (holdReason === "attendance_dispute") {
      throw new AppException(
        "EARNING_HELD_FOR_ATTENDANCE_DISPUTE",
        "This earning is held while an attendance dispute is unresolved",
        HttpStatus.CONFLICT
      );
    }
    if (holdReason === "unresolved_support_ticket") {
      throw new AppException(
        "EARNING_HELD_FOR_SUPPORT",
        "This earning is held while an associated support ticket is unresolved",
        HttpStatus.CONFLICT
      );
    }
    if (holdReason === "refund_in_progress") {
      throw new AppException(
        "EARNING_HELD_FOR_REFUND",
        "This earning is held while an associated refund is in progress",
        HttpStatus.CONFLICT
      );
    }
    if (holdReason === "refund_attention_required") {
      throw new AppException(
        "EARNING_HELD_FOR_FAILED_REFUND",
        "This earning is held until the failed refund is reconciled or formally resolved",
        HttpStatus.CONFLICT
      );
    }
    if (holdReason === "companion_recovery_due") {
      throw new AppException(
        "EARNING_HELD_FOR_COMPANION_RECOVERY",
        "This companion has an unresolved post-payout refund recovery",
        HttpStatus.CONFLICT
      );
    }
    if (holdReason === "refund_window_open") {
      throw new AppException(
        "EARNING_REFUND_WINDOW_OPEN",
        "This earning cannot be paid before the customer refund request window closes",
        HttpStatus.CONFLICT
      );
    }
    if (holdReason === "refund_policy_snapshot_missing") {
      throw new AppException(
        "EARNING_REFUND_POLICY_SNAPSHOT_INVALID",
        "A valid immutable refund policy snapshot and deadline are required before payout",
        HttpStatus.CONFLICT
      );
    }
    if (holdReason === "commercial_profile_snapshot_missing") {
      throw new AppException(
        "EARNING_SETTLEMENT_SNAPSHOT_MISSING",
        "Settlement, tax and agreement snapshots are required before payout",
        HttpStatus.CONFLICT
      );
    }
    if (holdReason === "commercial_profile_not_verified") {
      throw new AppException(
        "EARNING_COMMERCIAL_PROFILE_NOT_VERIFIED",
        "The companion commercial profile must remain verified at payout time",
        HttpStatus.CONFLICT
      );
    }
    if (holdReason === "companion_adult_eligibility_not_current") {
      throw new AppException(
        "EARNING_ADULT_ELIGIBILITY_EXPIRED",
        "The companion adult eligibility must remain current at payout time",
        HttpStatus.CONFLICT
      );
    }
  }

  settlementHoldHours() {
    return this.config.get<number>("COMPANION_SETTLEMENT_HOLD_HOURS") ?? 96;
  }

  private toDto(earning: any, includeOperations: boolean) {
    const dto = {
      id: earning.id,
      orderId: earning.orderId,
      companionId: earning.companionId,
      grossCents: earning.grossCents,
      platformFeeBps: earning.platformFeeBps,
      platformFeeCents: earning.platformFeeCents,
      payableCents: earning.payableCents,
      status: earning.status,
      availableAt: earning.availableAt.toISOString(),
      paidAt: earning.paidAt?.toISOString() ?? null,
      ...(includeOperations
        ? { holdReason: earning.holdReason ?? null }
        : { hold: companionEarningHoldProjection(earning.holdReason) }),
      createdAt: earning.createdAt.toISOString(),
      updatedAt: earning.updatedAt.toISOString(),
      order: earning.order ? {
        scheduledAt: earning.order.scheduledAt?.toISOString?.() ?? null,
        status: earning.order.status,
        amountCents: earning.order.amountCents,
        companionName: earning.order.companionNameSnapshot
      } : null
    } as Record<string, unknown>;
    if (includeOperations) {
      dto.paidReference = earning.paidReference ?? null;
      dto.paidAmountCents = earning.paidAmountCents ?? null;
      dto.paidRecipientRef = earning.paidRecipientRef ?? null;
      dto.payoutEvidenceDigest = earning.payoutEvidenceDigest ?? null;
      dto.settlementRecipientRefSnapshot = earning.settlementRecipientRefSnapshot ?? null;
      dto.settlementRecipientMaskedSnapshot = earning.settlementRecipientMaskedSnapshot ?? null;
      dto.taxProfileRefSnapshot = earning.taxProfileRefSnapshot ?? null;
      dto.identityEvidenceRefSnapshot = earning.identityEvidenceRefSnapshot ?? null;
      dto.serviceAgreementVersionSnapshot = earning.serviceAgreementVersionSnapshot ?? null;
      dto.serviceAgreementEvidenceRefSnapshot = earning.serviceAgreementEvidenceRefSnapshot ?? null;
      dto.payoutSubmittedAt = earning.payoutSubmittedAt?.toISOString() ?? null;
      dto.payoutSubmittedById = earning.payoutSubmittedById ?? null;
      dto.companion = earning.companion ? {
        id: earning.companion.id,
        name: earning.companion.name,
        ownerUserId: earning.companion.ownerUserId
      } : null;
    }
    return dto;
  }

  private recoveryDto(recovery: any) {
    return {
      id: recovery.id,
      refundId: recovery.refundId,
      earningId: recovery.earningId,
      companionId: recovery.companionId,
      amountCents: recovery.amountCents,
      status: recovery.status,
      reason: recovery.reason,
      evidenceReference: recovery.evidenceReference ?? null,
      evidenceSubmittedAt: recovery.evidenceSubmittedAt?.toISOString?.() ?? null,
      evidenceSubmittedById: recovery.evidenceSubmittedById ?? null,
      verifiedAt: recovery.verifiedAt?.toISOString?.() ?? null,
      verifiedById: recovery.verifiedById ?? null,
      companion: recovery.companion ?? null,
      orderId: recovery.refund?.orderId ?? null,
      createdAt: recovery.createdAt?.toISOString?.() ?? null,
      updatedAt: recovery.updatedAt?.toISOString?.() ?? null
    };
  }

  private commercialProfileDto(profile: any) {
    return {
      companionId: profile.companionId,
      status: profile.status,
      settlementRecipientMasked: profile.settlementRecipientMasked,
      taxProfileRef: profile.taxProfileRef,
      identityEvidenceRef: profile.identityEvidenceRef,
      serviceAgreementVersion: profile.serviceAgreementVersion,
      serviceAgreementEvidenceRef: profile.serviceAgreementEvidenceRef,
      submittedAt: profile.submittedAt?.toISOString?.() ?? null,
      submittedById: profile.submittedById,
      verifiedAt: profile.verifiedAt?.toISOString?.() ?? null,
      verifiedById: profile.verifiedById ?? null,
      adultEligibility: {
        verdict: profile.adultEligibilityVerdict ?? "pending",
        verifiedAt: profile.adultEligibilityVerifiedAt?.toISOString?.() ?? null,
        validUntil: profile.adultEligibilityValidUntil?.toISOString?.() ?? null,
        evidenceAvailable: Boolean(profile.adultEligibilityEvidenceRef)
      },
      suspendedAt: profile.suspendedAt?.toISOString?.() ?? null,
      suspendedById: profile.suspendedById ?? null,
      suspendedReason: profile.suspendedReason ?? null,
      nextReviewDueAt: profile.nextReviewDueAt?.toISOString?.() ?? null,
      companion: profile.companion ?? null,
      createdAt: profile.createdAt?.toISOString?.() ?? null,
      updatedAt: profile.updatedAt?.toISOString?.() ?? null
    };
  }

  private isCurrentAdultEligibility(profile: any): boolean {
    return profile?.adultEligibilityVerdict === "adult"
      && profile.adultEligibilityValidUntil instanceof Date
      && profile.adultEligibilityValidUntil.getTime() > Date.now();
  }
}
