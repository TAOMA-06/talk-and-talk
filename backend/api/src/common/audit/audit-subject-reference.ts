export type AuditSubjectIdentifierKind = "user" | "companion";

export type AuditSubjectCandidate = {
  identifierKind: AuditSubjectIdentifierKind;
  identifier: string;
  source: "actorId" | `metadata.${string}`;
};

export type AuditSubjectReferenceWrite = {
  subjectUserId: string;
  relationKind: "actor" | "subject" | "actorAndSubject";
};

type ControlledMetadataRule = {
  key: string;
  identifierKind: AuditSubjectIdentifierKind;
};

const MAX_SUBJECT_REFERENCES_PER_AUDIT = 16;
const CONTROLLED_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/;
const NON_USER_AUDIT_ACTORS = new Set(["system"]);

/**
 * Historical AuditLog metadata may be backfilled only through this exact
 * action/key registry. Never recursively scan arbitrary JSON and guess that a
 * UUID-looking value is a user: that would both miss aliases and over-link
 * unrelated operational evidence.
 */
export const CONTROLLED_AUDIT_METADATA_SUBJECT_RULES: Readonly<
  Record<string, readonly ControlledMetadataRule[]>
> = Object.freeze({
  "account.deletion_requested": [{ key: "userId", identifierKind: "user" }],
  "account.deletion_cancelled": [
    { key: "userId", identifierKind: "user" },
    { key: "companionId", identifierKind: "companion" }
  ],
  "account.deletion_processing_started": [{ key: "userId", identifierKind: "user" }],
  "account.deletion_execution_queued": [
    { key: "userId", identifierKind: "user" },
    { key: "companionId", identifierKind: "companion" }
  ],
  "account.deletion_execution_retry_queued": [{ key: "userId", identifierKind: "user" }],
  "account.deletion_completed": [{ key: "userId", identifierKind: "user" }],
  "account.data_rights_assignment_taken_over": [
    { key: "userId", identifierKind: "user" },
    { key: "previousHandlerId", identifierKind: "user" }
  ],
  "account.data_rights_claimed": [
    { key: "userId", identifierKind: "user" },
    { key: "previousHandlerId", identifierKind: "user" }
  ],
  "account.data_rights_status_changed": [{ key: "userId", identifierKind: "user" }],
  "account.invoice_status_changed": [{ key: "userId", identifierKind: "user" }],
  "account.user_action_revoked": [{ key: "userId", identifierKind: "user" }],
  "account.status_updated": [{ key: "userId", identifierKind: "user" }],
  "account.user_action_created": [{ key: "userId", identifierKind: "user" }],
  "account.user_action_appeal_claimed": [{ key: "userId", identifierKind: "user" }],
  "account.user_action_appeal_assigned": [
    { key: "userId", identifierKind: "user" },
    { key: "previousAssignedToUserId", identifierKind: "user" },
    { key: "assignedToUserId", identifierKind: "user" }
  ],
  "account.user_action_appeal_resolved": [{ key: "userId", identifierKind: "user" }],
  "account.deletion_payment_synced": [{ key: "userId", identifierKind: "user" }],
  "account.deletion_refund_synced": [{ key: "userId", identifierKind: "user" }],
  "identity.verification_change_submitted": [{ key: "userId", identifierKind: "user" }],
  "identity.verification_change_approved": [
    { key: "userId", identifierKind: "user" },
    { key: "submittedById", identifierKind: "user" }
  ],
  "identity.verification_change_rejected": [
    { key: "userId", identifierKind: "user" },
    { key: "submittedById", identifierKind: "user" }
  ],
  "admin.staff_credential_suspended": [
    { key: "targetUserId", identifierKind: "user" },
    { key: "replacementUserId", identifierKind: "user" }
  ],
  "attendance.case_created": [
    { key: "openedByUserId", identifierKind: "user" },
    { key: "counterpartyUserId", identifierKind: "user" }
  ],
  "attendance.evidence_completed": [
    { key: "openedByUserId", identifierKind: "user" },
    { key: "counterpartyUserId", identifierKind: "user" }
  ],
  "attendance.statement_submitted": [
    { key: "openedByUserId", identifierKind: "user" },
    { key: "counterpartyUserId", identifierKind: "user" }
  ],
  "attendance.case_appealed": [
    { key: "openedByUserId", identifierKind: "user" },
    { key: "counterpartyUserId", identifierKind: "user" }
  ],
  "attendance.case_claimed": [
    { key: "openedByUserId", identifierKind: "user" },
    { key: "counterpartyUserId", identifierKind: "user" }
  ],
  "attendance.case_decided": [
    { key: "openedByUserId", identifierKind: "user" },
    { key: "counterpartyUserId", identifierKind: "user" }
  ],
  "attendance.appeal_claimed": [
    { key: "initialReviewerId", identifierKind: "user" },
    { key: "openedByUserId", identifierKind: "user" },
    { key: "counterpartyUserId", identifierKind: "user" }
  ],
  "attendance.case_finalized": [
    { key: "openedByUserId", identifierKind: "user" },
    { key: "counterpartyUserId", identifierKind: "user" },
    { key: "initialReviewerId", identifierKind: "user" }
  ],
  "attendance.refund_workflow_started": [
    { key: "openedByUserId", identifierKind: "user" },
    { key: "counterpartyUserId", identifierKind: "user" }
  ],
  "refund.requested": [
    { key: "requestedForUserId", identifierKind: "user" },
    { key: "companionId", identifierKind: "companion" }
  ],
  "favorite.companion_saved": [{ key: "companionId", identifierKind: "companion" }],
  "favorite.companion_removed": [{ key: "companionId", identifierKind: "companion" }],
  "companion.create": [{ key: "companionId", identifierKind: "companion" }],
  "companion.update": [{ key: "companionId", identifierKind: "companion" }],
  "companion.publish": [{ key: "companionId", identifierKind: "companion" }],
  "companion.unpublish": [{ key: "companionId", identifierKind: "companion" }],
  "commercial.companion_training_attempted": [{ key: "companionId", identifierKind: "companion" }],
  "commercial.companion_action_appealed": [{ key: "companionId", identifierKind: "companion" }],
  "commercial.companion_incident_created": [{ key: "companionId", identifierKind: "companion" }],
  "commercial.companion_withdrawal_requested": [{ key: "companionId", identifierKind: "companion" }],
  "commercial.companion_withdrawal_cancelled": [{ key: "companionId", identifierKind: "companion" }],
  "commercial.companion_account_action_created": [{ key: "companionId", identifierKind: "companion" }],
  "commercial.companion_quality_case_created": [{ key: "companionId", identifierKind: "companion" }],
  "commercial.companion_quality_case_closed": [{ key: "companionId", identifierKind: "companion" }],
  "commercial.companion_remediation_task_added": [{ key: "companionId", identifierKind: "companion" }],
  "commercial.companion_remediation_task_waived": [{ key: "companionId", identifierKind: "companion" }],
  "commercial.companion_remediation_task_completed": [{ key: "companionId", identifierKind: "companion" }],
  "commercial.companion_remediation_task_overdue": [{ key: "companionId", identifierKind: "companion" }],
  "commercial.companion_action_appeal_resolved": [{ key: "companionId", identifierKind: "companion" }],
  "commercial.companion_voice_intro_read_issued": [{ key: "companionId", identifierKind: "companion" }],
  "commercial.companion_voice_intro_reviewed": [{ key: "companionId", identifierKind: "companion" }],
  "commercial.companion_incident_updated": [{ key: "companionId", identifierKind: "companion" }],
  "commercial.companion_withdrawal_updated": [{ key: "companionId", identifierKind: "companion" }],
  "commercial.companion_profile_submitted": [{ key: "companionId", identifierKind: "companion" }],
  "commercial.companion_profile_verified": [
    { key: "companionId", identifierKind: "companion" },
    { key: "submittedById", identifierKind: "user" }
  ],
  "commercial.companion_profile_suspended": [{ key: "companionId", identifierKind: "companion" }],
  "commercial.earning_payout_claimed": [{ key: "companionId", identifierKind: "companion" }],
  "commercial.earning_payout_claim_cancelled": [{ key: "companionId", identifierKind: "companion" }],
  "commercial.earning_payout_evidence_held_outcome_unknown": [{ key: "companionId", identifierKind: "companion" }],
  "commercial.earning_payout_evidence_held_for_concurrent_dispute": [{ key: "companionId", identifierKind: "companion" }],
  "commercial.earning_payout_evidence_recorded": [{ key: "companionId", identifierKind: "companion" }],
  "commercial.earning_payout_verification_blocked_outcome_unknown": [{ key: "companionId", identifierKind: "companion" }],
  "commercial.earning_payout_verification_blocked_by_concurrent_dispute": [{ key: "companionId", identifierKind: "companion" }],
  "commercial.earning_payout_verified": [
    { key: "companionId", identifierKind: "companion" },
    { key: "submittedById", identifierKind: "user" }
  ],
  "commercial.recovery_evidence_recorded": [{ key: "companionId", identifierKind: "companion" }],
  "commercial.recovery_verified": [
    { key: "companionId", identifierKind: "companion" },
    { key: "evidenceSubmittedById", identifierKind: "user" }
  ],
  "moderation.chat_restriction_created": [{ key: "userId", identifierKind: "user" }],
  "moderation.manual_escalation_required": [{ key: "userId", identifierKind: "user" }],
  "order.created": [{ key: "companionId", identifierKind: "companion" }],
  "payment_dispute.assigned": [{ key: "assignedSupportUserId", identifierKind: "user" }],
  "account.deletion_refund_initiated": [
    { key: "userId", identifierKind: "user" },
    { key: "companionId", identifierKind: "companion" }
  ],
  "support.refund_initiated": [
    { key: "userId", identifierKind: "user" },
    { key: "companionId", identifierKind: "companion" }
  ],
  "attendance.refund_requested": [
    { key: "userId", identifierKind: "user" },
    { key: "companionId", identifierKind: "companion" }
  ],
  "refund.approved": [
    { key: "userId", identifierKind: "user" },
    { key: "companionId", identifierKind: "companion" }
  ],
  "refund.claimed": [
    { key: "userId", identifierKind: "user" },
    { key: "companionId", identifierKind: "companion" }
  ],
  "refund.rejected": [
    { key: "userId", identifierKind: "user" },
    { key: "companionId", identifierKind: "companion" }
  ],
  "refund.retry_requested": [
    { key: "userId", identifierKind: "user" },
    { key: "companionId", identifierKind: "companion" }
  ],
  "refund.provider_sync_requested": [
    { key: "userId", identifierKind: "user" },
    { key: "companionId", identifierKind: "companion" }
  ],
  "payment.fulfilled": [
    { key: "userId", identifierKind: "user" },
    { key: "companionId", identifierKind: "companion" }
  ],
  "refund.succeeded": [
    { key: "userId", identifierKind: "user" },
    { key: "companionId", identifierKind: "companion" }
  ],
  "support.order_fact_added": [{ key: "submittedByUserId", identifierKind: "user" }],
  "support.ticket_assigned": [
    { key: "previousAssignedToUserId", identifierKind: "user" },
    { key: "assignedToUserId", identifierKind: "user" }
  ],
  "customer.adult_eligibility_marked_adult": [
    { key: "userId", identifierKind: "user" },
    { key: "submittedById", identifierKind: "user" }
  ],
  "customer.adult_eligibility_marked_ineligible": [
    { key: "userId", identifierKind: "user" },
    { key: "submittedById", identifierKind: "user" }
  ],
  "recommendation.policy.update": [{ key: "companionId", identifierKind: "companion" }]
});

