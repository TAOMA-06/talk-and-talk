export const SERVICE_INTENT_POLICY_VERSION = "2026.1";

export const SERVICE_INTENT_CODES = [
  "listen",
  "comfort",
  "organize",
  "advice",
  "lightCompanionship"
] as const;

export type ServiceIntentCode = typeof SERVICE_INTENT_CODES[number];

const SERVICE_INTENT_LABELS: Record<ServiceIntentCode, string> = {
  listen: "只想被倾听",
  comfort: "希望获得情绪安抚",
  organize: "想梳理思路",
  advice: "希望听取一般建议",
  lightCompanionship: "轻松聊聊"
};

export function serviceIntentLabel(value: ServiceIntentCode | null | undefined): string | null {
  return value ? SERVICE_INTENT_LABELS[value] : null;
}
