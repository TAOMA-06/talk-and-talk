import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("commercial StaffCredential offboarding is server-authoritative and ReviewStaff-independent", async () => {
  const [schema, migration, service, lockOrder, controller, strategy, auth, bootstrap] = await Promise.all([
    read("prisma/schema.prisma"),
    read("prisma/migrations/20260731233000_staff_credential_offboarding/migration.sql"),
    read("src/admin/staff-offboarding.service.ts"),
    read("src/admin/staff-credential-lock-order.ts"),
    read("src/admin/admin-staff.controller.ts"),
    read("src/auth/strategies/jwt.strategy.ts"),
    read("src/auth/auth.service.ts"),
    read("src/database/bootstrap-staff.ts")
  ]);

  assert.match(schema, /enum StaffCredentialStatus[\s\S]*active[\s\S]*suspended/);
  assert.match(schema, /model StaffCredential[\s\S]*status\s+StaffCredentialStatus/);
  assert.match(schema, /offboardingOperationId\s+String\?\s+@unique/);
  assert.match(migration, /prevent_staff_credential_reactivation/);
  assert.match(migration, /enforce_active_commercial_staff_assignment/);
  assert.match(migration, /FOR KEY SHARE OF sc/);
  assert.doesNotMatch(migration, /ALTER TABLE "ReviewStaff"/);

  assert.match(controller, /@Controller\("admin\/staff"\)/);
  assert.match(controller, /@Roles\("admin"\)/);
  assert.match(controller, /@Get\("eligible-successors"\)/);
  assert.match(service, /listEligibleSuccessors/);
  assert.match(service, /skip: \(query\.page - 1\) \* query\.pageSize/);
  assert.match(service, /take: query\.pageSize/);
  assert.match(service, /STAFF_SELF_SUSPENSION_FORBIDDEN/);
  assert.match(service, /STAFF_LAST_ADMIN_SUSPENSION_FORBIDDEN/);
  assert.match(service, /STAFF_HANDOFF_REQUIRED/);
  assert.match(service, /STAFF_HANDOFF_POSTCONDITION_FAILED/);
  assert.match(service, /admin\.staff_credential_suspended/);
  assert.match(service, /refreshToken\.updateMany/);
  assert.match(service, /lockStaffCredentialRowsInOrder\(db, \[[\s\S]*actorUserId,[\s\S]*targetUserId,[\s\S]*dto\.replacementUserId/);
  assert.match(lockOrder, /new Set/);
  assert.match(lockOrder, /\.sort\(\)/);
  assert.match(lockOrder, /StaffCredential[\s\S]*FOR UPDATE/);
  const handoff = service.slice(
    service.indexOf("private async handoffAssignments"),
    service.indexOf("private emptyHandoffResult")
  );
  assert.doesNotMatch(handoff, /findMany/);
  assert.doesNotMatch(handoff, /id:\s*\{\s*in:/);
  assert.match(handoff, /action:\s*\{ createdById: replacementUserId \}/);
  assert.match(handoff, /\{ action: \{ createdById: null \} \}/);
  assert.match(handoff, /decidedByUserId: replacementUserId/);
  assert.match(handoff, /\{ decidedByUserId: null \}/);
  assert.doesNotMatch(service, /db\.reviewStaff/);
  assert.doesNotMatch(service, /db\.reviewSession/);

  assert.match(strategy, /user\.staffCredential\?\.status !== "active"/);
  assert.match(auth, /StaffCredential" WHERE "userId" = \$\{user\.id\} FOR UPDATE/);
  assert.match(bootstrap, /cannot be reactivated by bootstrap/);
  assert.match(bootstrap, /where: \{ id: existing\.userId \},[\s\S]*?data: \{\s*role,\s*profile:/);
});

test("commercial admin UI and OpenAPI expose a deliberate confirmed handoff flow", async () => {
  const [html, javascript, openapi] = await Promise.all([
    read("public/admin/index.html"),
    read("public/admin/assets/app.js"),
    read("../../shared/contracts/openapi/v1.yaml")
  ]);

  assert.match(html, /id="staffOffboardingPanel"/);
  assert.match(html, /禁止自停与停掉最后一名 active admin/);
  assert.match(javascript, /WORKFORCE ACCESS · IMMEDIATE REVOCATION/);
  assert.match(javascript, /confirmationCode: confirmationCode\(item\.userId\)/);
  assert.match(javascript, /\/admin\/staff\/\$\{encodeURIComponent\(item\.userId\)\}\/suspensions/);
  assert.match(javascript, /\/admin\/staff\/eligible-successors/);
  assert.match(javascript, /while \(page <= totalPages\)/);
  assert.match(javascript, /independence/);
  assert.match(openapi, /\/admin\/staff\/\{userId\}\/suspensions:/);
  assert.match(openapi, /\/admin\/staff\/eligible-successors:/);
  assert.match(openapi, /SuspendCommercialStaffInput:/);
  assert.match(openapi, /CommercialStaffSuspensionEnvelope:/);
  assert.match(openapi, /ReviewStaff is a separate identity domain and is never mutated/);
});
