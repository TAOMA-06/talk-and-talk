import { api, ensureSession } from "../../utils/api";
import { Order, RecommendedCompanion } from "../../utils/models";
import { ensurePrivacyAuthorization } from "../../utils/privacy";
import { flushRecommendationEvents, queueRecommendationEvent, trackRecommendationCardViews } from "../../utils/recommendations";

function serviceName(order: Order): string { return order.companionSnapshot?.name || order.companion?.name || "陪伴服务"; }

const ORDER_STATUS_LABELS: Record<string, string> = {
  pending: "待确认/待支付",
  paying: "待支付",
  paid: "已支付",
  inService: "服务中",
  completed: "已完成",
  cancelled: "已取消",
  refunded: "已退款"
};

type DisplayOrder = Order & {
  displayName: string;
  scheduledAtText: string;
  paymentDeadlineText: string;
  amountText: string;
  statusText: string;
};

function formatDateTime(value?: string): string {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "时间待确认";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}年${pad(date.getMonth() + 1)}月${pad(date.getDate())}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function displayOrder(order: Order): DisplayOrder {
  const scheduledAt = order.scheduledAt ? new Date(order.scheduledAt) : null;
  const scheduledPaymentCutoff = scheduledAt && !Number.isNaN(scheduledAt.getTime())
    ? new Date(scheduledAt.getTime() - 5 * 60_000).toISOString()
    : undefined;
  const reservationDeadline = order.paymentReservationExpiresAt;
  const paymentDeadline = [scheduledPaymentCutoff, reservationDeadline]
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value))
    .filter((value) => !Number.isNaN(value.getTime()))
    .sort((left, right) => left.getTime() - right.getTime())[0]
    ?.toISOString();
  return {
    ...order,
    displayName: serviceName(order),
    scheduledAtText: formatDateTime(order.scheduledAt),
    paymentDeadlineText: formatDateTime(paymentDeadline),
    amountText: `¥${(order.amountCents / 100).toFixed(2)}`,
    statusText: ORDER_STATUS_LABELS[order.status] || "状态处理中"
  };
}

const PAYMENT_SYNC_RETRY_DELAYS_MS = [0, 400, 900];

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function confirmPaymentWithBackend(orderId: string): Promise<boolean> {
  for (const retryDelay of PAYMENT_SYNC_RETRY_DELAYS_MS) {
    if (retryDelay > 0) await delay(retryDelay);
    try {
      const result = await api.syncPayment(orderId);
      if (result.code === "SUCCESS" || ["paid", "inService", "completed", "refunded"].includes(result.data.orderStatus)) {
        return true;
      }
    } catch {
      // requestPayment success means WeChat accepted the payment. A transient
      // backend query failure must not be presented to the user as payment loss.
    }
  }
  return false;
}

