import { api, ensureSession } from "../../utils/api";
import {
  clientPublicInteractionIdentityGrantsAvailable,
  clientRealtimeVoiceEnabled
} from "../../utils/config";
import { Order, OrderTimelineEvent } from "../../utils/models";
import {
  canOpenConversation,
  canOpenVoiceOrder,
  canPayOrder,
  canRequestRefund,
  formatCny,
  formatShanghaiDateTime,
  orderCompanionName,
  orderDeliveryModeLabel,
  orderServiceName,
  orderStatusExplanation,
  orderStatusLabel
} from "../../utils/order-display";
import { PaymentDisputeView, paymentDisputeView } from "../../utils/payment-dispute-display";
import { openLegalDocument } from "../../utils/privacy";

type TimelineItem = { id: string; title: string; description: string; timeText: string };
type TimelineState = "loading" | "available" | "empty" | "error";
type PaymentDisputeState = "loading" | "available" | "none" | "error";
type OrderViewerRole = "customer" | "companion";
type OrderView = {
  viewerRole: OrderViewerRole;
  isTextOnlyHistoricalVoiceOrder: boolean;
  viewerRoleText: string;
  participantLabel: string;
  participantName: string;
  serviceName: string;
  companionName: string;
  statusText: string;
  statusExplanation: string;
  scheduledAtText: string;
  amountText: string;
  deliveryModeText: string;
  serviceIntentText: string;
  serviceIntentPolicyVersion: string;
  createdAtText: string;
  refundDeadlineText: string;
  refundReviewDueText: string;
  refundResolutionDueText: string;
  refundPolicyVersion: string;
  refundRequestWindowHours: number;
  refundPolicySnapshotValid: boolean;
  showRefundPolicyBeforePayment: boolean;
  canPay: boolean;
  paymentUnavailableNotice: string;
  canCancel: boolean;
  canRefund: boolean;
  canChat: boolean;
  canVoice: boolean;
  canAftercare: boolean;
  canFindReplacement: boolean;
  replacementDescription: string;
  canConfirmGuidelines: boolean;
  guidelinesActionText: string;
  canConfirmServiceOrder: boolean;
  canRejectServiceOrder: boolean;
  canStartService: boolean;
  canCompleteService: boolean;
  serviceActionNotice: string;
  canOpenAttendanceDispute: boolean;
  hasAttendanceDispute: boolean;
  attendanceDisputeStatusText: string;
  attendanceDisputeIssueText: string;
  attendanceDisputeActionText: string;
  attendanceDisputeNotice: string;
};

const SERVICE_EARLY_START_MS = 15 * 60_000;

function isTextOnlyHistoricalVoiceOrder(order: Order | null | undefined): boolean {
  return order?.serviceOfferingSnapshot?.deliveryMode === "voice" && !clientRealtimeVoiceEnabled();
}

function showTextOnlyHistoricalVoiceOrderNotice() {
  wx.showToast({ title: "文字首发暂不能继续历史语音订单", icon: "none" });
}

const ATTENDANCE_STATUS_LABELS: Record<string, string> = {
  evidenceCollection: "补充事实",
  counterpartyResponse: "等待对方答辩",
  review: "平台复核",
  decided: "初审已决定，可申诉",
  appealed: "申诉复核",
  final: "案件已终结"
};

const ATTENDANCE_ISSUE_LABELS: Record<string, string> = {
  companionAbsent: "陪伴者未到场",
  customerAbsent: "客户未到场",
  lateArrival: "迟到",
  technicalFailure: "技术故障",
  earlyExit: "提前离开",
  serviceMismatch: "服务不符",
  safetyBoundary: "安全边界",
  other: "其他履约问题"
};

const TIMELINE_TITLES: Record<string, string> = {
  orderCreated: "预约已创建",
  rescheduleRequested: "已提出改期",
  rescheduleAccepted: "改期已确认",
  rescheduleRejected: "改期未接受",
  rescheduleExpired: "改期请求已超时",
  rescheduleCancelled: "改期请求已关闭"
};

