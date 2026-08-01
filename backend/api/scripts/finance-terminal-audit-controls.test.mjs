import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = join(here, "..");
const migrationsRoot = join(apiRoot, "prisma", "migrations");
const targetMigration = "20260731239000_finance_terminal_audit_controls";
const targetSqlPath = join(migrationsRoot, targetMigration, "migration.sql");

test("finance terminal migration encodes immutable evidence and concurrency controls", async () => {
  const sql = await readFile(targetSqlPath, "utf8");
  assert.match(sql, /providerRefundSucceededAt/);
  assert.match(sql, /provider_refund_time_order_check/);
  assert.match(sql, /WeChatBillImportProposal_active_content_key[\s\S]*WHERE "status" IN \('pending', 'approved'\)/);
  assert.match(sql, /WeChatBillImportProposal_one_pending_per_bill[\s\S]*WHERE "status" = 'pending'/);
  assert.match(sql, /Normalized WeChat bill import evidence may only be appended while pending/);
  assert.match(sql, /FOR UPDATE[\s\S]*Normalized WeChat bill import evidence may only be appended while pending/);
  assert.match(sql, /CashLedgerClassificationProposal_one_pending_per_entry/);
  assert.match(sql, /CashLedgerClassificationProposal_one_approved_per_entry/);
  assert.match(sql, /Cash ledger provider and source facts are immutable/);
  assert.match(sql, /migration:finance-terminal-audit-controls:payment:/);
  assert.match(sql, /PaymentDisputeOrder_local_link_all_or_nothing_check/);
  assert.match(sql, /Provider complaint order facts are immutable/);
  assert.doesNotMatch(sql, /rawContent|rawBody|rawCsv|statementText/i);
});

const integrationUrl = String(process.env.FINANCE_MIGRATION_TEST_DATABASE_URL ?? "").trim();

test("real PostgreSQL serializes finance approvals and append races", {
  skip: integrationUrl
    ? false
    : "set FINANCE_MIGRATION_TEST_DATABASE_URL to a disposable PostgreSQL database"
}, async (t) => {
  const schema = `finance_audit_${randomBytes(8).toString("hex")}`;
  const admin = new pg.Client({ connectionString: integrationUrl });
  const reviewerA = new pg.Client({ connectionString: integrationUrl });
  const reviewerB = new pg.Client({ connectionString: integrationUrl });
  await Promise.all([admin.connect(), reviewerA.connect(), reviewerB.connect()]);
  t.after(async () => {
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await Promise.all([admin.end(), reviewerA.end(), reviewerB.end()]);
  });

  await admin.query(`CREATE SCHEMA "${schema}"`);
  for (const client of [admin, reviewerA, reviewerB]) {
    await client.query(`SET search_path TO "${schema}"`);
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
    INSERT INTO "User" ("id", "role", "accountStatus", "createdAt", "updatedAt")
    VALUES
      ('finance-a', 'finance', 'active', NOW(), NOW()),
      ('finance-b', 'finance', 'active', NOW(), NOW())
  `);
  await admin.query(`
    INSERT INTO "CashLedgerEntry" (
      "id", "provider", "accountType", "bookedAt", "expectedStatementDate",
      "businessName", "businessType", "direction", "grossCents", "feeCents",
      "netCents", "providerReference", "sourceResourceType", "sourceResourceId",
      "evidenceReference"
    ) VALUES (
      'cash-1', 'wechat', 'UNCLASSIFIED', '2026-07-30T03:00:00Z', NULL,
      '支付入账', 'PAYMENT', '收入', 1000, 0, 1000, 'WX-CASH-1',
      'paymentTransaction', 'payment-source-1', 'provider:wechat:payment:WX-CASH-1'
    )
  `);
  await admin.query(`
    INSERT INTO "CashLedgerClassificationProposal" (
      "id", "cashLedgerEntryId", "accountType", "expectedStatementDate",
      "evidenceReference", "evidenceDigestSha256", "proposedByUserId"
    ) VALUES (
      'cash-proposal-1', 'cash-1', 'BASIC', '2026-07-31',
      'finance:cash/cash-1', repeat('a', 64), 'finance-a'
    )
  `);

  await reviewerA.query("BEGIN");
  await reviewerA.query(`
    UPDATE "CashLedgerClassificationProposal"
    SET "status" = 'approved', "reviewedByUserId" = 'finance-b',
        "reviewedAt" = NOW(), "reviewNote" = 'independent approval'
    WHERE "id" = 'cash-proposal-1'
  `);
  let competingSettled = false;
  const competingReview = reviewerB.query(`
    UPDATE "CashLedgerClassificationProposal"
    SET "status" = 'rejected', "reviewedByUserId" = 'finance-b',
        "reviewedAt" = NOW(), "reviewNote" = 'competing terminal review'
    WHERE "id" = 'cash-proposal-1'
  `).then(
    () => ({ ok: true }),
    (error) => ({ ok: false, error })
  ).finally(() => { competingSettled = true; });
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(competingSettled, false, "the competing reviewer must wait on the row lock");
  await reviewerA.query(`
    UPDATE "CashLedgerEntry"
    SET "accountType" = 'BASIC', "expectedStatementDate" = '2026-07-31'
    WHERE "id" = 'cash-1'
  `);
  await reviewerA.query("COMMIT");
  const competingResult = await competingReview;
  assert.equal(competingResult.ok, false, "only one terminal review may commit");
  const classified = await admin.query(`
    SELECT "accountType", "expectedStatementDate"::text AS "expectedStatementDate"
    FROM "CashLedgerEntry" WHERE "id" = 'cash-1'
  `);
  assert.deepEqual(classified.rows[0], {
    accountType: "BASIC",
    expectedStatementDate: "2026-07-31"
  });
  await assert.rejects(
    admin.query(`UPDATE "CashLedgerEntry" SET "netCents" = 999 WHERE "id" = 'cash-1'`),
    /Cash ledger provider and source facts are immutable/
  );

  await admin.query(`
    INSERT INTO "WeChatBillImportProposal" (
      "id", "provider", "source", "billDate", "kind", "contentSha256",
      "normalizedSha256", "sizeBytes", "entryCount", "evidenceReference",
      "proposedByUserId"
    ) VALUES (
      'import-1', 'wechat', 'merchantPlatform', '2026-04-01', 'tradeAll',
      repeat('b', 64), repeat('c', 64), 100, 0,
      'finance:merchant/import-1', 'finance-a'
    )
  `);
  await reviewerA.query("BEGIN");
  await reviewerA.query(`
    UPDATE "WeChatBillImportProposal"
    SET "status" = 'approved', "reviewedByUserId" = 'finance-b',
        "reviewedAt" = NOW(), "reviewNote" = 'independent import approval'
    WHERE "id" = 'import-1'
  `);
  let appendSettled = false;
  const competingAppend = reviewerB.query(`
    INSERT INTO "WeChatBillImportEntry" (
      "id", "proposalId", "lineNumber", "entryType", "rowDigest"
    ) VALUES ('late-row', 'import-1', 2, 'trade', repeat('d', 64))
  `).then(
    () => ({ ok: true }),
    (error) => ({ ok: false, error })
  ).finally(() => { appendSettled = true; });
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(appendSettled, false, "append must wait for the proposal status lock");
  await reviewerA.query("COMMIT");
  const appendResult = await competingAppend;
  assert.equal(appendResult.ok, false, "no normalized row may append after approval");
  assert.match(String(appendResult.error?.message ?? ""), /only be appended while pending/);
});