Page({
  data: {
    orders: [] as DisplayOrder[], serviceOrders: [] as DisplayOrder[], followupRecommendations: [] as RecommendedCompanion[],
    loading: true, error: "", payingId: ""
  },
  stopRecommendationTracking: null as (() => void) | null,
  onShow() { void this.load(); },
  onHide() { this.stopTracking(); },
  onUnload() { this.stopTracking(); },
  onPullDownRefresh() { void this.load(true); },
  async load(stopRefresh = false) {
    this.stopTracking();
    this.setData({ loading: true, error: "" });
    try {
      await ensureSession();
      const [customer, service] = await Promise.all([api.orders(), api.serviceOrders().catch(() => ({ items: [] as Order[] }))]);
      const latestCompleted = (customer.items || []).find((order) => order.status === "completed");
      const recommendations = latestCompleted
        ? await api.recommendedCompanions({
            placement: "orderFollowup",
            themeId: latestCompleted.themeId,
            pageSize: 4
          }).catch(() => ({ items: [] as RecommendedCompanion[] }))
        : { items: [] as RecommendedCompanion[] };
      this.setData({
        orders: (customer.items || []).map(displayOrder),
        serviceOrders: (service.items || []).map(displayOrder),
        followupRecommendations: recommendations.items || [],
        loading: false
      });
      setTimeout(() => this.startTracking(), 0);
    } catch (error) { this.setData({ loading: false, error: (error as Error).message || "加载订单失败" }); }
    finally { if (stopRefresh) wx.stopPullDownRefresh(); }
  },
  startTracking() {
    if (!this.data.followupRecommendations.length) return;
    this.stopRecommendationTracking = trackRecommendationCardViews(this, this.data.followupRecommendations, "order-followup-recommendation");
  },
  stopTracking() {
    this.stopRecommendationTracking?.();
    this.stopRecommendationTracking = null;
    void flushRecommendationEvents();
  },
  async pay(event: any) {
    const id = event.currentTarget.dataset.id;
    const order = (this.data.orders as DisplayOrder[]).find((item) => item.id === id);
    if (!order) {
      wx.showToast({ title: "订单不存在，请刷新后重试", icon: "none" });
      return;
    }
    const confirmation = await new Promise<any>((resolve) => wx.showModal({
      title: "确认订单并支付",
      content: [
        `服务对象：${order.displayName}`,
        `预约时间：${order.scheduledAtText}`,
        `服务时长：${order.durationMinutes} 分钟`,
        `支付金额：${order.amountText}`,
        `支付截止：${order.paymentDeadlineText}（确认保留或预约前 5 分钟截止，以更早者为准）`,
        "未开始服务可申请全额原路退款；服务中或完成后申请将进入人工审核。"
      ].join("\n"),
      confirmText: "确认支付",
      success: resolve
    }));
    if (!confirmation.confirm) return;
    this.setData({ payingId: id });
    try {
      await ensurePrivacyAuthorization();
      const prepay = await api.prepay(id);
      if (prepay.payment.mock) {
        await api.mockNotify(prepay.payment.outTradeNo);
        wx.showToast({ title: "测试支付已完成", icon: "success" });
      } else {
        const params = prepay.payment.wechatMiniProgramParams;
        if (!params) throw new Error("支付参数不完整");
        await new Promise<void>((resolve, reject) => wx.requestPayment({
          ...params,
          success: () => resolve(),
          fail: (reason: any) => reject(reason?.errMsg?.includes("cancel") ? new Error("已取消支付") : new Error("支付未完成"))
        }));
        const confirmed = await confirmPaymentWithBackend(id);
        wx.showToast(confirmed
          ? { title: "支付已确认", icon: "success" }
          : { title: "支付结果确认中，请稍后刷新订单", icon: "none", duration: 3000 });
      }
      await this.load();
    } catch (error) { wx.showToast({ title: (error as Error).message || "支付失败", icon: "none" }); }
    finally { this.setData({ payingId: "" }); }
  },
  async cancel(event: any) {
    try { await api.cancelOrder(event.currentTarget.dataset.id); await this.load(); }
    catch (error) { wx.showToast({ title: (error as Error).message || "取消失败", icon: "none" }); }
  },
  async refund(event: any) {
    const id = event.currentTarget.dataset.id;
    const confirmation = await new Promise<any>((resolve) => wx.showModal({
      title: "申请退款",
      content: "未开始服务的已支付订单可申请全额原路退款；服务已开始或完成后将进入人工审核，并依据履约与争议证据处理。退款原路退回，到账时间以微信支付为准。",
      confirmText: "提交申请",
      success: resolve
    }));
    if (!confirmation.confirm) return;
    try { await api.refund(id, "小程序用户申请退款"); wx.showToast({ title: "已提交退款申请", icon: "success" }); await this.load(); }
    catch (error) { wx.showToast({ title: (error as Error).message || "申请失败", icon: "none" }); }
  },
  async startService(event: any) {
    try { await api.startService(event.currentTarget.dataset.id); await this.load(); }
    catch (error) { wx.showToast({ title: (error as Error).message || "无法开始服务", icon: "none" }); }
  },
  async confirmServiceOrder(event: any) {
    try { await api.confirmServiceOrder(event.currentTarget.dataset.id); await this.load(); }
    catch (error) { wx.showToast({ title: (error as Error).message || "无法确认预约", icon: "none" }); }
  },
  async rejectServiceOrder(event: any) {
    const confirmation = await new Promise<any>((resolve) => wx.showModal({
      title: "拒绝本次预约",
      content: "拒绝后订单会取消且客户不会被扣款。",
      success: resolve
    }));
    if (!confirmation.confirm) return;
    try { await api.rejectServiceOrder(event.currentTarget.dataset.id); await this.load(); }
    catch (error) { wx.showToast({ title: (error as Error).message || "无法拒绝预约", icon: "none" }); }
  },
  async completeService(event: any) {
    try { await api.completeService(event.currentTarget.dataset.id); await this.load(); }
    catch (error) { wx.showToast({ title: (error as Error).message || "无法完成服务", icon: "none" }); }
  },
  review(event: any) {
    const orderId = event.currentTarget.dataset.id;
    wx.showActionSheet({
      itemList: ["5 星 · 非常满意", "4 星 · 满意", "3 星 · 一般", "2 星 · 不满意", "1 星 · 很不满意"],
      success: (ratingResult: any) => {
        const rating = 5 - Number(ratingResult.tapIndex);
        wx.showModal({
          title: `${rating} 星评价`, editable: true, placeholderText: "写下真实的服务感受", success: async (contentResult: any) => {
            if (!contentResult.confirm) return;
            try {
              await api.createReview({ orderId, rating, content: contentResult.content?.trim() || "本次服务体验良好" });
              wx.showToast({ title: "评价已提交", icon: "success" });
            } catch (error) { wx.showToast({ title: (error as Error).message || "评价失败", icon: "none" }); }
          }
        });
      }
    });
  },
  openRecommendedCompanion(event: any) {
    const { id, impressionId, themeId } = event.currentTarget.dataset;
    queueRecommendationEvent(impressionId, "click");
    void flushRecommendationEvents();
    const params = [
      `id=${encodeURIComponent(id)}`,
      `rid=${encodeURIComponent(impressionId)}`,
      themeId ? `themeId=${encodeURIComponent(themeId)}` : ""
    ].filter(Boolean).join("&");
    wx.navigateTo({ url: `/pages/companion/detail?${params}` });
  }
});
