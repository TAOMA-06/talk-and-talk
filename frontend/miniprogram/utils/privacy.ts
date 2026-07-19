import { LEGAL_CONSENT_VERSION, LEGAL_URLS } from "./config";

const LEGAL_CONSENT_KEY = "talkandtalk.legalConsent";
let consentRedirectInFlight = false;

export type LegalDocument = keyof typeof LEGAL_URLS;
export type LegalConsentRecord = {
  version: string;
  acceptedAt: string;
  privacyAccepted: true;
  termsAccepted: true;
  adultConfirmed: true;
  privacyUrl: string;
  termsUrl: string;
  source: "wechatMiniProgram";
  userId?: string;
};

export function currentLegalConsent(): LegalConsentRecord | null {
  const record = wx.getStorageSync(LEGAL_CONSENT_KEY) as LegalConsentRecord | undefined;
  if (
    !record || record.version !== LEGAL_CONSENT_VERSION ||
    record.privacyAccepted !== true || record.termsAccepted !== true ||
    record.adultConfirmed !== true ||
    record.source !== "wechatMiniProgram" ||
    !Number.isFinite(Date.parse(record.acceptedAt)) ||
    record.privacyUrl !== LEGAL_URLS.privacy || record.termsUrl !== LEGAL_URLS.terms
  ) return null;
  return record;
}

export function recordLegalConsent(): LegalConsentRecord {
  const record: LegalConsentRecord = {
    version: LEGAL_CONSENT_VERSION,
    acceptedAt: new Date().toISOString(),
    privacyAccepted: true,
    termsAccepted: true,
    adultConfirmed: true,
    privacyUrl: LEGAL_URLS.privacy,
    termsUrl: LEGAL_URLS.terms,
    source: "wechatMiniProgram"
  };
  wx.setStorageSync(LEGAL_CONSENT_KEY, record);
  return record;
}

export function bindLegalConsentToUser(userId: string): void {
  const record = currentLegalConsent();
  if (record && record.userId !== userId) wx.setStorageSync(LEGAL_CONSENT_KEY, { ...record, userId });
}

export function withdrawLegalConsent(): void {
  wx.removeStorageSync(LEGAL_CONSENT_KEY);
}

export function requireLegalConsent(): void {
  if (currentLegalConsent()) return;
  if (!consentRedirectInFlight && wx.reLaunch) {
    consentRedirectInFlight = true;
    wx.reLaunch({
      url: "/pages/consent/index",
      complete: () => { consentRedirectInFlight = false; }
    });
  }
  throw new Error("请先阅读并同意用户协议与隐私政策");
}

export function openLegalDocument(document: LegalDocument): void {
  wx.navigateTo({ url: `/pages/legal/index?type=${document}` });
}

/** Requests the platform-managed privacy authorization when the current Mini Program configuration requires it. */
export function ensurePrivacyAuthorization(): Promise<void> {
  if (!wx.getPrivacySetting || !wx.requirePrivacyAuthorize) return Promise.resolve();
  return new Promise((resolve, reject) => {
    wx.getPrivacySetting({
      success: (setting: any) => {
        if (!setting.needAuthorization) {
          resolve();
          return;
        }
        wx.requirePrivacyAuthorize({ success: () => resolve(), fail: () => reject(new Error("需要同意隐私保护指引后才能继续")) });
      },
      fail: () => reject(new Error("暂时无法确认微信隐私授权状态，请稍后重试"))
    });
  });
}
