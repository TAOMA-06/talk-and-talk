import { createHash } from "node:crypto";

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { AuditService } from "../common/audit/audit.service";
import { redactControlledAuditSubjectMetadata } from "../common/audit/audit-subject-reference";
import { ACCOUNT_DELETION_RETENTION_POLICY_VERSION } from "../common/account-deletion-retention-policy";
import {
  deleteBoundedRows,
  ERASURE_BATCH_SIZE,
  eraseSubjectPhaseBatch,
  nextRetentionImmediatePhase,
  RETENTION_IMMEDIATE_PHASES,
  updateBoundedRows
} from "../common/privacy/bounded-erasure";
import type { ErasureBatchResult } from "../common/privacy/bounded-erasure";
import { PrismaService } from "../database/prisma.service";

const RETENTION_SCAN_INTERVAL_MS = 24 * 60 * 60_000;
const RETENTION_LEDGER_BATCH_SIZE = 1;
const RETENTION_LEDGER_MAX_BATCHES_PER_RUN = 50;
const RETENTION_POLICY_APPROVAL_BATCH_SIZE = 100;
const RETENTION_POLICY_APPROVAL_MAX_BATCHES_PER_RUN = 1;
const RETENTION_LEDGER_CONTINUATION_DELAY_MS = 1_000;
const RETENTION_LEASE_MS = 30_000;
const LOW_RISK_MAX_BATCHES_PER_RUN = 10;
const RETENTION_RUN_BUDGET_MS = 4_000;
const MEDIA_STORAGE_WAIT_RETRY_MS = 30_000;
const AUDIT_SUBJECT_BACKFILL_VERSION = "controlled-v2";
const AUDIT_SUBJECT_BACKFILL_MAX_BATCHES_PER_RUN = 10;

type RetentionPhaseBatchResult = ErasureBatchResult & { nextAttemptAt?: Date };

const HISTORICAL_DIRECT_USER_RESOURCE_ACTIONS = new Set([
  "account.other_sessions_revoked",
  "account.status_updated",
  "admin.login",
  "admin.login_failed",
  "user.login",
  "user.login_failed"
]);

function partyOrderExists(orderIdExpression: string): string {
  return `EXISTS (
    SELECT 1 FROM "Order" party_order
    WHERE party_order."id" = ${orderIdExpression}
      AND (
        party_order."userId" = $1
        OR ($2::TEXT IS NOT NULL AND party_order."companionId" = $2)
      )
  )`;
}

function partyPaymentExists(paymentIdExpression: string): string {
  return `EXISTS (
    SELECT 1
    FROM "PaymentTransaction" party_payment
    JOIN "Order" party_order ON party_order."id" = party_payment."orderId"
    WHERE party_payment."id" = ${paymentIdExpression}
      AND (
        party_order."userId" = $1
        OR ($2::TEXT IS NOT NULL AND party_order."companionId" = $2)
      )
  )`;
}

function partyOutTradeNoExists(outTradeNoExpression: string): string {
  return `EXISTS (
    SELECT 1
    FROM "PaymentTransaction" party_payment
    JOIN "Order" party_order ON party_order."id" = party_payment."orderId"
    WHERE party_payment."outTradeNo" = ${outTradeNoExpression}
      AND (
        party_order."userId" = $1
        OR ($2::TEXT IS NOT NULL AND party_order."companionId" = $2)
      )
  )`;
}

function partyOutRefundNoExists(outRefundNoExpression: string): string {
  return `EXISTS (
    SELECT 1
    FROM "RefundTransaction" party_refund
    JOIN "Order" party_order ON party_order."id" = party_refund."orderId"
    WHERE party_refund."outRefundNo" = ${outRefundNoExpression}
      AND (
        party_order."userId" = $1
        OR ($2::TEXT IS NOT NULL AND party_order."companionId" = $2)
      )
  )`;
}

function partyProviderTransactionIdExists(transactionIdExpression: string): string {
  return `EXISTS (
    SELECT 1
    FROM "PaymentTransaction" party_payment
    JOIN "Order" party_order ON party_order."id" = party_payment."orderId"
    WHERE party_payment."transactionId" = ${transactionIdExpression}
      AND party_payment."transactionId" IS NOT NULL
      AND (
        party_order."userId" = $1
        OR ($2::TEXT IS NOT NULL AND party_order."companionId" = $2)
      )
  )`;
}

function partyProviderRefundIdExists(providerRefundIdExpression: string): string {
  return `EXISTS (
    SELECT 1
    FROM "RefundTransaction" party_refund
    JOIN "Order" party_order ON party_order."id" = party_refund."orderId"
    WHERE party_refund."providerRefundId" = ${providerRefundIdExpression}
      AND party_refund."providerRefundId" IS NOT NULL
      AND (
        party_order."userId" = $1
        OR ($2::TEXT IS NOT NULL AND party_order."companionId" = $2)
      )
  )`;
}

function partyBillEntryPredicate(alias: string): string {
  return `(
    ${partyOutTradeNoExists(`${alias}."outTradeNo"`)}
    OR ${partyProviderTransactionIdExists(`${alias}."transactionId"`)}
    OR ${partyOutRefundNoExists(`${alias}."outRefundNo"`)}
    OR ${partyProviderRefundIdExists(`${alias}."providerRefundId"`)}
    OR ${partyOutTradeNoExists(`${alias}."businessReference"`)}
    OR ${partyOutRefundNoExists(`${alias}."businessReference"`)}
  )`;
}

function partyCashEntryPredicate(alias: string): string {
  return `(
    (${alias}."sourceResourceType" = 'paymentTransaction'
      AND ${partyPaymentExists(`${alias}."sourceResourceId"`)})
    OR (${alias}."sourceResourceType" = 'refundTransaction'
      AND EXISTS (
        SELECT 1
        FROM "RefundTransaction" party_refund
        JOIN "Order" party_order ON party_order."id" = party_refund."orderId"
        WHERE party_refund."id" = ${alias}."sourceResourceId"
          AND (party_order."userId" = $1
            OR ($2::TEXT IS NOT NULL AND party_order."companionId" = $2))
      ))
    OR ($2::TEXT IS NOT NULL AND ${alias}."sourceResourceType" IN ('settlement', 'fee')
      AND (
        EXISTS (SELECT 1 FROM "CompanionEarning" earning
          WHERE earning."id" = ${alias}."sourceResourceId" AND earning."companionId" = $2)
        OR EXISTS (SELECT 1 FROM "CompanionWithdrawalRequest" withdrawal
          WHERE withdrawal."id" = ${alias}."sourceResourceId" AND withdrawal."companionId" = $2)
        OR EXISTS (SELECT 1 FROM "CompanionRecovery" recovery
          WHERE recovery."id" = ${alias}."sourceResourceId" AND recovery."companionId" = $2)
      ))
  )`;
}

function partyReconciliationIssuePredicate(alias: string): string {
  return `(
    EXISTS (
      SELECT 1 FROM "WeChatBillEntry" party_entry
      WHERE party_entry."id" = ${alias}."entryId"
        AND ${partyBillEntryPredicate("party_entry")}
    )
    OR (${alias}."localResourceType" = 'order'
      AND ${partyOrderExists(`${alias}."localResourceId"`)})
    OR (${alias}."localResourceType" = 'paymentTransaction'
      AND ${partyPaymentExists(`${alias}."localResourceId"`)})
    OR (${alias}."localResourceType" = 'refundTransaction'
      AND EXISTS (
        SELECT 1 FROM "RefundTransaction" party_refund
        JOIN "Order" party_order ON party_order."id" = party_refund."orderId"
        WHERE party_refund."id" = ${alias}."localResourceId"
          AND (party_order."userId" = $1
            OR ($2::TEXT IS NOT NULL AND party_order."companionId" = $2))
      ))
    OR (${alias}."localResourceType" = 'invoiceRequest'
      AND EXISTS (
        SELECT 1 FROM "InvoiceRequest" party_invoice
        WHERE party_invoice."id" = ${alias}."localResourceId"
          AND (party_invoice."userId" = $1
            OR ${partyOrderExists('party_invoice."orderId"')})
      ))
    OR ($2::TEXT IS NOT NULL AND ${alias}."localResourceType" = 'companionEarning'
      AND EXISTS (SELECT 1 FROM "CompanionEarning" earning
        WHERE earning."id" = ${alias}."localResourceId" AND earning."companionId" = $2))
    OR ($2::TEXT IS NOT NULL AND ${alias}."localResourceType" = 'companionWithdrawalRequest'
      AND EXISTS (SELECT 1 FROM "CompanionWithdrawalRequest" withdrawal
        WHERE withdrawal."id" = ${alias}."localResourceId" AND withdrawal."companionId" = $2))
    OR ($2::TEXT IS NOT NULL AND ${alias}."localResourceType" = 'companionRecovery'
      AND EXISTS (SELECT 1 FROM "CompanionRecovery" recovery
        WHERE recovery."id" = ${alias}."localResourceId" AND recovery."companionId" = $2))
    OR (${alias}."localResourceType" = 'cashLedgerEntry'
      AND EXISTS (SELECT 1 FROM "CashLedgerEntry" cash_entry
        WHERE cash_entry."id" = ${alias}."localResourceId"
          AND ${partyCashEntryPredicate("cash_entry")}))
  )`;
}

function directPartyDisputeOrderPredicate(alias: string): string {
  return `(
    ${partyOrderExists(`${alias}."orderId"`)}
    OR ${partyPaymentExists(`${alias}."paymentId"`)}
    OR ${partyOutTradeNoExists(`${alias}."outTradeNo"`)}
  )`;
}

function partyDisputePredicate(disputeIdExpression: string): string {
  return `EXISTS (
    SELECT 1 FROM "PaymentDispute" party_dispute
    WHERE party_dispute."id" = ${disputeIdExpression}
      AND (
        ${partyOrderExists('party_dispute."orderId"')}
        OR ${partyPaymentExists('party_dispute."paymentId"')}
        OR ${partyOutTradeNoExists('party_dispute."outTradeNo"')}
        OR EXISTS (
          SELECT 1 FROM "PaymentDisputeOrder" complaint_order
          WHERE complaint_order."disputeId" = party_dispute."id"
            AND ${directPartyDisputeOrderPredicate("complaint_order")}
        )
      )
  )`;
}

