import { api, ApiError, ensureSession } from "../../../utils/api";
import { CreateOwnAvailabilityWindowInput, OwnAvailabilityWindow } from "../../../utils/models";

type AccessState = "loading" | "ready" | "ineligible" | "error";
type WindowState = "active" | "inProgress" | "expired" | "retired";
type DisplayWindow = OwnAvailabilityWindow & {
  dateLabel: string;
  rangeText: string;
  durationText: string;
  capacityText: string;
  statusText: string;
  statusClass: WindowState;
};

const SHANGHAI_OFFSET_MS = 8 * 60 * 60_000;
const WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"];
const AVAILABILITY_STEP_MS = 30 * 60_000;
const MIN_PUBLIC_BOOKING_LEAD_TIME_MS = 15 * 60_000;
const DEFAULT_FORM_LEAD_BUFFER_MS = 5 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
const TIME_OPTIONS = Array.from({ length: 48 }, (_, index) => `${pad(Math.floor(index / 2))}:${index % 2 ? "30" : "00"}`);

function pad(value: number): string { return String(value).padStart(2, "0"); }

function shanghaiParts(value: string | Date) {
  const source = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(source.getTime())) return null;
  // Shifting then reading UTC avoids relying on the device's local timezone.
  const date = new Date(source.getTime() + SHANGHAI_OFFSET_MS);
  return {
    timestamp: source.getTime(),
    dateKey: `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`,
    dateLabel: `${date.getUTCFullYear()}年${pad(date.getUTCMonth() + 1)}月${pad(date.getUTCDate())}日 周${WEEKDAY_LABELS[date.getUTCDay()]}`,
    timeLabel: `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`
  };
}

function availabilityFormDefaults() {
  const startsAt = new Date(Math.ceil((Date.now() + MIN_PUBLIC_BOOKING_LEAD_TIME_MS + DEFAULT_FORM_LEAD_BUFFER_MS) / AVAILABILITY_STEP_MS) * AVAILABILITY_STEP_MS);
  const endsAt = new Date(startsAt.getTime() + 60 * 60_000);
  const start = shanghaiParts(startsAt)!;
  const end = shanghaiParts(endsAt)!;
  return {
    date: start.dateKey,
    startTimeIndex: Math.max(0, TIME_OPTIONS.indexOf(start.timeLabel)),
    endTimeIndex: Math.max(0, TIME_OPTIONS.indexOf(end.timeLabel)),
    minDate: shanghaiParts(new Date())!.dateKey
  };
}

function windowDateTime(date: string, time: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const result = new Date(`${date}T${time}:00+08:00`);
  return Number.isNaN(result.getTime()) ? null : result;
}

function toShanghaiIso(value: Date): string {
  const parts = shanghaiParts(value);
  return parts ? `${parts.dateKey}T${parts.timeLabel}:00+08:00` : "";
}

function endDayHint(startTimeIndex: number, endTimeIndex: number): string {
  return endTimeIndex <= startTimeIndex ? "结束时间按次日计算" : "结束时间与开始时间同日";
}

function displayWindow(item: OwnAvailabilityWindow): DisplayWindow {
  const start = shanghaiParts(item.startsAt);
  const end = shanghaiParts(item.endsAt);
  const now = Date.now();
  const invalid = !start || !end || end.timestamp <= start.timestamp;
  const statusClass: WindowState = !item.isActive
    ? "retired"
    : invalid || end.timestamp <= now
      ? "expired"
      : start.timestamp <= now
        ? "inProgress"
        : "active";
  const statusText: Record<WindowState, string> = {
    active: "可预约",
    inProgress: "进行中",
    expired: "已过期",
    retired: "已停用"
  };
  const durationMinutes = start && end ? Math.round((end.timestamp - start.timestamp) / 60_000) : 0;
  return {
    ...item,
    dateLabel: start?.dateLabel || "时间数据异常",
    rangeText: start && end
      ? start.dateKey === end.dateKey
        ? `${start.timeLabel} – ${end.timeLabel}`
        : `${start.timeLabel} 至 ${end.dateLabel} ${end.timeLabel}`
      : "无法读取时间范围",
    durationText: durationMinutes > 0 ? `${durationMinutes} 分钟` : "时长异常",
    capacityText: `单个预约时段容量：${item.capacity} 位`,
    statusText: statusText[statusClass],
    statusClass
  };
}

