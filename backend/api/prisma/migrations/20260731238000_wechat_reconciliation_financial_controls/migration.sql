BEGIN;

CREATE TYPE "WeChatReconciliationResolutionProposalStatus" AS ENUM ('pending', 'approved', 'rejected');

ALTER TABLE "PaymentTransaction"
  ADD COLUMN "providerPaidAt" TIMESTAMP(3);

ALTER TABLE "RefundTransaction"
  ADD COLUMN "providerRefundAcceptedAt" TIMESTAMP(3);

ALTER TABLE "WeChatBillEntry"
  ADD COLUMN "businessName" TEXT,
  ADD COLUMN "businessType" TEXT;

-- Existing successes without provider-authored time stay visible as blocking
-- legacy debt, while every new insert/update is fail-closed.
ALTER TABLE "PaymentTransaction"
  ADD CONSTRAINT "PaymentTransaction_success_providerPaidAt_required"
  CHECK ("status" <> 'success' OR "providerPaidAt" IS NOT NULL) NOT VALID;
ALTER TABLE "RefundTransaction"
  ADD CONSTRAINT "RefundTransaction_success_providerRefundAcceptedAt_required"
  CHECK ("status" <> 'success' OR "providerRefundAcceptedAt" IS NOT NULL) NOT VALID;

CREATE INDEX "PaymentTransaction_status_providerPaidAt_idx"
  ON "PaymentTransaction"("status", "providerPaidAt");
CREATE INDEX "RefundTransaction_status_providerRefundAcceptedAt_idx"
  ON "RefundTransaction"("status", "providerRefundAcceptedAt");