export type AuditActionSubjectPolicy =
  | "actorOnly"
  | "explicitBusinessSubject"
  | "systemWithSubject"
  | "systemOperational";

/**
 * Every production AuditService action is classified here. This registry is a
 * runtime allowlist as well as the source for the static caller gate: adding a
 * call site without first choosing its subject semantics fails closed.
 */
const ACTOR_ONLY_AUDIT_ACTIONS = [
  "account.data_export_delivered",
  "account.data_rights_information_added",
  "account.data_rights_requested",
  "account.invoice_cancelled",
  "account.invoice_requested",
  "account.other_sessions_revoked",
  "account.session_revoked",
  "account.user_action_appealed",
  "admin.login",
  "admin.login_failed",
  "customer.adult_eligibility_submitted",
  "favorite.availability_reminder_disabled",
  "favorite.availability_reminder_enabled",
  "user.login",
  "wechat.bill_reconciliation_requested",
  "wechat.bill_reconciliation_retry_requested",
  "wechat.cash_ledger_classification_approved",
  "wechat.cash_ledger_classification_proposed",
  "wechat.cash_ledger_classification_rejected",
  "wechat.merchant_bill_import_approved_and_reconciled",
  "wechat.merchant_bill_import_proposed",
  "wechat.merchant_bill_import_rejected",
  "wechat.reconciliation_issue_claimed",
  "wechat.reconciliation_resolution_approved",
  "wechat.reconciliation_resolution_proposed",
  "wechat.reconciliation_resolution_rejected",
  "wechat.refund_provider_times_repaired_from_approved_bill"
] as const;

