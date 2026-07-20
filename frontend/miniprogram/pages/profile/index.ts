import { api, ensureSession, logout } from "../../utils/api";
import {
  AuthUser, Notification, RecommendationPreference, RecommendationTopic, USER_GENDERS, UserGender
} from "../../utils/models";
import { openLegalDocument, withdrawLegalConsent } from "../../utils/privacy";

const GENDER_LABELS: Record<UserGender, string> = { female: "女", male: "男" };
const PREFERRED_TIME_SLOTS = ["08:00", "12:00", "18:00", "21:00", "23:00"];
type DisplayTopic = RecommendationTopic & { selected: boolean };
type DisplayTimeSlot = { value: string; selected: boolean };

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
    user: null as AuthUser | null, displayName: "", gender: "" as UserGender | "", genderLabel: "未选择",
    genderLabels: USER_GENDERS.map((gender) => GENDER_LABELS[gender]), notifications: [] as Notification[],
    unreadNotificationCount: 0, markingNotificationsRead: false, profileLoading: true, saving: false,
    applicationVisible: false, role: "情绪倾听者", bio: "", price: "39", city: "线上",
    recommendationPreferences: null as RecommendationPreference | null,
    recommendationTopics: [] as DisplayTopic[], recommendationTopicIds: [] as string[],
    recommendationCity: "", recommendationMaxPrice: "", recommendationTimeSlots: [] as string[],
    recommendationTimeOptions: displayTimeSlots([]), recommendationSaving: false
  },
  onShow() { void this.load(); },
  async load() {
    this.setData({ profileLoading: true });
    try {
      await ensureSession();
      const [user, notifications, unread, preference, topics] = await Promise.all([
        api.fetchMe(),
        api.notifications().catch(() => ({ items: [] as Notification[] })),
        api.notificationUnreadCount().catch(() => ({ count: 0 })),
        api.recommendationPreferences().catch(() => null),
        api.recommendationTopics().catch(() => ({ items: [] as RecommendationTopic[] }))
      ]);
      this.setData({
        user,
        displayName: user.profile?.displayName || "",
        gender: user.profile?.gender || "",
        genderLabel: user.profile?.gender ? GENDER_LABELS[user.profile.gender] : "未选择",
        notifications: notifications.items || [],
        unreadNotificationCount: unread.count || 0,
        recommendationPreferences: preference,
        recommendationTopics: displayTopics(topics.items || [], preference?.topicIds || []),
        recommendationTopicIds: preference?.topicIds || [],
        recommendationCity: preference?.city || "",
        recommendationMaxPrice: preference?.maxPricePerHalfHour ? String(preference.maxPricePerHalfHour) : "",
        recommendationTimeSlots: preference?.preferredTimeSlots || [],
        recommendationTimeOptions: displayTimeSlots(preference?.preferredTimeSlots || []),
        profileLoading: false
      });
    } catch (error) { this.setData({ profileLoading: false }); wx.showToast({ title: (error as Error).message || "加载失败", icon: "none" }); }
  },
  setDisplayName(event: any) { this.setData({ displayName: event.detail.value }); },
  setGender(event: any) {
    const gender = USER_GENDERS[Number(event.detail.value)] || "";
    this.setData({ gender, genderLabel: gender ? GENDER_LABELS[gender] : "未选择" });
  },
  setRole(event: any) { this.setData({ role: event.detail.value }); },
  setBio(event: any) { this.setData({ bio: event.detail.value }); },
  setPrice(event: any) { this.setData({ price: event.detail.value }); },
  setCity(event: any) { this.setData({ city: event.detail.value }); },
  async setPersonalization(event: any) {
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
      const user = await api.updateMe({ displayName: this.data.displayName.trim() || undefined, gender: this.data.gender || undefined });
      this.setData({ user });
      wx.showToast({ title: "资料已保存", icon: "success" });
    } catch (error) { wx.showToast({ title: (error as Error).message || "保存失败", icon: "none" }); }
    finally { this.setData({ saving: false }); }
  },
  toggleApplication() { this.setData({ applicationVisible: !this.data.applicationVisible }); },
  async applyCompanion() {
    if (!this.data.bio.trim()) { wx.showToast({ title: "请填写服务介绍", icon: "none" }); return; }
    try {
      await api.applyCompanion({
        role: this.data.role.trim(), bio: this.data.bio.trim(), pricePerHalfHour: Number(this.data.price) || 39,
        tags: ["平台内沟通"], availableTimes: ["可预约"], languages: ["中文"], specialties: ["情绪倾听"], cityDistrict: this.data.city.trim() || "线上"
      });
      wx.showToast({ title: "申请已提交", icon: "success" });
      this.setData({ applicationVisible: false });
      await this.load();
    } catch (error) { wx.showToast({ title: (error as Error).message || "申请失败", icon: "none" }); }
  },
  async markAllNotificationsRead() {
    if (!this.data.unreadNotificationCount) return;
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
      return;
    }
    const data = opened.data || {};
    if (typeof data.conversationId === "string" && data.conversationId) {
      wx.navigateTo({ url: `/pages/chat/index?id=${encodeURIComponent(data.conversationId)}` });
      return;
    }
    if (typeof data.orderId === "string" && data.orderId) {
      wx.switchTab({ url: "/pages/orders/index" });
      return;
    }
    if (typeof data.caseId === "string" && data.caseId) {
      wx.showModal({
        title: "安全审核提醒",
        content: "该内容已进入审核流程。你可以在对应聊天中查看状态或提交申诉。",
        showCancel: false
      });
    }
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
      wx.showToast({ title: result.message || "注销申请已提交", icon: "none", duration: 3000 });
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
