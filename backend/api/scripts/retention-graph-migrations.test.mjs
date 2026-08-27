import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import pg from "pg";
import ts from "typescript";

import { assertIsolatedPostgresPreflightEnvironment } from "./isolated-postgres-preflight-environment.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = join(here, "..");
const migrationsRoot = join(apiRoot, "prisma", "migrations");
const schemaMigrationName = "20260801007200_retention_graph_schema";
const guardsMigrationName = "20260801007300_retention_graph_guards";
const auditPolicyMigrationName = "20260801007600_audit_subject_policy_registry";
const auditPolicyV3MigrationName = "20260825050000_audit_subject_policy_registry_v3";

function modelBlock(schema, name) {
  const start = schema.indexOf(`model ${name} {`);
  assert.ok(start >= 0, `${name} model must exist`);
  const next = schema.indexOf("\nmodel ", start + 1);
  return schema.slice(start, next < 0 ? schema.length : next);
}

function typescriptControlledAuditRules(source) {
  const registryStart = source.indexOf("CONTROLLED_AUDIT_METADATA_SUBJECT_RULES");
  const registryEnd = source.indexOf("function controlledIdentifier", registryStart);
  const registry = source.slice(registryStart, registryEnd);
  const entries = [];
  for (const match of registry.matchAll(/"([^"]+)":\s*\[([\s\S]*?)\](?:,|\n\})/g)) {
    for (const rule of match[2].matchAll(/key:\s*"([^"]+)",\s*identifierKind:\s*"(user|companion)"/g)) {
      entries.push(`${match[1]}|${rule[1]}|${rule[2]}`);
    }
  }
  return entries.sort();
}

function sqlControlledAuditRules(source) {
  const rulesStart = source.indexOf('controlled_rules("action"');
  const rulesEnd = source.indexOf("), subject_candidates AS", rulesStart);
  const registry = source.slice(rulesStart, rulesEnd);
  return [...registry.matchAll(/\('([^']+)', '([^']+)', '(user|companion)'\)/g)]
    .map((match) => `${match[1]}|${match[2]}|${match[3]}`)
    .sort();
}

function postV2AuditPolicyExtensions(source) {
  return [...source.matchAll(
    /AUDIT_SUBJECT_POLICY_EXTENSION\|([^|\s]+)\|([^|\s]+)\|(user|companion)/g
  )].map((match) => `${match[1]}|${match[2]}|${match[3]}`).sort();
}

async function postV2AuditPolicyMigrationSource() {
  const entries = await readdir(migrationsRoot, { withFileTypes: true });
  const names = entries
    .filter((entry) => entry.isDirectory() && entry.name > auditPolicyMigrationName)
    .map((entry) => entry.name)
    .sort();
  return (await Promise.all(names.map((name) =>
    readFile(join(migrationsRoot, name, "migration.sql"), "utf8")
  ))).join("\n");
}

async function productionTypescriptSources(directory, relative = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const output = [];
  for (const entry of entries) {
    const childRelative = join(relative, entry.name);
    const childPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      output.push(...await productionTypescriptSources(childPath, childRelative));
    } else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".spec.ts")) {
      output.push({ path: childRelative, source: await readFile(childPath, "utf8") });
    }
  }
  return output;
}

function objectProperty(object, name) {
  return object.properties.find((property) => {
    if (ts.isShorthandPropertyAssignment(property)) return property.name.text === name;
    if (!ts.isPropertyAssignment(property)) return false;
    return (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
      && property.name.text === name;
  });
}

function staticPropertyName(property) {
  if (ts.isShorthandPropertyAssignment(property)) return property.name.text;
  if (!ts.isPropertyAssignment(property)) return null;
  return ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name)
    ? property.name.text
    : null;
}

function auditIdentityMetadataKind(key) {
  if (key === "companionId" || /CompanionIds?$/.test(key)) return "companion";
  if (key === "userId" || /UserIds?$/.test(key)) return "user";
  if ([
    "submittedById",
    "evidenceSubmittedById",
    "initialReviewerId",
    "previousHandlerId"
  ].includes(key)) return "user";
  return null;
}

function scanInlineMetadata(initializer) {
  const expression = unwrapExpression(initializer);
  if (!ts.isObjectLiteralExpression(expression)) {
    return { identityRules: [], nestedIdentityKeys: [], invalidIdentityShapes: [] };
  }
  const identityRules = [];
  const nestedIdentityKeys = [];
  const invalidIdentityShapes = [];

  function findNestedIdentity(node) {
    if (ts.isObjectLiteralExpression(node)) {
      for (const property of node.properties) {
        const key = staticPropertyName(property);
        if (key && auditIdentityMetadataKind(key)) nestedIdentityKeys.push(key);
      }
    }
    ts.forEachChild(node, findNestedIdentity);
  }

  for (const property of expression.properties) {
    const key = staticPropertyName(property);
    const identifierKind = key ? auditIdentityMetadataKind(key) : null;
    if (key && identifierKind) {
      identityRules.push({ key, identifierKind });
      if (ts.isPropertyAssignment(property)) {
        const value = unwrapExpression(property.initializer);
        if (ts.isObjectLiteralExpression(value) || ts.isArrayLiteralExpression(value)) {
          invalidIdentityShapes.push(key);
        }
      }
    }
    if (ts.isPropertyAssignment(property)) findNestedIdentity(property.initializer);
  }
  return { identityRules, nestedIdentityKeys, invalidIdentityShapes };
}

function literalActions(expression) {
  if (ts.isStringLiteralLike(expression)) return [expression.text];
  if (ts.isParenthesizedExpression(expression)) return literalActions(expression.expression);
  if (ts.isConditionalExpression(expression)) {
    return [...literalActions(expression.whenTrue), ...literalActions(expression.whenFalse)];
  }
  return [];
}

