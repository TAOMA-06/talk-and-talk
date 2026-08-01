CREATE TYPE "WeChatBillKind" AS ENUM ('tradeAll', 'fundBasic', 'fundOperation', 'fundFees');
CREATE TYPE "WeChatBillRunStatus" AS ENUM ('pending', 'processing', 'noStatement', 'reconciled', 'failed');
CREATE TYPE "WeChatReconciliationIssueStatus" AS ENUM ('open', 'investigating', 'resolved', 'acceptedException');

CREATE TABLE "WeChatBillReconciliationRun" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'wechat',
  "billDate" DATE NOT NULL,
  "kind" "WeChatBillKind" NOT NULL,
  "status" "WeChatBillRunStatus" NOT NULL DEFAULT 'pending',
  "hashType" TEXT,
  "providerHash" TEXT,
  "contentSha256" TEXT,
  "downloadedBytes" INTEGER,
  "entryCount" INTEGER NOT NULL DEFAULT 0,
  "issueCount" INTEGER NOT NULL DEFAULT 0,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "leaseToken" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastErrorCode" TEXT,
  "lastErrorSummary" TEXT,
  "requestedAt" TIMESTAMP(3),
  "downloadedAt" TIMESTAMP(3),
  "importedAt" TIMESTAMP(3),
  "reconciledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WeChatBillReconciliationRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WeChatBillEntry" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "lineNumber" INTEGER NOT NULL,
  "entryType" TEXT NOT NULL,
  "providerOccurredAt" TIMESTAMP(3),
  "outTradeNo" TEXT,
  "transactionId" TEXT,
  "outRefundNo" TEXT,
  "providerRefundId" TEXT,
  "businessReference" TEXT,
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
  CONSTRAINT "WeChatBillEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WeChatReconciliationIssue" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "entryId" TEXT,
  "fingerprint" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "severity" TEXT NOT NULL DEFAULT 'high',
  "status" "WeChatReconciliationIssueStatus" NOT NULL DEFAULT 'open',
  "localResourceType" TEXT,
  "localResourceId" TEXT,
  "providerReference" TEXT,
  "expectedCents" INTEGER,
  "actualCents" INTEGER,
  "detailCode" TEXT NOT NULL,
  "assignedToUserId" TEXT,
  "assignedAt" TIMESTAMP(3),
  "resolvedByUserId" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "resolutionCode" TEXT,
  "resolutionNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WeChatReconciliationIssue_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WeChatBillReconciliationRun_provider_billDate_kind_key"
  ON "WeChatBillReconciliationRun"("provider", "billDate", "kind");
CREATE INDEX "WeChatBillReconciliationRun_status_nextAttemptAt_idx"
  ON "WeChatBillReconciliationRun"("status", "nextAttemptAt");
CREATE INDEX "WeChatBillReconciliationRun_billDate_kind_idx"
  ON "WeChatBillReconciliationRun"("billDate", "kind");

CREATE UNIQUE INDEX "WeChatBillEntry_runId_lineNumber_key"
  ON "WeChatBillEntry"("runId", "lineNumber");
CREATE INDEX "WeChatBillEntry_outTradeNo_idx" ON "WeChatBillEntry"("outTradeNo");
CREATE INDEX "WeChatBillEntry_transactionId_idx" ON "WeChatBillEntry"("transactionId");
CREATE INDEX "WeChatBillEntry_outRefundNo_idx" ON "WeChatBillEntry"("outRefundNo");
CREATE INDEX "WeChatBillEntry_businessReference_idx" ON "WeChatBillEntry"("businessReference");

CREATE UNIQUE INDEX "WeChatReconciliationIssue_fingerprint_key"
  ON "WeChatReconciliationIssue"("fingerprint");
CREATE INDEX "WeChatReconciliationIssue_status_createdAt_idx"
  ON "WeChatReconciliationIssue"("status", "createdAt");
CREATE INDEX "WeChatReconciliationIssue_assignedToUserId_status_idx"
  ON "WeChatReconciliationIssue"("assignedToUserId", "status");
CREATE INDEX "WeChatReconciliationIssue_runId_status_idx"
  ON "WeChatReconciliationIssue"("runId", "status");
CREATE INDEX "WeChatReconciliationIssue_localResourceType_localResourceId_idx"
  ON "WeChatReconciliationIssue"("localResourceType", "localResourceId");

ALTER TABLE "WeChatBillEntry"
  ADD CONSTRAINT "WeChatBillEntry_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "WeChatBillReconciliationRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WeChatReconciliationIssue"
  ADD CONSTRAINT "WeChatReconciliationIssue_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "WeChatBillReconciliationRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WeChatReconciliationIssue"
  ADD CONSTRAINT "WeChatReconciliationIssue_entryId_fkey"
  FOREIGN KEY ("entryId") REFERENCES "WeChatBillEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE FUNCTION "prevent_wechat_bill_entry_mutation"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'WeChat bill entries are immutable';
END;
$$;

CREATE TRIGGER "WeChatBillEntry_immutable_update"
  BEFORE UPDATE OR DELETE ON "WeChatBillEntry"
  FOR EACH ROW EXECUTE FUNCTION "prevent_wechat_bill_entry_mutation"();

CREATE FUNCTION "protect_wechat_bill_run_artifact"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'WeChat bill reconciliation runs are immutable audit records';
  END IF;
  IF NEW."provider" IS DISTINCT FROM OLD."provider"
     OR NEW."billDate" IS DISTINCT FROM OLD."billDate"
     OR NEW."kind" IS DISTINCT FROM OLD."kind" THEN
    RAISE EXCEPTION 'WeChat bill reconciliation identity is immutable';
  END IF;
  IF OLD."importedAt" IS NOT NULL AND (
    NEW."hashType" IS DISTINCT FROM OLD."hashType"
    OR NEW."providerHash" IS DISTINCT FROM OLD."providerHash"
    OR NEW."contentSha256" IS DISTINCT FROM OLD."contentSha256"
    OR NEW."downloadedBytes" IS DISTINCT FROM OLD."downloadedBytes"
    OR NEW."entryCount" IS DISTINCT FROM OLD."entryCount"
    OR NEW."importedAt" IS DISTINCT FROM OLD."importedAt"
  ) THEN
    RAISE EXCEPTION 'Imported WeChat bill artifact metadata is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "WeChatBillReconciliationRun_protect_artifact"
  BEFORE UPDATE OR DELETE ON "WeChatBillReconciliationRun"
  FOR EACH ROW EXECUTE FUNCTION "protect_wechat_bill_run_artifact"();
