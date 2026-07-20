-- Bound the periodic recovery scan for initiated WeChat prepays that have
-- reached their authoritative expiry time.
CREATE INDEX IF NOT EXISTS "PaymentTransaction_status_expiresAt_idx"
ON "PaymentTransaction"("status", "expiresAt");
