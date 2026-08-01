import { api, ensureSession, logout } from "../../utils/api";
import {
  AuthUser, AvailabilityReminderChannel, Companion, FavoriteCompanion, Notification, RecommendationCompanionExclusion, RecommendationPreference, RecommendationTopic, USER_GENDERS, UserGender
} from "../../utils/models";
import { openLegalDocument, withdrawLegalConsent } from "../../utils/privacy";
import { requestTransactionalSubscriptions } from "../../utils/subscription";
import { openNotificationDestination } from "../../utils/notification-router";

const GENDER_LABELS: Record<UserGender, string> = { female: "女", male: "男" };
const GENDER_OPTIONS: Array<{ value: UserGender | ""; label: string }> = [
  { value: "", label: "暂不透露" },
  ...USER_GENDERS.map((gender) => ({ value: gender, label: GENDER_LABELS[gender] }))
];
const PREFERRED_TIME_SLOTS = ["08:00", "12:00", "18:00", "21:00", "23:00"];
type DisplayTopic = RecommendationTopic & { selected: boolean };
type DisplayTimeSlot = { value: string; selected: boolean };
type ProfileResourceState = "loading" | "available" | "empty" | "error";

function displayTopics(topics: RecommendationTopic[], selectedTopicIds: string[]): DisplayTopic[] {
  const selected = new Set(selectedTopicIds);
  return topics.map((topic) => ({ ...topic, selected: selected.has(topic.id) }));
}

function displayTimeSlots(selectedTimeSlots: string[]): DisplayTimeSlot[] {
  const selected = new Set(selectedTimeSlots);
  return PREFERRED_TIME_SLOTS.map((value) => ({ value, selected: selected.has(value) }));
}