function unwrapExpression(expression) {
  let current = expression;
  while (ts.isAsExpression(current) || ts.isSatisfiesExpression(current)
    || ts.isParenthesizedExpression(current)) current = current.expression;
  return current;
}

function stringArrayVariable(sourceFile, variableName) {
  let values = null;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)
      && node.name.text === variableName && node.initializer) {
      const initializer = unwrapExpression(node.initializer);
      if (!ts.isArrayLiteralExpression(initializer)) return;
      values = initializer.elements.map((element) => {
        assert.ok(ts.isStringLiteralLike(element), `${variableName} must contain only string literals`);
        return element.text;
      });
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  assert.ok(values, `${variableName} must be a literal array`);
  return values;
}

function typescriptAuditActionPolicies(source) {
  const file = ts.createSourceFile("audit-subject-reference.ts", source, ts.ScriptTarget.Latest, true);
  const groups = [
    ["ACTOR_ONLY_AUDIT_ACTIONS", "actorOnly"],
    ["EXPLICIT_BUSINESS_SUBJECT_AUDIT_ACTIONS", "explicitBusinessSubject"],
    ["SYSTEM_WITH_SUBJECT_AUDIT_ACTIONS", "systemWithSubject"],
    ["SYSTEM_OPERATIONAL_AUDIT_ACTIONS", "systemOperational"]
  ];
  const entries = groups.flatMap(([name, policy]) => stringArrayVariable(file, name)
    .map((action) => [action, policy]));
  assert.equal(new Set(entries.map(([action]) => action)).size, entries.length,
    "audit action policy registry must not contain duplicates");
  return new Map(entries);
}

function typescriptDynamicAuditHelpers(source) {
  const file = ts.createSourceFile("audit-subject-reference.ts", source, ts.ScriptTarget.Latest, true);
  let helpers = null;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)
      && node.name.text === "AUDIT_DYNAMIC_ACTION_HELPERS" && node.initializer) {
      let initializer = node.initializer;
      if (ts.isCallExpression(initializer)) initializer = initializer.arguments[0];
      assert.ok(ts.isObjectLiteralExpression(initializer), "dynamic audit helper registry must be literal");
      helpers = new Map(initializer.properties.map((property) => {
        assert.ok(ts.isPropertyAssignment(property) && ts.isStringLiteralLike(property.name)
          && ts.isArrayLiteralExpression(property.initializer));
        return [property.name.text, property.initializer.elements.map((element) => {
          assert.ok(ts.isStringLiteralLike(element));
          return element.text;
        })];
      }));
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.ok(helpers, "AUDIT_DYNAMIC_ACTION_HELPERS must exist");
  return helpers;
}

