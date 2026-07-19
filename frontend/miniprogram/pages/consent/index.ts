import { currentLegalConsent, ensurePrivacyAuthorization, openLegalDocument, recordLegalConsent } from "../../utils/privacy";

Page({
  data: { agreed: false, adultConfirmed: false, submitting: false },
  onShow() {
    if (currentLegalConsent()) wx.switchTab({ url: "/pages/discover/index" });
  },
  setAgreement(event: any) { this.setData({ agreed: event.detail.value.includes("accepted") }); },
  setAdultConfirmation(event: any) { this.setData({ adultConfirmed: event.detail.value.includes("adult") }); },
  openTerms() { openLegalDocument("terms"); },
  openPrivacy() { openLegalDocument("privacy"); },
  async accept() {
    if (!this.data.agreed || !this.data.adultConfirmed) {
      wx.showToast({ title: "请完成协议与年龄确认", icon: "none" });
      return;
    }
    this.setData({ submitting: true });
    try {
      await ensurePrivacyAuthorization();
      recordLegalConsent();
      wx.switchTab({ url: "/pages/discover/index" });
    } catch (error) {
      wx.showToast({ title: (error as Error).message || "暂时无法完成授权", icon: "none" });
    } finally {
      this.setData({ submitting: false });
    }
  }
});
