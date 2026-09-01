import { ApiError, ensureSession } from "../../../utils/api";
import {
  CompanionEarning,
  CompanionEarningsSummary,
  CompanionWithdrawal,
  companionCommercialApi
} from "../../../utils/companion-commercial-api";

function money(cents: number): string {
  return `¥${(Math.max(0, cents) / 100).toFixed(2)}`;
}

function formatDateTime(value?: string | null): string {
  if (!value) return "时间待确认";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间待确认";
  const shanghai = new Date(date.getTime() + 8 * 60 * 60_000);
  return `${shanghai.getUTCFullYear()}-${String(shanghai.getUTCMonth() + 1).padStart(2, "0")}-${String(shanghai.getUTCDate()).padStart(2, "0")} ${String(shanghai.getUTCHours()).padStart(2, "0")}:${String(shanghai.getUTCMinutes()).padStart(2, "0")}`;
}

function earningStatusText(status: CompanionEarning["status"]): string {
  return ({
    pending: "待到可结算日",
    available: "可申请结算",
    held: "暂缓结算",
    paid: "平台已核验付款",
    void: "已作废"
  } as Record<string, string>)[status] || status;
}

function holdText(hold: CompanionEarning["hold"]): string {
  if (!hold) return "";
  const categories: Record<NonNullable<CompanionEarning["hold"]>["category"], string> = {
    afterSalesReview: "售后复核中",
    serviceReview: "服务事实复核中",
    eligibilityReview: "结算资格待更新",
    paymentProcessing: "结算处理核验中",
    accountReview: "账户结算复核中"
  };
  const nextActions: Record<NonNullable<CompanionEarning["hold"]>["nextAction"], string> = {
    waitForReview: "请等待当前复核完成",
    openServiceCase: "可在案件中心查看或补充已有事项",
    updateEligibility: "请在陪伴者工作台更新所需资料",
    contactSupport: "如需了解进度，请从案件中心联系平台"
  };
  return `${categories[hold.category]} · ${nextActions[hold.nextAction]}`;
}

function withdrawalStatus(status: CompanionWithdrawal["status"]) {
  const content: Record<string, { text: string; next: string }> = {
    requested: { text: "待审核", next: "平台尚未批准，也未发起任何外部转账。" },
    reviewing: { text: "审核中", next: "财务正在核对订单、退款窗口和结算资料。" },
    approved: { text: "已批准待处理", next: "批准不代表到账；等待财务执行逐笔付款。" },
    processing: { text: "付款处理中", next: "以每笔收益的独立付款与二次核验结果为准。" },
    paid: { text: "已核验到账", next: "平台已核验关联收益全部为 paid。" },
    rejected: { text: "未通过", next: "请查看拒绝原因，修正资料后重新选择仍可用收益。" },
    cancelled: { text: "已取消", next: "本申请不会进入付款处理。" }
  };
  return content[status] || { text: status, next: "请联系平台核对当前状态。" };
}

function errorMessage(error: unknown, fallback: string): string {
  const apiError = error as ApiError;
  const messages: Record<string, string> = {
    COMPANION_COMMERCIAL_PROFILE_NOT_VERIFIED: "商业资料尚未通过复核，无法提交结算申请。",
    WITHDRAWAL_EARNING_ALREADY_REQUESTED: "所选收益已经属于其他进行中的结算申请。",
    WITHDRAWAL_EARNING_NOT_AVAILABLE: "所选收益已变化、被暂缓或不属于当前账号，请刷新。",
    WITHDRAWAL_REQUEST_NOT_CANCELLABLE: "财务已经开始审核，这笔申请不能由陪伴者自行取消。",
    WITHDRAWAL_REQUEST_NOT_FOUND: "结算申请不存在或不属于当前账号。"
  };
  return (apiError.code && messages[apiError.code]) || apiError.message || fallback;
}

