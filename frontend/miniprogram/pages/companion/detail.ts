import { api, ApiError, ensureSession } from "../../utils/api";
import {
  Companion, CompanionAvailabilityCandidate, CompanionAvailabilityResponse, Review, ServiceOffering
} from "../../utils/models";
import { requestTransactionalSubscriptions } from "../../utils/subscription";

type ServiceCatalogStatus = "loading" | "available" | "empty" | "legacy";
type AvailabilityStatus = "loading" | "structured" | "legacy" | "empty" | "unavailable";
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

const VALID_THEME_IDS = ["t1", "t2", "t3", "t4", "t5", "t6"];
const AVAILABILITY_STEP_MS = 30 * 60_000;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60_000;
const WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"];

function bookingDefaults(): { date: string; time: string } {
  const date = new Date(Date.now() + 60 * 60 * 1000);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60 * 1000).toISOString();
  return { date: local.slice(0, 10), time: local.slice(11, 16) };
}

function createOrderRequestId(): string {
  return `order_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}_${Math.random().toString(36).slice(2, 12)}`;
}

const PENDING_ORDER_PREFIX = "talkandtalk.pendingOrder.";

function pendingOrderStorageKey(
  companionId: string,
  themeId: string,
  serviceOfferingId: string | null,
  availabilityWindowId: string | null,
  durationMinutes: number,
  scheduledAt: Date
): string {
  return `${PENDING_ORDER_PREFIX}${encodeURIComponent(companionId)}:${encodeURIComponent(themeId)}:${encodeURIComponent(serviceOfferingId || "legacy")}:${encodeURIComponent(availabilityWindowId || "legacy")}:${durationMinutes}:${scheduledAt.toISOString()}`;
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
  return typeof offering.id === "string"
    && Boolean(offering.id.trim())
    && typeof offering.title === "string"
    && Boolean(offering.title.trim())
    && (offering.deliveryMode === "text" || offering.deliveryMode === "voice")
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
  companion: Companion,
  offering: ServiceOffering | null,
  candidate: Pick<AvailabilitySlot, "timeLabel"> | null = null
): string {
  if (candidate) return `预约 ${candidate.timeLabel} · ¥${offering ? formatCny(offering.priceCents) : companion.pricePerHalfHour}`;
  if (offering) return `预约 ${offering.durationMinutes} 分钟 · ¥${formatCny(offering.priceCents)}`;
  return `预约 30 分钟 · ¥${companion.pricePerHalfHour}`;
}

