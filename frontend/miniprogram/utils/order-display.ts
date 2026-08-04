import { clientRealtimeVoiceEnabled } from "./config";
import { Order, OrderRefund } from "./models";

const STATUS_LABELS: Record<string, string> = {
  pending: "待确认",
  paying: "支付确认中",
  paid: "已支付",
  inService: "服务中",
  completed: "已完成",
  cancelled: "已取消",
  refunded: "已退款"
};

const REFUND_LABELS: Record<string, string> = {
  pendingReview: "等待人工审核",
  pending: "退款待处理",
  processing: "退款处理中",
  success: "退款成功",
  failed: "退款未完成",
  rejected: "退款申请未通过"
};

export function formatShanghaiDateTime(value?: string | null): string {
  if (!value) return "待确认";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "待确认";
  const shifted = new Date(date.getTime() + 8 * 60 * 60_000);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())} ${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`;
}

export function formatCny(cents: number): string {
  return `¥${(Math.max(0, cents) / 100).toFixed(2)}`;
}

export function orderStatusLabel(order: Order): string {
  return order.refund ? refundStatusLabel(order.refund) : STATUS_LABELS[order.status] || "状态更新中";
}

export function refundStatusLabel(refund: OrderRefund): string {
  return REFUND_LABELS[refund.status] || "退款状态更新中";
}

export function orderServiceName(order: Order): string {
  return order.serviceOfferingSnapshot?.title
    || order.companionSnapshot?.name
    || order.companion?.name
    || "陪伴服务";
}

export function orderCompanionName(order: Order): string {
  return order.companionSnapshot?.name || order.companion?.name || "陪伴者";
}

export function orderDeliveryModeLabel(order: Order): string {
  if (order.serviceOfferingSnapshot?.deliveryMode === "voice") return "订单内实时语音";
  if (order.serviceOfferingSnapshot?.deliveryMode === "text") return "订单内文字陪伴";
  return "以订单约定为准";
}

export function orderStatusExplanation(order: Order): string {
  if (order.refund) {
    if (order.refund.status === "success") return "退款已经完成，实际到账时间以微信支付记录为准。";
    if (order.refund.status === "failed") return "退款未完成，请在安全与客服案件中心补充情况。";
    if (order.refund.status === "rejected") return order.refund.reviewNote || "申请已完成审核；如需复核，请联系平台客服。";
    return "退款申请已经受理；受理不等于到账，请等待渠道最终结果。";
  }
  if (order.status === "pending" && !order.companionConfirmedAt) {
    return `等待陪伴者确认；确认前不会扣款。响应截止：${formatShanghaiDateTime(order.companionResponseDeadlineAt)}。`;
  }
  if ((order.status === "pending" || order.status === "paying") && order.companionConfirmedAt) {
    return order.status === "paying"
      ? "支付结果正在向服务端确认，请勿重复付款。"
      : "陪伴者已确认，请在保留时限内主动完成微信支付。";
  }
  if (order.status === "paid") return `预约已支付，将于 ${formatShanghaiDateTime(order.scheduledAt)} 开始。`;
  if (order.status === "inService") return "服务正在进行；不适时可立即退出并提交安全举报或客服案件。";
  if (order.status === "completed") return "服务已完成；评价、私密体验反馈和售后入口在本页下方。";
  if (order.status === "cancelled") return "订单已取消，原预约时段不再保留。";
  if (order.status === "refunded") return "订单已经退款，到账时间以微信支付记录为准。";
  return "订单状态正在更新，请刷新查看服务端最新结果。";
}

export function canPayOrder(order: Order): boolean {
  return ["pending", "paying"].includes(order.status) && Boolean(order.companionConfirmedAt);
}

export function canRequestRefund(order: Order): boolean {
  if (order.refund && ["pendingReview", "pending", "processing", "success"].includes(order.refund.status)) return false;
  if (["paid", "inService"].includes(order.status)) return true;
  if (order.status !== "completed" || !order.refundRequestDeadlineAt) return false;
  const deadline = Date.parse(order.refundRequestDeadlineAt);
  return Number.isFinite(deadline) && deadline > Date.now();
}

export function canOpenVoiceOrder(order: Order): boolean {
  if (!clientRealtimeVoiceEnabled()) return false;
  return order.serviceOfferingSnapshot?.deliveryMode === "voice"
    && ["inService"].includes(order.status);
}

export function canOpenConversation(order: Order): boolean {
  return Boolean(order.conversationId) && ["paid", "inService", "completed"].includes(order.status);
}
