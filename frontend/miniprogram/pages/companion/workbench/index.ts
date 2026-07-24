import { api, ApiError, ensureSession } from "../../../utils/api";
import {
  CompanionTodayServiceEntry,
  CompanionTodayServiceSchedule,
  OwnAvailabilityWindow,
  OwnServiceOffering
} from "../../../utils/models";

type AccessState = "loading" | "ready" | "ineligible" | "error";
type CompanionEarning = { id: string; payableCents: number; status: string; availableAt: string };
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

function windowStartTimestamp(window: OwnAvailabilityWindow): number {
  const timestamp = Date.parse(window.startsAt);
  return Number.isNaN(timestamp) ? Number.POSITIVE_INFINITY : timestamp;
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
    updatedAtText: ""
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
      const [catalog, availability] = await Promise.all([
        api.ownServiceOfferings(),
        api.ownAvailabilityWindows()
      ]);
      const [todayServiceSchedule, earnings] = await Promise.all([
        api.companionTodayServiceSchedule()
          .then((schedule) => ({ schedule, unavailable: false }))
          .catch(() => ({ schedule: null as CompanionTodayServiceSchedule | null, unavailable: true })),
        api.companionEarnings()
          .then((result) => ({ items: result.items || ([] as CompanionEarning[]), unavailable: false }))
          .catch(() => ({ items: [] as CompanionEarning[], unavailable: true }))
      ]);

      const now = Date.now();
      const offerings = catalog.items || ([] as OwnServiceOffering[]);
      const futureWindows = (availability.items || ([] as OwnAvailabilityWindow[]))
        .filter((window) => window.isActive && windowStartTimestamp(window) > now)
        .sort((left, right) => windowStartTimestamp(left) - windowStartTimestamp(right));
      const schedule = todayServiceSchedule.schedule;
      const availableEarnings = earnings.items.filter((earning) => earning.status === "available");
      const availableEarningsCents = availableEarnings.reduce((total, earning) => total + earning.payableCents, 0);

      this.setData({
        loading: false,
        accessState: "ready",
        activeOfferingCount: offerings.filter((offering) => offering.isActive).length,
        totalOfferingCount: offerings.length,
        futureWindowCount: futureWindows.length,
        nextWindowText: futureWindows[0]
          ? formatShanghaiDateTime(futureWindows[0].startsAt)
          : "还没有开放的可约时段",
        pendingConfirmationCount: schedule?.pendingConfirmationCount ?? 0,
        todayServiceDateText: schedule ? formatScheduleDate(schedule.date) : "今天",
        todayServiceOrders: (schedule?.items || []).map(displayTodayService),
        todayServiceOrdersUnavailable: todayServiceSchedule.unavailable,
        availableEarningsCents,
        availableEarningsText: formatCny(availableEarningsCents),
        availableEarningCount: availableEarnings.length,
        earningsUnavailable: earnings.unavailable,
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
  openServiceOfferings() { wx.navigateTo({ url: "/pages/companion/services/index" }); },
  openAvailabilityWindows() { wx.navigateTo({ url: "/pages/companion/availability/index" }); },
  openOrders() { wx.switchTab({ url: "/pages/orders/index" }); }
});
