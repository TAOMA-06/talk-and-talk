import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import pg from "pg";

import { assertIsolatedPostgresPreflightEnvironment } from "./isolated-postgres-preflight-environment.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = join(here, "..");
const integrationUrl = String(
  process.env.RETENTION_EXPIRY_GRAPH_TEST_DATABASE_URL
    ?? process.env.TEST_DATABASE_URL
    ?? ""
).trim();
const require = createRequire(import.meta.url);

function transactionAdapter(client) {
  return {
    $queryRawUnsafe: async (sql, ...parameters) => (await client.query(sql, parameters)).rows,
    $executeRaw: async () => {
      throw new Error("Tagged execute is not used by this retention expiry contract");
    }
  };
}

async function loadWorker() {
  const module = require(join(apiRoot, "dist", "src", "legal", "data-retention.worker.js"));
  return new module.DataRetentionWorker({}, {}, {});
}

async function createContractTables(client) {
  await client.query(`
    CREATE TABLE "AuditLog" (
      "id" TEXT PRIMARY KEY,
      "actorId" TEXT,
      "action" TEXT NOT NULL,
      "resourceType" TEXT NOT NULL,
      "resourceId" TEXT,
      "metadata" JSONB
    );
    CREATE TABLE "AuditSubjectReference" (
      "id" TEXT PRIMARY KEY,
      "auditLogId" TEXT NOT NULL REFERENCES "AuditLog"("id") ON DELETE CASCADE,
      "subjectUserId" TEXT NOT NULL,
      "relationKind" TEXT NOT NULL,
      UNIQUE ("auditLogId", "subjectUserId")
    );
    CREATE TABLE "SupportTicket" ("id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL);
    CREATE TABLE "OrderSupportFact" (
      "id" TEXT PRIMARY KEY,
      "supportTicketId" TEXT NOT NULL REFERENCES "SupportTicket"("id") ON DELETE CASCADE,
      "submittedByUserId" TEXT NOT NULL
    );
    CREATE TABLE "AttendanceDisputeStatement" (
      "id" TEXT PRIMARY KEY,
      "submittedByUserId" TEXT NOT NULL
    );
    CREATE TABLE "CompanionIncidentReport" (
      "id" TEXT PRIMARY KEY,
      "companionId" TEXT NOT NULL
    );
    CREATE TABLE "UserAccountAction" (
      "id" TEXT PRIMARY KEY,
      "userId" TEXT NOT NULL
    );
    CREATE TABLE "UserAccountAppeal" (
      "id" TEXT PRIMARY KEY,
      "actionId" TEXT NOT NULL REFERENCES "UserAccountAction"("id") ON DELETE CASCADE,
      "userId" TEXT NOT NULL
    );
    CREATE TABLE "CompanionAccountAction" (
      "id" TEXT PRIMARY KEY,
      "companionId" TEXT NOT NULL
    );
    CREATE TABLE "CompanionAccountAppeal" (
      "id" TEXT PRIMARY KEY,
      "actionId" TEXT NOT NULL REFERENCES "CompanionAccountAction"("id") ON DELETE CASCADE,
      "companionId" TEXT NOT NULL
    );
    CREATE TABLE "MediaAsset" (
      "id" TEXT PRIMARY KEY,
      "uploaderId" TEXT NOT NULL,
      "purpose" TEXT NOT NULL,
      "supportTicketId" TEXT,
      "attendanceDisputeId" TEXT,
      "companionId" TEXT,
      "userAccountActionId" TEXT,
      "companionAccountActionId" TEXT,
      "retentionExpiryRecordId" TEXT,
      "status" TEXT NOT NULL DEFAULT 'approved',
      "expiresAt" TIMESTAMPTZ,
      "storageDeleteRequestedAt" TIMESTAMPTZ,
      "storageDeletedAt" TIMESTAMPTZ,
      "storageDeleteNextAttemptAt" TIMESTAMPTZ,
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE "ControlledCaseEvidenceAttachment" (
      "id" TEXT PRIMARY KEY,
      "mediaAssetId" TEXT NOT NULL UNIQUE REFERENCES "MediaAsset"("id") ON DELETE RESTRICT,
      "orderSupportFactId" TEXT,
      "attendanceDisputeStatementId" TEXT,
      "companionIncidentReportId" TEXT,
      "userAccountAppealId" TEXT,
      "companionAccountAppealId" TEXT
    );
  `);
}

