import { api, ensureSession } from "../../utils/api";
import { CatalogDisplay, withCatalogDisplays } from "../../utils/catalog";
import { clientRealtimeVoiceEnabled } from "../../utils/config";
import { openCrisisResources, passCrisisGate } from "../../utils/crisis-gate";
import { Companion, RecommendedCompanion, RecommendationTopic } from "../../utils/models";
import { flushRecommendationEvents, queueRecommendationEvent, trackRecommendationCardViews } from "../../utils/recommendations";
import { companionAvatarUrl } from "../../utils/design-assets";
import {
  companionAvailabilityText,
  companionMetaText
} from "../../utils/companion-presentation";

type DisplayTopic = RecommendationTopic & { selected: boolean };
type DeliveryMode = "" | "text" | "voice";
type DeliveryModeFilter = { value: Exclude<DeliveryMode, "">; label: string; selected: boolean };
type PriceFilter = { value: number; label: string; selected: boolean };
type AvailabilityWithinDaysFilter = { value: number; label: string; selected: boolean };
type PublicSort = "" | "online" | "rating" | "reviewCount" | "priceAsc" | "soonestAvailable";
type PublicSortFilter = { value: Exclude<PublicSort, "">; label: string; selected: boolean };
type TrustFacetFilter = { value: string; label: string; selected: boolean };
type DisplayCompanion = CatalogDisplay<Companion | RecommendedCompanion> & {
  avatarUrl: string;
  availabilityText: string;
  metaText: string;
  cardTone: "blue" | "apricot" | "mint" | "lavender" | "butter" | "rose";
};
type TopicLoadState = "loading" | "available" | "error";
type DiscoveryIntent = {
  topicId?: string;
  deliveryMode?: DeliveryMode;
  availableWithinDays?: number;
  sortBy?: PublicSort;
  recovery?: {
    sourceOrderId: string;
    durationMinutes: number;
    serviceTitle: string;
    scheduledAt: string | null;
  };
};

const DELIVERY_MODES: Array<Omit<DeliveryModeFilter, "selected">> = [
  { value: "text", label: "文字服务" },
  { value: "voice", label: "语音服务" }
];

function availableDeliveryModes(): Array<Omit<DeliveryModeFilter, "selected">> {
  return clientRealtimeVoiceEnabled()
    ? DELIVERY_MODES
    : DELIVERY_MODES.filter((mode) => mode.value !== "voice");
}
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
  { value: "priceAsc", label: "商品起价低优先" }
];
const PUBLIC_LANGUAGES: Array<Omit<TrustFacetFilter, "selected">> = [
  { value: "中文", label: "中文" },
  { value: "普通话", label: "普通话" },
  { value: "粤语", label: "粤语" },
  { value: "英语", label: "英语" },
  { value: "日语", label: "日语" }
];
const PUBLIC_SPECIALTIES: Array<Omit<TrustFacetFilter, "selected">> = [
  { value: "情绪倾听", label: "情绪倾听" },
  { value: "睡前语音", label: "睡前陪伴" },
  { value: "职场减压", label: "职场减压" },
  { value: "学习陪伴", label: "学习陪伴" },
  { value: "兴趣聊天", label: "兴趣聊天" },
  { value: "运动鼓励", label: "运动鼓励" }
];
const RESULT_TONES: DisplayCompanion["cardTone"][] = ["blue", "apricot", "mint", "lavender", "butter", "rose"];

function displayTopics(topics: RecommendationTopic[], selectedTopicId: string): DisplayTopic[] {
  return topics.map((topic) => ({ ...topic, selected: topic.id === selectedTopicId }));
}

