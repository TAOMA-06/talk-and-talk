import { api, ensureSession } from "../../utils/api";
import { Order } from "../../utils/models";
import { ensurePrivacyAuthorization } from "../../utils/privacy";

function serviceName(order: Order): string { return order.companionSnapshot?.name || order.companion?.name || "陪伴服务"; }

Page({
  data: { orders: [] as Array<Order & { displayName: string }>, serviceOrders: [] as Array<Order & { displayName: string }>, loading: true, error: "", payingId: "" },
  onShow() { void this.load(); },
  onPullDownRefresh() { void this.load(true); },
  async load(stopRefresh = false) {
    this.setData({ loading: true, error: "" });
    try {
      await ensureSession();
      const [customer, service] = await Promise.all([api.orders(), api.serviceOrders().catch(() => ({ items: [] as Order[] }))]);
      this.setData({
        orders: (customer.items || []).map((order: Order) => ({ ...order, displayName: serviceName(order) })),
        serviceOrders: (service.items || []).map((order: Order) => ({ ...order, displayName: serviceName(order) })),
        loading: false
      });
    } catch (error) { this.setData({ loading: false, error: (error as Error).message || "加载订单失败" }); }
    finally { if (stopRefresh) wx.stopPullDownRefresh(); }
  },
  async pay(event: any) {
    const id = event.currentTarget.dataset.id;
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
        wx.showToast({ title: "支付已提交确认", icon: "success" });
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
    const confirmation = await new Promise<any>((resolve) => wx.showModal({ title: "申请退款", content: "提交后将按订单状态进入处理流程。", success: resolve }));
    if (!confirmation.confirm) return;
    try { await api.refund(id, "小程序用户申请退款"); wx.showToast({ title: "已提交退款申请", icon: "success" }); await this.load(); }
    catch (error) { wx.showToast({ title: (error as Error).message || "申请失败", icon: "none" }); }
  },
  async startService(event: any) {
    try { await api.startService(event.currentTarget.dataset.id); await this.load(); }
    catch (error) { wx.showToast({ title: (error as Error).message || "无法开始服务", icon: "none" }); }
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
  }
});
