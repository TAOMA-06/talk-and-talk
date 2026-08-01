import { Notification } from "./models";

export type NotificationDestination =
  | { kind: "navigateTo"; url: string }
  | { kind: "modal"; title: string; content: string };

function text(data: Record<string, unknown>, key: string): string {
  const value = data[key];
  return typeof value === "string" ? value.trim() : "";
}

function query(path: string, values: Array<[string, string]>): string {
  const encoded = values
    .filter(([, value]) => Boolean(value))
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("&");
  return encoded ? `${path}?${encoded}` : path;
}

/**
 * The single allowlisted notification-routing boundary for every Mini Program
 * surface. Notification payloads may select a known resource identifier but
 * can never provide an arbitrary page URL.
 */
export function notificationDestination(item: Notification): NotificationDestination {
  const data = item.data || {};
  const route = text(data, "route");
  const attendanceDisputeId = text(data, "attendanceDisputeId");
  if (attendanceDisputeId) {
    return { kind: "navigateTo", url: query("/pages/order/dispute", [["id", attendanceDisputeId]]) };
  }

  const supportId = text(data, "supportTicketId") || text(data, "ticketId");
  if (supportId) {
    return { kind: "navigateTo", url: query("/pages/support/detail", [["kind", "support"], ["id", supportId]]) };
  }
  const reportId = text(data, "reportId");
  if (reportId) {
    return { kind: "navigateTo", url: query("/pages/support/detail", [["kind", "safety"], ["id", reportId]]) };
  }

  if (route === "companionDevelopment") {
    return {
      kind: "navigateTo",
      url: query("/pages/companion/development/index", [
        ["actionId", text(data, "actionId")],
        ["appealId", text(data, "appealId")]
      ])
    };
  }

  const accountActionId = text(data, "accountActionId") || (route === "account" ? text(data, "actionId") : "");
  const accountAppealId = text(data, "accountAppealId") || (route === "account" ? text(data, "appealId") : "");
  if (route === "account" || accountActionId || accountAppealId) {
    return {
      kind: "navigateTo",
      url: query("/pages/account/index", [
        ["actionId", accountActionId],
        ["appealId", accountAppealId]
      ])
    };
  }

  const moderationCaseId = text(data, "caseId");
  const moderationAppealId = text(data, "appealId");
  const restrictionId = text(data, "restrictionId");
  if (moderationCaseId || moderationAppealId || restrictionId) {
    return {
      kind: "navigateTo",
      url: query("/pages/safety/index", [
        ["caseId", moderationCaseId],
        ["appealId", moderationAppealId],
        ["restrictionId", restrictionId]
      ])
    };
  }

  const conversationId = text(data, "conversationId");
  if (conversationId) {
    return { kind: "navigateTo", url: query("/pages/chat/index", [["id", conversationId]]) };
  }
  const orderId = text(data, "orderId");
  if (orderId) {
    return { kind: "navigateTo", url: query("/pages/order/detail", [["id", orderId]]) };
  }
  const companionId = text(data, "companionId");
  if (companionId && item.type === "availabilityReminder") {
    return { kind: "navigateTo", url: query("/pages/companion/detail", [["id", companionId]]) };
  }
  return { kind: "modal", title: item.title, content: item.body };
}

export function openNotificationDestination(item: Notification): void {
  const destination = notificationDestination(item);
  if (destination.kind === "navigateTo") {
    wx.navigateTo({ url: destination.url });
    return;
  }
  wx.showModal({
    title: destination.title,
    content: destination.content,
    showCancel: false,
    confirmText: "知道了"
  });
}