function scanProductionAuditCalls(path, source) {
  if (!source.includes("AuditService")) return [];
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const calls = [];
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && ["record", "recordAudit"].includes(node.expression.name.text)) {
      const object = node.arguments.find(ts.isObjectLiteralExpression);
      if (object) {
        const actionProperty = objectProperty(object, "action");
        assert.ok(actionProperty && ts.isPropertyAssignment(actionProperty),
          `audit call must declare action inline: ${path}`);
        const actions = literalActions(actionProperty.initializer);
        const expression = actionProperty.initializer.getText(file).replace(/\s+/g, "");
        const subjectProperty = objectProperty(object, "subjectUserIds");
        const metadataProperty = objectProperty(object, "metadata");
        const metadataScan = metadataProperty && ts.isPropertyAssignment(metadataProperty)
          ? scanInlineMetadata(metadataProperty.initializer)
          : { identityRules: [], nestedIdentityKeys: [], invalidIdentityShapes: [] };
        const resourceTypeProperty = objectProperty(object, "resourceType");
        const resourceIdProperty = objectProperty(object, "resourceId");
        const hasNonEmptySubjects = Boolean(subjectProperty) && (
          !ts.isPropertyAssignment(subjectProperty)
          || !ts.isArrayLiteralExpression(subjectProperty.initializer)
          || subjectProperty.initializer.elements.length > 0
        );
        calls.push({
          path,
          line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
          actions,
          dynamicKey: actions.length ? null : `${path}|${expression}`,
          hasActor: Boolean(objectProperty(object, "actorId")),
          hasSubjects: Boolean(subjectProperty),
          hasNonEmptySubjects,
          identityRules: metadataScan.identityRules,
          nestedIdentityKeys: metadataScan.nestedIdentityKeys,
          invalidIdentityShapes: metadataScan.invalidIdentityShapes,
          resourceTypeExpression: resourceTypeProperty && ts.isPropertyAssignment(resourceTypeProperty)
            ? resourceTypeProperty.initializer.getText(file).replace(/\s+/g, "")
            : null,
          resourceIdExpression: resourceIdProperty && ts.isPropertyAssignment(resourceIdProperty)
            ? resourceIdProperty.initializer.getText(file).replace(/\s+/g, "")
            : null
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return calls;
}

test("retention graph schema and guards remain bounded and database-authoritative", async () => {
  const [
    schema,
    schemaMigration,
    guardsMigration,
    auditPolicyMigration,
    postV2AuditPolicyMigrations,
    reviews,
    media,
    audit,
    boundedErasure,
    lifecycle,
    seed,
    provider,
    disabledProvider
  ] = await Promise.all([
    readFile(join(apiRoot, "prisma", "schema.prisma"), "utf8"),
    readFile(join(migrationsRoot, schemaMigrationName, "migration.sql"), "utf8"),
    readFile(join(migrationsRoot, guardsMigrationName, "migration.sql"), "utf8"),
    readFile(join(migrationsRoot, auditPolicyMigrationName, "migration.sql"), "utf8"),
    postV2AuditPolicyMigrationSource(),
    readFile(join(apiRoot, "src", "reviews", "reviews.service.ts"), "utf8"),
    readFile(join(apiRoot, "src", "moderation", "media", "media-asset.service.ts"), "utf8"),
    readFile(join(apiRoot, "src", "common", "audit", "audit-subject-reference.ts"), "utf8"),
    readFile(join(apiRoot, "src", "common", "privacy", "bounded-erasure.ts"), "utf8"),
    readFile(join(apiRoot, "src", "commercial", "companion-lifecycle.service.ts"), "utf8"),
    readFile(join(apiRoot, "src", "database", "seed.ts"), "utf8"),
    readFile(join(apiRoot, "src", "moderation", "media", "media-provider.interface.ts"), "utf8"),
    readFile(join(apiRoot, "src", "moderation", "media", "disabled-media.providers.ts"), "utf8")
  ]);

  const verificationCode = modelBlock(schema, "VerificationCode");
  assert.doesNotMatch(verificationCode, /\buserId\b/);
  assert.match(verificationCode, /VerificationCode_active_lookup/);
  assert.match(verificationCode, /VerificationCode_retention_due/);

  const snapshot = modelBlock(schema, "AccountDeletionRetentionSnapshotProgress");
  for (const field of [
    "category", "sourceKey", "highWaterAt", "cursorCreatedAt",
    "cursorId", "observedCount", "completedAt"
  ]) assert.match(snapshot, new RegExp(`\\b${field}\\b`));
  assert.match(schemaMigration, /ON DELETE SET NULL/g);
  assert.match(schemaMigration, /AuditSubjectReference_subjectUserId_fkey[\s\S]*ON DELETE RESTRICT/);
  assert.match(schemaMigration, /AuditSubjectReference_subjectUserId_auditLogId_idx/);
  assert.match(schemaMigration, /MediaAsset_storage_delete_due/);

  assert.equal((guardsMigration.match(/FOR EACH STATEMENT/g) ?? []).length, 3);
  assert.equal((guardsMigration.match(/ORDER BY profile\."id"[\s\S]*?FOR UPDATE;/g) ?? []).length, 3);
  assert.match(guardsMigration, /REFERENCING NEW TABLE AS new_reviews/);
  assert.match(guardsMigration, /REFERENCING OLD TABLE AS old_reviews/);
  assert.match(guardsMigration, /AFTER UPDATE ON "Review"[\s\S]*OLD TABLE AS old_reviews NEW TABLE AS new_reviews/);
  assert.match(guardsMigration, /CompanionProfile_rating_projection_check/);
  assert.match(guardsMigration, /Review_rating_check/);
  const createReview = reviews.slice(reviews.indexOf("async create("));
  assert.doesNotMatch(createReview, /review\.aggregate/);
  assert.doesNotMatch(createReview, /companionProfile\.update/);
  assert.doesNotMatch(createReview, /\$executeRawUnsafe/);
  assert.doesNotMatch(createReview, /FROM "CompanionProfile"[\s\S]*FOR UPDATE/);
  assert.match(createReview, /FROM "Order"[\s\S]*FOR UPDATE/);

  const lifecycleQuality = lifecycle.slice(
    lifecycle.indexOf("private async qualityForCompanion"),
    lifecycle.indexOf("private rateMetric", lifecycle.indexOf("private async qualityForCompanion"))
  );
  assert.doesNotMatch(lifecycleQuality, /review\.aggregate/);
  assert.match(lifecycleQuality, /companionProfile\.findUnique/);
  assert.match(lifecycleQuality, /select: \{ rating: true, reviewCount: true \}/);

  const seedProfileUpsert = seed.slice(
    seed.indexOf("await client.companionProfile.upsert"),
    seed.indexOf("await client.companionCommercialProfile.upsert")
  );
  assert.match(seedProfileUpsert, /rating: 0,[\s\S]*ratingSum: 0,[\s\S]*reviewCount: 0/);
  const seedProfileUpdate = seedProfileUpsert.slice(seedProfileUpsert.indexOf("\n      update:"));
  assert.doesNotMatch(seedProfileUpdate, /\b(?:rating|ratingSum|reviewCount)\s*:/);
  assert.doesNotMatch(seed, /(?:rating|reviewCount): companion\.(?:rating|reviewCount)/);

  assert.match(media, /FOR UPDATE(?: OF asset)? SKIP LOCKED/);
  const deleteCall = media.indexOf("this.storage.delete");
  const claimSqlEnd = media.indexOf("private async processStorageDeleteClaim");
  assert.ok(deleteCall > claimSqlEnd, "object storage delete must happen after the claim statement");
  assert.match(media, /storageDeleteLeaseToken" = \$3/);
  assert.match(media, /NoSuchKey/);
  assert.match(media, /httpStatusCode/);
  assert.match(provider, /"deleted" \| "notFound"/);
  assert.match(disabledProvider, /MediaStorageNotConfigured/);
  assert.doesNotMatch(disabledProvider, /return "notFound"/);
  assert.match(guardsMigration, /MediaAsset_storage_delete_terminal_check/);
  assert.match(guardsMigration, /AttendanceDispute_live_participants_check/);
  assert.match(guardsMigration, /"status"::TEXT = 'final'[\s\S]*"openedByUserId" IS NOT NULL[\s\S]*"counterpartyUserId" IS NOT NULL/);
  assert.match(guardsMigration, /OrderRescheduleRequest_pending_requester_check/);
  assert.match(guardsMigration, /"status"::TEXT <> 'pending' OR "requestedByUserId" IS NOT NULL/);
  assert.match(guardsMigration, /DROP CONSTRAINT "AccountDeletionRequest_execution_phase_check"/);
  for (const phase of [
    "verification_code",
    "recurring_window_detach",
    "order_service_offering_detach"
  ]) {
    assert.match(guardsMigration, new RegExp(`'${phase}'`));
    assert.match(boundedErasure, new RegExp(`"${phase}"`));
  }
  assert.match(boundedErasure, /"AuthIdentityTombstone"/);
  assert.doesNotMatch(boundedErasure, /function deleteReviews|function refreshRatings/);

  assert.match(audit, /NON_USER_AUDIT_ACTORS = new Set\(\["system"\]\)/);
  assert.match(auditPolicyMigration, /controlled-v2/);
  assert.match(auditPolicyMigration, /backfill_audit_subject_references_v2/);
  assert.match(postV2AuditPolicyMigrations, /controlled-v3/);
  assert.match(postV2AuditPolicyMigrations, /backfill_audit_subject_references_v3/);
  assert.match(postV2AuditPolicyMigrations, /backfill_audit_subject_references_v2/);
  assert.match(auditPolicyMigration, /LIMIT bounded_batch_size/);
  assert.match(auditPolicyMigration, /LEAST\(GREATEST\(COALESCE\(batch_size, 250\), 1\), 250\)/);
  assert.match(auditPolicyMigration, /\(log\."createdAt", log\."id"\) >/);
  assert.match(auditPolicyMigration, /FOR UPDATE;/);
  assert.match(auditPolicyMigration, /candidate\."metadata" ->> rule\."metadataKey"/);
  assert.doesNotMatch(auditPolicyMigration, /jsonb_path|#>>|jsonb_each|jsonb_object_keys/i);
  for (const exactRule of [
    "account.deletion_execution_queued', 'userId', 'user",
    "refund.requested', 'requestedForUserId', 'user",
    "commercial.companion_withdrawal_requested', 'companionId', 'companion"
  ]) assert.match(auditPolicyMigration, new RegExp(exactRule.replaceAll(".", "\\.")));
  assert.deepEqual(
    [...new Set([
      ...sqlControlledAuditRules(auditPolicyMigration),
      ...postV2AuditPolicyExtensions(postV2AuditPolicyMigrations)
    ])].sort(),
    typescriptControlledAuditRules(audit)
  );
  const policies = typescriptAuditActionPolicies(audit);
  const dynamicHelpers = typescriptDynamicAuditHelpers(audit);
  const sourceFiles = await productionTypescriptSources(join(apiRoot, "src"));
  const reviewCaseSource = sourceFiles.find((file) => file.path === join("review", "review-case.service.ts"));
  assert.ok(reviewCaseSource, "ReviewStaff audit service must exist");
  assert.doesNotMatch(reviewCaseSource.source, /\bAuditService\b|\bauditLog\s*\.\s*create\s*\(/,
    "ReviewStaff ids must never be written into the User-backed central AuditLog");
  assert.match(reviewCaseSource.source, /\breviewAuditLog\s*\?*\.\s*create\s*\(/,
    "ReviewStaff actions must retain their dedicated ReviewAuditLog trail");
  assert.match(reviewCaseSource.source, /\bmoderationActionLog\s*\.\s*create\s*\(/,
    "ReviewStaff moderation decisions must retain ModerationActionLog evidence");
  for (const file of sourceFiles) {
    if (file.path !== join("common", "audit", "audit.service.ts")) {
      assert.doesNotMatch(file.source, /\bauditLog\s*\.\s*create\s*\(/,
        `production audit writes must use AuditService: ${file.path}`);
    }
  }
  const productionAuditCalls = sourceFiles.flatMap((file) => scanProductionAuditCalls(file.path, file.source));
  const controlledAuditRules = new Set(typescriptControlledAuditRules(audit));
  const missingControlledAuditRules = [];
  const observedActions = new Set();
  const observedDynamicHelpers = new Set();
  for (const caller of productionAuditCalls) {
    const actions = caller.actions.length
      ? caller.actions
      : dynamicHelpers.get(caller.dynamicKey) ?? [];
    if (!caller.actions.length) {
      assert.ok(dynamicHelpers.has(caller.dynamicKey),
        `dynamic audit action helper is not explicitly allowlisted: ${caller.dynamicKey}:${caller.line}`);
      observedDynamicHelpers.add(caller.dynamicKey);
    }
    for (const action of actions) {
      const policy = policies.get(action);
      assert.ok(policy, `production audit action is unclassified: ${action} in ${caller.path}:${caller.line}`);
      observedActions.add(action);
      if (policy === "actorOnly") {
        assert.ok(caller.hasActor,
          `actor-only audit action must declare actorId: ${action} in ${caller.path}:${caller.line}`);
      } else if (policy === "explicitBusinessSubject" || policy === "systemWithSubject") {
        assert.ok(caller.hasNonEmptySubjects,
          `retention-aware audit action must declare non-empty subjectUserIds: ${action} in ${caller.path}:${caller.line}`);
      } else {
        assert.equal(caller.hasSubjects, false,
          `system operational audit action cannot declare subjectUserIds: ${action} in ${caller.path}:${caller.line}`);
      }
      for (const rule of caller.identityRules) {
        if (!controlledAuditRules.has(`${action}|${rule.key}|${rule.identifierKind}`)) {
          missingControlledAuditRules.push(
            `${action}.${rule.key} (${rule.identifierKind}) in ${caller.path}:${caller.line}`
          );
        }
      }
    }
    assert.deepEqual(caller.nestedIdentityKeys, [],
      `nested audit identity metadata is forbidden in ${caller.path}:${caller.line}`);
    assert.deepEqual(caller.invalidIdentityShapes, [],
      `audit identity metadata must be an exact scalar in ${caller.path}:${caller.line}`);
    if (caller.resourceIdExpression) {
      assert.ok(!["\"user\"", "\"auth\""].includes(caller.resourceTypeExpression),
        `User/auth audit resourceId duplicates subject identity in ${caller.path}:${caller.line}`);
      assert.doesNotMatch(caller.resourceIdExpression,
        /(?:^|\.)(?:userId|targetUserId|requestedForUserId|subjectUserId)$|(?:^|\.)(?:user|actor)\.id$/,
        `direct User identity must not be stored as audit resourceId in ${caller.path}:${caller.line}`);
    }
  }
  assert.deepEqual(
    missingControlledAuditRules,
    [],
    `top-level audit identity metadata is not registered:\n${missingControlledAuditRules.join("\n")}`
  );
  assert.deepEqual([...observedDynamicHelpers].sort(), [...dynamicHelpers.keys()].sort(),
    "dynamic audit helper allowlist must exactly match production helper calls");
  assert.deepEqual([...observedActions].sort(), [...policies.keys()].sort(),
    "audit action policy registry must exactly match all production actions");
  const controlledActions = new Set(
    typescriptControlledAuditRules(audit).map((rule) => rule.split("|", 1)[0])
  );
  for (const action of controlledActions) {
    assert.notEqual(policies.get(action), "actorOnly",
      `metadata-subject action cannot be actor-only: ${action}`);
  }
  assert.match(guardsMigration, /RetentionSnapshotProgress_cursor_pair_check/);
  assert.match(guardsMigration, /high-water must equal deletion approval time/);

  for (const constraint of [
    "AttendanceDispute_appealedByUserId_fkey",
    "OrderRescheduleRequest_requestedByUserId_fkey",
    "OrderRescheduleRequest_respondedByUserId_fkey"
  ]) {
    const drop = schemaMigration.indexOf(`DROP CONSTRAINT IF EXISTS "${constraint}"`);
    const add = schemaMigration.indexOf(`ADD CONSTRAINT "${constraint}"`);
    assert.ok(drop >= 0 && add > drop, `${constraint} must be dropped before it is added`);
  }
});

const integrationUrl = String(
  process.env.RETENTION_GRAPH_TEST_DATABASE_URL
    ?? process.env.TEST_DATABASE_URL
    ?? ""
).trim();

test("real PostgreSQL enforces rating deltas, controlled audit backfill and detach guards", {
  skip: integrationUrl ? false : "set RETENTION_GRAPH_TEST_DATABASE_URL to a disposable PostgreSQL database"
}, async (t) => {
  await assertIsolatedPostgresPreflightEnvironment();
  const namespace = `retention_graph_${randomBytes(8).toString("hex")}`;
  const client = new pg.Client({ connectionString: integrationUrl });
  await client.connect();
  t.after(async () => {
    await client.query(`DROP SCHEMA IF EXISTS "${namespace}" CASCADE`);
    await client.end();
  });

  await client.query(`CREATE SCHEMA "${namespace}"`);
  await client.query(`SET search_path TO "${namespace}"`);
  await client.query("SET statement_timeout TO '10s'");

  const migrationDirectories = (await readdir(migrationsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name <= auditPolicyV3MigrationName)
    .map((entry) => entry.name)
    .sort();
  assert.ok(migrationDirectories.includes(schemaMigrationName));
  assert.ok(migrationDirectories.includes(guardsMigrationName));
  assert.ok(migrationDirectories.includes(auditPolicyMigrationName));
  assert.ok(migrationDirectories.includes(auditPolicyV3MigrationName));
  for (const directory of migrationDirectories) {
    const sql = await readFile(join(migrationsRoot, directory, "migration.sql"), "utf8");
    await client.query(sql);
  }

  await client.query(`
    INSERT INTO "User" ("id", "role", "accountStatus", "createdAt", "updatedAt") VALUES
      ('customer-1', 'user', 'active', NOW(), NOW()),
      ('customer-2', 'user', 'active', NOW(), NOW()),
      ('owner-1', 'companion', 'active', NOW(), NOW()),
      ('detach-1', 'user', 'active', NOW(), NOW()),
      ('detach-live-attendance', 'user', 'active', NOW(), NOW()),
      ('detach-live-reschedule', 'user', 'active', NOW(), NOW()),
      ('admin-1', 'admin', 'active', NOW(), NOW());

    INSERT INTO "CompanionProfile" (
      "id", "ownerUserId", "name", "role", "initials", "pricePerHalfHour",
      "bio", "availableTimes", "languages", "specialties", "responseTime",
      "cityDistrict", "createdAt", "updatedAt"
    ) VALUES
      ('companion-1', 'owner-1', 'One', 'listener', 'O', 3900, 'bio', ARRAY[]::TEXT[], ARRAY[]::TEXT[], ARRAY[]::TEXT[], 'fast', 'Shanghai', NOW(), NOW()),
      ('companion-2', NULL, 'Two', 'listener', 'T', 3900, 'bio', ARRAY[]::TEXT[], ARRAY[]::TEXT[], ARRAY[]::TEXT[], 'fast', 'Shanghai', NOW(), NOW());

    INSERT INTO "Order" (
      "id", "userId", "companionId", "themeId", "durationMinutes", "amountCents",
      "scheduledAt", "companionNameSnapshot", "companionRoleSnapshot",
      "companionInitialsSnapshot", "themeNameSnapshot", "refundPolicyVersionSnapshot",
      "refundRequestWindowHoursSnapshot", "createdAt", "updatedAt"
    ) VALUES
      ('order-1', 'customer-1', 'companion-1', 'theme', 30, 3900, NOW(), 'One', 'listener', 'O', 'Theme', 'test-v1', 72, NOW(), NOW()),
      ('order-2', 'customer-2', 'companion-1', 'theme', 30, 3900, NOW(), 'One', 'listener', 'O', 'Theme', 'test-v1', 72, NOW(), NOW()),
      ('order-3', 'customer-1', 'companion-1', 'theme', 30, 3900, NOW(), 'One', 'listener', 'O', 'Theme', 'test-v1', 72, NOW(), NOW()),
      ('order-4', 'customer-1', 'companion-1', 'theme', 30, 3900, NOW(), 'One', 'listener', 'O', 'Theme', 'test-v1', 72, NOW(), NOW()),
      ('order-5', 'customer-1', 'companion-1', 'theme', 30, 3900, NOW(), 'One', 'listener', 'O', 'Theme', 'test-v1', 72, NOW(), NOW()),
      ('order-6', 'customer-1', 'companion-1', 'theme', 30, 3900, NOW(), 'One', 'listener', 'O', 'Theme', 'test-v1', 72, NOW(), NOW()),
      ('order-review-lock', 'customer-2', 'companion-1', 'theme', 30, 3900, NOW(), 'One', 'listener', 'O', 'Theme', 'test-v1', 72, NOW(), NOW());
  `);

  await client.query(`
    INSERT INTO "Review" ("id", "orderId", "userId", "companionId", "rating", "content", "createdAt") VALUES
      ('review-1', 'order-1', 'customer-1', 'companion-1', 5, 'great', NOW()),
      ('review-2', 'order-2', 'customer-2', 'companion-1', 3, 'good', NOW())
  `);
  let projection = await client.query(`
    SELECT "ratingSum", "reviewCount", "rating" FROM "CompanionProfile" WHERE "id" = 'companion-1'
  `);
  assert.deepEqual(projection.rows[0], { ratingSum: 8, reviewCount: 2, rating: 4 });

  await client.query(`UPDATE "Review" SET "rating" = 1 WHERE "id" = 'review-1'`);
  await client.query(`UPDATE "Review" SET "companionId" = 'companion-2' WHERE "id" = 'review-1'`);
  projection = await client.query(`
    SELECT "id", "ratingSum", "reviewCount", "rating"
    FROM "CompanionProfile" WHERE "id" IN ('companion-1', 'companion-2') ORDER BY "id"
  `);
  assert.deepEqual(projection.rows, [
    { id: "companion-1", ratingSum: 3, reviewCount: 1, rating: 3 },
    { id: "companion-2", ratingSum: 1, reviewCount: 1, rating: 1 }
  ]);

  await client.query(`DELETE FROM "Review" WHERE "id" IN ('review-1', 'review-2')`);
  projection = await client.query(`
    SELECT "ratingSum", "reviewCount", "rating"
    FROM "CompanionProfile" WHERE "id" IN ('companion-1', 'companion-2') ORDER BY "id"
  `);
  assert.deepEqual(projection.rows, [
    { ratingSum: 0, reviewCount: 0, rating: 0 },
    { ratingSum: 0, reviewCount: 0, rating: 0 }
  ]);
  await assert.rejects(
    client.query(`
      INSERT INTO "Review" ("id", "orderId", "userId", "companionId", "rating", "content", "createdAt")
      VALUES ('review-invalid', 'order-3', 'customer-1', 'companion-1', 6, 'invalid', NOW())
    `),
    (error) => error?.code === "23514"
  );

  await client.query(`
    INSERT INTO "Order" (
      "id", "userId", "companionId", "themeId", "durationMinutes", "amountCents",
      "scheduledAt", "companionNameSnapshot", "companionRoleSnapshot",
      "companionInitialsSnapshot", "themeNameSnapshot", "refundPolicyVersionSnapshot",
      "refundRequestWindowHoursSnapshot", "createdAt", "updatedAt"
    ) VALUES
      ('order-concurrency-a1', 'customer-1', 'companion-1', 'theme', 30, 3900, NOW(), 'One', 'listener', 'O', 'Theme', 'test-v1', 72, NOW(), NOW()),
      ('order-concurrency-a2', 'customer-1', 'companion-2', 'theme', 30, 3900, NOW(), 'Two', 'listener', 'T', 'Theme', 'test-v1', 72, NOW(), NOW()),
      ('order-concurrency-b1', 'customer-2', 'companion-1', 'theme', 30, 3900, NOW(), 'One', 'listener', 'O', 'Theme', 'test-v1', 72, NOW(), NOW()),
      ('order-concurrency-b2', 'customer-2', 'companion-2', 'theme', 30, 3900, NOW(), 'Two', 'listener', 'T', 'Theme', 'test-v1', 72, NOW(), NOW());
    INSERT INTO "Review" ("id", "orderId", "userId", "companionId", "rating", "content", "createdAt") VALUES
      ('concurrency-a-c1', 'order-concurrency-a1', 'customer-1', 'companion-1', 5, 'a1', NOW()),
      ('concurrency-a-c2', 'order-concurrency-a2', 'customer-1', 'companion-2', 4, 'a2', NOW()),
      ('concurrency-b-c1', 'order-concurrency-b1', 'customer-2', 'companion-1', 3, 'b1', NOW()),
      ('concurrency-b-c2', 'order-concurrency-b2', 'customer-2', 'companion-2', 2, 'b2', NOW());
  `);

  // Both statements affect the same companions but present them in reverse
  // order and lock disjoint Review rows. Ordered profile locks in the trigger
  // must serialize them without a 40P01 deadlock.
  const replicaA = new pg.Client({ connectionString: integrationUrl });
  const replicaB = new pg.Client({ connectionString: integrationUrl });
  await Promise.all([replicaA.connect(), replicaB.connect()]);
  try {
    for (const replica of [replicaA, replicaB]) {
      await replica.query(`SET search_path TO "${namespace}"`);
      await replica.query("SET statement_timeout TO '5s'");
      await replica.query("BEGIN");
    }
    const updateA = replicaA.query(`
      UPDATE "Review" review
      SET "rating" = changes.rating
      FROM (VALUES ('concurrency-a-c1', 4), ('concurrency-a-c2', 3)) AS changes(id, rating)
      WHERE review."id" = changes.id
    `).then(() => "a");
    const updateB = replicaB.query(`
      UPDATE "Review" review
      SET "rating" = changes.rating
      FROM (VALUES ('concurrency-b-c2', 5), ('concurrency-b-c1', 1)) AS changes(id, rating)
      WHERE review."id" = changes.id
    `).then(() => "b");
    const first = await Promise.race([updateA, updateB]);
    if (first === "a") {
      await replicaA.query("COMMIT");
      assert.equal(await updateB, "b");
      await replicaB.query("COMMIT");
    } else {
      await replicaB.query("COMMIT");
      assert.equal(await updateA, "a");
      await replicaA.query("COMMIT");
    }
  } finally {
    await Promise.allSettled([replicaA.query("ROLLBACK"), replicaB.query("ROLLBACK")]);
    await Promise.all([replicaA.end(), replicaB.end()]);
  }

  const concurrentProjection = await client.query(`
    WITH aggregate AS (
      SELECT "companionId", SUM("rating")::INTEGER AS "ratingSum", COUNT(*)::INTEGER AS "reviewCount"
      FROM "Review" GROUP BY "companionId"
    )
    SELECT profile."id", profile."ratingSum", profile."reviewCount", profile."rating",
           aggregate."ratingSum" AS "expectedSum", aggregate."reviewCount" AS "expectedCount"
    FROM "CompanionProfile" profile
    JOIN aggregate ON aggregate."companionId" = profile."id"
    ORDER BY profile."id"
  `);
  for (const row of concurrentProjection.rows) {
    assert.equal(row.ratingSum, row.expectedSum);
    assert.equal(row.reviewCount, row.expectedCount);
    assert.equal(row.rating, row.expectedSum / row.expectedCount);
  }

  // The service locks Order before inserting Review; the Review trigger then
  // locks CompanionProfile. Exercise that same order against a competing
  // Order -> CompanionProfile path. The competing transaction may wait, but it
  // must not form the old CompanionProfile -> Order deadlock cycle.
  const reviewWriter = new pg.Client({ connectionString: integrationUrl });
  const orderProfileWriter = new pg.Client({ connectionString: integrationUrl });
  await Promise.all([reviewWriter.connect(), orderProfileWriter.connect()]);
  try {
    for (const replica of [reviewWriter, orderProfileWriter]) {
      await replica.query(`SET search_path TO "${namespace}"`);
      await replica.query("SET statement_timeout TO '5s'");
      await replica.query("BEGIN");
    }
    await reviewWriter.query(`SELECT "id" FROM "Order" WHERE "id" = 'order-review-lock' FOR UPDATE`);
    const competingOrderLock = orderProfileWriter.query(
      `SELECT "id" FROM "Order" WHERE "id" = 'order-review-lock' FOR UPDATE`
    );
    await new Promise((resolve) => setTimeout(resolve, 25));
    await reviewWriter.query(`
      INSERT INTO "Review" (
        "id", "orderId", "userId", "companionId", "rating", "content", "createdAt"
      ) VALUES (
        'review-order-lock', 'order-review-lock', 'customer-2', 'companion-1', 5, 'lock order', NOW()
      )
    `);
    await reviewWriter.query("COMMIT");
    await competingOrderLock;
    await orderProfileWriter.query(`
      UPDATE "CompanionProfile" SET "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = 'companion-1'
    `);
    await orderProfileWriter.query("COMMIT");
  } finally {
    await Promise.allSettled([reviewWriter.query("ROLLBACK"), orderProfileWriter.query("ROLLBACK")]);
    await Promise.all([reviewWriter.end(), orderProfileWriter.end()]);
  }

  const orderLockProjection = await client.query(`
    SELECT profile."ratingSum", profile."reviewCount", profile."rating",
           SUM(review."rating")::INTEGER AS "expectedSum",
           COUNT(review.*)::INTEGER AS "expectedCount"
    FROM "CompanionProfile" profile
    JOIN "Review" review ON review."companionId" = profile."id"
    WHERE profile."id" = 'companion-1'
    GROUP BY profile."id"
  `);
  assert.equal(orderLockProjection.rows[0].ratingSum, orderLockProjection.rows[0].expectedSum);
  assert.equal(orderLockProjection.rows[0].reviewCount, orderLockProjection.rows[0].expectedCount);
  assert.equal(
    orderLockProjection.rows[0].rating,
    orderLockProjection.rows[0].expectedSum / orderLockProjection.rows[0].expectedCount
  );

  const approvedAt = new Date();
  await client.query(`
    INSERT INTO "AccountDeletionRequest" (
      "id", "userId", "status", "approvedById", "approvedAt", "dueAt",
      "policyVersion", "createdAt", "updatedAt"
    ) VALUES ('deletion-1', 'customer-2', 'pending', 'admin-1', $1, NOW() + INTERVAL '7 days', 'retention-v1', NOW(), NOW())
  `, [approvedAt]);
  for (const phase of [
    "verification_code",
    "recurring_window_detach",
    "order_service_offering_detach"
  ]) {
    await client.query(
      `UPDATE "AccountDeletionRequest" SET "executionPhase" = $1 WHERE "id" = 'deletion-1'`,
      [phase]
    );
  }
  await assert.rejects(
    client.query(`
      UPDATE "AccountDeletionRequest"
      SET "executionPhase" = 'unregistered_phase'
      WHERE "id" = 'deletion-1'
    `),
    (error) => error?.code === "23514"
      && error?.constraint === "AccountDeletionRequest_execution_phase_check"
  );
  await client.query(`
    INSERT INTO "AccountDeletionRetentionSnapshotProgress" (
      "id", "deletionRequestId", "category", "sourceKey", "highWaterAt",
      "observedCount", "createdAt", "updatedAt"
    ) VALUES ('snapshot-1', 'deletion-1', 'transactions_tax_invoices', 'orders', $1, 0, NOW(), NOW())
  `, [approvedAt]);
  await assert.rejects(
    client.query(`
      INSERT INTO "AccountDeletionRetentionSnapshotProgress" (
        "id", "deletionRequestId", "category", "sourceKey", "highWaterAt",
        "cursorCreatedAt", "observedCount", "createdAt", "updatedAt"
      ) VALUES ('snapshot-invalid', 'deletion-1', 'transactions_tax_invoices', 'payments', $1, NOW(), 0, NOW(), NOW())
    `, [approvedAt]),
    (error) => error?.code === "23514"
  );

  await client.query(`
    INSERT INTO "AuditLog" ("id", "actorId", "action", "resourceType", "metadata", "createdAt") VALUES
      ('audit-1', 'customer-1', 'account.deletion_requested', 'request', '{"userId":"customer-2"}', NOW()),
      ('audit-2', 'system', 'commercial.companion_withdrawal_requested', 'withdrawal', '{"companionId":"companion-1"}', NOW()),
      ('audit-3', 'system', 'unregistered.action', 'other', '{"nested":{"userId":"customer-2"}}', NOW())
  `);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const batch = await client.query(`SELECT * FROM "backfill_audit_subject_references_v3"(1)`);
    if (batch.rows[0]?.completed) break;
  }
  const v3State = await client.query(`
    SELECT "completedAt" IS NOT NULL AS completed
    FROM "AuditSubjectReferenceBackfillState"
    WHERE "version" = 'controlled-v3'
  `);
  assert.equal(v3State.rows[0]?.completed, true);
  const references = await client.query(`
    SELECT "auditLogId", "subjectUserId", "relationKind"
    FROM "AuditSubjectReference"
    ORDER BY "auditLogId", "subjectUserId"
  `);
  assert.deepEqual(references.rows, [
    { auditLogId: "audit-1", subjectUserId: "customer-1", relationKind: "actor" },
    { auditLogId: "audit-1", subjectUserId: "customer-2", relationKind: "subject" },
    { auditLogId: "audit-2", subjectUserId: "owner-1", relationKind: "subject" }
  ]);

  await client.query(`
    INSERT INTO "AttendanceDispute" (
      "id", "orderId", "openedByUserId", "openedByRole", "counterpartyUserId",
      "issue", "status", "policyVersionSnapshot", "timezoneSnapshot",
      "evidenceDueAt", "counterpartyResponseDueAt", "createdAt", "updatedAt"
    ) VALUES (
      'attendance-1', 'order-4', 'detach-1', 'customer', 'customer-1',
      'other', 'final', 'fulfillment-v1', 'Asia/Shanghai', NOW(), NOW(), NOW(), NOW()
    );
    INSERT INTO "OrderRescheduleRequest" (
      "id", "orderId", "requestedByUserId", "requestedByRole", "originalScheduledAt",
      "requestedScheduledAt", "status", "expiresAt", "respondedAt", "respondedByUserId",
      "createdAt", "updatedAt"
    ) VALUES (
      'reschedule-1', 'order-4', 'detach-1', 'customer', NOW(), NOW() + INTERVAL '1 day',
      'rejected', NOW() + INTERVAL '2 days', NOW(), 'detach-1', NOW(), NOW()
    )
  `);
  await client.query(`DELETE FROM "User" WHERE "id" = 'detach-1'`);
  const detached = await client.query(`
    SELECT dispute."openedByUserId", request."requestedByUserId", request."respondedByUserId"
    FROM "AttendanceDispute" dispute
    JOIN "OrderRescheduleRequest" request ON request."orderId" = dispute."orderId"
    WHERE dispute."id" = 'attendance-1'
  `);
  assert.deepEqual(detached.rows[0], {
    openedByUserId: null,
    requestedByUserId: null,
    respondedByUserId: null
  });

  await client.query(`
    INSERT INTO "AttendanceDispute" (
      "id", "orderId", "openedByUserId", "openedByRole", "counterpartyUserId",
      "issue", "status", "policyVersionSnapshot", "timezoneSnapshot",
      "evidenceDueAt", "counterpartyResponseDueAt", "createdAt", "updatedAt"
    ) VALUES (
      'attendance-live', 'order-5', 'detach-live-attendance', 'customer', 'customer-1',
      'other', 'review', 'fulfillment-v1', 'Asia/Shanghai', NOW(), NOW(), NOW(), NOW()
    );
    INSERT INTO "OrderRescheduleRequest" (
      "id", "orderId", "requestedByUserId", "requestedByRole", "originalScheduledAt",
      "requestedScheduledAt", "status", "expiresAt", "createdAt", "updatedAt"
    ) VALUES (
      'reschedule-live', 'order-6', 'detach-live-reschedule', 'customer', NOW(),
      NOW() + INTERVAL '1 day', 'pending', NOW() + INTERVAL '2 days', NOW(), NOW()
    )
  `);
  await assert.rejects(
    client.query(`DELETE FROM "User" WHERE "id" = 'detach-live-attendance'`),
    (error) => error?.code === "23514"
      && error?.constraint === "AttendanceDispute_live_participants_check"
  );
  await assert.rejects(
    client.query(`DELETE FROM "User" WHERE "id" = 'detach-live-reschedule'`),
    (error) => error?.code === "23514"
      && error?.constraint === "OrderRescheduleRequest_pending_requester_check"
  );
});
