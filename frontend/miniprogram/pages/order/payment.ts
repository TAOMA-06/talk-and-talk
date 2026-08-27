import { api, ensureSession } from "../../utils/api";
import { handleCustomerAdultEligibilityError } from "../../utils/adult-eligibility-recovery";
import { clientPublicInteractionIdentityGrantsAvailable } from "../../utils/config";
import { Order } from "../../utils/models";
import { ensurePrivacyAuthorization, openLegalDocument } from "../../utils/privacy";
import { requestTransactionalSubscriptions } from "../../utils/subscription";
import {
  isPublicInteractionIdentityError,
  publicInteractionErrorUserMessage
} from "../../utils/public-interaction-errors";
import {
  canPayOrder,
  formatCny,
  formatShanghaiDateTime,
  orderCompanionName,
  orderServiceName
} from "../../utils/order-display";

type PaymentState = "loading" | "ready" | "processing" | "pending" | "success" | "cancelled" | "unavailable" | "error";
type PaymentView = {
  serviceName: string;
  companionName: string;
  scheduleText: string;
  durationText: string;
  amountText: string;
  refundPolicyVersion: string;
  refundRequestWindowHours: number;
};

const PAYMENT_SYNC_DELAYS = [0, 500, 1200];

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isPaidStatus(status: string): boolean {
  return ["paid", "inService", "completed", "refunded"].includes(status);
}

function paymentView(order: Order): PaymentView {
  const refundPolicyVersion = String(order.refundPolicyVersionSnapshot || "").trim();
  const refundRequestWindowHours = order.refundRequestWindowHoursSnapshot;
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/.test(refundPolicyVersion)
    || !Number.isInteger(refundRequestWindowHours)
    || refundRequestWindowHours < 1
    || refundRequestWindowHours > 720
  ) {
    throw new Error("订单退款规则快照不可用，请勿支付并联系平台客服");
  }
  return {
    serviceName: orderServiceName(order),
    companionName: orderCompanionName(order),
    scheduleText: formatShanghaiDateTime(order.scheduledAt),
    durationText: `${order.durationMinutes} 分钟`,
    amountText: formatCny(order.amountCents),
    refundPolicyVersion,
    refundRequestWindowHours
  };
}