function displayDeliveryModes(selectedDeliveryMode: DeliveryMode): DeliveryModeFilter[] {
  return availableDeliveryModes().map((mode) => ({ ...mode, selected: mode.value === selectedDeliveryMode }));
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

function displayTrustFacets(
  facets: Array<Omit<TrustFacetFilter, "selected">>,
  selectedValue: string
): TrustFacetFilter[] {
  return facets.map((facet) => ({ ...facet, selected: facet.value === selectedValue }));
}

function filterSummary(
  topics: RecommendationTopic[],
  selectedKeyword: string,
  selectedSortBy: PublicSort,
  selectedTopicId: string,
  selectedLanguage: string,
  selectedSpecialty: string,
  selectedDeliveryMode: DeliveryMode,
  selectedMaxServicePriceCents: number,
  selectedAvailableWithinDays: number
): string {
  const labels = [
    selectedKeyword ? `搜索：${selectedKeyword}` : "",
    PUBLIC_SORTS.find((sort) => sort.value === selectedSortBy)?.label,
    topics.find((topic) => topic.id === selectedTopicId)?.name,
    PUBLIC_LANGUAGES.find((language) => language.value === selectedLanguage)?.label,
    PUBLIC_SPECIALTIES.find((specialty) => specialty.value === selectedSpecialty)?.label,
    DELIVERY_MODES.find((mode) => mode.value === selectedDeliveryMode)?.label,
    PRICE_LIMITS.find((limit) => limit.value === selectedMaxServicePriceCents)?.label,
    AVAILABILITY_WITHIN_DAYS.find((option) => option.value === selectedAvailableWithinDays)?.label
  ].filter(Boolean);
  return labels.join(" · ");
}

function normalizeKeyword(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, 40) : "";
}

function displayCompanions(items: Array<Companion | RecommendedCompanion>): DisplayCompanion[] {
  return withCatalogDisplays(items).map((item, index) => ({
    ...item,
    avatarUrl: companionAvatarUrl(item),
    availabilityText: companionAvailabilityText(item.availability),
    metaText: companionMetaText(item.nextAvailableText, item),
    cardTone: RESULT_TONES[index % RESULT_TONES.length]
  }));
}

