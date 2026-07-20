import { api } from "./api";

/**
 * Called only from a clear user action (booking, paying, or enabling service
 * reminders). A missing authorization never blocks the transaction: the
 * in-app order/inbox remains the source of truth.
 */
export type SubscriptionRequestResult = {
  requested: boolean;
  accepted: number;
  recorded: number;
};

export async function requestTransactionalSubscriptions(keys: string[]): Promise<SubscriptionRequestResult> {
  if (!keys.length || typeof wx.requestSubscribeMessage !== "function") {
    return { requested: false, accepted: 0, recorded: 0 };
  }
  try {
    const response = await api.subscriptionTemplates(keys);
    if (!response.enabled || !response.templates.length) return { requested: false, accepted: 0, recorded: 0 };
    const templateIds = response.templates.map((template) => template.templateId).slice(0, 3);
    if (!templateIds.length) return { requested: false, accepted: 0, recorded: 0 };
    const result = await new Promise<Record<string, string>>((resolve, reject) => wx.requestSubscribeMessage({
      tmplIds: templateIds,
      success: (value: Record<string, string>) => resolve(value || {}),
      fail: reject
    }));
    const grants = await Promise.all(response.templates
      .filter((template) => templateIds.includes(template.templateId))
      .map(async (template) => {
        const accepted = result[template.templateId] === "accept";
        if (!accepted) return false;
        try {
          return (await api.recordSubscriptionGrant(template.key, true)).recorded === true;
        } catch {
          return false;
        }
      }));
    const accepted = response.templates.filter((template) => templateIds.includes(template.templateId) && result[template.templateId] === "accept").length;
    return { requested: true, accepted, recorded: grants.filter(Boolean).length };
  } catch {
    // Subscription authorization is optional and platform-controlled. Do not
    // show an alarming error or pretend that a push was guaranteed.
    return { requested: false, accepted: 0, recorded: 0 };
  }
}