const SYSTEM_WITH_SUBJECT_AUDIT_ACTIONS = [
  "account.deletion_execution_failed",
  "account.deletion_execution_phase_completed",
  "account.deletion_execution_retry_scheduled",
  "account.deletion_retention_snapshot_recorded",
  "account.deletion_retention_snapshot_source_completed",
  "order.companion_response_expired",
  "order.payment_reservation_expired",
  "order.reschedule_expired",
  "payment.fulfilled",
  "payment_dispute.reply_reconciled_submitted",
  "privacy.retention_category_deleted",
  "privacy.retention_category_failed",
  "privacy.retention_category_pseudonymized",
  "privacy.retention_policy_approval_applied",
  "refund.succeeded",
  "voice.room_terminated",
  "voice.room_termination_retry_scheduled"
] as const;

const SYSTEM_OPERATIONAL_AUDIT_ACTIONS = [
  "payment_dispute.provider_synced",
  "payment_dispute.wechat_notification_received",
  "privacy.retention_low_risk_cleanup_completed",
  "wechat.bill_imported_and_reconciled",
  "wechat.bill_no_statement_reconciled"
] as const;

const EXPLICIT_BUSINESS_SUBJECT_AUDIT_ACTIONS = [
  "account.data_rights_assignment_taken_over",
  "account.data_rights_claimed",
  "account.data_rights_status_changed",
  "account.deletion_cancelled",
  "account.deletion_completed",
  "account.deletion_execution_queued",
  "account.deletion_execution_retry_queued",
  "account.deletion_payment_synced",
  "account.deletion_processing_started",
  "account.deletion_refund_initiated",
  "account.deletion_refund_synced",
  "account.deletion_requested",
  "account.invoice_status_changed",
  "account.status_updated",
  "account.user_action_appeal_assigned",
  "account.user_action_appeal_claimed",
  "account.user_action_appeal_resolved",
  "account.user_action_created",
  "account.user_action_revoked",
  "admin.staff_credential_suspended",
  "attendance.appeal_claimed",
  "attendance.case_appealed",
  "attendance.case_claimed",
  "attendance.case_created",
  "attendance.case_decided",
  "attendance.case_finalized",
  "attendance.evidence_completed",
  "attendance.refund_requested",
  "attendance.refund_workflow_started",
  "attendance.statement_submitted",
  "availability_reminder.fanout_retry_scheduled",
  "availability_reminder.terminal_attempt_resolved",
  "availability_reminder.delivery_retry_scheduled",
  "availability_reminder.preparation_retry_scheduled",
  "availability_reminder.reservation_retry_scheduled",
  "commercial.companion_account_action_created",
  "commercial.companion_action_appeal_resolved",
  "commercial.companion_action_appealed",
  "commercial.companion_incident_created",
  "commercial.companion_incident_updated",
  "commercial.companion_profile_submitted",
  "commercial.companion_profile_suspended",
  "commercial.companion_profile_verified",
  "commercial.companion_quality_case_closed",
  "commercial.companion_quality_case_created",
  "commercial.companion_remediation_task_added",
  "commercial.companion_remediation_task_completed",
  "commercial.companion_remediation_task_overdue",
  "commercial.companion_remediation_task_waived",
  "commercial.companion_training_attempted",
  "commercial.companion_voice_intro_read_issued",
  "commercial.companion_voice_intro_reviewed",
  "commercial.companion_withdrawal_cancelled",
  "commercial.companion_withdrawal_requested",
  "commercial.companion_withdrawal_updated",
  "commercial.earning_payout_claim_cancelled",
  "commercial.earning_payout_claimed",
  "commercial.earning_payout_evidence_held_for_concurrent_dispute",
  "commercial.earning_payout_evidence_held_outcome_unknown",
  "commercial.earning_payout_evidence_recorded",
  "commercial.earning_payout_verification_blocked_by_concurrent_dispute",
  "commercial.earning_payout_verification_blocked_outcome_unknown",
  "commercial.earning_payout_verified",
  "commercial.recovery_evidence_recorded",
  "commercial.recovery_verified",
  "community.report_attached",
  "companion.create",
  "companion.publish",
  "companion.unpublish",
  "companion.update",
  "conversation.blocked",
  "conversation.future_booking_declined",
  "conversation.future_booking_restored",
  "conversation.unblocked",
  "create_report",
  "customer.adult_eligibility_marked_adult",
  "customer.adult_eligibility_marked_ineligible",
  "data_retention.legal_hold_placement_approved",
  "data_retention.legal_hold_placement_rejected",
  "data_retention.legal_hold_placement_requested",
  "data_retention.legal_hold_release_approved",
  "data_retention.legal_hold_release_rejected",
  "data_retention.legal_hold_release_requested",
  "favorite.companion_removed",
  "favorite.companion_saved",
  "identity.verification_change_approved",
  "identity.verification_change_rejected",
  "identity.verification_change_submitted",
  "legal.consent_reaccepted",
  "legal.consent_recorded",
  "legal.consent_upgraded",
  "legal.consent_withdrawn",
  "moderation.case_created",
  "moderation.appeal_created",
  "moderation.chat_restriction_created",
  "moderation.chat_restriction_lifted",
  "moderation.manual_escalation_required",
  "moderation.report_follow_up_added",
  "order.companion_confirmed",
  "order.companion_confirmed_service_guidelines",
  "order.companion_rejected",
  "order.created",
  "order.customer_cancelled",
  "order.customer_confirmed_completion",
  "order.customer_confirmed_service_guidelines",
  "order.customer_submitted_experience_feedback",
  "order.reschedule_accepted",
  "order.reschedule_cancelled",
  "order.reschedule_rejected",
  "order.reschedule_requested",
  "order.service_completed",
  "order.service_started",
  "payment_dispute.assigned",
  "payment_dispute.claimed",
  "payment_dispute.completed",
  "payment_dispute.completion_outcome_unknown",
  "payment_dispute.completion_submitting",
  "payment_dispute.manual_sync",
  "payment_dispute.reply_outcome_unknown",
  "payment_dispute.reply_submitted",
  "payment_dispute.reply_submitting",
  "recommendation.policy.update",
  "refund.approved",
  "refund.claimed",
  "refund.provider_sync_requested",
  "refund.rejected",
  "refund.requested",
  "refund.retry_requested",
  "support.order_fact_added",
  "support.refund_initiated",
  "support.ticket_assigned",
  "support.ticket_claimed",
  "support.ticket_created",
  "support.ticket_resolved",
  "voice.room_access_granted"
] as const;

