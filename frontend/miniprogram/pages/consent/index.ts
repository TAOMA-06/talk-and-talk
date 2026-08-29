import { currentLegalConsent, ensurePrivacyAuthorization, openLegalDocument, recordLegalConsent } from "../../utils/privacy";

Page({
  data: { brandName: "Talk&Talk", agreed: false, adultConfirmed: false, submitting: false, detailsExpanded: false },
  onShow() {
    if (currentLegalConsent()) wx.switchTab({ url: "/pages/home/index" });
  },
  setAgreement(event: any) { this.setData({ agreed: event.detail.value.includes("accepted") }); },
  setAdultConfirmation(event: any) { this.setData({ adultConfirmed: event.detail.value.includes("adult") }); },
  openTerms() { openLegalDocument("terms"); },
  openPrivacy() { openLegalDocument("privacy"); },
  toggleDetails() { this.setData({ detailsExpanded: !this.data.detailsExpanded }); },
  async enterAccountRights() {
    if (this.data.submitting) return;
    this.setData({ submitting: true });
    try {
      await ensurePrivacyAuthorization();
      wx.navigateTo({ url: "/pages/account/index?recovery=1" });
    } catch (error) {
      wx.showToast({ title: (error as Error).message || "暂时无法验证身份", icon: "none" });
    } finally {
      this.setData({ submitting: false });
    }
  },
  async accept() {
    if (!this.data.agreed || !this.data.adultConfirmed) {
      wx.showToast({ title: "请完成协议与年龄确认", icon: "none" });
      return;
    }
    this.setData({ submitting: true });
    try {
      await ensurePrivacyAuthorization();
      recordLegalConsent();
      wx.switchTab({ url: "/pages/home/index" });
    } catch (error) {
      wx.showToast({ title: (error as Error).message || "暂时无法完成授权", icon: "none" });
    } finally {
      this.setData({ submitting: false });
    }
  }
});
