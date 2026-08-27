import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const apiRoot = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = join(apiRoot, "..", "..");

async function source(relativePath) {
  return readFile(join(repoRoot, relativePath), "utf8");
}

test("account appeals consume only approved single-bound controlled uploads", async () => {
  const [migration, schema, evidenceService, mediaService, userService, companionService] =
    await Promise.all([
      source("backend/api/prisma/migrations/20260825020000_controlled_account_appeal_evidence/migration.sql"),
      source("backend/api/prisma/schema.prisma"),
      source("backend/api/src/moderation/media/controlled-case-evidence.service.ts"),
      source("backend/api/src/moderation/media/media-asset.service.ts"),
      source("backend/api/src/account-governance/user-account-actions.service.ts"),
      source("backend/api/src/commercial/companion-lifecycle.service.ts")
    ]);

  for (const purpose of ["userAccountAppeal", "companionAccountAppeal"]) {
    assert.match(schema, new RegExp(`\\b${purpose}\\b`));
    assert.match(migration, new RegExp(`'${purpose}'`));
    assert.match(mediaService, new RegExp(`"${purpose}"`));
  }
  for (const column of [
    "userAccountActionId",
    "companionAccountActionId",
    "userAccountAppealId",
    "companionAccountAppealId"
  ]) {
    assert.match(schema, new RegExp(`\\b${column}\\b`));
    assert.match(migration, new RegExp(`"${column}"`));
  }
  assert.match(migration, /num_nonnulls\([\s\S]*"userAccountAppealId"[\s\S]*"companionAccountAppealId"[\s\S]*\) = 1/);
  assert.match(migration, /asset\."status" <> 'approved'/);
  assert.match(migration, /asset\."uploaderId" <> NEW\."boundByUserId"/);
  assert.match(migration, /target_owner_id IS DISTINCT FROM asset\."uploaderId"/);
  assert.doesNotMatch(migration, /target_owner_id <> asset\."uploaderId"/);
  assert.match(migration, /attachment_count >= 3/);
  assert.match(migration, /legacyEvidenceReferenceCount/);
  assert.match(migration, /DROP COLUMN "evidenceReferences"/);
  assert.doesNotMatch(schema, /evidenceReferences\s+String\[\]/);

  assert.match(evidenceService, /bindUserAccountAppeal/);
  assert.match(evidenceService, /bindCompanionAccountAppeal/);
  assert.match(evidenceService, /controlledCaseAttachment: null/);
  assert.match(userService, /bindUserAccountAppeal\(db/);
  assert.match(companionService, /bindCompanionAccountAppeal\(db/);
  assert.doesNotMatch(companionService, /normalizeReferences|input\.evidenceReferences/);
});

test("recovery, companion and reviewer surfaces expose scoped moderation lifecycle without arbitrary references", async () => {
  const [accountController, companionController, userDto, companionDto, openapi, accountPage, companionPage] =
    await Promise.all([
      source("backend/api/src/account-governance/account-governance.controller.ts"),
      source("backend/api/src/commercial/companion-lifecycle.controller.ts"),
      source("backend/api/src/account-governance/dto/user-account-appeal.dto.ts"),
      source("backend/api/src/commercial/dto/companion-lifecycle.dto.ts"),
      source("shared/contracts/openapi/v1.yaml"),
      source("frontend/miniprogram/pages/account/index.ts"),
      source("frontend/miniprogram/pages/companion/development/index.ts")
    ]);

  for (const route of [
    "/me/account-actions/{id}/appeal-evidence-uploads:",
    "/me/account-actions/{id}/appeal-evidence-uploads/{assetId}/complete:",
    "/me/account-actions/{id}/appeal-evidence-uploads/{assetId}:",
    "/me/account-actions/{id}/appeal-evidence-attachments/{attachmentId}/read-url:",
    "/commercial/companion/actions/{id}/appeal-evidence-uploads:",
    "/commercial/companion/actions/{id}/appeal-evidence-uploads/{assetId}/complete:",
    "/commercial/companion/actions/{id}/appeal-evidence-uploads/{assetId}:"
  ]) {
    assert.ok(openapi.includes(`  ${route}`), `OpenAPI is missing ${route}`);
  }
  assert.match(accountController, /@SkipLegalConsent\(\)[\s\S]*reserveAccountActionAppealEvidence/);
  assert.match(accountController, /@SkipLegalConsent\(\)[\s\S]*completeAccountActionAppealEvidence/);
  assert.match(companionController, /reserveAppealEvidence/);
  assert.match(companionController, /completeAppealEvidence/);
  assert.match(userDto, /ArrayMaxSize\(3\)[\s\S]*evidenceAssetIds/);
  assert.match(companionDto, /ArrayMaxSize\(3\)[\s\S]*evidenceAssetIds/);
  assert.doesNotMatch(companionDto, /evidenceReferences\?:/);
  assert.match(accountPage, /uploadAccountAppealEvidence/);
  assert.match(companionPage, /uploadAppealEvidence/);
  assert.doesNotMatch(companionPage, /setAppealEvidence|appealEvidenceReferences/);
});
