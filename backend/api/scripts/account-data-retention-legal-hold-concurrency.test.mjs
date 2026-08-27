import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import pg from "pg";

import { assertIsolatedPostgresPreflightEnvironment } from "./isolated-postgres-preflight-environment.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = join(here, "..");
const migrationsRoot = join(apiRoot, "prisma", "migrations");
const targetMigration = "20260801007400_account_data_retention_legal_holds";

test("legal holds are category-scoped, two-person, bounded, and fail closed in every owned layer", async () => {
  const [schema, migration, service, controller, dto] = await Promise.all([
    readFile(join(apiRoot, "prisma/schema.prisma"), "utf8"),
    readFile(join(migrationsRoot, targetMigration, "migration.sql"), "utf8"),
    readFile(join(apiRoot, "src/legal/data-retention-legal-hold.service.ts"), "utf8"),
    readFile(join(apiRoot, "src/legal/data-retention-legal-hold.controller.ts"), "utf8"),
    readFile(join(apiRoot, "src/legal/dto/data-retention-legal-hold.dto.ts"), "utf8")
  ]);

  assert.match(schema, /model AccountDataRetentionLegalHold \{/);
  assert.match(schema, /model AccountDataRetentionLegalHoldAction \{/);
  assert.match(schema, /partialErasurePhase\s+String\?/);
  assert.match(schema, /partialErasureCursor\s+String\?/);
  assert.match(schema, /partialErasedRecordCount\s+Int/);
  assert.match(schema, /partialExpiryAttemptCount\s+Int/);

  assert.match(migration, /RetentionLegalHold_active_record_key/);
  assert.match(migration, /RetentionLegalHoldAction_pending_placement_key/);
  assert.match(migration, /RetentionLegalHoldAction_pending_release_key/);
  assert.match(migration, /an active legal hold already exists for this retention record/);
  assert.match(migration, /legal-hold placement requires cleared expiry scheduling/);
  assert.match(migration, /legal-hold actions must be inserted as pending requests/);
  assert.match(migration, /decisionReference" ~ '\^\[A-Za-z0-9\]/);
  assert.match(migration, /requestedById" = NEW\."placedById"/);
  assert.match(migration, /requestedById" = NEW\."releasedById"/);
  assert.match(migration, /retention expiry cannot advance while a legal hold barrier is active/);
  assert.match(migration, /WHERE actor\."id" IN \(NEW\."requestedById", subject_user_id\)[\s\S]*ORDER BY actor\."id"[\s\S]*FOR UPDATE/);

  const placementMethod = service.slice(
    service.indexOf("async requestPlacement"),
    service.indexOf("async requestRelease")
  );
  assert.ok(
    placementMethod.indexOf("lockMutationUsers")
      < placementMethod.indexOf("lockRetentionRecord")
  );
  assert.ok(
    placementMethod.indexOf("accountDataRetentionRecord.update")
      < placementMethod.indexOf("accountDataRetentionLegalHoldAction.create")
  );
  assert.match(service, /const userIds = \[\.\.\.new Set\(\[actorId, subjectUserId\]\)\]\.sort\(\)/);
  assert.match(service, /WHERE "id" IN \(\$\{Prisma\.join\(userIds\)\}\)[\s\S]*ORDER BY "id"[\s\S]*FOR UPDATE/);
  assert.match(service, /holdsScope: "currentActionPage"/);
  assert.match(service, /accountDataRetentionLegalHold\.findMany\([\s\S]*take: query\.pageSize/);
  assert.match(service, /data_retention\.legal_hold_placement_requested/);
  assert.match(service, /data_retention\.legal_hold_release_requested/);
  for (const action of [
    "data_retention.legal_hold_placement_approved",
    "data_retention.legal_hold_placement_rejected",
    "data_retention.legal_hold_release_approved",
    "data_retention.legal_hold_release_rejected"
  ]) {
    assert.ok(service.includes(`"${action}"`));
  }
  const auditMetadata = service.slice(
    service.indexOf("private auditMetadata"),
    service.indexOf("private decisionAuditAction")
  );
  assert.doesNotMatch(auditMetadata, /subjectUserId/);
  assert.match(service, /subjectUserIds: \[record\.userId\]/g);

  for (const route of [
    "legal-hold-policy",
    "records/:retentionRecordId/legal-holds",
    "records/:retentionRecordId/legal-hold-placement-requests",
    "legal-holds/:legalHoldId/release-requests",
    "legal-hold-actions/:actionId/approvals",
    "legal-hold-actions/:actionId/rejections"
  ]) {
    assert.ok(controller.includes(`"${route}"`));
  }
  assert.match(controller, /@Roles\("admin"\)/);
  assert.match(dto, /AUTHORITY_REFERENCE_PATTERN/);
  assert.match(dto, /CLIENT_REQUEST_ID_PATTERN/);
  assert.doesNotMatch(
    dto,
    /\b(?:note|description|freeText|reasonText|caseDetails)\b/,
    "DTOs must not accept free-text case data"
  );
});

const integrationUrl = String(
  process.env.ACCOUNT_DATA_RETENTION_LEGAL_HOLD_TEST_DATABASE_URL
    ?? process.env.ACCOUNT_DELETION_TEST_DATABASE_URL
    ?? process.env.TEST_DATABASE_URL
    ?? ""
).trim();

async function expectPgCode(promise, code) {
  await assert.rejects(promise, (error) => error?.code === code);
}

async function lockMutationUsers(client, actorId, subjectUserId) {
  const userIds = [...new Set([actorId, subjectUserId])].sort();
  const locked = await client.query(
    `SELECT "id" FROM "User" WHERE "id" = ANY($1::text[]) ORDER BY "id" FOR UPDATE`,
    [userIds]
  );
  assert.deepEqual(locked.rows.map(({ id }) => id), userIds);
  await client.query(
    `SELECT "id" FROM "CompanionProfile" WHERE "ownerUserId" = $1 ORDER BY "id" FOR UPDATE`,
    [subjectUserId]
  );
}

async function insertPlacementRequest(client, {
  actionId,
  actorId,
  authorityReference = "authority:test-case-001",
  clientRequestId,
  reasonCode = "LITIGATION_PRESERVATION",
  recordId,
  subjectUserId
}) {
  await lockMutationUsers(client, actorId, subjectUserId);
  const locked = await client.query(`
    SELECT "userId", "expiryPhase", "expiryCursor", "expiryErasedRecordCount",
           "expiryAttemptCount"
    FROM "AccountDataRetentionRecord"
    WHERE "id" = $1
    FOR UPDATE
  `, [recordId]);
  assert.equal(locked.rows[0]?.userId, subjectUserId);
  await client.query(`
    UPDATE "AccountDataRetentionRecord"
    SET "expiryLeaseToken" = NULL,
        "expiryLeaseExpiresAt" = NULL,
        "expiryNextAttemptAt" = NULL,
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = $1
  `, [recordId]);
  const snapshot = locked.rows[0];
  await client.query(`
    INSERT INTO "AccountDataRetentionLegalHoldAction" (
      "id", "retentionRecordId", "action", "status", "reasonCode",
      "authorityReference", "policyVersion", "policyApprovalReference",
      "requestedById", "clientRequestId", "partialErasurePhase",
      "partialErasureCursor", "partialErasedRecordCount",
      "partialExpiryAttemptCount", "updatedAt"
    ) VALUES (
      $1, $2, 'placement', 'pending', $3, $4, 'legal-hold-v1',
      'legal:approved-hold-v1', $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP
    )
  `, [
    actionId,
    recordId,
    reasonCode,
    authorityReference,
    actorId,
    clientRequestId,
    snapshot.expiryPhase,
    snapshot.expiryCursor,
    snapshot.expiryErasedRecordCount,
    snapshot.expiryAttemptCount
  ]);
  return snapshot;
}

async function rejectPlacementAndResume(client, actionId, recordId, deciderId) {
  await client.query(`
    UPDATE "AccountDataRetentionLegalHoldAction"
    SET "status" = 'rejected',
        "decidedById" = $2,
        "decidedAt" = CURRENT_TIMESTAMP,
        "decisionReference" = 'decision:rejected-test',
        "decisionReasonCode" = 'REQUEST_EVIDENCE_INVALID',
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = $1
  `, [actionId, deciderId]);
  await client.query(`
    UPDATE "AccountDataRetentionRecord"
    SET "expiryNextAttemptAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = $1
  `, [recordId]);
}

test("real PostgreSQL linearizes legal holds with expiry work and keeps queues indexed at scale", {
  skip: integrationUrl
    ? false
    : "set ACCOUNT_DATA_RETENTION_LEGAL_HOLD_TEST_DATABASE_URL to a disposable PostgreSQL database"
}, async (t) => {
  await assertIsolatedPostgresPreflightEnvironment();
  const schemaName = `retention_legal_hold_${randomBytes(8).toString("hex")}`;
  const admin = new pg.Client({ connectionString: integrationUrl });
  const worker = new pg.Client({ connectionString: integrationUrl });
  const legalA = new pg.Client({ connectionString: integrationUrl });
  const legalB = new pg.Client({ connectionString: integrationUrl });
  await Promise.all([admin.connect(), worker.connect(), legalA.connect(), legalB.connect()]);
  t.after(async () => {
    await Promise.allSettled([
      worker.query("ROLLBACK"),
      legalA.query("ROLLBACK"),
      legalB.query("ROLLBACK")
    ]);
    await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await Promise.all([admin.end(), worker.end(), legalA.end(), legalB.end()]);
  });

  await admin.query(`CREATE SCHEMA "${schemaName}"`);
  for (const client of [admin, worker, legalA, legalB]) {
    await client.query(`SET search_path TO "${schemaName}"`);
    await client.query("SET statement_timeout TO '20s'");
  }

  const migrationDirectories = (await readdir(migrationsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name <= targetMigration)
    .map((entry) => entry.name)
    .sort();
  assert.ok(migrationDirectories.includes(targetMigration));
  for (const directory of migrationDirectories) {
    const sql = await readFile(join(migrationsRoot, directory, "migration.sql"), "utf8");
    await admin.query(sql);
  }

  await admin.query(`
    INSERT INTO "User" ("id", "role", "accountStatus", "createdAt", "updatedAt") VALUES
      ('admin-a', 'admin', 'active', NOW(), NOW()),
      ('admin-b', 'admin', 'active', NOW(), NOW()),
      ('subject-active', 'user', 'active', NOW(), NOW()),
      ('subject-lease', 'user', 'active', NOW(), NOW()),
      ('subject-reject', 'user', 'active', NOW(), NOW()),
      ('subject-self', 'user', 'active', NOW(), NOW()),
      ('subject-worker-wins', 'user', 'active', NOW(), NOW()),
      ('subject-placement-wins', 'user', 'active', NOW(), NOW()),
      ('subject-scale', 'user', 'active', NOW(), NOW());

    INSERT INTO "AccountDeletionRequest" (
      "id", "userId", "status", "dueAt", "policyVersion", "updatedAt"
    ) VALUES
      ('delete-active', 'subject-active', 'pending', NOW() + INTERVAL '1 day', 'test-v1', NOW()),
      ('delete-lease', 'subject-lease', 'pending', NOW() + INTERVAL '1 day', 'test-v1', NOW()),
      ('delete-reject', 'subject-reject', 'pending', NOW() + INTERVAL '1 day', 'test-v1', NOW()),
      ('delete-self', 'subject-self', 'pending', NOW() + INTERVAL '1 day', 'test-v1', NOW()),
      ('delete-worker-wins', 'subject-worker-wins', 'pending', NOW() + INTERVAL '1 day', 'test-v1', NOW()),
      ('delete-placement-wins', 'subject-placement-wins', 'pending', NOW() + INTERVAL '1 day', 'test-v1', NOW()),
      ('delete-admin-a', 'admin-a', 'pending', NOW() + INTERVAL '1 day', 'test-v1', NOW()),
      ('delete-admin-b', 'admin-b', 'pending', NOW() + INTERVAL '1 day', 'test-v1', NOW()),
      ('delete-scale', 'subject-scale', 'pending', NOW() + INTERVAL '1 day', 'test-v1', NOW());

    INSERT INTO "AccountDataRetentionRecord" (
      "id", "deletionRequestId", "userId", "category", "disposition",
      "legalBasisCode", "policyVersion", "policyApprovalStatus",
      "policyApprovalReference", "recordCount", "processingRestrictedAt",
      "retentionEndsAt", "expiryAttemptCount", "expiryNextAttemptAt",
      "expiryPhase", "expiryCursor", "expiryLeaseToken", "expiryLeaseExpiresAt",
      "expiryErasedRecordCount", "updatedAt"
    ) VALUES
      ('record-active', 'delete-active', 'subject-active', 'support_disputes_safety',
       'retainedRestricted', 'claims', 'test-v1', 'approved', 'legal:retention-v1',
       20, NOW() - INTERVAL '1 year', NOW() - INTERVAL '1 day', 1, NOW(),
       'phase-a', 'cursor-a', NULL, NULL, 4, NOW()),
      ('record-lease', 'delete-lease', 'subject-lease', 'support_disputes_safety',
       'retainedRestricted', 'claims', 'test-v1', 'approved', 'legal:retention-v1',
       20, NOW() - INTERVAL '1 year', NOW() - INTERVAL '1 day', 2, NOW(),
       'phase-a', 'cursor-a', 'lease-direct', NOW() + INTERVAL '5 minutes', 5, NOW()),
      ('record-reject', 'delete-reject', 'subject-reject', 'support_disputes_safety',
       'retainedRestricted', 'claims', 'test-v1', 'approved', 'legal:retention-v1',
       20, NOW() - INTERVAL '1 year', NOW() - INTERVAL '1 day', 2, NOW(),
       'phase-b', 'cursor-b', NULL, NULL, 6, NOW()),
      ('record-self', 'delete-self', 'subject-self', 'support_disputes_safety',
       'retainedRestricted', 'claims', 'test-v1', 'approved', 'legal:retention-v1',
       20, NOW() - INTERVAL '1 year', NOW() - INTERVAL '1 day', 2, NOW(),
       'phase-b', 'cursor-b', NULL, NULL, 6, NOW()),
      ('record-worker-wins', 'delete-worker-wins', 'subject-worker-wins', 'support_disputes_safety',
       'retainedRestricted', 'claims', 'test-v1', 'approved', 'legal:retention-v1',
       20, NOW() - INTERVAL '1 year', NOW() - INTERVAL '1 day', 3, NOW(),
       'phase-before', 'cursor-before', 'lease-worker', NOW() + INTERVAL '5 minutes', 7, NOW()),
      ('record-placement-wins', 'delete-placement-wins', 'subject-placement-wins', 'support_disputes_safety',
       'retainedRestricted', 'claims', 'test-v1', 'approved', 'legal:retention-v1',
       20, NOW() - INTERVAL '1 year', NOW() - INTERVAL '1 day', 3, NOW(),
       'phase-before', 'cursor-before', 'lease-placement', NOW() + INTERVAL '5 minutes', 7, NOW()),
      ('record-admin-a', 'delete-admin-a', 'admin-a', 'support_disputes_safety',
       'retainedRestricted', 'claims', 'test-v1', 'approved', 'legal:retention-v1',
       20, NOW() - INTERVAL '1 year', NOW() - INTERVAL '1 day', 0, NOW(),
       NULL, NULL, NULL, NULL, 0, NOW()),
      ('record-admin-b', 'delete-admin-b', 'admin-b', 'support_disputes_safety',
       'retainedRestricted', 'claims', 'test-v1', 'approved', 'legal:retention-v1',
       20, NOW() - INTERVAL '1 year', NOW() - INTERVAL '1 day', 0, NOW(),
       NULL, NULL, NULL, NULL, 0, NOW()),
      ('record-scale', 'delete-scale', 'subject-scale', 'support_disputes_safety',
       'retainedRestricted', 'claims', 'test-v1', 'approved', 'legal:retention-v1',
       20, NOW() - INTERVAL '1 year', NOW() - INTERVAL '1 day', 0, NULL,
       NULL, NULL, NULL, NULL, 0, NOW());
  `);

  await expectPgCode(admin.query(`
    INSERT INTO "AccountDataRetentionLegalHoldAction" (
      "id", "retentionRecordId", "action", "status", "reasonCode",
      "authorityReference", "policyVersion", "policyApprovalReference",
      "requestedById", "decidedById", "decidedAt", "decisionReference",
      "decisionReasonCode", "clientRequestId", "partialErasedRecordCount",
      "partialExpiryAttemptCount", "updatedAt"
    ) VALUES (
      'action-terminal-insert', 'record-scale', 'placement', 'rejected',
      'LITIGATION_PRESERVATION', 'authority:terminal-insert', 'legal-hold-v1',
      'legal:approved-hold-v1', 'admin-a', 'admin-b', CURRENT_TIMESTAMP,
      'decision:terminal-insert', 'REQUEST_EVIDENCE_INVALID',
      'request-terminal-insert', 0, 0, CURRENT_TIMESTAMP
    )
  `), "23514");
  await expectPgCode(admin.query(`
    INSERT INTO "AccountDataRetentionLegalHoldAction" (
      "id", "retentionRecordId", "action", "reasonCode", "authorityReference",
      "policyVersion", "policyApprovalReference", "requestedById", "clientRequestId",
      "partialErasedRecordCount", "partialExpiryAttemptCount", "updatedAt"
    ) VALUES (
      'action-non-admin', 'record-scale', 'placement', 'LITIGATION_PRESERVATION',
      'authority:non-admin', 'legal-hold-v1', 'legal:approved-hold-v1',
      'subject-scale', 'request-non-admin', 0, 0, CURRENT_TIMESTAMP
    )
  `), "23514");

  await expectPgCode(admin.query(`
    INSERT INTO "AccountDataRetentionLegalHoldAction" (
      "id", "retentionRecordId", "action", "reasonCode", "authorityReference",
      "policyVersion", "policyApprovalReference", "requestedById", "clientRequestId",
      "partialErasurePhase", "partialErasureCursor", "partialErasedRecordCount",
      "partialExpiryAttemptCount", "updatedAt"
    ) VALUES (
      'action-lease-invalid', 'record-lease', 'placement', 'LITIGATION_PRESERVATION',
      'authority:lease-test', 'legal-hold-v1', 'legal:approved-hold-v1', 'admin-a',
      'request-lease-invalid', 'phase-a', 'cursor-a', 5, 2, NOW()
    )
  `), "23514");

  await admin.query("BEGIN");
  await insertPlacementRequest(admin, {
    actionId: "action-active-placement",
    actorId: "admin-a",
    clientRequestId: "request-active-placement",
    recordId: "record-active",
    subjectUserId: "subject-active"
  });
  await admin.query(`
    INSERT INTO "AccountDataRetentionLegalHold" (
      "id", "retentionRecordId", "placementActionId", "placedById", "placedAt", "updatedAt"
    ) VALUES (
      'hold-active', 'record-active', 'action-active-placement', 'admin-b',
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    );
    UPDATE "AccountDataRetentionLegalHoldAction"
    SET "status" = 'approved', "decidedById" = 'admin-b',
        "decidedAt" = CURRENT_TIMESTAMP,
        "decisionReference" = 'decision:active-placement',
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = 'action-active-placement';
  `);
  await admin.query("COMMIT");

  await expectPgCode(admin.query(`
    INSERT INTO "AccountDataRetentionLegalHoldAction" (
      "id", "retentionRecordId", "action", "reasonCode", "authorityReference",
      "policyVersion", "policyApprovalReference", "requestedById", "clientRequestId",
      "partialErasurePhase", "partialErasureCursor", "partialErasedRecordCount",
      "partialExpiryAttemptCount", "updatedAt"
    ) VALUES (
      'action-active-duplicate', 'record-active', 'placement', 'LITIGATION_PRESERVATION',
      'authority:duplicate-test', 'legal-hold-v1', 'legal:approved-hold-v1', 'admin-a',
      'request-active-duplicate', 'phase-a', 'cursor-a', 4, 1, NOW()
    )
  `), "23514");

  await admin.query("BEGIN");
  await insertPlacementRequest(admin, {
    actionId: "action-self",
    actorId: "admin-a",
    clientRequestId: "request-self-review",
    recordId: "record-self",
    subjectUserId: "subject-self"
  });
  await admin.query("COMMIT");
  await expectPgCode(admin.query(`
    UPDATE "AccountDataRetentionLegalHoldAction"
    SET "status" = 'approved', "decidedById" = 'admin-a',
        "decidedAt" = CURRENT_TIMESTAMP,
        "decisionReference" = 'decision:self-review', "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = 'action-self'
  `), "23514");
  await expectPgCode(admin.query(`
    UPDATE "AccountDataRetentionLegalHoldAction"
    SET "status" = 'rejected', "decidedById" = 'admin-b',
        "decidedAt" = CURRENT_TIMESTAMP, "decisionReference" = '',
        "decisionReasonCode" = 'REQUEST_EVIDENCE_INVALID', "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = 'action-self'
  `), "23514");
  await admin.query("BEGIN");
  await rejectPlacementAndResume(admin, "action-self", "record-self", "admin-b");
  await admin.query("COMMIT");

  await admin.query("BEGIN");
  await insertPlacementRequest(admin, {
    actionId: "action-reject",
    actorId: "admin-a",
    clientRequestId: "request-reject-resume",
    recordId: "record-reject",
    subjectUserId: "subject-reject"
  });
  await rejectPlacementAndResume(admin, "action-reject", "record-reject", "admin-b");
  await admin.query("COMMIT");
  const resumed = await admin.query(`
    SELECT "expiryNextAttemptAt" IS NOT NULL AS "resumed"
    FROM "AccountDataRetentionRecord" WHERE "id" = 'record-reject'
  `);
  assert.equal(resumed.rows[0].resumed, true);

  await admin.query(`
    INSERT INTO "AccountDataRetentionLegalHoldAction" (
      "id", "retentionRecordId", "legalHoldId", "action", "reasonCode",
      "authorityReference", "policyVersion", "policyApprovalReference",
      "requestedById", "clientRequestId", "partialErasurePhase",
      "partialErasureCursor", "partialErasedRecordCount",
      "partialExpiryAttemptCount", "updatedAt"
    ) VALUES (
      'action-release-rejected', 'record-active', 'hold-active', 'release',
      'AUTHORITY_RELEASE_CONFIRMED', 'authority:release-reject', 'legal-hold-v1',
      'legal:approved-hold-v1', 'admin-a', 'request-release-rejected',
      'phase-a', 'cursor-a', 4, 1, NOW()
    )
  `);
  await expectPgCode(admin.query(`
    UPDATE "AccountDataRetentionRecord" SET "expiryNextAttemptAt" = NOW()
    WHERE "id" = 'record-active'
  `), "23514");
  await admin.query(`
    UPDATE "AccountDataRetentionLegalHoldAction"
    SET "status" = 'rejected', "decidedById" = 'admin-b',
        "decidedAt" = CURRENT_TIMESTAMP,
        "decisionReference" = 'decision:release-rejected',
        "decisionReasonCode" = 'REQUEST_EVIDENCE_INVALID',
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = 'action-release-rejected'
  `);
  await expectPgCode(admin.query(`
    UPDATE "AccountDataRetentionRecord" SET "expiryNextAttemptAt" = NOW()
    WHERE "id" = 'record-active'
  `), "23514");

  await admin.query("BEGIN");
  await admin.query(`
    INSERT INTO "AccountDataRetentionLegalHoldAction" (
      "id", "retentionRecordId", "legalHoldId", "action", "reasonCode",
      "authorityReference", "policyVersion", "policyApprovalReference",
      "requestedById", "clientRequestId", "partialErasurePhase",
      "partialErasureCursor", "partialErasedRecordCount",
      "partialExpiryAttemptCount", "updatedAt"
    ) VALUES (
      'action-release-approved', 'record-active', 'hold-active', 'release',
      'AUTHORITY_RELEASE_CONFIRMED', 'authority:release-approved', 'legal-hold-v1',
      'legal:approved-hold-v1', 'admin-a', 'request-release-approved',
      'phase-a', 'cursor-a', 4, 1, CURRENT_TIMESTAMP
    );
    UPDATE "AccountDataRetentionLegalHold"
    SET "releaseActionId" = 'action-release-approved', "releasedById" = 'admin-b',
        "releasedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = 'hold-active';
    UPDATE "AccountDataRetentionLegalHoldAction"
    SET "status" = 'approved', "decidedById" = 'admin-b',
        "decidedAt" = CURRENT_TIMESTAMP,
        "decisionReference" = 'decision:release-approved',
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = 'action-release-approved';
    UPDATE "AccountDataRetentionRecord"
    SET "expiryNextAttemptAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = 'record-active';
  `);
  await admin.query("COMMIT");

  await worker.query("BEGIN");
  await worker.query(`SELECT "id" FROM "User" WHERE "id" = 'subject-worker-wins' FOR UPDATE`);
  let workerWinsPlacementSettled = false;
  const workerWinsPlacement = (async () => {
    await legalA.query("BEGIN");
    try {
      const snapshot = await insertPlacementRequest(legalA, {
        actionId: "action-worker-wins",
        actorId: "admin-a",
        clientRequestId: "request-worker-wins",
        recordId: "record-worker-wins",
        subjectUserId: "subject-worker-wins"
      });
      await legalA.query("COMMIT");
      return snapshot;
    } catch (error) {
      await legalA.query("ROLLBACK");
      throw error;
    } finally {
      workerWinsPlacementSettled = true;
    }
  })();
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(workerWinsPlacementSettled, false);
  await worker.query(`
    SELECT "id" FROM "AccountDataRetentionRecord"
    WHERE "id" = 'record-worker-wins' FOR UPDATE;
    UPDATE "AccountDataRetentionRecord"
    SET "expiryPhase" = 'phase-after-batch', "expiryCursor" = 'cursor-after-batch',
        "expiryErasedRecordCount" = 17, "expiryAttemptCount" = 4,
        "expiryLeaseToken" = NULL, "expiryLeaseExpiresAt" = NULL,
        "expiryNextAttemptAt" = NOW() + INTERVAL '1 minute', "updatedAt" = NOW()
    WHERE "id" = 'record-worker-wins';
  `);
  await worker.query("COMMIT");
  const latestSnapshot = await workerWinsPlacement;
  assert.equal(latestSnapshot.expiryPhase, "phase-after-batch");
  assert.equal(latestSnapshot.expiryCursor, "cursor-after-batch");
  assert.equal(latestSnapshot.expiryErasedRecordCount, 17);

  await legalA.query("BEGIN");
  await insertPlacementRequest(legalA, {
    actionId: "action-placement-wins",
    actorId: "admin-a",
    clientRequestId: "request-placement-wins",
    recordId: "record-placement-wins",
    subjectUserId: "subject-placement-wins"
  });
  let placementWinsWorkerSettled = false;
  const placementWinsWorker = (async () => {
    await worker.query("BEGIN");
    try {
      await worker.query(`SELECT "id" FROM "User" WHERE "id" = 'subject-placement-wins' FOR UPDATE`);
      await worker.query(`SELECT "id" FROM "AccountDataRetentionRecord" WHERE "id" = 'record-placement-wins' FOR UPDATE`);
      await worker.query(`
        UPDATE "AccountDataRetentionRecord"
        SET "expiryPhase" = 'worker-must-not-advance',
            "expiryErasedRecordCount" = 99, "updatedAt" = NOW()
        WHERE "id" = 'record-placement-wins'
      `);
      await worker.query("COMMIT");
      return { code: null };
    } catch (error) {
      await worker.query("ROLLBACK");
      return { code: error.code };
    } finally {
      placementWinsWorkerSettled = true;
    }
  })();
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(placementWinsWorkerSettled, false);
  await legalA.query("COMMIT");
  const blockedWorker = await placementWinsWorker;
  assert.equal(blockedWorker.code, "23514");
  assert.notEqual(blockedWorker.code, "40P01");

  const crossOperation = async (client, input) => {
    await client.query("BEGIN");
    try {
      await insertPlacementRequest(client, input);
      await client.query("COMMIT");
      return { code: null };
    } catch (error) {
      await client.query("ROLLBACK");
      return { code: error.code };
    }
  };
  const [crossA, crossB] = await Promise.all([
    crossOperation(legalA, {
      actionId: "action-cross-a",
      actorId: "admin-a",
      clientRequestId: "request-cross-a",
      recordId: "record-admin-b",
      subjectUserId: "admin-b"
    }),
    crossOperation(legalB, {
      actionId: "action-cross-b",
      actorId: "admin-b",
      clientRequestId: "request-cross-b",
      recordId: "record-admin-a",
      subjectUserId: "admin-a"
    })
  ]);
  assert.deepEqual([crossA, crossB], [{ code: null }, { code: null }]);

  await expectPgCode(admin.query(`DELETE FROM "AccountDataRetentionLegalHoldAction" WHERE "id" = 'action-reject'`), "23514");
  await expectPgCode(admin.query(`DELETE FROM "AccountDataRetentionLegalHold" WHERE "id" = 'hold-active'`), "23514");

  await admin.query(`ALTER TABLE "AccountDataRetentionLegalHoldAction" DISABLE TRIGGER USER`);
  try {
    // Loading the 100k-row scale fixture is not the bounded production query
    // under test. Keep it finite but allow slower CI disks; restore the normal
    // 20-second statement boundary before measuring the indexed queue read.
    await admin.query("SET statement_timeout TO '60s'");
    await admin.query(`
      INSERT INTO "AccountDataRetentionLegalHoldAction" (
        "id", "retentionRecordId", "action", "status", "reasonCode",
        "authorityReference", "policyVersion", "policyApprovalReference",
        "requestedById", "requestedAt", "decidedById", "decidedAt",
        "decisionReference", "decisionReasonCode", "clientRequestId",
        "partialErasedRecordCount", "partialExpiryAttemptCount", "updatedAt"
      )
      SELECT 'scale-action-' || lpad(series::text, 6, '0'), 'record-scale',
             'placement', 'rejected', 'LITIGATION_PRESERVATION',
             'authority:scale-' || lpad(series::text, 6, '0'),
             'legal-hold-v1', 'legal:approved-hold-v1', 'admin-a', CURRENT_TIMESTAMP,
             'admin-b', CURRENT_TIMESTAMP,
             'decision:scale-' || lpad(series::text, 6, '0'),
             'DUPLICATE_OR_SUPERSEDED',
             'scale-request-' || lpad(series::text, 6, '0'), 0, 0, CURRENT_TIMESTAMP
      FROM generate_series(1, 100000) series
    `);
  } finally {
    await admin.query("SET statement_timeout TO '20s'");
    await admin.query(`ALTER TABLE "AccountDataRetentionLegalHoldAction" ENABLE TRIGGER USER`);
  }
  await admin.query(`ANALYZE "AccountDataRetentionLegalHoldAction"`);
  const plan = await admin.query(`
    EXPLAIN (FORMAT JSON)
    SELECT "id"
    FROM "AccountDataRetentionLegalHoldAction"
    WHERE "retentionRecordId" = 'record-scale'
      AND "action" = 'placement'
      AND "status" = 'pending'
    ORDER BY "requestedAt", "id"
    LIMIT 50
  `);
  const serializedPlan = JSON.stringify(plan.rows[0]["QUERY PLAN"]);
  assert.match(
    serializedPlan,
    /RetentionLegalHoldAction_(?:pending_placement_key|record_queue)/
  );
  assert.doesNotMatch(serializedPlan, /"Node Type":"Seq Scan"/);
  t.diagnostic(`plan=${serializedPlan}`);
});
