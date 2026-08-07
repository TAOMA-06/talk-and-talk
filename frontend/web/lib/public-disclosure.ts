/**
 * Verified public-company facts, mirrored from release configuration only.
 *
 * Do not put placeholders, provisional registrations, or unverified contact
 * details here. Empty values intentionally keep the official site in its
 * transparent "pending public verification" state.
 */
function verifiedPublicValue(value: string | undefined) {
  const normalized = value?.trim() || "";
  return /^(replace[_-]?me|todo|tbd|example)/i.test(normalized) ? "" : normalized;
}

export const publicDisclosure = {
  operatorName: verifiedPublicValue(process.env.NEXT_PUBLIC_LEGAL_OPERATOR_NAME),
  contactEmail: verifiedPublicValue(process.env.NEXT_PUBLIC_LEGAL_CONTACT_EMAIL),
  contactPhone: verifiedPublicValue(process.env.NEXT_PUBLIC_LEGAL_CONTACT_PHONE),
  complaintChannel: verifiedPublicValue(process.env.NEXT_PUBLIC_LEGAL_COMPLAINT_CHANNEL),
  icpRecord: verifiedPublicValue(process.env.NEXT_PUBLIC_ICP_RECORD),
  icpRecordUrl: verifiedPublicValue(process.env.NEXT_PUBLIC_ICP_RECORD_URL),
};

export const hasVerifiedPublicDisclosure = Boolean(
  publicDisclosure.operatorName
  && publicDisclosure.contactEmail
  && publicDisclosure.contactPhone
  && publicDisclosure.complaintChannel,
);

export const PUBLIC_SITE_CONTENT_UPDATED_AT = new Date("2026-08-04T00:00:00.000Z");
