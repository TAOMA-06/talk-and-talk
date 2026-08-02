import type { Order } from "./types";

export const ORDER_STATUS: Record<string, { label: string; tone: string }> = {
  pending: { label: "待陪伴者确认", tone: "amber" },
  paying: { label: "待支付", tone: "amber" },
  paid: { label: "已预约", tone: "blue" },
  inService: { label: "服务中", tone: "rose" },
  completed: { label: "已完成", tone: "green" },
  cancelled: { label: "已取消", tone: "muted" },
  refunded: { label: "已退款", tone: "muted" },
};

const AVAILABILITY_LABELS: Record<string, string> = {
  online: "当前在线",
  available: "可预约",
  busy: "暂忙",
  offline: "暂不在线",
};

export function availabilityLabel(value?: string | null): string {
  if (!value) return "状态待确认";
  return AVAILABILITY_LABELS[value] || value;
}

export function currency(cents?: number | null): string {
  if (cents === null || cents === undefined || Number.isNaN(cents)) return "价格待确认";
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

export function dateTime(value?: string | null, options?: Intl.DateTimeFormatOptions): string {
  if (!value) return "时间待确认";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间待确认";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "short",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    ...options,
  }).format(date);
}

export function relativeTime(value?: string | null): string {
  if (!value) return "";
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return "";
  const minutes = Math.round((timestamp - Date.now()) / 60_000);
  const formatter = new Intl.RelativeTimeFormat("zh-CN", { numeric: "auto" });
  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, "hour");
  return formatter.format(Math.round(hours / 24), "day");
}

export function orderTitle(order: Order): string {
  return (
    order.serviceOfferingSnapshot?.title ||
    order.companionSnapshot?.name ||
    order.companion?.name ||
    "陪伴服务"
  );
}

export function initials(name?: string | null): string {
  const text = name?.trim() || "用户";
  return text.slice(0, 2);
}

export function pickList<T>(value: unknown, keys: string[] = ["items"]): T[] {
  if (Array.isArray(value)) return value as T[];
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    if (Array.isArray(record[key])) return record[key] as T[];
  }
  return [];
}

export function readableError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "服务暂时不可用，请稍后重试";
}
