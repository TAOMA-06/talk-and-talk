import { HttpStatus } from "@nestjs/common";

import { assertPublicInteractionAccountActive } from "./public-interaction-account.guard";

describe("public-interaction-account.guard", () => {
  it.each([true, false, null])(
    "allows an active account regardless of legacy profile verification (%s)",
    (isVerified) => {
      expect(() => assertPublicInteractionAccountActive({
        accountStatus: "active",
        ...({ profile: { isVerified } } as Record<string, unknown>)
      })).not.toThrow();
    }
  );

  it.each(["restricted", "banned", undefined])(
    "rejects a non-active account status (%s)",
    (accountStatus) => {
      try {
        assertPublicInteractionAccountActive({ accountStatus });
        fail("expected assertPublicInteractionAccountActive to throw");
      } catch (error: any) {
        expect(error).toMatchObject({
          code: "ACCOUNT_RESTRICTED",
          status: HttpStatus.FORBIDDEN
        });
        expect(error.getResponse()).toEqual(expect.objectContaining({
          code: "ACCOUNT_RESTRICTED",
          details: {
            accountStatus: accountStatus ?? "unavailable",
            recoveryPath: "/pages/profile/index",
            publicInteractionBlocked: true
          }
        }));
      }
    }
  );
});
