/**
 * Shared bounded primitives for account deletion and legacy retention repair.
 *
 * Every mutation selects at most `batchSize` physical rows with
 * `FOR UPDATE SKIP LOCKED` and mutates those exact rows in the same statement.
 * Candidate selection is intentionally unordered so PostgreSQL can use a
 * subject index without repeatedly top-N sorting every remaining row. The
 * persisted cursor is diagnostic only: correctness never depends on ordering
 * or a physical tuple cursor surviving VACUUM or a concurrent transaction.
 */

export const ERASURE_BATCH_SIZE = 250;
export const RATING_REFRESH_BATCH_SIZE = 100;

export const ACCOUNT_DELETION_PHASES = [
  "pending_customer_adult_eligibility",
  "notification_delivery",
  "notification",
  "subscription_grant",
  "recommendation_impression",
  "recommendation_request",
  "recommendation_tag",
  "recommendation_preference",
  "recommendation_exclusion",
  "availability_reminder_candidate",
  "availability_reminder_fanout_job",
  "companion_favorite",
  "companion_recent_view",
  "message_read_state",
  "conversation_notification_preference",
  "conversation_block",
  "future_booking_boundary",
  "refresh_token",
  "verification_code",
  "auth_identity",
  "staff_credential",
  "user_profile",
  "companion_availability_deactivate",
  "companion_availability_window",
  "recurring_window_detach",
  "companion_recurring_rule",
  "companion_blackout",
  "companion_recommendation_policy",
  "community_like",
  "community_report",
  "authored_post_like",
  "authored_post_report",
  "community_post",
  "review",
  "rating_refresh",
  "order_service_offering_detach",
  "companion_offering",
  "companion_service_tag",
  "companion_profile",
  "media_retention",
  "retained_transactions_snapshot",
  "retained_safety_snapshot",
  "retained_governance_snapshot",
  "final_verification"
] as const;

export type AccountDeletionPhase = (typeof ACCOUNT_DELETION_PHASES)[number];

export const RETENTION_IMMEDIATE_PHASES: Record<string, readonly string[]> = {
  identity_authentication_profile: [
    "refresh_token",
    "verification_code",
    "auth_identity",
    "staff_credential",
    "user_profile",
    "pending_customer_adult_eligibility",
    "retention_verify"
  ],
  preferences_behavior_notifications: [
    "notification_delivery",
    "notification",
    "subscription_grant",
    "recommendation_impression",
    "recommendation_request",
    "recommendation_tag",
    "recommendation_preference",
    "recommendation_exclusion",
    "availability_reminder_candidate",
    "availability_reminder_fanout_job",
    "companion_favorite",
    "companion_recent_view",
    "message_read_state",
    "conversation_notification_preference",
    "conversation_block",
    "future_booking_boundary",
    "companion_availability_deactivate",
    "companion_availability_window",
    "recurring_window_detach",
    "companion_recurring_rule",
    "companion_blackout",
    "companion_recommendation_policy",
    "retention_verify"
  ],
  public_user_content: [
    "community_like",
    "community_report",
    "authored_post_like",
    "authored_post_report",
    "community_post",
    "review",
    "rating_refresh",
    "order_service_offering_detach",
    "companion_offering",
    "companion_service_tag",
    "companion_profile",
    "retention_verify"
  ]
};

