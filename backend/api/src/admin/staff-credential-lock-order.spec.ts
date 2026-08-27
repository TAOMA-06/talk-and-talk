import {
  canonicalStaffCredentialUserIds,
  lockStaffCredentialRowsInOrder
} from "./staff-credential-lock-order";

describe("StaffCredential canonical lock order", () => {
  it("deduplicates and locks the complete participant set in lexical order", async () => {
    const db = { $queryRaw: jest.fn().mockResolvedValue([]) };

    await expect(lockStaffCredentialRowsInOrder(db, [
      "staff-z",
      "staff-a",
      undefined,
      "staff-m",
      "staff-a",
      null
    ])).resolves.toEqual(["staff-a", "staff-m", "staff-z"]);

    expect(db.$queryRaw.mock.calls.map((call) => call[1])).toEqual([
      "staff-a",
      "staff-m",
      "staff-z"
    ]);
    for (const [template] of db.$queryRaw.mock.calls) {
      expect(template.join("?")).toContain('FROM "StaffCredential"');
      expect(template.join("?")).toContain("FOR UPDATE");
    }
  });

  it("normalizes an empty participant set without opening a query", async () => {
    const db = { $queryRaw: jest.fn() };
    expect(canonicalStaffCredentialUserIds([undefined, null, ""])).toEqual([]);
    await expect(lockStaffCredentialRowsInOrder(db, [])).resolves.toEqual([]);
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });
});
