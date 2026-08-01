import { api, ApiError, ensureSession } from "../../utils/api";
import { Order, OrderExperienceFeedbackTag, Review } from "../../utils/models";
import {
  canRequestRefund,
  formatShanghaiDateTime,
  orderCompanionName,
  orderServiceName
} from "../../utils/order-display";

type RatingOption = { value: number; selected: boolean };
type FeedbackTagOption = { value: OrderExperienceFeedbackTag; label: string; selected: boolean };
type AftercareResourceState = "loading" | "available" | "empty" | "error";

const TAGS: Array<{ value: OrderExperienceFeedbackTag; label: string }> = [
  { value: "communicationClear", label: "沟通清晰" },
  { value: "boundaryRespected", label: "尊重边界" },
  { value: "onTime", label: "准时履约" },
  { value: "asExpected", label: "符合预期" },
  { value: "needsImprovement", label: "需要改进" }
];

function ratingOptions(selected: number): RatingOption[] {
  return [1, 2, 3, 4, 5].map((value) => ({ value, selected: value === selected }));
}

function tagOptions(selected: OrderExperienceFeedbackTag[]): FeedbackTagOption[] {
  const values = new Set(selected);
  return TAGS.map((item) => ({ ...item, selected: values.has(item.value) }));
}

Page({
  data: {
    order: null as Order | null,
    existingReview: null as Review | null,
    feedbackState: "loading" as AftercareResourceState,
    feedbackError: "",
    reviewState: "loading" as AftercareResourceState,
    reviewError: "",
    companionName: "",
    serviceName: "",
    completedAtText: "",
    rating: 0,
    ratingOptions: ratingOptions(0),
    feedbackTags: [] as OrderExperienceFeedbackTag[],
    feedbackTagOptions: tagOptions([]),
    feedbackNote: "",
    publicReviewContent: "",
    loading: true,
    error: "",
    submittingFeedback: false,
    submittingReview: false,
    confirmingCompletion: false,
    canRefund: false,
    canSubmitExperience: false,
    canSubmitReview: false,
    canConfirmCompletion: false
  },
  orderId: "",
  onLoad(options: Record<string, string | undefined>) {
    this.orderId = String(options.orderId || "").trim();
    if (!this.orderId) {
      this.setData({ loading: false, error: "缺少订单编号，请从订单详情重新进入。" });
      return;
    }
  },
  onShow() {
    if (this.orderId) void this.load();
  },
  async load() {
    this.setData({
      loading: true,
      error: "",
      order: null,
      existingReview: null,
      feedbackState: "loading",
      feedbackError: "",
      reviewState: "loading",
      reviewError: "",
      canRefund: false,
      canSubmitExperience: false,
      canSubmitReview: false,
      canConfirmCompletion: false
    });
    try {
      await ensureSession();
      const order = await api.order(this.orderId);
      if (!["completed", "refunded"].includes(order.status)) {
        this.setData({
          loading: false,
          error: "服务尚未完成，服务后页面暂未开放。",
          feedbackState: "error",
          feedbackError: "服务后反馈资格尚未开放。",
          reviewState: "error",
          reviewError: "服务后评价资格尚未开放。"
        });
        return;
      }
      const existingFeedback = order.experienceFeedback;
      const editable = order.status === "completed";
      this.setData({
        order,
        companionName: orderCompanionName(order),
        serviceName: orderServiceName(order),
        completedAtText: formatShanghaiDateTime(order.completedAt),
        rating: existingFeedback?.rating || 0,
        ratingOptions: ratingOptions(existingFeedback?.rating || 0),
        feedbackTags: existingFeedback?.tags || [],
        feedbackTagOptions: tagOptions(existingFeedback?.tags || []),
        feedbackNote: existingFeedback?.note || "",
        publicReviewContent: "",
        feedbackState: existingFeedback ? "available" : "empty",
        feedbackError: "",
        canRefund: canRequestRefund(order),
        canSubmitExperience: editable && !existingFeedback,
        canSubmitReview: false,
        canConfirmCompletion: editable && !order.customerConfirmedAt,
        loading: false
      });
      await this.loadReview();
    } catch (error) {
      this.setData({
        loading: false,
        error: (error as Error).message || "服务后信息暂时无法加载",
        order: null,
        existingReview: null,
        feedbackState: "error",
        feedbackError: "订单与私密反馈状态尚未读取成功，提交入口已关闭。",
        reviewState: "error",
        reviewError: "订单与评价状态尚未读取成功，提交入口已关闭。",
        canSubmitExperience: false,
        canSubmitReview: false,
        canConfirmCompletion: false
      });
    }
  },
  async loadReview() {
    const order = this.data.order as Order | null;
    if (!order) return;
    this.setData({
      existingReview: null,
      reviewState: "loading",
      reviewError: "",
      canSubmitReview: false
    });
    try {
      const result = await api.ownOrderReview(order.id);
      const existingReview = result.review;
      const restoredRating = order.experienceFeedback?.rating || existingReview?.rating || this.data.rating;
      this.setData({
        existingReview,
        reviewState: existingReview ? "available" : "empty",
        reviewError: "",
        publicReviewContent: existingReview?.content || "",
        rating: restoredRating,
        ratingOptions: ratingOptions(restoredRating),
        canSubmitReview: order.status === "completed" && !existingReview
      });
    } catch {
      this.setData({
        existingReview: null,
        reviewState: "error",
        reviewError: "公开评价状态暂时无法核对。这不代表尚未评价；为避免重复提交，入口已关闭。",
        canSubmitReview: false
      });
    }
  },
  async retryReview() {
    if (!this.data.order || this.data.reviewState === "loading") return;
    await this.loadReview();
  },
  selectRating(event: any) {
    if (this.data.order?.status !== "completed" || this.data.feedbackState === "available") return;
    const value = Number(event.currentTarget.dataset.value || 0);
    if (!Number.isInteger(value) || value < 1 || value > 5) return;
    this.setData({ rating: value, ratingOptions: ratingOptions(value) });
  },
  toggleFeedbackTag(event: any) {
    if (!this.data.canSubmitExperience) return;
    const value = String(event.currentTarget.dataset.value || "") as OrderExperienceFeedbackTag;
    if (!TAGS.some((item) => item.value === value)) return;
    const selected = this.data.feedbackTags.includes(value)
      ? this.data.feedbackTags.filter((item) => item !== value)
      : [...this.data.feedbackTags, value];
    if (selected.length > 3) {
      wx.showToast({ title: "最多选择 3 个体验标签", icon: "none" });
      return;
    }
    this.setData({ feedbackTags: selected, feedbackTagOptions: tagOptions(selected) });
  },
  setFeedbackNote(event: any) {
    this.setData({ feedbackNote: String(event.detail?.value || "").slice(0, 200) });
  },
  setPublicReview(event: any) {
    this.setData({ publicReviewContent: String(event.detail?.value || "").slice(0, 1000) });
  },
  async submitPrivateFeedback() {
    if (!this.data.order || this.data.feedbackState !== "empty" || !this.data.canSubmitExperience || this.data.submittingFeedback) return;
    if (this.data.rating < 1) {
      wx.showToast({ title: "请选择 1–5 分体验", icon: "none" });
      return;
    }
    this.setData({ submittingFeedback: true });
    try {
      const order = await api.submitOrderExperienceFeedback(this.orderId, {
        rating: this.data.rating,
        tags: this.data.feedbackTags,
        ...(this.data.feedbackNote.trim() ? { note: this.data.feedbackNote.trim() } : {})
      });
      this.setData({ order, feedbackState: "available", feedbackError: "", canSubmitExperience: false });
      wx.showToast({ title: "私密体验已记录", icon: "success" });
      await this.load();
    } catch (error) {
      wx.showToast({ title: (error as Error).message || "反馈提交失败", icon: "none" });
    } finally {
      this.setData({ submittingFeedback: false });
    }
  },
  async submitPublicReview() {
    if (this.data.reviewState !== "empty" || !this.data.canSubmitReview || this.data.submittingReview) return;
    const content = this.data.publicReviewContent.trim();
    if (this.data.rating < 1) {
      wx.showToast({ title: "请先选择 1–5 分", icon: "none" });
      return;
    }
    if (!content) {
      wx.showToast({ title: "请写下至少一个字的公开评价", icon: "none" });
      return;
    }
    this.setData({ submittingReview: true });
    try {
      const review = await api.createReview({ orderId: this.orderId, rating: this.data.rating, content });
      this.setData({
        existingReview: review,
        reviewState: "available",
        reviewError: "",
        canSubmitReview: false
      });
      wx.showToast({ title: "评价已提交", icon: "success" });
    } catch (error) {
      wx.showToast({ title: (error as Error).message || "评价提交失败", icon: "none" });
    } finally {
      this.setData({ submittingReview: false });
    }
  },
  async confirmCompletion() {
    if (!this.data.canConfirmCompletion || this.data.confirmingCompletion) return;
    const confirmation = await new Promise<any>((resolve) => wx.showModal({
      title: "确认服务完成",
      content: "确认只表示本次服务已完成，不会缩短售后申请期限，也不会撤销已有退款或客服案件。",
      confirmText: "确认完成",
      success: resolve,
      fail: () => resolve({ confirm: false })
    }));
    if (!confirmation.confirm) return;
    this.setData({ confirmingCompletion: true });
    try {
      await api.confirmOrderCompletion(this.orderId);
      wx.showToast({ title: "已确认完成", icon: "success" });
      await this.load();
    } catch (error) {
      wx.showToast({ title: (error as Error).message || "确认失败", icon: "none" });
    } finally {
      this.setData({ confirmingCompletion: false });
    }
  },
  async requestRefund() {
    if (!this.data.canRefund) return;
    const result = await new Promise<any>((resolve) => wx.showModal({
      title: "提交售后退款申请",
      editable: true,
      placeholderText: "请说明发生的情况（2–200 字）",
      content: "服务已经开始或完成，本次申请会进入人工审核。提交不代表退款已经成功。",
      confirmText: "提交申请",
      success: resolve,
      fail: () => resolve({ confirm: false })
    }));
    if (!result.confirm) return;
    const reason = String(result.content || "").trim();
    if (reason.length < 2 || reason.length > 200) {
      wx.showToast({ title: "请填写 2–200 字原因", icon: "none" });
      return;
    }
    try {
      await api.refund(this.orderId, reason);
      wx.showToast({ title: "售后申请已提交", icon: "success" });
      await this.load();
    } catch (error) {
      const apiError = error as ApiError;
      wx.showToast({ title: apiError.message || "申请提交失败", icon: "none" });
    }
  },
  rebook() {
    const order = this.data.order;
    if (!order) return;
    const query = [
      `id=${encodeURIComponent(order.companionId)}`,
      `themeId=${encodeURIComponent(order.themeId)}`,
      order.serviceOfferingId ? `serviceOfferingId=${encodeURIComponent(order.serviceOfferingId)}` : "",
      "rebook=1"
    ].filter(Boolean).join("&");
    wx.navigateTo({ url: `/pages/companion/detail?${query}` });
  },
  openSupport() {
    wx.navigateTo({ url: `/pages/support/index?orderId=${encodeURIComponent(this.orderId)}&category=orderIssue&subject=${encodeURIComponent("服务后需要平台协助")}` });
  },
  openSafety() {
    wx.navigateTo({ url: `/pages/support/index?orderId=${encodeURIComponent(this.orderId)}&category=safety&subject=${encodeURIComponent("服务中的安全问题")}` });
  }
});