Page({
  data: {
    user: null as AuthUser | null, displayName: "", gender: "" as UserGender | "", genderLabel: "暂不透露",
    genderLabels: GENDER_OPTIONS.map((option) => option.label), genderIndex: 0, notifications: [] as Notification[],
    unreadNotificationCount: 0, notificationState: "loading" as ProfileResourceState, notificationError: "",
    unreadNotificationState: "loading" as ProfileResourceState, unreadNotificationError: "",
    markingNotificationsRead: false, profileLoading: true, profileError: "", saving: false,
    recommendationPreferences: null as RecommendationPreference | null,
    recommendationSettingsState: "loading" as ProfileResourceState, recommendationSettingsError: "",
    recommendationTopics: [] as DisplayTopic[], recommendationTopicIds: [] as string[],
    recommendationCity: "", recommendationMaxPrice: "", recommendationTimeSlots: [] as string[],
    recommendationTimeOptions: displayTimeSlots([]), recommendationSaving: false,
    hasCompanionProfile: false,
    companionProfileState: "loading" as ProfileResourceState,
    companionProfileError: "",
    favoriteCompanions: [] as FavoriteCompanion[],
    favoriteCompanionsState: "loading" as ProfileResourceState,
    favoriteCompanionsError: "",
    favoriteCompanionsPage: 1,
    favoriteCompanionsTotalPages: 1,
    favoriteCompanionsTotal: 0,
    favoriteCompanionsLoadingMore: false,
    favoriteCompanionsLoadMoreError: "",
    favoriteReminderSavingId: "",
    availabilityReminderChannel: null as AvailabilityReminderChannel | null,
    availabilityReminderChannelState: "loading" as ProfileResourceState,
    recentlyViewedCompanions: [] as Companion[],
    recentViewsState: "loading" as ProfileResourceState,
    recentViewsError: "",
    clearingRecentViews: false,
    excludedRecommendationCompanions: [] as RecommendationCompanionExclusion[],
    recommendationExclusionsUnavailable: false,
    recommendationExclusionsPage: 1,
    recommendationExclusionsTotalPages: 1,
    recommendationExclusionsTotal: 0,
    recommendationExclusionsLoadingMore: false,
    recommendationExclusionsLoadMoreError: "",
    recommendationExclusionSavingId: ""
  },
  onShow() { void this.load(); },
  async load() {
    this.setData({
      profileLoading: true,
      profileError: "",
      notifications: [],
      unreadNotificationCount: 0,
      notificationState: "loading",
      notificationError: "",
      unreadNotificationState: "loading",
      unreadNotificationError: "",
      recommendationPreferences: null,
      recommendationTopics: [],
      recommendationSettingsState: "loading",
      recommendationSettingsError: "",
      hasCompanionProfile: false,
      companionProfileState: "loading",
      companionProfileError: "",
      favoriteCompanions: [],
      favoriteCompanionsState: "loading",
      favoriteCompanionsError: "",
      favoriteReminderSavingId: "",
      availabilityReminderChannel: null,
      availabilityReminderChannelState: "loading",
      recentlyViewedCompanions: [],
      recentViewsState: "loading",
      recentViewsError: "",
      clearingRecentViews: false,
      excludedRecommendationCompanions: [],
      recommendationExclusionsUnavailable: false,
      recommendationExclusionsPage: 1,
      recommendationExclusionsTotalPages: 1,
      recommendationExclusionsTotal: 0,
      recommendationExclusionsLoadingMore: false,
      recommendationExclusionsLoadMoreError: "",
      recommendationExclusionSavingId: ""
    });
    try {
      await ensureSession();
      const user = await api.fetchMe();
      const [notifications, unread, preference, topics, ownCompanion, favorites, reminderChannel, recentViews, exclusions] = await Promise.all([
        api.notifications()
          .then((response) => ({ ...response, available: true }))
          .catch(() => ({ items: [] as Notification[], available: false })),
        api.notificationUnreadCount()
          .then((response) => ({ ...response, available: true }))
          .catch(() => ({ count: 0, available: false })),
        api.recommendationPreferences()
          .then((value) => ({ value, available: true }))
          .catch(() => ({ value: null as RecommendationPreference | null, available: false })),
        api.recommendationTopics()
          .then((response) => ({ ...response, available: true }))
          .catch(() => ({ items: [] as RecommendationTopic[], available: false })),
        user.role === "companion"
          ? api.ownCompanion()
            .then(() => ({ value: true, available: true }))
            .catch(() => ({ value: false, available: false }))
          : Promise.resolve({ value: false, available: true }),
        user.role === "user"
          ? api.favoriteCompanions({ page: 1, pageSize: 10 })
            .then((response) => ({ ...response, available: true }))
            .catch(() => ({ items: [] as FavoriteCompanion[], pagination: { page: 1, pageSize: 10, total: 0, totalPages: 0 }, available: false }))
          : Promise.resolve({ items: [] as FavoriteCompanion[], pagination: { page: 1, pageSize: 10, total: 0, totalPages: 0 }, available: true }),
        user.role === "user"
          ? api.availabilityReminderChannel()
            .then((value) => ({ value, available: true }))
            .catch(() => ({ value: null as AvailabilityReminderChannel | null, available: false }))
          : Promise.resolve({ value: null as AvailabilityReminderChannel | null, available: true }),
        user.role === "user"
          ? api.recentlyViewedCompanions()
            .then((response) => ({ ...response, available: true }))
            .catch(() => ({ items: [] as Companion[], available: false }))
          : Promise.resolve({ items: [] as Companion[], available: true }),
        user.role === "user"
          ? api.recommendationCompanionExclusions({ page: 1, pageSize: 10 })
            .then((response) => ({ ...response, unavailable: false }))
            .catch(() => ({
              items: [] as RecommendationCompanionExclusion[],
              pagination: { page: 1, pageSize: 10, total: 0, totalPages: 0 },
              unavailable: true
            }))
          : Promise.resolve({
              items: [] as RecommendationCompanionExclusion[],
              pagination: { page: 1, pageSize: 10, total: 0, totalPages: 0 },
              unavailable: false
            })
      ]);
      const genderIndex = user.profile?.gender
        ? Math.max(0, GENDER_OPTIONS.findIndex((option) => option.value === user.profile?.gender))
        : 0;
      this.setData({
        user,
        displayName: user.profile?.displayName || "",
        gender: user.profile?.gender || "",
        genderLabel: GENDER_OPTIONS[genderIndex].label,
        genderIndex,
        notifications: notifications.items || [],
        unreadNotificationCount: unread.count || 0,
        notificationState: notifications.available
          ? (notifications.items || []).length ? "available" : "empty"
          : "error",
        notificationError: notifications.available
          ? ""
          : "最近通知暂时无法读取。这不代表没有新通知。",
        unreadNotificationState: unread.available ? "available" : "error",
        unreadNotificationError: unread.available
          ? ""
          : "通知未读数量暂时无法核对。这不代表没有未读通知。",
        recommendationPreferences: preference.value,
        recommendationTopics: displayTopics(topics.items || [], preference.value?.topicIds || []),
        recommendationTopicIds: preference.value?.topicIds || [],
        recommendationCity: preference.value?.city || "",
        recommendationMaxPrice: preference.value?.maxPricePerHalfHour ? String(preference.value.maxPricePerHalfHour) : "",
        recommendationTimeSlots: preference.value?.preferredTimeSlots || [],
        recommendationTimeOptions: displayTimeSlots(preference.value?.preferredTimeSlots || []),
        recommendationSettingsState: preference.available && topics.available ? "available" : "error",
        recommendationSettingsError: preference.available && topics.available
          ? ""
          : "推荐偏好暂时无法完整读取；为避免覆盖原设置，编辑入口已关闭。",
        hasCompanionProfile: ownCompanion.value,
        companionProfileState: ownCompanion.available ? "available" : "error",
        companionProfileError: ownCompanion.available
          ? ""
          : "陪伴者身份状态暂时无法核对；这不代表尚未入驻。",
        favoriteCompanions: favorites.items || [],
        favoriteCompanionsState: favorites.available
          ? (favorites.items || []).length ? "available" : "empty"
          : "error",
        favoriteCompanionsError: favorites.available
          ? ""
          : "私人书签暂时无法读取；这不代表还没有保存记录。",
        favoriteCompanionsPage: favorites.pagination.page,
        favoriteCompanionsTotalPages: favorites.pagination.totalPages,
        favoriteCompanionsTotal: favorites.pagination.total,
        favoriteCompanionsLoadMoreError: "",
        availabilityReminderChannel: reminderChannel.value,
        availabilityReminderChannelState: reminderChannel.available ? "available" : "error",
        recentlyViewedCompanions: recentViews.items || [],
        recentViewsState: recentViews.available
          ? (recentViews.items || []).length ? "available" : "empty"
          : "error",
        recentViewsError: recentViews.available
          ? ""
          : "最近浏览暂时无法读取；这不代表没有历史记录。",
        excludedRecommendationCompanions: exclusions.items || [],
        recommendationExclusionsUnavailable: exclusions.unavailable,
        recommendationExclusionsPage: exclusions.pagination.page,
        recommendationExclusionsTotalPages: exclusions.pagination.totalPages,
        recommendationExclusionsTotal: exclusions.pagination.total,
        recommendationExclusionsLoadMoreError: "",
        profileLoading: false
      });
    } catch (error) {
      const message = (error as Error).message || "个人中心暂时无法加载";
      this.setData({ profileLoading: false, profileError: message, user: null });
      wx.showToast({ title: message, icon: "none" });
    }
  },
  async loadMoreFavoriteCompanions() {
    if (
      this.data.favoriteCompanionsLoadingMore
      || this.data.favoriteCompanionsPage >= this.data.favoriteCompanionsTotalPages
    ) return;
    const page = this.data.favoriteCompanionsPage + 1;
    this.setData({ favoriteCompanionsLoadingMore: true, favoriteCompanionsLoadMoreError: "" });
    try {
      const response = await api.favoriteCompanions({ page, pageSize: 10 });
      const byId = new Map(this.data.favoriteCompanions.map((item) => [item.id, item]));
      (response.items || []).forEach((item) => byId.set(item.id, item));
      this.setData({
        favoriteCompanions: [...byId.values()],
        favoriteCompanionsState: byId.size ? "available" : "empty",
        favoriteCompanionsPage: response.pagination.page,
        favoriteCompanionsTotalPages: response.pagination.totalPages,
        favoriteCompanionsTotal: response.pagination.total,
        favoriteCompanionsLoadMoreError: ""
      });
    } catch (error) {
      this.setData({ favoriteCompanionsLoadMoreError: (error as Error).message || "更多私人书签暂时无法读取；已加载书签仍保留。" });
    } finally {
      this.setData({ favoriteCompanionsLoadingMore: false });
    }
  },
  async loadMoreRecommendationExclusions() {
    if (
      this.data.recommendationExclusionsLoadingMore
      || this.data.recommendationExclusionsPage >= this.data.recommendationExclusionsTotalPages
    ) return;
    const page = this.data.recommendationExclusionsPage + 1;
    this.setData({ recommendationExclusionsLoadingMore: true, recommendationExclusionsLoadMoreError: "" });
    try {
      const response = await api.recommendationCompanionExclusions({ page, pageSize: 10 });
      const byCompanionId = new Map(
        this.data.excludedRecommendationCompanions.map((item) => [item.companionId, item])
      );
      (response.items || []).forEach((item) => byCompanionId.set(item.companionId, item));
      this.setData({
        excludedRecommendationCompanions: [...byCompanionId.values()],
        recommendationExclusionsPage: response.pagination.page,
        recommendationExclusionsTotalPages: response.pagination.totalPages,
        recommendationExclusionsTotal: response.pagination.total,
        recommendationExclusionsLoadMoreError: ""
      });
    } catch (error) {
      this.setData({
        recommendationExclusionsLoadMoreError:
          (error as Error).message || "更多停止推荐记录暂时无法读取；已加载记录仍保留。"
      });
    } finally {
      this.setData({ recommendationExclusionsLoadingMore: false });
    }
  },
  setDisplayName(event: any) { this.setData({ displayName: event.detail.value }); },
  setGender(event: any) {
    const genderIndex = Number(event.detail.value);
    const option = GENDER_OPTIONS[genderIndex] || GENDER_OPTIONS[0];
    this.setData({ gender: option.value, genderLabel: option.label, genderIndex: GENDER_OPTIONS.indexOf(option) });
  },
  async setPersonalization(event: any) {
    if (this.data.recommendationSettingsState !== "available") return;
    const current = this.data.recommendationPreferences;
    if (!current) return;
    const personalizationEnabled = Boolean(event.detail.value);
    this.setData({ recommendationPreferences: { ...current, personalizationEnabled } });
    await this.saveRecommendations();
  },
  toggleRecommendationTopic(event: any) {
    const id = event.currentTarget.dataset.id as string;
    const selected = this.data.recommendationTopicIds.includes(id)
      ? this.data.recommendationTopicIds.filter((topicId) => topicId !== id)
      : [...this.data.recommendationTopicIds, id];
    if (selected.length > 6) {
      wx.showToast({ title: "最多选择 6 个偏好主题", icon: "none" });
      return;
    }
    this.setData({
      recommendationTopicIds: selected,
      recommendationTopics: displayTopics(this.data.recommendationTopics, selected)
    });
  },
  setRecommendationCity(event: any) { this.setData({ recommendationCity: event.detail.value }); },
  setRecommendationMaxPrice(event: any) { this.setData({ recommendationMaxPrice: event.detail.value }); },
  toggleRecommendationTime(event: any) {
    const value = event.currentTarget.dataset.value as string;
    const selected = this.data.recommendationTimeSlots.includes(value)
      ? this.data.recommendationTimeSlots.filter((time) => time !== value)
      : [...this.data.recommendationTimeSlots, value];
    this.setData({ recommendationTimeSlots: selected, recommendationTimeOptions: displayTimeSlots(selected) });
  },
  async saveRecommendations() {
    if (this.data.recommendationSettingsState !== "available") return;
    const current = this.data.recommendationPreferences;
    if (!current) return;
    const price = this.data.recommendationMaxPrice.trim() ? Number(this.data.recommendationMaxPrice) : null;
    if (price !== null && (!Number.isInteger(price) || price < 1)) {
      wx.showToast({ title: "预算请输入正整数", icon: "none" });
      return;
    }
    this.setData({ recommendationSaving: true });
    try {
      const preference = await api.updateRecommendationPreferences({
        personalizationEnabled: current.personalizationEnabled,
        topicIds: this.data.recommendationTopicIds,
        city: this.data.recommendationCity.trim() || null,
        maxPricePerHalfHour: price,
        preferredTimeSlots: this.data.recommendationTimeSlots
      });
      this.setData({
        recommendationPreferences: preference,
        recommendationTopics: displayTopics(this.data.recommendationTopics, preference.topicIds),
        recommendationTopicIds: preference.topicIds,
        recommendationCity: preference.city || "",
        recommendationMaxPrice: preference.maxPricePerHalfHour ? String(preference.maxPricePerHalfHour) : "",
        recommendationTimeSlots: preference.preferredTimeSlots,
        recommendationTimeOptions: displayTimeSlots(preference.preferredTimeSlots)
      });
      wx.showToast({ title: "推荐设置已保存", icon: "success" });
    } catch (error) {
      wx.showToast({ title: (error as Error).message || "保存失败", icon: "none" });
    } finally {
      this.setData({ recommendationSaving: false });
    }
  },
  async deleteRecommendationTag(event: any) {
    const id = event.currentTarget.dataset.id as string;
    try {
      await api.deleteRecommendationTag(id);
      const preference = await api.recommendationPreferences();
      this.setData({ recommendationPreferences: preference });
      wx.showToast({ title: "已删除该行为标签", icon: "success" });
    } catch (error) {
      wx.showToast({ title: (error as Error).message || "删除失败", icon: "none" });
    }
  },
  async saveProfile() {
    this.setData({ saving: true });
    try {
      const user = await api.updateMe({ displayName: this.data.displayName.trim() || undefined, gender: this.data.gender || null });
      this.setData({ user, genderLabel: this.data.gender ? GENDER_LABELS[this.data.gender] : "暂不透露" });
      wx.showToast({ title: "资料已保存", icon: "success" });
    } catch (error) { wx.showToast({ title: (error as Error).message || "保存失败", icon: "none" }); }
    finally { this.setData({ saving: false }); }
  },
  openCompanionWorkbench() { wx.navigateTo({ url: "/pages/companion/workbench/index" }); },
  openCompanionOnboarding() { wx.navigateTo({ url: "/pages/companion/onboarding/index" }); },
  openSafetyCenter() { wx.navigateTo({ url: "/pages/safety/index" }); },
  openAccountCenter() { wx.navigateTo({ url: "/pages/account/index" }); },
  openNotificationCenter() { wx.navigateTo({ url: "/pages/notifications/index" }); },
  openSupportCenter() { wx.navigateTo({ url: "/pages/support/index" }); },
  openFavoriteCompanion(event: any) {
    const id = String(event.currentTarget.dataset.id || "");
    if (!id) return;
    wx.navigateTo({ url: `/pages/companion/detail?id=${encodeURIComponent(id)}` });
  },
  stopFavoriteReminderTap() {},
  async setFavoriteAvailabilityReminder(event: any) {
    const id = String(event.currentTarget.dataset.id || "");
    const enabled = Boolean(event.detail.value);
    const favorite = this.data.favoriteCompanions.find((item) => item.id === id);
    if (this.data.favoriteCompanionsState !== "available" || !id || !favorite || this.data.favoriteReminderSavingId) return;

    let subscriptionGrantId: string | undefined;
    if (enabled) {
      if (!this.data.availabilityReminderChannel?.available) {
        wx.showToast({
          title: this.data.availabilityReminderChannel?.message || "可约提醒通道当前不可用",
          icon: "none"
        });
        this.setData({ favoriteCompanions: [...this.data.favoriteCompanions] });
        return;
      }
      const authorization = await requestTransactionalSubscriptions(["availabilityReminder"]);
      subscriptionGrantId = authorization.grants.find((grant) => grant.templateKey === "availabilityReminder")?.grantId;
      if (!subscriptionGrantId) {
        // Re-render the controlled switch rather than leaving a visual state
        // that would imply a reminder can be sent without a real grant.
        this.setData({ favoriteCompanions: [...this.data.favoriteCompanions] });
        wx.showToast({ title: "未获得微信提醒授权，未开启", icon: "none" });
        return;
      }
    }

    this.setData({ favoriteReminderSavingId: id });
    try {
      const preference = await api.setFavoriteAvailabilityReminder(id, {
        enabled,
        ...(subscriptionGrantId ? { subscriptionGrantId } : {})
      });
      this.setData({
        favoriteCompanions: this.data.favoriteCompanions.map((item) => item.id === id ? {
          ...item,
          availabilityReminderEnabled: preference.enabled,
          availabilityReminderUpdatedAt: preference.updatedAt,
          availabilityReminderMinimumIntervalHours: preference.minimumIntervalHours
        } : item)
      });
      wx.showToast({ title: preference.enabled ? "可约提醒已开启" : "可约提醒已关闭", icon: "success" });
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "FAVORITE_REMINDER_NOT_FOUND") {
        wx.showToast({ title: "该资料已不可用，书签已刷新", icon: "none" });
        await this.load();
      } else if (code === "FAVORITE_REMINDER_AUTHORIZATION_REQUIRED" || code === "FAVORITE_REMINDER_AUTHORIZATION_UNAVAILABLE") {
        wx.showToast({ title: "提醒授权已失效，请重新开启", icon: "none" });
      } else {
        wx.showToast({ title: (error as Error).message || "提醒设置失败", icon: "none" });
      }
    } finally {
      if (this.data.favoriteReminderSavingId === id) this.setData({ favoriteReminderSavingId: "" });
    }
  },
  openRecentlyViewedCompanion(event: any) {
    const id = String(event.currentTarget.dataset.id || "");
    if (!id) return;
    wx.navigateTo({ url: `/pages/companion/detail?id=${encodeURIComponent(id)}` });
  },
  openExcludedRecommendationCompanion(event: any) {
    const id = String(event.currentTarget.dataset.id || "");
    const item = this.data.excludedRecommendationCompanions.find((candidate) => candidate.companionId === id);
    if (!item) return;
    if (!item.companion.currentlyPublic) {
      wx.showToast({ title: "该资料当前不可公开查看", icon: "none" });
      return;
    }
    wx.navigateTo({ url: `/pages/companion/detail?id=${encodeURIComponent(id)}` });
  },
  async restoreExcludedRecommendationCompanion(event: any) {
    const id = String(event.currentTarget.dataset.id || "");
    const item = this.data.excludedRecommendationCompanions.find((candidate) => candidate.companionId === id);
    if (!item || this.data.recommendationExclusionSavingId) return;
    const confirmation = await new Promise<any>((resolve) => wx.showModal({
      title: "恢复推荐资格",
      content: `恢复后，${item.companion.name}可能再次出现在推荐或匹配结果中；不会改变会话拉黑、举报、订单或书签。`,
      confirmText: "恢复推荐",
      confirmColor: "#55748F",
      success: resolve
    }));
    if (!confirmation.confirm) return;
    this.setData({ recommendationExclusionSavingId: id });
    try {
      await api.restoreCompanionToRecommendations(id);
      const nextTotal = Math.max(0, this.data.recommendationExclusionsTotal - 1);
      this.setData({
        excludedRecommendationCompanions: this.data.excludedRecommendationCompanions.filter(
          (candidate) => candidate.companionId !== id
        ),
        recommendationExclusionsTotal: nextTotal,
        recommendationExclusionsTotalPages: Math.ceil(nextTotal / 10)
      });
      wx.showToast({ title: "已恢复推荐资格", icon: "success" });
    } catch (error) {
      wx.showToast({ title: (error as Error).message || "暂时无法恢复", icon: "none" });
    } finally {
      if (this.data.recommendationExclusionSavingId === id) this.setData({ recommendationExclusionSavingId: "" });
    }
  },
  async clearRecentlyViewedCompanions() {
    if (this.data.recentViewsState !== "available" || !this.data.recentlyViewedCompanions.length || this.data.clearingRecentViews) return;
    const confirmation = await new Promise<any>((resolve) => wx.showModal({
      title: "清空最近浏览",
      content: "只会清除你的回看列表，不影响书签、订单或任何服务记录。",
      confirmText: "清空",
      confirmColor: "#55748F",
      success: resolve
    }));
    if (!confirmation.confirm) return;
    this.setData({ clearingRecentViews: true });
    try {
      await api.clearRecentlyViewedCompanions();
      this.setData({ recentlyViewedCompanions: [], recentViewsState: "empty" });
      wx.showToast({ title: "最近浏览已清空", icon: "success" });
    } catch (error) {
      wx.showToast({ title: (error as Error).message || "暂时无法清空记录", icon: "none" });
    } finally {
      this.setData({ clearingRecentViews: false });
    }
  },
  async markAllNotificationsRead() {
    if (
      this.data.notificationState !== "available"
      || this.data.unreadNotificationState !== "available"
      || !this.data.unreadNotificationCount
    ) return;
    this.setData({ markingNotificationsRead: true });
    try {
      await api.markAllNotificationsRead();
      const readAt = new Date().toISOString();
      this.setData({
        notifications: this.data.notifications.map((item) => ({ ...item, readAt: item.readAt || readAt })),
        unreadNotificationCount: 0
      });
    } catch (error) {
      wx.showToast({ title: (error as Error).message || "操作失败", icon: "none" });
    } finally {
      this.setData({ markingNotificationsRead: false });
    }
  },
  async openNotification(event: any) {
    if (this.data.notificationState !== "available") return;
    const id = event.currentTarget.dataset.id as string;
    const item = this.data.notifications.find((notification) => notification.id === id);
    if (!item) return;
    let opened = item;
    try {
      if (!item.readAt) {
        opened = await api.markNotificationRead(item.id);
        this.setData({
          notifications: this.data.notifications.map((notification) => notification.id === item.id ? opened : notification),
          unreadNotificationCount: Math.max(0, this.data.unreadNotificationCount - 1)
        });
      }
    } catch (error) {
      wx.showToast({ title: (error as Error).message || "无法更新通知状态", icon: "none" });
    }
    openNotificationDestination(opened);
  },
  async signOut() {
    await logout();
    wx.showToast({ title: "已退出登录", icon: "success" });
    void this.load();
  },
  async requestDeletion() {
    const confirmation = await new Promise<any>((resolve) => wx.showModal({
      title: "申请注销账号",
      content: "提交后平台将在 15 个工作日内处理；处理期间请勿重复提交。",
      confirmText: "提交申请",
      confirmColor: "#B94A68",
      success: resolve
    }));
    if (!confirmation.confirm) return;
    try {
      const result = await api.requestDeletion();
      wx.showToast({
        title: result.message || "注销申请已提交；处理开始前可在“账户与隐私”取消",
        icon: "none",
        duration: 3000
      });
    } catch (error) {
      wx.showToast({ title: (error as Error).message || "提交失败", icon: "none" });
    }
  },
  async withdrawConsent() {
    const confirmation = await new Promise<any>((resolve) => wx.showModal({
      title: "撤回同意并退出",
      content: "撤回后将退出账号，重新同意协议前不能使用平台服务。",
      confirmText: "确认撤回",
      confirmColor: "#B94A68",
      success: resolve
    }));
    if (!confirmation.confirm) return;
    try {
      await api.withdrawLegalConsent();
      await logout();
      withdrawLegalConsent();
      wx.reLaunch({ url: "/pages/consent/index" });
    } catch (error) {
      wx.showToast({ title: (error as Error).message || "撤回失败，请稍后重试", icon: "none" });
    }
  },
  openPrivacy() { openLegalDocument("privacy"); },
  openTerms() { openLegalDocument("terms"); },
  openWechatPrivacy() {
    if (wx.openPrivacyContract) wx.openPrivacyContract({ fail: () => wx.showToast({ title: "请在小程序设置中查看隐私保护指引", icon: "none" }) });
    else wx.showToast({ title: "请升级微信后查看", icon: "none" });
  }
});
