import { registerDecorator, ValidationOptions } from "class-validator";

export type SensitivePlaintextKind =
  | "identityNumber"
  | "paymentCard"
  | "phoneNumber"
  | "password"
  | "securityCode"
  | "verificationCode"
  | "accessCredential";

const PRC_ID_WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2] as const;
const PRC_ID_CHECKSUM = ["1", "0", "X", "9", "8", "7", "6", "5", "4", "3", "2"] as const;
const MASKED_OR_STATUS_VALUE = /^(?:\[?(?:redacted|masked|hidden)\]?|[*\u2022\u25cfxX]{3,}|(?:\u5df2|\u672a|\u4e0d|\u65e0)(?:\u91cd\u7f6e|\u66f4\u65b0|\u4fee\u6539|\u5220\u9664|\u63d0\u4f9b|\u8bb0\u5f55|\u6838\u9a8c|\u9a8c\u8bc1|\u4fdd\u5b58|\u7559\u5b58|\u8bbe\u7f6e|\u77e5\u6089).*)$/i;

function isValidPrcIdentityNumber(value: string): boolean {
  if (!/^\d{17}[\dX]$/.test(value)) return false;
  const sum = PRC_ID_WEIGHTS.reduce((total, weight, index) => total + Number(value[index]) * weight, 0);
  return PRC_ID_CHECKSUM[sum % 11] === value[17];
}

function isLuhnValid(value: string): boolean {
  if (value.length < 13 || value.length > 19 || /^(\d)\1+$/.test(value)) return false;
  let sum = 0;
  let doubleDigit = false;
  for (let index = value.length - 1; index >= 0; index -= 1) {
    let digit = Number(value[index]);
    if (doubleDigit) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    doubleDigit = !doubleDigit;
  }
  return sum % 10 === 0;
}

function hasRawIdentityNumber(value: string): boolean {
  const labeled = /(?:\u8eab\u4efd\u8bc1(?:\u53f7|\u53f7\u7801)?|\u516c\u6c11\u8eab\u4efd\u53f7\u7801|\u8bc1\u4ef6\u53f7\u7801|id\s*card(?:\s*number)?)[\s:\uff1a=\u662f\u4e3a#-]*([0-9]{15}|[0-9]{17}[0-9X])/i;
  if (labeled.test(value)) return true;
  return Array.from(value.matchAll(/(?:^|\D)(\d{17}[\dX])(?=$|\D)/g))
    .some((match) => isValidPrcIdentityNumber(match[1]));
}

function hasRawPaymentCard(value: string): boolean {
  return Array.from(value.matchAll(/(?:^|[^\d*])((?:\d[ -]?){12,18}\d)(?!\d)/g))
    .some((match) => isLuhnValid(match[1].replace(/[ -]/g, "")));
}

function assignedValues(value: string, label: RegExp): string[] {
  return Array.from(value.matchAll(label), (match) => match[1]?.replace(/[)\]}\u3002.!?\uff01\uff1f]+$/g, "") ?? "")
    .filter(Boolean);
}

function containsUnmaskedAssignment(value: string, pattern: RegExp): boolean {
  return assignedValues(value, pattern).some((candidate) => !MASKED_OR_STATUS_VALUE.test(candidate));
}

/**
 * Detects obvious raw secrets or identifiers in staff-authored operational text.
 * Controlled evidence references and already-masked values intentionally remain
 * outside this detector; callers should validate references with a strict allowlist.
 */
export function detectSensitivePlaintext(input: string): SensitivePlaintextKind | null {
  const value = input.normalize("NFKC");
  if (hasRawIdentityNumber(value)) return "identityNumber";
  if (hasRawPaymentCard(value)) return "paymentCard";
  if (/(?:^|\D)(?:\+?86[- ]?)?1[3-9]\d{9}(?!\d)/.test(value)) return "phoneNumber";

  if (/(?:cvv2?|cvc2?|\u5b89\u5168\u7801|\u5361\u80cc\u7801|\u5361\u7247\u9a8c\u8bc1\u7801)[\s:\uff1a=\u662f\u4e3a#-]{1,12}\d{3,4}(?!\d)/i.test(value)) {
    return "securityCode";
  }
  if (/(?:otp|one[- ]?time(?:\s+(?:password|code))?|verification\s*code|\u9a8c\u8bc1\u7801|\u77ed\u4fe1\u7801|\u52a8\u6001\u7801|\u6821\u9a8c\u7801)[\s:\uff1a=\u662f\u4e3a#-]{1,12}\d{4,8}(?!\d)/i.test(value)) {
    return "verificationCode";
  }
  if (containsUnmaskedAssignment(
    value,
    /(?:\u5bc6\u7801|\u53e3\u4ee4|pwd|pass(?:word|code)?)[\s]*(?::|\uff1a|=|\u662f|\u4e3a|\s)[\s]*([^\s,\uff0c;\uff1b]{3,128})/gi
  )) {
    return "password";
  }
  if (/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(value)) return "accessCredential";
  if (containsUnmaskedAssignment(
    value,
    /(?:access[_ -]?token|refresh[_ -]?token|api[_ -]?key|client[_ -]?secret|secret|\u5bc6\u94a5|\u4ee4\u724c)[\s]*(?::|\uff1a|=|\u662f|\u4e3a)[\s]*([A-Za-z0-9+/=_\-.]{8,})/gi
  )) {
    return "accessCredential";
  }
  return null;
}

export function IsSafeOperationalText(validationOptions?: ValidationOptions): PropertyDecorator {
  return (target, propertyKey) => {
    registerDecorator({
      name: "isSafeOperationalText",
      target: target.constructor,
      propertyName: propertyKey.toString(),
      options: {
        message: "$property must not contain raw sensitive data; use an approved evidence reference or a masked value",
        ...validationOptions
      },
      validator: {
        validate(value: unknown) {
          return typeof value !== "string" || detectSensitivePlaintext(value) === null;
        }
      }
    });
  };
}
