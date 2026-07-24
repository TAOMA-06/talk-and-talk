import { api, ensureSession } from "../../utils/api";
import { Companion, RecommendedCompanion, RecommendationTopic } from "../../utils/models";
import { flushRecommendationEvents, queueRecommendationEvent, trackRecommendationCardViews } from "../../utils/recommendations";

type DisplayTopic = RecommendationTopic & { selected: boolean };
type DeliveryMode = "" | "text" | "voice";
type DeliveryModeFilter = { value: Exclude<DeliveryMode, "">; label: string; selected: boolean };
type PriceFilter = { value: number; label: string; selected: boolean };
type AvailabilityWithinDaysFilter = { value: number; label: string; selected: boolean };
type PublicSort = "" | "online" | "rating" | "reviewCount" | "priceAsc" | "soonestAvailable";
type PublicSortFilter = { value: Exclude<PublicSort, "">; label: string; selected: boolean };

const DELIVERY_MODES: Array<Omit<DeliveryModeFilter, "selected">> = [
  { value: "text", label: "文字服务" },
  { value: "voice", label: "语音服务" }
];
const PRICE_LIMITS: Array<Omit<PriceFilter, "selected">> = [
  { value: 5_000, label: "¥50 内" },
  { value: 10_000, label: "¥100 内" },
  { value: 20_000, label: "¥200 内" }
];
const AVAILABILITY_WITHIN_DAYS: Array<Omit<AvailabilityWithinDaysFilter, "selected">> = [
  { value: 3, label: "3天内可约" }
];
const PUBLIC_SORTS: Array<Omit<PublicSortFilter, "selected">> = [
  { value: "soonestAvailable", label: "最早可约" },
  { value: "online", label: "在线优先" },
  { value: "rating", label: "评分优先" },
  { value: "reviewCount", label: "评价量优先" },
  { value: "priceAsc", label: "资料标价低优先" }
];

function displayTopics(topics: RecommendationTopic[], selectedTopicId: string): DisplayTopic[] {
  return topics.map((topic) => ({ ...topic, selected: topic.id === selectedTopicId }));
}

function displayDeliveryModes(selectedDeliveryMode: DeliveryMode): DeliveryModeFilter[] {
  return DELIVERY_MODES.map((mode) => ({ ...mode, selected: mode.value === selectedDeliveryMode }));
}

function displayPriceLimits(selectedMaxServicePriceCents: number): PriceFilter[] {
  return PRICE_LIMITS.map((limit) => ({ ...limit, selected: limit.value === selectedMaxServicePriceCents }));
}

function displayAvailabilityWithinDays(selectedAvailableWithinDays: number): AvailabilityWithinDaysFilter[] {
  return AVAILABILITY_WITHIN_DAYS.map((option) => ({
    ...option,
    selected: option.value === selectedAvailableWithinDays
  }));
}

function displayPublicSorts(selectedSortBy: PublicSort): PublicSortFilter[] {
  return PUBLIC_SORTS.map((sort) => ({ ...sort, selected: sort.value === selectedSortBy }));
}

function filterSummary(
  topics: RecommendationTopic[],
  selectedKeyword: string,
  selectedSortBy: PublicSort,
  selectedTopicId: string,
  selectedDeliveryMode: DeliveryMode,
  selectedMaxServicePriceCents: number,
  selectedAvailableWithinDays: number
): string {
  const labels = [
    selectedKeyword ? `搜索：${selectedKeyword}` : "",
    PUBLIC_SORTS.find((sort) => sort.value === selectedSortBy)?.label,
    topics.find((topic) => topic.id === selectedTopicId)?.name,
    DELIVERY_MODES.find((mode) => mode.value === selectedDeliveryMode)?.label,
    PRICE_LIMITS.find((limit) => limit.value === selectedMaxServicePriceCents)?.label,
    AVAILABILITY_WITHIN_DAYS.find((option) => option.value === selectedAvailableWithinDays)?.label
  ].filter(Boolean);
  return labels.join(" · ");
}

function normalizeKeyword(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, 40) : "";
}