Page({
  data: {
    order: null as Order | null,
    view: null as PaymentView | null,
    paymentState: "loading" as PaymentState,
    stateTitle: "正在核对订单",
    stateMessage: "支付前会先读取服务端最新状态。",
    termsConfirmed: false,
    error: ""
  },
  orderId: "",
  paymentInFlight: false,
  onLoad(options: Record<string, string | undefined>) {
    this.orderId = String(options.orderId || "").trim();
    if (!this.orderId) {
      this.setData({
        paymentState: "error",
        stateTitle: "缺少订单编号",
        stateMessage: "请从订单详情重新进入支付。",
        error: "缺少订单编号"
      });
      return;
    }
  },
  onShow() {
    if (this.orderId && !this.paymentInFlight) void this.load();
  },
  async load() {
    this.setData({
      paymentState: "loading",
      stateTitle: "正在核对订单",
      stateMessage: "支付前会先读取服务端最新状态。",
      error: ""
    });
    try {
      await ensureSession();
      const order = await api.order(this.orderId);
      if (isPaidStatus(order.status)) {
        this.setData({
          order,
          view: paymentView(order),
          paymentState: "success",
          stateTitle: "支付已经确认",
          stateMessage: "服务端已确认支付状态。预约与履约安排以订单详情为准。"
        });
        return;
      }
      if (order.status === "paying") {
        this.setData({
          order,
          view: paymentView(order),
          paymentState: "pending",
          stateTitle: "支付结果确认中",
          stateMessage: "请勿重复付款。可点击下方按钮向微信支付查询最新结果。"
        });
        return;
      }
      if (!clientPublicInteractionIdentityGrantsAvailable()) {
        this.setData({
          order,
          view: paymentView(order),
          paymentState: "unavailable",
          stateTitle: "身份核验通道尚未开放",
          stateMessage: "当前不能发起新支付；不会请求订阅授权、创建预支付或调用微信支付。可返回订单取消或联系平台协助。"
        });
        return;
      }
      if (!canPayOrder(order)) {
        this.setData({
          order,
          view: paymentView(order),
          paymentState: "unavailable",
          stateTitle: "当前不能支付",
          stateMessage: order.companionConfirmedAt
            ? "订单状态已经变化，请返回详情查看。"
            : "等待陪伴者确认后才会开放支付；确认前不会扣款。"
        });
        return;
      }
      this.setData({
        order,
        view: paymentView(order),
        paymentState: "ready",
        stateTitle: "确认后调起微信支付",
        stateMessage: "支付成功以微信回调和服务端查询结果为准，不以客户端动画为准。"
      });
    } catch (error) {
      this.setData({
        paymentState: "error",
        stateTitle: "暂时无法核对订单",
        stateMessage: (error as Error).message || "请检查网络后重试。",
        error: (error as Error).message || "加载失败"
      });
    }
  },
  toggleTerms() {
    if (this.paymentInFlight) return;
    this.setData({ termsConfirmed: !this.data.termsConfirmed });
  },
  openRefundTerms() {
    openLegalDocument("terms");
  },
  async pay() {
    if (this.paymentInFlight || this.data.paymentState !== "ready") return;
    if (!clientPublicInteractionIdentityGrantsAvailable()) {
      this.setData({
        paymentState: "unavailable",
        stateTitle: "身份核验通道尚未开放",
        stateMessage: "当前不能发起新支付；不会请求订阅授权、创建预支付或调用微信支付。"
      });
      return;
    }
    if (!this.data.termsConfirmed) {
      wx.showToast({ title: "请先确认金额、服务与退款规则", icon: "none" });
      return;
    }
    const confirmation = await new Promise<any>((resolve) => wx.showModal({
      title: "最后确认支付",
      content: `将通过微信支付 ${this.data.view?.amountText || ""}。支付完成后请等待本页显示“支付已经确认”，不要重复付款。`,
      confirmText: "调起微信支付",
      success: resolve,
      fail: () => resolve({ confirm: false })
    }));
    if (!confirmation.confirm) return;
    this.paymentInFlight = true;
    this.setData({
      paymentState: "processing",
      stateTitle: "正在调起微信支付",
      stateMessage: "请勿退出或重复点击。"
    });
    try {
      await ensurePrivacyAuthorization();
      await requestTransactionalSubscriptions(["paymentSuccess", "serviceStarted", "serviceCompleted"]);
      const prepay = await api.prepay(this.orderId);
      if (prepay.payment.mock) {
        await api.mockNotify(prepay.payment.outTradeNo);
      } else {
        const params = prepay.payment.wechatMiniProgramParams;
        if (!params) throw new Error("支付参数不完整，请勿重复付款");
        await new Promise<void>((resolve, reject) => wx.requestPayment({
          ...params,
          success: () => resolve(),
          fail: (reason: any) => reject(
            String(reason?.errMsg || "").includes("cancel")
              ? Object.assign(new Error("你已取消支付"), { paymentCancelled: true })
              : new Error("微信支付未完成")
          )
        }));
      }
      const confirmed = await this.confirmWithBackend();
      this.setData(confirmed ? {
        paymentState: "success",
        stateTitle: "支付已经确认",
        stateMessage: "服务端已确认支付状态。预约与履约安排以订单详情为准。"
      } : {
        paymentState: "pending",
        stateTitle: "微信已受理，结果确认中",
        stateMessage: "请勿重复付款。平台正在向微信查询最终状态，可稍后再次查询。"
      });
      await this.refreshOrderQuietly();
    } catch (error) {
      if (await handleCustomerAdultEligibilityError(error)) {
        this.setData({
          paymentState: "ready",
          stateTitle: "请先处理成年资格核验",
          stateMessage: "完成并通过独立核验后，再从订单重新发起支付。"
        });
        return;
      }
      if (isPublicInteractionIdentityError(error as any)) {
        this.setData({
          paymentState: "unavailable",
          stateTitle: "身份核验通道尚未开放",
          stateMessage: publicInteractionErrorUserMessage(error as any)
        });
        return;
      }
      const cancelled = Boolean((error as { paymentCancelled?: boolean }).paymentCancelled);
      this.setData({
        paymentState: cancelled ? "cancelled" : "error",
        stateTitle: cancelled ? "已取消支付" : "支付未完成",
        stateMessage: cancelled
          ? "没有从本页确认扣款。若微信账单已有记录，请先查询支付结果，不要重复支付。"
          : (error as Error).message || "支付未完成，请先查询结果。"
      });
    } finally {
      this.paymentInFlight = false;
    }
  },
  async confirmWithBackend(): Promise<boolean> {
    for (const wait of PAYMENT_SYNC_DELAYS) {
      if (wait) await delay(wait);
      try {
        const result = await api.syncPayment(this.orderId);
        if (result.code === "SUCCESS" || isPaidStatus(result.data.orderStatus)) return true;
      } catch {
        // A transient query failure must remain pending rather than being shown
        // as a failed or missing payment.
      }
    }
    return false;
  },
  async queryResult() {
    if (this.paymentInFlight) return;
    this.paymentInFlight = true;
    this.setData({
      paymentState: "processing",
      stateTitle: "正在查询微信支付结果",
      stateMessage: "查询不会再次扣款。"
    });
    try {
      const confirmed = await this.confirmWithBackend();
      if (confirmed) {
        await this.refreshOrderQuietly();
        this.setData({
          paymentState: "success",
          stateTitle: "支付已经确认",
          stateMessage: "服务端已确认支付状态。"
        });
      } else {
        this.setData({
          paymentState: "pending",
          stateTitle: "仍在确认中",
          stateMessage: "当前没有得到成功结果，请勿重复付款；可稍后再次查询或联系平台客服。"
        });
      }
    } finally {
      this.paymentInFlight = false;
    }
  },
  async refreshOrderQuietly() {
    try {
      const order = await api.order(this.orderId);
      this.setData({ order, view: paymentView(order) });
    } catch {
      // The authoritative result message remains visible; detail can refresh.
    }
  },
  openOrderDetail() {
    wx.redirectTo({ url: `/pages/order/detail?id=${encodeURIComponent(this.orderId)}` });
  },
  openPaymentSupport() {
    wx.navigateTo({ url: `/pages/support/index?orderId=${encodeURIComponent(this.orderId)}&category=orderIssue&subject=${encodeURIComponent("支付结果需要核对")}` });
  }
});