function errorMessage(error: unknown, fallback: string): string {
  const apiError = error as ApiError;
  if (apiError.code === "AVAILABILITY_WINDOW_HAS_ACTIVE_ORDERS") {
    const scheduledAt = apiError.details?.scheduledAt;
    const schedule = typeof scheduledAt === "string" ? shanghaiParts(scheduledAt) : null;
    return schedule
      ? `该时段已有待履约订单（预约于 ${schedule.dateLabel} ${schedule.timeLabel}），为保护双方无法变更。请待订单结束后再操作。`
      : "该时段已有待履约订单（包括待处理、待支付或服务中），为保护双方无法变更。请待订单结束后再操作。";
  }
  const messages: Record<string, string> = {
    COMPANION_PROFILE_NOT_FOUND: "当前账号尚未绑定陪伴者资料，请联系平台完成入驻配置。",
    COMPANION_OWNER_NOT_ELIGIBLE: "完成实名认证并通过陪伴者资料审核后，才可管理可约时段。",
    INVALID_AVAILABILITY_WINDOW: "日期或时间格式无效，请重新选择。",
    INVALID_AVAILABILITY_WINDOW_ALIGNMENT: "开始和结束时间必须落在整点或半点。",
    INVALID_AVAILABILITY_WINDOW_RANGE: "结束时间必须晚于开始时间，且单次时段最长 24 小时。",
    INVALID_AVAILABILITY_WINDOW_CAPACITY: "容量必须是 1 至 10 的整数。",
    AVAILABILITY_WINDOW_TOO_SOON: "开放的时段需至少在 15 分钟后开始。",
    AVAILABILITY_WINDOW_OVERLAP: "该时段与已有的开放时段重叠，请调整后重试。",
    AVAILABILITY_WINDOW_NOT_FOUND: "该时段已不存在或不属于当前账号，请刷新后重试。"
  };
  return (apiError.code && messages[apiError.code]) || apiError.message || fallback;
}

const INITIAL_FORM = availabilityFormDefaults();