function auditActionSubjectPolicies(): Readonly<Record<string, AuditActionSubjectPolicy>> {
  const entries: Array<readonly [string, AuditActionSubjectPolicy]> = [
    ...ACTOR_ONLY_AUDIT_ACTIONS.map((action) => [action, "actorOnly"] as const),
    ...EXPLICIT_BUSINESS_SUBJECT_AUDIT_ACTIONS.map(
      (action) => [action, "explicitBusinessSubject"] as const
    ),
    ...SYSTEM_WITH_SUBJECT_AUDIT_ACTIONS.map((action) => [action, "systemWithSubject"] as const),
    ...SYSTEM_OPERATIONAL_AUDIT_ACTIONS.map((action) => [action, "systemOperational"] as const)
  ];
  const registry = Object.fromEntries(entries);
  if (Object.keys(registry).length !== entries.length) {
    throw new Error("Audit action subject policy registry contains duplicate actions");
  }
  return Object.freeze(registry);
}

export const AUDIT_ACTION_SUBJECT_POLICIES = auditActionSubjectPolicies();

/** Exact non-literal AuditService call sites permitted by the static gate. */
export const AUDIT_DYNAMIC_ACTION_HELPERS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "favorites/availability-reminder-worker-retry.service.ts|input.action": [
    "availability_reminder.delivery_retry_scheduled",
    "availability_reminder.preparation_retry_scheduled",
    "availability_reminder.reservation_retry_scheduled"
  ],
  "legal/data-retention-legal-hold.service.ts|this.decisionAuditAction(action.action,decision)": [
    "data_retention.legal_hold_placement_approved",
    "data_retention.legal_hold_placement_rejected",
    "data_retention.legal_hold_release_approved",
    "data_retention.legal_hold_release_rejected"
  ],
  "orders/orders.service.ts|`order.${actorRole}_confirmed_service_guidelines`": [
    "order.companion_confirmed_service_guidelines",
    "order.customer_confirmed_service_guidelines"
  ],
  "voice/voice-room-control.service.ts|input.action": [
    "voice.room_terminated",
    "voice.room_termination_retry_scheduled"
  ]
});