test("real PostgreSQL enforces storage confirmation and purpose-isolated media expiry", {
  skip: integrationUrl
    ? false
    : "set RETENTION_EXPIRY_GRAPH_TEST_DATABASE_URL to a disposable PostgreSQL database after npm run build"
}, async (t) => {
  await assertIsolatedPostgresPreflightEnvironment();
  const client = new pg.Client({ connectionString: integrationUrl });
  const namespace = `retention_expiry_${randomBytes(8).toString("hex")}`;
  await client.connect();
  t.after(async () => {
    await client.query(`DROP SCHEMA IF EXISTS "${namespace}" CASCADE`);
    await client.end();
  });
  await client.query(`CREATE SCHEMA "${namespace}"`);
  await client.query(`SET search_path TO "${namespace}"`);
  await client.query("SET statement_timeout TO '5s'");
  await createContractTables(client);
  await client.query(`
    INSERT INTO "SupportTicket" ("id", "userId") VALUES ('ticket-target', 'user-target');
    INSERT INTO "OrderSupportFact" (
      "id", "supportTicketId", "submittedByUserId"
    ) VALUES ('fact-target', 'ticket-target', 'user-target');
    INSERT INTO "UserAccountAction" ("id", "userId") VALUES ('action-target', 'user-target');
    INSERT INTO "UserAccountAppeal" ("id", "actionId", "userId")
      VALUES ('appeal-target', 'action-target', 'user-target');
    INSERT INTO "MediaAsset" (
      "id", "uploaderId", "purpose", "supportTicketId", "expiresAt"
    ) VALUES (
      'media-safety', 'user-target', 'orderSupportFact', 'ticket-target',
      CURRENT_TIMESTAMP + INTERVAL '30 days'
    );
    INSERT INTO "MediaAsset" (
      "id", "uploaderId", "purpose", "userAccountActionId", "expiresAt"
    ) VALUES (
      'media-governance', 'user-target', 'userAccountAppeal', 'action-target',
      CURRENT_TIMESTAMP + INTERVAL '30 days'
    );
    INSERT INTO "ControlledCaseEvidenceAttachment" (
      "id", "mediaAssetId", "orderSupportFactId"
    ) VALUES ('attachment-safety', 'media-safety', 'fact-target');
    INSERT INTO "ControlledCaseEvidenceAttachment" (
      "id", "mediaAssetId", "userAccountAppealId"
    ) VALUES ('attachment-governance', 'media-governance', 'appeal-target');
  `);

  const worker = await loadWorker();
  const tx = transactionAdapter(client);
  await client.query("BEGIN");
  const scheduled = await worker.processRetainedPhaseBatch(
    tx,
    "media_storage_schedule",
    "deletion-target",
    "user-target",
    null
  );
  await client.query("COMMIT");
  assert.equal(scheduled.affectedCount, 1);
  const afterSafetySchedule = await client.query(`
    SELECT "id", "expiresAt" <= CURRENT_TIMESTAMP AS due,
           "retentionExpiryRecordId" AS "retentionExpiryRecordId",
           "storageDeleteRequestedAt" IS NOT NULL AS requested
    FROM "MediaAsset" ORDER BY "id"
  `);
  assert.deepEqual(afterSafetySchedule.rows, [
    { id: "media-governance", due: false, retentionExpiryRecordId: null, requested: false },
    { id: "media-safety", due: true, retentionExpiryRecordId: "deletion-target", requested: true }
  ]);

  await client.query("BEGIN");
  const waiting = await worker.processRetainedPhaseBatch(
    tx,
    "controlled_evidence_attachment",
    "deletion-target",
    "user-target",
    null
  );
  await client.query("COMMIT");
  assert.equal(waiting.hasMore, true);
  assert.equal((await client.query(`SELECT COUNT(*)::INTEGER AS count FROM "ControlledCaseEvidenceAttachment"`)).rows[0].count, 2);

  await client.query(`
    UPDATE "MediaAsset"
    SET "storageDeletedAt" = CURRENT_TIMESTAMP, "status" = 'expired'
    WHERE "id" = 'media-safety'
  `);
  await client.query("BEGIN");
  const attachmentDeletion = await worker.processRetainedPhaseBatch(
    tx,
    "controlled_evidence_attachment",
    "deletion-target",
    "user-target",
    null
  );
  await client.query("COMMIT");
  assert.equal(attachmentDeletion.affectedCount, 1);
  assert.deepEqual(
    (await client.query(`SELECT "id" FROM "ControlledCaseEvidenceAttachment" ORDER BY "id"`)).rows,
    [{ id: "attachment-governance" }]
  );

  await client.query("BEGIN");
  const mediaDeletion = await worker.processRetainedPhaseBatch(
    tx,
    "media_asset_delete",
    "deletion-target",
    "user-target",
    null
  );
  await client.query("COMMIT");
  assert.equal(mediaDeletion.affectedCount, 1);
  assert.deepEqual(
    (await client.query(`SELECT "id" FROM "MediaAsset" ORDER BY "id"`)).rows,
    [{ id: "media-governance" }]
  );

  await client.query("BEGIN");
  const governanceSchedule = await worker.processRetainedPhaseBatch(
    tx,
    "governance_media_storage_schedule",
    "deletion-target",
    "user-target",
    null
  );
  await client.query("COMMIT");
  assert.equal(governanceSchedule.affectedCount, 1);
  await client.query(`
    UPDATE "MediaAsset"
    SET "storageDeletedAt" = CURRENT_TIMESTAMP, "status" = 'expired'
    WHERE "id" = 'media-governance'
  `);
  await client.query("BEGIN");
  await worker.processRetainedPhaseBatch(
    tx,
    "governance_controlled_evidence_attachment",
    "deletion-target",
    "user-target",
    null
  );
  await client.query("COMMIT");
  await client.query("BEGIN");
  await worker.processRetainedPhaseBatch(
    tx,
    "governance_media_asset_delete",
    "deletion-target",
    "user-target",
    null
  );
  await client.query("COMMIT");
  assert.equal((await client.query(`SELECT COUNT(*)::INTEGER AS count FROM "MediaAsset"`)).rows[0].count, 0);
  assert.equal((await client.query(`SELECT COUNT(*)::INTEGER AS count FROM "ControlledCaseEvidenceAttachment"`)).rows[0].count, 0);
});

