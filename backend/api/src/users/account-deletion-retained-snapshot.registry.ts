import { Prisma } from "../../generated/prisma/client";

export const ACCOUNT_DELETION_RETAINED_SNAPSHOT_BATCH_SIZE = 250;

export type AccountDeletionRetainedSnapshotCategory =
  | "transactions_tax_invoices"
  | "support_disputes_safety"
  | "consent_rights_account_governance";

export type AccountDeletionRetainedSnapshotSubject = {
  userId: string;
  companionId: string | null;
};

export type AccountDeletionRetainedSnapshotCursor = {
  stableTime: Date;
  id: string;
};

export type AccountDeletionRetainedSnapshotRow = AccountDeletionRetainedSnapshotCursor;

export type AccountDeletionRetainedSnapshotProgress = {
  id: string;
  category: string;
  sourceKey: string;
  highWaterAt: Date;
  cursorCreatedAt: Date | null;
  cursorId: string | null;
  observedCount: number;
  completedAt: Date | null;
};

export type AccountDeletionRetainedSnapshotSource = {
  category: AccountDeletionRetainedSnapshotCategory;
  sourceKey: string;
  stableTimeField: string;
  readPage: (
    db: any,
    subject: AccountDeletionRetainedSnapshotSubject,
    highWaterAt: Date,
    cursor: AccountDeletionRetainedSnapshotCursor | null
  ) => Promise<AccountDeletionRetainedSnapshotRow[]>;
  hasLateArrival: (
    db: any,
    subject: AccountDeletionRetainedSnapshotSubject,
    highWaterAt: Date
  ) => Promise<boolean>;
};

export function validateAccountDeletionRetainedSnapshotProgress(
  rows: AccountDeletionRetainedSnapshotProgress[],
  sources: readonly AccountDeletionRetainedSnapshotSource[],
  highWaterAt: Date,
  requireComplete = false
): Map<string, AccountDeletionRetainedSnapshotProgress> {
  if (!Number.isFinite(highWaterAt.getTime())) {
    throw new Error("Account deletion retained snapshot high-water is invalid");
  }
  if (rows.length !== sources.length) {
    throw new Error("Account deletion retained snapshot registry is incomplete");
  }

  const expected = new Map(sources.map((source) => [source.sourceKey, source]));
  if (expected.size !== sources.length) {
    throw new Error("Account deletion retained snapshot registry has duplicate source keys");
  }
  const observed = new Map<string, AccountDeletionRetainedSnapshotProgress>();
  for (const row of rows) {
    const source = expected.get(row.sourceKey);
    if (!source || row.category !== source.category || observed.has(row.sourceKey)) {
      throw new Error("Account deletion retained snapshot registry contains an unexpected source");
    }
    const rowHighWater = row.highWaterAt instanceof Date
      ? row.highWaterAt
      : new Date(row.highWaterAt);
    const cursorCreatedAt = row.cursorCreatedAt instanceof Date || row.cursorCreatedAt === null
      ? row.cursorCreatedAt
      : new Date(row.cursorCreatedAt);
    const completedAt = row.completedAt instanceof Date || row.completedAt === null
      ? row.completedAt
      : new Date(row.completedAt);
    if (!Number.isFinite(rowHighWater.getTime())
      || rowHighWater.getTime() !== highWaterAt.getTime()) {
      throw new Error(`Account deletion retained snapshot high-water changed: ${row.sourceKey}`);
    }
    if ((cursorCreatedAt === null) !== (row.cursorId === null)
      || (cursorCreatedAt !== null && (
        !Number.isFinite(cursorCreatedAt.getTime())
        || cursorCreatedAt.getTime() > highWaterAt.getTime()
        || typeof row.cursorId !== "string"
        || row.cursorId.length === 0
      ))) {
      throw new Error(`Account deletion retained snapshot cursor is invalid: ${row.sourceKey}`);
    }
    if (!Number.isSafeInteger(row.observedCount) || row.observedCount < 0) {
      throw new Error(`Account deletion retained snapshot count is invalid: ${row.sourceKey}`);
    }
    if (completedAt !== null && (
      !Number.isFinite(completedAt.getTime())
      || completedAt.getTime() < highWaterAt.getTime()
    )) {
      throw new Error(`Account deletion retained snapshot completion is invalid: ${row.sourceKey}`);
    }
    if (requireComplete && completedAt === null) {
      throw new Error(`Account deletion retained snapshot source is incomplete: ${row.sourceKey}`);
    }
    observed.set(row.sourceKey, {
      ...row,
      highWaterAt: rowHighWater,
      cursorCreatedAt,
      completedAt
    });
  }
  return observed;
}

type SnapshotRowsSql = (
  subject: AccountDeletionRetainedSnapshotSubject
) => Prisma.Sql;