function participantStatusExplanation(order: Order, viewerRole: OrderViewerRole): string {
  if (viewerRole === "customer") return orderStatusExplanation(order);
  if (order.fulfillmentBlockedByRefund && ["paid", "inService"].includes(order.status)) {
    return "本单存在进行中的售后或退款处理，当前履约操作已暂停；请从订单联系平台客服。";
  }
  if (order.status === "pending" && !order.companionConfirmedAt) {
    return `请在 ${formatShanghaiDateTime(order.companionResponseDeadlineAt)} 前确认或拒绝预约。`;
  }
  if (order.status === "pending" && order.companionConfirmedAt) return "你已确认预约，正在等待客户完成支付。";
  if (order.status === "paying") return "客户支付结果正在由服务端确认，请勿提前开始服务。";
  if (order.status === "paid") return `客户已支付；服务可在预约前 15 分钟内由你手动开始。`;
  if (order.status === "inService") return "服务正在进行；达到约定时长后可由你标记完成。";
  if (order.status === "completed") return "服务已完成；请保留平台内记录并留意履约争议或客服更新。";
  if (order.status === "cancelled") return "订单已取消，原预约时段不再保留。";
  if (order.status === "refunded") return "订单已经退款，不再进入履约流程。";
  return "订单状态正在更新，请刷新查看服务端最新结果。";
}

