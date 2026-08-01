-- Freeze the customer-visible refund request window on every order. Legacy
-- rows derive an exact whole-hour window from their existing completion
-- deadline when possible; all other rows receive the explicit legacy 72-hour
-- policy. This makes the migration deterministic without consulting deploy
-- configuration that may have changed since the order was created.
ALTER TABLE "Order"
  ADD COLUMN "refundPolicyVersionSnapshot" VARCHAR(64),
  ADD COLUMN "refundRequestWindowHoursSnapshot" INTEGER;

WITH candidates AS (
  SELECT
    "id",
    EXTRACT(EPOCH FROM ("refundRequestDeadlineAt" - "completedAt")) / 3600 AS "windowHours"
  FROM "Order"
), backfill AS (
  SELECT
    "id",
    CASE
      WHEN "windowHours" = trunc("windowHours")
        AND "windowHours" BETWEEN 1 AND 720
        THEN "windowHours"::INTEGER
      ELSE 72
    END AS "windowHours",
    CASE
      WHEN "windowHours" = trunc("windowHours")
        AND "windowHours" BETWEEN 1 AND 720
        THEN 'legacy-inferred-v1'
      ELSE 'legacy-72h-v1'
    END AS "policyVersion"
  FROM candidates
)
UPDATE "Order" AS orders
SET
  "refundPolicyVersionSnapshot" = backfill."policyVersion",
  "refundRequestWindowHoursSnapshot" = backfill."windowHours"
FROM backfill
WHERE orders."id" = backfill."id";

-- Completed legacy orders must have one authoritative deadline that agrees
-- with the frozen window. Invalid, fractional or missing historical deadlines
-- are repaired to the explicit legacy 72-hour rule above.
UPDATE "Order"
SET "refundRequestDeadlineAt" = "completedAt"
  + make_interval(hours => "refundRequestWindowHoursSnapshot")
WHERE "completedAt" IS NOT NULL
  AND "refundRequestDeadlineAt" IS DISTINCT FROM (
    "completedAt" + make_interval(hours => "refundRequestWindowHoursSnapshot")
  );

ALTER TABLE "Order"
  ALTER COLUMN "refundPolicyVersionSnapshot" SET NOT NULL,
  ALTER COLUMN "refundRequestWindowHoursSnapshot" SET NOT NULL;

ALTER TABLE "Order"
  ADD CONSTRAINT "Order_refund_policy_version_snapshot_check"
    CHECK (
      char_length("refundPolicyVersionSnapshot") BETWEEN 3 AND 64
      AND "refundPolicyVersionSnapshot" ~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$'
    ),
  ADD CONSTRAINT "Order_refund_request_window_snapshot_check"
    CHECK ("refundRequestWindowHoursSnapshot" BETWEEN 1 AND 720),
  ADD CONSTRAINT "Order_refund_request_deadline_snapshot_check"
    CHECK (
      "completedAt" IS NULL
      OR "refundRequestDeadlineAt" = "completedAt"
        + make_interval(hours => "refundRequestWindowHoursSnapshot")
    );

CREATE OR REPLACE FUNCTION "order_refund_policy_snapshot_immutable"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."refundPolicyVersionSnapshot" IS DISTINCT FROM OLD."refundPolicyVersionSnapshot"
    OR NEW."refundRequestWindowHoursSnapshot" IS DISTINCT FROM OLD."refundRequestWindowHoursSnapshot"
  THEN
    RAISE EXCEPTION 'Order refund policy snapshots are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Order_refund_policy_snapshot_immutable"
BEFORE UPDATE OF "refundPolicyVersionSnapshot", "refundRequestWindowHoursSnapshot"
ON "Order"
FOR EACH ROW
EXECUTE FUNCTION "order_refund_policy_snapshot_immutable"();
