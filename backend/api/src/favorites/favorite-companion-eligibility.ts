/**
 * A favorite never bypasses the marketplace's live public-supply gate. Keep
 * this predicate shared between bookmark reads/writes and internal reminder
 * candidate generation so neither path can reveal or target hidden supply.
 */
export function publicFavoriteCompanionWhere() {
  return {
    isPublished: true,
    isVerified: true,
    ownerUserId: { not: null },
    owner: { accountStatus: "active", profile: { isVerified: true } },
    commercialProfile: { status: "verified" }
  };
}