Page({
  data: {
    companion: null as Companion | null, reviews: [] as Review[], loading: true, error: "", booking: false,
    bookingDate: bookingDefaults().date, bookingTime: bookingDefaults().time,
    orderClientRequestId: "",
    serviceOfferings: [] as ServiceOffering[],
    selectedServiceOffering: null as ServiceOffering | null,
    selectedServiceOfferingId: "",
    serviceCatalogStatus: "loading" as ServiceCatalogStatus,
    serviceCatalogMessage: "",
    availabilityStatus: "loading" as AvailabilityStatus,
    availabilityMessage: "",
    availabilityCandidates: [] as AvailabilitySlot[],
    availabilityDateGroups: [] as AvailabilityDateGroup[],
    selectedAvailabilityCandidate: null as AvailabilitySlot | null,
    selectedAvailabilityCandidateId: "",
    canBook: false,
    bookingButtonText: "加载服务中…",
    rebookingNotice: "",
    trustFacts: [] as TrustFact[],
    canManageFavorites: false,
    isFavorite: false,
    favoriteSaving: false
  },
  companionId: "",
  recommendationImpressionId: "",
  preferredServiceOfferingId: "",
  rebookingRequested: false,
  themeId: "t1",
  availabilityRequestSequence: 0,
  onLoad(query: any) {
    this.companionId = query.id || "";
    this.recommendationImpressionId = query.rid || "";
    this.preferredServiceOfferingId = typeof query.serviceOfferingId === "string"
      ? query.serviceOfferingId.trim()
      : "";
    this.rebookingRequested = query.rebook === "1";
    this.themeId = VALID_THEME_IDS.includes(query.themeId) ? query.themeId : "";
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
      availabilityStatus: "loading",
      availabilityMessage: "",
      availabilityCandidates: [],
      availabilityDateGroups: [],
      selectedAvailabilityCandidate: null,
      selectedAvailabilityCandidateId: "",
      orderClientRequestId: "",
      canBook: false,
      bookingButtonText: "加载服务中…",
      rebookingNotice: this.rebookingRequested ? "正在核对上次服务的当前价格与可约时段…" : "",
      trustFacts: [],
      canManageFavorites: false,
      isFavorite: false,
      favoriteSaving: false
    });
    try {
      await ensureSession();
      const [companion, reviews, user] = await Promise.all([
        api.companion(this.companionId),
        api.reviews(this.companionId),
        api.fetchMe()
      ]);
      const canManageFavorites = user.role === "user";
      const favorites = canManageFavorites
        ? await api.favoriteCompanions().catch(() => ({ items: [] as Companion[] }))
        : { items: [] as Companion[] };
      const isFavorite = canManageFavorites && favorites.items.some((item) => item.id === companion.id);
      if (canManageFavorites) {
        // Opening a currently public detail page is the only write trigger.
        // This private recall record is intentionally fire-and-forget: it must
        // not delay booking, become a recommendation signal, or surface to the
        // companion if the recall endpoint is temporarily unavailable.
        void api.recordRecentlyViewedCompanion(companion.id).catch(() => undefined);
      }
      try {
        const catalog = await api.serviceOfferings(this.companionId);
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
            trustFacts: companionTrustFacts(companion),
            canManageFavorites,
            isFavorite,
            favoriteSaving: false,
            serviceOfferings,
            serviceCatalogStatus: "empty",
            serviceCatalogMessage: catalog.items?.length ? "服务配置暂不可预约，请稍后刷新。" : "该陪伴者暂未开放可预约服务。",
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
          trustFacts: companionTrustFacts(companion),
          canManageFavorites,
          isFavorite,
          favoriteSaving: false,
          serviceOfferings,
          selectedServiceOffering,
          selectedServiceOfferingId: selectedServiceOffering.id,
          serviceCatalogStatus: "available",
          availabilityStatus: "loading",
          availabilityMessage: "正在读取可预约时段…",
          canBook: false,
          bookingButtonText: "加载可约时段…",
          rebookingNotice,
          loading: false
        });
        await this.loadAvailability(companion, selectedServiceOffering);
      } catch {
        if (this.rebookingRequested) {
          this.setData({
            companion,
            reviews: reviews.items || [],
            trustFacts: companionTrustFacts(companion),
            canManageFavorites,
            isFavorite,
            favoriteSaving: false,
            serviceOfferings: [],
            selectedServiceOffering: null,
            selectedServiceOfferingId: "",
            serviceCatalogStatus: "empty",
            serviceCatalogMessage: "暂时无法确认上次服务是否仍在开放，请稍后刷新后再约。",
            availabilityStatus: "unavailable",
            availabilityMessage: "服务目录恢复后，平台会重新读取价格和可约时段。",
            availabilityCandidates: [],
            availabilityDateGroups: [],
            selectedAvailabilityCandidate: null,
            selectedAvailabilityCandidateId: "",
            canBook: false,
            bookingButtonText: "暂无法再次预约",
            rebookingNotice: "再次预约不会复用旧订单；请等待当前服务目录恢复后重新确认。",
            loading: false
          });
          return;
        }
        // Deployment skew or a transient catalog outage must not strand users
        // on a profile that the legacy booking endpoint can still serve.
        this.themeId = this.themeId || "t1";
        this.setData({
          companion,
          reviews: reviews.items || [],
          trustFacts: companionTrustFacts(companion),
          canManageFavorites,
          isFavorite,
          favoriteSaving: false,
          serviceCatalogStatus: "legacy",
          serviceCatalogMessage: "服务目录暂时不可用，已按旧版半小时服务预约。",
          availabilityStatus: "legacy",
          availabilityMessage: "请填写希望的日期和时间，陪伴者确认后为你保留时段。",
          availabilityCandidates: [],
          availabilityDateGroups: [],
          selectedAvailabilityCandidate: null,
          selectedAvailabilityCandidateId: "",
          canBook: true,
          bookingButtonText: bookingButtonText(companion, null),
          loading: false
        });
      }
    } catch (error) { this.setData({ loading: false, error: (error as Error).message || "加载失败" }); }
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
        const times = response.legacyAvailableTimes.filter((time) => time.trim());
        this.setData({
          availabilityStatus: "legacy",
          availabilityMessage: times.length
            ? `常见可约时段：${times.join("、")}。请填写希望的日期和时间，等待确认。`
            : "请填写希望的日期和时间，陪伴者确认后为你保留时段。",
          availabilityCandidates: [],
          availabilityDateGroups: [],
          selectedAvailabilityCandidate: null,
          selectedAvailabilityCandidateId: "",
          canBook: true,
          bookingButtonText: bookingButtonText(companion, offering)
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
    if (!companion || !this.data.canManageFavorites || this.data.favoriteSaving) return;
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
  setBookingDate(event: any) {
    if (this.data.availabilityStatus !== "legacy") return;
    this.setData({ bookingDate: event.detail.value, orderClientRequestId: "" });
  },
  setBookingTime(event: any) {
    if (this.data.availabilityStatus !== "legacy") return;
    this.setData({ bookingTime: event.detail.value, orderClientRequestId: "" });
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
      bookingButtonText: companion ? bookingButtonText(companion, selectedServiceOffering) : "预约服务"
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
    const startsAt = new Date(slot.startsAt);
    const local = shanghaiDateParts(startsAt);
    this.setData({
      selectedAvailabilityCandidate: slot,
      selectedAvailabilityCandidateId: slot.id,
      bookingDate: `${local.year}-${twoDigits(local.month)}-${twoDigits(local.day)}`,
      bookingTime: `${twoDigits(local.hour)}:${twoDigits(local.minute)}`,
      orderClientRequestId: "",
      canBook: true,
      bookingButtonText: companion ? bookingButtonText(companion, offering, slot) : "预约服务"
    });
  },
  async book() {
    if (!this.data.canBook) {
      wx.showToast({ title: this.data.availabilityMessage || this.data.serviceCatalogMessage || "当前暂不可预约", icon: "none" });
      return;
    }
    const selectedServiceOffering = this.data.selectedServiceOffering;
    if (selectedServiceOffering && !isBookableOffering(selectedServiceOffering)) {
      wx.showToast({ title: "所选服务已失效，请重新选择", icon: "none" });
      return;
    }
    const durationMinutes = selectedServiceOffering?.durationMinutes ?? 30;
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
    } else if (this.data.availabilityStatus === "legacy") {
      scheduledAt = new Date(`${this.data.bookingDate}T${this.data.bookingTime}:00`);
    } else {
      wx.showToast({ title: this.data.availabilityMessage || "暂无法确认可约时段", icon: "none" });
      return;
    }
    if (!Number.isFinite(scheduledAt.getTime()) || scheduledAt.getTime() <= Date.now() + 15 * 60_000) {
      wx.showToast({ title: "请至少提前 15 分钟预约", icon: "none" });
      return;
    }
    const themeId = this.themeId || selectedServiceOffering?.topicIds?.[0] || "t1";
    const storageKey = pendingOrderStorageKey(
      this.companionId,
      themeId,
      selectedServiceOffering?.id ?? null,
      availabilityWindowId,
      durationMinutes,
      scheduledAt
    );
    const clientRequestId = this.data.orderClientRequestId || persistedOrderRequestId(storageKey, scheduledAt);
    if (!this.data.orderClientRequestId) this.setData({ orderClientRequestId: clientRequestId });
    this.setData({ booking: true });
    try {
      await api.createOrder({
        companionId: this.companionId,
        themeId,
        durationMinutes,
        scheduledAt: scheduledAt.toISOString(),
        clientRequestId,
        ...(selectedServiceOffering ? { serviceOfferingId: selectedServiceOffering.id } : {}),
        ...(availabilityWindowId ? { availabilityWindowId } : {}),
        ...(this.recommendationImpressionId ? { recommendationImpressionId: this.recommendationImpressionId } : {})
      });
      await requestTransactionalSubscriptions(["orderConfirmed", "orderRejected", "orderResponseExpired"]);
      try { wx.removeStorageSync(storageKey); } catch { /* best effort after acknowledged success */ }
      this.setData({ orderClientRequestId: "" });
      wx.showToast({ title: "订单已创建", icon: "success" });
      setTimeout(() => wx.switchTab({ url: "/pages/orders/index" }), 500);
    } catch (error) {
      const apiError = error as ApiError;
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
  }
});