function viewForOrder(order: Order, now = Date.now()): OrderView {
  const viewerRole: OrderViewerRole = order.viewerRole === "companion" ? "companion" : "customer";
  const textOnlyHistoricalVoiceOrder = isTextOnlyHistoricalVoiceOrder(order);
  const scheduledAt = Date.parse(order.scheduledAt || "");
  const serviceStartedAt = Date.parse(order.serviceStartedAt || "");
  const serviceEndAt = Number.isFinite(scheduledAt)
    ? Math.max(scheduledAt, Number.isFinite(serviceStartedAt) ? serviceStartedAt : scheduledAt)
      + order.durationMinutes * 60_000
    : Number.NaN;
  const inStartWindow = Number.isFinite(scheduledAt)
    && now >= scheduledAt - SERVICE_EARLY_START_MS
    && now < scheduledAt + order.durationMinutes * 60_000;
  const attendanceDispute = order.attendanceDispute || null;
  const attendanceEligibility = order.attendanceDisputeEligibility;
  const canOpenAttendanceDispute = Boolean(attendanceDispute) || attendanceEligibility?.eligible === true;
  const ownGuidelinesConfirmed = viewerRole === "customer"
    ? order.customerServiceGuidelinesConfirmedAt
    : order.companionServiceGuidelinesConfirmedAt;
  const refundPolicyVersion = String(order.refundPolicyVersionSnapshot || "").trim();
  const refundRequestWindowHours = order.refundRequestWindowHoursSnapshot;
  const refundPolicySnapshotValid = /^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/.test(refundPolicyVersion)
    && Number.isInteger(refundRequestWindowHours)
    && refundRequestWindowHours >= 1
    && refundRequestWindowHours <= 720;
  const identityAvailable = clientPublicInteractionIdentityGrantsAvailable();
  const otherwisePayable = viewerRole === "customer" && refundPolicySnapshotValid && canPayOrder(order);
  return {
    viewerRole,
    isTextOnlyHistoricalVoiceOrder: textOnlyHistoricalVoiceOrder,
    viewerRoleText: viewerRole === "customer" ? "客户" : "陪伴者",
    participantLabel: viewerRole === "customer" ? "陪伴者" : "客户",
    participantName: viewerRole === "customer"
      ? orderCompanionName(order)
      : order.customer?.name || "客户",
    serviceName: orderServiceName(order),
    companionName: orderCompanionName(order),
    statusText: orderStatusLabel(order),
    statusExplanation: participantStatusExplanation(order, viewerRole),
    scheduledAtText: formatShanghaiDateTime(order.scheduledAt),
    amountText: formatCny(order.amountCents),
    deliveryModeText: orderDeliveryModeLabel(order),
    serviceIntentText: order.serviceIntent?.label || "历史订单未记录",
    serviceIntentPolicyVersion: order.serviceIntent?.policyVersion || "legacy",
    createdAtText: formatShanghaiDateTime(order.createdAt),
    refundDeadlineText: formatShanghaiDateTime(order.refundRequestDeadlineAt),
    refundReviewDueText: formatShanghaiDateTime(order.refund?.reviewDueAt),
    refundResolutionDueText: formatShanghaiDateTime(order.refund?.resolutionDueAt),
    refundPolicyVersion,
    refundRequestWindowHours,
    refundPolicySnapshotValid,
    showRefundPolicyBeforePayment: viewerRole === "customer"
      && ["pending", "paying"].includes(order.status),
    canPay: otherwisePayable && identityAvailable,
    paymentUnavailableNotice: otherwisePayable && !identityAvailable
      ? "身份核验授权通道尚未开放，当前不能支付；仍可取消订单或联系平台协助。"
      : "",
    canCancel: viewerRole === "customer" && ["pending", "paying"].includes(order.status),
    canRefund: viewerRole === "customer" && canRequestRefund(order),
    canChat: canOpenConversation(order),
    canVoice: canOpenVoiceOrder(order),
    canAftercare: viewerRole === "customer" && ["completed", "refunded"].includes(order.status),
    canFindReplacement: viewerRole === "customer" && order.status === "cancelled",
    replacementDescription: viewerRole === "customer" && order.status === "cancelled"
      ? `可带入本单的主题、服务方式和 ${order.durationMinutes} 分钟需求重新筛选；旧订单、支付和预约时段不会转移。`
      : "",
    canConfirmGuidelines: order.status === "paid"
      && !order.serviceStartedAt
      && !order.fulfillmentBlockedByRefund
      && !ownGuidelinesConfirmed,
    guidelinesActionText: viewerRole === "customer" ? "确认服务前约定" : "确认服务范围与边界",
    canConfirmServiceOrder: viewerRole === "companion" && order.status === "pending"
      && !order.companionConfirmedAt && !textOnlyHistoricalVoiceOrder,
    canRejectServiceOrder: viewerRole === "companion" && order.status === "pending" && !order.companionConfirmedAt,
    canStartService: viewerRole === "companion" && order.status === "paid"
      && !order.fulfillmentBlockedByRefund && inStartWindow && !textOnlyHistoricalVoiceOrder,
    canCompleteService: viewerRole === "companion" && order.status === "inService"
      && Number.isFinite(serviceEndAt) && now >= serviceEndAt,
    serviceActionNotice: viewerRole !== "companion" ? ""
      : textOnlyHistoricalVoiceOrder && ["pending", "paid"].includes(order.status)
        ? "当前首发仅支持文字服务；历史语音订单不能继续确认或开始服务。仍可查看订单、拒绝预约或联系平台客服。"
      : order.fulfillmentBlockedByRefund && ["paid", "inService"].includes(order.status)
        ? "售后或退款处理中，当前履约操作已暂停。"
        : order.status === "paid" && Number.isFinite(scheduledAt) && now < scheduledAt - SERVICE_EARLY_START_MS
          ? `开始服务将在 ${formatShanghaiDateTime(new Date(scheduledAt - SERVICE_EARLY_START_MS).toISOString())} 开放。`
          : order.status === "paid" && Number.isFinite(scheduledAt) && !inStartWindow
            ? "预约服务窗口已结束，请联系平台客服处理。"
            : order.status === "inService" && Number.isFinite(serviceEndAt) && now < serviceEndAt
              ? `${formatShanghaiDateTime(new Date(serviceEndAt).toISOString())} 后可标记完成。`
              : "",
    canOpenAttendanceDispute,
    hasAttendanceDispute: Boolean(attendanceDispute),
    attendanceDisputeStatusText: attendanceDispute
      ? ATTENDANCE_STATUS_LABELS[attendanceDispute.status] || attendanceDispute.status
      : "",
    attendanceDisputeIssueText: attendanceDispute
      ? ATTENDANCE_ISSUE_LABELS[attendanceDispute.issue] || attendanceDispute.issue
      : "",
    attendanceDisputeActionText: attendanceDispute ? "查看履约争议详情" : "提交履约争议",
    attendanceDisputeNotice: attendanceDispute ? ""
      : attendanceEligibility?.eligible
        ? `可在 ${formatShanghaiDateTime(attendanceEligibility.createDeadlineAt)} 前提交；提交后会冻结本单结算并进入双方答辩。`
        : attendanceEligibility?.reason || "当前订单不可提交履约争议。"
  };
}

function timelineItem(event: OrderTimelineEvent): TimelineItem {
  const request = event.rescheduleRequest;
  let description = "订单进度已由服务端更新。";
  if (event.type === "orderCreated") description = "平台已收到这次预约。";
  if (event.type === "rescheduleRequested" && request) {
    description = `拟改至 ${formatShanghaiDateTime(request.requestedScheduledAt)}，原预约暂时不变。`;
  }
  if (event.type === "rescheduleAccepted" && request) description = `预约已调整至 ${formatShanghaiDateTime(request.requestedScheduledAt)}。`;
  if (["rescheduleRejected", "rescheduleExpired", "rescheduleCancelled"].includes(event.type) && request) {
    description = `原预约仍为 ${formatShanghaiDateTime(request.originalScheduledAt)}。`;
  }
  return {
    id: event.id,
    title: TIMELINE_TITLES[event.type] || "订单进度更新",
    description,
    timeText: formatShanghaiDateTime(event.occurredAt)
  };
}

