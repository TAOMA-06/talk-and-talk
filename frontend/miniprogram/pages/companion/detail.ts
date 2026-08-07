import { api, ApiError, ensureSession } from "../../utils/api";
import { handleCustomerAdultEligibilityError } from "../../utils/adult-eligibility-recovery";
import { clientRealtimeVoiceEnabled, clientVoiceIntroEnabled } from "../../utils/config";
import { openCrisisResources, passCrisisGate } from "../../utils/crisis-gate";
import {
  Companion, CompanionAvailabilityCandidate, CompanionAvailabilityResponse, OrderServiceIntentCode,
  RecommendationCompanionExclusion, Review, ServiceOffering
} from "../../utils/models";
import { requestTransactionalSubscriptions } from "../../utils/subscription";

type ServiceCatalogStatus = "loading" | "available" | "empty";
type AvailabilityStatus = "loading" | "structured" | "empty" | "unavailable";
type AvailabilitySlot = CompanionAvailabilityCandidate & {
  dateKey: string;
  dateLabel: string;
  timeLabel: string;
  endTimeLabel: string;
};
type AvailabilityDateGroup = { key: string; label: string; items: AvailabilitySlot[] };
type TrustFact = {
  tone: "verification" | "boundary" | "order";
  title: string;
  description: string;
};
type PublicProfileDisplay = {
  languages: string[];
  specialties: string[];
  livedExperience: string;
  serviceBoundaries: string[];
  completedOrdersText: string;
  responseTimeText: string;
  trainingCurrent: boolean;
  trainingStatusText: string;
  trainingDetailText: string;
  reviewCurrent: boolean;
  reviewStatusText: string;
  reviewDetailText: string;
  voiceIntroPlayable: boolean;
  voiceIntroPlaybackUrl: string;
  voiceIntroMetaText: string;
  voiceIntroPlaybackText: string;
};
type BookingPreview = {
  companionName: string;
  serviceTitle: string;
  serviceIntentText: string;
  deliveryModeText: string;
  durationText: string;
  priceText: string;
  scheduleText: string;
};
type ServiceIntentOption = {
  code: OrderServiceIntentCode;
  title: string;
  description: string;
};

const VALID_THEME_IDS = ["t1", "t2", "t3", "t4", "t5", "t6"];
const SERVICE_OFFERING_PAGE_SIZE = 20;
const SERVICE_INTENT_OPTIONS: ServiceIntentOption[] = [
  { code: "listen", title: "只想被倾听", description: "以认真聆听与回应为主，不急着给建议。" },
  { code: "comfort", title: "希望获得情绪安抚", description: "需要温和陪伴与情绪支持，不替代专业治疗。" },
  { code: "organize", title: "想梳理思路", description: "一起整理事件、感受与可选的下一步。" },
  { code: "advice", title: "希望听取一般建议", description: "可听取生活层面建议，但不含医疗、法律或财务判断。" },
  { code: "lightCompanionship", title: "轻松聊聊", description: "轻松交流与陪伴，不承诺特定结果。" }
];
const AVAILABILITY_STEP_MS = 30 * 60_000;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60_000;
const WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"];

function createOrderRequestId(): string {
  return `order_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}_${Math.random().toString(36).slice(2, 12)}`;
}

const PENDING_ORDER_PREFIX = "talkandtalk.pendingOrder.";

function pendingOrderStorageKey(
  companionId: string,
  themeId: string,
  serviceOfferingId: string,
  availabilityWindowId: string,
  durationMinutes: number,
  scheduledAt: Date,
  serviceIntent: OrderServiceIntentCode
): string {
  return `${PENDING_ORDER_PREFIX}${encodeURIComponent(companionId)}:${encodeURIComponent(themeId)}:${encodeURIComponent(serviceOfferingId)}:${encodeURIComponent(availabilityWindowId)}:${durationMinutes}:${scheduledAt.toISOString()}:${serviceIntent}`;
}

function persistedOrderRequestId(storageKey: string, scheduledAt: Date): string {
  try {
    const pending = wx.getStorageSync(storageKey) as { clientRequestId?: unknown; expiresAt?: unknown } | undefined;
    if (
      pending &&
      typeof pending.clientRequestId === "string" &&
      /^[A-Za-z0-9_-]{16,64}$/.test(pending.clientRequestId) &&
      typeof pending.expiresAt === "number" &&
      pending.expiresAt > Date.now()
    ) {
      return pending.clientRequestId;
    }
    if (pending) wx.removeStorageSync(storageKey);
  } catch {
    // Storage exhaustion must not prevent an order attempt; the in-memory key
    // below still protects retries during the current page lifetime.
  }

  const clientRequestId = createOrderRequestId();
  try {
    wx.setStorageSync(storageKey, {
      clientRequestId,
      // Keep an ambiguous network attempt recoverable through the appointment
      // and its immediate support window; successful responses delete it.
      expiresAt: scheduledAt.getTime() + 24 * 60 * 60_000
    });
  } catch {
    // See the storage-exhaustion note above.
  }
  return clientRequestId;
}

function offeringTopics(offering: ServiceOffering): string[] {
  return Array.isArray(offering.topicIds) ? offering.topicIds : [];
}

function themeForOffering(offering: ServiceOffering, currentThemeId: string): string {
  const topics = offeringTopics(offering);
  if (topics.includes(currentThemeId)) return currentThemeId;
  return topics[0] || currentThemeId || "t1";
}

function initialOffering(
  offerings: ServiceOffering[],
  themeId: string,
  preferredServiceOfferingId = ""
): ServiceOffering | null {
  const preferred = offerings.find((offering) => offering.id === preferredServiceOfferingId);
  if (preferred) return preferred;
  return offerings.find((offering) => {
    const topics = offeringTopics(offering);
    return topics.length === 0 || topics.includes(themeId);
  }) || offerings[0] || null;
}

