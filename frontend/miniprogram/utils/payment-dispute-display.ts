import { PaymentDispute, PaymentDisputeStatus } from "./models";
import { formatShanghaiDateTime } from "./order-display";

export type PaymentDisputeView = {
  id: string;
  orderId: string | null;
  ownedOrderIds: string[];
  statusText: string;
  tone: "waiting" | "active" | "resolved" | "attention";
  summary: string;
  occurredAtText: string;
  responseLabel: string;
  responseText: string;
  resolutionLabel: string;
  resolutionText: string;
  updatedText: string;
};

const STATUS: Record<PaymentDisputeStatus, Pick<PaymentDisputeView, "statusText" | "tone" | "summary">> = {
  pendingSync: {
    statusText: "正在同步微信记录",
    tone: "waiting",
    summary: "微信已通知平台，投诉明细仍在同步；最新结果请同时以微信账单内的投诉页为准。"
  },
  open: {
    statusText: "待平台处理",
    tone: "waiting",
    summary: "平台已同步到这笔微信支付投诉，正在等待经办处理。"
  },
  processing: {
    statusText: "处理中",
    tone: "active",
    summary: "平台正在微信支付投诉流程中处理，请关注处理时限和微信账单内的回复。"
  },
  resolved: {
    statusText: "微信侧已处理",
    tone: "resolved",
    summary: "微信侧记录已处理，正式结果仍以微信账单为准；如问题仍未解决，可按微信提供的后续入口继续反馈或投诉。"
  },
  syncFailed: {
    statusText: "状态同步异常",
    tone: "attention",
    summary: "平台暂时无法确认微信侧最新明细，这不代表没有投诉。请稍后刷新或直接在微信账单查看。"
  }
};

export function paymentDisputeView(dispute: PaymentDispute): PaymentDisputeView {
  const state = STATUS[dispute.status] || STATUS.syncFailed;
  const dueText = (value: string | null) => value ? `${formatShanghaiDateTime(value)} 前` : "待微信同步";
  const ownedOrderIds = [...new Set([
    ...(dispute.ownedOrderIds || []),
    ...((dispute.ownedOrders || []).map((item) => item.orderId)),
    ...(dispute.orderId ? [dispute.orderId] : [])
  ].filter(Boolean))];
  return {
    id: dispute.id,
    orderId: dispute.orderId && ownedOrderIds.includes(dispute.orderId)
      ? dispute.orderId
      : ownedOrderIds[0] || null,
    ownedOrderIds,
    ...state,
    occurredAtText: formatShanghaiDateTime(dispute.complaintOccurredAt),
    responseLabel: dispute.firstRespondedAt ? "平台首次回应" : "首次回应目标",
    responseText: dispute.firstRespondedAt
      ? formatShanghaiDateTime(dispute.firstRespondedAt)
      : dueText(dispute.firstResponseDueAt),
    resolutionLabel: dispute.resolvedAt ? "微信侧处理时间" : "处理目标",
    resolutionText: dispute.resolvedAt
      ? formatShanghaiDateTime(dispute.resolvedAt)
      : dueText(dispute.resolutionDueAt),
    updatedText: formatShanghaiDateTime(dispute.updatedAt)
  };
}
