type StaffCredentialLockDatabase = {
  $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
};

export function canonicalStaffCredentialUserIds(
  userIds: Array<string | null | undefined>
): string[] {
  return [...new Set(
    userIds.filter((userId): userId is string => typeof userId === "string" && userId.length > 0)
  )].sort();
}

/**
 * Locks every known StaffCredential participant in one canonical order.
 * Callers must supply the complete actor/target/replacement set before taking
 * the first row lock; adding a later credential would recreate a lock cycle.
 */
export async function lockStaffCredentialRowsInOrder(
  db: StaffCredentialLockDatabase,
  userIds: Array<string | null | undefined>
): Promise<string[]> {
  const orderedUserIds = canonicalStaffCredentialUserIds(userIds);
  for (const userId of orderedUserIds) {
    await db.$queryRaw`SELECT "id" FROM "StaffCredential" WHERE "userId" = ${userId} FOR UPDATE`;
  }
  return orderedUserIds;
}
