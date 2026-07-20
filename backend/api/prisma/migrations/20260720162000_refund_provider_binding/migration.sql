-- One WeChat refund id must never be accepted for two local refund ledgers.
-- PostgreSQL permits multiple NULL values while enforcing uniqueness for every
-- provider id that has actually been observed.
CREATE UNIQUE INDEX "RefundTransaction_providerRefundId_key"
ON "RefundTransaction"("providerRefundId");