function isBookableOffering(offering: ServiceOffering): boolean {
  const deliveryModeAllowed = offering.deliveryMode === "text"
    || (offering.deliveryMode === "voice" && clientRealtimeVoiceEnabled());
  return typeof offering.id === "string"
    && Boolean(offering.id.trim())
    && typeof offering.title === "string"
    && Boolean(offering.title.trim())
    && deliveryModeAllowed
    && Number.isInteger(offering.durationMinutes)
    && offering.durationMinutes >= 30
    && offering.durationMinutes <= 240
    && offering.durationMinutes % 30 === 0
    && Number.isInteger(offering.priceCents)
    && offering.priceCents > 0
    && offering.currency === "CNY";
}

function companionTrustFacts(companion: Companion): TrustFact[] {
  return [
    {
      tone: "verification",
      title: "平台当前展示核验",
      description: companion.isVerified
        ? "这份资料当前满足平台公开展示条件；它不表示医疗、心理治疗或紧急救助资质。"
        : "这份资料未满足平台当前公开展示条件，暂不能作为可预约服务依据。"
    },
    {
      tone: "boundary",
      title: "服务范围与沟通边界",
      description: "服务方式以本页已选商品为准，沟通和订单处理只在平台内进行；陪伴服务不提供诊断、治疗或紧急救助。"
    },
    {
      tone: "order",
      title: "下单时再次确认",
      description: "服务、价格、时长和可约时段以创建订单时的当前选择为准；履约、退款或安全问题请从订单内联系平台客服。"
    }
  ];
}

function isAvailabilityPayload(value: unknown, offering: ServiceOffering): value is CompanionAvailabilityResponse {
  if (!value || typeof value !== "object") return false;
  const payload = value as Partial<CompanionAvailabilityResponse>;
  return (payload.source === "structured" || payload.source === "legacy")
    && typeof payload.timezone === "string"
    && payload.serviceOfferingId === offering.id
    && payload.durationMinutes === offering.durationMinutes
    && Array.isArray(payload.legacyAvailableTimes)
    && payload.legacyAvailableTimes.every((item) => typeof item === "string")
    && Array.isArray(payload.items);
}

function isBookableAvailabilityCandidate(
  candidate: unknown,
  durationMinutes: number
): candidate is CompanionAvailabilityCandidate {
  if (!candidate || typeof candidate !== "object") return false;
  const item = candidate as Partial<CompanionAvailabilityCandidate>;
  const startsAt = new Date(item.startsAt || "").getTime();
  const endsAt = new Date(item.endsAt || "").getTime();
  return typeof item.id === "string"
    && Boolean(item.id.trim())
    && typeof item.availabilityWindowId === "string"
    && Boolean(item.availabilityWindowId.trim())
    && typeof item.startsAt === "string"
    && typeof item.endsAt === "string"
    && Number.isFinite(startsAt)
    && Number.isFinite(endsAt)
    && startsAt % AVAILABILITY_STEP_MS === 0
    && endsAt - startsAt === durationMinutes * 60_000
    && typeof item.capacity === "number"
    && Number.isInteger(item.capacity)
    && item.capacity >= 1
    && typeof item.reservedCount === "number"
    && Number.isInteger(item.reservedCount)
    && item.reservedCount >= 0
    && typeof item.availableCapacity === "number"
    && Number.isInteger(item.availableCapacity)
    && item.availableCapacity > 0
    && item.availableCapacity <= item.capacity
    && item.reservedCount + item.availableCapacity === item.capacity;
}

function shanghaiDateParts(value: Date) {
  const shifted = new Date(value.getTime() + SHANGHAI_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes()
  };
}

function twoDigits(value: number): string { return String(value).padStart(2, "0"); }

function publicDate(value: string | null | undefined): string {
  if (!value) return "未提供";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "未提供";
  const parts = shanghaiDateParts(date);
  return `${parts.year}年${parts.month}月${parts.day}日`;
}

function publicProfileDisplay(companion: Companion): PublicProfileDisplay {
  const training = companion.publicTrust?.training;
  const platformReview = companion.publicTrust?.platformReview;
  const voiceIntro = companion.voiceIntro;
  const trainingCurrent = training?.status === "current";
  const reviewCurrent = platformReview?.status === "current";
  return {
    languages: (companion.languages || []).filter(Boolean),
    specialties: (companion.specialties || []).filter(Boolean),
    livedExperience: companion.livedExperience?.trim() || "未填写公开经历说明",
    serviceBoundaries: (companion.serviceBoundaries || []).filter(Boolean),
    completedOrdersText: Number.isInteger(companion.completedOrders)
      ? `${companion.completedOrders} 单已完成`
      : "完成单量暂未提供",
    responseTimeText: companion.responseTime?.trim() || "响应时间暂未提供",
    trainingCurrent,
    trainingStatusText: trainingCurrent ? "培训当前有效" : "培训待续期",
    trainingDetailText: training
      ? `${training.currentModules}/${training.requiredModules} 项要求当前有效${trainingCurrent && training.validUntil ? ` · 有效至 ${publicDate(training.validUntil)}` : ""}`
      : "平台暂未提供可公开的培训状态",
    reviewCurrent,
    reviewStatusText: reviewCurrent ? "平台复审当前有效" : "平台复审待更新",
    reviewDetailText: platformReview
      ? `最近核验 ${publicDate(platformReview.verifiedAt)} · 下次复审 ${publicDate(platformReview.nextReviewDueAt)}`
      : "平台暂未提供可公开的复审日期",
    voiceIntroPlayable: clientVoiceIntroEnabled()
      && voiceIntro?.available === true
      && voiceIntro.status === "approved"
      && typeof voiceIntro.playbackUrl === "string"
      && voiceIntro.playbackUrl.startsWith("https://"),
    voiceIntroPlaybackUrl: typeof voiceIntro?.playbackUrl === "string"
      && voiceIntro.playbackUrl.startsWith("https://")
      ? voiceIntro.playbackUrl
      : "",
    voiceIntroMetaText: voiceIntro?.available
      ? `已审核${voiceIntro.durationSeconds ? ` · ${voiceIntro.durationSeconds} 秒` : ""}`
      : "暂无已审核语音介绍",
    voiceIntroPlaybackText: typeof voiceIntro?.playbackUrl === "string"
      && voiceIntro.playbackUrl.startsWith("https://")
      ? "安全短期播放链接已就绪，点击播放。"
      : ""
  };
}

