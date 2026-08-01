BEGIN;

CREATE TYPE "WeChatBillImportProposalStatus" AS ENUM ('pending', 'approved', 'rejected');

ALTER TABLE "RefundTransaction"
  ADD COLUMN "providerRefundSucceededAt" TIMESTAMP(3);
CREATE INDEX "RefundTransaction_status_providerRefundSucceededAt_idx"
  ON "RefundTransaction"("status", "providerRefundSucceededAt");
ALTER TABLE "RefundTransaction"
  ADD CONSTRAINT "RefundTransaction_success_providerRefundSucceededAt_required"
  CHECK ("status" <> 'success' OR "providerRefundSucceededAt" IS NOT NULL) NOT VALID;
ALTER TABLE "RefundTransaction"
  ADD CONSTRAINT "RefundTransaction_provider_refund_time_order_check"
  CHECK (
    "providerRefundSucceededAt" IS NULL
    OR (
      "providerRefundAcceptedAt" IS NOT NULL
      AND "providerRefundSucceededAt" >= "providerRefundAcceptedAt"
    )
  ) NOT VALID;

ALTER TABLE "WeChatBillReconciliationRun"
  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'api',
  ADD COLUMN "importProposalId" TEXT;
CREATE UNIQUE INDEX "WeChatBillReconciliationRun_importProposalId_key"
  ON "WeChatBillReconciliationRun"("importProposalId");
ALTER TABLE "WeChatBillReconciliationRun"
  ADD CONSTRAINT "WeChatBillReconciliationRun_source_check"
  CHECK (
    ("source" = 'api' AND "importProposalId" IS NULL)
    OR ("source" = 'merchantPlatform' AND "importProposalId" IS NOT NULL)
  );

ALTER TABLE "WeChatBillEntry"
  ADD COLUMN "providerRefundAcceptedAt" TIMESTAMP(3),
  ADD COLUMN "providerRefundSucceededAt" TIMESTAMP(3);