Page({
  data: {
    motionOff: false,
    loading: true,
    error: "",
    commercialStatus: "",
    suspended: false,
    settlementRecipientMasked: "",
    earnings: [] as Array<CompanionEarning & {
      amountText: string;
      statusText: string;
      timeText: string;
      holdText: string;
      selected: boolean;
    }>,
    withdrawals: [] as Array<CompanionWithdrawal & {
      amountText: string;
      statusText: string;
      nextStep: string;
      createdText: string;
    }>,
    earningStatuses: ["全部状态", "可申请结算", "待释放", "暂缓结算", "已核验付款", "已作废"],
    earningStatusValues: ["", "available", "pending", "held", "paid", "void"],
    earningStatusIndex: 0,
    earningPage: 1,
    earningTotalPages: 1,
    earningTotal: 0,
    withdrawalStatuses: ["全部状态", "待审核", "审核中", "已批准", "付款处理中", "已核验到账", "未通过", "已取消"],
    withdrawalStatusValues: ["", "requested", "reviewing", "approved", "processing", "paid", "rejected", "cancelled"],
    withdrawalStatusIndex: 0,
    withdrawalPage: 1,
    withdrawalTotalPages: 1,
    withdrawalTotal: 0,
    availableTotalText: "¥0.00",
    pendingTotalText: "¥0.00",
    paidTotalText: "¥0.00",
    selectedIds: [] as string[],
    selectedTotalText: "¥0.00",
    requesting: false,
    actionId: ""
  },
  onShow() { void this.load(); },
  onPullDownRefresh() { void this.load(true); },
  async load(stopRefresh = false) {
    this.setData({ loading: true, error: "" });
    try {
      await ensureSession();
      const [earningsResult, withdrawalsResult, overview] = await Promise.all([
        companionCommercialApi.earnings({
          page: this.data.earningPage,
          pageSize: 20,
          status: (this.data.earningStatusValues[this.data.earningStatusIndex] || undefined) as CompanionEarning["status"] | undefined
        }),
        companionCommercialApi.withdrawals({
          page: this.data.withdrawalPage,
          pageSize: 20,
          status: (this.data.withdrawalStatusValues[this.data.withdrawalStatusIndex] || undefined) as CompanionWithdrawal["status"] | undefined
        }),
        companionCommercialApi.overview()
      ]);
      const selected = new Set(this.data.selectedIds);
      const earnings = earningsResult.items.map((earning) => ({
        ...earning,
        amountText: money(earning.payableCents),
        statusText: earningStatusText(earning.status),
        timeText: formatDateTime(earning.availableAt),
        holdText: holdText(earning.hold),
        selected: earning.status === "available" && selected.has(earning.id)
      }));
      const withdrawals = withdrawalsResult.items.map((request) => {
        const status = withdrawalStatus(request.status);
        return {
          ...request,
          amountText: money(request.amountCents),
          statusText: status.text,
          nextStep: status.next,
          createdText: formatDateTime(request.createdAt)
        };
      });
      const summary: CompanionEarningsSummary = earningsResult.summary;
      this.setData({
        loading: false,
        commercialStatus: overview.commercialProfile.status,
        suspended: overview.commercialProfile.status === "suspended",
        settlementRecipientMasked: overview.commercialProfile.settlementRecipientMasked || "未配置",
        earnings,
        withdrawals,
        earningPage: earningsResult.pagination.page,
        earningTotalPages: earningsResult.pagination.totalPages,
        earningTotal: earningsResult.pagination.total,
        withdrawalPage: withdrawalsResult.pagination.page,
        withdrawalTotalPages: withdrawalsResult.pagination.totalPages,
        withdrawalTotal: withdrawalsResult.pagination.total,
        availableTotalText: money(summary.availableCents),
        pendingTotalText: money(summary.pendingOrHeldCents),
        paidTotalText: money(summary.paidCents),
        selectedIds: earnings.filter((earning) => earning.selected).map((earning) => earning.id)
      });
      this.updateSelectedTotal();
    } catch (error) {
      this.setData({
        loading: false,
        error: errorMessage(error, "收益和结算状态暂时无法加载，请稍后重试。")
      });
    } finally {
      if (stopRefresh) wx.stopPullDownRefresh();
    }
  },
  setEarningStatus(event: any) {
    this.setData({
      earningStatusIndex: Number(event.detail.value || 0),
      earningPage: 1,
      selectedIds: [],
      selectedTotalText: "¥0.00"
    });
    void this.load();
  },
  setWithdrawalStatus(event: any) {
    this.setData({ withdrawalStatusIndex: Number(event.detail.value || 0), withdrawalPage: 1 });
    void this.load();
  },
  previousEarningsPage() {
    if (this.data.earningPage <= 1) return;
    this.setData({ earningPage: this.data.earningPage - 1, selectedIds: [], selectedTotalText: "¥0.00" });
    void this.load();
  },
  nextEarningsPage() {
    if (this.data.earningPage >= this.data.earningTotalPages) return;
    this.setData({ earningPage: this.data.earningPage + 1, selectedIds: [], selectedTotalText: "¥0.00" });
    void this.load();
  },
  previousWithdrawalsPage() {
    if (this.data.withdrawalPage <= 1) return;
    this.setData({ withdrawalPage: this.data.withdrawalPage - 1 });
    void this.load();
  },
  nextWithdrawalsPage() {
    if (this.data.withdrawalPage >= this.data.withdrawalTotalPages) return;
    this.setData({ withdrawalPage: this.data.withdrawalPage + 1 });
    void this.load();
  },
  toggleEarning(event: any) {
    const id = event.currentTarget.dataset.id as string;
    const index = this.data.earnings.findIndex((earning) => earning.id === id && earning.status === "available");
    if (index < 0 || this.data.suspended || this.data.commercialStatus !== "verified") return;
    const selected = !this.data.earnings[index].selected;
    this.setData({ [`earnings[${index}].selected`]: selected });
    this.updateSelectedTotal();
  },
  updateSelectedTotal() {
    const selected = this.data.earnings.filter((earning) => earning.selected && earning.status === "available");
    this.setData({
      selectedIds: selected.map((earning) => earning.id),
      selectedTotalText: money(selected.reduce((total, earning) => total + earning.payableCents, 0))
    });
  },
  async requestWithdrawal() {
    if (this.data.requesting || !this.data.selectedIds.length) return;
    const confirmed = await new Promise<any>((resolve) => wx.showModal({
      title: `申请结算 ${this.data.selectedTotalText}`,
      content: `接收方掩码：${this.data.settlementRecipientMasked}\n提交只会创建待审核申请，不会调用银行、微信或其他付款供应商，也不代表到账。`,
      confirmText: "提交审核",
      success: resolve
    }));
    if (!confirmed.confirm) return;
    this.setData({ requesting: true, error: "" });
    try {
      await companionCommercialApi.requestWithdrawal(this.data.selectedIds);
      wx.showModal({
        title: "结算申请已进入待审核",
        content: "当前来源是平台内部申请记录；尚未批准、未发起外部转账，也未到账。请在下方状态卡查看下一步。",
        showCancel: false
      });
      this.setData({ selectedIds: [] });
      await this.load();
    } catch (error) {
      this.setData({ error: errorMessage(error, "提交结算申请失败，请刷新后重试。") });
    } finally {
      this.setData({ requesting: false });
    }
  },
  async cancelWithdrawal(event: any) {
    const id = event.currentTarget.dataset.id as string;
    if (!id || this.data.actionId) return;
    this.setData({ actionId: id, error: "" });
    try {
      await companionCommercialApi.cancelWithdrawal(id);
      wx.showToast({ title: "申请已取消", icon: "success" });
      await this.load();
    } catch (error) {
      this.setData({ error: errorMessage(error, "取消结算申请失败。") });
    } finally {
      this.setData({ actionId: "" });
    }
  },
  openOnboarding() { wx.navigateTo({ url: "/pages/companion/onboarding/index" }); },
  retry() { void this.load(); }
});
