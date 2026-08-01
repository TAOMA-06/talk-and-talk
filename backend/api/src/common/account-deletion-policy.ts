export const ACCOUNT_DELETION_POLICY_VERSION = "2026.1";
export const ACCOUNT_DELETION_BUSINESS_DAYS = 15;
export const ACCOUNT_DELETION_TIMEZONE = "Asia/Shanghai";

const DAY_MS = 24 * 60 * 60_000;
const SHANGHAI_UTC_OFFSET_MS = 8 * 60 * 60_000;

export const ACCOUNT_DELETION_PUBLIC_POLICY = {
  version: ACCOUNT_DELETION_POLICY_VERSION,
  businessDays: ACCOUNT_DELETION_BUSINESS_DAYS,
  timezone: ACCOUNT_DELETION_TIMEZONE,
  calendarRule: "从申请后的下一自然日开始计算，仅跳过周六和周日。",
  holidayNotice: "当前期限计算不排除法定节假日，也不按调休工作日调整。"
} as const;

/**
 * Adds weekdays using the Asia/Shanghai calendar while preserving the request
 * time of day. China Standard Time has no daylight-saving transitions, so a
 * fixed UTC+8 shift gives deterministic weekday boundaries in every runtime.
 * Statutory holidays and adjusted working weekends are deliberately not part
 * of this versioned rule.
 */
export function accountDeletionDueAt(from: Date): Date {
  let cursor = from.getTime();
  let remaining = ACCOUNT_DELETION_BUSINESS_DAYS;

  while (remaining > 0) {
    cursor += DAY_MS;
    const localWeekday = new Date(cursor + SHANGHAI_UTC_OFFSET_MS).getUTCDay();
    if (localWeekday !== 0 && localWeekday !== 6) remaining -= 1;
  }

  return new Date(cursor);
}

export function isAccountDeletionOverdue(
  status: string,
  dueAt: Date,
  now: Date = new Date()
): boolean {
  return ["pending", "processing"].includes(status) && dueAt.getTime() < now.getTime();
}