function partyModerationCasePredicate(alias: string): string {
  return `(
    ${alias}."subjectUserId" = $1
    OR ${alias}."reporterUserId" = $1
    OR EXISTS (
      SELECT 1 FROM "Message" subject_message
      WHERE subject_message."id" = ${alias}."messageId"
        AND subject_message."senderId" = $1
    )
    OR EXISTS (
      SELECT 1 FROM "Message" subject_message
      WHERE subject_message."id" = ${alias}."targetId"
        AND subject_message."senderId" = $1
    )
  )`;
}

const RETENTION_RESTRICTED_PHASES: Record<string, readonly string[]> = {
  transactions_tax_invoices: [
    "invoice_request",
    "customer_order",
    "companion_order",
    "wechat_reconciliation_resolution",
    "wechat_reconciliation_issue",
    "cash_ledger_classification",
    "cash_ledger_entry",
    "wechat_bill_import_proposal",
    "wechat_bill_import_entry",
    "wechat_bill_run",
    "wechat_bill_entry",
    "payment_dispute_order_financial",
    "payment_transaction",
    "refund_transaction",
    "companion_earning",
    "companion_withdrawal",
    "companion_recovery",
    "companion_commercial",
    "transaction_availability_window",
    "companion_detach",
    "retention_verify"
  ],
  support_disputes_safety: [
    "controlled_evidence_attachment",
    "order_support_fact",
    "support_ticket",
    "payment_dispute_attachment",
    "payment_dispute_notification",
    "payment_dispute_negotiation_event",
    "payment_dispute_reply",
    "payment_dispute_order",
    "payment_dispute",
    "attendance_statement",
    "attendance_dispute",
    "order_reschedule_request",
    "order_timeline_event",
    "order_experience_feedback",
    "voice_attendance_event",
    "voice_session",
    "moderation_evidence",
    "moderation_action_log",
    "moderation_appeal",
    "chat_restriction",
    "moderation_case",
    "crisis_intervention",
    "companion_incident",
    "message",
    "conversation",
    "media_storage_schedule",
    "media_storage_wait",
    "media_asset_delete",
    "companion_detach",
    "retention_verify"
  ],
  consent_rights_account_governance: [
    "data_rights_follow_up",
    "data_rights_request",
    "legal_consent",
    "identity_verification",
    "customer_adult_eligibility",
    "user_account_appeal",
    "user_account_action",
    "companion_training",
    "companion_account_appeal",
    "companion_account_action",
    "companion_detach",
    "retention_verify"
  ],
  deletion_audit_evidence: [
    "auth_identity_tombstone",
    "deletion_request_note",
    "rating_refresh_job",
    "audit_subject_reference",
    "audit_deletion_request_reference",
    "retention_verify"
  ]
};

/**
 * Enforces both the configured ceiling for low-risk operational records and
 * the approved, per-account restricted-retention ledger created on deletion.
 */
