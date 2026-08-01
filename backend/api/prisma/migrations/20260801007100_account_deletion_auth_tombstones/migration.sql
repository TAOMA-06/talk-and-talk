-- Preserve a non-reversible, key-versioned login deny-relink marker before
-- account deletion erases the clear external identity. This migration is
-- deliberately fail-closed for already-completed deletions: their provider id
-- has already been destroyed and cannot be reconstructed safely from retained
-- account data.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "AccountDeletionRequest"
    WHERE "status"::TEXT IN ('processing', 'completed')
  ) THEN
    RAISE EXCEPTION
      'processing or completed account deletions require an approved auth tombstone backfill before migration 20260801007100'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE TABLE "AuthIdentityTombstone" (
  "id" TEXT NOT NULL,
  "deletionRequestId" TEXT NOT NULL,
  "sourceAuthIdentityId" TEXT NOT NULL,
  "provider" "AuthProvider" NOT NULL,
  "providerIdHmac" CHAR(64) NOT NULL,
  "keyId" VARCHAR(64) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3),
  CONSTRAINT "AuthIdentityTombstone_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AuthIdentityTombstone_hmac_check"
    CHECK ("providerIdHmac" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "AuthIdentityTombstone_key_id_check"
    CHECK ("keyId" ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  CONSTRAINT "AuthIdentityTombstone_expiry_check"
    CHECK ("expiresAt" IS NULL OR "expiresAt" > "createdAt")
);

ALTER TABLE "AuthIdentityTombstone"
ADD CONSTRAINT "AuthIdentityTombstone_deletionRequestId_fkey"
FOREIGN KEY ("deletionRequestId") REFERENCES "AccountDeletionRequest"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "AuthIdentityTombstone_deletionRequestId_sourceAuthIdentityId_key"
ON "AuthIdentityTombstone"("deletionRequestId", "sourceAuthIdentityId");

CREATE UNIQUE INDEX "AuthIdentityTombstone_deletionRequestId_provider_keyId_providerIdHmac_key"
ON "AuthIdentityTombstone"("deletionRequestId", "provider", "keyId", "providerIdHmac");

CREATE INDEX "AuthIdentityTombstone_login_lookup"
ON "AuthIdentityTombstone"("provider", "keyId", "providerIdHmac", "expiresAt");

CREATE INDEX "AuthIdentityTombstone_deletionRequestId_expiresAt_idx"
ON "AuthIdentityTombstone"("deletionRequestId", "expiresAt");

CREATE INDEX "AuthIdentityTombstone_expiry_due"
ON "AuthIdentityTombstone"("expiresAt", "id");

CREATE OR REPLACE FUNCTION "prevent_auth_identity_tombstone_rewrite"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."deletionRequestId" IS DISTINCT FROM OLD."deletionRequestId"
    OR NEW."sourceAuthIdentityId" IS DISTINCT FROM OLD."sourceAuthIdentityId"
    OR NEW."provider" IS DISTINCT FROM OLD."provider"
    OR NEW."providerIdHmac" IS DISTINCT FROM OLD."providerIdHmac"
    OR NEW."keyId" IS DISTINCT FROM OLD."keyId"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  THEN
    RAISE EXCEPTION 'auth identity tombstone provenance is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF OLD."expiresAt" IS NOT NULL
    AND NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt"
  THEN
    RAISE EXCEPTION 'auth identity tombstone expiry is immutable once sealed'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AuthIdentityTombstone_provenance_immutable"
BEFORE UPDATE ON "AuthIdentityTombstone"
FOR EACH ROW
EXECUTE FUNCTION "prevent_auth_identity_tombstone_rewrite"();

CREATE OR REPLACE FUNCTION "validate_auth_identity_tombstone_insert"()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "AuthIdentity" identity
    JOIN "AccountDeletionRequest" request
      ON request."id" = NEW."deletionRequestId"
     AND request."userId" = identity."userId"
    WHERE identity."id" = NEW."sourceAuthIdentityId"
      AND identity."provider" = NEW."provider"
      AND request."status"::TEXT = 'pending'
  ) THEN
    RAISE EXCEPTION 'auth identity tombstone source provenance is invalid'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AuthIdentityTombstone_source_guard"
BEFORE INSERT ON "AuthIdentityTombstone"
FOR EACH ROW
EXECUTE FUNCTION "validate_auth_identity_tombstone_insert"();