function availabilitySlot(candidate: CompanionAvailabilityCandidate): AvailabilitySlot {
  const startsAt = new Date(candidate.startsAt);
  const endsAt = new Date(candidate.endsAt);
  const start = shanghaiDateParts(startsAt);
  const end = shanghaiDateParts(endsAt);
  return {
    ...candidate,
    dateKey: `${start.year}-${twoDigits(start.month)}-${twoDigits(start.day)}`,
    dateLabel: `${start.month}月${start.day}日 周${WEEKDAY_LABELS[start.weekday]}`,
    timeLabel: `${twoDigits(start.hour)}:${twoDigits(start.minute)}`,
    endTimeLabel: `${twoDigits(end.hour)}:${twoDigits(end.minute)}`
  };
}

function availabilityDateGroups(candidates: AvailabilitySlot[]): AvailabilityDateGroup[] {
  const groups: AvailabilityDateGroup[] = [];
  for (const candidate of candidates) {
    const last = groups[groups.length - 1];
    if (last?.key === candidate.dateKey) {
      last.items.push(candidate);
    } else {
      groups.push({ key: candidate.dateKey, label: candidate.dateLabel, items: [candidate] });
    }
  }
  return groups;
}

function formatCny(cents: number): string {
  const yuan = cents / 100;
  return Number.isInteger(yuan) ? String(yuan) : yuan.toFixed(2);
}

function bookingButtonText(
  offering: ServiceOffering,
  candidate: Pick<AvailabilitySlot, "timeLabel"> | null = null
): string {
  if (candidate) return `预约 ${candidate.timeLabel} · ¥${formatCny(offering.priceCents)}`;
  return `预约 ${offering.durationMinutes} 分钟 · ¥${formatCny(offering.priceCents)}`;
}