export function auditActionSubjectPolicy(action: string): AuditActionSubjectPolicy {
  const policy = AUDIT_ACTION_SUBJECT_POLICIES[action];
  if (!policy) throw new Error(`Unclassified audit action: ${action}`);
  return policy;
}

export function requiresExplicitAuditSubjects(action: string): boolean {
  const policy = auditActionSubjectPolicy(action);
  return policy === "explicitBusinessSubject" || policy === "systemWithSubject";
}

function controlledIdentifier(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return CONTROLLED_IDENTIFIER.test(normalized) ? normalized : null;
}

export function buildAuditSubjectReferenceWrites(
  actorId: string | null | undefined,
  subjectUserIds: readonly string[] | null | undefined
): AuditSubjectReferenceWrite[] {
  const actor = actorId == null || NON_USER_AUDIT_ACTORS.has(actorId)
    ? null
    : controlledIdentifier(actorId);
  if (actorId != null && !NON_USER_AUDIT_ACTORS.has(actorId) && !actor) {
    throw new Error("Audit actor id is invalid");
  }
  if ((subjectUserIds?.length ?? 0) > MAX_SUBJECT_REFERENCES_PER_AUDIT) {
    throw new Error("Audit subject reference limit exceeded");
  }

  const explicit = new Set<string>();
  for (const candidate of subjectUserIds ?? []) {
    const subjectUserId = controlledIdentifier(candidate);
    if (!subjectUserId) throw new Error("Audit subject user id is invalid");
    explicit.add(subjectUserId);
  }
  const ids = new Set<string>(explicit);
  if (actor) ids.add(actor);
  if (ids.size > MAX_SUBJECT_REFERENCES_PER_AUDIT) {
    throw new Error("Audit subject reference limit exceeded");
  }

  return [...ids]
    .sort((left, right) => left.localeCompare(right))
    .map((subjectUserId) => ({
      subjectUserId,
      relationKind: actor === subjectUserId
        ? explicit.has(subjectUserId) ? "actorAndSubject" : "actor"
        : "subject"
    }));
}