function retainedSnapshotSource(
  category: AccountDeletionRetainedSnapshotCategory,
  sourceKey: string,
  stableTimeField: string,
  rowsSql: SnapshotRowsSql
): AccountDeletionRetainedSnapshotSource {
  return {
    category,
    sourceKey,
    stableTimeField,
    async readPage(db, subject, highWaterAt, cursor) {
      const cursorTime = cursor?.stableTime ?? null;
      const cursorId = cursor?.id ?? null;
      const rows = await db.$queryRaw(Prisma.sql`
        SELECT source_rows."id", source_rows."stableTime"
        FROM (${rowsSql(subject)}) AS source_rows
        WHERE source_rows."stableTime" <= ${highWaterAt}
          AND (
            ${cursorTime}::TIMESTAMP IS NULL
            OR (source_rows."stableTime", source_rows."id")
              > (${cursorTime}::TIMESTAMP, ${cursorId}::TEXT)
          )
        ORDER BY source_rows."stableTime", source_rows."id"
        LIMIT ${ACCOUNT_DELETION_RETAINED_SNAPSHOT_BATCH_SIZE}
      `) as Array<{ id: string; stableTime: Date }>;
      return rows.map((row) => ({
        id: row.id,
        stableTime: row.stableTime instanceof Date ? row.stableTime : new Date(row.stableTime)
      }));
    },
    async hasLateArrival(db, subject, highWaterAt) {
      const rows = await db.$queryRaw(Prisma.sql`
        SELECT EXISTS (
          SELECT 1
          FROM (${rowsSql(subject)}) AS source_rows
          WHERE source_rows."stableTime" > ${highWaterAt}
        ) AS "exists"
      `) as Array<{ exists: boolean }>;
      return rows[0]?.exists === true;
    }
  };
}

function partyOrdersSql(subject: AccountDeletionRetainedSnapshotSubject): Prisma.Sql {
  return Prisma.sql`
    SELECT orders."id"
    FROM "Order" orders
    WHERE orders."userId" = ${subject.userId}
      OR (${subject.companionId}::TEXT IS NOT NULL AND orders."companionId" = ${subject.companionId})
  `;
}

function financialSubjectGraphSql(subject: AccountDeletionRetainedSnapshotSubject): Prisma.Sql {
  return Prisma.sql`
    WITH party_orders AS (${partyOrdersSql(subject)}),
    party_payments AS (
      SELECT payment."id", payment."outTradeNo", payment."transactionId"
      FROM "PaymentTransaction" payment
      WHERE payment."orderId" IN (SELECT "id" FROM party_orders)
    ),
    party_refunds AS (
      SELECT refund."id", refund."outRefundNo", refund."providerRefundId"
      FROM "RefundTransaction" refund
      WHERE refund."orderId" IN (SELECT "id" FROM party_orders)
    ),
    party_invoices AS (
      SELECT invoice."id"
      FROM "InvoiceRequest" invoice
      WHERE invoice."userId" = ${subject.userId}
        OR invoice."orderId" IN (SELECT "id" FROM party_orders)
    ),
    party_earnings AS (
      SELECT earning."id"
      FROM "CompanionEarning" earning
      WHERE ${subject.companionId}::TEXT IS NOT NULL
        AND earning."companionId" = ${subject.companionId}
    ),
    party_withdrawals AS (
      SELECT withdrawal."id"
      FROM "CompanionWithdrawalRequest" withdrawal
      WHERE ${subject.companionId}::TEXT IS NOT NULL
        AND withdrawal."companionId" = ${subject.companionId}
    ),
    party_recoveries AS (
      SELECT recovery."id"
      FROM "CompanionRecovery" recovery
      WHERE ${subject.companionId}::TEXT IS NOT NULL
        AND recovery."companionId" = ${subject.companionId}
    ),
    party_cash_entries AS (
      SELECT ledger."id"
      FROM "CashLedgerEntry" ledger
      WHERE (ledger."sourceResourceType" = 'paymentTransaction'
          AND ledger."sourceResourceId" IN (SELECT "id" FROM party_payments))
        OR (ledger."sourceResourceType" = 'refundTransaction'
          AND ledger."sourceResourceId" IN (SELECT "id" FROM party_refunds))
        OR (ledger."sourceResourceType" IN ('settlement', 'fee') AND (
          ledger."sourceResourceId" IN (SELECT "id" FROM party_earnings)
          OR ledger."sourceResourceId" IN (SELECT "id" FROM party_withdrawals)
          OR ledger."sourceResourceId" IN (SELECT "id" FROM party_recoveries)
        ))
    ),
    party_bill_entries AS (
      SELECT entry."id", entry."runId"
      FROM "WeChatBillEntry" entry
      WHERE entry."outTradeNo" IN (
          SELECT payment."outTradeNo" FROM party_payments payment
        )
        OR entry."transactionId" IN (
          SELECT payment."transactionId" FROM party_payments payment
          WHERE payment."transactionId" IS NOT NULL
        )
        OR entry."outRefundNo" IN (
          SELECT refund."outRefundNo" FROM party_refunds refund
        )
        OR entry."providerRefundId" IN (
          SELECT refund."providerRefundId" FROM party_refunds refund
          WHERE refund."providerRefundId" IS NOT NULL
        )
        OR entry."businessReference" IN (
          SELECT payment."outTradeNo" FROM party_payments payment
          UNION
          SELECT refund."outRefundNo" FROM party_refunds refund
        )
    ),
    party_import_entries AS (
      SELECT entry."id", entry."proposalId"
      FROM "WeChatBillImportEntry" entry
      WHERE entry."outTradeNo" IN (
          SELECT payment."outTradeNo" FROM party_payments payment
        )
        OR entry."transactionId" IN (
          SELECT payment."transactionId" FROM party_payments payment
          WHERE payment."transactionId" IS NOT NULL
        )
        OR entry."outRefundNo" IN (
          SELECT refund."outRefundNo" FROM party_refunds refund
        )
        OR entry."providerRefundId" IN (
          SELECT refund."providerRefundId" FROM party_refunds refund
          WHERE refund."providerRefundId" IS NOT NULL
        )
        OR entry."businessReference" IN (
          SELECT payment."outTradeNo" FROM party_payments payment
          UNION
          SELECT refund."outRefundNo" FROM party_refunds refund
        )
    ),
    party_runs AS (
      SELECT DISTINCT entry."runId" AS "id" FROM party_bill_entries entry
    ),
    party_issues AS (
      SELECT issue."id"
      FROM "WeChatReconciliationIssue" issue
      WHERE issue."entryId" IN (SELECT "id" FROM party_bill_entries)
        OR (issue."localResourceType" = 'order'
          AND issue."localResourceId" IN (SELECT "id" FROM party_orders))
        OR (issue."localResourceType" = 'paymentTransaction'
          AND issue."localResourceId" IN (SELECT "id" FROM party_payments))
        OR (issue."localResourceType" = 'refundTransaction'
          AND issue."localResourceId" IN (SELECT "id" FROM party_refunds))
        OR (issue."localResourceType" = 'invoiceRequest'
          AND issue."localResourceId" IN (SELECT "id" FROM party_invoices))
        OR (issue."localResourceType" = 'companionEarning'
          AND issue."localResourceId" IN (SELECT "id" FROM party_earnings))
        OR (issue."localResourceType" = 'companionWithdrawalRequest'
          AND issue."localResourceId" IN (SELECT "id" FROM party_withdrawals))
        OR (issue."localResourceType" = 'companionRecovery'
          AND issue."localResourceId" IN (SELECT "id" FROM party_recoveries))
        OR (issue."localResourceType" = 'cashLedgerEntry'
          AND issue."localResourceId" IN (SELECT "id" FROM party_cash_entries))
    )
  `;
}

