-- MP-D07 / P0-14: new recommendation preference rows default personalization off.
ALTER TABLE "UserRecommendationPreference"
  ALTER COLUMN "personalizationEnabled" SET DEFAULT false;
