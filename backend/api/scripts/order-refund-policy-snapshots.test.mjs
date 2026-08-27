import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import pg from "pg";
import { assertIsolatedPostgresPreflightEnvironment, POSTGRES_PREFLIGHT_SUITE } from "./isolated-postgres-preflight-environment.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = join(here, "..");
const migrationsRoot = join(apiRoot, "prisma", "migrations");
const targetMigration = "20260801007500_order_refund_policy_snapshots";
const targetSqlPath = join(migrationsRoot, targetMigration, "migration.sql");

test("refund policy snapshot migration and decision paths stay fail closed", async () => {
  const [schema, migration, orders, payments, commercial, paymentPage, detailPage] = await Promise.all([
    readFile(join(apiRoot, "prisma", "schema.prisma"), "utf8"),
    readFile(targetSqlPath, "utf8"),
    readFile(join(apiRoot, "src", "orders", "orders.service.ts"), "utf8"),
    readFile(join(apiRoot, "src", "payments", "payments.service.ts"), "utf8"),
    readFile(join(apiRoot, "src", "commercial", "commercial.service.ts"), "utf8"),
    readFile(join(apiRoot, "..", "..", "frontend", "miniprogram", "pages", "order", "payment.wxml"), "utf8"),
    readFile(join(apiRoot, "..", "..", "frontend", "miniprogram", "pages", "order", "detail.wxml"), "utf8")
  ]);

  assert.match(schema, /refundPolicyVersionSnapshot\s+String\s+@db\.VarChar\(64\)/);
  assert.match(schema, /refundRequestWindowHoursSnapshot\s+Int/);
  assert.match(migration, /legacy-inferred-v1/);
  assert.match(migration, /legacy-72h-v1/);
  assert.match(migration, /refundRequestWindowHoursSnapshot" BETWEEN 1 AND 720/);
  assert.match(migration, /Order_refund_request_deadline_snapshot_check/);
  assert.match(migration, /Order refund policy snapshots are immutable/);
  assert.match(orders, /refundPolicyVersionSnapshot: refundPolicySnapshot\.version/);
  assert.match(orders, /completedAt\.getTime\(\) \+ refundPolicySnapshot\.hours \* 60 \* 60_000/);
  const completion = orders.slice(
    orders.indexOf("async completeService"),
    orders.indexOf("async get(", orders.indexOf("async completeService"))
  );
  assert.doesNotMatch(completion, /REFUND_REQUEST_WINDOW_HOURS/);
  const refundRequest = payments.slice(
    payments.indexOf("async requestRefund"),
    payments.indexOf("async syncRefund", payments.indexOf("async requestRefund"))
  );
  assert.doesNotMatch(refundRequest, /REFUND_REQUEST_WINDOW_HOURS/);
  const payoutPolicy = commercial.slice(
    commercial.indexOf("private async payoutHoldReason"),
    commercial.indexOf("private throwPayoutHold", commercial.indexOf("private async payoutHoldReason"))
  );
  assert.doesNotMatch(payoutPolicy, /REFUND_REQUEST_WINDOW_HOURS/);
  for (const page of [paymentPage, detailPage]) {
    assert.match(page, /refundRequestWindowHours/);
    assert.match(page, /refundPolicyVersion/);
    assert.match(page, /用户协议与完整退款条款/);
    assert.match(page, /平台客服/);
  }
});

const integrationUrl = String(process.env.REFUND_POLICY_MIGRATION_TEST_DATABASE_URL ?? "").trim();
const postgresPreflight = process.env.E2E_RUNNER_SUITE === POSTGRES_PREFLIGHT_SUITE
  ? assertIsolatedPostgresPreflightEnvironment()
  : null;

if (postgresPreflight) test("real PostgreSQL deterministically backfills and enforces immutable refund snapshots", async (t) => {
  await postgresPreflight;
  const schemaName = `refund_policy_${randomBytes(8).toString("hex")}`;
  const client = new pg.Client({ connectionString: integrationUrl });
  await client.connect();
  t.after(async () => {
    await client.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await client.end();
  });
  await client.query(`CREATE SCHEMA "${schemaName}"`);
  await client.query(`SET search_path TO "${schemaName}"`);

  const migrationDirectories = (await readdir(migrationsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name < targetMigration)
    .map((entry) => entry.name)
    .sort();
  for (const directory of migrationDirectories) {
    const sql = await readFile(join(migrationsRoot, directory, "migration.sql"), "utf8");
    await client.query(sql);
  }

  await client.query(`
    INSERT INTO "User" ("id", "updatedAt") VALUES ('refund-user', NOW())
  `);
  await client.query(`
    INSERT INTO "CompanionProfile" (
      "id", "name", "role", "initials", "pricePerHalfHour", "bio",
      "availableTimes", "languages", "specialties", "responseTime",
      "cityDistrict", "updatedAt"
    ) VALUES (
      'refund-companion', '测试陪伴者', '倾听者', 'CS', 39, '测试',
      '{}', '{}', '{}', '10 分钟', '测试区', NOW()
    )
  `);
  await client.query(`
    INSERT INTO "Order" (
      "id", "userId", "companionId", "themeId", "durationMinutes",
      "amountCents", "scheduledAt", "companionNameSnapshot",
      "companionRoleSnapshot", "companionInitialsSnapshot",
      "themeNameSnapshot", "status", "completedAt",
      "refundRequestDeadlineAt", "updatedAt"
    ) VALUES
      ('legacy-inferred', 'refund-user', 'refund-companion', 't1', 30, 3900,
       '2026-01-01T00:00:00Z', '测试陪伴者', '倾听者', 'CS', '闲聊',
       'completed', '2026-01-01T01:00:00Z', '2026-01-03T01:00:00Z', NOW()),
      ('legacy-default', 'refund-user', 'refund-companion', 't1', 30, 3900,
       '2026-01-02T00:00:00Z', '测试陪伴者', '倾听者', 'CS', '闲聊',
       'completed', '2026-01-02T01:00:00Z', NULL, NOW()),
      ('legacy-pending', 'refund-user', 'refund-companion', 't1', 30, 3900,
       '2026-01-03T00:00:00Z', '测试陪伴者', '倾听者', 'CS', '闲聊',
       'pending', NULL, NULL, NOW())
  `);

  await client.query(await readFile(targetSqlPath, "utf8"));
  const rows = await client.query(`
    SELECT "id", "refundPolicyVersionSnapshot" AS version,
      "refundRequestWindowHoursSnapshot" AS hours,
      "completedAt", "refundRequestDeadlineAt"
    FROM "Order" ORDER BY "id"
  `);
  const byId = Object.fromEntries(rows.rows.map((row) => [row.id, row]));
  assert.equal(byId["legacy-inferred"].version, "legacy-inferred-v1");
  assert.equal(byId["legacy-inferred"].hours, 48);
  assert.equal(
    byId["legacy-inferred"].refundRequestDeadlineAt.getTime()
      - byId["legacy-inferred"].completedAt.getTime(),
    48 * 60 * 60_000
  );
  assert.equal(byId["legacy-default"].version, "legacy-72h-v1");
  assert.equal(byId["legacy-default"].hours, 72);
  assert.equal(
    byId["legacy-default"].refundRequestDeadlineAt.getTime()
      - byId["legacy-default"].completedAt.getTime(),
    72 * 60 * 60_000
  );
  assert.equal(byId["legacy-pending"].version, "legacy-72h-v1");
  assert.equal(byId["legacy-pending"].hours, 72);
  assert.equal(byId["legacy-pending"].refundRequestDeadlineAt, null);

  await assert.rejects(
    client.query(`UPDATE "Order" SET "refundRequestWindowHoursSnapshot" = 24 WHERE "id" = 'legacy-pending'`),
    /Order refund policy snapshots are immutable/
  );
  await assert.rejects(
    client.query(`
      INSERT INTO "Order" (
        "id", "userId", "companionId", "themeId", "durationMinutes",
        "amountCents", "scheduledAt", "companionNameSnapshot",
        "companionRoleSnapshot", "companionInitialsSnapshot",
        "themeNameSnapshot", "updatedAt"
      ) VALUES (
        'missing-snapshot', 'refund-user', 'refund-companion', 't1', 30, 3900,
        NOW(), '测试陪伴者', '倾听者', 'CS', '闲聊', NOW()
      )
    `),
    /refundPolicyVersionSnapshot|null value/i
  );
});