function paymentDisputeSubjectGraphSql(subject: AccountDeletionRetainedSnapshotSubject): Prisma.Sql {
  return Prisma.sql`
    WITH party_orders AS (${partyOrdersSql(subject)}),
    party_payments AS (
      SELECT payment."id", payment."outTradeNo"
      FROM "PaymentTransaction" payment
      WHERE payment."orderId" IN (SELECT "id" FROM party_orders)
    ),
    party_disputes AS (
      SELECT dispute."id"
      FROM "PaymentDispute" dispute
      WHERE dispute."orderId" IN (SELECT "id" FROM party_orders)
        OR dispute."paymentId" IN (SELECT "id" FROM party_payments)
        OR dispute."outTradeNo" IN (SELECT "outTradeNo" FROM party_payments)
        OR EXISTS (
          SELECT 1
          FROM "PaymentDisputeOrder" complaint_order
          WHERE complaint_order."disputeId" = dispute."id"
            AND (
              complaint_order."orderId" IN (SELECT "id" FROM party_orders)
              OR complaint_order."paymentId" IN (SELECT "id" FROM party_payments)
              OR complaint_order."outTradeNo" IN (SELECT "outTradeNo" FROM party_payments)
            )
        )
    ),
    party_dispute_orders AS (
      SELECT complaint_order."id"
      FROM "PaymentDisputeOrder" complaint_order
      WHERE complaint_order."disputeId" IN (SELECT "id" FROM party_disputes)
        OR complaint_order."orderId" IN (SELECT "id" FROM party_orders)
        OR complaint_order."paymentId" IN (SELECT "id" FROM party_payments)
        OR complaint_order."outTradeNo" IN (SELECT "outTradeNo" FROM party_payments)
    )
  `;
}

function moderationSubjectGraphSql(subject: AccountDeletionRetainedSnapshotSubject): Prisma.Sql {
  return Prisma.sql`
    WITH party_conversations AS (
      SELECT conversation."id"
      FROM "Conversation" conversation
      WHERE conversation."userId" = ${subject.userId}
        OR (${subject.companionId}::TEXT IS NOT NULL
          AND conversation."companionId" = ${subject.companionId})
    ),
    party_messages AS (
      SELECT message."id"
      FROM "Message" message
      WHERE message."senderId" = ${subject.userId}
        OR message."conversationId" IN (SELECT "id" FROM party_conversations)
    ),
    party_cases AS (
      SELECT moderation_case."id"
      FROM "ModerationCase" moderation_case
      WHERE moderation_case."subjectUserId" = ${subject.userId}
        OR moderation_case."reporterUserId" = ${subject.userId}
        OR moderation_case."conversationId" IN (SELECT "id" FROM party_conversations)
        OR moderation_case."messageId" IN (SELECT "id" FROM party_messages)
        OR moderation_case."targetId" IN (SELECT "id" FROM party_messages)
        OR moderation_case."targetId" IN (SELECT "id" FROM party_conversations)
    )
  `;
}

