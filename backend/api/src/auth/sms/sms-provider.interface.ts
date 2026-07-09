export const SMS_PROVIDER = "SMS_PROVIDER";

export interface SmsProvider {
  sendCode(phone: string, code: string): Promise<void>;
}