CREATE TABLE "WeChatReconciliationResolutionProposal" (
  "id" TEXT NOT NULL,
  "issueId" TEXT NOT NULL,
  "outcome" "WeChatReconciliationIssueStatus" NOT NULL,
  "resolutionCode" TEXT NOT NULL,
  "resolutionNote" TEXT NOT NULL,
  "evidenceReference" TEXT NOT NULL,
  "evidenceDigestSha256" TEXT NOT NULL,
  "proposedByUserId" TEXT NOT NULL,
  "proposedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status" "WeChatReconciliationResolutionProposalStatus" NOT NULL DEFAULT 'pending',
  "reviewedByUserId" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "reviewNote" TEXT,
  CONSTRAINT "WeChatReconciliationResolutionProposal_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WeChatReconciliationResolutionProposal_outcome_check"
    CHECK ("outcome" IN ('resolved', 'acceptedException')),
  CONSTRAINT "WeChatReconciliationResolutionProposal_digest_check"
    CHECK ("evidenceDigestSha256" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "WeChatReconciliationResolutionProposal_independent_reviewer_check"
    CHECK ("reviewedByUserId" IS NULL OR "reviewedByUserId" <> "proposedByUserId"),
  CONSTRAINT "WeChatReconciliationResolutionProposal_review_state_check"
    CHECK (
      ("status" = 'pending' AND "reviewedByUserId" IS NULL AND "reviewedAt" IS NULL AND "reviewNote" IS NULL)
      OR
      ("status" IN ('approved', 'rejected') AND "reviewedByUserId" IS NOT NULL AND "reviewedAt" IS NOT NULL AND "reviewNote" IS NOT NULL)
    )
);

ALTER TABLE "WeChatReconciliationResolutionProposal"
  ADD CONSTRAINT "WeChatReconciliationResolutionProposal_issueId_fkey"
  FOREIGN KEY ("issueId") REFERENCES "WeChatReconciliationIssue"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WeChatReconciliationResolutionProposal"
  ADD CONSTRAINT "WeChatReconciliationResolutionProposal_proposedByUserId_fkey"
  FOREIGN KEY ("proposedByUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WeChatReconciliationResolutionProposal"
  ADD CONSTRAINT "WeChatReconciliationResolutionProposal_reviewedByUserId_fkey"
  FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "WeChatReconciliationResolutionProposal_one_pending_per_issue"
  ON "WeChatReconciliationResolutionProposal"("issueId")
  WHERE "status" = 'pending';
CREATE INDEX "WeChatResolutionProposal_issue_status_time"
  ON "WeChatReconciliationResolutionProposal"("issueId", "status", "proposedAt");
CREATE INDEX "WeChatReconciliationResolutionProposal_status_proposedAt_idx"
  ON "WeChatReconciliationResolutionProposal"("status", "proposedAt");

-- Previously human-closed discrepancies did not have independent approval.
-- Re-open them without deleting the old resolution text so finance can submit
-- fresh immutable evidence and obtain a second review. The one machine-proof
-- recovery remains closed because a verified replacement statement is itself
-- the authoritative second fact.
UPDATE "WeChatReconciliationIssue"
SET "status" = 'investigating'
WHERE "status" IN ('resolved', 'acceptedException')
  AND COALESCE("resolutionCode", '') <> 'providerStatementRecovered';

CREATE FUNCTION "protect_wechat_provider_financial_times"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'PaymentTransaction' THEN
    IF OLD."providerPaidAt" IS NOT NULL
       AND NEW."providerPaidAt" IS DISTINCT FROM OLD."providerPaidAt" THEN
      RAISE EXCEPTION 'WeChat provider payment time is immutable';
    END IF;
    IF OLD."status" <> 'success' AND NEW."status" = 'success'
       AND NEW."providerPaidAt" IS NULL THEN
      RAISE EXCEPTION 'WeChat provider payment time is required on success';
    END IF;
  ELSE
    IF OLD."providerRefundAcceptedAt" IS NOT NULL
       AND NEW."providerRefundAcceptedAt" IS DISTINCT FROM OLD."providerRefundAcceptedAt" THEN
      RAISE EXCEPTION 'WeChat provider refund time is immutable';
    END IF;
    IF OLD."status" <> 'success' AND NEW."status" = 'success'
       AND NEW."providerRefundAcceptedAt" IS NULL THEN
      RAISE EXCEPTION 'WeChat provider refund time is required on success';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "PaymentTransaction_protect_provider_paid_at"
  BEFORE UPDATE ON "PaymentTransaction"
  FOR EACH ROW EXECUTE FUNCTION "protect_wechat_provider_financial_times"();
CREATE TRIGGER "RefundTransaction_protect_provider_refund_accepted_at"
  BEFORE UPDATE ON "RefundTransaction"
  FOR EACH ROW EXECUTE FUNCTION "protect_wechat_provider_financial_times"();

CREATE FUNCTION "protect_wechat_reconciliation_resolution_proposal"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'WeChat reconciliation resolution proposals are immutable audit records';
  END IF;
  IF NEW."issueId" IS DISTINCT FROM OLD."issueId"
     OR NEW."outcome" IS DISTINCT FROM OLD."outcome"
     OR NEW."resolutionCode" IS DISTINCT FROM OLD."resolutionCode"
     OR NEW."resolutionNote" IS DISTINCT FROM OLD."resolutionNote"
     OR NEW."evidenceReference" IS DISTINCT FROM OLD."evidenceReference"
     OR NEW."evidenceDigestSha256" IS DISTINCT FROM OLD."evidenceDigestSha256"
     OR NEW."proposedByUserId" IS DISTINCT FROM OLD."proposedByUserId"
     OR NEW."proposedAt" IS DISTINCT FROM OLD."proposedAt" THEN
    RAISE EXCEPTION 'WeChat reconciliation proposal evidence is immutable';
  END IF;
  IF OLD."status" <> 'pending' THEN
    RAISE EXCEPTION 'Reviewed WeChat reconciliation proposals are immutable';
  END IF;
  IF NEW."status" = 'pending' THEN
    RAISE EXCEPTION 'A WeChat reconciliation proposal review must be terminal';
  END IF;
  IF NEW."reviewedByUserId" = OLD."proposedByUserId" THEN
    RAISE EXCEPTION 'WeChat reconciliation proposal requires an independent reviewer';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "WeChatReconciliationResolutionProposal_immutable"
  BEFORE UPDATE OR DELETE ON "WeChatReconciliationResolutionProposal"
  FOR EACH ROW EXECUTE FUNCTION "protect_wechat_reconciliation_resolution_proposal"();

CREATE FUNCTION "enforce_wechat_reconciliation_finalization"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."status" IN ('resolved', 'acceptedException')
     AND NEW."status" IS DISTINCT FROM OLD."status"
     AND COALESCE(NEW."resolutionCode", '') <> 'providerStatementRecovered' THEN
    IF OLD."status" <> 'investigating' THEN
      RAISE EXCEPTION 'WeChat reconciliation finalization requires an investigating issue';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM "WeChatReconciliationResolutionProposal" proposal
      WHERE proposal."issueId" = NEW."id"
        AND proposal."status" = 'approved'
        AND proposal."outcome" = NEW."status"
        AND proposal."reviewedByUserId" = NEW."resolvedByUserId"
        AND proposal."resolutionCode" = NEW."resolutionCode"
        AND proposal."resolutionNote" = NEW."resolutionNote"
    ) THEN
      RAISE EXCEPTION 'WeChat reconciliation finalization requires an independently approved proposal';
    END IF;
    IF NEW."status" = 'acceptedException' AND NOT EXISTS (
      SELECT 1 FROM "User" reviewer
      WHERE reviewer."id" = NEW."resolvedByUserId"
        AND reviewer."role"::text = 'admin'
    ) THEN
      RAISE EXCEPTION 'A WeChat reconciliation exception requires admin approval';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "WeChatReconciliationIssue_independent_finalization"
  BEFORE UPDATE ON "WeChatReconciliationIssue"
  FOR EACH ROW EXECUTE FUNCTION "enforce_wechat_reconciliation_finalization"();

COMMIT;