Page({
  data: {
    companion: null as Companion | null, reviews: [] as Review[], loading: true, error: "", booking: false,
    reviewPage: 1,
    reviewTotal: 0,
    reviewTotalPages: 1,
    reviewsLoadingMore: false,
    reviewsError: "",
    orderClientRequestId: "",
    serviceOfferings: [] as ServiceOffering[],
    selectedServiceOffering: null as ServiceOffering | null,
    selectedServiceOfferingId: "",
    serviceCatalogStatus: "loading" as ServiceCatalogStatus,
    serviceCatalogMessage: "",
    serviceCatalogPage: 1,
    serviceCatalogTotalPages: 1,
    serviceCatalogTotal: 0,
    serviceCatalogLoadingMore: false,
    serviceCatalogLoadMoreError: "",
    availabilityStatus: "loading" as AvailabilityStatus,
    availabilityMessage: "",
    availabilityCandidates: [] as AvailabilitySlot[],
    availabilityDateGroups: [] as AvailabilityDateGroup[],
    selectedAvailabilityCandidate: null as AvailabilitySlot | null,
    selectedAvailabilityCandidateId: "",
    serviceIntentOptions: SERVICE_INTENT_OPTIONS,
    selectedServiceIntent: "" as OrderServiceIntentCode | "",
    selectedServiceIntentLabel: "",
    canBook: false,
    bookingButtonText: "加载服务中…",
    rebookingNotice: "",
    trustFacts: [] as TrustFact[],
    publicProfile: null as PublicProfileDisplay | null,
    canManageFavorites: false,
    favoriteState: "loading" as "loading" | "available" | "error",
    favoriteError: "",
    isFavorite: false,
    favoriteSaving: false,
    recommendationExclusionAvailable: false,
    isRecommendationExcluded: false,
    recommendationExclusionSaving: false,
    bookingConfirmationVisible: false,
    bookingBoundaryConfirmed: false,
    bookingAccuracyConfirmed: false,
    bookingPreview: null as BookingPreview | null
  },
  companionId: "",
  recommendationImpressionId: "",
  preferredServiceOfferingId: "",
  rebookingRequested: false,
  themeId: "t1",
  availabilityRequestSequence: 0,
  async onLoad(query: any) {
    this.companionId = query.id || "";
    this.recommendationImpressionId = query.rid || "";
    this.preferredServiceOfferingId = typeof query.serviceOfferingId === "string"
      ? query.serviceOfferingId.trim()
      : "";
    this.rebookingRequested = query.rebook === "1";
    this.themeId = VALID_THEME_IDS.includes(query.themeId) ? query.themeId : "";
    if (!await passCrisisGate("companionDetail")) return;
    return this.load();
  },
  async load() {
    this.availabilityRequestSequence += 1;
    this.setData({
      loading: true,
      error: "",
      serviceOfferings: [],
      selectedServiceOffering: null,
      selectedServiceOfferingId: "",
      serviceCatalogStatus: "loading",
      serviceCatalogMessage: "",
      serviceCatalogPage: 1,
      serviceCatalogTotalPages: 1,
      serviceCatalogTotal: 0,
      serviceCatalogLoadingMore: false,
      serviceCatalogLoadMoreError: "",
      availabilityStatus: "loading",
      availabilityMessage: "",
      availabilityCandidates: [],
      availabilityDateGroups: [],
      selectedAvailabilityCandidate: null,
      selectedAvailabilityCandidateId: "",
      selectedServiceIntent: "",
      selectedServiceIntentLabel: "",
      orderClientRequestId: "",
      canBook: false,
      bookingButtonText: "加载服务中…",
      rebookingNotice: this.rebookingRequested ? "正在核对上次服务的当前价格与可约时段…" : "",
      trustFacts: [],
      publicProfile: null,
      canManageFavorites: false,
      favoriteState: "loading",
      favoriteError: "",
      isFavorite: false,
      favoriteSaving: false,
      recommendationExclusionAvailable: false,
      isRecommendationExcluded: false,
      recommendationExclusionSaving: false,
      bookingConfirmationVisible: false,
      bookingBoundaryConfirmed: false,
      bookingAccuracyConfirmed: false,
      bookingPreview: null,
      reviewPage: 1,
      reviewTotal: 0,
      reviewTotalPages: 1,
      reviewsLoadingMore: false,
      reviewsError: ""
    });
    try {
      await ensureSession();
      const [companion, reviews, user] = await Promise.all([
        api.companion(this.companionId),
        api.reviews(this.companionId, { page: 1, pageSize: 20 }),
        api.fetchMe()
      ]);
      const reviewPagination = reviews.pagination || {
        page: 1,
        pageSize: 20,
        total: reviews.items?.length || 0,
        totalPages: 1
      };
      const canManageFavorites = user.role === "user";
      const publicProfile = publicProfileDisplay(companion);
      const [favoriteStatus, recommendationExclusions] = canManageFavorites
        ? await Promise.all([
          api.favoriteCompanionStatus(companion.id)
            .then((response) => ({ value: response, available: true }))
            .catch(() => ({ value: null, available: false })),
          api.recommendationCompanionExclusions()
            .then((response) => ({ ...response, available: true }))
            .catch(() => ({ items: [] as RecommendationCompanionExclusion[], available: false }))
        ])
        : [
          { value: null, available: true },
          { items: [] as RecommendationCompanionExclusion[], available: false }
        ];
      const isFavorite = canManageFavorites && Boolean(favoriteStatus.value?.favorited);
      const isRecommendationExcluded = canManageFavorites
        && recommendationExclusions.items.some((item) => item.companionId === companion.id);
      this.setData({
        favoriteState: favoriteStatus.available ? "available" : "error",
        favoriteError: favoriteStatus.available
          ? ""
          : "书签状态暂时无法读取。这不代表尚未保存；为避免误操作，更新入口已关闭。"
      });
      if (canManageFavorites) {
        // Opening a currently public detail page is the only write trigger.
        // This private recall record is intentionally fire-and-forget: it must
        // not delay booking, become a recommendation signal, or surface to the
        // companion if the recall endpoint is temporarily unavailable.
        void api.recordRecentlyViewedCompanion(companion.id).catch(() => undefined);
      }
      try {
        const catalog = await api.serviceOfferings(this.companionId, {
          page: 1,
          pageSize: SERVICE_OFFERING_PAGE_SIZE
        });
        const catalogPagination = catalog.pagination || {
          page: 1,
          pageSize: SERVICE_OFFERING_PAGE_SIZE,
          total: catalog.items?.length || 0,
          totalPages: 1
        };
        const serviceOfferings = (catalog.items || []).filter(isBookableOffering);
        const selectedServiceOffering = initialOffering(
          serviceOfferings,
          this.themeId,
          this.preferredServiceOfferingId
        );
        if (!selectedServiceOffering) {
          this.setData({
            companion,
            reviews: reviews.items || [],
            reviewPage: reviewPagination.page,
            reviewTotal: reviewPagination.total,
            reviewTotalPages: Math.max(1, reviewPagination.totalPages),
            trustFacts: companionTrustFacts(companion),
            publicProfile,
            canManageFavorites,
            isFavorite,
            favoriteSaving: false,
            recommendationExclusionAvailable: recommendationExclusions.available,
            isRecommendationExcluded,
            recommendationExclusionSaving: false,
            serviceOfferings,
            serviceCatalogStatus: "empty",
            serviceCatalogMessage: catalog.items?.length ? "服务配置暂不可预约，请稍后刷新。" : "该陪伴者暂未开放可预约服务。",
            serviceCatalogPage: catalogPagination.page,
            serviceCatalogTotalPages: catalogPagination.totalPages,
            serviceCatalogTotal: catalogPagination.total,
            serviceCatalogLoadMoreError: "",
            availabilityStatus: "empty",
            availabilityMessage: "请先等待陪伴者开放可预约服务。",
            canBook: false,
            bookingButtonText: "当前暂未开放预约",
            rebookingNotice: this.rebookingRequested ? "上次服务目前未开放预约，请稍后刷新后再约。" : "",
            loading: false
          });
          return;
        }

        this.themeId = themeForOffering(selectedServiceOffering, this.themeId);
        const rebookingNotice = this.rebookingRequested
          ? selectedServiceOffering.id === this.preferredServiceOfferingId
            ? "已带入上次服务。请重新选择当前可约时段；价格、服务范围和时长以本页为准。"
            : "上次服务目前未开放；请从当前可预约服务中重新选择，并重新确认时段与价格。"
          : "";
        this.setData({
          companion,
          reviews: reviews.items || [],
          reviewPage: reviewPagination.page,
          reviewTotal: reviewPagination.total,
          reviewTotalPages: Math.max(1, reviewPagination.totalPages),
          trustFacts: companionTrustFacts(companion),
          publicProfile,
          canManageFavorites,
          isFavorite,
          favoriteSaving: false,
          recommendationExclusionAvailable: recommendationExclusions.available,
          isRecommendationExcluded,
          recommendationExclusionSaving: false,
          serviceOfferings,
          selectedServiceOffering,
          selectedServiceOfferingId: selectedServiceOffering.id,
          serviceCatalogStatus: "available",
          serviceCatalogPage: catalogPagination.page,
          serviceCatalogTotalPages: catalogPagination.totalPages,
          serviceCatalogTotal: catalogPagination.total,
          serviceCatalogLoadMoreError: "",
          availabilityStatus: "loading",
          availabilityMessage: "正在读取可预约时段…",
          canBook: false,
          bookingButtonText: "加载可约时段…",
          rebookingNotice,
          loading: false
        });
        await this.loadAvailability(companion, selectedServiceOffering);
      } catch {
        // A catalog outage cannot safely fall back to editable profile pricing:
        // commercial orders require a current offering and structured capacity.
        this.setData({
          companion,
          reviews: reviews.items || [],
          reviewPage: reviewPagination.page,
          reviewTotal: reviewPagination.total,
          reviewTotalPages: Math.max(1, reviewPagination.totalPages),
          trustFacts: companionTrustFacts(companion),
          publicProfile,
          canManageFavorites,
          isFavorite,
          favoriteSaving: false,
          recommendationExclusionAvailable: recommendationExclusions.available,
          isRecommendationExcluded,
          recommendationExclusionSaving: false,
          serviceOfferings: [],
          selectedServiceOffering: null,
          selectedServiceOfferingId: "",
          serviceCatalogStatus: "empty",
          serviceCatalogMessage: this.rebookingRequested
            ? "暂时无法确认上次服务是否仍在开放，请稍后刷新后再约。"
            : "服务目录暂时不可用，请稍后刷新。",
          serviceCatalogPage: 1,
          serviceCatalogTotalPages: 1,
          serviceCatalogTotal: 0,
          serviceCatalogLoadingMore: false,
          serviceCatalogLoadMoreError: "",
          availabilityStatus: "unavailable",
          availabilityMessage: "服务目录恢复后，平台会重新读取价格和可约时段。",
          availabilityCandidates: [],
          availabilityDateGroups: [],
          selectedAvailabilityCandidate: null,
          selectedAvailabilityCandidateId: "",
          canBook: false,
          bookingButtonText: this.rebookingRequested ? "暂无法再次预约" : "暂无法预约",
          rebookingNotice: this.rebookingRequested
            ? "再次预约不会复用旧订单；请等待当前服务目录恢复后重新确认。"
            : "",
          loading: false
        });
      }
    } catch (error) { this.setData({ loading: false, error: (error as Error).message || "加载失败" }); }
  },
  async loadMoreReviews() {
    if (this.data.reviewsLoadingMore || this.data.reviewPage >= this.data.reviewTotalPages) return;
    const nextPage = this.data.reviewPage + 1;
    this.setData({ reviewsLoadingMore: true, reviewsError: "" });
    try {
      const response = await api.reviews(this.companionId, { page: nextPage, pageSize: 20 });
      const existingIds = new Set(this.data.reviews.map((item) => item.id));
      const appended = (response.items || []).filter((item) => !existingIds.has(item.id));
      this.setData({
        reviews: [...this.data.reviews, ...appended],
        reviewPage: response.pagination.page,
        reviewTotal: response.pagination.total,
        reviewTotalPages: Math.max(1, response.pagination.totalPages),
        reviewsError: ""
      });
    } catch {
      this.setData({ reviewsError: "更多评价暂时无法读取，请重试；当前内容不是完整列表。" });
    } finally {
      this.setData({ reviewsLoadingMore: false });
    }
  },
  async loadMoreServiceOfferings() {
    if (
      this.data.serviceCatalogLoadingMore
      || this.data.serviceCatalogPage >= this.data.serviceCatalogTotalPages
    ) return;
    const page = this.data.serviceCatalogPage + 1;
    this.setData({ serviceCatalogLoadingMore: true, serviceCatalogLoadMoreError: "" });
    try {
      const response = await api.serviceOfferings(this.companionId, {
        page,
        pageSize: SERVICE_OFFERING_PAGE_SIZE
      });
      const byId = new Map<string, ServiceOffering>(
        this.data.serviceOfferings.map((item) => [item.id, item])
      );
      (response.items || []).filter(isBookableOffering).forEach((item) => byId.set(item.id, item));
      this.setData({
        serviceOfferings: [...byId.values()],
        serviceCatalogStatus: byId.size ? "available" : "empty",
        serviceCatalogPage: response.pagination.page,
        serviceCatalogTotalPages: response.pagination.totalPages,
        serviceCatalogTotal: response.pagination.total,
        serviceCatalogLoadMoreError: ""
      });
    } catch {
      this.setData({
        serviceCatalogLoadMoreError: "更多服务商品暂时无法读取；已加载商品和当前选择仍保留。"
      });
    } finally {
      this.setData({ serviceCatalogLoadingMore: false });
    }
  },
  async loadAvailability(companion: Companion, offering: ServiceOffering) {
    const requestSequence = ++this.availabilityRequestSequence;
    this.setData({
      availabilityStatus: "loading",
      availabilityMessage: "正在读取可预约时段…",
      availabilityCandidates: [],
      availabilityDateGroups: [],
      selectedAvailabilityCandidate: null,
      selectedAvailabilityCandidateId: "",
      orderClientRequestId: "",
      canBook: false,
      bookingButtonText: "加载可约时段…"
    });
    try {
      const response = await api.companionAvailability(this.companionId, {
        serviceOfferingId: offering.id,
        days: 7
      });
      if (requestSequence !== this.availabilityRequestSequence) return;
      if (!isAvailabilityPayload(response, offering)) {
        this.setData({
          availabilityStatus: "unavailable",
          availabilityMessage: "可预约时段数据异常，请稍后刷新。",
          canBook: false,
          bookingButtonText: "暂无法确认可约时段"
        });
        return;
      }
      if (response.source === "legacy") {
        this.setData({
          availabilityStatus: "empty",
          availabilityMessage: "这项服务尚未配置可选择的真实时段，请稍后再来。",
          availabilityCandidates: [],
          availabilityDateGroups: [],
          selectedAvailabilityCandidate: null,
          selectedAvailabilityCandidateId: "",
          canBook: false,
          bookingButtonText: "暂时没有可约时段"
        });
        return;
      }

      const validCandidates = response.items
        .filter((candidate) => isBookableAvailabilityCandidate(candidate, offering.durationMinutes))
        .map(availabilitySlot)
        .sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt));
      if (response.items.length > 0 && validCandidates.length === 0) {
        this.setData({
          availabilityStatus: "unavailable",
          availabilityMessage: "可预约时段数据异常，请稍后刷新。",
          canBook: false,
          bookingButtonText: "暂无法确认可约时段"
        });
        return;
      }
      if (validCandidates.length === 0) {
        this.setData({
          availabilityStatus: "empty",
          availabilityMessage: "这项服务暂时没有可预约时段，请切换服务或稍后刷新。",
          canBook: false,
          bookingButtonText: "暂时没有可约时段"
        });
        return;
      }
      this.setData({
        availabilityStatus: "structured",
        availabilityMessage: "请选择一个可预约时段；时段以北京时间显示。",
        availabilityCandidates: validCandidates,
        availabilityDateGroups: availabilityDateGroups(validCandidates),
        selectedAvailabilityCandidate: null,
        selectedAvailabilityCandidateId: "",
        canBook: false,
        bookingButtonText: "请选择可预约时段"
      });
    } catch {
      if (requestSequence !== this.availabilityRequestSequence) return;
      this.setData({
        availabilityStatus: "unavailable",
        availabilityMessage: "可预约时段暂时加载失败，请刷新后重试。",
        canBook: false,
        bookingButtonText: "暂无法确认可约时段"
      });
    }
  },
  async toggleFavorite() {
    const companion = this.data.companion;
    if (!companion || !this.data.canManageFavorites || this.data.favoriteState !== "available" || this.data.favoriteSaving) return;
    const wasFavorite = this.data.isFavorite;
    this.setData({ favoriteSaving: true });
    try {
      if (wasFavorite) {
        await api.removeFavoriteCompanion(companion.id);
        this.setData({ isFavorite: false });
        wx.showToast({ title: "已从我的书签移除", icon: "success" });
      } else {
        await api.saveFavoriteCompanion(companion.id);
        this.setData({ isFavorite: true });
        wx.showToast({ title: "已保存到我的书签", icon: "success" });
      }
    } catch (error) {
      const apiError = error as ApiError;
      wx.showToast({
        title: apiError.code === "COMPANION_NOT_FOUND"
          ? "这份资料已更新，暂不能保存，请刷新后重试"
          : apiError.message || "暂时无法更新书签",
        icon: "none"
      });
      if (apiError.code === "COMPANION_NOT_FOUND") await this.load();
    } finally {
      if (this.data.companion?.id === companion.id) this.setData({ favoriteSaving: false });
    }
  },
  async retryFavoriteState() {
    const companion = this.data.companion;
    if (!companion || !this.data.canManageFavorites || this.data.favoriteState === "loading") return;
    this.setData({ favoriteState: "loading", favoriteError: "" });
    try {
      const response = await api.favoriteCompanionStatus(companion.id);
      this.setData({
        favoriteState: "available",
        favoriteError: "",
        isFavorite: Boolean(response.favorited)
      });
    } catch {
      this.setData({
        favoriteState: "error",
        favoriteError: "书签状态暂时无法读取。这不代表尚未保存；为避免误操作，更新入口已关闭。"
      });
    }
  },
  async excludeFromRecommendations() {
    const companion = this.data.companion;
    if (
      !companion
      || !this.data.canManageFavorites
      || !this.data.recommendationExclusionAvailable
      || this.data.isRecommendationExcluded
      || this.data.recommendationExclusionSaving
    ) return;
    const confirmation = await new Promise<any>((resolve) => wx.showModal({
      title: "不再推荐这位陪伴者？",
      content: "只会停止在推荐和匹配结果中出现。不会拉黑会话、提交举报、取消订单、改变书签或隐藏公开资料；你仍可手动搜索并查看。",
      confirmText: "停止推荐",
      cancelText: "暂不处理",
      success: resolve
    }));
    if (!confirmation.confirm) return;
    this.setData({ recommendationExclusionSaving: true });
    try {
      await api.excludeCompanionFromRecommendations(companion.id);
      if (this.data.companion?.id !== companion.id) return;
      this.setData({ isRecommendationExcluded: true });
      wx.showToast({ title: "已停止推荐", icon: "success" });
    } catch (error) {
      const apiError = error as ApiError;
      wx.showToast({ title: apiError.message || "暂时无法更新推荐设置", icon: "none" });
      if (apiError.code === "COMPANION_NOT_FOUND") await this.load();
    } finally {
      if (this.data.companion?.id === companion.id) this.setData({ recommendationExclusionSaving: false });
    }
  },
  async restoreToRecommendations() {
    const companion = this.data.companion;
    if (
      !companion
      || !this.data.canManageFavorites
      || !this.data.recommendationExclusionAvailable
      || !this.data.isRecommendationExcluded
      || this.data.recommendationExclusionSaving
    ) return;
    this.setData({ recommendationExclusionSaving: true });
    try {
      await api.restoreCompanionToRecommendations(companion.id);
      if (this.data.companion?.id !== companion.id) return;
      this.setData({ isRecommendationExcluded: false });
      wx.showToast({ title: "已恢复推荐资格", icon: "success" });
    } catch (error) {
      const apiError = error as ApiError;
      wx.showToast({ title: apiError.message || "暂时无法恢复推荐", icon: "none" });
    } finally {
      if (this.data.companion?.id === companion.id) this.setData({ recommendationExclusionSaving: false });
    }
  },
  selectServiceOffering(event: any) {
    const id = String(event.currentTarget?.dataset?.id || "");
    const selectedServiceOffering = this.data.serviceOfferings.find((offering) => offering.id === id);
    if (!selectedServiceOffering) return;
    this.themeId = themeForOffering(selectedServiceOffering, this.themeId);
    const companion = this.data.companion;
    this.setData({
      selectedServiceOffering,
      selectedServiceOfferingId: selectedServiceOffering.id,
      orderClientRequestId: "",
      bookingButtonText: bookingButtonText(selectedServiceOffering)
    });
    if (companion) void this.loadAvailability(companion, selectedServiceOffering);
  },
  selectAvailabilityCandidate(event: any) {
    const id = String(event.currentTarget?.dataset?.id || "");
    const selectedAvailabilityCandidate = this.data.availabilityCandidates.find((candidate) => candidate.id === id);
    const offering = this.data.selectedServiceOffering;
    const companion = this.data.companion;
    if (
      this.data.availabilityStatus !== "structured" ||
      !selectedAvailabilityCandidate ||
      !offering ||
      !isBookableAvailabilityCandidate(selectedAvailabilityCandidate, offering.durationMinutes)
    ) return;
    const slot = selectedAvailabilityCandidate as AvailabilitySlot;
    this.setData({
      selectedAvailabilityCandidate: slot,
      selectedAvailabilityCandidateId: slot.id,
      orderClientRequestId: "",
      canBook: Boolean(this.data.selectedServiceIntent),
      bookingButtonText: this.data.selectedServiceIntent
        ? (companion ? bookingButtonText(offering, slot) : "预约服务")
        : "先选择本次陪伴方式"
    });
  },
  async book() {
    if (!await passCrisisGate("order")) return;
    if (!this.data.selectedServiceIntent) {
      wx.showToast({ title: "请选择本次希望的陪伴方式", icon: "none" });
      return;
    }
    if (!this.data.canBook) {
      wx.showToast({ title: this.data.availabilityMessage || this.data.serviceCatalogMessage || "当前暂不可预约", icon: "none" });
      return;
    }
    const selectedServiceOffering = this.data.selectedServiceOffering;
    if (!selectedServiceOffering || !isBookableOffering(selectedServiceOffering)) {
      wx.showToast({ title: "所选服务已失效，请重新选择", icon: "none" });
      return;
    }
    const durationMinutes = selectedServiceOffering.durationMinutes;
    let scheduledAt: Date;
    let availabilityWindowId: string | null = null;
    if (this.data.availabilityStatus === "structured") {
      const candidate = this.data.selectedAvailabilityCandidate;
      if (!candidate || !isBookableAvailabilityCandidate(candidate, durationMinutes)) {
        wx.showToast({ title: "请选择可预约时段", icon: "none" });
        return;
      }
      scheduledAt = new Date(candidate.startsAt);
      availabilityWindowId = candidate.availabilityWindowId;
    } else {
      wx.showToast({ title: this.data.availabilityMessage || "暂无法确认可约时段", icon: "none" });
      return;
    }
    if (!Number.isFinite(scheduledAt.getTime()) || scheduledAt.getTime() <= Date.now() + 15 * 60_000) {
      wx.showToast({ title: "请至少提前 15 分钟预约", icon: "none" });
      return;
    }
    const companion = this.data.companion;
    const candidate = this.data.selectedAvailabilityCandidate;
    if (!companion || !candidate) {
      wx.showToast({ title: "预约信息不完整，请重新选择", icon: "none" });
      return;
    }
    this.setData({
      bookingConfirmationVisible: true,
      bookingBoundaryConfirmed: false,
      bookingAccuracyConfirmed: false,
      bookingPreview: {
        companionName: `${companion.name} · ${companion.role}`,
        serviceTitle: selectedServiceOffering.title,
        serviceIntentText: this.data.selectedServiceIntentLabel,
        deliveryModeText: selectedServiceOffering.deliveryMode === "voice" ? "订单内实时语音" : "订单内文字陪伴",
        durationText: `${durationMinutes} 分钟`,
        priceText: `¥${formatCny(selectedServiceOffering.priceCents)}`,
        scheduleText: `${candidate.dateLabel} ${candidate.timeLabel}–${candidate.endTimeLabel}（北京时间）`
      }
    });
  },
  closeBookingConfirmation() {
    if (this.data.booking) return;
    this.setData({
      bookingConfirmationVisible: false,
      bookingBoundaryConfirmed: false,
      bookingAccuracyConfirmed: false,
      bookingPreview: null
    });
  },
  toggleBookingBoundary() {
    if (this.data.booking) return;
    this.setData({ bookingBoundaryConfirmed: !this.data.bookingBoundaryConfirmed });
  },
  toggleBookingAccuracy() {
    if (this.data.booking) return;
    this.setData({ bookingAccuracyConfirmed: !this.data.bookingAccuracyConfirmed });
  },
  selectServiceIntent(event: any) {
    if (this.data.booking) return;
    const code = String(event.currentTarget.dataset.code || "") as OrderServiceIntentCode;
    const option = SERVICE_INTENT_OPTIONS.find((item) => item.code === code);
    if (!option) return;
    const candidate = this.data.selectedAvailabilityCandidate;
    this.setData({
      selectedServiceIntent: option.code,
      selectedServiceIntentLabel: option.title,
      orderClientRequestId: "",
      canBook: Boolean(candidate),
      bookingButtonText: candidate && this.data.selectedServiceOffering
        ? bookingButtonText(this.data.selectedServiceOffering, candidate)
        : this.data.bookingButtonText
    });
  },
  async confirmBooking() {
    if (!await passCrisisGate("order")) return;
    if (!this.data.bookingBoundaryConfirmed || !this.data.bookingAccuracyConfirmed) {
      wx.showToast({ title: "请确认订单信息与服务边界", icon: "none" });
      return;
    }
    const selectedServiceOffering = this.data.selectedServiceOffering;
    const candidate = this.data.selectedAvailabilityCandidate;
    const serviceIntent = this.data.selectedServiceIntent;
    if (
      !selectedServiceOffering ||
      !candidate ||
      !serviceIntent ||
      !isBookableOffering(selectedServiceOffering) ||
      !isBookableAvailabilityCandidate(candidate, selectedServiceOffering.durationMinutes)
    ) {
      this.closeBookingConfirmation();
      wx.showToast({ title: "服务或时段已变化，请重新选择", icon: "none" });
      return;
    }
    const durationMinutes = selectedServiceOffering.durationMinutes;
    const scheduledAt = new Date(candidate.startsAt);
    const availabilityWindowId = candidate.availabilityWindowId;
    if (!Number.isFinite(scheduledAt.getTime()) || scheduledAt.getTime() <= Date.now() + 15 * 60_000) {
      this.closeBookingConfirmation();
      wx.showToast({ title: "所选时段已临近，请重新选择", icon: "none" });
      return;
    }
    const themeId = this.themeId || selectedServiceOffering?.topicIds?.[0] || "t1";
    const storageKey = pendingOrderStorageKey(
      this.companionId,
      themeId,
      selectedServiceOffering.id,
      availabilityWindowId,
      durationMinutes,
      scheduledAt,
      serviceIntent
    );
    const clientRequestId = this.data.orderClientRequestId || persistedOrderRequestId(storageKey, scheduledAt);
    if (!this.data.orderClientRequestId) this.setData({ orderClientRequestId: clientRequestId });
    this.setData({ booking: true });
    try {
      const order = await api.createOrder({
        companionId: this.companionId,
        themeId,
        durationMinutes,
        scheduledAt: scheduledAt.toISOString(),
        clientRequestId,
        serviceOfferingId: selectedServiceOffering.id,
        availabilityWindowId,
        serviceIntent,
        ...(this.recommendationImpressionId ? { recommendationImpressionId: this.recommendationImpressionId } : {})
      });
      await requestTransactionalSubscriptions(["orderConfirmed", "orderRejected", "orderResponseExpired"]);
      try { wx.removeStorageSync(storageKey); } catch { /* best effort after acknowledged success */ }
      this.setData({
        orderClientRequestId: "",
        bookingConfirmationVisible: false,
        bookingBoundaryConfirmed: false,
        bookingAccuracyConfirmed: false,
        bookingPreview: null
      });
      wx.showToast({ title: "订单已创建", icon: "success" });
      setTimeout(() => wx.navigateTo({ url: `/pages/order/detail?id=${encodeURIComponent(order.id)}` }), 500);
    } catch (error) {
      const apiError = error as ApiError;
      if (await handleCustomerAdultEligibilityError(apiError)) return;
      if (apiError.code === "CRISIS_RESOURCES_MUST_BE_VIEWED") {
        const interventionId = typeof apiError.details?.interventionId === "string"
          ? apiError.details.interventionId
          : undefined;
        openCrisisResources({
          ...(interventionId ? { id: interventionId } : {}),
          source: "order",
          riskCode: "userRequested"
        });
        return;
      }
      const staleAvailabilityCodes = [
        "COMPANION_SLOT_UNAVAILABLE", "AVAILABILITY_WINDOW_UNAVAILABLE", "AVAILABILITY_SLOT_INVALID", "ORDER_SCHEDULE_TOO_SOON"
      ];
      const staleServiceCodes = [
        "SERVICE_OFFERING_UNAVAILABLE", "SERVICE_OFFERING_DURATION_MISMATCH", "SERVICE_OFFERING_THEME_UNSUPPORTED"
      ];
      if (availabilityWindowId && staleAvailabilityCodes.includes(apiError.code || "")) {
        try { wx.removeStorageSync(storageKey); } catch { /* explicit rejection is safe to forget */ }
        this.setData({ orderClientRequestId: "" });
        wx.showToast({
          title: apiError.code === "COMPANION_SLOT_UNAVAILABLE" ? "所选时段刚刚被占用，正在刷新" : "所选时段已更新，正在刷新",
          icon: "none"
        });
        const companion = this.data.companion;
        if (companion && selectedServiceOffering) void this.loadAvailability(companion, selectedServiceOffering);
        return;
      }
      if (staleServiceCodes.includes(apiError.code || "")) {
        try { wx.removeStorageSync(storageKey); } catch { /* explicit rejection is safe to forget */ }
        this.setData({ orderClientRequestId: "" });
        wx.showToast({ title: "所选服务已更新，正在刷新", icon: "none" });
        void this.load();
        return;
      }
      wx.showToast({ title: apiError.message || "创建订单失败", icon: "none" });
    } finally { this.setData({ booking: false }); }
  },
  playVoiceIntro() {
    if (!clientVoiceIntroEnabled()) {
      wx.showToast({ title: "首发仅支持文字介绍", icon: "none" });
      return;
    }
    const url = this.data.publicProfile?.voiceIntroPlaybackUrl || "";
    if (!url.startsWith("https://")) return;
    const player = wx.createInnerAudioContext();
    player.src = url;
    player.onEnded(() => player.destroy());
    player.onError(() => {
      player.destroy();
      wx.showToast({ title: "语音介绍暂时无法播放，请稍后重试", icon: "none" });
    });
    player.play();
  },
  openEmergencyHelp() {
    openCrisisResources({ source: "directEmergencyHelp", riskCode: "userRequested" });
  }
});