CREATE OR REPLACE FUNCTION "prevent_active_auth_identity_tombstone_delete"()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."expiresAt" IS NULL
    OR OLD."expiresAt" > CURRENT_TIMESTAMP
    OR NOT EXISTS (
      SELECT 1
      FROM "AccountDeletionRequest" request
      WHERE request."id" = OLD."deletionRequestId"
        AND request."status"::TEXT = 'completed'
    )
  THEN
    RAISE EXCEPTION 'active auth identity tombstones cannot be deleted'
      USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AuthIdentityTombstone_active_delete_guard"
BEFORE DELETE ON "AuthIdentityTombstone"
FOR EACH ROW
EXECUTE FUNCTION "prevent_active_auth_identity_tombstone_delete"();

CREATE OR REPLACE FUNCTION "prevent_auth_artifact_for_deleting_user"()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "AccountDeletionRequest" request
    WHERE request."userId" = NEW."userId"
      AND request."status"::TEXT IN ('processing', 'completed')
  ) THEN
    RAISE EXCEPTION 'authentication artifacts cannot be created for a deleting or deleted account'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AuthIdentity_deletion_insert_guard"
BEFORE INSERT ON "AuthIdentity"
FOR EACH ROW
EXECUTE FUNCTION "prevent_auth_artifact_for_deleting_user"();

CREATE TRIGGER "RefreshToken_deletion_insert_guard"
BEFORE INSERT OR UPDATE OF "userId" ON "RefreshToken"
FOR EACH ROW
EXECUTE FUNCTION "prevent_auth_artifact_for_deleting_user"();

CREATE OR REPLACE FUNCTION "prevent_deleting_user_auth_identity_rewrite"()
RETURNS TRIGGER AS $$
BEGIN
  IF (
    NEW."userId" IS DISTINCT FROM OLD."userId"
    OR NEW."provider" IS DISTINCT FROM OLD."provider"
    OR NEW."providerId" IS DISTINCT FROM OLD."providerId"
  ) AND EXISTS (
    SELECT 1
    FROM "AccountDeletionRequest" request
    WHERE request."userId" IN (OLD."userId", NEW."userId")
      AND request."status"::TEXT IN ('pending', 'processing', 'completed')
  ) THEN
    RAISE EXCEPTION 'auth identity cannot be rewritten during account deletion'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AuthIdentity_deletion_rewrite_guard"
BEFORE UPDATE OF "userId", "provider", "providerId" ON "AuthIdentity"
FOR EACH ROW
EXECUTE FUNCTION "prevent_deleting_user_auth_identity_rewrite"();

CREATE OR REPLACE FUNCTION "require_auth_identity_tombstone_before_delete"()
RETURNS TRIGGER AS $$
DECLARE
  deletion_request_id TEXT;
BEGIN
  SELECT request."id"
  INTO deletion_request_id
  FROM "AccountDeletionRequest" request
  WHERE request."userId" = OLD."userId"
    AND request."status"::TEXT = 'processing'
  ORDER BY request."createdAt" DESC, request."id" DESC
  LIMIT 1;

  IF deletion_request_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM "AuthIdentityTombstone" tombstone
    WHERE tombstone."deletionRequestId" = deletion_request_id
      AND tombstone."sourceAuthIdentityId" = OLD."id"
      AND tombstone."provider" = OLD."provider"
  ) THEN
    RAISE EXCEPTION 'auth identity cannot be erased before its tombstone is persisted'
      USING ERRCODE = '23514';
  END IF;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AuthIdentity_deletion_erase_guard"
BEFORE DELETE ON "AuthIdentity"
FOR EACH ROW
EXECUTE FUNCTION "require_auth_identity_tombstone_before_delete"();

CREATE OR REPLACE FUNCTION "require_auth_tombstone_before_processing"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."status"::TEXT = 'processing'
    AND (TG_OP = 'INSERT' OR OLD."status"::TEXT <> 'processing')
    AND (
      NOT EXISTS (
        SELECT 1 FROM "AuthIdentity" identity WHERE identity."userId" = NEW."userId"
      )
      OR EXISTS (
      SELECT 1
      FROM "AuthIdentity" identity
      WHERE identity."userId" = NEW."userId"
        AND NOT EXISTS (
          SELECT 1
          FROM "AuthIdentityTombstone" tombstone
          WHERE tombstone."deletionRequestId" = NEW."id"
            AND tombstone."sourceAuthIdentityId" = identity."id"
            AND tombstone."provider" = identity."provider"
        )
      )
    )
  THEN
    RAISE EXCEPTION 'account deletion cannot enter processing before auth tombstones are complete'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AccountDeletionRequest_auth_tombstone_transition_guard"
BEFORE INSERT OR UPDATE OF "status" ON "AccountDeletionRequest"
FOR EACH ROW
EXECUTE FUNCTION "require_auth_tombstone_before_processing"();
