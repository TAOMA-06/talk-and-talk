-- Public trust metrics must be facts, not editable marketing copy. Rebuild the
-- current values from the authoritative review and order records before the API
-- starts rejecting direct writes to these columns.
WITH review_stats AS (
  SELECT
    "companionId",
    AVG("rating")::double precision AS rating,
    COUNT(*)::integer AS review_count
  FROM "Review"
  GROUP BY "companionId"
)
UPDATE "CompanionProfile" AS companion
SET
  "rating" = COALESCE(review_stats.rating, 0),
  "reviewCount" = COALESCE(review_stats.review_count, 0)
FROM (
  SELECT
    profile."id",
    stats.rating,
    stats.review_count
  FROM "CompanionProfile" AS profile
  LEFT JOIN review_stats AS stats ON stats."companionId" = profile."id"
) AS review_stats
WHERE companion."id" = review_stats."id";

WITH completion_stats AS (
  SELECT
    "companionId",
    COUNT(*)::integer AS completed_order_count
  FROM "Order"
  WHERE "completedAt" IS NOT NULL
  GROUP BY "companionId"
)
UPDATE "CompanionProfile" AS companion
SET "completedOrders" = COALESCE(completion_stats.completed_order_count, 0)
FROM (
  SELECT
    profile."id",
    stats.completed_order_count
  FROM "CompanionProfile" AS profile
  LEFT JOIN completion_stats AS stats ON stats."companionId" = profile."id"
) AS completion_stats
WHERE companion."id" = completion_stats."id";

WITH response_stats AS (
  SELECT
    "companionId",
    AVG(EXTRACT(EPOCH FROM ("companionConfirmedAt" - "createdAt")) / 60.0) AS average_minutes
  FROM "Order"
  WHERE "companionConfirmedAt" IS NOT NULL
  GROUP BY "companionId"
)
UPDATE "CompanionProfile" AS companion
SET "responseTime" = CASE
  WHEN response_stats.average_minutes IS NULL THEN '暂无履约数据'
  WHEN response_stats.average_minutes < 60 THEN
    '约 ' || GREATEST(1, ROUND(response_stats.average_minutes / 5) * 5)::integer || ' 分钟'
  ELSE
    '约 ' || GREATEST(1, ROUND(response_stats.average_minutes / 60))::integer || ' 小时'
END
FROM (
  SELECT
    profile."id",
    stats.average_minutes
  FROM "CompanionProfile" AS profile
  LEFT JOIN response_stats AS stats ON stats."companionId" = profile."id"
) AS response_stats
WHERE companion."id" = response_stats."id";
