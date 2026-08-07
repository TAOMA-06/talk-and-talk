import { HttpStatus } from "@nestjs/common";

import {
  PUBLIC_INTERACTION_IDENTITY_RECOVERY_PATH,
  PUBLIC_INTERACTION_IDENTITY_REQUIRED,
  assertPublicInteractionIdentity,
  isPublicInteractionIdentityVerified,
  resolvePublicInteractionIdentityStatus
} from "./public-interaction-identity.gate";

describe("public-interaction-identity.gate", () => {
  it("accepts only an active account with profile.isVerified true", () => {
    expect(
      resolvePublicInteractionIdentityStatus({
        accountStatus: "active",
        profile: { isVerified: true }
      })
    ).toBe("verified");
    expect(
      isPublicInteractionIdentityVerified({
        accountStatus: "active",
        profile: { isVerified: true }
      })
    ).toBe(true);
  });

  it("rejects missing, false, or non-boolean verification as notVerified", () => {
    expect(resolvePublicInteractionIdentityStatus({})).toBe("notVerified");
    expect(
      resolvePublicInteractionIdentityStatus({
        accountStatus: "active",
        profile: { isVerified: false }
      })
    ).toBe("notVerified");
    expect(
      resolvePublicInteractionIdentityStatus({
        accountStatus: "active",
        profile: null
      })
    ).toBe("notVerified");
  });

  it("treats non-active account status as accountUnavailable", () => {
    expect(
      resolvePublicInteractionIdentityStatus({
        accountStatus: "suspended",
        profile: { isVerified: true }
      })
    ).toBe("accountUnavailable");
  });

  it("throws a stable 403 with recoveryPath and zero free-form ambiguity", () => {
    try {
      assertPublicInteractionIdentity({
        accountStatus: "active",
        profile: { isVerified: false }
      });
      fail("expected assertPublicInteractionIdentity to throw");
    } catch (error: any) {
      expect(error).toMatchObject({
        code: PUBLIC_INTERACTION_IDENTITY_REQUIRED,
        status: HttpStatus.FORBIDDEN
      });
      expect(error.getResponse()).toEqual(
        expect.objectContaining({
          code: PUBLIC_INTERACTION_IDENTITY_REQUIRED,
          details: {
            verificationStatus: "notVerified",
            recoveryPath: "/pages/profile/index",
            publicInteractionBlocked: true
          }
        })
      );
    }
  });

  it("does not throw for a verified active account", () => {
    expect(() =>
      assertPublicInteractionIdentity({
        accountStatus: "active",
        profile: { isVerified: true }
      })
    ).not.toThrow();
  });
});