test("real PostgreSQL preserves other subjects while concurrent audit expiry locks logs canonically", {
  skip: integrationUrl
    ? false
    : "set RETENTION_EXPIRY_GRAPH_TEST_DATABASE_URL to a disposable PostgreSQL database after npm run build"
}, async (t) => {
  await assertIsolatedPostgresPreflightEnvironment();
  const setup = new pg.Client({ connectionString: integrationUrl });
  const replicaA = new pg.Client({ connectionString: integrationUrl });
  const replicaB = new pg.Client({ connectionString: integrationUrl });
  const namespace = `retention_audit_${randomBytes(8).toString("hex")}`;
  await setup.connect();
  t.after(async () => {
    await Promise.allSettled([replicaA.query("ROLLBACK"), replicaB.query("ROLLBACK")]);
    await Promise.allSettled([replicaA.end(), replicaB.end()]);
    await setup.query(`DROP SCHEMA IF EXISTS "${namespace}" CASCADE`);
    await setup.end();
  });
  await setup.query(`CREATE SCHEMA "${namespace}"`);
  await setup.query(`SET search_path TO "${namespace}"`);
  await setup.query(`
    CREATE TABLE "AuditLog" (
      "id" TEXT PRIMARY KEY,
      "actorId" TEXT,
      "action" TEXT NOT NULL,
      "resourceType" TEXT NOT NULL,
      "resourceId" TEXT,
      "metadata" JSONB
    );
    CREATE TABLE "AuditSubjectReference" (
      "id" TEXT PRIMARY KEY,
      "auditLogId" TEXT NOT NULL REFERENCES "AuditLog"("id") ON DELETE CASCADE,
      "subjectUserId" TEXT NOT NULL,
      "relationKind" TEXT NOT NULL,
      UNIQUE ("auditLogId", "subjectUserId")
    );
    INSERT INTO "AuditLog" (
      "id", "actorId", "action", "resourceType", "metadata"
    ) VALUES
      ('log-1', 'user-a', 'attendance.case_created', 'case',
       '{"openedByUserId":"user-a","counterpartyUserId":"user-b","keep":"one"}'),
      ('log-2', 'user-b', 'attendance.case_created', 'case',
       '{"openedByUserId":"user-a","counterpartyUserId":"user-b","keep":"two"}');
    INSERT INTO "AuditSubjectReference" (
      "id", "auditLogId", "subjectUserId", "relationKind"
    ) VALUES
      ('a-1', 'log-1', 'user-a', 'actorAndSubject'),
      ('z-2', 'log-2', 'user-a', 'subject'),
      ('b-2', 'log-2', 'user-b', 'actorAndSubject'),
      ('y-1', 'log-1', 'user-b', 'subject');
  `);
  await Promise.all([replicaA.connect(), replicaB.connect()]);
  for (const replica of [replicaA, replicaB]) {
    await replica.query(`SET search_path TO "${namespace}"`);
    await replica.query("SET statement_timeout TO '5s'");
    await replica.query("BEGIN");
  }
  const workerA = await loadWorker();
  const workerB = await loadWorker();
  const expiryA = workerA.processRetainedPhaseBatch(
    transactionAdapter(replicaA),
    "audit_subject_reference",
    "deletion-a",
    "user-a",
    null
  ).then(() => "a");
  const expiryB = workerB.processRetainedPhaseBatch(
    transactionAdapter(replicaB),
    "audit_subject_reference",
    "deletion-b",
    "user-b",
    null
  ).then(() => "b");
  const first = await Promise.race([expiryA, expiryB]);
  if (first === "a") {
    await replicaA.query("COMMIT");
    assert.equal(await expiryB, "b");
    await replicaB.query("COMMIT");
  } else {
    await replicaB.query("COMMIT");
    assert.equal(await expiryA, "a");
    await replicaA.query("COMMIT");
  }
  const remainingReferences = await setup.query(`
    SELECT COUNT(*)::INTEGER AS count FROM "AuditSubjectReference"
  `);
  assert.equal(remainingReferences.rows[0].count, 0);
  const logs = await setup.query(`
    SELECT "id", "actorId", "metadata" FROM "AuditLog" ORDER BY "id"
  `);
  assert.deepEqual(logs.rows, [
    {
      id: "log-1",
      actorId: null,
      metadata: { keep: "one", retentionExpired: true }
    },
    {
      id: "log-2",
      actorId: null,
      metadata: { keep: "two", retentionExpired: true }
    }
  ]);
});