@Injectable()
export class DataRetentionWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DataRetentionWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private continuationTimer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService
  ) {}

  onModuleInit() {
    if (this.config.get<string>("NODE_ENV") === "test") return;
    this.timer = setInterval(() => this.runOnceSafely(), RETENTION_SCAN_INTERVAL_MS);
    this.timer.unref?.();
    this.runOnceSafely();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    if (this.continuationTimer) clearTimeout(this.continuationTimer);
    this.timer = null;
    this.continuationTimer = null;
  }

  async runOnce() {
    if (this.running) return { skipped: true };
    this.running = true;
    const runDeadline = Date.now() + RETENTION_RUN_BUDGET_MS;
    try {
      const retentionDays = this.config.get<number>("LEGAL_PRIVACY_RETENTION_DAYS") ?? 1095;
      const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60_000);
      const tokenCutoff = new Date(Date.now() - 30 * 24 * 60 * 60_000);
      const lowRisk = await this.cleanupLowRisk(cutoff, tokenCutoff, retentionDays, runDeadline);
      const auditSubjectBackfill = await this.advanceAuditSubjectReferenceBackfill(runDeadline);
      const {
        continuationRequired: policyApprovalContinuationRequired,
        ...policyApprovals
      } = await this.approvePendingRetentionPolicies();

      const expiredCategories: Record<string, number> = {};
      const failedCategories: Record<string, number> = {};
      let selectedAccountRetentionRecords = 0;
      let expiredAccountRetentionRecords = 0;
      let failedAccountRetentionRecords = 0;
      let earliestRetryAt: Date | null = null;
      let retentionProgressContinuationRequired = false;
      let wallClockContinuationRequired = false;

      for (let batch = 0; batch < RETENTION_LEDGER_MAX_BATCHES_PER_RUN; batch += 1) {
        if (Date.now() >= runDeadline) {
          wallClockContinuationRequired = true;
          break;
        }
        const dueRows = await this.claimDueRetentionRecords(RETENTION_LEDGER_BATCH_SIZE);
        if (!dueRows.length) break;
        selectedAccountRetentionRecords += dueRows.length;
        let batchHasProgressContinuation = false;
        for (const row of dueRows) {
          try {
            const outcome = await this.processClaimedRetentionRecord(row);
            if (outcome?.completed) {
              expiredAccountRetentionRecords += 1;
              expiredCategories[outcome.category] = (expiredCategories[outcome.category] ?? 0) + 1;
            } else if (outcome?.progressed) {
              batchHasProgressContinuation = true;
              retentionProgressContinuationRequired = true;
            }
          } catch (error) {
            const failure = await this.recordExpiryFailure(row.id, row.leaseToken, error);
            failedAccountRetentionRecords += 1;
            if (failure?.category) {
              failedCategories[failure.category] = (failedCategories[failure.category] ?? 0) + 1;
            }
            if (failure?.nextAttemptAt
              && (!earliestRetryAt || failure.nextAttemptAt < earliestRetryAt)) {
              earliestRetryAt = failure.nextAttemptAt;
            }
            this.logger.error("Retention category failed (" + (failure?.errorCode ?? "retention_category_failed") + ")");
          }
        }
        if (dueRows.length < RETENTION_LEDGER_BATCH_SIZE && !batchHasProgressContinuation) break;
      }
      const hitRunLimit = selectedAccountRetentionRecords
        >= RETENTION_LEDGER_BATCH_SIZE * RETENTION_LEDGER_MAX_BATCHES_PER_RUN;
      const futureRetry = await (this.prisma as any).accountDataRetentionRecord.aggregate({
        where: {
          expiryProcessedAt: null,
          expiryNextAttemptAt: { gt: new Date() },
          OR: [
            { disposition: "pendingErasure" },
            {
              disposition: "retainedRestricted",
              policyApprovalStatus: "approved",
              policyApprovalReference: { not: null }
            }
          ]
        },
        _min: { expiryNextAttemptAt: true }
      });
      const persistedRetryAt = futureRetry?._min?.expiryNextAttemptAt
        ? new Date(futureRetry._min.expiryNextAttemptAt)
        : null;
      const nextRetryAt = [earliestRetryAt, persistedRetryAt]
        .filter((value): value is Date => Boolean(value))
        .sort((left, right) => left.getTime() - right.getTime())[0] ?? null;
      const immediateContinuationRequired = hitRunLimit
        || policyApprovalContinuationRequired
        || lowRisk.continuationRequired
        || auditSubjectBackfill.continuationRequired
        || retentionProgressContinuationRequired
        || wallClockContinuationRequired;
      if (immediateContinuationRequired) {
        this.scheduleContinuation(RETENTION_LEDGER_CONTINUATION_DELAY_MS);
      } else if (nextRetryAt) {
        this.scheduleContinuation(Math.max(
          RETENTION_LEDGER_CONTINUATION_DELAY_MS,
          nextRetryAt.getTime() - Date.now()
        ));
      }
      return {
        skipped: false,
        cutoff: cutoff.toISOString(),
        deletedNotificationDeliveries: lowRisk.deletedNotificationDeliveries,
        deletedNotifications: lowRisk.deletedNotifications,
        deletedSubscriptionGrants: lowRisk.deletedSubscriptionGrants,
        deletedRefreshTokens: lowRisk.deletedRefreshTokens,
        auditSubjectBackfillProcessed: auditSubjectBackfill.processed,
        auditSubjectBackfillCompleted: auditSubjectBackfill.completed,
        ...policyApprovals,
        selectedAccountRetentionRecords,
        expiredAccountRetentionRecords,
        expiredAccountRetentionCategories: expiredCategories,
        failedAccountRetentionRecords,
        failedAccountRetentionCategories: failedCategories,
        continuationScheduled: immediateContinuationRequired || Boolean(nextRetryAt)
      };
    } catch (error) {
      this.logger.error(`Retention cleanup failed (${error instanceof Error ? error.name : "unknown_error"})`);
      throw error;
    } finally {
      this.running = false;
    }
  }

  private async advanceAuditSubjectReferenceBackfill(runDeadline: number): Promise<{
    processed: number;
    completed: boolean;
    continuationRequired: boolean;
  }> {
    let processed = 0;
    let completed = false;
    for (let batch = 0; batch < AUDIT_SUBJECT_BACKFILL_MAX_BATCHES_PER_RUN; batch += 1) {
      if (Date.now() >= runDeadline) break;
      const rows = await this.prisma.$queryRaw<Array<{
        processed: number;
        referencesTouched: number;
        completed: boolean;
      }>>`
        SELECT * FROM "backfill_audit_subject_references_v2"(${ERASURE_BATCH_SIZE})
      `;
      processed += Number(rows[0]?.processed ?? 0);
      completed = rows[0]?.completed === true;
      if (completed) break;
    }
    return {
      processed,
      completed,
      continuationRequired: !completed
    };
  }

  private async cleanupLowRisk(
    cutoff: Date,
    tokenCutoff: Date,
    retentionDays: number,
    runDeadline: number
  ): Promise<{
    deletedNotificationDeliveries: number;
    deletedNotifications: number;
    deletedSubscriptionGrants: number;
    deletedRefreshTokens: number;
    continuationRequired: boolean;
  }> {
    const drain = async (
      table: string,
      predicate: string,
      parameters: unknown[]
    ): Promise<{ count: number; continuationRequired: boolean }> => {
      let count = 0;
      let continuationRequired = false;
      for (let batch = 0; batch < LOW_RISK_MAX_BATCHES_PER_RUN; batch += 1) {
        if (Date.now() >= runDeadline) return { count, continuationRequired: true };
        const result = await this.prisma.$transaction((tx) =>
          deleteBoundedRows(tx, table, predicate, parameters, ERASURE_BATCH_SIZE)
        );
        count += result.affectedCount;
        if (!result.hasMore) return { count, continuationRequired: false };
        if (batch === LOW_RISK_MAX_BATCHES_PER_RUN - 1) continuationRequired = true;
      }
      return { count, continuationRequired };
    };

    // Delivery rows are drained before their parent inbox rows so deleting one
    // old Notification cannot cascade an unbounded delivery set.
    const deliveries = await drain(
      "NotificationDelivery",
      'EXISTS (SELECT 1 FROM "Notification" notification WHERE notification."id" = target."notificationId" AND notification."createdAt" < $1)',
      [cutoff]
    );
    const notifications = await drain("Notification", 'target."createdAt" < $1', [cutoff]);
    const grants = await drain("WeChatSubscriptionGrant", 'target."createdAt" < $1', [cutoff]);
    const refreshTokens = await drain("RefreshToken", 'target."expiresAt" < $1', [tokenCutoff]);
    await this.prisma.$transaction(async (tx) => {
      await this.audit.record({
        action: "privacy.retention_low_risk_cleanup_completed",
        resourceType: "dataRetentionRun",
        metadata: {
          cutoff: cutoff.toISOString(),
          retentionDays,
          boundedBatchSize: ERASURE_BATCH_SIZE,
          deletedNotificationDeliveries: deliveries.count,
          deletedNotifications: notifications.count,
          deletedSubscriptionGrants: grants.count,
          deletedRefreshTokens: refreshTokens.count
        }
      }, tx);
    });
    return {
      deletedNotificationDeliveries: deliveries.count,
      deletedNotifications: notifications.count,
      deletedSubscriptionGrants: grants.count,
      deletedRefreshTokens: refreshTokens.count,
      continuationRequired: deliveries.continuationRequired
        || notifications.continuationRequired
        || grants.continuationRequired
        || refreshTokens.continuationRequired
    };
  }

  private async claimDueRetentionRecords(
    limit: number
  ): Promise<Array<{ id: string; leaseToken: string }>> {
    return this.prisma.$queryRaw<Array<{ id: string; leaseToken: string }>>`
      WITH due AS MATERIALIZED (
        SELECT record."id"
        FROM "AccountDataRetentionRecord" AS record
        WHERE (
            record."disposition" = 'pendingErasure'
            OR (
              record."disposition" = 'retainedRestricted'
              AND record."policyApprovalStatus" = 'approved'
              AND record."policyApprovalReference" IS NOT NULL
            )
          )
          AND record."retentionEndsAt" IS NOT NULL
          AND record."retentionEndsAt" <= CURRENT_TIMESTAMP
          AND record."expiryProcessedAt" IS NULL
          AND (record."expiryNextAttemptAt" IS NULL OR record."expiryNextAttemptAt" <= CURRENT_TIMESTAMP)
          AND (record."expiryLeaseExpiresAt" IS NULL OR record."expiryLeaseExpiresAt" <= CURRENT_TIMESTAMP)
          AND (
            record."category" <> 'deletion_audit_evidence'
            OR EXISTS (
              SELECT 1
              FROM "AuditSubjectReferenceBackfillState" backfill
              WHERE backfill."version" = ${AUDIT_SUBJECT_BACKFILL_VERSION}
                AND backfill."completedAt" IS NOT NULL
            )
          )
          AND NOT EXISTS (
            SELECT 1
            FROM "AccountDataRetentionLegalHoldAction" placement
            WHERE placement."retentionRecordId" = record."id"
              AND placement."action" = 'placement'
              AND placement."status" = 'pending'
          )
          AND NOT EXISTS (
            SELECT 1
            FROM "AccountDataRetentionLegalHold" hold
            WHERE hold."retentionRecordId" = record."id"
              AND hold."releasedAt" IS NULL
          )
        ORDER BY record."retentionEndsAt", record."id"
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      ), leased AS (
        UPDATE "AccountDataRetentionRecord" AS record
        SET
          "expiryLeaseToken" = md5(random()::TEXT || clock_timestamp()::TEXT || record."id"),
          "expiryLeaseExpiresAt" = CURRENT_TIMESTAMP + (${RETENTION_LEASE_MS} * INTERVAL '1 millisecond'),
          "updatedAt" = CURRENT_TIMESTAMP
        FROM due
        WHERE record."id" = due."id"
        RETURNING record."id", record."expiryLeaseToken" AS "leaseToken"
      )
      SELECT "id", "leaseToken" FROM leased ORDER BY "id"
    `;
  }

  private async processClaimedRetentionRecord(
    claim: { id: string; leaseToken: string }
  ): Promise<{ category: string; completed: boolean; progressed: boolean } | null> {
    return this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      const candidate = await db.accountDataRetentionRecord.findUnique({
        where: { id: claim.id },
        select: { userId: true }
      });
      if (!candidate) return null;
      await db.$queryRaw`
        SELECT "id" FROM "User" WHERE "id" = ${candidate.userId} FOR UPDATE
      `;
      const locked = await db.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "AccountDataRetentionRecord"
        WHERE "id" = ${claim.id}
          AND "expiryLeaseToken" = ${claim.leaseToken}
          AND "expiryProcessedAt" IS NULL
        FOR UPDATE
      `;
      if (!locked.length) return null;
      const lockedHolds = await db.$queryRaw<Array<{ id: string; releasedAt: Date | null }>>`
        SELECT "id", "releasedAt"
        FROM "AccountDataRetentionLegalHold"
        WHERE "retentionRecordId" = ${claim.id}
        ORDER BY "id"
        FOR UPDATE
      `;
      const lockedActions = await db.$queryRaw<Array<{
        id: string;
        action: string;
        status: string;
      }>>`
        SELECT "id", "action", "status"
        FROM "AccountDataRetentionLegalHoldAction"
        WHERE "retentionRecordId" = ${claim.id}
        ORDER BY "id"
        FOR UPDATE
      `;
      const record = await db.accountDataRetentionRecord.findUnique({ where: { id: claim.id } });
      if (!record || record.userId !== candidate.userId) {
        throw new Error("Retention subject changed while locking ledger");
      }
      const placementPending = lockedActions.some(
        (action: { action: string; status: string }) =>
          action.action === "placement" && action.status === "pending"
      );
      const activeHold = lockedHolds.some(
        (hold: { releasedAt: Date | null }) => hold.releasedAt === null
      );
      if (placementPending || activeHold) {
        await db.accountDataRetentionRecord.update({
          where: { id: record.id },
          data: {
            expiryLeaseToken: null,
            expiryLeaseExpiresAt: null,
            expiryNextAttemptAt: null
          }
        });
        return { category: record.category, completed: false, progressed: false };
      }
      if (record.category === "deletion_audit_evidence") {
        const backfill = await db.auditSubjectReferenceBackfillState.findUnique({
          where: { version: AUDIT_SUBJECT_BACKFILL_VERSION },
          select: { completedAt: true }
        });
        if (!backfill?.completedAt) {
          throw new Error("Audit subject reference backfill is incomplete");
        }
      }
      const details = record.details && typeof record.details === "object"
        ? record.details as Record<string, unknown>
        : {};
      const companionId = typeof details.companionId === "string" && details.companionId
        ? details.companionId
        : null;

      if (record.disposition === "pendingErasure") {
        await this.assertPendingErasureProvenance(db, record, details);
        if (record.category === "preferences_behavior_notifications"
          || record.category === "public_user_content") {
          await this.assertRetentionCompanionLinkage(
            db,
            record.userId,
            companionId,
            `${record.category} bounded cleanup`
          );
          if (companionId) {
            await this.assertRetentionCompanionOwnership(
              db,
              record.userId,
              companionId,
              `${record.category} bounded cleanup`
            );
          }
        }
        const phases = RETENTION_IMMEDIATE_PHASES[record.category];
        if (!phases) throw new Error(`Unsupported account-deletion retention category: ${record.category}`);
        const phase = record.expiryPhase ?? phases[0];
        if (phase === "retention_verify") {
          await this.verifyImmediateCategory(db, record.deletionRequestId, record.userId, record.category, companionId);
          const processedAt = new Date();
          await db.accountDataRetentionRecord.update({
            where: { id: record.id },
            data: {
              disposition: "deleted",
              expiryPhase: "completed",
              expiryProcessedAt: processedAt,
              expiryNextAttemptAt: null,
              expiryLastErrorCode: null,
              expiryLeaseToken: null,
              expiryLeaseExpiresAt: null
            }
          });
          await this.audit.record({
            subjectUserIds: [record.userId],
            action: "privacy.retention_category_deleted",
            resourceType: "accountDataRetentionRecord",
            resourceId: record.id,
            metadata: {
              category: record.category,
              policyVersion: record.policyVersion,
              processedAt: processedAt.toISOString(),
              outcome: "deleted",
              legacyRepair: details.legacyBackfill === true,
              observedErasedRecordCount: record.expiryErasedRecordCount,
              boundedBatchSize: ERASURE_BATCH_SIZE
            }
          }, db);
          return { category: record.category, completed: true, progressed: false };
        }

        const erased = await eraseSubjectPhaseBatch(db, phase, {
          deletionRequestId: record.deletionRequestId,
          userId: record.userId,
          companionId
        });
        const nextPhase = erased.hasMore
          ? phase
          : nextRetentionImmediatePhase(record.category, phase);
        if (!nextPhase) throw new Error("Retention immediate erasure has no verification phase");
        await db.accountDataRetentionRecord.update({
          where: { id: record.id },
          data: {
            expiryPhase: nextPhase,
            expiryCursor: erased.cursor
              ? `${phase}:${erased.cursor}`
              : `${phase}:${record.expiryErasedRecordCount + erased.affectedCount}`,
            expiryErasedRecordCount: record.expiryErasedRecordCount + erased.affectedCount,
            expiryNextAttemptAt: new Date(),
            expiryLeaseToken: null,
            expiryLeaseExpiresAt: null
          }
        });
        return { category: record.category, completed: false, progressed: true };
      }

      const retainedPhases = RETENTION_RESTRICTED_PHASES[record.category];
      if (!retainedPhases) {
        throw new Error(`Unsupported account-deletion retention category: ${record.category}`);
      }
      if (record.category !== "deletion_audit_evidence") {
        await this.assertRetentionCompanionLinkage(
          db,
          record.userId,
          companionId,
          `${record.category} bounded expiry`
        );
        if (companionId) {
          await this.assertRetentionCompanionOwnership(
            db,
            record.userId,
            companionId,
            `${record.category} bounded expiry`
          );
        }
      }
      const retainedPhase = record.expiryPhase ?? retainedPhases[0];
      if (retainedPhase === "retention_verify") {
        await this.verifyRetainedCategory(
          db,
          record.deletionRequestId,
          record.userId,
          record.category,
          companionId
        );
        const processedAt = new Date();
        await db.accountDataRetentionRecord.update({
          where: { id: record.id },
          data: {
            disposition: "pseudonymized",
            expiryPhase: "completed",
            expiryProcessedAt: processedAt,
            expiryNextAttemptAt: null,
            expiryLastErrorCode: null,
            expiryLeaseToken: null,
            expiryLeaseExpiresAt: null
          }
        });
        await this.audit.record({
          subjectUserIds: [record.userId],
          action: "privacy.retention_category_pseudonymized",
          resourceType: "accountDataRetentionRecord",
          resourceId: record.id,
          metadata: {
            category: record.category,
            policyVersion: record.policyVersion,
            processedAt: processedAt.toISOString(),
            outcome: "pseudonymized",
            boundedBatchSize: ERASURE_BATCH_SIZE,
            observedMutatedRecordCount: record.expiryErasedRecordCount
          }
        }, db);
        return { category: record.category, completed: true, progressed: false };
      }
      const mutated = await this.processRetainedPhaseBatch(
        db,
        retainedPhase,
        record.deletionRequestId,
        record.userId,
        companionId
      );
      const retainedIndex = retainedPhases.indexOf(retainedPhase);
      if (retainedIndex < 0) {
        throw new Error(`Unsupported retention expiry phase: ${record.category}/${retainedPhase}`);
      }
      const nextRetainedPhase = mutated.hasMore
        ? retainedPhase
        : retainedPhases[retainedIndex + 1];
      if (!nextRetainedPhase) throw new Error("Retention expiry has no verification phase");
      await db.accountDataRetentionRecord.update({
        where: { id: record.id },
        data: {
          expiryPhase: nextRetainedPhase,
          expiryCursor: mutated.cursor
            ? `${retainedPhase}:${mutated.cursor}`
            : `${retainedPhase}:${record.expiryErasedRecordCount + mutated.affectedCount}`,
          expiryErasedRecordCount: record.expiryErasedRecordCount + mutated.affectedCount,
          expiryNextAttemptAt: new Date(),
          expiryLeaseToken: null,
          expiryLeaseExpiresAt: null
        }
      });
      return { category: record.category, completed: false, progressed: true };
    }, { timeout: 5_000 });
  }

  private async approvePendingRetentionPolicies(): Promise<{
    selectedRetentionPolicyApprovals: number;
    approvedRetentionPolicyRecords: number;
    continuationRequired: boolean;
  }> {
    const approved = this.config.get<boolean>("ACCOUNT_DELETION_RETENTION_POLICY_APPROVED", false) === true;
    const approvalReference = String(
      this.config.get<string>("ACCOUNT_DELETION_RETENTION_POLICY_APPROVAL_REFERENCE", "") ?? ""
    ).trim();
    if (!approved || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{5,159}$/.test(approvalReference)) {
      return {
        selectedRetentionPolicyApprovals: 0,
        approvedRetentionPolicyRecords: 0,
        continuationRequired: false
      };
    }

    let selectedRetentionPolicyApprovals = 0;
    let approvedRetentionPolicyRecords = 0;
    for (let batch = 0; batch < RETENTION_POLICY_APPROVAL_MAX_BATCHES_PER_RUN; batch += 1) {
      const promoted = await this.prisma.$transaction(async (tx) => {
        const db = tx as any;
        const rows = await db.$queryRaw<Array<{ id: string; userId: string }>>`
          WITH candidates AS MATERIALIZED (
            SELECT record."id"
            FROM "AccountDataRetentionRecord" AS record
            WHERE record."policyVersion" = ${ACCOUNT_DELETION_RETENTION_POLICY_VERSION}
              AND record."policyApprovalStatus" = 'pendingLegalApproval'
            ORDER BY record."id"
            FOR UPDATE SKIP LOCKED
            LIMIT ${RETENTION_POLICY_APPROVAL_BATCH_SIZE}
          )
          UPDATE "AccountDataRetentionRecord" AS record
          SET
            "policyApprovalStatus" = 'approved',
            "policyApprovalReference" = ${approvalReference},
            "updatedAt" = CURRENT_TIMESTAMP
          FROM candidates
          WHERE record."id" = candidates."id"
          RETURNING record."id", record."userId"
        `;
        for (const row of rows) {
          await this.audit.record({
            subjectUserIds: [row.userId],
            action: "privacy.retention_policy_approval_applied",
            resourceType: "accountDataRetentionRecord",
            resourceId: row.id,
            metadata: {
              policyVersion: ACCOUNT_DELETION_RETENTION_POLICY_VERSION,
              approvalReference
            }
          }, db);
        }
        return rows;
      });
      selectedRetentionPolicyApprovals += promoted.length;
      approvedRetentionPolicyRecords += promoted.length;
      if (promoted.length < RETENTION_POLICY_APPROVAL_BATCH_SIZE) break;
    }
    const continuationRequired = selectedRetentionPolicyApprovals
      >= RETENTION_POLICY_APPROVAL_BATCH_SIZE * RETENTION_POLICY_APPROVAL_MAX_BATCHES_PER_RUN;
    return {
      selectedRetentionPolicyApprovals,
      approvedRetentionPolicyRecords,
      continuationRequired
    };
  }

  private async recordExpiryFailure(recordId: string, leaseToken: string, error: unknown) {
    const errorCode = this.retentionErrorCode(error);
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "AccountDataRetentionRecord"
        WHERE "id" = ${recordId}
          AND "disposition" IN ('pendingErasure', 'retainedRestricted')
          AND "expiryProcessedAt" IS NULL
          AND "expiryLeaseToken" = ${leaseToken}
        FOR UPDATE
      `;
      if (!locked.length) return null;
      const record = await tx.accountDataRetentionRecord.findUnique({ where: { id: recordId } });
      if (!record) return null;
      const attempt = record.expiryAttemptCount + 1;
      const retryDelayMs = Math.min(24 * 60 * 60_000, 5 * 60_000 * (2 ** Math.min(attempt - 1, 8)));
      const nextAttemptAt = new Date(Date.now() + retryDelayMs);
      await tx.accountDataRetentionRecord.update({
        where: { id: record.id },
        data: {
          expiryAttemptCount: attempt,
          expiryNextAttemptAt: nextAttemptAt,
          expiryLastErrorCode: errorCode,
          expiryLeaseToken: null,
          expiryLeaseExpiresAt: null
        }
      });
      await this.audit.record({
        subjectUserIds: [record.userId],
        action: "privacy.retention_category_failed",
        resourceType: "accountDataRetentionRecord",
        resourceId: record.id,
        metadata: {
          category: record.category,
          policyVersion: record.policyVersion,
          attempt,
          nextAttemptAt: nextAttemptAt.toISOString(),
          errorCode
        }
      }, tx);
      return { category: record.category, errorCode, nextAttemptAt };
    });
  }

  private retentionErrorCode(error: unknown): string {
    if (!(error instanceof Error)) return "retention_unknown_error";
    const known = [
      "Transaction retention postcondition failed",
      "Safety retention postcondition failed",
      "Governance retention postcondition failed",
      "Deletion-audit retention postcondition failed",
      "Identity deletion postcondition failed",
      "Preferences deletion postcondition failed",
      "Public-content deletion postcondition failed",
      "Unsupported account-deletion retention category",
      "Retention companion subject is missing",
      "Retention companion ownership changed",
      "Retention companion linkage changed",
      "Retention subject changed while locking ledger",
      "Pending erasure provenance is invalid"
    ].find((prefix) => error.message.startsWith(prefix));
    if (!known) return `retention_${error.name.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`.slice(0, 80);
    return `retention_${known.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`.slice(0, 80);
  }

  private async assertPendingErasureProvenance(
    tx: any,
    record: {
      id: string;
      deletionRequestId: string;
      userId: string;
      category: string;
      policyVersion: string;
    },
    details: Record<string, unknown>
  ): Promise<void> {
    const expectedId = `legacy-retention-${createHash("md5")
      .update(`${record.deletionRequestId}:${record.category}`)
      .digest("hex")}`;
    const immediateCategories = new Set([
      "identity_authentication_profile",
      "preferences_behavior_notifications",
      "public_user_content"
    ]);
    const request = await tx.accountDeletionRequest.findUnique({
      where: { id: record.deletionRequestId },
      select: { userId: true, status: true }
    });
    if (record.id !== expectedId
      || details.legacyBackfill !== true
      || record.policyVersion !== ACCOUNT_DELETION_RETENTION_POLICY_VERSION
      || !immediateCategories.has(record.category)
      || !request
      || request.userId !== record.userId
      || request.status !== "completed") {
      throw new Error("Pending erasure provenance is invalid");
    }
  }

  private async verifyImmediateCategory(
    tx: any,
    deletionRequestId: string,
    userId: string,
    category: string,
    companionId: string | null
  ): Promise<void> {
    if (category === "identity_authentication_profile") {
      const remaining = await Promise.all([
        tx.refreshToken.count({ where: { userId } }),
        tx.authIdentity.count({ where: { userId } }),
        tx.staffCredential.count({ where: { userId } }),
        tx.userProfile.count({ where: { userId } }),
        tx.customerAdultEligibility.count({ where: { userId, status: "pending" } })
      ]);
      if (remaining.some((value: number) => value > 0)) {
        throw new Error("Identity deletion postcondition failed");
      }
      return;
    }
    if (category === "preferences_behavior_notifications") {
      const remaining = await Promise.all([
        tx.notificationDelivery.count({ where: { userId } }),
        tx.notification.count({ where: { userId } }),
        tx.weChatSubscriptionGrant.count({ where: { userId } }),
        tx.recommendationRequest.count({ where: { userId } }),
        tx.userRecommendationTag.count({ where: { userId } }),
        tx.userRecommendationPreference.count({ where: { userId } }),
        tx.userCompanionRecommendationExclusion.count({ where: { userId } }),
        tx.companionFavorite.count({ where: { userId } }),
        tx.companionRecentView.count({ where: { userId } }),
        tx.messageReadState.count({ where: { userId } }),
        tx.conversationNotificationPreference.count({ where: { userId } }),
        tx.conversationBlock.count({ where: { blockedByUserId: userId } }),
        ...(companionId ? [
          tx.availabilityReminderCandidate.count({ where: { companionId } }),
          tx.availabilityReminderFanoutJob.count({ where: { companionId } }),
          tx.companionAvailabilityWindow.count({
            where: { companionId, OR: [{ isActive: true }, { orders: { none: {} } }] }
          }),
          tx.companionRecurringAvailabilityRule.count({ where: { companionId } }),
          tx.companionAvailabilityBlackout.count({ where: { companionId } }),
          tx.companionRecommendationPolicy.count({ where: { companionId } })
        ] : [])
      ]);
      if (remaining.some((value: number) => value > 0)) {
        throw new Error("Preferences deletion postcondition failed");
      }
      return;
    }
    if (category === "public_user_content") {
      const remaining = await Promise.all([
        tx.communityLike.count({ where: { userId } }),
        tx.communityPostReport.count({ where: { reporterUserId: userId } }),
        tx.communityPost.count({ where: { authorId: userId } }),
        tx.review.count({ where: { userId } }),
        tx.accountDeletionRatingRefreshJob.count({
          where: { deletionRequestId, completedAt: null }
        }),
        ...(companionId ? [
          tx.companionProfile.count({
            where: {
              id: companionId,
              OR: [
                { isPublished: true },
                { isOnline: true },
                { isVerified: true },
                { voiceIntroAssetRef: { not: null } },
                { name: { not: "已注销陪伴者" } }
              ]
            }
          }),
          tx.companionServiceOffering.count({ where: { companionId } }),
          tx.companionServiceTag.count({ where: { companionId } })
        ] : [])
      ]);
      if (remaining.some((value: number) => value > 0)) {
        throw new Error("Public-content deletion postcondition failed");
      }
      return;
    }
    throw new Error(`Unsupported account-deletion retention category: ${category}`);
  }

  private async processRetainedPhaseBatch(
    tx: any,
    phase: string,
    deletionRequestId: string,
    userId: string,
    companionId: string | null
  ): Promise<RetentionPhaseBatchResult> {
    const graphResult = await this.processRestrictedGraphPhaseBatch(
      tx,
      phase,
      userId,
      companionId
    );
    if (graphResult) return graphResult;
    const del = (
      table: string,
      predicate: string,
      parameters: unknown[]
    ) => deleteBoundedRows(tx, table, predicate, parameters, ERASURE_BATCH_SIZE);
    const update = (
      table: string,
      predicate: string,
      parameters: unknown[],
      assignments: string
    ) => updateBoundedRows(tx, table, predicate, parameters, assignments, ERASURE_BATCH_SIZE);
    const empty = { affectedCount: 0, hasMore: false, cursor: null };

    if (phase === "invoice_request") {
      return update(
        "InvoiceRequest",
        `target."userId" = $1 AND (
          target."invoiceTitle" IS DISTINCT FROM '已注销账号'
          OR target."statusReason" IS NOT NULL
          OR target."issuanceEvidenceReference" IS NOT NULL
          OR target."voidEvidenceReference" IS NOT NULL
        )`,
        [userId],
        `"invoiceTitle" = '已注销账号', "statusReason" = NULL,
         "issuanceEvidenceReference" = NULL, "voidEvidenceReference" = NULL,
         "updatedAt" = CURRENT_TIMESTAMP`
      );
    }
    if (phase === "customer_order") {
      return update(
        "Order",
        `target."userId" = $1 AND (
          target."clientRequestId" IS NOT NULL
          OR target."serviceIntentSnapshot" IS NOT NULL
          OR target."themeNameSnapshot" IS DISTINCT FROM '已匿名化服务记录'
        )`,
        [userId],
        `"clientRequestId" = NULL, "themeNameSnapshot" = '已匿名化服务记录',
         "serviceIntentSnapshot" = NULL, "updatedAt" = CURRENT_TIMESTAMP`
      );
    }
    if (phase === "companion_order") {
      if (!companionId) return empty;
      return update(
        "Order",
        `target."companionId" = $1 AND (
          target."companionNameSnapshot" IS DISTINCT FROM '已匿名化陪伴者'
          OR target."companionRoleSnapshot" IS DISTINCT FROM '已匿名化服务方'
          OR target."companionInitialsSnapshot" IS DISTINCT FROM '—'
          OR target."settlementRecipientRefSnapshot" IS NOT NULL
          OR target."settlementRecipientMaskedSnapshot" IS NOT NULL
          OR target."taxProfileRefSnapshot" IS NOT NULL
          OR target."identityEvidenceRefSnapshot" IS NOT NULL
          OR target."adultEligibilityVerdictSnapshot" IS NOT NULL
          OR target."adultEligibilityVerifiedAtSnapshot" IS NOT NULL
          OR target."adultEligibilityValidUntilSnapshot" IS NOT NULL
          OR target."serviceAgreementVersionSnapshot" IS NOT NULL
          OR target."serviceAgreementEvidenceRefSnapshot" IS NOT NULL
          OR target."availabilityWindowId" IS NOT NULL
        )`,
        [companionId],
        `"companionNameSnapshot" = '已匿名化陪伴者',
         "companionRoleSnapshot" = '已匿名化服务方',
         "companionInitialsSnapshot" = '—',
         "settlementRecipientRefSnapshot" = NULL,
         "settlementRecipientMaskedSnapshot" = NULL,
         "taxProfileRefSnapshot" = NULL,
         "identityEvidenceRefSnapshot" = NULL,
         "adultEligibilityVerdictSnapshot" = NULL,
         "adultEligibilityVerifiedAtSnapshot" = NULL,
         "adultEligibilityValidUntilSnapshot" = NULL,
         "serviceAgreementVersionSnapshot" = NULL,
         "serviceAgreementEvidenceRefSnapshot" = NULL,
         "availabilityWindowId" = NULL,
         "updatedAt" = CURRENT_TIMESTAMP`
      );
    }
    if (phase === "companion_earning") {
      if (!companionId) return empty;
      return update(
        "CompanionEarning",
        `target."companionId" = $1 AND (
          target."settlementRecipientRefSnapshot" IS NOT NULL
          OR target."settlementRecipientMaskedSnapshot" IS NOT NULL
          OR target."taxProfileRefSnapshot" IS NOT NULL
          OR target."identityEvidenceRefSnapshot" IS NOT NULL
          OR target."serviceAgreementVersionSnapshot" IS NOT NULL
          OR target."serviceAgreementEvidenceRefSnapshot" IS NOT NULL
          OR target."paidReference" IS NOT NULL
          OR target."paidRecipientRef" IS NOT NULL
          OR target."payoutEvidenceDigest" IS NOT NULL
        )`,
        [companionId],
        `"settlementRecipientRefSnapshot" = NULL,
         "settlementRecipientMaskedSnapshot" = NULL,
         "taxProfileRefSnapshot" = NULL,
         "identityEvidenceRefSnapshot" = NULL,
         "serviceAgreementVersionSnapshot" = NULL,
         "serviceAgreementEvidenceRefSnapshot" = NULL,
         "paidReference" = NULL,
         "paidRecipientRef" = NULL,
         "payoutEvidenceDigest" = NULL,
         "updatedAt" = CURRENT_TIMESTAMP`
      );
    }
    if (phase === "companion_withdrawal") {
      if (!companionId) return empty;
      return update(
        "CompanionWithdrawalRequest",
        `target."companionId" = $1 AND (
          target."settlementRecipientMasked" IS DISTINCT FROM '已匿名化'
          OR target."payoutReferenceMasked" IS NOT NULL
          OR target."rejectionReason" IS NOT NULL
        )`,
        [companionId],
        `"settlementRecipientMasked" = '已匿名化',
         "payoutReferenceMasked" = NULL, "rejectionReason" = NULL,
         "updatedAt" = CURRENT_TIMESTAMP`
      );
    }
    if (phase === "companion_recovery") {
      if (!companionId) return empty;
      return update(
        "CompanionRecovery",
        'target."companionId" = $1 AND target."evidenceReference" IS NOT NULL',
        [companionId],
        '"evidenceReference" = NULL, "updatedAt" = CURRENT_TIMESTAMP'
      );
    }
    if (phase === "companion_commercial") {
      if (!companionId) return empty;
      return update(
        "CompanionCommercialProfile",
        `target."companionId" = $1 AND (
          target."settlementRecipientRef" IS DISTINCT FROM 'retention-expired:' || $1 || ':settlement'
          OR target."settlementRecipientMasked" IS DISTINCT FROM '已匿名化'
          OR target."taxProfileRef" IS DISTINCT FROM 'retention-expired:' || $1 || ':tax'
          OR target."identityEvidenceRef" IS DISTINCT FROM 'retention-expired:' || $1 || ':identity'
          OR target."adultEligibilityVerdict" IS DISTINCT FROM 'pending'
          OR target."adultEligibilityVerifiedAt" IS NOT NULL
          OR target."adultEligibilityValidUntil" IS NOT NULL
          OR target."adultEligibilityEvidenceRef" IS NOT NULL
          OR target."serviceAgreementEvidenceRef" IS DISTINCT FROM 'retention-expired:' || $1 || ':agreement'
        )`,
        [companionId],
        `"settlementRecipientRef" = 'retention-expired:' || $1 || ':settlement',
         "settlementRecipientMasked" = '已匿名化',
         "taxProfileRef" = 'retention-expired:' || $1 || ':tax',
         "identityEvidenceRef" = 'retention-expired:' || $1 || ':identity',
         "adultEligibilityVerdict" = 'pending',
         "adultEligibilityVerifiedAt" = NULL,
         "adultEligibilityValidUntil" = NULL,
         "adultEligibilityEvidenceRef" = NULL,
         "serviceAgreementEvidenceRef" = 'retention-expired:' || $1 || ':agreement',
         "updatedAt" = CURRENT_TIMESTAMP`
      );
    }
    if (phase === "transaction_availability_window") {
      return companionId
        ? del("CompanionAvailabilityWindow", 'target."companionId" = $1', [companionId])
        : empty;
    }

    if (phase === "order_support_fact") {
      // Drain every child row of the subject's tickets before deleting the
      // parent. A ticket may contain facts submitted by staff or a companion;
      // relying on ON DELETE CASCADE would otherwise turn the next phase into
      // an unbounded transaction.
      return del(
        "OrderSupportFact",
        `target."submittedByUserId" = $1 OR EXISTS (
          SELECT 1 FROM "SupportTicket" ticket
          WHERE ticket."id" = target."supportTicketId" AND ticket."userId" = $1
        )`,
        [userId]
      );
    }
    if (phase === "attendance_statement") {
      return del("AttendanceDisputeStatement", 'target."submittedByUserId" = $1', [userId]);
    }
    if (phase === "voice_attendance_event") {
      return update(
        "VoiceAttendanceEvent",
        'target."participantUserId" = $1',
        [userId],
        `"participantUserId" = NULL, "providerUniqueId" = NULL,
         "clientEventId" = NULL, "clientClaimedAt" = NULL`
      );
    }
    if (phase === "support_ticket") {
      return del("SupportTicket", 'target."userId" = $1', [userId]);
    }
    if (phase === "payment_dispute_reply") {
      return del("PaymentDisputeReply", 'target."actorId" = $1', [userId]);
    }
    if (phase === "moderation_appeal") {
      return del("ModerationAppeal", 'target."subjectUserId" = $1', [userId]);
    }
    if (phase === "moderation_case") {
      return update(
        "ModerationCase",
        'target."subjectUserId" = $1 OR target."reporterUserId" = $1',
        [userId],
        `"title" = '已匿名化安全记录',
         "content" = '[留存期届满，内容已匿名化]',
         "aiReason" = 'retention_expired', "matchedRules" = ARRAY[]::TEXT[],
         "provider" = NULL, "providerVersion" = NULL, "targetId" = NULL,
         "subjectUserId" = NULL, "reporterUserId" = NULL,
         "updatedAt" = CURRENT_TIMESTAMP`
      );
    }
    if (phase === "chat_restriction") {
      return del("ChatRestriction", 'target."userId" = $1', [userId]);
    }
    if (phase === "crisis_intervention") {
      return del("CrisisIntervention", 'target."userId" = $1', [userId]);
    }
    if (phase === "moderation_action_log") {
      return update(
        "ModerationActionLog",
        'target."actorId" = $1',
        [userId],
        '"actorId" = NULL, "note" = NULL'
      );
    }
    if (phase === "companion_incident") {
      return companionId
        ? del("CompanionIncidentReport", 'target."companionId" = $1', [companionId])
        : empty;
    }
    if (phase === "message") {
      return update(
        "Message",
        'target."senderId" = $1',
        [userId],
        `"senderId" = 'retention-expired:' || $1,
         "content" = '[留存期届满，内容已匿名化]', "senderName" = NULL`
      );
    }
    if (phase === "media_asset") {
      return del("MediaAsset", 'target."uploaderId" = $1', [userId]);
    }

    if (phase === "data_rights_follow_up") {
      return del(
        "DataRightsRequestFollowUp",
        `EXISTS (
          SELECT 1 FROM "DataRightsRequest" request
          WHERE request."id" = target."requestId" AND request."userId" = $1
        )`,
        [userId]
      );
    }
    if (phase === "data_rights_request") {
      return del("DataRightsRequest", 'target."userId" = $1', [userId]);
    }
    if (phase === "legal_consent") {
      return del("LegalConsentReceipt", 'target."userId" = $1', [userId]);
    }
    if (phase === "identity_verification") {
      return del("IdentityVerificationRequest", 'target."userId" = $1', [userId]);
    }
    if (phase === "customer_adult_eligibility") {
      return del("CustomerAdultEligibility", 'target."userId" = $1', [userId]);
    }
    if (phase === "user_account_appeal") {
      return del("UserAccountAppeal", 'target."userId" = $1', [userId]);
    }
    if (phase === "user_account_action") {
      return del("UserAccountAction", 'target."userId" = $1', [userId]);
    }
    if (phase === "companion_training") {
      return companionId
        ? del("CompanionTrainingRecord", 'target."companionId" = $1', [companionId])
        : empty;
    }
    if (phase === "companion_account_appeal") {
      return companionId
        ? del("CompanionAccountAppeal", 'target."companionId" = $1', [companionId])
        : empty;
    }
    if (phase === "companion_account_action") {
      return companionId
        ? del("CompanionAccountAction", 'target."companionId" = $1', [companionId])
        : empty;
    }

    if (phase === "auth_identity_tombstone") {
      return del(
        "AuthIdentityTombstone",
        `target."deletionRequestId" = $1
         AND target."expiresAt" IS NOT NULL
         AND target."expiresAt" <= CURRENT_TIMESTAMP`,
        [deletionRequestId]
      );
    }
    if (phase === "deletion_request_note") {
      return update(
        "AccountDeletionRequest",
        `target."userId" = $1 AND target."status" = 'completed'
         AND target."note" IS DISTINCT FROM 'Retention period completed; subject details anonymized'`,
        [userId],
        `"note" = 'Retention period completed; subject details anonymized',
         "updatedAt" = CURRENT_TIMESTAMP`
      );
    }
    if (phase === "rating_refresh_job") {
      return del(
        "AccountDeletionRatingRefreshJob",
        `EXISTS (
          SELECT 1 FROM "AccountDeletionRequest" request
          WHERE request."id" = target."deletionRequestId" AND request."userId" = $1
        )`,
        [userId]
      );
    }
    if (phase === "audit_subject_reference") {
      return update(
        "AuditLog",
        'target."actorId" = $1 OR target."resourceId" = $1',
        [userId],
        '"actorId" = NULL, "resourceId" = NULL, "metadata" = \'{"retentionExpired":true}\'::JSONB'
      );
    }
    if (phase === "audit_deletion_request_reference") {
      return update(
        "AuditLog",
        `target."resourceType" = 'accountDeletionRequest' AND EXISTS (
          SELECT 1 FROM "AccountDeletionRequest" request
          WHERE request."id" = target."resourceId" AND request."userId" = $1
        )`,
        [userId],
        '"actorId" = NULL, "resourceId" = NULL, "metadata" = \'{"retentionExpired":true}\'::JSONB'
      );
    }

    if (phase === "companion_detach") {
      if (!companionId) return empty;
      // Strictly one profile row: this is the only subject-scoped retained
      // mutation that is constant by schema uniqueness rather than LIMIT 250.
      const affected = await tx.$executeRaw`
        UPDATE "CompanionProfile"
        SET "ownerUserId" = NULL
        WHERE "id" = ${companionId}
          AND ("ownerUserId" = ${userId} OR "ownerUserId" IS NULL)
      `;
      return { affectedCount: Number(affected), hasMore: false, cursor: companionId };
    }

    throw new Error(`Unsupported retention expiry phase: ${deletionRequestId}/${phase}`);
  }

  /**
   * Full restricted-retention graph expiry. Each invocation mutates at most
   * one bounded collection of 250 rows. Shared bilateral records are retained
   * as skeletons; only fields authored by, uploaded by, or directly identifying
   * the deleted subject are removed.
   */
  private async processRestrictedGraphPhaseBatch(
    tx: any,
    phase: string,
    userId: string,
    companionId: string | null
  ): Promise<RetentionPhaseBatchResult | null> {
    const del = (
      table: string,
      predicate: string,
      parameters: unknown[]
    ) => deleteBoundedRows(tx, table, predicate, parameters, ERASURE_BATCH_SIZE);
    const update = (
      table: string,
      predicate: string,
      parameters: unknown[],
      assignments: string
    ) => updateBoundedRows(tx, table, predicate, parameters, assignments, ERASURE_BATCH_SIZE);
    const empty: RetentionPhaseBatchResult = {
      affectedCount: 0,
      hasMore: false,
      cursor: null
    };
    const partyParameters = [userId, companionId];

    if (phase === "invoice_request") {
      return update(
        "InvoiceRequest",
        `target."userId" = $1 AND (
          target."invoiceTitle" IS DISTINCT FROM '已注销账号'
          OR target."statusReason" IS NOT NULL
          OR target."issuanceEvidenceReference" IS NOT NULL
          OR target."voidEvidenceReference" IS NOT NULL
        )`,
        [userId],
        `"invoiceTitle" = '已注销账号', "statusReason" = NULL,
         "issuanceEvidenceReference" = NULL, "voidEvidenceReference" = NULL,
         "updatedAt" = CURRENT_TIMESTAMP`
      );
    }
    if (phase === "customer_order") {
      return update(
        "Order",
        `target."userId" = $1 AND (
          target."clientRequestId" IS NOT NULL
          OR target."serviceIntentSnapshot" IS NOT NULL
          OR target."themeNameSnapshot" IS DISTINCT FROM '已匿名化服务记录'
        )`,
        [userId],
        `"clientRequestId" = NULL,
         "themeNameSnapshot" = '已匿名化服务记录',
         "serviceIntentSnapshot" = NULL,
         "updatedAt" = CURRENT_TIMESTAMP`
      );
    }
    if (phase === "companion_order") {
      if (!companionId) return empty;
      return update(
        "Order",
        `target."companionId" = $1 AND (
          target."companionNameSnapshot" IS DISTINCT FROM '已匿名化陪伴者'
          OR target."companionRoleSnapshot" IS DISTINCT FROM '已匿名化服务方'
          OR target."companionInitialsSnapshot" IS DISTINCT FROM '—'
          OR target."settlementRecipientRefSnapshot" IS NOT NULL
          OR target."settlementRecipientMaskedSnapshot" IS NOT NULL
          OR target."taxProfileRefSnapshot" IS NOT NULL
          OR target."identityEvidenceRefSnapshot" IS NOT NULL
          OR target."adultEligibilityVerdictSnapshot" IS NOT NULL
          OR target."adultEligibilityVerifiedAtSnapshot" IS NOT NULL
          OR target."adultEligibilityValidUntilSnapshot" IS NOT NULL
          OR target."serviceAgreementVersionSnapshot" IS NOT NULL
          OR target."serviceAgreementEvidenceRefSnapshot" IS NOT NULL
          OR target."availabilityWindowId" IS NOT NULL
        )`,
        [companionId],
        `"companionNameSnapshot" = '已匿名化陪伴者',
         "companionRoleSnapshot" = '已匿名化服务方',
         "companionInitialsSnapshot" = '—',
         "settlementRecipientRefSnapshot" = NULL,
         "settlementRecipientMaskedSnapshot" = NULL,
         "taxProfileRefSnapshot" = NULL,
         "identityEvidenceRefSnapshot" = NULL,
         "adultEligibilityVerdictSnapshot" = NULL,
         "adultEligibilityVerifiedAtSnapshot" = NULL,
         "adultEligibilityValidUntilSnapshot" = NULL,
         "serviceAgreementVersionSnapshot" = NULL,
         "serviceAgreementEvidenceRefSnapshot" = NULL,
         "availabilityWindowId" = NULL,
         "updatedAt" = CURRENT_TIMESTAMP`
      );
    }
    if (phase === "wechat_reconciliation_resolution") {
      return update(
        "WeChatReconciliationResolutionProposal",
        `EXISTS (
          SELECT 1 FROM "WeChatReconciliationIssue" issue
          WHERE issue."id" = target."issueId"
            AND ${partyReconciliationIssuePredicate("issue")}
        ) AND (
          target."resolutionNote" IS DISTINCT FROM '[留存期届满，说明已匿名化]'
          OR target."evidenceReference" IS NOT NULL
          OR target."reviewNote" IS NOT NULL
        )`,
        partyParameters,
        `"resolutionNote" = '[留存期届满，说明已匿名化]',
         "evidenceReference" = 'retention-expired:' || target."id",
         "reviewNote" = NULL`
      );
    }
    if (phase === "wechat_reconciliation_issue") {
      return update(
        "WeChatReconciliationIssue",
        `${partyReconciliationIssuePredicate("target")} AND (
          target."providerReference" IS NOT NULL
          OR target."localResourceId" IS NOT NULL
          OR target."resolutionNote" IS NOT NULL
        )`,
        partyParameters,
        `"providerReference" = NULL,
         "localResourceId" = NULL,
         "resolutionNote" = NULL,
         "updatedAt" = CURRENT_TIMESTAMP`
      );
    }
    if (phase === "cash_ledger_classification") {
      return update(
        "CashLedgerClassificationProposal",
        `EXISTS (
          SELECT 1 FROM "CashLedgerEntry" cash_entry
          WHERE cash_entry."id" = target."cashLedgerEntryId"
            AND ${partyCashEntryPredicate("cash_entry")}
        ) AND (
          target."evidenceReference" IS DISTINCT FROM 'retention-expired:' || target."id"
          OR target."reviewNote" IS NOT NULL
        )`,
        partyParameters,
        `"evidenceReference" = 'retention-expired:' || target."id",
         "reviewNote" = NULL`
      );
    }
    if (phase === "cash_ledger_entry") {
      return update(
        "CashLedgerEntry",
        `${partyCashEntryPredicate("target")} AND (
          target."providerReference" IS DISTINCT FROM 'retention-expired:' || target."id"
          OR target."sourceResourceId" IS DISTINCT FROM 'retention-expired:' || target."id"
          OR target."evidenceReference" IS DISTINCT FROM 'retention-expired:' || target."id"
        )`,
        partyParameters,
        `"providerReference" = 'retention-expired:' || target."id",
         "sourceResourceId" = 'retention-expired:' || target."id",
         "evidenceReference" = 'retention-expired:' || target."id"`
      );
    }
    if (phase === "wechat_bill_import_proposal" || phase === "wechat_bill_run") {
      // A proposal/run can contain rows for many unrelated customers. Its
      // digest and workflow facts contain no customer identity, so it remains
      // unchanged while the exact subject-linked child rows are anonymized.
      return empty;
    }
    if (phase === "wechat_bill_import_entry") {
      return update(
        "WeChatBillImportEntry",
        `${partyBillEntryPredicate("target")} AND (
          target."outTradeNo" IS NOT NULL OR target."transactionId" IS NOT NULL
          OR target."outRefundNo" IS NOT NULL OR target."providerRefundId" IS NOT NULL
          OR target."businessReference" IS NOT NULL OR target."businessName" IS NOT NULL
        )`,
        partyParameters,
        `"outTradeNo" = NULL, "transactionId" = NULL,
         "outRefundNo" = NULL, "providerRefundId" = NULL,
         "businessReference" = NULL, "businessName" = NULL`
      );
    }
    if (phase === "wechat_bill_entry") {
      return update(
        "WeChatBillEntry",
        `${partyBillEntryPredicate("target")} AND (
          target."outTradeNo" IS NOT NULL OR target."transactionId" IS NOT NULL
          OR target."outRefundNo" IS NOT NULL OR target."providerRefundId" IS NOT NULL
          OR target."businessReference" IS NOT NULL OR target."businessName" IS NOT NULL
        )`,
        partyParameters,
        `"outTradeNo" = NULL, "transactionId" = NULL,
         "outRefundNo" = NULL, "providerRefundId" = NULL,
         "businessReference" = NULL, "businessName" = NULL`
      );
    }
    if (phase === "payment_dispute_order_financial") {
      return update(
        "PaymentDisputeOrder",
        `${directPartyDisputeOrderPredicate("target")} AND (
          target."orderId" IS NOT NULL OR target."paymentId" IS NOT NULL
          OR target."transactionId" IS NOT NULL
          OR target."outTradeNo" IS DISTINCT FROM 'retention-expired:' || target."id"
        )`,
        partyParameters,
        `"orderId" = NULL, "paymentId" = NULL, "transactionId" = NULL,
         "outTradeNo" = 'retention-expired:' || target."id"`
      );
    }
    if (phase === "payment_transaction") {
      return update(
        "PaymentTransaction",
        `${partyOrderExists('target."orderId"')} AND (
          target."prepayId" IS NOT NULL OR target."clientParams" IS NOT NULL
          OR target."notifyPayload" IS NOT NULL OR target."transactionId" IS NOT NULL
          OR target."outTradeNo" IS DISTINCT FROM 'retention-expired:' || target."id"
        )`,
        partyParameters,
        `"prepayId" = NULL, "clientParams" = NULL, "notifyPayload" = NULL,
         "transactionId" = NULL,
         "outTradeNo" = 'retention-expired:' || target."id",
         "updatedAt" = CURRENT_TIMESTAMP`
      );
    }
    if (phase === "refund_transaction") {
      return update(
        "RefundTransaction",
        `${partyOrderExists('target."orderId"')} AND (
          target."outRefundNo" IS DISTINCT FROM 'retention-expired:' || target."id"
          OR target."providerRefundId" IS NOT NULL OR target."reason" IS NOT NULL
          OR target."reviewNote" IS NOT NULL OR target."failureReason" IS NOT NULL
          OR target."initiatedById" = $1 OR target."reviewedById" = $1
        )`,
        partyParameters,
        `"outRefundNo" = 'retention-expired:' || target."id",
         "providerRefundId" = NULL, "reason" = NULL,
         "reviewNote" = NULL, "failureReason" = NULL,
         "initiatedById" = CASE WHEN target."initiatedById" = $1 THEN NULL ELSE target."initiatedById" END,
         "reviewedById" = CASE WHEN target."reviewedById" = $1 THEN NULL ELSE target."reviewedById" END,
         "updatedAt" = CURRENT_TIMESTAMP`
      );
    }
    if (phase === "companion_earning") {
      if (!companionId) return empty;
      return update(
        "CompanionEarning",
        `target."companionId" = $1 AND (
          target."settlementRecipientRefSnapshot" IS NOT NULL
          OR target."settlementRecipientMaskedSnapshot" IS NOT NULL
          OR target."taxProfileRefSnapshot" IS NOT NULL
          OR target."identityEvidenceRefSnapshot" IS NOT NULL
          OR target."serviceAgreementVersionSnapshot" IS NOT NULL
          OR target."serviceAgreementEvidenceRefSnapshot" IS NOT NULL
          OR target."paidReference" IS NOT NULL
          OR target."paidRecipientRef" IS NOT NULL
          OR target."payoutEvidenceDigest" IS NOT NULL
        )`,
        [companionId],
        `"settlementRecipientRefSnapshot" = NULL,
         "settlementRecipientMaskedSnapshot" = NULL,
         "taxProfileRefSnapshot" = NULL,
         "identityEvidenceRefSnapshot" = NULL,
         "serviceAgreementVersionSnapshot" = NULL,
         "serviceAgreementEvidenceRefSnapshot" = NULL,
         "paidReference" = NULL, "paidRecipientRef" = NULL,
         "payoutEvidenceDigest" = NULL, "updatedAt" = CURRENT_TIMESTAMP`
      );
    }
    if (phase === "companion_withdrawal") {
      if (!companionId) return empty;
      return update(
        "CompanionWithdrawalRequest",
        `target."companionId" = $1 AND (
          target."settlementRecipientMasked" IS DISTINCT FROM '已匿名化'
          OR target."payoutReferenceMasked" IS NOT NULL
          OR target."rejectionReason" IS NOT NULL
        )`,
        [companionId],
        `"settlementRecipientMasked" = '已匿名化',
         "payoutReferenceMasked" = NULL, "rejectionReason" = NULL,
         "updatedAt" = CURRENT_TIMESTAMP`
      );
    }
    if (phase === "companion_recovery") {
      if (!companionId) return empty;
      return update(
        "CompanionRecovery",
        `target."companionId" = $1 AND (
          target."evidenceReference" IS NOT NULL OR target."evidenceSubmittedById" = $2
        )`,
        [companionId, userId],
        `"evidenceReference" = NULL,
         "evidenceSubmittedById" = CASE WHEN target."evidenceSubmittedById" = $2
           THEN NULL ELSE target."evidenceSubmittedById" END,
         "updatedAt" = CURRENT_TIMESTAMP`
      );
    }
    if (phase === "companion_commercial") {
      if (!companionId) return empty;
      return update(
        "CompanionCommercialProfile",
        `target."companionId" = $1 AND (
          target."settlementRecipientRef" IS DISTINCT FROM 'retention-expired:' || $1 || ':settlement'
          OR target."settlementRecipientMasked" IS DISTINCT FROM '已匿名化'
          OR target."taxProfileRef" IS DISTINCT FROM 'retention-expired:' || $1 || ':tax'
          OR target."identityEvidenceRef" IS DISTINCT FROM 'retention-expired:' || $1 || ':identity'
          OR target."adultEligibilityVerdict" IS DISTINCT FROM 'pending'
          OR target."adultEligibilityVerifiedAt" IS NOT NULL
          OR target."adultEligibilityValidUntil" IS NOT NULL
          OR target."adultEligibilityEvidenceRef" IS NOT NULL
          OR target."serviceAgreementEvidenceRef" IS DISTINCT FROM 'retention-expired:' || $1 || ':agreement'
        )`,
        [companionId],
        `"settlementRecipientRef" = 'retention-expired:' || $1 || ':settlement',
         "settlementRecipientMasked" = '已匿名化',
         "taxProfileRef" = 'retention-expired:' || $1 || ':tax',
         "identityEvidenceRef" = 'retention-expired:' || $1 || ':identity',
         "adultEligibilityVerdict" = 'pending',
         "adultEligibilityVerifiedAt" = NULL,
         "adultEligibilityValidUntil" = NULL,
         "adultEligibilityEvidenceRef" = NULL,
         "serviceAgreementEvidenceRef" = 'retention-expired:' || $1 || ':agreement',
         "updatedAt" = CURRENT_TIMESTAMP`
      );
    }
    if (phase === "transaction_availability_window") {
      return companionId
        ? del("CompanionAvailabilityWindow", 'target."companionId" = $1', [companionId])
        : empty;
    }

    // Phases not owned by the restricted graph continue in processRetainedPhaseBatch.
    return null;
  }

  private async verifyRetainedCategory(
    tx: any,
    deletionRequestId: string,
    userId: string,
    category: string,
    companionId: string | null
  ): Promise<void> {
    if (category === "transactions_tax_invoices") {
      const remaining = await Promise.all([
        tx.invoiceRequest.count({
          where: {
            userId,
            OR: [
              { invoiceTitle: { not: "已注销账号" } },
              { statusReason: { not: null } },
              { issuanceEvidenceReference: { not: null } },
              { voidEvidenceReference: { not: null } }
            ]
          }
        }),
        tx.order.count({
          where: { userId, OR: [
            { clientRequestId: { not: null } },
            { serviceIntentSnapshot: { not: null } },
            { themeNameSnapshot: { not: "已匿名化服务记录" } }
          ] }
        }),
        ...(companionId ? [
          tx.order.count({ where: { companionId, OR: [
            { companionNameSnapshot: { not: "已匿名化陪伴者" } },
            { companionRoleSnapshot: { not: "已匿名化服务方" } },
            { companionInitialsSnapshot: { not: "—" } },
            { settlementRecipientRefSnapshot: { not: null } },
            { settlementRecipientMaskedSnapshot: { not: null } },
            { taxProfileRefSnapshot: { not: null } },
            { identityEvidenceRefSnapshot: { not: null } },
            { adultEligibilityVerdictSnapshot: { not: null } },
            { adultEligibilityVerifiedAtSnapshot: { not: null } },
            { adultEligibilityValidUntilSnapshot: { not: null } },
            { serviceAgreementVersionSnapshot: { not: null } },
            { serviceAgreementEvidenceRefSnapshot: { not: null } },
            { availabilityWindowId: { not: null } }
          ] } }),
          tx.companionEarning.count({ where: { companionId, OR: [
            { settlementRecipientRefSnapshot: { not: null } },
            { settlementRecipientMaskedSnapshot: { not: null } },
            { taxProfileRefSnapshot: { not: null } },
            { identityEvidenceRefSnapshot: { not: null } },
            { serviceAgreementVersionSnapshot: { not: null } },
            { serviceAgreementEvidenceRefSnapshot: { not: null } },
            { paidReference: { not: null } },
            { paidRecipientRef: { not: null } },
            { payoutEvidenceDigest: { not: null } }
          ] } }),
          tx.companionWithdrawalRequest.count({ where: { companionId, OR: [
            { settlementRecipientMasked: { not: "已匿名化" } },
            { payoutReferenceMasked: { not: null } },
            { rejectionReason: { not: null } }
          ] } }),
          tx.companionRecovery.count({ where: { companionId, evidenceReference: { not: null } } }),
          tx.companionCommercialProfile.count({ where: { companionId, OR: [
            { settlementRecipientRef: { not: `retention-expired:${companionId}:settlement` } },
            { settlementRecipientMasked: { not: "已匿名化" } },
            { taxProfileRef: { not: `retention-expired:${companionId}:tax` } },
            { identityEvidenceRef: { not: `retention-expired:${companionId}:identity` } },
            { adultEligibilityVerdict: { not: "pending" } },
            { adultEligibilityVerifiedAt: { not: null } },
            { adultEligibilityValidUntil: { not: null } },
            { adultEligibilityEvidenceRef: { not: null } },
            { serviceAgreementEvidenceRef: { not: `retention-expired:${companionId}:agreement` } }
          ] } }),
          tx.companionAvailabilityWindow.count({ where: { companionId } }),
          tx.companionProfile.count({ where: { id: companionId, ownerUserId: { not: null } } })
        ] : [])
      ]);
      if (remaining.some((value: number) => value > 0)) {
        throw new Error("Transaction retention postcondition failed");
      }
      return;
    }
    if (category === "support_disputes_safety") {
      const remaining = await Promise.all([
        tx.orderSupportFact.count({ where: {
          OR: [
            { submittedByUserId: userId },
            { supportTicket: { userId } }
          ]
        } }),
        tx.attendanceDisputeStatement.count({ where: { submittedByUserId: userId } }),
        tx.voiceAttendanceEvent.count({ where: { participantUserId: userId } }),
        tx.supportTicket.count({ where: { userId } }),
        tx.paymentDisputeReply.count({ where: { actorId: userId } }),
        tx.moderationAppeal.count({ where: { subjectUserId: userId } }),
        tx.moderationCase.count({ where: { OR: [{ subjectUserId: userId }, { reporterUserId: userId }] } }),
        tx.chatRestriction.count({ where: { userId } }),
        tx.crisisIntervention.count({ where: { userId } }),
        tx.moderationActionLog.count({ where: { actorId: userId } }),
        tx.message.count({ where: { senderId: userId } }),
        tx.mediaAsset.count({ where: { uploaderId: userId } }),
        ...(companionId ? [
          tx.companionIncidentReport.count({ where: { companionId } }),
          tx.companionProfile.count({ where: { id: companionId, ownerUserId: { not: null } } })
        ] : [])
      ]);
      if (remaining.some((value: number) => value > 0)) {
        throw new Error("Safety retention postcondition failed");
      }
      return;
    }
    if (category === "consent_rights_account_governance") {
      const remaining = await Promise.all([
        tx.dataRightsRequest.count({ where: { userId } }),
        tx.legalConsentReceipt.count({ where: { userId } }),
        tx.identityVerificationRequest.count({ where: { userId } }),
        tx.customerAdultEligibility.count({ where: { userId } }),
        tx.userAccountAction.count({ where: { userId } }),
        tx.userAccountAppeal.count({ where: { userId } }),
        ...(companionId ? [
          tx.companionTrainingRecord.count({ where: { companionId } }),
          tx.companionAccountAction.count({ where: { companionId } }),
          tx.companionAccountAppeal.count({ where: { companionId } }),
          tx.companionProfile.count({ where: { id: companionId, ownerUserId: { not: null } } })
        ] : [])
      ]);
      if (remaining.some((value: number) => value > 0)) {
        throw new Error("Governance retention postcondition failed");
      }
      return;
    }
    if (category === "deletion_audit_evidence") {
      const [tombstones, requests, jobs, logs] = await Promise.all([
        tx.authIdentityTombstone.count({ where: { deletionRequestId } }),
        tx.accountDeletionRequest.count({
          where: {
            userId,
            status: "completed",
            note: { not: "Retention period completed; subject details anonymized" }
          }
        }),
        tx.accountDeletionRatingRefreshJob.count({
          where: { deletionRequest: { userId } }
        }),
        tx.$queryRaw<Array<{ count: number }>>`
          SELECT COUNT(*)::INTEGER AS count
          FROM "AuditLog" AS log
          WHERE log."actorId" = ${userId}
            OR log."resourceId" = ${userId}
            OR (
              log."resourceType" = 'accountDeletionRequest'
              AND EXISTS (
                SELECT 1 FROM "AccountDeletionRequest" request
                WHERE request."id" = log."resourceId" AND request."userId" = ${userId}
              )
            )
        `
      ]);
      if (tombstones > 0 || requests > 0 || jobs > 0 || Number(logs[0]?.count ?? 0) > 0) {
        throw new Error("Deletion-audit retention postcondition failed");
      }
      return;
    }
    throw new Error(`Unsupported account-deletion retention category: ${category}`);
  }

  private async assertRetentionCompanionOwnership(
    tx: any,
    userId: string,
    companionId: string,
    operation: string
  ): Promise<{ id: string; ownerUserId?: string | null }> {
    await tx.$queryRaw`
      SELECT "id"
      FROM "CompanionProfile"
      WHERE "id" = ${companionId}
      FOR UPDATE
    `;
    const companion = await tx.companionProfile.findUnique({
      where: { id: companionId },
      select: { id: true, ownerUserId: true }
    });
    if (!companion) {
      throw new Error(`Retention companion subject is missing for ${operation}`);
    }
    // Another retention category may already have detached this exact profile.
    // A non-null different owner, however, means the historical ledger no
    // longer has authority to mutate the profile or any of its child records.
    if (companion.ownerUserId && companion.ownerUserId !== userId) {
      throw new Error(`Retention companion ownership changed before ${operation}`);
    }
    return companion;
  }

  private async assertRetentionCompanionLinkage(
    tx: any,
    userId: string,
    companionId: string | null,
    operation: string
  ): Promise<void> {
    // Locking the referenced user also blocks a concurrent FK assignment of a
    // different CompanionProfile to this deleted subject. Lock all currently
    // linked profiles and then re-read so a detach/swap cannot race the check.
    await tx.$queryRaw`
      SELECT "id"
      FROM "User"
      WHERE "id" = ${userId}
      FOR UPDATE
    `;
    // ownerUserId is UNIQUE, so linkage inspection and locking are strictly
    // constant-cardinality rather than a hidden subject-scoped collection.
    const initiallyLinked: { id: string } | null = await tx.companionProfile.findUnique({
      where: { ownerUserId: userId },
      select: { id: true }
    });
    if (initiallyLinked) {
      await tx.$queryRaw`
        SELECT "id"
        FROM "CompanionProfile"
        WHERE "id" = ${initiallyLinked.id}
        FOR UPDATE
      `;
    }
    const currentlyLinked: { id: string } | null = await tx.companionProfile.findUnique({
      where: { ownerUserId: userId },
      select: { id: true }
    });
    if ((currentlyLinked && currentlyLinked.id !== companionId)
      || (!companionId && currentlyLinked)) {
      throw new Error(`Retention companion linkage changed before ${operation}`);
    }
  }

  private runOnceSafely(): void {
    // runOnce already emits the sanitized failure record; consume the scheduled
    // rejection so one transient dependency failure cannot become an unhandled
    // process-level rejection.
    void this.runOnce().catch(() => undefined);
  }

  private scheduleContinuation(delayMs: number): void {
    if (this.config.get<string>("NODE_ENV") === "test") return;
    if (this.continuationTimer) clearTimeout(this.continuationTimer);
    this.continuationTimer = setTimeout(() => {
      this.continuationTimer = null;
      this.runOnceSafely();
    }, delayMs);
    this.continuationTimer.unref?.();
  }
}
