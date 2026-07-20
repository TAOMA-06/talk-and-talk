-- A customer can escalate after the self-service refund window closes. Keep the
-- originating ticket and staff actor on the financial record, then require a
-- different administrator to approve or reject the refund.
ALTER TABLE "RefundTransaction"
  ADD COLUMN "initiatedById" TEXT,
  ADD COLUMN "supportTicketId" TEXT,
  ADD COLUMN "exceptionReasonCode" TEXT;

CREATE INDEX "RefundTransaction_supportTicketId_idx"
ON "RefundTransaction"("supportTicketId");

ALTER TABLE "RefundTransaction"
ADD CONSTRAINT "RefundTransaction_supportTicketId_fkey"
FOREIGN KEY ("supportTicketId") REFERENCES "SupportTicket"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