Page({
  data: {
    motionOff: false,
    order: null as Order | null,
    view: null as OrderView | null,
    timeline: [] as TimelineItem[],
    timelineState: "loading" as TimelineState,
    timelineError: "",
    timelinePage: 1,
    timelineTotal: 0,
    timelineTotalPages: 0,
    timelineHasMore: false,
    timelineLoadingMore: false,
    timelineLoadMoreError: "",
    paymentDispute: null as PaymentDisputeView | null,
    paymentDisputeState: "loading" as PaymentDisputeState,
    loading: true,
    error: "",
    action: ""
  },
  orderId: "",
  onLoad(options: Record<string, string | undefined>) {
    this.orderId = String(options.id || options.orderId || "").trim();
    if (!this.orderId) {
      this.setData({
        loading: false,
        error: "缺少订单编号，请从订单列表重新进入。",
        timelineState: "error",
        timelineError: "缺少订单编号，无法读取订单进度。",
        paymentDisputeState: "error"
      });
      return;
    }
  },
  onShow() {
    if (this.orderId) void this.load();
  },
  onPullDownRefresh() { void this.load(true); },
  async load(stopRefresh = false) {
    this.setData({
      loading: true,
      error: "",
      order: null,
      view: null,
      timeline: [],
      timelineState: "loading",
      timelineError: "",
      timelinePage: 1,
      timelineTotal: 0,
      timelineTotalPages: 0,
      timelineHasMore: false,
      timelineLoadingMore: false,
      timelineLoadMoreError: "",
      paymentDisputeState: "loading",
      paymentDispute: null
    });
    try {
      await ensureSession();
      const order = await api.order(this.orderId);
      this.setData({
        order,
        view: viewForOrder(order),
        loading: false,
        paymentDisputeState: order.viewerRole === "companion" ? "none" : "loading"
      });
      await Promise.all([
        this.loadTimeline(),
        ...(order.viewerRole === "companion" ? [] : [this.loadPaymentDispute()])
      ]);
    } catch (error) {
      this.setData({
        loading: false,
        error: (error as Error).message || "订单暂时无法加载",
        timeline: [],
        timelineState: "error",
        timelineError: "订单尚未读取成功，暂时无法核对订单进度。",
        timelinePage: 1,
        timelineTotal: 0,
        timelineTotalPages: 0,
        timelineHasMore: false,
        timelineLoadingMore: false,
        timelineLoadMoreError: "",
        paymentDispute: null,
        paymentDisputeState: "error"
      });
    } finally {
      if (stopRefresh) wx.stopPullDownRefresh();
    }
  },
  async loadTimeline(page = 1) {
    const loadingMore = page > 1;
    this.setData(loadingMore
      ? { timelineLoadingMore: true, timelineLoadMoreError: "" }
      : {
          timeline: [],
          timelineState: "loading",
          timelineError: "",
          timelinePage: 1,
          timelineTotal: 0,
          timelineTotalPages: 0,
          timelineHasMore: false,
          timelineLoadingMore: false,
          timelineLoadMoreError: ""
        });
    try {
      const timeline = await api.orderTimeline(this.orderId, { page, pageSize: 20 });
      const items = (timeline.items || []).map(timelineItem);
      const merged = loadingMore
        ? Array.from(new Map([...this.data.timeline, ...items].map((item) => [item.id, item])).values())
        : items;
      this.setData({
        timeline: merged,
        timelineState: merged.length ? "available" : "empty",
        timelinePage: timeline.pagination.page,
        timelineTotal: timeline.pagination.total,
        timelineTotalPages: timeline.pagination.totalPages,
        timelineHasMore: timeline.pagination.page < timeline.pagination.totalPages,
        timelineLoadingMore: false,
        timelineLoadMoreError: ""
      });
    } catch {
      if (loadingMore) {
        this.setData({
          timelineLoadingMore: false,
          timelineLoadMoreError: "更多订单进度暂时无法读取；已显示的记录会保留。"
        });
      } else {
        this.setData({
          timeline: [],
          timelineState: "error",
          timelineError: "订单进度暂时无法读取。这不代表没有进度记录，订单主体和当前状态仍可正常查看。",
          timelineLoadingMore: false
        });
      }
    }
  },
  async retryTimeline() {
    if (!this.data.order || this.data.timelineState === "loading") return;
    await this.loadTimeline();
  },
  async loadMoreTimeline() {
    if (
      !this.data.order
      || !this.data.timelineHasMore
      || this.data.timelineLoadingMore
    ) return;
    await this.loadTimeline(this.data.timelinePage + 1);
  },
  async loadPaymentDispute() {
    this.setData({ paymentDisputeState: "loading", paymentDispute: null });
    try {
      const result = await api.paymentDisputeByOrder(this.orderId);
      const linkedDispute = result.item || null;
      this.setData({
        paymentDispute: linkedDispute ? paymentDisputeView(linkedDispute) : null,
        paymentDisputeState: linkedDispute ? "available" : "none"
      });
    } catch {
      this.setData({ paymentDisputeState: "error", paymentDispute: null });
    }
  },
  async retryPaymentDispute() {
    if (!this.data.order || this.data.paymentDisputeState === "loading") return;
    await this.loadPaymentDispute();
  },
  openPayment() {
    if (!clientPublicInteractionIdentityGrantsAvailable()) {
      wx.showToast({ title: "身份核验授权通道尚未开放，当前不能支付", icon: "none" });
      return;
    }
    wx.navigateTo({ url: `/pages/order/payment?orderId=${encodeURIComponent(this.orderId)}` });
  },
  openRefundTerms() {
    openLegalDocument("terms");
  },
  openConversation() {
    const conversationId = this.data.order?.conversationId;
    if (!conversationId) {
      wx.showToast({ title: "会话尚未建立，请稍后刷新", icon: "none" });
      return;
    }
    wx.navigateTo({ url: `/pages/chat/index?id=${encodeURIComponent(conversationId)}` });
  },
  openVoice() {
    if (!clientRealtimeVoiceEnabled()) {
      wx.showToast({ title: "实时语音尚未对首发开放，请使用订单内文字沟通", icon: "none" });
      return;
    }
    wx.navigateTo({ url: `/pages/voice/index?orderId=${encodeURIComponent(this.orderId)}` });
  },
  openAftercare() {
    wx.navigateTo({ url: `/pages/order/aftercare?orderId=${encodeURIComponent(this.orderId)}` });
  },
  findReplacement() {
    const order = this.data.order;
    if (!order || this.data.view?.viewerRole !== "customer" || !this.data.view.canFindReplacement) {
      wx.showToast({ title: "当前订单暂不能发起重新匹配", icon: "none" });
      return;
    }
    const deliveryMode = order.serviceOfferingSnapshot?.deliveryMode;
    const scheduledAtMs = Date.parse(order.scheduledAt || "");
    getApp().globalData.discoveryIntent = {
      topicId: order.themeId || undefined,
      deliveryMode: deliveryMode === "text"
        || (deliveryMode === "voice" && clientRealtimeVoiceEnabled())
        ? deliveryMode
        : undefined,
      availableWithinDays: Number.isFinite(scheduledAtMs)
        && scheduledAtMs <= Date.now() + 3 * 24 * 60 * 60_000 ? 3 : undefined,
      sortBy: "soonestAvailable",
      recovery: {
        sourceOrderId: order.id,
        durationMinutes: order.durationMinutes,
        serviceTitle: order.serviceOfferingSnapshot?.title?.trim() || "原订单服务",
        scheduledAt: order.scheduledAt || null
      }
    };
    wx.switchTab({ url: "/pages/discover/index" });
  },
  openAttendanceDispute() {
    const disputeId = this.data.order?.attendanceDispute?.id || "";
    const query = disputeId
      ? `id=${encodeURIComponent(disputeId)}`
      : `orderId=${encodeURIComponent(this.orderId)}`;
    wx.navigateTo({ url: `/pages/order/dispute?${query}` });
  },
  showWechatComplaintGuide() {
    wx.showModal({
      title: "如何发起微信支付投诉",
      content: "请在微信进入「我 → 服务 → 钱包 → 账单」，找到这笔支付后选择「对订单有疑惑」，再按微信页面发起。平台客服案件可以协助核对订单，但不能代替微信支付的正式投诉入口。",
      showCancel: false,
      confirmText: "我知道了"
    });
  },
  openSupport() {
    wx.navigateTo({ url: `/pages/support/index?orderId=${encodeURIComponent(this.orderId)}&category=orderIssue&subject=${encodeURIComponent("订单需要平台协助")}` });
  },
  openSafetyReport() {
    wx.navigateTo({ url: `/pages/support/index?orderId=${encodeURIComponent(this.orderId)}&category=safety&subject=${encodeURIComponent("订单安全问题")}` });
  },
  openOrdersForReschedule() {
    wx.switchTab({ url: "/pages/orders/index" });
  },
  async cancelOrder() {
    const confirmation = await new Promise<any>((resolve) => wx.showModal({
      title: "确认取消订单",
      content: "取消后原预约时段会释放。已经发起支付时，请先等待支付状态确认，避免重复操作。",
      confirmText: "确认取消",
      confirmColor: "#B94A68",
      success: resolve,
      fail: () => resolve({ confirm: false })
    }));
    if (!confirmation.confirm) return;
    this.setData({ action: "cancel" });
    try {
      await api.cancelOrder(this.orderId);
      wx.showToast({ title: "订单已取消", icon: "success" });
      await this.load();
    } catch (error) {
      wx.showToast({ title: (error as Error).message || "暂时无法取消", icon: "none" });
    } finally {
      this.setData({ action: "" });
    }
  },
  async confirmGuidelines() {
    const viewerRole = this.data.view?.viewerRole || "customer";
    const confirmation = await new Promise<any>((resolve) => wx.showModal({
      title: viewerRole === "companion" ? "确认服务范围与边界" : "确认服务前约定",
      content: "我理解服务只在平台内进行，不交换私人联系方式或私下转账；陪伴不提供医疗、治疗或紧急救助。",
      confirmText: "我已理解",
      success: resolve,
      fail: () => resolve({ confirm: false })
    }));
    if (!confirmation.confirm) return;
    this.setData({ action: "guidelines" });
    try {
      await api.confirmOrderServiceGuidelines(this.orderId);
      wx.showToast({ title: "约定已确认", icon: "success" });
      await this.load();
    } catch (error) {
      wx.showToast({ title: (error as Error).message || "确认失败", icon: "none" });
    } finally {
      this.setData({ action: "" });
    }
  },
  async confirmServiceOrder() {
    if (isTextOnlyHistoricalVoiceOrder(this.data.order)) {
      showTextOnlyHistoricalVoiceOrderNotice();
      return;
    }
    if (!this.data.view?.canConfirmServiceOrder) return;
    const confirmation = await new Promise<any>((resolve) => wx.showModal({
      title: "确认接单",
      content: "确认后会为客户保留支付时段；客户完成支付后订单才进入履约。",
      confirmText: "确认接单",
      success: resolve,
      fail: () => resolve({ confirm: false })
    }));
    if (!confirmation.confirm) return;
    await this.runServiceAction("confirm", () => api.confirmServiceOrder(this.orderId), "预约已确认");
  },
  async rejectServiceOrder() {
    if (!this.data.view?.canRejectServiceOrder) return;
    const confirmation = await new Promise<any>((resolve) => wx.showModal({
      title: "拒绝本次预约",
      content: "拒绝后订单会取消且客户不会被扣款。",
      confirmText: "确认拒绝",
      success: resolve,
      fail: () => resolve({ confirm: false })
    }));
    if (!confirmation.confirm) return;
    await this.runServiceAction("reject", () => api.rejectServiceOrder(this.orderId), "预约已拒绝");
  },
  async startService() {
    if (isTextOnlyHistoricalVoiceOrder(this.data.order)) {
      showTextOnlyHistoricalVoiceOrderNotice();
      return;
    }
    if (!this.data.view?.canStartService) return;
    await this.runServiceAction("start", () => api.startService(this.orderId), "服务已开始");
  },
  async completeService() {
    if (!this.data.view?.canCompleteService) return;
    await this.runServiceAction("complete", () => api.completeService(this.orderId), "服务已完成");
  },
  async runServiceAction(action: string, callback: () => Promise<Order>, successTitle: string) {
    if (this.data.action) return;
    this.setData({ action });
    try {
      await callback();
      wx.showToast({ title: successTitle, icon: "success" });
      await this.load();
    } catch (error) {
      wx.showToast({ title: (error as Error).message || "订单状态更新失败", icon: "none" });
      await this.load();
    } finally {
      this.setData({ action: "" });
    }
  }
});
