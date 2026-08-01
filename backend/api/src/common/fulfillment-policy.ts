export const FULFILLMENT_POLICY_VERSION = "fulfillment-2026-07-31-v1";
export const FULFILLMENT_TIMEZONE = "Asia/Shanghai";
export const ATTENDANCE_WAIT_MINUTES = 10;
export const ATTENDANCE_CASE_WINDOW_DAYS = 7;
export const ATTENDANCE_EVIDENCE_HOURS = 24;
export const ATTENDANCE_RESPONSE_HOURS = 48;
export const ATTENDANCE_APPEAL_HOURS = 72;

export const ATTENDANCE_PUBLIC_POLICY = {
  version: FULFILLMENT_POLICY_VERSION,
  timezone: FULFILLMENT_TIMEZONE,
  waitMinutes: ATTENDANCE_WAIT_MINUTES,
  caseWindowDays: ATTENDANCE_CASE_WINDOW_DAYS,
  evidenceCollectionHours: ATTENDANCE_EVIDENCE_HOURS,
  counterpartyResponseHours: ATTENDANCE_RESPONSE_HOURS,
  appealHours: ATTENDANCE_APPEAL_HOURS,
  providerEvidence: "Tencent TRTC signed room and media callbacks are treated as trusted attendance metadata.",
  clientEvidence: "Client join, leave, reconnect and heartbeat reports are auxiliary and can never decide a case by themselves.",
  insufficientEvidence: "Insufficient or conflicting evidence is reviewed by staff; absence is never inferred from one client report.",
  recording: "Voice is not recorded by default. Attendance evidence contains timestamps and participant roles, not audio or device fingerprints.",
  settlement: "Opening a case freezes settlement until the case reaches a final outcome.",
  refund: "A refund is real only after the existing payment/refund workflow creates and reconciles a provider refund transaction."
} as const;
