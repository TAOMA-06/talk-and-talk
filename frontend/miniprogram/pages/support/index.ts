import { api, ensureSession } from "../../utils/api";
import {
  CommunityReportReceipt,
  PaymentDispute,
  PublicSupportInfo,
  ReporterCaseSummary,
  SupportTicket,
  SupportTicketCategory
} from "../../utils/models";
import { formatShanghaiDateTime } from "../../utils/order-display";
import { PaymentDisputeView, paymentDisputeView } from "../../utils/payment-dispute-display";

type DisplayCase = {
  id: string;
  kind: "safety" | "support";
  title: string;
  categoryText: string;
  statusText: string;
  summary: string;
  updatedText: string;
  tone: "active" | "resolved" | "attention";
};

const CATEGORY_OPTIONS: Array<{ value: SupportTicketCategory; label: string }> = [
  { value: "orderIssue", label: "订单与履约" },
  { value: "refund", label: "退款与支付" },
  { value: "safety", label: "安全举报" },
  { value: "privacy", label: "隐私与数据权利" },
  { value: "general", label: "其他客服问题" }
];

const SUPPORT_STATUS: Record<string, string> = {
  open: "待受理",
  inProgress: "处理中",
  resolved: "已处理",
  closed: "已关闭"
};

const OUTCOME_STATUS: Record<string, string> = {
  received: "已收到",
  reviewing: "独立审核中",
  actionTaken: "已复核并处置",
  closed: "已关闭"
};

function displaySupport(ticket: SupportTicket): DisplayCase {
  const resolved = ["resolved", "closed"].includes(ticket.status);
  return {
    id: ticket.id,
    kind: "support",
    title: ticket.subject,
    categoryText: CATEGORY_OPTIONS.find((item) => item.value === ticket.category)?.label || "客服案件",
    statusText: SUPPORT_STATUS[ticket.status] || "状态更新中",
    summary: ticket.resolution || ticket.body,
    updatedText: formatShanghaiDateTime(ticket.updatedAt),
    tone: resolved ? "resolved" : "active"
  };
}

function displayReporterCase(item: ReporterCaseSummary): DisplayCase {
  return {
    id: item.id,
    kind: "safety",
    title: "安全举报",
    categoryText: item.category || "平台安全",
    statusText: OUTCOME_STATUS[item.outcome] || "状态更新中",
    summary: item.outcomeSummary,
    updatedText: formatShanghaiDateTime(item.resolvedAt || item.createdAt),
    tone: item.outcome === "actionTaken" || item.outcome === "closed"
      ? "resolved"
      : item.riskLevel === "high" ? "attention" : "active"
  };
}

function validCategory(value: unknown): SupportTicketCategory {
  const normalized = String(value || "") as SupportTicketCategory;
  return CATEGORY_OPTIONS.some((item) => item.value === normalized) ? normalized : "general";
}