export const ACCOUNT_DELETION_RETAINED_SNAPSHOT_REGISTRY:
readonly AccountDeletionRetainedSnapshotSource[] = Object.freeze([
  retainedSnapshotSource("transactions_tax_invoices", "orders", "createdAt", (subject) => Prisma.sql`
    SELECT target."id", target."createdAt" AS "stableTime"
    FROM "Order" target
    WHERE target."userId" = ${subject.userId}
      OR (${subject.companionId}::TEXT IS NOT NULL AND target."companionId" = ${subject.companionId})
  `),
  retainedSnapshotSource("transactions_tax_invoices", "payment_transactions", "createdAt", (subject) => Prisma.sql`
    SELECT target."id", target."createdAt" AS "stableTime"
    FROM "PaymentTransaction" target
    WHERE target."orderId" IN (${partyOrdersSql(subject)})
  `),
  retainedSnapshotSource("transactions_tax_invoices", "refund_transactions", "createdAt", (subject) => Prisma.sql`
    SELECT target."id", target."createdAt" AS "stableTime"
    FROM "RefundTransaction" target
    WHERE target."orderId" IN (${partyOrdersSql(subject)})
  `),
  retainedSnapshotSource("transactions_tax_invoices", "financial_payment_dispute_orders", "providerSeenAt", (subject) => Prisma.sql`
    ${paymentDisputeSubjectGraphSql(subject)}
    SELECT target."id", target."providerSeenAt" AS "stableTime"
    FROM "PaymentDisputeOrder" target
    WHERE target."id" IN (SELECT "id" FROM party_dispute_orders)
  `),
  retainedSnapshotSource("transactions_tax_invoices", "invoice_requests", "createdAt", (subject) => Prisma.sql`
    SELECT target."id", target."createdAt" AS "stableTime"
    FROM "InvoiceRequest" target
    WHERE target."userId" = ${subject.userId}
      OR target."orderId" IN (${partyOrdersSql(subject)})
  `),
  retainedSnapshotSource("transactions_tax_invoices", "companion_commercial_profiles", "createdAt", (subject) => Prisma.sql`
    SELECT target."companionId" AS "id", target."createdAt" AS "stableTime"
    FROM "CompanionCommercialProfile" target
    WHERE ${subject.companionId}::TEXT IS NOT NULL
      AND target."companionId" = ${subject.companionId}
  `),
  retainedSnapshotSource("transactions_tax_invoices", "companion_earnings", "createdAt", (subject) => Prisma.sql`
    SELECT target."id", target."createdAt" AS "stableTime"
    FROM "CompanionEarning" target
    WHERE ${subject.companionId}::TEXT IS NOT NULL
      AND target."companionId" = ${subject.companionId}
  `),
  retainedSnapshotSource("transactions_tax_invoices", "companion_withdrawal_requests", "createdAt", (subject) => Prisma.sql`
    SELECT target."id", target."createdAt" AS "stableTime"
    FROM "CompanionWithdrawalRequest" target
    WHERE ${subject.companionId}::TEXT IS NOT NULL
      AND target."companionId" = ${subject.companionId}
  `),
  retainedSnapshotSource("transactions_tax_invoices", "companion_recoveries", "createdAt", (subject) => Prisma.sql`
    SELECT target."id", target."createdAt" AS "stableTime"
    FROM "CompanionRecovery" target
    WHERE ${subject.companionId}::TEXT IS NOT NULL
      AND target."companionId" = ${subject.companionId}
  `),
  retainedSnapshotSource("transactions_tax_invoices", "cash_ledger_entries", "createdAt", (subject) => Prisma.sql`
    ${financialSubjectGraphSql(subject)}
    SELECT target."id", target."createdAt" AS "stableTime"
    FROM "CashLedgerEntry" target
    WHERE target."id" IN (SELECT "id" FROM party_cash_entries)
  `),
  retainedSnapshotSource("transactions_tax_invoices", "cash_ledger_classification_proposals", "proposedAt", (subject) => Prisma.sql`
    ${financialSubjectGraphSql(subject)}
    SELECT target."id", target."proposedAt" AS "stableTime"
    FROM "CashLedgerClassificationProposal" target
    WHERE target."cashLedgerEntryId" IN (SELECT "id" FROM party_cash_entries)
  `),
  retainedSnapshotSource("transactions_tax_invoices", "wechat_bill_entries", "createdAt", (subject) => Prisma.sql`
    ${financialSubjectGraphSql(subject)}
    SELECT target."id", target."createdAt" AS "stableTime"
    FROM "WeChatBillEntry" target
    WHERE target."id" IN (SELECT "id" FROM party_bill_entries)
  `),
  retainedSnapshotSource("transactions_tax_invoices", "wechat_bill_reconciliation_runs", "createdAt", (subject) => Prisma.sql`
    ${financialSubjectGraphSql(subject)}
    SELECT target."id", target."createdAt" AS "stableTime"
    FROM "WeChatBillReconciliationRun" target
    WHERE target."id" IN (SELECT "id" FROM party_runs)
  `),
  retainedSnapshotSource("transactions_tax_invoices", "wechat_reconciliation_issues", "createdAt", (subject) => Prisma.sql`
    ${financialSubjectGraphSql(subject)}
    SELECT target."id", target."createdAt" AS "stableTime"
    FROM "WeChatReconciliationIssue" target
    WHERE target."id" IN (SELECT "id" FROM party_issues)
  `),
  retainedSnapshotSource("transactions_tax_invoices", "wechat_reconciliation_resolution_proposals", "proposedAt", (subject) => Prisma.sql`
    ${financialSubjectGraphSql(subject)}
    SELECT target."id", target."proposedAt" AS "stableTime"
    FROM "WeChatReconciliationResolutionProposal" target
    WHERE target."issueId" IN (SELECT "id" FROM party_issues)
  `),
  retainedSnapshotSource("transactions_tax_invoices", "wechat_bill_import_entries", "createdAt", (subject) => Prisma.sql`
    ${financialSubjectGraphSql(subject)}
    SELECT target."id", target."createdAt" AS "stableTime"
    FROM "WeChatBillImportEntry" target
    WHERE target."id" IN (SELECT "id" FROM party_import_entries)
  `),
  retainedSnapshotSource("transactions_tax_invoices", "wechat_bill_import_proposals", "proposedAt", (subject) => Prisma.sql`
    ${financialSubjectGraphSql(subject)}
    SELECT target."id", target."proposedAt" AS "stableTime"
    FROM "WeChatBillImportProposal" target
    WHERE target."id" IN (SELECT "proposalId" FROM party_import_entries)
  `),

  retainedSnapshotSource("support_disputes_safety", "support_tickets", "createdAt", (subject) => Prisma.sql`
    SELECT target."id", target."createdAt" AS "stableTime"
    FROM "SupportTicket" target
    WHERE target."userId" = ${subject.userId}
      OR target."orderId" IN (${partyOrdersSql(subject)})
  `),
  retainedSnapshotSource("support_disputes_safety", "order_support_facts", "createdAt", (subject) => Prisma.sql`
    SELECT target."id", target."createdAt" AS "stableTime"
    FROM "OrderSupportFact" target
    WHERE target."submittedByUserId" = ${subject.userId}
      OR target."orderId" IN (${partyOrdersSql(subject)})
      OR EXISTS (
        SELECT 1 FROM "SupportTicket" ticket
        WHERE ticket."id" = target."supportTicketId"
          AND (ticket."userId" = ${subject.userId}
            OR ticket."orderId" IN (${partyOrdersSql(subject)}))
      )
  `),
  retainedSnapshotSource("support_disputes_safety", "payment_disputes", "createdAt", (subject) => Prisma.sql`
    ${paymentDisputeSubjectGraphSql(subject)}
    SELECT target."id", target."createdAt" AS "stableTime"
    FROM "PaymentDispute" target
    WHERE target."id" IN (SELECT "id" FROM party_disputes)
  `),
  retainedSnapshotSource("support_disputes_safety", "payment_dispute_orders", "providerSeenAt", (subject) => Prisma.sql`
    ${paymentDisputeSubjectGraphSql(subject)}
    SELECT target."id", target."providerSeenAt" AS "stableTime"
    FROM "PaymentDisputeOrder" target
    WHERE target."id" IN (SELECT "id" FROM party_dispute_orders)
  `),
  retainedSnapshotSource("support_disputes_safety", "payment_dispute_replies", "createdAt", (subject) => Prisma.sql`
    ${paymentDisputeSubjectGraphSql(subject)}
    SELECT target."id", target."createdAt" AS "stableTime"
    FROM "PaymentDisputeReply" target
    WHERE target."disputeId" IN (SELECT "id" FROM party_disputes)
  `),
  retainedSnapshotSource("support_disputes_safety", "payment_dispute_attachments", "createdAt", (subject) => Prisma.sql`
    ${paymentDisputeSubjectGraphSql(subject)}
    SELECT target."id", target."createdAt" AS "stableTime"
    FROM "PaymentDisputeAttachment" target
    WHERE target."disputeId" IN (SELECT "id" FROM party_disputes)
  `),
  retainedSnapshotSource("support_disputes_safety", "payment_dispute_notifications", "receivedAt", (subject) => Prisma.sql`
    ${paymentDisputeSubjectGraphSql(subject)}
    SELECT target."id", target."receivedAt" AS "stableTime"
    FROM "PaymentDisputeNotification" target
    WHERE target."disputeId" IN (SELECT "id" FROM party_disputes)
  `),
  retainedSnapshotSource("support_disputes_safety", "payment_dispute_negotiation_events", "createdAt", (subject) => Prisma.sql`
    ${paymentDisputeSubjectGraphSql(subject)}
    SELECT target."id", target."createdAt" AS "stableTime"
    FROM "PaymentDisputeNegotiationEvent" target
    WHERE target."disputeId" IN (SELECT "id" FROM party_disputes)
  `),
  retainedSnapshotSource("support_disputes_safety", "attendance_disputes", "createdAt", (subject) => Prisma.sql`
    SELECT target."id", target."createdAt" AS "stableTime"
    FROM "AttendanceDispute" target
    WHERE target."openedByUserId" = ${subject.userId}
      OR target."counterpartyUserId" = ${subject.userId}
      OR target."orderId" IN (${partyOrdersSql(subject)})
  `),
  retainedSnapshotSource("support_disputes_safety", "attendance_dispute_statements", "createdAt", (subject) => Prisma.sql`
    SELECT target."id", target."createdAt" AS "stableTime"
    FROM "AttendanceDisputeStatement" target
    WHERE target."submittedByUserId" = ${subject.userId}
      OR EXISTS (
        SELECT 1 FROM "AttendanceDispute" dispute
        WHERE dispute."id" = target."disputeId"
          AND (dispute."openedByUserId" = ${subject.userId}
            OR dispute."counterpartyUserId" = ${subject.userId}
            OR dispute."orderId" IN (${partyOrdersSql(subject)}))
      )
  `),
  retainedSnapshotSource("support_disputes_safety", "order_reschedule_requests", "createdAt", (subject) => Prisma.sql`
    SELECT target."id", target."createdAt" AS "stableTime"
    FROM "OrderRescheduleRequest" target
    WHERE target."requestedByUserId" = ${subject.userId}
      OR target."respondedByUserId" = ${subject.userId}
      OR target."orderId" IN (${partyOrdersSql(subject)})
  `),
  retainedSnapshotSource("support_disputes_safety", "order_timeline_events", "createdAt", (subject) => Prisma.sql`
    SELECT target."id", target."createdAt" AS "stableTime"
    FROM "OrderTimelineEvent" target
    WHERE target."actorId" = ${subject.userId}
      OR target."orderId" IN (${partyOrdersSql(subject)})
      OR EXISTS (
        SELECT 1 FROM "OrderRescheduleRequest" reschedule
        WHERE reschedule."id" = target."rescheduleRequestId"
          AND (reschedule."requestedByUserId" = ${subject.userId}
            OR reschedule."respondedByUserId" = ${subject.userId})
      )
  `),
  retainedSnapshotSource("support_disputes_safety", "order_experience_feedback", "createdAt", (subject) => Prisma.sql`
    SELECT target."id", target."createdAt" AS "stableTime"
    FROM "OrderExperienceFeedback" target
    WHERE target."orderId" IN (${partyOrdersSql(subject)})
  `),
  retainedSnapshotSource("support_disputes_safety", "voice_sessions", "createdAt", (subject) => Prisma.sql`
    SELECT target."id", target."createdAt" AS "stableTime"
    FROM "VoiceSession" target
    WHERE target."orderId" IN (${partyOrdersSql(subject)})
  `),
  retainedSnapshotSource("support_disputes_safety", "voice_attendance_events", "serverReceivedAt", (subject) => Prisma.sql`
    SELECT target."id", target."serverReceivedAt" AS "stableTime"
    FROM "VoiceAttendanceEvent" target
    WHERE target."participantUserId" = ${subject.userId}
      OR EXISTS (
        SELECT 1 FROM "VoiceSession" voice
        WHERE voice."id" = target."voiceSessionId"
          AND voice."orderId" IN (${partyOrdersSql(subject)})
      )
  `),
  retainedSnapshotSource("support_disputes_safety", "conversations", "createdAt", (subject) => Prisma.sql`
    SELECT target."id", target."createdAt" AS "stableTime"
    FROM "Conversation" target
    WHERE target."userId" = ${subject.userId}
      OR (${subject.companionId}::TEXT IS NOT NULL AND target."companionId" = ${subject.companionId})
  `),
  retainedSnapshotSource("support_disputes_safety", "messages", "createdAt", (subject) => Prisma.sql`
    SELECT target."id", target."createdAt" AS "stableTime"
    FROM "Message" target
    WHERE target."senderId" = ${subject.userId}
      OR EXISTS (
        SELECT 1 FROM "Conversation" conversation
        WHERE conversation."id" = target."conversationId"
          AND (conversation."userId" = ${subject.userId}
            OR (${subject.companionId}::TEXT IS NOT NULL
              AND conversation."companionId" = ${subject.companionId}))
      )
  `),
  retainedSnapshotSource("support_disputes_safety", "media_assets", "createdAt", (subject) => Prisma.sql`
    SELECT target."id", target."createdAt" AS "stableTime"
    FROM "MediaAsset" target
    WHERE target."uploaderId" = ${subject.userId}
      OR EXISTS (
        SELECT 1 FROM "Conversation" conversation
        WHERE conversation."id" = target."conversationId"
          AND (conversation."userId" = ${subject.userId}
            OR (${subject.companionId}::TEXT IS NOT NULL
              AND conversation."companionId" = ${subject.companionId}))
      )
      OR EXISTS (
        SELECT 1 FROM "Message" message
        JOIN "Conversation" conversation ON conversation."id" = message."conversationId"
        WHERE message."id" = target."messageId"
          AND (message."senderId" = ${subject.userId}
            OR conversation."userId" = ${subject.userId}
            OR (${subject.companionId}::TEXT IS NOT NULL
              AND conversation."companionId" = ${subject.companionId}))
      )
      OR EXISTS (
        SELECT 1
        FROM "ControlledCaseEvidenceAttachment" attachment
        LEFT JOIN "OrderSupportFact" support_fact
          ON support_fact."id" = attachment."orderSupportFactId"
        LEFT JOIN "AttendanceDisputeStatement" statement
          ON statement."id" = attachment."attendanceDisputeStatementId"
        LEFT JOIN "AttendanceDispute" attendance
          ON attendance."id" = statement."disputeId"
        LEFT JOIN "CompanionIncidentReport" incident
          ON incident."id" = attachment."companionIncidentReportId"
        WHERE attachment."mediaAssetId" = target."id"
          AND (
            attachment."boundByUserId" = ${subject.userId}
            OR support_fact."submittedByUserId" = ${subject.userId}
            OR support_fact."orderId" IN (${partyOrdersSql(subject)})
            OR statement."submittedByUserId" = ${subject.userId}
            OR attendance."openedByUserId" = ${subject.userId}
            OR attendance."counterpartyUserId" = ${subject.userId}
            OR attendance."orderId" IN (${partyOrdersSql(subject)})
            OR (${subject.companionId}::TEXT IS NOT NULL
              AND incident."companionId" = ${subject.companionId})
            OR incident."orderId" IN (${partyOrdersSql(subject)})
          )
      )
  `),
  retainedSnapshotSource("support_disputes_safety", "controlled_case_evidence_attachments", "createdAt", (subject) => Prisma.sql`
    SELECT target."id", target."createdAt" AS "stableTime"
    FROM "ControlledCaseEvidenceAttachment" target
    JOIN "MediaAsset" media ON media."id" = target."mediaAssetId"
    LEFT JOIN "OrderSupportFact" support_fact
      ON support_fact."id" = target."orderSupportFactId"
    LEFT JOIN "AttendanceDisputeStatement" statement
      ON statement."id" = target."attendanceDisputeStatementId"
    LEFT JOIN "AttendanceDispute" attendance ON attendance."id" = statement."disputeId"
    LEFT JOIN "CompanionIncidentReport" incident
      ON incident."id" = target."companionIncidentReportId"
    WHERE media."uploaderId" = ${subject.userId}
      OR target."boundByUserId" = ${subject.userId}
      OR support_fact."submittedByUserId" = ${subject.userId}
      OR support_fact."orderId" IN (${partyOrdersSql(subject)})
      OR statement."submittedByUserId" = ${subject.userId}
      OR attendance."openedByUserId" = ${subject.userId}
      OR attendance."counterpartyUserId" = ${subject.userId}
      OR attendance."orderId" IN (${partyOrdersSql(subject)})
      OR (${subject.companionId}::TEXT IS NOT NULL
        AND incident."companionId" = ${subject.companionId})
      OR incident."orderId" IN (${partyOrdersSql(subject)})
  `),
  retainedSnapshotSource("support_disputes_safety", "moderation_cases", "createdAt", (subject) => Prisma.sql`
    ${moderationSubjectGraphSql(subject)}
    SELECT target."id", target."createdAt" AS "stableTime"
    FROM "ModerationCase" target
    WHERE target."id" IN (SELECT "id" FROM party_cases)
  `),
  retainedSnapshotSource("support_disputes_safety", "moderation_evidences", "createdAt", (subject) => Prisma.sql`
    ${moderationSubjectGraphSql(subject)}
    SELECT target."id", target."createdAt" AS "stableTime"
    FROM "ModerationEvidence" target
    WHERE target."caseId" IN (SELECT "id" FROM party_cases)
  `),
  retainedSnapshotSource("support_disputes_safety", "moderation_action_logs", "createdAt", (subject) => Prisma.sql`
    ${moderationSubjectGraphSql(subject)}
    SELECT target."id", target."createdAt" AS "stableTime"
    FROM "ModerationActionLog" target
    WHERE target."caseId" IN (SELECT "id" FROM party_cases)
      OR target."actorId" = ${subject.userId}
  `),
  retainedSnapshotSource("support_disputes_safety", "moderation_appeals", "createdAt", (subject) => Prisma.sql`
    ${moderationSubjectGraphSql(subject)}
    SELECT target."id", target."createdAt" AS "stableTime"
    FROM "ModerationAppeal" target
    WHERE target."subjectUserId" = ${subject.userId}
      OR target."caseId" IN (SELECT "id" FROM party_cases)
  `),
  retainedSnapshotSource("support_disputes_safety", "chat_restrictions", "createdAt", (subject) => Prisma.sql`
    ${moderationSubjectGraphSql(subject)}
    SELECT target."id", target."createdAt" AS "stableTime"
    FROM "ChatRestriction" target
    WHERE target."userId" = ${subject.userId}
      OR target."caseId" IN (SELECT "id" FROM party_cases)
  `),
  retainedSnapshotSource("support_disputes_safety", "crisis_interventions", "createdAt", (subject) => Prisma.sql`
    SELECT target."id", target."createdAt" AS "stableTime"
    FROM "CrisisIntervention" target
    WHERE target."userId" = ${subject.userId}
  `),
  retainedSnapshotSource("support_disputes_safety", "companion_incident_reports", "createdAt", (subject) => Prisma.sql`
    SELECT target."id", target."createdAt" AS "stableTime"
    FROM "CompanionIncidentReport" target
    WHERE (${subject.companionId}::TEXT IS NOT NULL AND target."companionId" = ${subject.companionId})
      OR target."orderId" IN (${partyOrdersSql(subject)})
  `),
  retainedSnapshotSource("support_disputes_safety", "companion_customer_future_boundaries", "createdAt", (subject) => Prisma.sql`
    SELECT target."id", target."createdAt" AS "stableTime"
    FROM "CompanionCustomerFutureBoundary" target
    WHERE target."customerUserId" = ${subject.userId}
      OR (${subject.companionId}::TEXT IS NOT NULL
        AND target."companionId" = ${subject.companionId})
  `),

  retainedSnapshotSource("consent_rights_account_governance", "legal_consent_receipts", "consentedAt", (subject) => Prisma.sql`
    SELECT target."id", target."consentedAt" AS "stableTime"
    FROM "LegalConsentReceipt" target
    WHERE target."userId" = ${subject.userId}
  `),
  retainedSnapshotSource("consent_rights_account_governance", "data_rights_requests", "createdAt", (subject) => Prisma.sql`
    SELECT target."id", target."createdAt" AS "stableTime"
    FROM "DataRightsRequest" target
    WHERE target."userId" = ${subject.userId}
  `),
  retainedSnapshotSource("consent_rights_account_governance", "data_rights_request_follow_ups", "createdAt", (subject) => Prisma.sql`
    SELECT target."id", target."createdAt" AS "stableTime"
    FROM "DataRightsRequestFollowUp" target
    WHERE target."userId" = ${subject.userId}
      OR EXISTS (
        SELECT 1 FROM "DataRightsRequest" request
        WHERE request."id" = target."requestId" AND request."userId" = ${subject.userId}
      )
  `),
  retainedSnapshotSource("consent_rights_account_governance", "user_account_actions", "createdAt", (subject) => Prisma.sql`
    SELECT target."id", target."createdAt" AS "stableTime"
    FROM "UserAccountAction" target
    WHERE target."userId" = ${subject.userId}
  `),
  retainedSnapshotSource("consent_rights_account_governance", "user_account_appeals", "createdAt", (subject) => Prisma.sql`
    SELECT target."id", target."createdAt" AS "stableTime"
    FROM "UserAccountAppeal" target
    WHERE target."userId" = ${subject.userId}
      OR EXISTS (
        SELECT 1 FROM "UserAccountAction" action
        WHERE action."id" = target."actionId" AND action."userId" = ${subject.userId}
      )
  `),
  retainedSnapshotSource("consent_rights_account_governance", "identity_verification_requests", "createdAt", (subject) => Prisma.sql`
    SELECT target."id", target."createdAt" AS "stableTime"
    FROM "IdentityVerificationRequest" target
    WHERE target."userId" = ${subject.userId}
  `),
  retainedSnapshotSource("consent_rights_account_governance", "customer_adult_eligibilities", "createdAt", (subject) => Prisma.sql`
    SELECT target."id", target."createdAt" AS "stableTime"
    FROM "CustomerAdultEligibility" target
    WHERE target."userId" = ${subject.userId}
      AND target."status"::TEXT IN ('adult', 'ineligible')
  `),
  retainedSnapshotSource("consent_rights_account_governance", "companion_training_records", "createdAt", (subject) => Prisma.sql`
    SELECT target."id", target."createdAt" AS "stableTime"
    FROM "CompanionTrainingRecord" target
    WHERE ${subject.companionId}::TEXT IS NOT NULL
      AND target."companionId" = ${subject.companionId}
  `),
  retainedSnapshotSource("consent_rights_account_governance", "companion_account_actions", "createdAt", (subject) => Prisma.sql`
    SELECT target."id", target."createdAt" AS "stableTime"
    FROM "CompanionAccountAction" target
    WHERE ${subject.companionId}::TEXT IS NOT NULL
      AND target."companionId" = ${subject.companionId}
  `),
  retainedSnapshotSource("consent_rights_account_governance", "companion_account_appeals", "createdAt", (subject) => Prisma.sql`
    SELECT target."id", target."createdAt" AS "stableTime"
    FROM "CompanionAccountAppeal" target
    WHERE ${subject.companionId}::TEXT IS NOT NULL
      AND target."companionId" = ${subject.companionId}
  `)
]);
