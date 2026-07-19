import { api, ensureSession, logout } from "../../utils/api";
import { AuthUser, Notification, USER_GENDERS, UserGender } from "../../utils/models";
import { openLegalDocument, withdrawLegalConsent } from "../../utils/privacy";

const GENDER_LABELS: Record<UserGender, string> = { female: "女", male: "男" };

Page({
  data: {
    user: null as AuthUser | null, displayName: "", gender: "" as UserGender | "", genderLabel: "未选择",
    genderLabels: USER_GENDERS.map((gender) => GENDER_LABELS[gender]), notifications: [] as Notification[],
    profileLoading: true, saving: false,
    applicationVisible: false, role: "情绪倾听者", bio: "", price: "39", city: "线上"
  },
  onShow() { void this.load(); },
  async load() {
    this.setData({ profileLoading: true });
    try {
      await ensureSession();
      const [user, notifications] = await Promise.all([api.fetchMe(), api.notifications().catch(() => ({ items: [] as Notification[] }))]);
      this.setData({
        user,
        displayName: user.profile?.displayName || "",
        gender: user.profile?.gender || "",
        genderLabel: user.profile?.gender ? GENDER_LABELS[user.profile.gender] : "未选择",
        notifications: notifications.items || [],
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