Page({
  data: {
    companions: [] as Array<Companion | RecommendedCompanion>,
    topicFilters: [] as DisplayTopic[],
    deliveryModeFilters: displayDeliveryModes(""),
    priceFilters: displayPriceLimits(0),
    availabilityWithinDaysFilters: displayAvailabilityWithinDays(0),
    publicSortFilters: displayPublicSorts(""),
    selectedTopicId: "",
    searchInput: "",
    selectedKeyword: "",
    selectedSortBy: "" as PublicSort,
    selectedDeliveryMode: "" as DeliveryMode,
    selectedMaxServicePriceCents: 0,
    selectedAvailableWithinDays: 0,
    activeFilterSummary: "",
    isFiltering: false,
    loading: true,
    error: "",
    recommendationFallback: false
  },
  stopRecommendationTracking: null as (() => void) | null,
  loadSequence: 0,
  onShow() { void this.load(); },
  onHide() { this.stopTracking(); },
  onUnload() { this.stopTracking(); },
  onPullDownRefresh() { void this.load(true); },
  async load(stopRefresh = false) {
    this.stopTracking();
    const sequence = ++this.loadSequence;
    const selectedTopicId = this.data.selectedTopicId;
    const selectedKeyword = this.data.selectedKeyword;
    const selectedSortBy = this.data.selectedSortBy;
    const selectedDeliveryMode = this.data.selectedDeliveryMode;
    const selectedMaxServicePriceCents = this.data.selectedMaxServicePriceCents;
    const selectedAvailableWithinDays = this.data.selectedAvailableWithinDays;
    const isFiltering = Boolean(
      selectedKeyword || selectedSortBy || selectedTopicId || selectedDeliveryMode || selectedMaxServicePriceCents || selectedAvailableWithinDays
    );
    this.setData({ loading: true, error: "", isFiltering });
    try {
      await ensureSession();
      const topicsTask = api.recommendationTopics().catch(() => ({
        algorithmVersion: "", items: [] as RecommendationTopic[]
      }));
      if (isFiltering) {
        const [topics, result] = await Promise.all([
          topicsTask,
          api.companions({
            ...(selectedKeyword ? { keyword: selectedKeyword } : {}),
            ...(selectedSortBy ? { sortBy: selectedSortBy } : {}),
            ...(selectedTopicId ? { topicId: selectedTopicId } : {}),
            ...(selectedDeliveryMode ? { deliveryMode: selectedDeliveryMode } : {}),
            ...(selectedMaxServicePriceCents ? { maxServicePriceCents: selectedMaxServicePriceCents } : {}),
            ...(selectedAvailableWithinDays ? { availableWithinDays: selectedAvailableWithinDays } : {})
          })
        ]);
        if (sequence !== this.loadSequence) return;
        this.setData({
          companions: result.items || [],
          topicFilters: displayTopics(topics.items || [], selectedTopicId),
          deliveryModeFilters: displayDeliveryModes(selectedDeliveryMode),
          priceFilters: displayPriceLimits(selectedMaxServicePriceCents),
          availabilityWithinDaysFilters: displayAvailabilityWithinDays(selectedAvailableWithinDays),
          publicSortFilters: displayPublicSorts(selectedSortBy),
          activeFilterSummary: filterSummary(
            topics.items || [],
            selectedKeyword,
            selectedSortBy,
            selectedTopicId,
            selectedDeliveryMode,
            selectedMaxServicePriceCents,
            selectedAvailableWithinDays
          ),
          loading: false,
          recommendationFallback: false
        });
        return;
      }
      try {
        const [topics, result] = await Promise.all([
          topicsTask,
          api.recommendedCompanions({ placement: "discoverHome", pageSize: 20 })
        ]);
        if (sequence !== this.loadSequence) return;
        this.setData({
          companions: result.items || [],
          topicFilters: displayTopics(topics.items || [], ""),
          deliveryModeFilters: displayDeliveryModes(""),
          priceFilters: displayPriceLimits(0),
          availabilityWithinDaysFilters: displayAvailabilityWithinDays(0),
          publicSortFilters: displayPublicSorts(""),
          activeFilterSummary: "",
          loading: false,
          recommendationFallback: false
        });
        setTimeout(() => this.startTracking(), 0);
      } catch {
        const [topics, result] = await Promise.all([topicsTask, api.companions()]);
        if (sequence !== this.loadSequence) return;
        this.setData({
          companions: result.items || [],
          topicFilters: displayTopics(topics.items || [], ""),
          deliveryModeFilters: displayDeliveryModes(""),
          priceFilters: displayPriceLimits(0),
          availabilityWithinDaysFilters: displayAvailabilityWithinDays(0),
          publicSortFilters: displayPublicSorts(""),
          activeFilterSummary: "",
          loading: false,
          recommendationFallback: true
        });
      }
    } catch (error) {
      if (sequence === this.loadSequence) {
        this.setData({ loading: false, error: (error as Error).message || "加载失败" });
      }
    } finally {
      if (stopRefresh) wx.stopPullDownRefresh();
    }
  },
  async selectTopic(event: any) {
    const id = String(event.currentTarget.dataset.id || "");
    const selectedTopicId = id === this.data.selectedTopicId ? "" : id;
    this.setData({
      selectedTopicId,
      topicFilters: displayTopics(this.data.topicFilters, selectedTopicId)
    });
    await this.load();
  },
  setSearchInput(event: any) {
    this.setData({ searchInput: String(event.detail?.value || "").slice(0, 40) });
  },
  async submitSearch() {
    const selectedKeyword = normalizeKeyword(this.data.searchInput);
    if (selectedKeyword === this.data.selectedKeyword) return;
    this.setData({ selectedKeyword, searchInput: selectedKeyword });
    await this.load();
  },
  async selectPublicSort(event: any) {
    const rawValue = String(event.currentTarget.dataset.value || "") as PublicSort;
    const requestedValue = PUBLIC_SORTS.some((sort) => sort.value === rawValue) ? rawValue : "";
    const value = requestedValue === this.data.selectedSortBy ? "" : requestedValue;
    if (value === this.data.selectedSortBy) return;
    this.setData({ selectedSortBy: value, publicSortFilters: displayPublicSorts(value) });
    await this.load();
  },
  async selectDeliveryMode(event: any) {
    const value = String(event.currentTarget.dataset.value || "") as DeliveryMode;
    const selectedDeliveryMode = value === this.data.selectedDeliveryMode ? "" : value;
    this.setData({
      selectedDeliveryMode,
      deliveryModeFilters: displayDeliveryModes(selectedDeliveryMode)
    });
    await this.load();
  },
  async selectPriceLimit(event: any) {
    const rawValue = Number(event.currentTarget.dataset.value || 0);
    const value = PRICE_LIMITS.some((limit) => limit.value === rawValue) ? rawValue : 0;
    const selectedMaxServicePriceCents = value === this.data.selectedMaxServicePriceCents ? 0 : value;
    this.setData({
      selectedMaxServicePriceCents,
      priceFilters: displayPriceLimits(selectedMaxServicePriceCents)
    });
    await this.load();
  },
  async selectAvailabilityWithinDays(event: any) {
    const rawValue = Number(event.currentTarget.dataset.value || 0);
    const value = AVAILABILITY_WITHIN_DAYS.some((option) => option.value === rawValue) ? rawValue : 0;
    const selectedAvailableWithinDays = value === this.data.selectedAvailableWithinDays ? 0 : value;
    this.setData({
      selectedAvailableWithinDays,
      availabilityWithinDaysFilters: displayAvailabilityWithinDays(selectedAvailableWithinDays)
    });
    await this.load();
  },
  async clearFilters() {
    if (
      !this.data.selectedTopicId
      && !this.data.selectedKeyword
      && !this.data.selectedSortBy
      && !this.data.selectedDeliveryMode
      && !this.data.selectedMaxServicePriceCents
      && !this.data.selectedAvailableWithinDays
    ) return;
    this.setData({
      selectedTopicId: "",
      searchInput: "",
      selectedKeyword: "",
      selectedSortBy: "",
      selectedDeliveryMode: "",
      selectedMaxServicePriceCents: 0,
      selectedAvailableWithinDays: 0,
      topicFilters: displayTopics(this.data.topicFilters, ""),
      deliveryModeFilters: displayDeliveryModes(""),
      priceFilters: displayPriceLimits(0),
      availabilityWithinDaysFilters: displayAvailabilityWithinDays(0),
      publicSortFilters: displayPublicSorts("")
    });
    await this.load();
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
      (this.data.selectedTopicId || themeId) ? `themeId=${encodeURIComponent(this.data.selectedTopicId || themeId)}` : ""
    ].filter(Boolean).join("&");
    wx.navigateTo({ url: `/pages/companion/detail?${params}` });
  }
});
