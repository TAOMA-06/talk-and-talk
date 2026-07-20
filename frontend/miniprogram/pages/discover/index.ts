import { api, ensureSession } from "../../utils/api";
import { Companion, RecommendedCompanion } from "../../utils/models";
import { flushRecommendationEvents, queueRecommendationEvent, trackRecommendationCardViews } from "../../utils/recommendations";

Page({
  data: { companions: [] as Array<Companion | RecommendedCompanion>, loading: true, error: "", recommendationFallback: false },
  stopRecommendationTracking: null as (() => void) | null,
  onShow() { void this.load(); },
  onHide() { this.stopTracking(); },
  onUnload() { this.stopTracking(); },
  onPullDownRefresh() { void this.load(true); },
  async load(stopRefresh = false) {
    this.stopTracking();
    this.setData({ loading: true, error: "" });
    try {
      await ensureSession();
      try {
        const result = await api.recommendedCompanions({ placement: "discoverHome", pageSize: 20 });
        this.setData({ companions: result.items || [], loading: false, recommendationFallback: false });
        setTimeout(() => this.startTracking(), 0);
      } catch {
        const result = await api.companions();
        this.setData({ companions: result.items || [], loading: false, recommendationFallback: true });
      }
    } catch (error) {
      this.setData({ loading: false, error: (error as Error).message || "加载失败" });
    } finally {
      if (stopRefresh) wx.stopPullDownRefresh();
    }
  },
  startTracking() {
    const recommendations = (this.data.companions as Array<Companion | RecommendedCompanion>)
      .filter((companion): companion is RecommendedCompanion => Boolean((companion as RecommendedCompanion).impressionId));
    if (!recommendations.length) return;
    this.stopRecommendationTracking = trackRecommendationCardViews(this, recommendations, "discover-recommendation");
  },
  stopTracking() {
    this.stopRecommendationTracking?.();
    this.stopRecommendationTracking = null;
    void flushRecommendationEvents();
  },
  openCompanion(event: any) {
    const { id, impressionId, themeId } = event.currentTarget.dataset;
    if (impressionId) {
      queueRecommendationEvent(impressionId, "click");
      void flushRecommendationEvents();
    }
    const params = [
      `id=${encodeURIComponent(id)}`,
      impressionId ? `rid=${encodeURIComponent(impressionId)}` : "",
      themeId ? `themeId=${encodeURIComponent(themeId)}` : ""
    ].filter(Boolean).join("&");
    wx.navigateTo({ url: `/pages/companion/detail?${params}` });
  }
});
