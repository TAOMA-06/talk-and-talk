-- Private, immutable facts voluntarily submitted to an active order support ticket.
-- No attachment or message reference is stored here.
CREATE TABLE "OrderSupportFact" (
    "id" TEXT NOT NULL,
    "supportTicketId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "submittedByUserId" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderSupportFact_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "OrderSupportFact_statement_length" CHECK (char_length("statement") BETWEEN 5 AND 1200)
);

CREATE INDEX "OrderSupportFact_supportTicketId_createdAt_idx" ON "OrderSupportFact"("supportTicketId", "createdAt");
CREATE INDEX "OrderSupportFact_orderId_createdAt_idx" ON "OrderSupportFact"("orderId", "createdAt");
CREATE INDEX "OrderSupportFact_submittedByUserId_createdAt_idx" ON "OrderSupportFact"("submittedByUserId", "createdAt");

ALTER TABLE "OrderSupportFact" ADD CONSTRAINT "OrderSupportFact_supportTicketId_fkey"
  FOREIGN KEY ("supportTicketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderSupportFact" ADD CONSTRAINT "OrderSupportFact_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderSupportFact" ADD CONSTRAINT "OrderSupportFact_submittedByUserId_fkey"
  FOREIGN KEY ("submittedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
