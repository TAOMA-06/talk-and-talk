import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import pg from "pg";

import {
  assertIsolatedPostgresPreflightEnvironment
} from "./isolated-postgres-preflight-environment.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = join(here, "..");
const migrationsRoot = join(apiRoot, "prisma", "migrations");
const targetMigration = "20260825020000_controlled_account_appeal_evidence";
const integrationUrl = String(process.env.TEST_DATABASE_URL ?? "").trim();

test("real PostgreSQL enforces owner, scope, approval, single bind and concurrent max-three appeal evidence", async (t) => {
  await assertIsolatedPostgresPreflightEnvironment();
  const schemaName = `controlled_account_appeal_${randomBytes(8).toString("hex")}`;
  const admin = new pg.Client({ connectionString: integrationUrl });
  const contenderA = new pg.Client({ connectionString: integrationUrl });
  const contenderB = new pg.Client({ connectionString: integrationUrl });
  await Promise.all([admin.connect(), contenderA.connect(), contenderB.connect()]);
  t.after(async () => {
    await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await Promise.all([admin.end(), contenderA.end(), contenderB.end()]);
  });

  await admin.query(`CREATE SCHEMA "${schemaName}"`);
  for (const client of [admin, contenderA, contenderB]) {
    await client.query(`SET search_path TO "${schemaName}"`);
    await client.query("SET statement_timeout TO '20s'");
  }

  const migrationDirectories = (await readdir(migrationsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name < targetMigration)
    .map((entry) => entry.name)
    .sort();
  for (const directory of migrationDirectories) {
    await admin.query(await readFile(join(migrationsRoot, directory, "migration.sql"), "utf8"));
  }

  await admin.query(`
    INSERT INTO "User" ("id", "role", "accountStatus", "createdAt", "updatedAt") VALUES
      ('appeal-user', 'user', 'restricted', NOW(), NOW()),
      ('appeal-owner', 'companion', 'active', NOW(), NOW()),
      ('appeal-other', 'user', 'active', NOW(), NOW()),
      ('appeal-admin', 'admin', 'active', NOW(), NOW());

    INSERT INTO "CompanionProfile" (
      "id", "ownerUserId", "name", "role", "initials", "pricePerHalfHour", "bio",
      "availableTimes", "languages", "specialties", "responseTime", "cityDistrict", "updatedAt"
    ) VALUES (
      'appeal-companion', 'appeal-owner', '测试陪伴者', '倾听者', 'AP', 39, '测试',
      '{}', '{}', '{}', '10 分钟', '测试区', NOW()
    );

    INSERT INTO "UserAccountAction" (
      "id", "userId", "kind", "reasonCode", "message", "policyVersion",
      "startsAt", "appealDeadlineAt", "createdById", "createdAt", "updatedAt"
    ) VALUES (
      'user-action', 'appeal-user', 'restriction', 'POLICY_BOUNDARY',
      '账号安全处置', '2026.1', NOW(), NOW() + INTERVAL '30 days',
      'appeal-admin', NOW(), NOW()
    );
    INSERT INTO "UserAccountAppeal" (
      "id", "actionId", "userId", "statement", "status", "reviewDueAt",
      "policyVersion", "createdAt", "updatedAt"
    ) VALUES (
      'user-appeal', 'user-action', 'appeal-user', '请求独立复核完整事实与时间线。',
      'pending', NOW() + INTERVAL '72 hours', '2026.1', NOW(), NOW()
    );

    INSERT INTO "CompanionAccountAction" (
      "id", "companionId", "kind", "reasonCode", "message", "startsAt",
      "appealDeadlineAt", "createdById", "createdAt", "updatedAt"
    ) VALUES (
      'companion-action', 'appeal-companion', 'warning', 'SERVICE_REVIEW',
      '服务记录待复核', NOW(), NOW() + INTERVAL '30 days', 'appeal-admin', NOW(), NOW()
    );
    INSERT INTO "CompanionAccountAppeal" (
      "id", "actionId", "companionId", "statement", "evidenceReferences",
      "status", "reviewDueAt", "createdAt", "updatedAt"
    ) VALUES (
      'companion-appeal', 'companion-action', 'appeal-companion',
      '请求独立复核完整服务记录与时间线。', ARRAY['legacy://one', 'legacy://two'],
      'pending', NOW() + INTERVAL '72 hours', NOW(), NOW()
    );
  `);

  await admin.query(await readFile(join(migrationsRoot, targetMigration, "migration.sql"), "utf8"));
  const legacy = await admin.query(`
    SELECT "legacyEvidenceReferenceCount" AS count
    FROM "CompanionAccountAppeal" WHERE "id" = 'companion-appeal'
  `);
  assert.equal(legacy.rows[0].count, 2);
  const removedColumn = await admin.query(`
    SELECT COUNT(*)::INTEGER AS count
    FROM information_schema.columns
    WHERE table_schema = $1 AND table_name = 'CompanionAccountAppeal'
      AND column_name = 'evidenceReferences'
  `, [schemaName]);
  assert.equal(removedColumn.rows[0].count, 0);

  const insertAsset = async (
    id,
    uploaderId,
    purpose,
    scopeColumn,
    scopeId,
    status = "approved"
  ) => admin.query(`
    INSERT INTO "MediaAsset" (
      "id", "uploaderId", "purpose", "${scopeColumn}", "kind", "status",
      "storageKey", "mimeType", "sizeBytes", "sha256", "uploadExpiresAt",
      "expiresAt", "createdAt", "updatedAt"
    ) VALUES (
      $1, $2, $3::"MediaAssetPurpose", $4, 'image', $5::"MediaAssetStatus",
      $6, 'image/jpeg', 9, $7, NOW() + INTERVAL '10 minutes',
      NOW() + INTERVAL '1 day', NOW(), NOW()
    )
  `, [id, uploaderId, purpose, scopeId, status, `case-evidence/${purpose}/${scopeId}/${id}`, "a".repeat(64)]);

  await insertAsset("user-asset-1", "appeal-user", "userAccountAppeal", "userAccountActionId", "user-action");
  await insertAsset("user-asset-2", "appeal-user", "userAccountAppeal", "userAccountActionId", "user-action");
  await insertAsset("user-asset-3", "appeal-user", "userAccountAppeal", "userAccountActionId", "user-action");
  await insertAsset("user-asset-4", "appeal-user", "userAccountAppeal", "userAccountActionId", "user-action");
  await insertAsset("companion-asset", "appeal-owner", "companionAccountAppeal", "companionAccountActionId", "companion-action");
  await insertAsset("foreign-asset", "appeal-other", "userAccountAppeal", "userAccountActionId", "user-action");
  await insertAsset("pending-asset", "appeal-user", "userAccountAppeal", "userAccountActionId", "user-action", "scanning");

  await admin.query(`
    INSERT INTO "ControlledCaseEvidenceAttachment" (
      "id", "mediaAssetId", "purpose", "userAccountAppealId", "boundByUserId", "createdAt"
    ) VALUES (
      'user-binding-1', 'user-asset-1', 'userAccountAppeal', 'user-appeal', 'appeal-user', NOW()
    );
    INSERT INTO "ControlledCaseEvidenceAttachment" (
      "id", "mediaAssetId", "purpose", "companionAccountAppealId", "boundByUserId", "createdAt"
    ) VALUES (
      'companion-binding', 'companion-asset', 'companionAccountAppeal',
      'companion-appeal', 'appeal-owner', NOW()
    );
  `);
  await assert.rejects(
    admin.query(`
      INSERT INTO "ControlledCaseEvidenceAttachment" (
        "id", "mediaAssetId", "purpose", "userAccountAppealId", "boundByUserId", "createdAt"
      ) VALUES ('foreign-binding', 'foreign-asset', 'userAccountAppeal', 'user-appeal', 'appeal-other', NOW())
    `),
    /scope or owner mismatch/
  );
  await assert.rejects(
    admin.query(`
      INSERT INTO "ControlledCaseEvidenceAttachment" (
        "id", "mediaAssetId", "purpose", "userAccountAppealId", "boundByUserId", "createdAt"
      ) VALUES ('pending-binding', 'pending-asset', 'userAccountAppeal', 'user-appeal', 'appeal-user', NOW())
    `),
    /asset is not bindable/
  );

  await admin.query(`
    INSERT INTO "ControlledCaseEvidenceAttachment" (
      "id", "mediaAssetId", "purpose", "userAccountAppealId", "boundByUserId", "createdAt"
    ) VALUES ('user-binding-2', 'user-asset-2', 'userAccountAppeal', 'user-appeal', 'appeal-user', NOW())
  `);
  const concurrent = await Promise.allSettled([
    contenderA.query(`
      INSERT INTO "ControlledCaseEvidenceAttachment" (
        "id", "mediaAssetId", "purpose", "userAccountAppealId", "boundByUserId", "createdAt"
      ) VALUES ('user-binding-3a', 'user-asset-3', 'userAccountAppeal', 'user-appeal', 'appeal-user', NOW())
    `),
    contenderB.query(`
      INSERT INTO "ControlledCaseEvidenceAttachment" (
        "id", "mediaAssetId", "purpose", "userAccountAppealId", "boundByUserId", "createdAt"
      ) VALUES ('user-binding-3b', 'user-asset-4', 'userAccountAppeal', 'user-appeal', 'appeal-user', NOW())
    `)
  ]);
  assert.equal(concurrent.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(concurrent.filter((result) => result.status === "rejected").length, 1);
  assert.match(
    String(concurrent.find((result) => result.status === "rejected")?.reason?.message ?? ""),
    /attachment limit reached/
  );
  const bounded = await admin.query(`
    SELECT COUNT(*)::INTEGER AS count
    FROM "ControlledCaseEvidenceAttachment" WHERE "userAccountAppealId" = 'user-appeal'
  `);
  assert.equal(bounded.rows[0].count, 3);

  await assert.rejects(
    admin.query(`
      UPDATE "ControlledCaseEvidenceAttachment"
      SET "userAccountAppealId" = NULL, "companionAccountAppealId" = 'companion-appeal'
      WHERE "id" = 'user-binding-1'
    `),
    /bindings are immutable/
  );
});