export function controlledAuditSubjectCandidates(input: {
  actorId?: string | null;
  action: string;
  metadata?: Record<string, unknown> | null;
}): AuditSubjectCandidate[] {
  const candidates: AuditSubjectCandidate[] = [];
  const actor = input.actorId && !NON_USER_AUDIT_ACTORS.has(input.actorId)
    ? controlledIdentifier(input.actorId)
    : null;
  if (actor) {
    candidates.push({ identifierKind: "user", identifier: actor, source: "actorId" });
  }
  const rules = CONTROLLED_AUDIT_METADATA_SUBJECT_RULES[input.action] ?? [];
  for (const rule of rules) {
    const identifier = controlledIdentifier(input.metadata?.[rule.key]);
    if (!identifier) continue;
    candidates.push({
      identifierKind: rule.identifierKind,
      identifier,
      source: `metadata.${rule.key}`
    });
  }
  const unique = new Map<string, AuditSubjectCandidate>();
  for (const candidate of candidates) {
    unique.set(`${candidate.identifierKind}:${candidate.identifier}:${candidate.source}`, candidate);
  }
  return [...unique.values()];
}

/**
 * Redacts only allowlisted keys whose complete value equals a known subject
 * identifier. Substrings, nested arbitrary JSON and unrelated metadata remain
 * untouched so retention cannot silently destroy operational audit evidence.
 */
export function redactControlledAuditSubjectMetadata(
  action: string,
  metadata: Record<string, unknown> | null | undefined,
  identifiers: { userIds?: ReadonlySet<string>; companionIds?: ReadonlySet<string> }
): { metadata: Record<string, unknown> | null; redactedKeys: string[] } {
  if (!metadata) return { metadata: null, redactedKeys: [] };
  const copy = { ...metadata };
  const redactedKeys: string[] = [];
  for (const rule of CONTROLLED_AUDIT_METADATA_SUBJECT_RULES[action] ?? []) {
    const value = copy[rule.key];
    if (typeof value !== "string") continue;
    const allowed = rule.identifierKind === "user" ? identifiers.userIds : identifiers.companionIds;
    if (!allowed?.has(value)) continue;
    delete copy[rule.key];
    redactedKeys.push(rule.key);
  }
  if (redactedKeys.length) copy.retentionExpired = true;
  return { metadata: copy, redactedKeys };
}