test("every declared restricted phase executes against the fully migrated PostgreSQL schema", {
  skip: integrationUrl
    ? false
    : "set RETENTION_EXPIRY_GRAPH_TEST_DATABASE_URL to the sealed migrated PostgreSQL database after npm run build"
}, async (t) => {
  await assertIsolatedPostgresPreflightEnvironment();
  const client = new pg.Client({ connectionString: integrationUrl });
  await client.connect();
  t.after(async () => {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.end();
  });
  await client.query("SET statement_timeout TO '5s'");
  await client.query("BEGIN");
  const worker = await loadWorker();
  const tx = transactionAdapter(client);
  const categories = {
    transactions_tax_invoices: [
      "invoice_request",
      "customer_order",
      "companion_order",
      "wechat_reconciliation_resolution",
      "wechat_reconciliation_issue",
      "cash_ledger_classification",
      "cash_ledger_entry",
      "wechat_bill_import_proposal",
      "wechat_bill_import_entry",
      "wechat_bill_run",
      "wechat_bill_entry",
      "payment_dispute_order_financial",
      "payment_transaction",
      "refund_transaction",
      "companion_earning",
      "companion_withdrawal",
      "companion_recovery",
      "companion_commercial",
      "transaction_availability_window"
    ],
    support_disputes_safety: [
      "media_storage_schedule",
      "media_storage_wait",
      "controlled_evidence_attachment",
      "media_asset_delete",
      "order_support_fact",
      "support_ticket",
      "payment_dispute_attachment",
      "payment_dispute_notification",
      "payment_dispute_negotiation_event",
      "payment_dispute_reply",
      "payment_dispute",
      "payment_dispute_order",
      "attendance_statement",
      "attendance_dispute",
      "order_reschedule_request",
      "order_timeline_event",
      "order_experience_feedback",
      "voice_attendance_event",
      "voice_session",
      "moderation_evidence",
      "moderation_action_log",
      "moderation_appeal",
      "chat_restriction",
      "moderation_case",
      "crisis_intervention",
      "companion_incident",
      "message",
      "conversation"
    ],
    consent_rights_account_governance: [
      "governance_media_storage_schedule",
      "governance_media_storage_wait",
      "governance_controlled_evidence_attachment",
      "governance_media_asset_delete",
      "data_rights_follow_up",
      "data_rights_request",
      "legal_consent",
      "identity_verification",
      "customer_adult_eligibility",
      "user_account_appeal",
      "user_account_action",
      "companion_training",
      "companion_account_appeal",
      "companion_account_action"
    ],
    deletion_audit_evidence: [
      "auth_identity_tombstone",
      "deletion_request_note",
      "rating_refresh_job",
      "audit_subject_reference",
      "audit_deletion_request_reference"
    ]
  };
  let executed = 0;
  for (const [category, phases] of Object.entries(categories)) {
    for (const phase of phases) {
      const result = await worker.processRetainedPhaseBatch(
        tx,
        phase,
        `missing-deletion-${category}`,
        `missing-user-${category}`,
        null,
        `missing-record-${category}`
      );
      assert.equal(result.affectedCount, 0, `${category}/${phase}`);
      executed += 1;
    }
  }
  assert.equal(executed, 66);
  await client.query("ROLLBACK");
});
