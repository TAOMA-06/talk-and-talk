import {
  ACCOUNT_DELETION_PUBLIC_POLICY,
  accountDeletionDueAt,
  isAccountDeletionOverdue
} from "./account-deletion-policy";

describe("account deletion policy", () => {
  it("adds 15 Shanghai weekdays from the next day and skips weekends", () => {
    // Friday 16:30 in Shanghai. The fifteenth weekday is Friday three weeks later.
    expect(accountDeletionDueAt(new Date("2026-07-31T08:30:00.000Z")).toISOString())
      .toBe("2026-08-21T08:30:00.000Z");
  });

  it("uses the Shanghai weekday even when UTC is still on the previous date", () => {
    // Monday 00:30 in Shanghai is still Sunday in UTC. Because counting starts
    // the next day, the fifteenth weekday is the following Monday in Shanghai.
    expect(accountDeletionDueAt(new Date("2026-08-02T16:30:00.000Z")).toISOString())
      .toBe("2026-08-23T16:30:00.000Z");
  });

  it("publishes the exact calendar limitation and keeps completed work out of the active overdue queue", () => {
    expect(ACCOUNT_DELETION_PUBLIC_POLICY).toEqual(expect.objectContaining({
      version: "2026.1",
      businessDays: 15,
      timezone: "Asia/Shanghai"
    }));
    expect(ACCOUNT_DELETION_PUBLIC_POLICY.holidayNotice).toContain("不排除法定节假日");
    const dueAt = new Date("2026-08-01T00:00:00.000Z");
    const now = new Date("2026-08-02T00:00:00.000Z");
    expect(isAccountDeletionOverdue("pending", dueAt, now)).toBe(true);
    expect(isAccountDeletionOverdue("completed", dueAt, now)).toBe(false);
    expect(isAccountDeletionOverdue("cancelled", dueAt, now)).toBe(false);
  });
});
