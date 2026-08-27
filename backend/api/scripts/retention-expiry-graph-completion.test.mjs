import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = join(here, "..");

function phaseList(source, category) {
  const categoryStart = source.indexOf(`${category}: [`);
  assert.ok(categoryStart >= 0, `${category} phase registry must exist`);
  const listEnd = source.indexOf("\n  ]", categoryStart);
  assert.ok(listEnd > categoryStart, `${category} phase registry must be bounded`);
  return [...source.slice(categoryStart, listEnd).matchAll(/"([a-z0-9_]+)"/g)]
    .map((match) => match[1]);
}

test("restricted retention expiry has complete, ordered and storage-safe phase coverage", async () => {
  const [worker, boundedErasure, schema, mediaService] = await Promise.all([
    readFile(join(apiRoot, "src", "legal", "data-retention.worker.ts"), "utf8"),
    readFile(join(apiRoot, "src", "common", "privacy", "bounded-erasure.ts"), "utf8"),
    readFile(join(apiRoot, "prisma", "schema.prisma"), "utf8"),
    readFile(join(apiRoot, "src", "moderation", "media", "media-asset.service.ts"), "utf8")
  ]);

  const phases = phaseList(worker, "support_disputes_safety");
  assert.equal(phases.length, 30, "the safety graph must retain its complete 30-phase contract");
  assert.equal(new Set(phases).size, phases.length, "safety phases must be unique");
  for (const phase of phases.filter((candidate) => candidate !== "retention_verify")) {
    assert.match(
      worker,
      new RegExp(`phase === ["']${phase}["']`),
      `declared safety phase has no executable handler: ${phase}`
    );
  }

  const order = Object.fromEntries(phases.map((phase, index) => [phase, index]));
  assert.ok(order.media_storage_schedule < order.media_storage_wait);
  assert.ok(order.media_storage_wait < order.controlled_evidence_attachment);
  assert.ok(order.controlled_evidence_attachment < order.media_asset_delete);
  assert.ok(order.media_asset_delete < order.order_support_fact);
  assert.ok(order.payment_dispute < order.payment_dispute_order,
    "the parent must be scrubbed before complaint-order links are removed");
  assert.equal(phases.at(-1), "retention_verify");

  const mediaPredicateStart = worker.indexOf("function partySafetyMediaPredicate");
  const mediaPredicateEnd = worker.indexOf("function partySafetyAttachmentPredicate", mediaPredicateStart);
  const mediaPredicate = worker.slice(mediaPredicateStart, mediaPredicateEnd);
  for (const purpose of [
    "chatMessage",
    "orderSupportFact",
    "attendanceDisputeStatement",
    "companionIncidentReport"
  ]) assert.match(mediaPredicate, new RegExp(`'${purpose}'`));
  for (const forbidden of ["userAccountAppeal", "companionAccountAppeal"]) {
    assert.doesNotMatch(mediaPredicate, new RegExp(`'${forbidden}'`));
  }

  const scheduleStart = worker.indexOf("private async scheduleSafetyMediaDeletionBatch");
  const scheduleEnd = worker.indexOf("private async waitForSafetyMediaStorageDeletion", scheduleStart);
  const schedule = worker.slice(scheduleStart, scheduleEnd);
  assert.match(schedule, /updateBoundedRows\([\s\S]*"MediaAsset"/);
  assert.match(schedule, /storageDeletedAt[^\n]*IS NULL/);
  assert.match(schedule, /"expiresAt" = CURRENT_TIMESTAMP/);
  assert.match(schedule, /"storageDeleteRequestedAt" = COALESCE/);
  assert.match(schedule, /ERASURE_BATCH_SIZE/);
  assert.doesNotMatch(schedule, /DELETE FROM|deleteBoundedRows/);

  const waitStart = worker.indexOf("private async waitForSafetyMediaStorageDeletion");
  const waitEnd = worker.indexOf("private async drainSafetyMediaDependencies", waitStart);
  const wait = worker.slice(waitStart, waitEnd);
  assert.match(wait, /storageDeletedAt[^\n]*IS NULL/);
  assert.match(wait, /nextAttemptAt/);
  assert.match(wait, /MEDIA_STORAGE_WAIT_RETRY_MS/);
  assert.doesNotMatch(wait, /DELETE FROM|deleteBoundedRows|updateBoundedRows/);

  const graphStart = worker.indexOf("private async processRestrictedGraphPhaseBatch");
  const graphEnd = worker.indexOf("private async scheduleSafetyMediaDeletionBatch", graphStart);
  const graph = worker.slice(graphStart, graphEnd);
  const mediaDelete = graph.slice(
    graph.indexOf('phase === "media_asset_delete"'),
    graph.indexOf('phase === "order_support_fact"')
  );
  assert.match(mediaDelete, /waitForSafetyMediaStorageDeletion/);
  assert.match(mediaDelete, /storageDeletedAt[^\n]*IS NOT NULL/);
  assert.doesNotMatch(worker, /del\("MediaAsset",\s*'target\."uploaderId"/);

  assert.match(mediaService, /storageDeletedAt" = \$1/);
  assert.match(mediaService, /this\.storage\.delete/);
  assert.match(schema, /controlledCaseAttachment\s+ControlledCaseEvidenceAttachment\?/);
  assert.match(schema, /mediaAsset\s+MediaAsset[\s\S]*onDelete: Restrict/);
  assert.match(boundedErasure, /export const ERASURE_BATCH_SIZE = 250/);
});

test("audit-evidence expiry follows normalized subject edges in bounded, multi-subject-safe batches", async () => {
  const [worker, v3Migration] = await Promise.all([
    readFile(join(apiRoot, "src", "legal", "data-retention.worker.ts"), "utf8"),
    readFile(join(
      apiRoot,
      "prisma",
      "migrations",
      "20260825050000_audit_subject_policy_registry_v3",
      "migration.sql"
    ), "utf8")
  ]);
  assert.match(worker, /AUDIT_SUBJECT_BACKFILL_VERSION = "controlled-v3"/);
  assert.match(worker, /backfill_audit_subject_references_v3/);
  assert.match(v3Migration, /'controlled-v3', 'controlled-v3'/);
  assert.match(v3Migration, /backfill_audit_subject_references_v3/);
  assert.match(v3Migration, /backfill_audit_subject_references_v2/);
  const methodStart = worker.indexOf("private async expireAuditSubjectReferenceBatch");
  const methodEnd = worker.indexOf("private async expireGeneratedAuditReference", methodStart);
  assert.ok(methodStart >= 0 && methodEnd > methodStart);
  const method = worker.slice(methodStart, methodEnd);

  assert.match(method, /FROM "AuditSubjectReference" AS reference/);
  assert.match(method, /reference\."subjectUserId" = \$1/);
  assert.match(method, /FOR UPDATE SKIP LOCKED/);
  assert.match(method, /LIMIT \$2/);
  assert.match(method, /ERASURE_BATCH_SIZE/);
  assert.match(method, /JOIN candidates[\s\S]*FOR UPDATE/);
  assert.match(method, /redactControlledAuditSubjectMetadata/);
  assert.match(method, /jsonb_to_recordset\(\$1::JSONB\)/);
  assert.match(method, /DELETE FROM "AuditSubjectReference"/);
  assert.match(method, /reference\."id" = candidates\."id"/);
  assert.match(method, /reference\."subjectUserId" = \$2/);
  assert.match(method, /SELECT EXISTS[\s\S]*reference\."subjectUserId" = \$1/);
  assert.doesNotMatch(method, /metadata" = '\{"retentionExpired":true\}'::JSONB/,
    "shared audit metadata must be selectively redacted, not replaced wholesale");

  const verifyStart = worker.indexOf("if (category === \"deletion_audit_evidence\")");
  const verifyEnd = worker.indexOf("throw new Error(`Unsupported account-deletion", verifyStart);
  const verification = worker.slice(verifyStart, verifyEnd);
  assert.match(verification, /auditSubjectReference\.count/);
  assert.match(verification, /subjectUserId: userId/);

  const terminalStart = worker.indexOf("const terminalAudit = await this.audit.record");
  assert.ok(terminalStart >= 0);
  assert.match(worker.slice(terminalStart, terminalStart + 1_200), /expireGeneratedAuditReference/);
  const failureStart = worker.indexOf("const failureAudit = await this.audit.record");
  assert.ok(failureStart >= 0);
  assert.match(worker.slice(failureStart, failureStart + 1_200), /expireGeneratedAuditReference/);
});

test("account-governance appeal evidence has an isolated storage lifecycle and terminal postcondition", async () => {
  const [worker, migration] = await Promise.all([
    readFile(join(apiRoot, "src", "legal", "data-retention.worker.ts"), "utf8"),
    readFile(join(
      apiRoot,
      "prisma",
      "migrations",
      "20260825020000_controlled_account_appeal_evidence",
      "migration.sql"
    ), "utf8")
  ]);
  const phases = phaseList(worker, "consent_rights_account_governance");
  for (const phase of phases.filter((candidate) => candidate !== "retention_verify")) {
    assert.match(worker, new RegExp(`phase === ["']${phase}["']`),
      `declared governance phase has no executable handler: ${phase}`);
  }
  const order = Object.fromEntries(phases.map((phase, index) => [phase, index]));
  assert.ok(order.governance_media_storage_schedule < order.governance_media_storage_wait);
  assert.ok(order.governance_media_storage_wait < order.governance_controlled_evidence_attachment);
  assert.ok(order.governance_controlled_evidence_attachment < order.governance_media_asset_delete);
  assert.ok(order.governance_media_asset_delete < order.user_account_appeal);
  assert.ok(order.governance_media_asset_delete < order.companion_account_appeal);

  const predicateStart = worker.indexOf("function partyGovernanceMediaPredicate");
  const predicateEnd = worker.indexOf("function partyGovernanceAttachmentPredicate", predicateStart);
  const predicate = worker.slice(predicateStart, predicateEnd);
  assert.match(predicate, /'userAccountAppeal'/);
  assert.match(predicate, /'companionAccountAppeal'/);
  for (const forbidden of [
    "chatMessage",
    "orderSupportFact",
    "attendanceDisputeStatement",
    "companionIncidentReport"
  ]) assert.doesNotMatch(predicate, new RegExp(`'${forbidden}'`));
  assert.match(predicate, /userAccountActionId/);
  assert.match(predicate, /companionAccountActionId/);
  assert.match(predicate, /userAccountAppealId/);
  assert.match(predicate, /companionAccountAppealId/);

  const verificationStart = worker.indexOf('if (category === "consent_rights_account_governance")');
  const verificationEnd = worker.indexOf('if (category === "deletion_audit_evidence")', verificationStart);
  const verification = worker.slice(verificationStart, verificationEnd);
  assert.match(verification, /partyGovernanceAttachmentPredicate/);
  assert.match(verification, /partyGovernanceMediaPredicate/);

  assert.match(migration, /ADD VALUE IF NOT EXISTS 'userAccountAppeal'/);
  assert.match(migration, /ADD VALUE IF NOT EXISTS 'companionAccountAppeal'/);
  assert.match(migration, /MediaAsset_userAccountActionId_fkey[\s\S]*ON DELETE RESTRICT/);
  assert.match(migration, /MediaAsset_companionAccountActionId_fkey[\s\S]*ON DELETE RESTRICT/);
  assert.match(migration, /CaseEvidence_user_account_appeal_fk[\s\S]*ON DELETE CASCADE/);
  assert.match(migration, /CaseEvidence_companion_account_appeal_fk[\s\S]*ON DELETE CASCADE/);
});

test("retention-bound media and legal holds share a durable linearization barrier", async () => {
  const [worker, mediaService, legalHoldService, schema, migration] = await Promise.all([
    readFile(join(apiRoot, "src", "legal", "data-retention.worker.ts"), "utf8"),
    readFile(join(apiRoot, "src", "moderation", "media", "media-asset.service.ts"), "utf8"),
    readFile(join(apiRoot, "src", "legal", "data-retention-legal-hold.service.ts"), "utf8"),
    readFile(join(apiRoot, "prisma", "schema.prisma"), "utf8"),
    readFile(join(
      apiRoot,
      "prisma",
      "migrations",
      "20260825030000_retention_media_legal_hold_barrier",
      "migration.sql"
    ), "utf8")
  ]);
  assert.match(schema, /retentionExpiryRecordId\s+String\?/);
  assert.match(schema, /storageDeleteOutcomeUnknownAt\s+DateTime\?/);
  assert.match(schema, /mediaDeletionClaimedAt\s+DateTime\?/);
  assert.match(schema, /RetentionExpiryMediaAssets/);

  for (const scheduleMethod of [
    "scheduleSafetyMediaDeletionBatch",
    "scheduleGovernanceMediaDeletionBatch"
  ]) {
    const start = worker.indexOf(`private async ${scheduleMethod}`);
    const end = worker.indexOf("\n  private async ", start + 20);
    const method = worker.slice(start, end);
    assert.match(method, /retentionExpiryRecordId/);
    assert.match(method, /COALESCE\(target\."retentionExpiryRecordId", \$3\)/);
  }

  const recordLock = mediaService.indexOf('FROM "AccountDataRetentionRecord" AS record');
  const recordRowLock = mediaService.indexOf("FOR UPDATE OF record");
  const assetLock = mediaService.indexOf("FOR UPDATE OF asset SKIP LOCKED");
  assert.ok(recordLock >= 0 && recordRowLock > recordLock && assetLock > recordRowLock,
    "storage claims must lock retention records before media rows");
  assert.match(mediaService, /LEFT JOIN LATERAL[\s\S]*record\."userId" = asset\."uploaderId"/);
  assert.match(mediaService, /due_assets AS MATERIALIZED[\s\S]*ORDER BY asset\."expiresAt", asset\."id"[\s\S]*LIMIT \$2[\s\S]*due_bound_records/);
  assert.match(mediaService, /effectiveRetentionEndsAt/);
  assert.match(mediaService, /locked_records\."retentionEndsAt" <= CURRENT_TIMESTAMP/);
  assert.match(mediaService, /AccountDataRetentionLegalHoldAction/);
  assert.match(mediaService, /AccountDataRetentionLegalHold/);
  assert.match(mediaService, /storageDeleteOutcomeUnknownAt" = COALESCE/);
  assert.match(mediaService, /storageDeleteOutcomeUnknownAt" = NULL/);

  assert.match(legalHoldService, /DATA_RETENTION_LEGAL_HOLD_MEDIA_DELETE_ALREADY_STARTED/);
  assert.match(legalHoldService, /mediaDeletionClaimedAt/);
  assert.match(legalHoldService, /storageDeleteOutcomeUnknownAt/);
  assert.match(legalHoldService, /retentionExpiryRecordId: null[\s\S]*uploaderId: record\.userId/);

  assert.match(migration, /MediaAsset_retention_expiry_record_fkey/);
  assert.match(migration, /WITH derived AS MATERIALIZED/);
  assert.match(migration, /retention\."userId" = asset\."uploaderId"/);
  assert.match(migration, /existing legal hold intersects an already-started retention media deletion/);
  assert.match(migration, /guard_retention_media_delete_claim/);
  assert.match(migration, /FOR UPDATE;[\s\S]*legal hold barrier/);
  assert.match(migration, /mediaDeletionClaimedAt/);
  assert.match(migration, /guard_legal_hold_against_retention_media_delete/);
  assert.match(migration, /storageDeleteLeaseToken[\s\S]*storageDeleteOutcomeUnknownAt/);
  assert.match(migration, /USING ERRCODE = '55000'/);
});
