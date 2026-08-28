-- PERSONALIZATION-R01-A: legacy true rows have no retrievable consent ledger.
-- Reset them in a new forward-only migration rather than rewriting the prior
-- default-off migration, which may already exist in an environment ledger.
UPDATE "UserRecommendationPreference"
SET "personalizationEnabled" = false
WHERE "personalizationEnabled" = true;