const MUTABLE_TABLES = new Set([
  "CustomerAdultEligibility",
  "NotificationDelivery",
  "Notification",
  "WeChatSubscriptionGrant",
  "RecommendationImpression",
  "RecommendationRequest",
  "UserRecommendationTag",
  "UserRecommendationPreference",
  "UserCompanionRecommendationExclusion",
  "AvailabilityReminderCandidate",
  "AvailabilityReminderFanoutJob",
  "CompanionFavorite",
  "CompanionRecentView",
  "MessageReadState",
  "ConversationNotificationPreference",
  "ConversationBlock",
  "CompanionCustomerFutureBoundary",
  "RefreshToken",
  "VerificationCode",
  "AuthIdentity",
  "AuthIdentityTombstone",
  "StaffCredential",
  "UserProfile",
  "CompanionAvailabilityWindow",
  "CompanionRecurringAvailabilityRule",
  "CompanionAvailabilityBlackout",
  "CompanionRecommendationPolicy",
  "CommunityLike",
  "CommunityPostReport",
  "CommunityPost",
  "Review",
  "OrderExperienceFeedback",
  "CompanionServiceOffering",
  "CompanionServiceTag",
  "InvoiceRequest",
  "Order",
  "OrderRescheduleRequest",
  "OrderTimelineEvent",
  "Conversation",
  "VoiceSession",
  "PaymentTransaction",
  "RefundTransaction",
  "WeChatBillReconciliationRun",
  "WeChatBillImportProposal",
  "WeChatBillImportEntry",
  "WeChatBillEntry",
  "CashLedgerEntry",
  "CashLedgerClassificationProposal",
  "WeChatReconciliationIssue",
  "WeChatReconciliationResolutionProposal",
  "CompanionEarning",
  "CompanionWithdrawalRequest",
  "CompanionRecovery",
  "CompanionCommercialProfile",
  "OrderSupportFact",
  "AttendanceDisputeStatement",
  "AttendanceDispute",
  "VoiceAttendanceEvent",
  "SupportTicket",
  "PaymentDispute",
  "PaymentDisputeOrder",
  "PaymentDisputeReply",
  "PaymentDisputeAttachment",
  "PaymentDisputeNotification",
  "PaymentDisputeNegotiationEvent",
  "ModerationAppeal",
  "ModerationCase",
  "ModerationEvidence",
  "ChatRestriction",
  "CrisisIntervention",
  "ModerationActionLog",
  "CompanionIncidentReport",
  "Message",
  "MediaAsset",
  "ControlledCaseEvidenceAttachment",
  "DataRightsRequestFollowUp",
  "DataRightsRequest",
  "LegalConsentReceipt",
  "IdentityVerificationRequest",
  "UserAccountAppeal",
  "UserAccountAction",
  "CustomerAdultEligibility",
  "CompanionTrainingRecord",
  "CompanionAccountAppeal",
  "CompanionAccountAction",
  "AccountDeletionRatingRefreshJob",
  "AccountDeletionRetentionSnapshotProgress",
  "AccountDeletionRequest",
  "AccountDataRetentionRecord",
  "AuditLog",
  "AuditSubjectReference"
]);

export interface ErasureBatchResult {
  affectedCount: number;
  hasMore: boolean;
  cursor: string | null;
}

export interface ErasureSubject {
  deletionRequestId: string;
  userId: string;
  companionId: string | null;
  approvalActorId?: string | null;
  mediaRetentionEndsAt?: Date | null;
}

export interface BoundedErasureTransaction {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<number>;
}

function assertMutableTable(table: string): void {
  if (!MUTABLE_TABLES.has(table)) {
    throw new Error(`Unapproved bounded-erasure table: ${table}`);
  }
}

async function deleteWhere(
  tx: BoundedErasureTransaction,
  table: string,
  predicate: string,
  parameters: unknown[],
  batchSize: number
): Promise<ErasureBatchResult> {
  assertMutableTable(table);
  const limitParameter = parameters.length + 1;
  const rows = await tx.$queryRawUnsafe<Array<{ count: number; cursor: string | null }>>(
    `WITH candidates AS MATERIALIZED (
       SELECT target.ctid AS row_ctid
       FROM "${table}" AS target
       WHERE ${predicate}
       FOR UPDATE SKIP LOCKED
       LIMIT $${limitParameter}
     ), deleted AS (
       DELETE FROM "${table}" AS target
       USING candidates
       WHERE target.ctid = candidates.row_ctid
       RETURNING target.ctid::text AS cursor
     )
     SELECT COUNT(*)::INTEGER AS count, MAX(cursor) AS cursor FROM deleted`,
    ...parameters,
    batchSize
  );
  const affectedCount = Number(rows[0]?.count ?? 0);
  const remaining = await tx.$queryRawUnsafe<Array<{ exists: boolean }>>(
    `SELECT EXISTS (
       SELECT 1 FROM "${table}" AS target WHERE ${predicate}
     ) AS exists`,
    ...parameters
  );
  return {
    affectedCount,
    hasMore: remaining[0]?.exists === true,
    cursor: rows[0]?.cursor ?? null
  };
}

export async function deleteBoundedRows(
  tx: BoundedErasureTransaction,
  table: string,
  predicate: string,
  parameters: unknown[],
  batchSize = ERASURE_BATCH_SIZE
): Promise<ErasureBatchResult> {
  return deleteWhere(tx, table, predicate, parameters, batchSize);
}

