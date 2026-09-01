import { api, ApiError, ensureSession, readLocalFile, uploadAuthorizedMedia } from "../../../utils/api";
import {
  CompanionProfileMediaSlot, CompanionTodayServiceEntry,
  CompanionTodayServiceSchedule
} from "../../../utils/models";
import { companionCommercialApi } from "../../../utils/companion-commercial-api";
import { clientCompanionProfileMediaEnabled } from "../../../utils/config";
import { companionAvatarUrl, companionCoverUrl } from "../../../utils/design-assets";
import { sha256Hex } from "../../../utils/sha256";

type AccessState = "loading" | "ready" | "ineligible" | "error";
type DisplayTodayService = CompanionTodayServiceEntry & {
  scheduledAtText: string;
  statusText: string;
  statusDescription: string;
};

const SHANGHAI_OFFSET_MS = 8 * 60 * 60_000;
const SERVICE_ORDER_STATUS_TEXT: Record<string, string> = {
  pending: "等待你确认",
  paying: "等待客户支付",
  paid: "已支付，待开始",
  inService: "服务进行中",
  completed: "本次已完成"
};
const SERVICE_ORDER_STATUS_DESCRIPTION: Record<string, string> = {
  pending: "请到订单页确认或拒绝这笔预约。",
  paying: "你已确认，等待客户完成支付。",
  paid: "已支付；服务开始仍以订单页的真实窗口为准。",
  inService: "服务正在进行；继续处理请前往订单页。",
  completed: "本次服务已完成，订单页保留实时记录。"
};

function pad(value: number): string { return String(value).padStart(2, "0"); }

function formatCny(cents: number): string {
  return `¥${(Math.max(0, cents) / 100).toFixed(2)}`;
}

