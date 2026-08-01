export const MODERATION_APPEAL_POLICY_VERSION = "2026.1";
export const MODERATION_APPEAL_SUBMISSION_DAYS = 30;
export const MODERATION_APPEAL_REVIEW_HOURS = 72;

export const MODERATION_APPEALABLE_ACTIONS = [
  "confirmViolation",
  "rejectMessage",
  "restrict24h",
  "restrict7d"
] as const;

export function moderationAppealDeadline(from: Date): Date {
  return new Date(
    from.getTime() + MODERATION_APPEAL_SUBMISSION_DAYS * 24 * 60 * 60_000
  );
}

export function moderationAppealReviewDueAt(from: Date): Date {
  return new Date(
    from.getTime() + MODERATION_APPEAL_REVIEW_HOURS * 60 * 60_000
  );
}
