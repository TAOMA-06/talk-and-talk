import { api, ensureSession } from "../../utils/api";
import { CommunityPost } from "../../utils/models";
import { ensurePrivacyAuthorization } from "../../utils/privacy";

Page({
  data: { posts: [] as CommunityPost[], topic: "", content: "", kind: "femaleRequest", loading: true, submitting: false, error: "" },
  onShow() { void this.load(); },
  onPullDownRefresh() { void this.load(true); },
  async load(stopRefresh = false) {
    try {
      await ensureSession();
      const result = await api.community();
      this.setData({ posts: result.items || [], loading: false, error: "" });
    } catch (error) { this.setData({ loading: false, error: (error as Error).message || "加载失败" }); }
    finally { if (stopRefresh) wx.stopPullDownRefresh(); }
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
      this.setData({ posts: [post, ...this.data.posts], topic: "", content: "" });
      wx.showToast({ title: post.moderationStatus === "approved" ? "已发布" : "内容未通过审核", icon: "none" });
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
  }
});
