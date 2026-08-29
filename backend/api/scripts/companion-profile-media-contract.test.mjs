import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const repo = resolve(root, "../..");
const read = (path) => readFileSync(resolve(repo, path), "utf8");

test("companion profile media migration is additive, scoped, and replacement-safe", () => {
  const migration = read("backend/api/prisma/migrations/20260828010000_companion_profile_media/migration.sql");
  for (const value of ["companionAvatar", "companionCover", "profileCompanionId", "avatarAssetId", "coverAssetId"]) {
    assert.match(migration, new RegExp(value));
  }
  assert.match(migration, /MediaAsset_controlled_purpose_scope_check/);
  assert.match(migration, /profile-media\/%/);
  assert.match(migration, /ON DELETE SET NULL/);
  assert.match(migration, /ON DELETE RESTRICT/);
});

test("public contract exposes nullable read paths without durable storage references", () => {
  const openapi = read("shared/contracts/openapi/v1.yaml");
  assert.match(openapi, /\/companions\/me\/profile-media\/\{slot\}\/uploads:/);
  assert.match(openapi, /\/companions\/\{id\}\/media\/\{slot\}:/);
  assert.match(openapi, /avatarUrl:[\s\S]*nullable: true/);
  assert.match(openapi, /coverUrl:[\s\S]*nullable: true/);
  assert.doesNotMatch(openapi.slice(openapi.indexOf("PublicCompanion:"), openapi.indexOf("FavoriteCompanion:")), /storageKey|sha256|uploaderId/);
});

test("runtime keeps text-only profile media fail-closed and local UI fallbacks explicit", () => {
  const capability = read("backend/api/src/config/first-release-capability-matrix.ts");
  const service = read("backend/api/src/companions/companion-profile-media.service.ts");
  const clientConfig = read("frontend/miniprogram/utils/config.ts");
  const assets = read("frontend/miniprogram/utils/design-assets.ts");
  const syntheticGateStart = clientConfig.indexOf("export function clientSyntheticDesignAssetsEnabled");
  const syntheticGate = clientConfig.slice(syntheticGateStart, clientConfig.indexOf("/**", syntheticGateStart));
  assert.match(capability, /companionProfileMedia: mediaAllowed/);
  assert.match(service, /PROFILE_MEDIA_DISABLED/);
  assert.match(service, /status !== "approved"/);
  assert.match(service, /storageDeleteNextAttemptAt/);
  assert.match(service, /expiresAt: provisionalUploadExpiry/);
  assert.match(service, /uploadExpiresAt: instruction\.expiresAt, expiresAt: instruction\.expiresAt/);
  assert.match(assets, /Synthetic fallback assets are restricted to the fixed local seed ids/);
  assert.match(assets, /clientSyntheticDesignAssetsEnabled\(\)/);
  assert.match(assets, /DEMO_COMPANION_ASSETS\[companion\.id\]/);
  assert.match(syntheticGate, /value === "develop" \|\| value === "trial"/);
  assert.doesNotMatch(syntheticGate, /miniProgramEnvironment\(\)/);
});