export async function updateBoundedRows(
  tx: BoundedErasureTransaction,
  table: string,
  predicate: string,
  parameters: unknown[],
  assignments: string,
  batchSize = ERASURE_BATCH_SIZE
): Promise<ErasureBatchResult> {
  assertMutableTable(table);
  const limitParameter = parameters.length + 1;
  const rows = await tx.$queryRawUnsafe<Array<{ count: number; cursor: string | null }>>(
    `WITH candidates AS MATERIALIZED (
       SELECT target.ctid AS row_ctid
       FROM "${table}" AS target
       WHERE ${predicate}
       FOR UPDATE SKIP LOCKED
       LIMIT $${limitParameter}
     ), updated AS (
       UPDATE "${table}" AS target
       SET ${assignments}
       FROM candidates
       WHERE target.ctid = candidates.row_ctid
       RETURNING target.ctid::text AS cursor
     )
     SELECT COUNT(*)::INTEGER AS count, MAX(cursor) AS cursor FROM updated`,
    ...parameters,
    batchSize
  );
  const remaining = await tx.$queryRawUnsafe<Array<{ exists: boolean }>>(
    `SELECT EXISTS (
       SELECT 1 FROM "${table}" AS target WHERE ${predicate}
     ) AS exists`,
    ...parameters
  );
  return {
    affectedCount: Number(rows[0]?.count ?? 0),
    hasMore: remaining[0]?.exists === true,
    cursor: rows[0]?.cursor ?? null
  };
}

async function cleanupLegacyRatingRefreshJobs(
  tx: BoundedErasureTransaction,
  deletionRequestId: string,
  batchSize: number
): Promise<ErasureBatchResult> {
  return deleteWhere(
    tx,
    "AccountDeletionRatingRefreshJob",
    'target."deletionRequestId" = $1',
    [deletionRequestId],
    batchSize
  );
}

async function anonymizeCompanionProfile(
  tx: BoundedErasureTransaction,
  subject: ErasureSubject
): Promise<ErasureBatchResult> {
  if (!subject.companionId) return { affectedCount: 0, hasMore: false, cursor: null };
  const changed = await tx.$executeRaw`
    UPDATE "CompanionProfile"
    SET
      "name" = '已注销陪伴者',
      "role" = '账号已注销',
      "initials" = '—',
      "isOnline" = FALSE,
      "isVerified" = FALSE,
      "bio" = '账号已注销，公开资料不再展示。',
      "availableTimes" = ARRAY[]::TEXT[],
      "languages" = ARRAY[]::TEXT[],
      "specialties" = ARRAY[]::TEXT[],
      "responseTime" = '不再接单',
      "distanceKm" = 0,
      "availability" = 'busy',
      "cityDistrict" = '',
      "topicIds" = ARRAY[]::TEXT[],
      "livedExperience" = NULL,
      "serviceBoundaries" = ARRAY[]::TEXT[],
      "voiceIntroAssetRef" = NULL,
      "voiceIntroDurationSeconds" = NULL,
      "voiceIntroStatus" = 'notSubmitted',
      "isPublished" = FALSE
    WHERE "id" = ${subject.companionId}
      AND "ownerUserId" = ${subject.userId}
  `;
  await tx.$executeRaw`
    UPDATE "CompanionCommercialProfile"
    SET
      "status" = 'suspended',
      "suspendedAt" = CURRENT_TIMESTAMP,
      "suspendedById" = COALESCE(${subject.approvalActorId ?? null}, "suspendedById"),
      "suspendedReason" = 'account_deletion_completed',
      "nextReviewDueAt" = NULL,
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE "companionId" = ${subject.companionId}
  `;
  return {
    affectedCount: Number(changed),
    hasMore: false,
    cursor: subject.companionId
  };
}