Page({
  data: {
    motionOff: false,
    loading: true,
    accessState: "loading" as AccessState,
    loadError: "",
    activeWindows: [] as DisplayWindow[],
    expiredWindows: [] as DisplayWindow[],
    retiredWindows: [] as DisplayWindow[],
    totalWindows: 0,
    windowPage: 1,
    windowTotalPages: 1,
    loadingMoreWindows: false,
    editorVisible: false,
    editingWindowId: "",
    formDate: INITIAL_FORM.date,
    minDate: INITIAL_FORM.minDate,
    timeOptions: TIME_OPTIONS,
    formStartTimeIndex: INITIAL_FORM.startTimeIndex,
    formEndTimeIndex: INITIAL_FORM.endTimeIndex,
    formEndDayHint: endDayHint(INITIAL_FORM.startTimeIndex, INITIAL_FORM.endTimeIndex),
    formCapacity: "1",
    formActive: true,
    formError: "",
    saving: false,
    retiringWindowId: "",
    actionError: ""
  },
  onShow() { void this.load(); },
  onPullDownRefresh() { void this.load(true); },
  async load(stopRefresh = false) {
    this.setData({ loading: true, accessState: "loading", loadError: "" });
    try {
      await ensureSession();
      const result = await api.ownAvailabilityWindows({ page: 1, pageSize: 50 });
      const items = (result.items || [])
        .map(displayWindow)
        .sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt));
      this.setData({
        activeWindows: items.filter((item) => item.statusClass === "active" || item.statusClass === "inProgress"),
        expiredWindows: items.filter((item) => item.statusClass === "expired"),
        retiredWindows: items.filter((item) => item.statusClass === "retired"),
        totalWindows: result.pagination.total,
        windowPage: result.pagination.page,
        windowTotalPages: Math.max(1, result.pagination.totalPages),
        loading: false,
        accessState: "ready"
      });
    } catch (error) {
      const apiError = error as ApiError;
      const ineligible = apiError.code === "COMPANION_PROFILE_NOT_FOUND" || apiError.code === "COMPANION_OWNER_NOT_ELIGIBLE";
      this.setData({
        loading: false,
        accessState: ineligible ? "ineligible" : "error",
        loadError: errorMessage(error, "可约时段暂时无法加载，请稍后重试。")
      });
    } finally {
      if (stopRefresh) wx.stopPullDownRefresh();
    }
  },
  retry() { this.setData({ actionError: "" }); void this.load(); },
  async loadMoreWindows() {
    if (this.data.loadingMoreWindows || this.data.windowPage >= this.data.windowTotalPages) return;
    this.setData({ loadingMoreWindows: true, actionError: "" });
    try {
      const result = await api.ownAvailabilityWindows({ page: this.data.windowPage + 1, pageSize: 50 });
      const loaded = [
        ...this.data.activeWindows,
        ...this.data.expiredWindows,
        ...this.data.retiredWindows
      ];
      const existingIds = new Set(loaded.map((item) => item.id));
      const items = [
        ...loaded,
        ...(result.items || []).filter((item) => !existingIds.has(item.id)).map(displayWindow)
      ].sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt));
      this.setData({
        activeWindows: items.filter((item) => item.statusClass === "active" || item.statusClass === "inProgress"),
        expiredWindows: items.filter((item) => item.statusClass === "expired"),
        retiredWindows: items.filter((item) => item.statusClass === "retired"),
        totalWindows: result.pagination.total,
        windowPage: result.pagination.page,
        windowTotalPages: Math.max(1, result.pagination.totalPages)
      });
    } catch (error) {
      this.setData({ actionError: errorMessage(error, "更多可约时段暂时无法读取；当前列表不完整。") });
    } finally {
      this.setData({ loadingMoreWindows: false });
    }
  },
  async retireWindow(event: any) {
    const id = event.currentTarget.dataset.id as string;
    const window = this.data.activeWindows.find((item) => item.id === id && item.statusClass === "active");
    if (!window || this.data.retiringWindowId) return;
    const confirmation = await new Promise<any>((resolve) => wx.showModal({
      title: "暂停可约时段",
      content: [
        `${window.dateLabel} ${window.rangeText}`,
        "暂停后客户不能再选择这个时段。已创建的订单不会被取消或改写。",
        "若存在等待确认、待支付、已支付或服务中的订单，平台会拒绝暂停以保护双方履约。"
      ].join("\n"),
      confirmText: "确认暂停",
      success: resolve
    }));
    if (!confirmation.confirm) return;
    this.setData({ retiringWindowId: id, actionError: "" });
    try {
      await api.updateOwnAvailabilityWindow(id, { isActive: false });
      wx.showToast({ title: "时段已暂停", icon: "success" });
      await this.load();
    } catch (error) {
      const message = errorMessage(error, "暂停时段失败，请稍后重试。");
      this.setData({ actionError: message });
      wx.showToast({ title: message, icon: "none" });
    } finally {
      this.setData({ retiringWindowId: "" });
    }
  },
  openCreateWindow() {
    const defaults = availabilityFormDefaults();
    this.setData({
      editorVisible: true,
      editingWindowId: "",
      formDate: defaults.date,
      minDate: defaults.minDate,
      formStartTimeIndex: defaults.startTimeIndex,
      formEndTimeIndex: defaults.endTimeIndex,
      formEndDayHint: endDayHint(defaults.startTimeIndex, defaults.endTimeIndex),
      formCapacity: "1",
      formActive: true,
      formError: ""
    });
  },
  openEditWindow(event: any) {
    const id = event.currentTarget.dataset.id as string;
    const window = this.data.activeWindows.find((item) => item.id === id && item.statusClass === "active");
    const start = window ? shanghaiParts(window.startsAt) : null;
    const end = window ? shanghaiParts(window.endsAt) : null;
    const startTimeIndex = start ? TIME_OPTIONS.indexOf(start.timeLabel) : -1;
    const endTimeIndex = end ? TIME_OPTIONS.indexOf(end.timeLabel) : -1;
    if (!window || !start || !end || startTimeIndex < 0 || endTimeIndex < 0) {
      wx.showToast({ title: "时段数据异常，请刷新后重试", icon: "none" });
      return;
    }
    this.setData({
      editorVisible: true,
      editingWindowId: window.id,
      formDate: start.dateKey,
      minDate: shanghaiParts(new Date())!.dateKey,
      formStartTimeIndex: startTimeIndex,
      formEndTimeIndex: endTimeIndex,
      formEndDayHint: endDayHint(startTimeIndex, endTimeIndex),
      formCapacity: String(window.capacity),
      formActive: window.isActive,
      formError: ""
    });
  },
  closeEditor() {
    if (this.data.saving) return;
    this.setData({ editorVisible: false, formError: "" });
  },
  setFormDate(event: any) { this.setData({ formDate: event.detail.value }); },
  setFormStartTime(event: any) {
    const formStartTimeIndex = Number(event.detail.value);
    this.setData({
      formStartTimeIndex: TIME_OPTIONS[formStartTimeIndex] ? formStartTimeIndex : 0,
      formEndDayHint: endDayHint(TIME_OPTIONS[formStartTimeIndex] ? formStartTimeIndex : 0, this.data.formEndTimeIndex)
    });
  },
  setFormEndTime(event: any) {
    const formEndTimeIndex = Number(event.detail.value);
    this.setData({
      formEndTimeIndex: TIME_OPTIONS[formEndTimeIndex] ? formEndTimeIndex : 0,
      formEndDayHint: endDayHint(this.data.formStartTimeIndex, TIME_OPTIONS[formEndTimeIndex] ? formEndTimeIndex : 0)
    });
  },
  setFormCapacity(event: any) { this.setData({ formCapacity: event.detail.value }); },
  setFormActive(event: any) { this.setData({ formActive: Boolean(event.detail.value) }); },
  async saveWindow() {
    if (this.data.saving) return;
    const startTime = TIME_OPTIONS[this.data.formStartTimeIndex];
    const endTime = TIME_OPTIONS[this.data.formEndTimeIndex];
    const startsAt = windowDateTime(this.data.formDate, startTime);
    let endsAt = windowDateTime(this.data.formDate, endTime);
    const capacity = Number(String(this.data.formCapacity).trim());
    if (!startsAt || !endsAt) {
      this.setData({ formError: "请选择有效的日期和整半点时间。" });
      return;
    }
    if (endsAt.getTime() <= startsAt.getTime()) endsAt = new Date(endsAt.getTime() + DAY_MS);
    if (endsAt.getTime() - startsAt.getTime() > DAY_MS) {
      this.setData({ formError: "单次可约时段最长为 24 小时。" });
      return;
    }
    if (startsAt.getTime() <= Date.now() + MIN_PUBLIC_BOOKING_LEAD_TIME_MS) {
      this.setData({ formError: "开放的时段需至少在 15 分钟后开始。" });
      return;
    }
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 10) {
      this.setData({ formError: "容量请输入 1 至 10 的整数。" });
      return;
    }

    const payload: CreateOwnAvailabilityWindowInput = {
      startsAt: toShanghaiIso(startsAt),
      endsAt: toShanghaiIso(endsAt),
      capacity,
      isActive: this.data.formActive
    };
    const editingWindowId = this.data.editingWindowId;
    this.setData({ saving: true, formError: "" });
    try {
      if (editingWindowId) {
        await api.updateOwnAvailabilityWindow(editingWindowId, {
          startsAt: payload.startsAt,
          endsAt: payload.endsAt,
          capacity: payload.capacity
        });
      } else {
        await api.createOwnAvailabilityWindow(payload);
      }
      this.setData({ editorVisible: false });
      wx.showToast({
        title: editingWindowId ? "时段已更新" : this.data.formActive ? "可约时段已开放" : "时段草稿已保存",
        icon: "success"
      });
      await this.load();
    } catch (error) {
      const message = errorMessage(error, "保存时段失败，请稍后重试。");
      this.setData({ formError: message });
      wx.showToast({ title: message, icon: "none" });
    } finally {
      this.setData({ saving: false });
    }
  }
});
