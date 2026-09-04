import { HttpStatus } from "@nestjs/common";

import { AppException } from "../common/errors/app.exception";

/**
 * Keeps public-interaction writes limited to active accounts without requiring
 * an identity-authority grant. Legal consent, adult eligibility, companion
 * commercial eligibility, moderation, order capacity and payment checks remain
 * separate and continue to run at their existing boundaries.
 */
export type PublicInteractionAccountInput = {
  accountStatus?: string | null;
};

export function assertPublicInteractionAccountActive(
  input: PublicInteractionAccountInput
): void {
  if (input.accountStatus === "active") return;
  throw new AppException(
    "ACCOUNT_RESTRICTED",
    "Account is not active for public interaction",
    HttpStatus.FORBIDDEN,
    {
      accountStatus: input.accountStatus ?? "unavailable",
      recoveryPath: "/pages/profile/index",
      publicInteractionBlocked: true
    }
  );
}
