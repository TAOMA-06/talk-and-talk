import { api } from "../../utils/api";
import { ModerationAppeal, ModerationAppealableCase } from "../../utils/models";
import { openLegalDocument } from "../../utils/privacy";

type ModerationAppealView = ModerationAppeal & {
  statusText: string;
  createdAtText: string;
  reviewStateText: string;
  reviewedAtText: string;
};

type ModerationAppealableCaseView = ModerationAppealableCase & {
  createdAtText: string;
  appealDeadlineText: string;
  restrictionEndsAtText: string;
};

function formatDateTime(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间待确认";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function appealStatusText(status: string): string {
  if (status === "pending") return "独立复核中";
  if (status === "overturned") return "申诉成立";
  if (status === "upheld") return "维持原处置";
  if (status === "dismissed") return "申诉已结束";
  return "状态待确认";
}

function toAppealView(item: ModerationAppeal): ModerationAppealView {
  return {
    ...item,
    statusText: appealStatusText(item.status),
    createdAtText: formatDateTime(item.createdAt),
    reviewStateText: item.status === "pending"
      ? item.overdue
        ? `已超过平台计划处理时间（${formatDateTime(item.reviewDueAt)}）`
        : `计划在 ${formatDateTime(item.reviewDueAt)} 前完成复核`
      : item.resolution || appealStatusText(item.status),
    reviewedAtText: item.reviewedAt ? `完成于 ${formatDateTime(item.reviewedAt)}` : ""
  };
}

function toAppealableCaseView(item: ModerationAppealableCase): ModerationAppealableCaseView {
  return {
    ...item,
    createdAtText: formatDateTime(item.createdAt),
    appealDeadlineText: formatDateTime(item.appealDeadlineAt),
    restrictionEndsAtText: item.restrictionEndsAt ? formatDateTime(item.restrictionEndsAt) : ""
  };
}

Page({
  data: {
    appeals: [] as ModerationAppealView[],
    appealsLoading: false,
    appealsLoaded: false,
    appealsError: "",
    appealsPage: 1,
    appealsTotalPages: 1,
    appealsTotal: 0,
    appealableCases: [] as ModerationAppealableCaseView[],
    appealableCasesLoading: false,
    appealableCasesLoaded: false,
    appealableCasesError: "",
    appealableCasesPage: 1,
    appealableCasesTotalPages: 1,
    appealableCasesTotal: 0,
    focusCaseId: "",
    focusAppealId: "",
    focusRestrictionId: "",
    submittingCaseId: ""
  },
  onLoad(options: Record<string, string | undefined>) {
    this.setData({
      focusCaseId: options?.caseId || "",
      focusAppealId: options?.appealId || "",
      focusRestrictionId: options?.restrictionId || "",
      appealsPage: 1,
      appealableCasesPage: 1
    });
  },
  onShow() {
    void this.loadAppeals();
    void this.loadAppealableCases();
  },
  async loadAppeals(page?: number) {
    const targetPage = page ?? this.data.appealsPage;
    this.setData({ appealsLoading: true, appealsError: "" });
    try {
      const result = await api.moderationAppeals({
        page: targetPage,
        pageSize: 20,
        caseId: this.data.focusCaseId || undefined,
        appealId: this.data.focusAppealId || undefined
      });
      this.setData({
        appeals: result.items.map(toAppealView),
        appealsLoaded: true,
        appealsPage: result.pagination.page,
        appealsTotalPages: result.pagination.totalPages,
        appealsTotal: result.pagination.total
      });
    } catch {
      this.setData({
        appealsError: "申诉记录暂时无法加载。当前状态未知，请稍后重试。",
        appealsLoaded: false
      });
    } finally {
      this.setData({ appealsLoading: false });
    }
  },
  retryAppeals() {
    void this.loadAppeals();
  },
  previousAppealsPage() {
    if (this.data.appealsPage > 1) void this.loadAppeals(this.data.appealsPage - 1);
  },
  nextAppealsPage() {
    if (this.data.appealsPage < this.data.appealsTotalPages) void this.loadAppeals(this.data.appealsPage + 1);
  },
  async loadAppealableCases(page?: number) {
    const targetPage = page ?? this.data.appealableCasesPage;
    this.setData({ appealableCasesLoading: true, appealableCasesError: "" });
    try {
      const result = await api.moderationAppealableCases({
        page: targetPage,
        pageSize: 20,
        caseId: this.data.focusCaseId || undefined,
        restrictionId: this.data.focusRestrictionId || undefined
      });
      this.setData({
        appealableCases: result.items.map(toAppealableCaseView),
        appealableCasesLoaded: true,
        appealableCasesPage: result.pagination.page,
        appealableCasesTotalPages: result.pagination.totalPages,
        appealableCasesTotal: result.pagination.total
      });
    } catch {
      this.setData({
        appealableCasesError: "可申诉处置暂时无法加载。当前资格未知，请稍后重试。",
        appealableCasesLoaded: false
      });
    } finally {
      this.setData({ appealableCasesLoading: false });
    }
  },
  retryAppealableCases() {
    void this.loadAppealableCases();
  },
  previousAppealableCasesPage() {
    if (this.data.appealableCasesPage > 1) void this.loadAppealableCases(this.data.appealableCasesPage - 1);
  },
  nextAppealableCasesPage() {
    if (this.data.appealableCasesPage < this.data.appealableCasesTotalPages) {
      void this.loadAppealableCases(this.data.appealableCasesPage + 1);
    }
  },
  clearNotificationFocus() {
    this.setData({
      focusCaseId: "",
      focusAppealId: "",
      focusRestrictionId: "",
      appealsPage: 1,
      appealableCasesPage: 1
    });
    void this.loadAppeals(1);
    void this.loadAppealableCases(1);
  },
  appealCase(event: any) {
    const caseId = String(event.currentTarget.dataset.caseId || "");
    if (!caseId || this.data.submittingCaseId) return;
    wx.showModal({
      title: "申请独立复核",
      editable: true,
      placeholderText: "请说明你认为处置有误的原因",
      confirmText: "提交申诉",
      success: async (result: any) => {
        const reason = String(result.content || "").trim();
        if (!result.confirm || !reason) return;
        this.setData({ submittingCaseId: caseId });
        try {
          const response = await api.appeal(caseId, reason);
          await Promise.all([this.loadAppealableCases(), this.loadAppeals()]);
          wx.showModal({
            title: "申诉已进入独立复核",
            content: `平台计划在 ${formatDateTime(response.appeal.reviewDueAt)} 前完成复核，本页会持续展示状态和结果。`,
            showCancel: false,
            confirmText: "知道了"
          });
        } catch (error) {
          wx.showToast({ title: (error as Error).message || "申诉提交失败", icon: "none" });
        } finally {
          this.setData({ submittingCaseId: "" });
        }
      }
    });
  },
  leaveCurrentInteraction() {
    // This only moves the customer away from the current surface. It does not
    // cancel an order, create a report, or write any safety-related record.
    wx.switchTab({ url: "/pages/home/index" });
  },
  openMessages() {
    wx.switchTab({ url: "/pages/messages/index" });
  },
  openOrders() {
    wx.switchTab({ url: "/pages/orders/index" });
  },
  openSupportCenter() {
    wx.navigateTo({ url: "/pages/support/index" });
  },
  openSafetyReport() {
    wx.navigateTo({
      url: `/pages/support/index?category=safety&subject=${encodeURIComponent("安全举报")}`
    });
  },
  openPrivacy() {
    openLegalDocument("privacy");
  },
  openTerms() {
    openLegalDocument("terms");
  }
});
