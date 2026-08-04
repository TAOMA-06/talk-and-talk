import { ACCOUNT_DELETION_RETAINED_SNAPSHOT_REGISTRY } from "./account-deletion-retained-snapshot.registry";

describe("account deletion retained snapshot registry", () => {
    it("pins the exact 54-source commercial retention registry", () => {
      const expected = {
        transactions_tax_invoices: [
          "orders",
          "payment_transactions",
          "refund_transactions",
          "financial_payment_dispute_orders",
          "invoice_requests",
          "companion_commercial_profiles",
          "companion_earnings",
          "companion_withdrawal_requests",
          "companion_recoveries",
          "cash_ledger_entries",
          "cash_ledger_classification_proposals",
          "wechat_bill_entries",
          "wechat_bill_reconciliation_runs",
          "wechat_reconciliation_issues",
          "wechat_reconciliation_resolution_proposals",
          "wechat_bill_import_entries",
          "wechat_bill_import_proposals"
        ],
        support_disputes_safety: [
          "support_tickets",
          "order_support_facts",
          "payment_disputes",
          "payment_dispute_orders",
          "payment_dispute_replies",
          "payment_dispute_attachments",
          "payment_dispute_notifications",
          "payment_dispute_negotiation_events",
          "attendance_disputes",
          "attendance_dispute_statements",
          "order_reschedule_requests",
          "order_timeline_events",
          "order_experience_feedback",
          "voice_sessions",
          "voice_attendance_events",
          "conversations",
          "messages",
          "media_assets",
          "controlled_case_evidence_attachments",
          "moderation_cases",
          "moderation_evidences",
          "moderation_action_logs",
          "moderation_appeals",
          "chat_restrictions",
          "crisis_interventions",
          "companion_incident_reports",
          "companion_customer_future_boundaries"
        ],
        consent_rights_account_governance: [
          "legal_consent_receipts",
          "data_rights_requests",
          "data_rights_request_follow_ups",
          "user_account_actions",
          "user_account_appeals",
          "identity_verification_requests",
          "customer_adult_eligibilities",
          "companion_training_records",
          "companion_account_actions",
          "companion_account_appeals",
          "companion_quality_cases",
          "companion_remediation_tasks"
        ]
      } as const;

      expect(ACCOUNT_DELETION_RETAINED_SNAPSHOT_REGISTRY).toHaveLength(56);
      expect(new Set(ACCOUNT_DELETION_RETAINED_SNAPSHOT_REGISTRY.map(
        (source) => `${source.category}/${source.sourceKey}`
      )).size).toBe(56);
      for (const [category, sourceKeys] of Object.entries(expected)) {
        expect(ACCOUNT_DELETION_RETAINED_SNAPSHOT_REGISTRY
          .filter((source) => source.category === category)
          .map((source) => source.sourceKey)).toEqual(sourceKeys);
      }
    });
});
