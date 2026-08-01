import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("legacy account-deletion retention repair migration", () => {
  const sql = readFileSync(resolve(
    process.cwd(),
    "prisma/migrations/20260731237000_account_deletion_retention_legacy_repair/migration.sql"
  ), "utf8");

  it("reopens only narrowly identified legacy immediate-erasure rows", () => {
    expect(sql).toContain('"id" = \'legacy-retention-\' || md5("deletionRequestId" || \':\' || "category")');
    expect(sql).not.toContain("LIKE 'legacy-retention-%'");
    expect(sql).toContain("COALESCE(\"details\"->>'legacyBackfill', 'false') = 'true'");
    expect(sql).toContain('"policyVersion" = \'2026.2-technical-baseline\'');
    expect(sql).toContain('"disposition" = \'pendingErasure\'');
    expect(sql).toContain('"expiryProcessedAt" = NULL');
    expect(sql).toContain('request."userId" = "AccountDataRetentionRecord"."userId"');
    expect(sql).toContain('request."status" = \'completed\'');
    expect(sql).toContain("'identity_authentication_profile'");
    expect(sql).toContain("'preferences_behavior_notifications'");
    expect(sql).toContain("'public_user_content'");
  });

  it("keeps legal approval evidence immutable and permits only verified terminal transitions", () => {
    expect(sql).toContain("OLD.\"disposition\" = 'pendingErasure' AND NEW.\"disposition\" = 'deleted'");
    expect(sql).toContain("OLD.\"disposition\" = 'retainedRestricted' AND NEW.\"disposition\" = 'pseudonymized'");
    expect(sql).toContain("OLD.\"policyApprovalStatus\" = 'pendingLegalApproval'");
    expect(sql).not.toContain("legacy_repair_reset");
    expect(sql).not.toMatch(/UPDATE\s+"AccountDataRetentionRecord"[\s\S]*SET[\s\S]*"policyApprovalStatus"\s*=\s*'approved'/);
  });

  it("limits the legacy terminal reset to the one-time locked migration update", () => {
    const disable = sql.indexOf(
      'DISABLE TRIGGER "AccountDataRetentionRecord_evidence_immutable"'
    );
    const repair = sql.indexOf('UPDATE "AccountDataRetentionRecord"', disable);
    const enable = sql.indexOf(
      'ENABLE TRIGGER "AccountDataRetentionRecord_evidence_immutable"',
      repair
    );

    expect(disable).toBeGreaterThan(-1);
    expect(repair).toBeGreaterThan(disable);
    expect(enable).toBeGreaterThan(repair);
  });

  it("also protects future legacy-repair inserts from older application binaries", () => {
    expect(sql).toContain('CREATE TRIGGER "AccountDataRetentionRecord_legacy_pending_erasure"');
    expect(sql).toContain('BEFORE INSERT ON "AccountDataRetentionRecord"');
    expect(sql).toContain('NEW."disposition" := \'pendingErasure\'');
    expect(sql).toContain('NEW."expiryProcessedAt" := NULL');
  });
});
