import { api, ensureSession } from "../../utils/api";
import { CatalogDisplay, withCatalogDisplays } from "../../utils/catalog";
import { CommunityPost, CommunityReportReceipt, RecommendedCompanion } from "../../utils/models";
import { ensurePrivacyAuthorization } from "../../utils/privacy";
import { flushRecommendationEvents, queueRecommendationEvent, trackRecommendationCardViews } from "../../utils/recommendations";

type CommunityReportReceiptView = CommunityReportReceipt & { submittedAtText: string };
type DisplayRecommendation = CatalogDisplay<RecommendedCompanion>;

function toReportReceiptView(item: CommunityReportReceipt): CommunityReportReceiptView {
  const submittedAt = new Date(item.submittedAt);
  if (!Number.isFinite(submittedAt.getTime())) {
    return { ...item, submittedAtText: "提交时间暂不可用" };
  }
  const twoDigits = (value: number) => String(value).padStart(2, "0");
  return {
    ...item,
    submittedAtText: `${submittedAt.getFullYear()}年${twoDigits(submittedAt.getMonth() + 1)}月${twoDigits(submittedAt.getDate())}日 ${twoDigits(submittedAt.getHours())}:${twoDigits(submittedAt.getMinutes())}`
  };
}

function communityWriteErrorMessage(error: unknown, fallback: string): string {
  if ((error as { code?: string } | null)?.code === "COMMUNITY_WRITE_RATE_LIMITED") {
    return "操作较频繁，请稍后再试";
  }
  return (error as Error)?.message || fallback;
}

