import { api, ensureSession } from "../../utils/api";
import { CommunityPost, RecommendedCompanion } from "../../utils/models";
import { ensurePrivacyAuthorization } from "../../utils/privacy";
import { flushRecommendationEvents, queueRecommendationEvent, trackRecommendationCardViews } from "../../utils/recommendations";

Page({
  data: {
    posts: [] as CommunityPost[], recommendations: [] as RecommendedCompanion[], topic: "", content: "", kind: "femaleRequest",
    loading: true, submitting: false, error: ""
  },
  stopRecommendationTracking: null as (() => void) | null,
  onShow() { void this.load(); },
  onHide() { this.stopTracking(); },
  onUnload() { this.stopTracking(); },
  onPullDownRefresh() { void this.load(true); },
  async load(stopRefresh = false) {
    this.stopTracking();
    try {
      await ensureSession();
      const [result, recommendationResult] = await Promise.all([
        api.community(),
        api.recommendedCompanions({ placement: "communityRelated", pageSize: 6 }).catch(() => ({ items: [] as RecommendedCompanion[] }))
      ]);
      this.setData({ posts: result.items || [], recommendations: recommendationResult.items || [], loading: false, error: "" });
      setTimeout(() => this.startTracking(), 0);
    } catch (error) { this.setData({ loading: false, error: (error as Error).message || "加载失败" }); }
    finally { if (stopRefresh) wx.stopPullDownRefresh(); }
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
    } catch (error) { wx.showToast({ title: (error as Error).message || "发布失败", icon: "none" }); }
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
