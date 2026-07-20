-- A refund can race with the manual transfer step after an operator claims a
-- payout but before evidence is recorded. Treat that external state as
-- uncertain and require an independently reviewed resolution rather than
-- silently voiding a potentially already-paid earning.
CREATE TYPE "CompanionRecoveryReason" AS ENUM (
  'confirmedPaidBeforeRefund',
  'payoutStateUncertain'
);

ALTER TABLE "CompanionRecovery"
ADD COLUMN "reason" "CompanionRecoveryReason" NOT NULL DEFAULT 'confirmedPaidBeforeRefund';
