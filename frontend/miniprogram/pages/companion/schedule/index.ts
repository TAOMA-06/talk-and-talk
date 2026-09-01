import { ApiError, ensureSession } from "../../../utils/api";
import {
  AvailabilityBlackout,
  RecurringAvailabilityDraft,
  RecurringAvailabilityRule,
  companionCommercialApi
} from "../../../utils/companion-commercial-api";

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const TIME_OPTIONS = Array.from(
  { length: 48 },
  (_, index) => `${String(Math.floor(index / 2)).padStart(2, "0")}:${index % 2 ? "30" : "00"}`
);

function minuteAt(index: number): number {
  return Math.max(0, Math.min(47, index)) * 30;
}

function localDateKey(daysFromNow = 0): string {
  const date = new Date(Date.now() + daysFromNow * 24 * 60 * 60_000 + 8 * 60 * 60_000);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function formatDateTime(value: string): string {
  const source = new Date(value);
  if (Number.isNaN(source.getTime())) return "时间未知";
  const date = new Date(source.getTime() + 8 * 60 * 60_000);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")} ${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
}

function displayRule(rule: RecurringAvailabilityRule) {
  return {
    ...rule,
    title: `${WEEKDAYS[rule.weekday] || "星期未知"} ${TIME_OPTIONS[rule.startsAtMinute / 30] || "??:??"}–${rule.endsAtMinute === 1440 ? "24:00" : TIME_OPTIONS[rule.endsAtMinute / 30] || "??:??"}`,
    capacityText: `容量 ${rule.capacity} · ${rule.timezone}`
  };
}

function displayBlackout(item: AvailabilityBlackout) {
  return { ...item, rangeText: `${formatDateTime(item.startsAt)} 至 ${formatDateTime(item.endsAt)}` };
}

function displayDraft(item: RecurringAvailabilityDraft) {
  return { ...item, rangeText: `${formatDateTime(item.startsAt)} 至 ${formatDateTime(item.endsAt)}` };
}

function errorMessage(error: unknown, fallback: string): string {
  const apiError = error as ApiError;
  const messages: Record<string, string> = {
    COMPANION_PROFILE_NOT_FOUND: "当前账号还没有陪伴者资料，请先完成入驻申请。",
    COMPANION_OWNER_NOT_ELIGIBLE: "身份或账号状态不满足排班条件，新的时段不会开放。",
    RECURRING_AVAILABILITY_MATERIALIZER_UNAVAILABLE: "周期草稿生成服务当前不可用，平台不会假装已经生成排班。",
    RECURRING_AVAILABILITY_RULE_OVERLAP: "该周期与现有有效规则重叠，请调整。",
    AVAILABILITY_BLACKOUT_OVERLAP: "该休假区间与现有区间重叠。",
    RECURRING_AVAILABILITY_DRAFT_NOT_FOUND: "草稿已失效、已开放或不属于当前账号，请刷新。"
  };
  return (apiError.code && messages[apiError.code]) || apiError.message || fallback;
}

Page({
  data: {
    motionOff: false,
    loading: true,
    error: "",
    suspended: false,
    scheduleMutationBlocked: true,
    eligibilityWarning: "正在核验商业资格；核验完成前不会开放排班写入。",
    weekdays: WEEKDAYS,
    timeOptions: TIME_OPTIONS,
    rules: [] as Array<ReturnType<typeof displayRule>>,
    blackouts: [] as Array<ReturnType<typeof displayBlackout>>,
    drafts: [] as Array<ReturnType<typeof displayDraft>>,
    rulePage: 1,
    ruleTotal: 0,
    ruleTotalPages: 1,
    blackoutPage: 1,
    blackoutTotal: 0,
    blackoutTotalPages: 1,
    draftPage: 1,
    draftTotal: 0,
    draftTotalPages: 1,
    loadingMoreKind: "" as "" | "rules" | "blackouts" | "drafts",
    horizonText: "",
    weekdayIndex: 1,
    ruleStartIndex: 18,
    ruleEndIndex: 22,
    ruleCapacity: "1",
    blackoutDate: localDateKey(1),
    minDate: localDateKey(),
    blackoutStartIndex: 18,
    blackoutEndIndex: 22,
    saving: false,
    actionId: "",
    generating: false
  },
  onShow() { void this.load(); },
  onPullDownRefresh() { void this.load(true); },
  async load(stopRefresh = false) {
    this.setData({
      loading: true,
      error: "",
      scheduleMutationBlocked: true,
      eligibilityWarning: "正在重新核验商业资格；核验完成前不会开放排班写入。"
    });
    try {
      await ensureSession();
      const [rules, blackouts, drafts, overviewResult] = await Promise.all([
        companionCommercialApi.recurringRules({ page: 1, pageSize: 50 }),
        companionCommercialApi.blackouts({ page: 1, pageSize: 50 }),
        companionCommercialApi.recurringDrafts({ page: 1, pageSize: 50 }),
        companionCommercialApi.overview()
          .then((value) => ({ ok: true as const, value }))
          .catch(() => ({ ok: false as const, value: null }))
      ]);
      const commercialStatus = overviewResult.value?.commercialProfile.status || "";
      const eligible = overviewResult.ok && commercialStatus === "verified";
      this.setData({
        loading: false,
        rules: rules.items.map(displayRule),
        rulePage: rules.pagination.page,
        ruleTotal: rules.pagination.total,
        ruleTotalPages: Math.max(1, rules.pagination.totalPages),
        blackouts: blackouts.items.map(displayBlackout),
        blackoutPage: blackouts.pagination.page,
        blackoutTotal: blackouts.pagination.total,
        blackoutTotalPages: Math.max(1, blackouts.pagination.totalPages),
        drafts: drafts.items.map(displayDraft),
        draftPage: drafts.pagination.page,
        draftTotal: drafts.pagination.total,
        draftTotalPages: Math.max(1, drafts.pagination.totalPages),
        horizonText: formatDateTime(drafts.horizonEndsAt),
        suspended: commercialStatus === "suspended",
        scheduleMutationBlocked: !eligible,
        eligibilityWarning: !overviewResult.ok
          ? "商业资格暂时无法核验。历史排班仍可查看，但新建规则、休假、生成草稿和开放时段均已安全锁定。"
          : commercialStatus === "suspended"
            ? "商业资格处于暂停状态。可以查看历史设置，但不能新建或开放排班；恢复必须由平台复核。"
            : commercialStatus !== "verified"
              ? "商业资质尚未通过复核。完成入驻、培训和平台审核前，排班写入保持锁定。"
              : ""
      });
    } catch (error) {
      this.setData({
        loading: false,
        error: errorMessage(error, "周期排班暂时无法加载，请稍后重试。")
      });
    } finally {
      if (stopRefresh) wx.stopPullDownRefresh();
    }
  },
  setWeekday(event: any) { this.setData({ weekdayIndex: Number(event.detail.value) }); },
  setRuleStart(event: any) { this.setData({ ruleStartIndex: Number(event.detail.value) }); },
  setRuleEnd(event: any) { this.setData({ ruleEndIndex: Number(event.detail.value) }); },
  setRuleCapacity(event: any) { this.setData({ ruleCapacity: event.detail.value }); },
  setBlackoutDate(event: any) { this.setData({ blackoutDate: event.detail.value }); },
  setBlackoutStart(event: any) { this.setData({ blackoutStartIndex: Number(event.detail.value) }); },
  setBlackoutEnd(event: any) { this.setData({ blackoutEndIndex: Number(event.detail.value) }); },
  async loadMoreRules() {
    if (this.data.loadingMoreKind || this.data.rulePage >= this.data.ruleTotalPages) return;
    this.setData({ loadingMoreKind: "rules", error: "" });
    try {
      const response = await companionCommercialApi.recurringRules({ page: this.data.rulePage + 1, pageSize: 50 });
      const existingIds = new Set(this.data.rules.map((item) => item.id));
      this.setData({
        rules: [...this.data.rules, ...response.items.filter((item) => !existingIds.has(item.id)).map(displayRule)],
        rulePage: response.pagination.page,
        ruleTotal: response.pagination.total,
        ruleTotalPages: Math.max(1, response.pagination.totalPages)
      });
    } catch (error) {
      this.setData({ error: errorMessage(error, "更多周期规则暂时无法读取；当前列表不完整。") });
    } finally {
      this.setData({ loadingMoreKind: "" });
    }
  },
  async loadMoreBlackouts() {
    if (this.data.loadingMoreKind || this.data.blackoutPage >= this.data.blackoutTotalPages) return;
    this.setData({ loadingMoreKind: "blackouts", error: "" });
    try {
      const response = await companionCommercialApi.blackouts({ page: this.data.blackoutPage + 1, pageSize: 50 });
      const existingIds = new Set(this.data.blackouts.map((item) => item.id));
      this.setData({
        blackouts: [...this.data.blackouts, ...response.items.filter((item) => !existingIds.has(item.id)).map(displayBlackout)],
        blackoutPage: response.pagination.page,
        blackoutTotal: response.pagination.total,
        blackoutTotalPages: Math.max(1, response.pagination.totalPages)
      });
    } catch (error) {
      this.setData({ error: errorMessage(error, "更多休假记录暂时无法读取；当前列表不完整。") });
    } finally {
      this.setData({ loadingMoreKind: "" });
    }
  },
  async loadMoreDrafts() {
    if (this.data.loadingMoreKind || this.data.draftPage >= this.data.draftTotalPages) return;
    this.setData({ loadingMoreKind: "drafts", error: "" });
    try {
      const response = await companionCommercialApi.recurringDrafts({ page: this.data.draftPage + 1, pageSize: 50 });
      const existingIds = new Set(this.data.drafts.map((item) => item.id));
      this.setData({
        drafts: [...this.data.drafts, ...response.items.filter((item) => !existingIds.has(item.id)).map(displayDraft)],
        draftPage: response.pagination.page,
        draftTotal: response.pagination.total,
        draftTotalPages: Math.max(1, response.pagination.totalPages),
        horizonText: formatDateTime(response.horizonEndsAt)
      });
    } catch (error) {
      this.setData({ error: errorMessage(error, "更多待确认草稿暂时无法读取；当前列表不完整。") });
    } finally {
      this.setData({ loadingMoreKind: "" });
    }
  },
  async createRule() {
    if (this.data.saving || this.data.scheduleMutationBlocked) return;
    const startsAtMinute = minuteAt(this.data.ruleStartIndex);
    const endsAtMinute = minuteAt(this.data.ruleEndIndex);
    const capacity = Number(this.data.ruleCapacity);
    if (endsAtMinute <= startsAtMinute) {
      this.setData({ error: "周期规则的结束时间必须晚于开始时间。" });
      return;
    }
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 10) {
      this.setData({ error: "容量必须是1至10的整数。" });
      return;
    }
    this.setData({ saving: true, error: "" });
    try {
      await companionCommercialApi.createRecurringRule({
        weekday: this.data.weekdayIndex,
        startsAtMinute,
        endsAtMinute,
        capacity
      });
      wx.showToast({ title: "周期规则已保存", icon: "success" });
      await this.load();
    } catch (error) {
      this.setData({ error: errorMessage(error, "保存周期规则失败，请稍后重试。") });
    } finally {
      this.setData({ saving: false });
    }
  },
  async deactivateRule(event: any) {
    const id = event.currentTarget.dataset.id as string;
    if (!id || this.data.actionId) return;
    this.setData({ actionId: id, error: "" });
    try {
      await companionCommercialApi.deactivateRecurringRule(id);
      wx.showToast({ title: "周期规则已停用", icon: "success" });
      await this.load();
    } catch (error) {
      this.setData({ error: errorMessage(error, "停用周期规则失败。") });
    } finally {
      this.setData({ actionId: "" });
    }
  },
  async createBlackout() {
    if (this.data.saving || this.data.scheduleMutationBlocked) return;
    const start = TIME_OPTIONS[this.data.blackoutStartIndex];
    const end = TIME_OPTIONS[this.data.blackoutEndIndex];
    if (!start || !end || this.data.blackoutEndIndex <= this.data.blackoutStartIndex) {
      this.setData({ error: "休假结束时间必须晚于开始时间。" });
      return;
    }
    this.setData({ saving: true, error: "" });
    try {
      await companionCommercialApi.createBlackout(
        `${this.data.blackoutDate}T${start}:00+08:00`,
        `${this.data.blackoutDate}T${end}:00+08:00`
      );
      wx.showToast({ title: "休假例外已保存", icon: "success" });
      await this.load();
    } catch (error) {
      this.setData({ error: errorMessage(error, "保存休假例外失败。") });
    } finally {
      this.setData({ saving: false });
    }
  },
  async deactivateBlackout(event: any) {
    const id = event.currentTarget.dataset.id as string;
    if (!id || this.data.actionId) return;
    this.setData({ actionId: id, error: "" });
    try {
      await companionCommercialApi.deactivateBlackout(id);
      wx.showToast({ title: "休假例外已停用", icon: "success" });
      await this.load();
    } catch (error) {
      this.setData({ error: errorMessage(error, "停用休假例外失败。") });
    } finally {
      this.setData({ actionId: "" });
    }
  },
  async generateDrafts() {
    if (this.data.generating || this.data.scheduleMutationBlocked) return;
    this.setData({ generating: true, error: "" });
    try {
      const result = await companionCommercialApi.materializeRecurringDrafts();
      wx.showModal({
        title: "排班草稿已重新计算",
        content: `新生成 ${result.created} 个，已有 ${result.alreadyMaterialized} 个；休假跳过 ${result.skippedByBlackout} 个，冲突跳过 ${result.skippedByExistingWindow + result.skippedByOrder} 个。所有草稿仍需逐个确认才会开放。`,
        showCancel: false
      });
      await this.load();
    } catch (error) {
      this.setData({ error: errorMessage(error, "生成排班草稿失败。") });
    } finally {
      this.setData({ generating: false });
    }
  },
  async activateDraft(event: any) {
    const id = event.currentTarget.dataset.id as string;
    if (!id || this.data.actionId || this.data.scheduleMutationBlocked) return;
    this.setData({ actionId: id, error: "" });
    try {
      await companionCommercialApi.activateRecurringDraft(id);
      wx.showToast({ title: "该时段已开放", icon: "success" });
      await this.load();
    } catch (error) {
      this.setData({ error: errorMessage(error, "开放草稿失败，请刷新核对冲突。") });
    } finally {
      this.setData({ actionId: "" });
    }
  },
  retry() { void this.load(); }
});
