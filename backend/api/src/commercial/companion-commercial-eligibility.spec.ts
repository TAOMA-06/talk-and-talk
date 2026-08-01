import { assertCurrentCompanionCommercialEligibility } from "./companion-commercial-eligibility";

describe("assertCurrentCompanionCommercialEligibility", () => {
  const now = new Date("2026-08-01T00:00:00.000Z");
  const serviceEnd = new Date("2026-08-02T01:00:00.000Z");

  const database = (profile: any) => ({
    companionCommercialProfile: {
      findUnique: jest.fn().mockResolvedValue(profile)
    }
  });

  it("accepts a verified adult record that remains current through service end", async () => {
    const db = database({
      status: "verified",
      adultEligibilityVerdict: "adult",
      adultEligibilityVerifiedAt: new Date("2026-07-01T00:00:00.000Z"),
      adultEligibilityValidUntil: serviceEnd
    });
    await expect(assertCurrentCompanionCommercialEligibility(db, "companion-1", now, serviceEnd)).resolves.toEqual({
      verifiedAt: new Date("2026-07-01T00:00:00.000Z"),
      validUntil: serviceEnd
    });
    expect(db.companionCommercialProfile.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { companionId: "companion-1" }
    }));
  });

  it("fails closed when adult eligibility expires before service end", async () => {
    const db = database({
      status: "verified",
      adultEligibilityVerdict: "adult",
      adultEligibilityVerifiedAt: new Date("2026-07-01T00:00:00.000Z"),
      adultEligibilityValidUntil: new Date("2026-08-02T00:59:59.999Z")
    });
    await expect(assertCurrentCompanionCommercialEligibility(db, "companion-1", now, serviceEnd)).rejects.toMatchObject({
      code: "COMPANION_ADULT_ELIGIBILITY_VALIDITY_TOO_SHORT"
    });
  });

  it("does not expose the private verdict when eligibility is not current", async () => {
    for (const adultEligibilityVerdict of ["pending", "ineligible"]) {
      try {
        await assertCurrentCompanionCommercialEligibility(database({
          status: "verified",
          adultEligibilityVerdict,
          adultEligibilityVerifiedAt: null,
          adultEligibilityValidUntil: null
        }), "companion-1", now, serviceEnd);
        throw new Error("expected eligibility rejection");
      } catch (error: any) {
        expect(error).toMatchObject({ code: "COMPANION_ADULT_ELIGIBILITY_NOT_CURRENT" });
        expect(JSON.stringify(error.response ?? error)).not.toContain(adultEligibilityVerdict);
      }
    }
  });
});
