export const STAFF_USER_ROLES = [
  "admin",
  "moderator",
  "support",
  "finance",
  "supply",
  "operations"
] as const;

export type StaffUserRole = (typeof STAFF_USER_ROLES)[number];

export function isStaffUserRole(role: string | null | undefined): role is StaffUserRole {
  return STAFF_USER_ROLES.includes((role ?? "") as StaffUserRole);
}
