/**
 * Client mapping for shared public-interaction identity errors.
 * Mirrors backend `PUBLIC_INTERACTION_IDENTITY_REQUIRED` details without
 * re-implementing the server gate.
 */

export type PublicInteractionErrorLike = {
  code?: string;
  statusCode?: number;
  message?: string;
  details?: {
    recoveryPath?: unknown;
    verificationStatus?: unknown;
    publicInteractionBlocked?: unknown;
  } | null;
};

export const PUBLIC_INTERACTION_IDENTITY_REQUIRED = "PUBLIC_INTERACTION_IDENTITY_REQUIRED";

export function isPublicInteractionIdentityError(
  error: PublicInteractionErrorLike | null | undefined
): boolean {
  return error?.code === PUBLIC_INTERACTION_IDENTITY_REQUIRED;
}

export function publicInteractionErrorUserMessage(
  error: PublicInteractionErrorLike | null | undefined
): string {
  if (!isPublicInteractionIdentityError(error)) {
    return error?.message || "服务暂时不可用";
  }
  const status = error?.details?.verificationStatus;
  if (status === "accountUnavailable") {
    return "当前账号暂时无法进行公开互动，请联系客服或稍后再试。";
  }
  return "身份核验授权通道尚未开放；新预约、支付、公开发帖和即时消息暂不可用。可前往账号页查看说明与客服入口。";
}

export function publicInteractionRecoveryPath(
  error: PublicInteractionErrorLike | null | undefined
): string | null {
  if (!isPublicInteractionIdentityError(error)) return null;
  const path = error?.details?.recoveryPath;
  if (typeof path === "string" && path.trim().startsWith("/pages/")) return path.trim();
  return "/pages/profile/index";
}