Page({
  data: {
    motionOff: false,
    companions: [] as DisplayCompanion[],
    topicFilters: [] as DisplayTopic[],
    deliveryModeFilters: displayDeliveryModes(""),
    priceFilters: displayPriceLimits(0),
    availabilityWithinDaysFilters: displayAvailabilityWithinDays(0),
    publicSortFilters: displayPublicSorts(""),
    languageFilters: displayTrustFacets(PUBLIC_LANGUAGES, ""),
    specialtyFilters: displayTrustFacets(PUBLIC_SPECIALTIES, ""),
    selectedTopicId: "",
    selectedLanguage: "",
    selectedSpecialty: "",
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
    topicsState: "loading" as TopicLoadState,
    topicsError: "",
    recommendationFallback: false,
    recoveryNotice: "",
    recoverySourceOrderId: "",
    filterSheetOpen: false
  },
  stopRecommendationTracking: null as (() => void) | null,
  loadSequence: 0,
  async onShow() {
    const intent = (getApp()?.globalData?.discoveryIntent || null) as DiscoveryIntent | null;
    if (getApp()?.globalData) getApp().globalData.discoveryIntent = null;
    if (intent) {
      const selectedTopicId = typeof intent.topicId === "string" ? intent.topicId : "";
      const selectedDeliveryMode = availableDeliveryModes().some((mode) => mode.value === intent.deliveryMode)
        ? intent.deliveryMode!
        : "";
      const selectedAvailableWithinDays = AVAILABILITY_WITHIN_DAYS.some((item) => item.value === intent.availableWithinDays)
        ? intent.availableWithinDays!
        : 0;
      const selectedSortBy = PUBLIC_SORTS.some((item) => item.value === intent.sortBy) ? intent.sortBy! : "";
      this.setData({
        selectedTopicId,
        selectedDeliveryMode,
        selectedAvailableWithinDays,
        selectedSortBy,
        deliveryModeFilters: displayDeliveryModes(selectedDeliveryMode),
        availabilityWithinDaysFilters: displayAvailabilityWithinDays(selectedAvailableWithinDays),
        publicSortFilters: displayPublicSorts(selectedSortBy),
        recoveryNotice: intent.recovery
          ? `已按订单中的「${intent.recovery.serviceTitle}」带入主题、服务方式和 ${intent.recovery.durationMinutes} 分钟需求，并优先查看最早可约人选。请选择新陪伴者并重新确认价格与时段；旧订单和支付不会转移。`
          : "",
        recoverySourceOrderId: intent.recovery?.sourceOrderId || ""
      });
    }
    if (!await passCrisisGate("discover")) return;
    void this.load();
  },
  onHide() { this.stopTracking(); },
  onUnload() { this.stopTracking(); },
  onPullDownRefresh() { void this.load(true); },
  dismissRecoveryNotice() {
    this.setData({ recoveryNotice: "", recoverySourceOrderId: "" });
  },
  openFilters() { this.setData({ filterSheetOpen: true }); },
  closeFilters() { this.setData({ filterSheetOpen: false }); },
  noop() {},
  applyFilters() { this.setData({ filterSheetOpen: false }); },
  async resetFilters() {
    await this.clearFilters();
    this.setData({ filterSheetOpen: false });
  },
  async load(stopRefresh = false) {
    this.stopTracking();
    const sequence = ++this.loadSequence;
    const selectedTopicId = this.data.selectedTopicId;
    const selectedKeyword = this.data.selectedKeyword;
    const selectedSortBy = this.data.selectedSortBy;
    const selectedLanguage = this.data.selectedLanguage;
    const selectedSpecialty = this.data.selectedSpecialty;
    const selectedDeliveryMode = this.data.selectedDeliveryMode;
    const selectedMaxServicePriceCents = this.data.selectedMaxServicePriceCents;
    const selectedAvailableWithinDays = this.data.selectedAvailableWithinDays;
    const isFiltering = Boolean(
      selectedKeyword || selectedSortBy || selectedTopicId || selectedLanguage || selectedSpecialty
      || selectedDeliveryMode || selectedMaxServicePriceCents || selectedAvailableWithinDays
    );
    this.setData({ loading: true, error: "", isFiltering, topicsState: "loading", topicsError: "" });
    try {
      await ensureSession();
      const topicsTask = api.recommendationTopics()
        .then((value) => ({ value, available: true as const }))
        .catch(() => ({
          value: { algorithmVersion: "", items: [] as RecommendationTopic[] },
          available: false as const
        }));
      if (isFiltering) {
        const [topics, result] = await Promise.all([
          topicsTask,
          api.companions({
            ...(selectedKeyword ? { keyword: selectedKeyword } : {}),
            ...(selectedSortBy ? { sortBy: selectedSortBy } : {}),
            ...(selectedTopicId ? { topicId: selectedTopicId } : {}),
            ...(selectedLanguage ? { language: selectedLanguage } : {}),
            ...(selectedSpecialty ? { specialty: selectedSpecialty } : {}),
            ...(selectedDeliveryMode ? { deliveryMode: selectedDeliveryMode } : {}),
            ...(selectedMaxServicePriceCents ? { maxServicePriceCents: selectedMaxServicePriceCents } : {}),
            ...(selectedAvailableWithinDays ? { availableWithinDays: selectedAvailableWithinDays } : {})
          })
        ]);
        if (sequence !== this.loadSequence) return;
        this.setData({
          companions: displayCompanions(result.items || []),
          topicFilters: displayTopics(topics.value.items || [], selectedTopicId),
          topicsState: topics.available ? "available" : "error",
          topicsError: topics.available ? "" : "主题列表暂时无法读取；其他筛选和结果仍可使用。",
          languageFilters: displayTrustFacets(PUBLIC_LANGUAGES, selectedLanguage),
          specialtyFilters: displayTrustFacets(PUBLIC_SPECIALTIES, selectedSpecialty),
          deliveryModeFilters: displayDeliveryModes(selectedDeliveryMode),
          priceFilters: displayPriceLimits(selectedMaxServicePriceCents),
          availabilityWithinDaysFilters: displayAvailabilityWithinDays(selectedAvailableWithinDays),
          publicSortFilters: displayPublicSorts(selectedSortBy),
          activeFilterSummary: filterSummary(
            topics.value.items || [],
            selectedKeyword,
            selectedSortBy,
            selectedTopicId,
            selectedLanguage,
            selectedSpecialty,
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
          companions: displayCompanions(result.items || []),
          topicFilters: displayTopics(topics.value.items || [], ""),
          topicsState: topics.available ? "available" : "error",
          topicsError: topics.available ? "" : "主题列表暂时无法读取；其他筛选和结果仍可使用。",
          languageFilters: displayTrustFacets(PUBLIC_LANGUAGES, ""),
          specialtyFilters: displayTrustFacets(PUBLIC_SPECIALTIES, ""),
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
        const topics = await topicsTask;
        if (sequence !== this.loadSequence) return;
        this.setData({
          // Recommendation exclusions are enforced by the authenticated
          // recommendation endpoint. Never bypass them by silently replacing
          // a failed feed with the unfiltered public catalog.
          companions: [],
          topicFilters: displayTopics(topics.value.items || [], ""),
          topicsState: topics.available ? "available" : "error",
          topicsError: topics.available ? "" : "主题列表暂时无法读取；其他筛选和结果仍可使用。",
          languageFilters: displayTrustFacets(PUBLIC_LANGUAGES, ""),
          specialtyFilters: displayTrustFacets(PUBLIC_SPECIALTIES, ""),
          deliveryModeFilters: displayDeliveryModes(""),
          priceFilters: displayPriceLimits(0),
          availabilityWithinDaysFilters: displayAvailabilityWithinDays(0),
          publicSortFilters: displayPublicSorts(""),
          activeFilterSummary: "",
          loading: false,
          error: "推荐暂时无法加载。你仍可使用上方搜索手动查找当前公开资料。",
          recommendationFallback: false
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
  async retryTopics() {
    if (this.data.topicsState === "loading") return;
    this.setData({ topicsState: "loading", topicsError: "" });
    try {
      await ensureSession();
      const topics = await api.recommendationTopics();
      const previousTopicId = this.data.selectedTopicId;
      const selectedTopicId = (topics.items || []).some((item) => item.id === previousTopicId)
        ? previousTopicId
        : "";
      this.setData({
        selectedTopicId,
        topicFilters: displayTopics(topics.items || [], selectedTopicId),
        topicsState: "available",
        topicsError: ""
      });
      if (selectedTopicId !== previousTopicId) await this.load();
    } catch {
      this.setData({
        topicsState: "error",
        topicsError: "主题列表仍无法读取；请稍后重试。其他筛选和结果不受影响。"
      });
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
    if (!availableDeliveryModes().some((mode) => mode.value === value)) return;
    const selectedDeliveryMode = value === this.data.selectedDeliveryMode ? "" : value;
    this.setData({
      selectedDeliveryMode,
      deliveryModeFilters: displayDeliveryModes(selectedDeliveryMode)
    });
    await this.load();
  },
  async selectLanguage(event: any) {
    const requested = String(event.currentTarget.dataset.value || "");
    const value = PUBLIC_LANGUAGES.some((language) => language.value === requested) ? requested : "";
    const selectedLanguage = value === this.data.selectedLanguage ? "" : value;
    this.setData({
      selectedLanguage,
      languageFilters: displayTrustFacets(PUBLIC_LANGUAGES, selectedLanguage)
    });
    await this.load();
  },
  async selectSpecialty(event: any) {
    const requested = String(event.currentTarget.dataset.value || "");
    const value = PUBLIC_SPECIALTIES.some((specialty) => specialty.value === requested) ? requested : "";
    const selectedSpecialty = value === this.data.selectedSpecialty ? "" : value;
    this.setData({
      selectedSpecialty,
      specialtyFilters: displayTrustFacets(PUBLIC_SPECIALTIES, selectedSpecialty)
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
      && !this.data.selectedLanguage
      && !this.data.selectedSpecialty
      && !this.data.selectedDeliveryMode
      && !this.data.selectedMaxServicePriceCents
      && !this.data.selectedAvailableWithinDays
    ) return;
    this.setData({
      selectedTopicId: "",
      searchInput: "",
      selectedKeyword: "",
      selectedSortBy: "",
      selectedLanguage: "",
      selectedSpecialty: "",
      selectedDeliveryMode: "",
      selectedMaxServicePriceCents: 0,
      selectedAvailableWithinDays: 0,
      topicFilters: displayTopics(this.data.topicFilters, ""),
      languageFilters: displayTrustFacets(PUBLIC_LANGUAGES, ""),
      specialtyFilters: displayTrustFacets(PUBLIC_SPECIALTIES, ""),
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
  openEmergencyHelp() {
    openCrisisResources({ source: "directEmergencyHelp", riskCode: "userRequested" });
  },
  async openCompanion(event: any) {
    if (!await passCrisisGate("discover")) return;
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
