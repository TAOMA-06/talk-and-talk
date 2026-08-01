import {
  ACCOUNT_DELETION_PHASES,
  deleteBoundedRows,
  eraseSubjectPhaseBatch
} from "./bounded-erasure";

function createHarness() {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    $queryRawUnsafe: jest.fn(async (sql: string) => (
      sql.includes("SELECT EXISTS")
        ? [{ exists: false }]
        : [{ count: 1, cursor: "(1,1)" }]
    )),
    $executeRaw: jest.fn().mockResolvedValue(0)
  } as any;
  const subject = {
    deletionRequestId: "deletion-1",
    userId: "user-1",
    companionId: "companion-1"
  };
  return { tx, subject };
}

function expectOrdered(...phases: string[]): void {
  const positions = phases.map((phase) => ACCOUNT_DELETION_PHASES.indexOf(
    phase as (typeof ACCOUNT_DELETION_PHASES)[number]
  ));
  expect(positions.every((position) => position >= 0)).toBe(true);
  expect(positions).toEqual([...positions].sort((left, right) => left - right));
}

describe("bounded account erasure graph", () => {
  it("orders dependency-detach phases before deleting their source records", () => {
    expectOrdered("verification_code", "auth_identity", "user_profile");
    expectOrdered(
      "companion_availability_window",
      "recurring_window_detach",
      "companion_recurring_rule"
    );
    expectOrdered(
      "rating_refresh",
      "order_service_offering_detach",
      "companion_offering"
    );
  });

  it("deletes verification codes while both clear-text phone sources still exist", async () => {
    const { tx, subject } = createHarness();

    await expect(eraseSubjectPhaseBatch(tx, "verification_code", subject, 17)).resolves.toEqual({
      affectedCount: 1,
      hasMore: false,
      cursor: "(1,1)"
    });

    const [mutationSql, userId, batchSize] = tx.$queryRawUnsafe.mock.calls[0];
    expect(mutationSql).toContain('DELETE FROM "VerificationCode"');
    expect(mutationSql).toContain('FROM "AuthIdentity" AS identity');
    expect(mutationSql).toContain('identity."provider"::TEXT = \'phone\'');
    expect(mutationSql).toContain('FROM "UserProfile" AS profile');
    expect(mutationSql).toContain('profile."phone" IS NOT NULL');
    expect(userId).toBe("user-1");
    expect(batchSize).toBe(17);
  });

  it("detaches retained windows and orders in bounded statements", async () => {
    const { tx, subject } = createHarness();

    await eraseSubjectPhaseBatch(tx, "recurring_window_detach", subject, 19);
    const recurringSql = tx.$queryRawUnsafe.mock.calls[0][0] as string;
    expect(recurringSql).toContain('UPDATE "CompanionAvailabilityWindow"');
    expect(recurringSql).toContain('"recurringAvailabilityRuleId" = NULL');
    expect(recurringSql).toContain('"recurringOccurrenceStartsAt" = NULL');
    expect(recurringSql).toContain('target."companionId" = $1');

    tx.$queryRawUnsafe.mockClear();
    await eraseSubjectPhaseBatch(tx, "order_service_offering_detach", subject, 23);
    const offeringSql = tx.$queryRawUnsafe.mock.calls[0][0] as string;
    expect(offeringSql).toContain('UPDATE "Order"');
    expect(offeringSql).toContain('"serviceOfferingId" = NULL');
    expect(offeringSql).toContain('FROM "CompanionServiceOffering" AS offering');
    expect(offeringSql).toContain('offering."companionId" = $1');
  });

  it("lets the Review projection trigger own aggregate maintenance", async () => {
    const { tx, subject } = createHarness();

    await eraseSubjectPhaseBatch(tx, "review", subject, 29);
    const sql = tx.$queryRawUnsafe.mock.calls.map(([statement]: [string]) => statement).join("\n");
    expect(sql).toContain('DELETE FROM "Review"');
    expect(sql).not.toContain("AccountDeletionRatingRefreshJob");
    expect(sql).not.toMatch(/\bAVG\s*\(/i);
    expect(sql).not.toContain('UPDATE "CompanionProfile"');
  });

  it("keeps rating_refresh only as bounded cleanup for legacy jobs", async () => {
    const { tx, subject } = createHarness();

    await eraseSubjectPhaseBatch(tx, "rating_refresh", subject, 31);
    const sql = tx.$queryRawUnsafe.mock.calls.map(([statement]: [string]) => statement).join("\n");
    expect(sql).toContain('DELETE FROM "AccountDeletionRatingRefreshJob"');
    expect(sql).toContain('target."deletionRequestId" = $1');
    expect(sql).not.toContain('FROM "Review"');
    expect(sql).not.toContain('UPDATE "CompanionProfile"');
    expect(sql).not.toMatch(/\bAVG\s*\(/i);
  });

  it("allows bounded deletion of auth identity tombstones", async () => {
    const { tx } = createHarness();

    await expect(deleteBoundedRows(
      tx,
      "AuthIdentityTombstone",
      'target."deletionRequestId" = $1',
      ["deletion-1"],
      7
    )).resolves.toEqual({ affectedCount: 1, hasMore: false, cursor: "(1,1)" });
    expect(tx.$queryRawUnsafe.mock.calls[0][0]).toContain(
      'DELETE FROM "AuthIdentityTombstone"'
    );
  });
});