Page({
  data: {
    motionOff: false,
    cases: [] as DisplayCase[],
    safetyCases: [] as DisplayCase[],
    communityReceipts: [] as CommunityReportReceipt[],
    paymentDisputes: [] as PaymentDisputeView[],
    supportPage: 1,
    supportTotal: 0,
    supportTotalPages: 1,
    safetyPage: 1,
    safetyTotal: 0,
    safetyTotalPages: 1,
    communityReceiptsTruncated: false,
    paymentDisputePage: 1,
    paymentDisputeTotal: 0,
    paymentDisputeTotalPages: 1,
    paymentDisputeState: "loading" as "loading" | "available" | "none" | "error",
    loading: true,
    error: "",
    partialWarning: "",
    formOpen: false,
    categoryIndex: 4,
    categoryLabels: CATEGORY_OPTIONS.map((item) => item.label),
    category: "general" as SupportTicketCategory,
    subject: "",
    body: "",
    orderId: "",
    submitting: false,
    publicInfo: null as PublicSupportInfo | null,
    publicInfoState: "loading" as "loading" | "available" | "error",
    publicInfoError: ""
  },
  onLoad(options: Record<string, string | undefined>) {
    const category = validCategory(options.category);
    const subject = String(options.subject || "").slice(0, 120);
    const orderId = String(options.orderId || "").trim();
    const shouldOpen = Boolean(options.category || options.subject || orderId);
    this.setData({
      category,
      categoryIndex: Math.max(0, CATEGORY_OPTIONS.findIndex((item) => item.value === category)),
      subject: subject || (category === "safety" ? "安全举报" : ""),
      orderId,
      formOpen: shouldOpen
    });
    void this.loadPublicInfo();
  },
  onShow() {
    void this.loadPublicInfo();
    void this.load();
  },
  onPullDownRefresh() { void this.load(true); },
  async load(stopRefresh = false) {
    this.setData({
      loading: true,
      error: "",
      partialWarning: "",
      paymentDisputes: [],
      paymentDisputeState: "loading"
    });
    try {
      await ensureSession();
      const [support, safety, community, disputes] = await Promise.all([
        api.supportTickets({ page: this.data.supportPage, pageSize: 20 }).then((value) => ({ ok: true as const, value })).catch(() => ({
          ok: false as const,
          value: { items: [] as SupportTicket[], pagination: { page: this.data.supportPage, pageSize: 20, total: 0, totalPages: 1 } }
        })),
        api.reporterCases({ page: this.data.safetyPage, pageSize: 20 }).then((value) => ({ ok: true as const, value })).catch(() => ({
          ok: false as const,
          value: { items: [] as ReporterCaseSummary[], pagination: { page: this.data.safetyPage, pageSize: 20, total: 0, totalPages: 1 } }
        })),
        api.communityReportReceipts({ page: 1, pageSize: 20 }).then((value) => ({ ok: true as const, value })).catch(() => ({
          ok: false as const,
          value: { items: [] as CommunityReportReceipt[], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 } }
        })),
        api.paymentDisputes({ page: this.data.paymentDisputePage, pageSize: 20 }).then((value) => ({ ok: true as const, value })).catch(() => ({
          ok: false as const,
          value: { items: [] as PaymentDispute[], pagination: { page: this.data.paymentDisputePage, pageSize: 20, total: 0, totalPages: 1 } }
        }))
      ]);
      if (!support.ok && !safety.ok && !community.ok && !disputes.ok) throw new Error("案件记录暂时无法加载");
      const cases = (support.value.items || []).map(displaySupport);
      const safetyCases = (safety.value.items || []).map(displayReporterCase);
      const missing = [
        support.ok ? "" : "客服案件",
        safety.ok ? "" : "安全举报",
        community.ok ? "" : "广场举报回执",
        disputes.ok ? "" : "微信支付投诉状态"
      ].filter(Boolean);
      const paymentDisputes = (disputes.value.items || []).map(paymentDisputeView);
      this.setData({
        cases,
        safetyCases,
        communityReceipts: community.value.items || [],
        communityReceiptsTruncated: community.value.pagination.total > (community.value.items || []).length,
        paymentDisputes,
        supportPage: support.value.pagination.page,
        supportTotal: support.value.pagination.total,
        supportTotalPages: Math.max(1, support.value.pagination.totalPages),
        safetyPage: safety.value.pagination.page,
        safetyTotal: safety.value.pagination.total,
        safetyTotalPages: Math.max(1, safety.value.pagination.totalPages),
        paymentDisputePage: disputes.value.pagination.page,
        paymentDisputeTotal: disputes.value.pagination.total,
        paymentDisputeTotalPages: Math.max(1, disputes.value.pagination.totalPages),
        paymentDisputeState: disputes.ok ? paymentDisputes.length ? "available" : "none" : "error",
        partialWarning: missing.length ? `${missing.join("、")}暂时未能读取；页面未用空列表冒充完整结果。` : "",
        loading: false
      });
    } catch (error) {
      this.setData({
        loading: false,
        error: (error as Error).message || "案件中心暂时无法加载",
        paymentDisputeState: "error"
      });
    } finally {
      if (stopRefresh) wx.stopPullDownRefresh();
    }
  },
  async loadPublicInfo() {
    this.setData({ publicInfoState: "loading", publicInfoError: "" });
    try {
      const publicInfo = await api.publicSupportInfo();
      this.setData({ publicInfo, publicInfoState: "available" });
    } catch (error) {
      this.setData({
        publicInfo: null,
        publicInfoState: "error",
        publicInfoError: (error as Error).message || "公开客服信息暂时无法读取"
      });
    }
  },
  callPublicSupport() {
    const phone = String(this.data.publicInfo?.phone || "").trim();
    if (!phone) {
      wx.showToast({ title: "平台尚未公示客服电话", icon: "none" });
      return;
    }
    const phoneNumber = phone.replace(/[^\d+]/g, "");
    wx.makePhoneCall({
      phoneNumber,
      fail: (error: any) => {
        if (!/cancel/i.test(error?.errMsg || "")) {
          wx.showToast({ title: "暂时无法拨号", icon: "none" });
        }
      }
    });
  },
  copyPublicSupportEmail() {
    const email = String(this.data.publicInfo?.email || "").trim();
    if (!email) {
      wx.showToast({ title: "平台尚未公示客服邮箱", icon: "none" });
      return;
    }
    wx.setClipboardData({ data: email });
  },
  copyPublicStatusUrl() {
    const statusUrl = String(this.data.publicInfo?.statusUrl || "").trim();
    if (!statusUrl) {
      wx.showToast({ title: "暂时没有独立状态页", icon: "none" });
      return;
    }
    wx.setClipboardData({
      data: statusUrl,
      success: () => wx.showToast({ title: "状态页地址已复制", icon: "success" })
    });
  },
  toggleForm() {
    this.setData({ formOpen: !this.data.formOpen });
  },
  selectCategory(event: any) {
    const index = Number(event.detail?.value || 0);
    const option = CATEGORY_OPTIONS[index] || CATEGORY_OPTIONS[4];
    this.setData({
      categoryIndex: index,
      category: option.value,
      subject: option.value === "safety" && !this.data.subject.trim() ? "安全举报" : this.data.subject
    });
  },
  setSubject(event: any) {
    this.setData({ subject: String(event.detail?.value || "").slice(0, 120) });
  },
  setBody(event: any) {
    this.setData({ body: String(event.detail?.value || "").slice(0, 3000) });
  },
  async submit() {
    if (this.data.submitting) return;
    const category = this.data.category as SupportTicketCategory;
    const subject = this.data.subject.trim();
    const body = this.data.body.trim();
    if (category !== "safety" && (subject.length < 2 || subject.length > 120)) {
      wx.showToast({ title: "请填写 2–120 字问题标题", icon: "none" });
      return;
    }
    if (body.length < 5) {
      wx.showToast({ title: "请至少填写 5 个字的情况说明", icon: "none" });
      return;
    }
    if (category === "safety" && body.length > 500) {
      wx.showToast({ title: "安全举报说明请控制在 500 字内", icon: "none" });
      return;
    }
    this.setData({ submitting: true });
    try {
      if (category === "safety") {
        const result = await api.report({
          reason: body,
          reasonCode: "safety_center",
          ...(this.data.orderId ? { targetId: this.data.orderId } : {})
        });
        this.setData({ body: "", formOpen: false });
        wx.showToast({ title: "安全举报已提交", icon: "success" });
        wx.navigateTo({ url: `/pages/support/detail?kind=safety&id=${encodeURIComponent(result.report.id)}` });
        return;
      }
      const result = await api.createSupportTicket({
        category,
        subject,
        body,
        ...(this.data.orderId ? { orderId: this.data.orderId } : {})
      });
      this.setData({ body: "", formOpen: false });
      wx.showToast({ title: "客服案件已创建", icon: "success" });
      wx.navigateTo({ url: `/pages/support/detail?kind=support&id=${encodeURIComponent(result.id)}` });
    } catch (error) {
      wx.showToast({ title: (error as Error).message || "提交失败，请稍后重试", icon: "none" });
    } finally {
      this.setData({ submitting: false });
      void this.load();
    }
  },
  openCase(event: any) {
    const id = String(event.currentTarget.dataset.id || "");
    const kind = event.currentTarget.dataset.kind === "safety" ? "safety" : "support";
    if (!id) return;
    wx.navigateTo({ url: `/pages/support/detail?kind=${kind}&id=${encodeURIComponent(id)}` });
  },
  openPaymentDisputeOrder(event: any) {
    const orderId = String(event.currentTarget.dataset.orderId || "").trim();
    if (!orderId) return;
    wx.navigateTo({ url: `/pages/order/detail?id=${encodeURIComponent(orderId)}` });
  },
  previousPaymentDisputePage() {
    if (this.data.paymentDisputePage <= 1) return;
    this.setData({ paymentDisputePage: this.data.paymentDisputePage - 1 });
    void this.load();
  },
  nextPaymentDisputePage() {
    if (this.data.paymentDisputePage >= this.data.paymentDisputeTotalPages) return;
    this.setData({ paymentDisputePage: this.data.paymentDisputePage + 1 });
    void this.load();
  },
  previousSupportPage() {
    if (this.data.supportPage <= 1) return;
    this.setData({ supportPage: this.data.supportPage - 1 });
    void this.load();
  },
  nextSupportPage() {
    if (this.data.supportPage >= this.data.supportTotalPages) return;
    this.setData({ supportPage: this.data.supportPage + 1 });
    void this.load();
  },
  previousSafetyPage() {
    if (this.data.safetyPage <= 1) return;
    this.setData({ safetyPage: this.data.safetyPage - 1 });
    void this.load();
  },
  nextSafetyPage() {
    if (this.data.safetyPage >= this.data.safetyTotalPages) return;
    this.setData({ safetyPage: this.data.safetyPage + 1 });
    void this.load();
  },
  openCommunity() {
    wx.navigateTo({ url: "/pages/community/index" });
  },
  openSafetyCenter() {
    wx.navigateTo({ url: "/pages/safety/index" });
  }
});
