export const USER_ACCOUNT_ACTION_POLICY_VERSION = "2026.1";
export const USER_ACCOUNT_APPEAL_SUBMISSION_DAYS = 30;
export const USER_ACCOUNT_APPEAL_REVIEW_HOURS = 72;

export const USER_ACCOUNT_ACTION_EVIDENCE_SOURCE_TYPES = [
  "moderationCase",
  "supportTicket",
  "paymentDispute",
  "attendanceDispute",
  "conversationSafety",
  "manualSafetyReview",
  "legalCompliance"
] as const;

export const USER_ACCOUNT_ACTION_RESTORATION_SOURCE_TYPE = "userAccountAction" as const;

export const USER_ACCOUNT_ACTION_SOURCE_TYPES = [
  ...USER_ACCOUNT_ACTION_EVIDENCE_SOURCE_TYPES,
  USER_ACCOUNT_ACTION_RESTORATION_SOURCE_TYPE
] as const;

export type UserAccountActionSourceType =
  (typeof USER_ACCOUNT_ACTION_SOURCE_TYPES)[number];

export function userAccountAppealDeadline(from: Date): Date {
  return new Date(
    from.getTime() + USER_ACCOUNT_APPEAL_SUBMISSION_DAYS * 24 * 60 * 60_000
  );
}

export function userAccountAppealReviewDueAt(from: Date): Date {
  return new Date(
    from.getTime() + USER_ACCOUNT_APPEAL_REVIEW_HOURS * 60 * 60_000
  );
}
