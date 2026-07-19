import { LEGAL_URLS } from "../../utils/config";
import { LegalDocument } from "../../utils/privacy";

Page({
  data: { src: "" },
  onLoad(options: { type?: string }) {
    const type: LegalDocument = options.type === "terms" ? "terms" : "privacy";
    this.setData({ src: LEGAL_URLS[type] });
    wx.setNavigationBarTitle({ title: type === "terms" ? "用户协议" : "隐私政策" });
  }
});