async function boundMediaRetention(
  tx: BoundedErasureTransaction,
  subject: ErasureSubject,
  batchSize: number
): Promise<ErasureBatchResult> {
  if (!subject.mediaRetentionEndsAt) {
    throw new Error("Account deletion media retention deadline is missing");
  }
  const rows = await tx.$queryRaw<Array<{ count: number; cursor: string | null }>>`
    WITH candidates AS MATERIALIZED (
      SELECT asset."id"
      FROM "MediaAsset" AS asset
      WHERE asset."uploaderId" = ${subject.userId}
        AND asset."expiresAt" IS DISTINCT FROM ${subject.mediaRetentionEndsAt}
      ORDER BY asset."id"
      FOR UPDATE SKIP LOCKED
      LIMIT ${batchSize}
    ), updated AS (
      UPDATE "MediaAsset" AS asset
      SET "expiresAt" = ${subject.mediaRetentionEndsAt}, "updatedAt" = CURRENT_TIMESTAMP
      FROM candidates
      WHERE asset."id" = candidates."id"
      RETURNING asset."id"
    )
    SELECT COUNT(*)::INTEGER AS count, MAX("id") AS cursor FROM updated
  `;
  const remaining = await tx.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT 1 FROM "MediaAsset"
      WHERE "uploaderId" = ${subject.userId}
        AND "expiresAt" IS DISTINCT FROM ${subject.mediaRetentionEndsAt}
    ) AS exists
  `;
  return {
    affectedCount: Number(rows[0]?.count ?? 0),
    hasMore: remaining[0]?.exists === true,
    cursor: rows[0]?.cursor ?? null
  };
}

export async function eraseSubjectPhaseBatch(
  tx: BoundedErasureTransaction,
  phase: string,
  subject: ErasureSubject,
  batchSize = ERASURE_BATCH_SIZE
): Promise<ErasureBatchResult> {
  const userPredicate: Record<string, [string, string]> = {
    pending_customer_adult_eligibility: [
      "CustomerAdultEligibility",
      'target."userId" = $1 AND target."status" = \'pending\''
    ],
    notification_delivery: ["NotificationDelivery", 'target."userId" = $1'],
    notification: ["Notification", 'target."userId" = $1'],
    subscription_grant: ["WeChatSubscriptionGrant", 'target."userId" = $1'],
    recommendation_request: ["RecommendationRequest", 'target."userId" = $1'],
    recommendation_tag: ["UserRecommendationTag", 'target."userId" = $1'],
    recommendation_preference: ["UserRecommendationPreference", 'target."userId" = $1'],
    recommendation_exclusion: ["UserCompanionRecommendationExclusion", 'target."userId" = $1'],
    companion_favorite: ["CompanionFavorite", 'target."userId" = $1'],
    companion_recent_view: ["CompanionRecentView", 'target."userId" = $1'],
    message_read_state: ["MessageReadState", 'target."userId" = $1'],
    conversation_notification_preference: ["ConversationNotificationPreference", 'target."userId" = $1'],
    conversation_block: ["ConversationBlock", 'target."blockedByUserId" = $1'],
    refresh_token: ["RefreshToken", 'target."userId" = $1'],
    auth_identity: ["AuthIdentity", 'target."userId" = $1'],
    staff_credential: ["StaffCredential", 'target."userId" = $1'],
    user_profile: ["UserProfile", 'target."userId" = $1'],
    community_like: ["CommunityLike", 'target."userId" = $1'],
    community_report: ["CommunityPostReport", 'target."reporterUserId" = $1'],
    community_post: ["CommunityPost", 'target."authorId" = $1']
  };

  const direct = userPredicate[phase];
  if (direct) {
    return deleteWhere(tx, direct[0], direct[1], [subject.userId], batchSize);
  }

  if (phase === "recommendation_impression") {
    return deleteWhere(
      tx,
      "RecommendationImpression",
      'EXISTS (SELECT 1 FROM "RecommendationRequest" request WHERE request."id" = target."requestId" AND request."userId" = $1)',
      [subject.userId],
      batchSize
    );
  }

  if (phase === "availability_reminder_candidate") {
    const predicate = subject.companionId
      ? '(target."companionId" = $2 OR EXISTS (SELECT 1 FROM "CompanionFavorite" favorite WHERE favorite."id" = target."favoriteId" AND favorite."userId" = $1))'
      : 'EXISTS (SELECT 1 FROM "CompanionFavorite" favorite WHERE favorite."id" = target."favoriteId" AND favorite."userId" = $1)';
    const parameters = subject.companionId ? [subject.userId, subject.companionId] : [subject.userId];
    return deleteWhere(tx, "AvailabilityReminderCandidate", predicate, parameters, batchSize);
  }

  if (phase === "availability_reminder_fanout_job") {
    if (!subject.companionId) return { affectedCount: 0, hasMore: false, cursor: null };
    return deleteWhere(
      tx,
      "AvailabilityReminderFanoutJob",
      'target."companionId" = $1',
      [subject.companionId],
      batchSize
    );
  }

  if (phase === "future_booking_boundary") {
    const predicate = subject.companionId
      ? 'target."customerUserId" = $1 OR target."companionId" = $2'
      : 'target."customerUserId" = $1';
    const parameters = subject.companionId
      ? [subject.userId, subject.companionId]
      : [subject.userId];
    return deleteWhere(
      tx,
      "CompanionCustomerFutureBoundary",
      predicate,
      parameters,
      batchSize
    );
  }

  if (phase === "companion_availability_deactivate") {
    if (!subject.companionId) return { affectedCount: 0, hasMore: false, cursor: null };
    return updateBoundedRows(
      tx,
      "CompanionAvailabilityWindow",
      'target."companionId" = $1 AND target."isActive" = TRUE',
      [subject.companionId],
      '"isActive" = FALSE, "updatedAt" = CURRENT_TIMESTAMP',
      batchSize
    );
  }

  if (phase === "verification_code") {
    return deleteWhere(
      tx,
      "VerificationCode",
      `target."phone" IN (
        SELECT identity."providerId"
        FROM "AuthIdentity" AS identity
        WHERE identity."userId" = $1
          AND identity."provider"::TEXT = 'phone'
        UNION
        SELECT profile."phone"
        FROM "UserProfile" AS profile
        WHERE profile."userId" = $1
          AND profile."phone" IS NOT NULL
      )`,
      [subject.userId],
      batchSize
    );
  }

  if (phase === "recurring_window_detach") {
    if (!subject.companionId) return { affectedCount: 0, hasMore: false, cursor: null };
    return updateBoundedRows(
      tx,
      "CompanionAvailabilityWindow",
      'target."companionId" = $1 AND target."recurringAvailabilityRuleId" IS NOT NULL',
      [subject.companionId],
      '"recurringAvailabilityRuleId" = NULL, "recurringOccurrenceStartsAt" = NULL, "updatedAt" = CURRENT_TIMESTAMP',
      batchSize
    );
  }

  if (phase === "order_service_offering_detach") {
    if (!subject.companionId) return { affectedCount: 0, hasMore: false, cursor: null };
    return updateBoundedRows(
      tx,
      "Order",
      `target."serviceOfferingId" IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM "CompanionServiceOffering" AS offering
          WHERE offering."id" = target."serviceOfferingId"
            AND offering."companionId" = $1
        )`,
      [subject.companionId],
      '"serviceOfferingId" = NULL, "updatedAt" = CURRENT_TIMESTAMP',
      batchSize
    );
  }

  const companionPredicate: Record<string, [string, string]> = {
    companion_availability_window: [
      "CompanionAvailabilityWindow",
      'target."companionId" = $1 AND NOT EXISTS (SELECT 1 FROM "Order" orders WHERE orders."availabilityWindowId" = target."id")'
    ],
    companion_recurring_rule: ["CompanionRecurringAvailabilityRule", 'target."companionId" = $1'],
    companion_blackout: ["CompanionAvailabilityBlackout", 'target."companionId" = $1'],
    companion_recommendation_policy: ["CompanionRecommendationPolicy", 'target."companionId" = $1'],
    companion_offering: ["CompanionServiceOffering", 'target."companionId" = $1'],
    companion_service_tag: ["CompanionServiceTag", 'target."companionId" = $1']
  };
  const companionDirect = companionPredicate[phase];
  if (companionDirect) {
    if (!subject.companionId) return { affectedCount: 0, hasMore: false, cursor: null };
    return deleteWhere(tx, companionDirect[0], companionDirect[1], [subject.companionId], batchSize);
  }

  if (phase === "authored_post_like") {
    return deleteWhere(
      tx,
      "CommunityLike",
      'EXISTS (SELECT 1 FROM "CommunityPost" post WHERE post."id" = target."postId" AND post."authorId" = $1)',
      [subject.userId],
      batchSize
    );
  }
  if (phase === "authored_post_report") {
    return deleteWhere(
      tx,
      "CommunityPostReport",
      'EXISTS (SELECT 1 FROM "CommunityPost" post WHERE post."id" = target."postId" AND post."authorId" = $1)',
      [subject.userId],
      batchSize
    );
  }
  if (phase === "review") {
    return deleteWhere(tx, "Review", 'target."userId" = $1', [subject.userId], batchSize);
  }
  if (phase === "rating_refresh") {
    return cleanupLegacyRatingRefreshJobs(
      tx,
      subject.deletionRequestId,
      Math.min(batchSize, RATING_REFRESH_BATCH_SIZE)
    );
  }
  if (phase === "companion_profile") {
    return anonymizeCompanionProfile(tx, subject);
  }
  if (phase === "media_retention") {
    return boundMediaRetention(tx, subject, batchSize);
  }
  throw new Error(`Unsupported bounded account erasure phase: ${phase}`);
}

export function nextAccountDeletionPhase(phase: string): string | null {
  const index = ACCOUNT_DELETION_PHASES.indexOf(phase as AccountDeletionPhase);
  if (index < 0) throw new Error(`Unsupported account deletion phase: ${phase}`);
  return ACCOUNT_DELETION_PHASES[index + 1] ?? null;
}

export function nextRetentionImmediatePhase(category: string, phase: string): string | null {
  const phases = RETENTION_IMMEDIATE_PHASES[category];
  if (!phases) throw new Error(`Unsupported immediate retention category: ${category}`);
  const index = phases.indexOf(phase);
  if (index < 0) throw new Error(`Unsupported retention erasure phase: ${category}/${phase}`);
  return phases[index + 1] ?? null;
}
