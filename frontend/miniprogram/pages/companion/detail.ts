import { api, ensureSession } from "../../utils/api";
import { Companion, Review } from "../../utils/models";
import { requestTransactionalSubscriptions } from "../../utils/subscription";

function bookingDefaults(): { date: string; time: string } {
  const date = new Date(Date.now() + 60 * 60 * 1000);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60 * 1000).toISOString();
  return { date: local.slice(0, 10), time: local.slice(11, 16) };
}

function createOrderRequestId(): string {
  return `order_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}_${Math.random().toString(36).slice(2, 12)}`;
}

const PENDING_ORDER_PREFIX = "talkandtalk.pendingOrder.";

function pendingOrderStorageKey(companionId: string, themeId: string, scheduledAt: Date): string {
  return `${PENDING_ORDER_PREFIX}${companionId}:${themeId}:30:${scheduledAt.toISOString()}`;
}

function persistedOrderRequestId(storageKey: string, scheduledAt: Date): string {
  try {
    const pending = wx.getStorageSync(storageKey) as { clientRequestId?: unknown; expiresAt?: unknown } | undefined;
    if (
      pending &&
      typeof pending.clientRequestId === "string" &&
      /^[A-Za-z0-9_-]{16,64}$/.test(pending.clientRequestId) &&
      typeof pending.expiresAt === "number" &&
      pending.expiresAt > Date.now()
    ) {
      return pending.clientRequestId;
    }
    if (pending) wx.removeStorageSync(storageKey);
  } catch {
    // Storage exhaustion must not prevent an order attempt; the in-memory key
    // below still protects retries during the current page lifetime.
  }

  const clientRequestId = createOrderRequestId();
  try {
    wx.setStorageSync(storageKey, {
      clientRequestId,
      // Keep an ambiguous network attempt recoverable through the appointment
      // and its immediate support window; successful responses delete it.
      expiresAt: scheduledAt.getTime() + 24 * 60 * 60_000
    });
  } catch {
    // See the storage-exhaustion note above.
  }
  return clientRequestId;
}

Page({
  data: {
    companion: null as Companion | null, reviews: [] as Review[], loading: true, error: "", booking: false,
    bookingDate: bookingDefaults().date, bookingTime: bookingDefaults().time,
    orderClientRequestId: ""
  },
  companionId: "",
  recommendationImpressionId: "",
  themeId: "t1",
  onLoad(query: any) {
    this.companionId = query.id || "";
    this.recommendationImpressionId = query.rid || "";
    this.themeId = ["t1", "t2", "t3", "t4", "t5", "t6"].includes(query.themeId) ? query.themeId : "t1";
    void this.load();
  },
  async load() {
    this.setData({ loading: true, error: "" });
    try {
      await ensureSession();
      const [companion, reviews] = await Promise.all([api.companion(this.companionId), api.reviews(this.companionId)]);
      this.setData({ companion, reviews: reviews.items || [], loading: false });
    } catch (error) { this.setData({ loading: false, error: (error as Error).message || "加载失败" }); }
  },
  setBookingDate(event: any) { this.setData({ bookingDate: event.detail.value, orderClientRequestId: "" }); },
  setBookingTime(event: any) { this.setData({ bookingTime: event.detail.value, orderClientRequestId: "" }); },
  async book() {
    const scheduledAt = new Date(`${this.data.bookingDate}T${this.data.bookingTime}:00`);
    if (!Number.isFinite(scheduledAt.getTime()) || scheduledAt.getTime() <= Date.now() + 15 * 60_000) {
      wx.showToast({ title: "请至少提前 15 分钟预约", icon: "none" });
      return;
    }
    const storageKey = pendingOrderStorageKey(this.companionId, this.themeId, scheduledAt);
    const clientRequestId = this.data.orderClientRequestId || persistedOrderRequestId(storageKey, scheduledAt);
    if (!this.data.orderClientRequestId) this.setData({ orderClientRequestId: clientRequestId });
    this.setData({ booking: true });
    try {
      await api.createOrder({
        companionId: this.companionId,
        themeId: this.themeId,
        durationMinutes: 30,
        scheduledAt: scheduledAt.toISOString(),
        clientRequestId,
        ...(this.recommendationImpressionId ? { recommendationImpressionId: this.recommendationImpressionId } : {})
      });
      await requestTransactionalSubscriptions(["orderConfirmed", "orderRejected", "orderResponseExpired"]);
      try { wx.removeStorageSync(storageKey); } catch { /* best effort after acknowledged success */ }
      this.setData({ orderClientRequestId: "" });
      wx.showToast({ title: "订单已创建", icon: "success" });
      setTimeout(() => wx.switchTab({ url: "/pages/orders/index" }), 500);
    } catch (error) {
      wx.showToast({ title: (error as Error).message || "创建订单失败", icon: "none" });
    } finally { this.setData({ booking: false }); }
  }
});
