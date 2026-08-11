import { api, ApiError, ensureSession } from "../../../utils/api";
import { clientRealtimeVoiceEnabled, clientVoiceSkuEnabled } from "../../../utils/config";
import {
  CreateOwnServiceOfferingInput, OwnServiceOffering, RecommendationTopic
} from "../../../utils/models";

type AccessState = "loading" | "ready" | "ineligible" | "error";
type TopicChoice = RecommendationTopic & { selected: boolean };
type DisplayOffering = OwnServiceOffering & {
  priceText: string;
  deliveryModeText: string;
  statusText: string;
  topicText: string;
  canMoveUp: boolean;
  canMoveDown: boolean;
};

const DURATION_OPTIONS = [30, 60, 90, 120, 150, 180, 210, 240];
const MAX_TOPIC_COUNT = 6;
const SERVICE_OFFERING_PAGE_SIZE = 20;
const MAX_SERVICE_OFFERINGS = 50;

function formatCny(priceCents: number): string {
  const yuan = priceCents / 100;
  return Number.isInteger(yuan) ? String(yuan) : yuan.toFixed(2);
}

function parsePriceCents(value: string): number | null {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const [yuanPart, decimalPart = ""] = value.split(".");
  const cents = Number(yuanPart) * 100 + Number(decimalPart.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents >= 100 && cents <= 2_000_000 ? cents : null;
}

function topicChoices(topics: RecommendationTopic[], selectedTopicIds: string[]): TopicChoice[] {
  const selected = new Set(selectedTopicIds);
  return topics.map((topic) => ({ ...topic, selected: selected.has(topic.id) }));
}

function displayOfferings(items: OwnServiceOffering[], topics: RecommendationTopic[]): DisplayOffering[] {
  const topicNames = new Map(topics.map((topic) => [topic.id, topic.name]));
  return items.map((item, index) => ({
    ...item,
    priceText: `¥${formatCny(item.priceCents)}`,
    deliveryModeText: item.deliveryMode === "voice" ? "语音服务" : "文字服务",
    statusText: item.isActive ? "已上架" : "已暂停",
    topicText: item.topicIds.map((id) => topicNames.get(id) || id).join(" · ") || "未关联主题",
    canMoveUp: index > 0,
    canMoveDown: index < items.length - 1
  }));
}

function errorMessage(error: unknown, fallback: string): string {
  const apiError = error as ApiError;
  const messages: Record<string, string> = {
    COMPANION_PROFILE_NOT_FOUND: "当前账号尚未绑定陪伴者资料，请联系平台完成入驻配置。",
    COMPANION_OWNER_NOT_ELIGIBLE: "完成实名认证并通过陪伴者资料审核后，才可管理服务商品。",
    SERVICE_OFFERING_CONTENT_REQUIRES_REVISION: "服务标题或介绍未通过公开内容审核，请修改后再保存。",
    INVALID_SERVICE_OFFERING_DURATION: "服务时长需为 30 至 240 分钟之间的半小时档位。",
    INVALID_SERVICE_OFFERING_PRICE: "价格应在 ¥1.00 至 ¥20,000.00 之间。",
    SERVICE_OFFERING_LIMIT_REACHED: "每位陪伴者最多保留 50 项服务，请编辑或复用现有商品。",
    SERVICE_OFFERING_NOT_FOUND: "该服务商品已不存在或不属于当前账号，请刷新后重试。",
    COMMERCIAL_SURFACE_TEXT_ONLY: "首发仅开放文字服务，暂不能上架语音商品。"
  };
  return (apiError.code && messages[apiError.code]) || apiError.message || fallback;
}

Page({
  data: {
    loading: true,
    accessState: "loading" as AccessState,
    loadError: "",
    offerings: [] as DisplayOffering[],
    offeringPage: 1,
    offeringTotalPages: 1,
    offeringTotal: 0,
    offeringsLoadingMore: false,
    offeringsLoadMoreError: "",
    topicChoices: [] as TopicChoice[],
    topicsState: "loading" as "loading" | "available" | "empty" | "error",
    topicsError: "",
    durationOptions: DURATION_OPTIONS,
    editorVisible: false,
    editingId: "",
    formTitle: "",
    formDescription: "",
    formDeliveryMode: "text" as "text" | "voice",
    voiceDeliveryModeAvailable: clientVoiceSkuEnabled(),
    formDurationIndex: 0,
    formPriceYuan: "",
    formTopicIds: [] as string[],
    formActive: false,
    formSortOrder: 0,
    formError: "",
    saving: false,
    changingOfferingId: "",
    reorderingId: ""
  },
  onShow() { void this.load(); },
  onPullDownRefresh() { void this.load(true); },
  async load(stopRefresh = false) {
    this.setData({ loading: true, accessState: "loading", loadError: "", topicsState: "loading", topicsError: "" });
    try {
      await ensureSession();
      const [catalog, topics] = await Promise.all([
        api.ownServiceOfferings({ page: 1, pageSize: SERVICE_OFFERING_PAGE_SIZE }),
        api.recommendationTopics()
          .then((response) => ({ ...response, available: true }))
          .catch(() => ({ items: [] as RecommendationTopic[], available: false }))
      ]);
      const availableTopics = topics.items || [];
      this.setData({
        offerings: displayOfferings(catalog.items || [], availableTopics),
        offeringPage: catalog.pagination.page,
        offeringTotalPages: catalog.pagination.totalPages,
        offeringTotal: catalog.pagination.total,
        offeringsLoadingMore: false,
        offeringsLoadMoreError: "",
        topicChoices: topicChoices(availableTopics, this.data.formTopicIds),
        topicsState: topics.available ? (availableTopics.length ? "available" : "empty") : "error",
        topicsError: topics.available ? "" : "服务主题暂时无法读取；这不代表平台没有主题，保存时不会擅自清除已有主题。",
        loading: false,
        accessState: "ready"
      });
    } catch (error) {
      const apiError = error as ApiError;
      const ineligible = apiError.code === "COMPANION_PROFILE_NOT_FOUND" || apiError.code === "COMPANION_OWNER_NOT_ELIGIBLE";
      this.setData({
        loading: false,
        accessState: ineligible ? "ineligible" : "error",
        loadError: errorMessage(error, "服务商品暂时无法加载，请稍后重试。")
      });
    } finally {
      if (stopRefresh) wx.stopPullDownRefresh();
    }
  },
  retry() { void this.load(); },
  async loadMoreOfferings() {
    if (this.data.offeringsLoadingMore || this.data.offeringPage >= this.data.offeringTotalPages) return;
    const page = this.data.offeringPage + 1;
    this.setData({ offeringsLoadingMore: true, offeringsLoadMoreError: "" });
    try {
      const response = await api.ownServiceOfferings({ page, pageSize: SERVICE_OFFERING_PAGE_SIZE });
      const byId = new Map<string, OwnServiceOffering>(
        this.data.offerings.map((item) => [item.id, item])
      );
      (response.items || []).forEach((item) => byId.set(item.id, item));
      this.setData({
        offerings: displayOfferings([...byId.values()], this.data.topicChoices),
        offeringPage: response.pagination.page,
        offeringTotalPages: response.pagination.totalPages,
        offeringTotal: response.pagination.total,
        offeringsLoadMoreError: ""
      });
    } catch (error) {
      this.setData({
        offeringsLoadMoreError: errorMessage(
          error,
          "更多服务商品暂时无法读取；已加载商品仍保留。"
        )
      });
    } finally {
      this.setData({ offeringsLoadingMore: false });
    }
  },
  async retryTopics() {
    if (this.data.topicsState === "loading") return;
    this.setData({ topicsState: "loading", topicsError: "" });
    try {
      const response = await api.recommendationTopics();
      const topics = response.items || [];
      this.setData({
        topicChoices: topicChoices(topics, this.data.formTopicIds),
        topicsState: topics.length ? "available" : "empty",
        topicsError: ""
      });
    } catch {
      this.setData({
        topicChoices: [],
        topicsState: "error",
        topicsError: "服务主题暂时无法读取；这不代表平台没有主题，保存时不会擅自清除已有主题。"
      });
    }
  },
  openAvailabilityWindows() { wx.navigateTo({ url: "/pages/companion/availability/index" }); },
  openCreate() {
    if (this.data.offeringTotal >= MAX_SERVICE_OFFERINGS) {
      wx.showToast({ title: `每位陪伴者最多保留 ${MAX_SERVICE_OFFERINGS} 项服务，请编辑现有商品`, icon: "none" });
      return;
    }
    const highestSortOrder = this.data.offerings.reduce((highest, item) => Math.max(highest, item.sortOrder), 0);
    this.setData({
      editorVisible: true,
      editingId: "",
      formTitle: "",
      formDescription: "",
      formDeliveryMode: "text",
      formDurationIndex: 0,
      formPriceYuan: "",
      formTopicIds: [],
      formActive: false,
      formSortOrder: Math.min(9_999, highestSortOrder + 100),
      formError: "",
      topicChoices: topicChoices(this.data.topicChoices, [])
    });
  },
  editOffering(event: any) {
    const id = event.currentTarget.dataset.id as string;
    const offering = this.data.offerings.find((item) => item.id === id);
    if (!offering) return;
    const durationIndex = Math.max(0, DURATION_OPTIONS.indexOf(offering.durationMinutes));
    this.setData({
      editorVisible: true,
      editingId: offering.id,
      formTitle: offering.title,
      formDescription: offering.description || "",
      formDeliveryMode: offering.deliveryMode === "voice" && clientVoiceSkuEnabled() ? "voice" : "text",
      formDurationIndex: durationIndex,
      formPriceYuan: formatCny(offering.priceCents),
      formTopicIds: offering.topicIds,
      formActive: offering.isActive,
      formSortOrder: offering.sortOrder,
      formError: "",
      topicChoices: topicChoices(this.data.topicChoices, offering.topicIds)
    });
  },
  closeEditor() {
    if (this.data.saving) return;
    this.setData({ editorVisible: false, formError: "" });
  },
  setFormTitle(event: any) { this.setData({ formTitle: event.detail.value }); },
  setFormDescription(event: any) { this.setData({ formDescription: event.detail.value }); },
  setFormDeliveryMode(event: any) {
    const deliveryMode = event.currentTarget.dataset.mode === "voice" ? "voice" : "text";
    if (deliveryMode === "voice" && !clientVoiceSkuEnabled()) {
      wx.showToast({ title: "首发仅开放文字服务", icon: "none" });
      return;
    }
    this.setData({ formDeliveryMode: deliveryMode });
  },
  setFormDuration(event: any) {
    const index = Number(event.detail.value);
    this.setData({ formDurationIndex: DURATION_OPTIONS[index] ? index : 0 });
  },
  setFormPrice(event: any) { this.setData({ formPriceYuan: event.detail.value }); },
  setFormActive(event: any) { this.setData({ formActive: Boolean(event.detail.value) }); },
  toggleFormTopic(event: any) {
    const id = event.currentTarget.dataset.id as string;
    const selected = this.data.formTopicIds.includes(id)
      ? this.data.formTopicIds.filter((topicId) => topicId !== id)
      : [...this.data.formTopicIds, id];
    if (selected.length > MAX_TOPIC_COUNT) {
      wx.showToast({ title: `最多关联 ${MAX_TOPIC_COUNT} 个主题`, icon: "none" });
      return;
    }
    this.setData({
      formTopicIds: selected,
      topicChoices: topicChoices(this.data.topicChoices, selected)
    });
  },
  async saveEditor() {
    if (this.data.saving) return;
    const title = this.data.formTitle.trim();
    const description = this.data.formDescription.trim();
    const priceCents = parsePriceCents(String(this.data.formPriceYuan).trim());
    const durationMinutes = DURATION_OPTIONS[this.data.formDurationIndex];
    if (!title) {
      this.setData({ formError: "请填写服务名称。" });
      return;
    }
    if (!priceCents) {
      this.setData({ formError: "价格应为 ¥1.00 至 ¥20,000.00，最多保留两位小数。" });
      return;
    }
    if (!durationMinutes) {
      this.setData({ formError: "请选择服务时长。" });
      return;
    }
    if (this.data.formDeliveryMode === "voice" && !clientVoiceSkuEnabled()) {
      this.setData({ formError: "首发仅开放文字服务，暂不能保存语音商品。" });
      return;
    }

    const payload: CreateOwnServiceOfferingInput = {
      title,
      description: description || null,
      deliveryMode: this.data.formDeliveryMode,
      durationMinutes,
      priceCents,
      topicIds: this.data.formTopicIds,
      isActive: this.data.formActive,
      sortOrder: this.data.formSortOrder
    };
    this.setData({ saving: true, formError: "" });
    try {
      if (this.data.editingId) await api.updateOwnServiceOffering(this.data.editingId, payload);
      else await api.createOwnServiceOffering(payload);
      this.setData({ editorVisible: false });
      wx.showToast({ title: this.data.formActive ? "服务已保存并上架" : "服务草稿已保存", icon: "success" });
      await this.load();
    } catch (error) {
      const message = errorMessage(error, "保存失败，请稍后重试。")
      this.setData({ formError: message });
      wx.showToast({ title: message, icon: "none" });
    } finally {
      this.setData({ saving: false });
    }
  },
  async toggleOfferingActive(event: any) {
    const id = event.currentTarget.dataset.id as string;
    const offering = this.data.offerings.find((item) => item.id === id);
    if (!offering || this.data.changingOfferingId) return;
    if (!offering.isActive && offering.deliveryMode === "voice" && !clientVoiceSkuEnabled()) {
      wx.showToast({ title: "首发仅开放文字服务，历史语音服务不能上架", icon: "none" });
      return;
    }
    const confirmation = await new Promise<any>((resolve) => wx.showModal({
      title: offering.isActive ? "暂停上架" : "上架服务",
      content: offering.isActive
        ? "暂停后客户将不能新下单；已创建的订单仍保留原有服务快照。"
        : "上架后客户可在你的公开资料中选择此项服务。",
      confirmText: offering.isActive ? "确认暂停" : "确认上架",
      success: resolve
    }));
    if (!confirmation.confirm) return;
    this.setData({ changingOfferingId: id });
    try {
      await api.updateOwnServiceOffering(id, { isActive: !offering.isActive });
      wx.showToast({ title: offering.isActive ? "服务已暂停" : "服务已上架", icon: "success" });
      await this.load();
    } catch (error) {
      wx.showToast({ title: errorMessage(error, "状态更新失败，请稍后重试。"), icon: "none" });
    } finally {
      this.setData({ changingOfferingId: "" });
    }
  },
  async moveOffering(event: any) {
    const id = event.currentTarget.dataset.id as string;
    const direction = Number(event.currentTarget.dataset.direction);
    const currentIndex = this.data.offerings.findIndex((item) => item.id === id);
    const nextIndex = currentIndex + direction;
    if (this.data.reorderingId || currentIndex < 0 || nextIndex < 0 || nextIndex >= this.data.offerings.length) return;
    if (this.data.offerings.length < this.data.offeringTotal) {
      wx.showToast({ title: "请先加载全部服务商品，再调整整体展示顺序", icon: "none" });
      return;
    }

    const reordered = [...this.data.offerings];
    const [moved] = reordered.splice(currentIndex, 1);
    reordered.splice(nextIndex, 0, moved);
    this.setData({ reorderingId: id });
    try {
      // Assign evenly spaced positions to the whole ordered view. Existing
      // early entries may all have the same default position, so merely
      // swapping two numbers would not reliably change their public order.
      await Promise.all(reordered.map((offering, index) => {
        const sortOrder = Math.floor(((index + 1) * 10_000) / (reordered.length + 1));
        return offering.sortOrder === sortOrder
          ? Promise.resolve()
          : api.updateOwnServiceOffering(offering.id, { sortOrder });
      }));
      wx.showToast({ title: "展示顺序已更新", icon: "success" });
      await this.load();
    } catch (error) {
      wx.showToast({ title: errorMessage(error, "排序保存失败，已为你刷新当前顺序。"), icon: "none" });
      await this.load();
    } finally {
      this.setData({ reorderingId: "" });
    }
  }
});