Page({
  data: {
    posts: [] as CommunityPost[], recommendations: [] as DisplayRecommendation[], topic: "", content: "", kind: "femaleRequest",
    reportReceipts: [] as CommunityReportReceiptView[], reportReceiptsError: "",
    postPage: 1, postTotal: 0, postTotalPages: 1, loadingMorePosts: false,
    receiptPage: 1, receiptTotal: 0, receiptTotalPages: 1, loadingMoreReceipts: false,
    recommendationsState: "loading" as "loading" | "available" | "empty" | "error",
    recommendationsError: "",
    loading: true, submitting: false, reportingPostId: "", error: ""
  },
  stopRecommendationTracking: null as (() => void) | null,
  onShow() { void this.load(); },
  onHide() { this.stopTracking(); },
  onUnload() { this.stopTracking(); },
  onPullDownRefresh() { void this.load(true); },
  async load(stopRefresh = false) {
    this.stopTracking();
    // A page instance can survive navigation and account changes. Clear this
    // private surface before asking the newly authenticated session for its
    // own receipts so a prior account's history is never briefly reused.
    this.setData({
      loading: true,
      error: "",
      reportReceipts: [],
      reportReceiptsError: "",
      recommendations: [],
      recommendationsState: "loading",
      recommendationsError: "",
      postPage: 1,
      postTotal: 0,
      postTotalPages: 1,
      receiptPage: 1,
      receiptTotal: 0,
      receiptTotalPages: 1
    });
    try {
      await ensureSession();
      const [result, receiptResult] = await Promise.all([
        api.community({ page: 1, pageSize: 20 }),
        api.communityReportReceipts({ page: 1, pageSize: 20 })
          .then((response) => ({ ...response, items: response.items || [], error: "" }))
          .catch(() => ({
            items: [] as CommunityReportReceipt[],
            pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 },
            error: "暂时无法读取你的举报回执；这不代表没有提交记录。"
          })),
        this.loadRecommendations()
      ]);
      this.setData({
        posts: result.items || [],
        postPage: result.pagination.page,
        postTotal: result.pagination.total,
        postTotalPages: Math.max(1, result.pagination.totalPages),
        reportReceipts: receiptResult.items.map(toReportReceiptView),
        receiptPage: receiptResult.pagination.page,
        receiptTotal: receiptResult.pagination.total,
        receiptTotalPages: Math.max(1, receiptResult.pagination.totalPages),
        reportReceiptsError: receiptResult.error,
        loading: false,
        error: ""
      });
      setTimeout(() => this.startTracking(), 0);
    } catch (error) { this.setData({ loading: false, error: (error as Error).message || "加载失败" }); }
    finally { if (stopRefresh) wx.stopPullDownRefresh(); }
  },
  async loadRecommendations() {
    this.setData({ recommendations: [], recommendationsState: "loading", recommendationsError: "" });
    try {
      const result = await api.recommendedCompanions({ placement: "communityRelated", pageSize: 6 });
      const recommendations = withCatalogDisplays(result.items || []);
      this.setData({
        recommendations,
        recommendationsState: recommendations.length ? "available" : "empty",
        recommendationsError: ""
      });
    } catch {
      this.setData({
        recommendations: [],
        recommendationsState: "error",
        recommendationsError: "相关陪伴者暂时无法读取；广场内容与举报回执不受影响。"
      });
    }
  },
  async retryRecommendations() {
    if (this.data.recommendationsState === "loading") return;
    await this.loadRecommendations();
    this.stopTracking();
    setTimeout(() => this.startTracking(), 0);
  },
  async retryReportReceipts() {
    this.setData({ reportReceipts: [], reportReceiptsError: "" });
    try {
      const response = await api.communityReportReceipts({ page: 1, pageSize: 20 });
      this.setData({
        reportReceipts: (response.items || []).map(toReportReceiptView),
        receiptPage: response.pagination.page,
        receiptTotal: response.pagination.total,
        receiptTotalPages: Math.max(1, response.pagination.totalPages)
      });
    } catch {
      this.setData({ reportReceiptsError: "暂时无法读取你的举报回执；这不代表没有提交记录。" });
    }
  },
  async loadMorePosts() {
    if (this.data.loadingMorePosts || this.data.postPage >= this.data.postTotalPages) return;
    this.setData({ loadingMorePosts: true, error: "" });
    try {
      const response = await api.community({ page: this.data.postPage + 1, pageSize: 20 });
      const existingIds = new Set(this.data.posts.map((item) => item.id));
      this.setData({
        posts: [...this.data.posts, ...(response.items || []).filter((item) => !existingIds.has(item.id))],
        postPage: response.pagination.page,
        postTotal: response.pagination.total,
        postTotalPages: Math.max(1, response.pagination.totalPages)
      });
    } catch {
      this.setData({ error: "更多广场内容暂时无法读取；当前内容不是完整列表。" });
    } finally {
      this.setData({ loadingMorePosts: false });
    }
  },
  async loadMoreReportReceipts() {
    if (this.data.loadingMoreReceipts || this.data.receiptPage >= this.data.receiptTotalPages) return;
    this.setData({ loadingMoreReceipts: true, reportReceiptsError: "" });
    try {
      const response = await api.communityReportReceipts({ page: this.data.receiptPage + 1, pageSize: 20 });
      const existingIds = new Set(this.data.reportReceipts.map((item) => item.id));
      this.setData({
        reportReceipts: [
          ...this.data.reportReceipts,
          ...(response.items || []).filter((item) => !existingIds.has(item.id)).map(toReportReceiptView)
        ],
        receiptPage: response.pagination.page,
        receiptTotal: response.pagination.total,
        receiptTotalPages: Math.max(1, response.pagination.totalPages)
      });
    } catch {
      this.setData({ reportReceiptsError: "更多举报回执暂时无法读取；当前内容不是完整列表。" });
    } finally {
      this.setData({ loadingMoreReceipts: false });
    }
  },
  startTracking() {
    if (!this.data.recommendations.length) return;
    this.stopRecommendationTracking = trackRecommendationCardViews(this, this.data.recommendations, "community-recommendation");
  },
  stopTracking() {
    this.stopRecommendationTracking?.();
    this.stopRecommendationTracking = null;
    void flushRecommendationEvents();
  },
  setTopic(event: any) { this.setData({ topic: event.detail.value }); },
  setContent(event: any) { this.setData({ content: event.detail.value }); },
  switchKind() { this.setData({ kind: this.data.kind === "femaleRequest" ? "malePromotion" : "femaleRequest" }); },
  async submit() {
    const { topic, content, kind } = this.data;
    if (!topic.trim() || !content.trim()) { wx.showToast({ title: "请填写话题和内容", icon: "none" }); return; }
    this.setData({ submitting: true });
    try {
      await ensurePrivacyAuthorization();
      const post = await api.createPost({ kind, topic: topic.trim(), content: content.trim() });
      if (post.moderationStatus === "approved") {
        this.setData({ posts: [post, ...this.data.posts], topic: "", content: "" });
        wx.showToast({ title: "已发布", icon: "success" });
      } else {
        this.setData({ topic: "", content: "" });
        wx.showToast({
          title: post.moderationStatus === "pending" ? "已提交审核，审核通过后公开显示" : "内容未通过审核，未公开展示",
          icon: "none",
          duration: 2600
        });
      }
    } catch (error) { wx.showToast({ title: communityWriteErrorMessage(error, "发布失败"), icon: "none" }); }
    finally { this.setData({ submitting: false }); }
  },
  async toggleLike(event: any) {
    const id = event.currentTarget.dataset.id;
    const post = this.data.posts.find((item: CommunityPost) => item.id === id);
    if (!post) return;
    try {
      const updated = await api.setPostLike(id, !post.isLiked);
      this.setData({ posts: this.data.posts.map((item: CommunityPost) => item.id === id ? updated : item) });
    } catch (error) { wx.showToast({ title: (error as Error).message || "操作失败", icon: "none" }); }
  },
  reportPost(event: any) {
    const id = event.currentTarget.dataset.id as string;
    const post = this.data.posts.find((item: CommunityPost) => item.id === id);
    if (!post || this.data.reportingPostId) return;
    wx.showModal({
      title: "举报这条广场内容",
      editable: true,
      placeholderText: "请简要说明原因（不要粘贴联系方式、邮箱或证件信息）",
      success: async (result: any) => {
        if (!result.confirm) return;
        const reason = String(result.content || "").trim();
        if (reason.length < 2) {
          wx.showToast({ title: "请至少说明两个字", icon: "none" });
          return;
        }
        this.setData({ reportingPostId: id });
        try {
          const receipt = await api.reportCommunityPost(id, reason);
          if (!receipt.report.duplicate) {
            this.setData({
              reportReceipts: [
                toReportReceiptView({
                  id: receipt.report.id,
                  submittedAt: receipt.report.submittedAt,
                  status: "received"
                }),
                ...this.data.reportReceipts
              ],
              receiptTotal: this.data.receiptTotal + 1,
              reportReceiptsError: ""
            });
          }
          wx.showToast({
            title: receipt.report.duplicate ? "该内容已由你提交过举报" : "举报线索已提交",
            icon: "none"
          });
        } catch (error) {
          wx.showToast({ title: communityWriteErrorMessage(error, "提交举报失败"), icon: "none" });
        } finally {
          this.setData({ reportingPostId: "" });
        }
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
