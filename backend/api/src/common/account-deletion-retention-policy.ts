export const ACCOUNT_DELETION_RETENTION_POLICY_VERSION = "2026.2-technical-baseline";

export type AccountDeletionRetentionCategory = {
  code: string;
  disposition: "deleted" | "retainedRestricted";
  retentionDays: number;
  legalBasisCode: string;
  description: string;
};

/**
 * Engineering baseline only. Production must provide an externally approved
 * reference before a deletion may be marked complete. Durations are explicit
 * so they cannot silently become indefinite retention.
 */
export const ACCOUNT_DELETION_RETENTION_CATEGORIES: readonly AccountDeletionRetentionCategory[] = [
  {
    code: "identity_authentication_profile",
    disposition: "deleted",
    retentionDays: 0,
    legalBasisCode: "deletion_request_fulfilment",
    description: "Consumer login identities, refresh sessions and direct customer/companion profile fields; workforce credentials require separate offboarding"
  },
  {
    code: "preferences_behavior_notifications",
    disposition: "deleted",
    retentionDays: 0,
    legalBasisCode: "purpose_ended",
    description: "Recommendations, favorites, recent views, notification grants, conversation controls and purpose-ended companion schedules"
  },
  {
    code: "public_user_content",
    disposition: "deleted",
    retentionDays: 0,
    legalBasisCode: "purpose_ended",
    description: "Community posts, likes, report receipts, public reviews and companion marketplace listings"
  },
  {
    code: "transactions_tax_invoices",
    disposition: "retainedRestricted",
    retentionDays: 3650,
    legalBasisCode: "statutory_financial_recordkeeping_pending_legal_approval",
    description: "Orders, payments, refunds, companion earnings/withdrawals/recoveries, settlement identity and invoice evidence"
  },
  {
    code: "support_disputes_safety",
    disposition: "retainedRestricted",
    retentionDays: 1095,
    legalBasisCode: "claims_and_safety_evidence_pending_legal_approval",
    description: "Support, service/reschedule/attendance disputes, payment complaints, voice attendance, companion incidents, moderation and communication evidence"
  },
  {
    code: "consent_rights_account_governance",
    disposition: "retainedRestricted",
    retentionDays: 1095,
    legalBasisCode: "rights_and_compliance_evidence_pending_legal_approval",
    description: "Consent receipts, data-rights and identity-review cases, customer/companion account actions, training and appeals"
  },
  {
    code: "deletion_audit_evidence",
    disposition: "retainedRestricted",
    retentionDays: 3650,
    legalBasisCode: "accountability_evidence_pending_legal_approval",
    description: "Deletion request, disposition ledger and minimally necessary audit evidence"
  }
] as const;

export function retentionEndsAt(completedAt: Date, retentionDays: number): Date {
  return new Date(completedAt.getTime() + retentionDays * 24 * 60 * 60_000);
}