function formatShanghaiDateTime(value?: string): string {
  if (!value) return "时间待确认";
  const source = new Date(value);
  if (Number.isNaN(source.getTime())) return "时间待确认";
  // Shift then read UTC to make the display stable on devices outside China.
  const date = new Date(source.getTime() + SHANGHAI_OFFSET_MS);
  return `${date.getUTCFullYear()}年${pad(date.getUTCMonth() + 1)}月${pad(date.getUTCDate())}日 ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

function formatShanghaiTime(value: string): string {
  const source = new Date(value);
  if (Number.isNaN(source.getTime())) return "时间待确认";
  const date = new Date(source.getTime() + SHANGHAI_OFFSET_MS);
  return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

function formatScheduleDate(value: string): string {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!matched) return "今天";
  return `${Number(matched[2])}月${Number(matched[3])}日`;
}

function displayTodayService(item: CompanionTodayServiceEntry): DisplayTodayService {
  return {
    ...item,
    scheduledAtText: formatShanghaiTime(item.scheduledAt),
    statusText: SERVICE_ORDER_STATUS_TEXT[item.status] || "订单处理中",
    statusDescription: SERVICE_ORDER_STATUS_DESCRIPTION[item.status] || "请前往订单页查看该订单的实时状态。"
  };
}

function errorMessage(error: unknown, fallback: string): string {
  const apiError = error as ApiError;
  const messages: Record<string, string> = {
    COMPANION_PROFILE_NOT_FOUND: "当前账号尚未绑定陪伴者资料，请联系平台完成入驻配置。",
    COMPANION_OWNER_NOT_ELIGIBLE: "完成实名认证并通过陪伴者资料审核后，才可进入陪伴者工作台。"
  };
  return (apiError.code && messages[apiError.code]) || apiError.message || fallback;
}

Page({
  data: {
    motionOff: false,
    loading: true,
    accessState: "loading" as AccessState,
    loadError: "",
    activeOfferingCount: 0,
    totalOfferingCount: 0,
    futureWindowCount: 0,
    nextWindowText: "还没有开放的可约时段",
    pendingConfirmationCount: 0,
    todayServiceDateText: "今天",
    todayServiceOrders: [] as DisplayTodayService[],
    todayServiceOrdersUnavailable: false,
    availableEarningsCents: 0,
    availableEarningsText: "¥0.00",
    availableEarningCount: 0,
    earningsUnavailable: false,
    updatedAtText: "",
    lifecycleUnavailable: false,
    commercialStatusText: "状态待同步",
    trainingStatusText: "培训待同步",
    activeAccountActions: 0,
    openIncidentCount: 0,
    profileAvatarUrl: "",
    profileCoverUrl: "",
    profileInitials: "我",
    profileMediaEnabled: clientCompanionProfileMediaEnabled(),
    profileMediaBusy: false,
    profileMediaMessage: ""
  },
  onShow() { void this.load(); },
  onPullDownRefresh() { void this.load(true); },
  async load(stopRefresh = false) {
    this.setData({ loading: true, accessState: "loading", loadError: "" });
    try {
      await ensureSession();
      // Catalog and availability keep the established workbench eligibility
      // boundary. The narrow day feed and settlement card may degrade on their
      // own, so a non-critical outage never exposes broader order data.
      const [catalog, availability, profile] = await Promise.all([
        api.ownServiceOfferings(),
        api.ownAvailabilityWindows(),
        api.ownCompanion()
      ]);
      const [todayServiceSchedule, earnings, lifecycle] = await Promise.all([
        api.companionTodayServiceSchedule()
          .then((schedule) => ({ schedule, unavailable: false }))
          .catch(() => ({ schedule: null as CompanionTodayServiceSchedule | null, unavailable: true })),
        companionCommercialApi.earnings({ page: 1, pageSize: 1 })
          .then((result) => ({ summary: result.summary, unavailable: false }))
          .catch(() => ({ summary: null, unavailable: true })),
        companionCommercialApi.overview()
          .then((overview) => ({ overview, unavailable: false }))
          .catch(() => ({ overview: null, unavailable: true }))
      ]);

      const schedule = todayServiceSchedule.schedule;
      const availableEarningsCents = earnings.summary?.availableCents ?? 0;
      const lifecycleOverview = lifecycle.overview;
      const commercialStatuses: Record<string, string> = {
        notSubmitted: "商业资料未提交",
        pendingReview: "商业资料审核中",
        verified: "商业资格有效",
        suspended: "商业资格已暂停"
      };

      this.setData({
        loading: false,
        accessState: "ready",
        activeOfferingCount: catalog.summary.active,
        totalOfferingCount: catalog.summary.total,
        futureWindowCount: availability.summary.futureActiveCount,
        nextWindowText: availability.summary.nextFutureActiveStartsAt
          ? formatShanghaiDateTime(availability.summary.nextFutureActiveStartsAt)
          : "还没有开放的可约时段",
        pendingConfirmationCount: schedule?.pendingConfirmationCount ?? 0,
        todayServiceDateText: schedule ? formatScheduleDate(schedule.date) : "今天",
        todayServiceOrders: (schedule?.items || []).map(displayTodayService),
        todayServiceOrdersUnavailable: todayServiceSchedule.unavailable,
        availableEarningsCents,
        availableEarningsText: formatCny(availableEarningsCents),
        availableEarningCount: earnings.summary?.byStatus.available.count ?? 0,
        earningsUnavailable: earnings.unavailable,
        lifecycleUnavailable: lifecycle.unavailable,
        commercialStatusText: lifecycleOverview
          ? commercialStatuses[lifecycleOverview.commercialProfile.status] || lifecycleOverview.commercialProfile.status
          : "状态暂无法同步",
        trainingStatusText: lifecycleOverview
          ? lifecycleOverview.training.complete ? "必修培训有效" : "培训未完成或已到期"
          : "培训暂无法同步",
        activeAccountActions: lifecycleOverview?.operationalSummary.activeRestrictionCount ?? 0,
        openIncidentCount: lifecycleOverview?.operationalSummary.openIncidentCount ?? 0,
        profileAvatarUrl: companionAvatarUrl(profile, "large"),
        profileCoverUrl: companionCoverUrl(profile),
        profileInitials: profile.initials || profile.name.slice(0, 2),
        updatedAtText: formatShanghaiDateTime(new Date().toISOString())
      });
    } catch (error) {
      const apiError = error as ApiError;
      const ineligible = apiError.code === "COMPANION_PROFILE_NOT_FOUND" || apiError.code === "COMPANION_OWNER_NOT_ELIGIBLE";
      this.setData({
        loading: false,
        accessState: ineligible ? "ineligible" : "error",
        loadError: errorMessage(error, "工作台暂时无法加载，请稍后重试。")
      });
    } finally {
      if (stopRefresh) wx.stopPullDownRefresh();
    }
  },
  retry() { void this.load(); },
  chooseAvatar() { void this.chooseProfileMedia("avatar"); },
  chooseCover() { void this.chooseProfileMedia("cover"); },
  removeAvatar() { void this.removeProfileMedia("avatar"); },
  removeCover() { void this.removeProfileMedia("cover"); },
  async chooseProfileMedia(slot: CompanionProfileMediaSlot) {
    if (!this.data.profileMediaEnabled || this.data.profileMediaBusy) {
      wx.showToast({ title: "当前发行面尚未开放资料图片上传", icon: "none" });
      return;
    }
    try {
      const result: any = await new Promise((resolve, reject) => wx.chooseMedia({
        count: 1,
        mediaType: ["image"],
        sourceType: ["album", "camera"],
        success: resolve,
        fail: reject
      }));
      const file = result.tempFiles?.[0];
      if (!file?.tempFilePath) return;
      const maxBytes = slot === "avatar" ? 2 * 1024 * 1024 : 4 * 1024 * 1024;
      if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > maxBytes) {
        throw new Error(slot === "avatar" ? "头像需小于 2MB" : "封面需小于 4MB");
      }
      const extension = String(file.tempFilePath).toLowerCase().split(".").pop();
      const mimeType = extension === "png" ? "image/png" : extension === "webp" ? "image/webp" : "image/jpeg";
      this.setData({ profileMediaBusy: true, profileMediaMessage: "正在安全上传并审核图片…" });
      const bytes = await readLocalFile(file.tempFilePath);
      const reservation = await api.reserveOwnCompanionProfileMedia(slot, {
        mimeType,
        sizeBytes: file.size,
        sha256: sha256Hex(bytes)
      });
      await uploadAuthorizedMedia(reservation.upload, bytes);
      const completed = await api.completeOwnCompanionProfileMedia(slot, reservation.asset.id);
      if (!completed.asset.published) {
        this.setData({ profileMediaMessage: "图片未公开：审核状态为 " + completed.asset.status });
        return;
      }
      this.setData({ profileMediaMessage: slot === "avatar" ? "头像已更新" : "封面已更新" });
      await this.load();
    } catch (error) {
      const message = (error as Error).message || "资料图片更新失败";
      this.setData({ profileMediaMessage: message });
      wx.showToast({ title: message, icon: "none" });
    } finally {
      this.setData({ profileMediaBusy: false });
    }
  },
  async removeProfileMedia(slot: CompanionProfileMediaSlot) {
    if (!this.data.profileMediaEnabled || this.data.profileMediaBusy) return;
    this.setData({ profileMediaBusy: true, profileMediaMessage: "正在移除图片…" });
    try {
      await api.removeOwnCompanionProfileMedia(slot);
      this.setData({ profileMediaMessage: slot === "avatar" ? "头像已移除" : "封面已移除" });
      await this.load();
    } catch (error) {
      this.setData({ profileMediaMessage: (error as Error).message || "移除失败" });
    } finally {
      this.setData({ profileMediaBusy: false });
    }
  },
  openServiceOfferings() { wx.navigateTo({ url: "/pages/companion/services/index" }); },
  openAvailabilityWindows() { wx.navigateTo({ url: "/pages/companion/availability/index" }); },
  openOnboarding() { wx.navigateTo({ url: "/pages/companion/onboarding/index" }); },
  openSchedule() { wx.navigateTo({ url: "/pages/companion/schedule/index" }); },
  openDevelopment() { wx.navigateTo({ url: "/pages/companion/development/index" }); },
  openEarnings() { wx.navigateTo({ url: "/pages/companion/earnings/index" }); },
  openSafety() { wx.navigateTo({ url: "/pages/companion/safety/index" }); },
  openTodayOrder(event: any) {
    const id = String(event.currentTarget.dataset.id || "");
    if (!id) return;
    wx.navigateTo({ url: `/pages/order/detail?id=${encodeURIComponent(id)}` });
  },
  openOrders() { wx.switchTab({ url: "/pages/orders/index" }); }
});