CREATE TABLE "WeChatBillImportProposal" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'wechat',
  "source" TEXT NOT NULL DEFAULT 'merchantPlatform',
  "billDate" DATE NOT NULL,
  "kind" "WeChatBillKind" NOT NULL,
  "status" "WeChatBillImportProposalStatus" NOT NULL DEFAULT 'pending',
  "contentSha256" TEXT NOT NULL,
  "normalizedSha256" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "entryCount" INTEGER NOT NULL,
  "evidenceReference" TEXT NOT NULL,
  "proposedByUserId" TEXT NOT NULL,
  "proposedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedByUserId" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "reviewNote" TEXT,
  CONSTRAINT "WeChatBillImportProposal_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WeChatBillImportProposal_source_check" CHECK ("source" = 'merchantPlatform'),
  CONSTRAINT "WeChatBillImportProposal_content_digest_check" CHECK ("contentSha256" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "WeChatBillImportProposal_normalized_digest_check" CHECK ("normalizedSha256" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "WeChatBillImportProposal_size_check" CHECK ("sizeBytes" > 0 AND "sizeBytes" <= 20971520),
  CONSTRAINT "WeChatBillImportProposal_entry_count_check" CHECK ("entryCount" >= 0 AND "entryCount" <= 250000),
  CONSTRAINT "WeChatBillImportProposal_independent_reviewer_check"
    CHECK ("reviewedByUserId" IS NULL OR "reviewedByUserId" <> "proposedByUserId"),
  CONSTRAINT "WeChatBillImportProposal_review_state_check" CHECK (
    ("status" = 'pending' AND "reviewedByUserId" IS NULL AND "reviewedAt" IS NULL AND "reviewNote" IS NULL)
    OR
    ("status" IN ('approved', 'rejected') AND "reviewedByUserId" IS NOT NULL AND "reviewedAt" IS NOT NULL AND "reviewNote" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "WeChatBillImportProposal_active_content_key"
  ON "WeChatBillImportProposal"("provider", "billDate", "kind", "contentSha256")
  WHERE "status" IN ('pending', 'approved');
CREATE UNIQUE INDEX "WeChatBillImportProposal_one_pending_per_bill"
  ON "WeChatBillImportProposal"("provider", "billDate", "kind") WHERE "status" = 'pending';
CREATE INDEX "WeChatBillImportProposal_status_proposedAt_idx"
  ON "WeChatBillImportProposal"("status", "proposedAt");
CREATE INDEX "WeChatBillImportProposal_billDate_kind_status_idx"
  ON "WeChatBillImportProposal"("billDate", "kind", "status");

ALTER TABLE "WeChatBillImportProposal"
  ADD CONSTRAINT "WeChatBillImportProposal_proposedByUserId_fkey"
  FOREIGN KEY ("proposedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WeChatBillImportProposal"
  ADD CONSTRAINT "WeChatBillImportProposal_reviewedByUserId_fkey"
  FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WeChatBillReconciliationRun"
  ADD CONSTRAINT "WeChatBillReconciliationRun_importProposalId_fkey"
  FOREIGN KEY ("importProposalId") REFERENCES "WeChatBillImportProposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "WeChatBillImportEntry" (
  "id" TEXT NOT NULL,
  "proposalId" TEXT NOT NULL,
  "lineNumber" INTEGER NOT NULL,
  "entryType" TEXT NOT NULL,
  "providerOccurredAt" TIMESTAMP(3),
  "providerRefundAcceptedAt" TIMESTAMP(3),
  "providerRefundSucceededAt" TIMESTAMP(3),
  "outTradeNo" TEXT,
  "transactionId" TEXT,
  "outRefundNo" TEXT,
  "providerRefundId" TEXT,
  "businessReference" TEXT,
  "businessName" TEXT,
  "businessType" TEXT,
  "tradeState" TEXT,
  "refundState" TEXT,
  "amountCents" INTEGER,
  "refundAmountCents" INTEGER,
  "feeCents" INTEGER,
  "fundDirection" TEXT,
  "fundAmountCents" INTEGER,
  "accountType" TEXT,
  "rowDigest" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WeChatBillImportEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WeChatBillImportEntry_type_check" CHECK ("entryType" IN ('trade', 'fund')),
  CONSTRAINT "WeChatBillImportEntry_digest_check" CHECK ("rowDigest" ~ '^[a-f0-9]{64}$')
);
CREATE UNIQUE INDEX "WeChatBillImportEntry_proposalId_lineNumber_key"
  ON "WeChatBillImportEntry"("proposalId", "lineNumber");
CREATE INDEX "WeChatBillImportEntry_outTradeNo_idx" ON "WeChatBillImportEntry"("outTradeNo");
CREATE INDEX "WeChatBillImportEntry_outRefundNo_idx" ON "WeChatBillImportEntry"("outRefundNo");
CREATE INDEX "WeChatBillImportEntry_businessReference_idx" ON "WeChatBillImportEntry"("businessReference");
ALTER TABLE "WeChatBillImportEntry"
  ADD CONSTRAINT "WeChatBillImportEntry_proposalId_fkey"
  FOREIGN KEY ("proposalId") REFERENCES "WeChatBillImportProposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "CashLedgerEntry" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'wechat',
  "accountType" TEXT NOT NULL,
  "bookedAt" TIMESTAMP(3) NOT NULL,
  "expectedStatementDate" DATE,
  "businessName" TEXT NOT NULL,
  "businessType" TEXT NOT NULL,
  "direction" TEXT NOT NULL,
  "grossCents" INTEGER NOT NULL,
  "feeCents" INTEGER NOT NULL DEFAULT 0,
  "netCents" INTEGER NOT NULL,
  "providerReference" TEXT NOT NULL,
  "sourceResourceType" TEXT NOT NULL,
  "sourceResourceId" TEXT NOT NULL,
  "evidenceReference" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CashLedgerEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CashLedgerEntry_account_check" CHECK ("accountType" IN ('UNCLASSIFIED', 'BASIC', 'OPERATION', 'FEES')),
  CONSTRAINT "CashLedgerEntry_direction_check" CHECK ("direction" IN ('收入', '支出')),
  CONSTRAINT "CashLedgerEntry_amount_check" CHECK (
    "grossCents" >= 0 AND "feeCents" >= 0 AND "netCents" >= 0
    AND "netCents" = "grossCents" - "feeCents"
  ),
  CONSTRAINT "CashLedgerEntry_source_check" CHECK ("sourceResourceType" IN ('paymentTransaction', 'refundTransaction', 'settlement', 'fee'))
);
CREATE UNIQUE INDEX "CashLedgerEntry_provider_account_reference_business_key"
  ON "CashLedgerEntry"("provider", "accountType", "providerReference", "businessType");
CREATE UNIQUE INDEX "CashLedgerEntry_source_resource_business_key"
  ON "CashLedgerEntry"("sourceResourceType", "sourceResourceId", "businessType");
CREATE INDEX "CashLedgerEntry_expectedStatementDate_accountType_idx"
  ON "CashLedgerEntry"("expectedStatementDate", "accountType");
CREATE INDEX "CashLedgerEntry_providerReference_idx" ON "CashLedgerEntry"("providerReference");
CREATE INDEX "CashLedgerEntry_bookedAt_idx" ON "CashLedgerEntry"("bookedAt");

-- Existing successful payments already carry an authoritative provider event
-- time. Bring them into the new local cash ledger without guessing an account
-- or statement date; the independent classification workflow closes those two
-- fields later. Legacy refunds deliberately stay blocked until both distinct
-- provider times are repaired from exact provider/import evidence.
INSERT INTO "CashLedgerEntry" (
  "id", "provider", "accountType", "bookedAt", "expectedStatementDate",
  "businessName", "businessType", "direction", "grossCents", "feeCents",
  "netCents", "providerReference", "sourceResourceType", "sourceResourceId",
  "evidenceReference"
)
SELECT
  gen_random_uuid()::text,
  'wechat',
  'UNCLASSIFIED',
  payment."providerPaidAt",
  NULL,
  '支付入账',
  'PAYMENT',
  '收入',
  payment."amountCents",
  0,
  payment."amountCents",
  COALESCE(payment."transactionId", payment."outTradeNo"),
  'paymentTransaction',
  payment."id",
  'migration:finance-terminal-audit-controls:payment:' || payment."id"
FROM "PaymentTransaction" payment
WHERE payment."provider" = 'wechat'
  AND payment."status" = 'success'
  AND payment."providerPaidAt" IS NOT NULL
ON CONFLICT ("sourceResourceType", "sourceResourceId", "businessType") DO NOTHING;

CREATE TABLE "CashLedgerClassificationProposal" (
  "id" TEXT NOT NULL,
  "cashLedgerEntryId" TEXT NOT NULL,
  "accountType" TEXT NOT NULL,
  "expectedStatementDate" DATE NOT NULL,
  "evidenceReference" TEXT NOT NULL,
  "evidenceDigestSha256" TEXT NOT NULL,
  "proposedByUserId" TEXT NOT NULL,
  "proposedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status" "WeChatBillImportProposalStatus" NOT NULL DEFAULT 'pending',
  "reviewedByUserId" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "reviewNote" TEXT,
  CONSTRAINT "CashLedgerClassificationProposal_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CashLedgerClassificationProposal_account_check"
    CHECK ("accountType" IN ('BASIC', 'OPERATION', 'FEES')),
  CONSTRAINT "CashLedgerClassificationProposal_digest_check"
    CHECK ("evidenceDigestSha256" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "CashLedgerClassificationProposal_independent_reviewer_check"
    CHECK ("reviewedByUserId" IS NULL OR "reviewedByUserId" <> "proposedByUserId"),
  CONSTRAINT "CashLedgerClassificationProposal_review_state_check" CHECK (
    ("status" = 'pending' AND "reviewedByUserId" IS NULL AND "reviewedAt" IS NULL AND "reviewNote" IS NULL)
    OR
    ("status" IN ('approved', 'rejected') AND "reviewedByUserId" IS NOT NULL AND "reviewedAt" IS NOT NULL AND "reviewNote" IS NOT NULL)
  )
);
CREATE UNIQUE INDEX "CashLedgerClassificationProposal_one_pending_per_entry"
  ON "CashLedgerClassificationProposal"("cashLedgerEntryId") WHERE "status" = 'pending';
CREATE UNIQUE INDEX "CashLedgerClassificationProposal_one_approved_per_entry"
  ON "CashLedgerClassificationProposal"("cashLedgerEntryId") WHERE "status" = 'approved';
CREATE INDEX "CashLedgerClassificationProposal_entry_status"
  ON "CashLedgerClassificationProposal"("cashLedgerEntryId", "status");
CREATE INDEX "CashLedgerClassificationProposal_status_proposedAt_idx"
  ON "CashLedgerClassificationProposal"("status", "proposedAt");
ALTER TABLE "CashLedgerClassificationProposal"
  ADD CONSTRAINT "CashLedgerClassificationProposal_cashLedgerEntryId_fkey"
  FOREIGN KEY ("cashLedgerEntryId") REFERENCES "CashLedgerEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CashLedgerClassificationProposal"
  ADD CONSTRAINT "CashLedgerClassificationProposal_proposedByUserId_fkey"
  FOREIGN KEY ("proposedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CashLedgerClassificationProposal"
  ADD CONSTRAINT "CashLedgerClassificationProposal_reviewedByUserId_fkey"
  FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "PaymentDisputeOrder" (
  "id" TEXT NOT NULL,
  "disputeId" TEXT NOT NULL,
  "orderId" TEXT,
  "paymentId" TEXT,
  "outTradeNo" TEXT NOT NULL,
  "transactionId" TEXT,
  "amountCents" INTEGER NOT NULL,
  "providerSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "matchedAt" TIMESTAMP(3),
  CONSTRAINT "PaymentDisputeOrder_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PaymentDisputeOrder_amount_check" CHECK ("amountCents" >= 0)
);
CREATE UNIQUE INDEX "PaymentDisputeOrder_disputeId_outTradeNo_key"
  ON "PaymentDisputeOrder"("disputeId", "outTradeNo");
CREATE INDEX "PaymentDisputeOrder_orderId_disputeId_idx" ON "PaymentDisputeOrder"("orderId", "disputeId");
CREATE INDEX "PaymentDisputeOrder_paymentId_idx" ON "PaymentDisputeOrder"("paymentId");
CREATE INDEX "PaymentDisputeOrder_outTradeNo_idx" ON "PaymentDisputeOrder"("outTradeNo");
ALTER TABLE "PaymentDisputeOrder"
  ADD CONSTRAINT "PaymentDisputeOrder_disputeId_fkey"
  FOREIGN KEY ("disputeId") REFERENCES "PaymentDispute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentDisputeOrder"
  ADD CONSTRAINT "PaymentDisputeOrder_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PaymentDisputeOrder"
  ADD CONSTRAINT "PaymentDisputeOrder_paymentId_fkey"
  FOREIGN KEY ("paymentId") REFERENCES "PaymentTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Preserve the legacy primary display binding as the first immutable complaint
-- order. Future provider syncs add every complaint_order_info item, including
-- unmatched references.
INSERT INTO "PaymentDisputeOrder" (
  "id", "disputeId", "orderId", "paymentId", "outTradeNo", "transactionId",
  "amountCents", "providerSeenAt", "matchedAt"
)
SELECT
  gen_random_uuid()::text,
  dispute."id",
  dispute."orderId",
  dispute."paymentId",
  dispute."outTradeNo",
  payment."transactionId",
  COALESCE(payment."amountCents", 0),
  dispute."updatedAt",
  CASE WHEN dispute."orderId" IS NOT NULL AND dispute."paymentId" IS NOT NULL
    THEN dispute."updatedAt" ELSE NULL END
FROM "PaymentDispute" dispute
LEFT JOIN "PaymentTransaction" payment ON payment."id" = dispute."paymentId"
WHERE dispute."outTradeNo" IS NOT NULL
ON CONFLICT ("disputeId", "outTradeNo") DO NOTHING;

ALTER TABLE "PaymentDisputeOrder"
  ADD CONSTRAINT "PaymentDisputeOrder_local_link_all_or_nothing_check"
  CHECK (
    ("orderId" IS NULL AND "paymentId" IS NULL AND "matchedAt" IS NULL)
    OR ("orderId" IS NOT NULL AND "paymentId" IS NOT NULL AND "matchedAt" IS NOT NULL)
  ) NOT VALID;

DROP INDEX IF EXISTS "CompanionRecovery_disputeId_key";
CREATE UNIQUE INDEX "CompanionRecovery_disputeId_earningId_key"
  ON "CompanionRecovery"("disputeId", "earningId");

-- Expand the provider-time immutability guard introduced by the previous
-- migration. create_time and success_time are different immutable facts.
CREATE OR REPLACE FUNCTION "protect_wechat_provider_financial_times"()
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
      RAISE EXCEPTION 'WeChat provider refund acceptance time is immutable';
    END IF;
    IF OLD."providerRefundSucceededAt" IS NOT NULL
       AND NEW."providerRefundSucceededAt" IS DISTINCT FROM OLD."providerRefundSucceededAt" THEN
      RAISE EXCEPTION 'WeChat provider refund success time is immutable';
    END IF;
    IF OLD."status" <> 'success' AND NEW."status" = 'success'
       AND (NEW."providerRefundAcceptedAt" IS NULL OR NEW."providerRefundSucceededAt" IS NULL) THEN
      RAISE EXCEPTION 'WeChat provider refund acceptance and success times are required on success';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION "protect_wechat_bill_import_proposal"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'WeChat bill import proposals are immutable audit records';
  END IF;
  IF NEW."provider" IS DISTINCT FROM OLD."provider"
     OR NEW."source" IS DISTINCT FROM OLD."source"
     OR NEW."billDate" IS DISTINCT FROM OLD."billDate"
     OR NEW."kind" IS DISTINCT FROM OLD."kind"
     OR NEW."contentSha256" IS DISTINCT FROM OLD."contentSha256"
     OR NEW."normalizedSha256" IS DISTINCT FROM OLD."normalizedSha256"
     OR NEW."sizeBytes" IS DISTINCT FROM OLD."sizeBytes"
     OR NEW."entryCount" IS DISTINCT FROM OLD."entryCount"
     OR NEW."evidenceReference" IS DISTINCT FROM OLD."evidenceReference"
     OR NEW."proposedByUserId" IS DISTINCT FROM OLD."proposedByUserId"
     OR NEW."proposedAt" IS DISTINCT FROM OLD."proposedAt" THEN
    RAISE EXCEPTION 'WeChat bill import proposal evidence is immutable';
  END IF;
  IF OLD."status" <> 'pending' OR NEW."status" = 'pending' THEN
    RAISE EXCEPTION 'A WeChat bill import review must be one terminal transition';
  END IF;
  IF NEW."reviewedByUserId" = OLD."proposedByUserId" THEN
    RAISE EXCEPTION 'WeChat bill import requires an independent reviewer';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "WeChatBillImportProposal_immutable"
  BEFORE UPDATE OR DELETE ON "WeChatBillImportProposal"
  FOR EACH ROW EXECUTE FUNCTION "protect_wechat_bill_import_proposal"();

CREATE FUNCTION "protect_wechat_bill_import_entry"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "WeChatBillImportProposal" proposal
      WHERE proposal."id" = NEW."proposalId" AND proposal."status" = 'pending'
      -- Lock strength must conflict with the review transaction's non-key
      -- status UPDATE. This closes the append-after-approval race.
      FOR UPDATE
    ) THEN
      RAISE EXCEPTION 'Normalized WeChat bill import evidence may only be appended while pending';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Normalized WeChat bill import evidence is immutable';
END;
$$;
CREATE TRIGGER "WeChatBillImportEntry_immutable"
  BEFORE INSERT OR UPDATE OR DELETE ON "WeChatBillImportEntry"
  FOR EACH ROW EXECUTE FUNCTION "protect_wechat_bill_import_entry"();

CREATE FUNCTION "protect_cash_ledger_classification_proposal"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Cash ledger classification proposals are immutable audit records';
  END IF;
  IF NEW."cashLedgerEntryId" IS DISTINCT FROM OLD."cashLedgerEntryId"
     OR NEW."accountType" IS DISTINCT FROM OLD."accountType"
     OR NEW."expectedStatementDate" IS DISTINCT FROM OLD."expectedStatementDate"
     OR NEW."evidenceReference" IS DISTINCT FROM OLD."evidenceReference"
     OR NEW."evidenceDigestSha256" IS DISTINCT FROM OLD."evidenceDigestSha256"
     OR NEW."proposedByUserId" IS DISTINCT FROM OLD."proposedByUserId"
     OR NEW."proposedAt" IS DISTINCT FROM OLD."proposedAt" THEN
    RAISE EXCEPTION 'Cash ledger classification evidence is immutable';
  END IF;
  IF OLD."status" <> 'pending' OR NEW."status" = 'pending' THEN
    RAISE EXCEPTION 'A cash ledger classification review must be one terminal transition';
  END IF;
  IF NEW."reviewedByUserId" = OLD."proposedByUserId" THEN
    RAISE EXCEPTION 'Cash ledger classification requires an independent reviewer';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "CashLedgerClassificationProposal_immutable"
  BEFORE UPDATE OR DELETE ON "CashLedgerClassificationProposal"
  FOR EACH ROW EXECUTE FUNCTION "protect_cash_ledger_classification_proposal"();

CREATE FUNCTION "protect_cash_ledger_entry"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Cash ledger entries are immutable';
  END IF;
  -- Only an independently approved proposal may fill the two deliberately
  -- unknown classification fields. Provider/source/amount evidence is frozen.
  IF OLD."accountType" = 'UNCLASSIFIED'
     AND OLD."expectedStatementDate" IS NULL
     AND NEW."accountType" IN ('BASIC', 'OPERATION', 'FEES')
     AND NEW."expectedStatementDate" IS NOT NULL
     AND NEW."provider" IS NOT DISTINCT FROM OLD."provider"
     AND NEW."bookedAt" IS NOT DISTINCT FROM OLD."bookedAt"
     AND NEW."businessName" IS NOT DISTINCT FROM OLD."businessName"
     AND NEW."businessType" IS NOT DISTINCT FROM OLD."businessType"
     AND NEW."direction" IS NOT DISTINCT FROM OLD."direction"
     AND NEW."grossCents" IS NOT DISTINCT FROM OLD."grossCents"
     AND NEW."feeCents" IS NOT DISTINCT FROM OLD."feeCents"
     AND NEW."netCents" IS NOT DISTINCT FROM OLD."netCents"
     AND NEW."providerReference" IS NOT DISTINCT FROM OLD."providerReference"
     AND NEW."sourceResourceType" IS NOT DISTINCT FROM OLD."sourceResourceType"
     AND NEW."sourceResourceId" IS NOT DISTINCT FROM OLD."sourceResourceId"
     AND NEW."evidenceReference" IS NOT DISTINCT FROM OLD."evidenceReference"
     AND NEW."createdAt" IS NOT DISTINCT FROM OLD."createdAt"
     AND EXISTS (
       SELECT 1 FROM "CashLedgerClassificationProposal" proposal
       WHERE proposal."cashLedgerEntryId" = OLD."id"
         AND proposal."status" = 'approved'
         AND proposal."accountType" = NEW."accountType"
         AND proposal."expectedStatementDate" = NEW."expectedStatementDate"
     ) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Cash ledger provider and source facts are immutable';
END;
$$;
CREATE TRIGGER "CashLedgerEntry_immutable"
  BEFORE UPDATE OR DELETE ON "CashLedgerEntry"
  FOR EACH ROW EXECUTE FUNCTION "protect_cash_ledger_entry"();

CREATE FUNCTION "protect_payment_dispute_order_facts"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Provider complaint order facts are immutable';
  END IF;
  IF NEW."disputeId" IS DISTINCT FROM OLD."disputeId"
     OR NEW."outTradeNo" IS DISTINCT FROM OLD."outTradeNo"
     OR NEW."transactionId" IS DISTINCT FROM OLD."transactionId"
     OR NEW."amountCents" IS DISTINCT FROM OLD."amountCents"
     OR NEW."providerSeenAt" IS DISTINCT FROM OLD."providerSeenAt"
     OR (OLD."orderId" IS NOT NULL AND NEW."orderId" IS DISTINCT FROM OLD."orderId")
     OR (OLD."paymentId" IS NOT NULL AND NEW."paymentId" IS DISTINCT FROM OLD."paymentId")
     OR (OLD."matchedAt" IS NOT NULL AND NEW."matchedAt" IS DISTINCT FROM OLD."matchedAt") THEN
    RAISE EXCEPTION 'Provider complaint order facts and established local links are immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "PaymentDisputeOrder_provider_facts_immutable"
  BEFORE UPDATE OR DELETE ON "PaymentDisputeOrder"
  FOR EACH ROW EXECUTE FUNCTION "protect_payment_dispute_order_facts"();

COMMIT;
