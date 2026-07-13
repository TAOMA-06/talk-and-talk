import { api, currentUser, ensureSession, logout } from "../../utils/api";
import { AuthUser, Notification } from "../../utils/models";

Page({
  data: {
    user: null as AuthUser | null, displayName: "", gender: "", notifications: [] as Notification[],
    genders: ["female", "male", "other", "undisclosed"], profileLoading: true, saving: false,
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
        notifications: notifications.items || [],
        profileLoading: false
      });
    } catch (error) { this.setData({ profileLoading: false }); wx.showToast({ title: (error as Error).message || "加载失败", icon: "none" }); }
  },
  setDisplayName(event: any) { this.setData({ displayName: event.detail.value }); },
  setGender(event: any) {
    const values = ["female", "male", "other", "undisclosed"];
    this.setData({ gender: values[Number(event.detail.value)] || "" });
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
  openPrivacy() {
    if (wx.openPrivacyContract) wx.openPrivacyContract({ fail: () => wx.showToast({ title: "请在小程序设置中查看隐私保护指引", icon: "none" }) });
  }
});
