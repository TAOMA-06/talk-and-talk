import { currentLoginIdentityUnavailableNotice } from "../../utils/api";

const DEFAULT_MESSAGE = "该登录标识暂不可使用，请联系客服";

Page({
  data: {
    message: DEFAULT_MESSAGE
  },
  onShow() {
    const notice = currentLoginIdentityUnavailableNotice();
    this.setData({ message: notice?.message || DEFAULT_MESSAGE });
  },
  retryLogin() {
    wx.reLaunch({ url: "/pages/consent/index" });
  }
});
