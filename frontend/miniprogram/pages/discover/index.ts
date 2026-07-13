import { api, ensureSession } from "../../utils/api";
import { Companion } from "../../utils/models";

Page({
  data: { companions: [] as Companion[], loading: true, error: "" },
  onShow() { void this.load(); },
  onPullDownRefresh() { void this.load(true); },
  async load(stopRefresh = false) {
    this.setData({ loading: true, error: "" });
    try {
      await ensureSession();
      const result = await api.companions();
      this.setData({ companions: result.items || [], loading: false });
    } catch (error) {
      this.setData({ loading: false, error: (error as Error).message || "加载失败" });
    } finally {
      if (stopRefresh) wx.stopPullDownRefresh();
    }
  },
  openCompanion(event: any) {
    wx.navigateTo({ url: `/pages/companion/detail?id=${encodeURIComponent(event.currentTarget.dataset.id)}` });
  }
});
