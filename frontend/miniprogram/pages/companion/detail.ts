import { api, ensureSession } from "../../utils/api";
import { Companion, Review } from "../../utils/models";

function bookingDefaults(): { date: string; time: string } {
  const date = new Date(Date.now() + 60 * 60 * 1000);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60 * 1000).toISOString();
  return { date: local.slice(0, 10), time: local.slice(11, 16) };
}

Page({
  data: {
    companion: null as Companion | null, reviews: [] as Review[], loading: true, error: "", booking: false,
    bookingDate: bookingDefaults().date, bookingTime: bookingDefaults().time
  },
  companionId: "",
  onLoad(query: any) { this.companionId = query.id || ""; void this.load(); },
  async load() {
    this.setData({ loading: true, error: "" });
    try {
      await ensureSession();
      const [companion, reviews] = await Promise.all([api.companion(this.companionId), api.reviews(this.companionId)]);
      this.setData({ companion, reviews: reviews.items || [], loading: false });
    } catch (error) { this.setData({ loading: false, error: (error as Error).message || "加载失败" }); }
  },
  setBookingDate(event: any) { this.setData({ bookingDate: event.detail.value }); },
  setBookingTime(event: any) { this.setData({ bookingTime: event.detail.value }); },
  async book() {
    const scheduledAt = new Date(`${this.data.bookingDate}T${this.data.bookingTime}:00`);
    if (!Number.isFinite(scheduledAt.getTime()) || scheduledAt.getTime() <= Date.now()) {
      wx.showToast({ title: "请选择未来的预约时间", icon: "none" });
      return;
    }
    this.setData({ booking: true });
    try {
      await api.createOrder({ companionId: this.companionId, themeId: "t1", durationMinutes: 30, scheduledAt: scheduledAt.toISOString() });
      wx.showToast({ title: "订单已创建", icon: "success" });
      setTimeout(() => wx.switchTab({ url: "/pages/orders/index" }), 500);
    } catch (error) {
      wx.showToast({ title: (error as Error).message || "创建订单失败", icon: "none" });
    } finally { this.setData({ booking: false }); }
  }
});
