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
  batches: number;
  /** Opaque, one-time grants returned only to the immediate caller that needs
   * to bind a user-selected preference. Do not display or persist these on the
   * Mini Program. */
  grants: Array<{ templateKey: string; grantId: string }>;
};

export async function requestTransactionalSubscriptions(keys: string[]): Promise<SubscriptionRequestResult> {
  if (!keys.length || typeof wx.requestSubscribeMessage !== "function") {
    return { requested: false, accepted: 0, recorded: 0, batches: 0, grants: [] };
  }
  try {
    const response = await api.subscriptionTemplates(keys);
    if (!response.enabled || !response.templates.length) return { requested: false, accepted: 0, recorded: 0, batches: 0, grants: [] };
    // WeChat allows at most three templates per native authorization panel.
    // Keep every backend-configured key instead of silently slicing later
    // templates away; duplicate ids are still sent only once per panel.
    const templateIds = [...new Set(response.templates
      .map((template) => template.templateId)
      .filter((templateId) => typeof templateId === "string" && Boolean(templateId.trim())))];
    if (!templateIds.length) return { requested: false, accepted: 0, recorded: 0, batches: 0, grants: [] };
    const batches = Array.from({ length: Math.ceil(templateIds.length / 3) }, (_, index) => templateIds.slice(index * 3, index * 3 + 3));
    let requested = false;
    let accepted = 0;
    let recorded = 0;
    const grants: Array<{ templateKey: string; grantId: string }> = [];
    for (const batch of batches) {
      requested = true;
      try {
        const result = await new Promise<Record<string, string>>((resolve, reject) => wx.requestSubscribeMessage({
          tmplIds: batch,
          success: (value: Record<string, string>) => resolve(value || {}),
          fail: reject
        }));
        const acceptedTemplates = response.templates.filter((template) =>
          batch.includes(template.templateId) && result[template.templateId] === "accept"
        );
        accepted += acceptedTemplates.length;
        const recordedGrants = await Promise.all(acceptedTemplates.map(async (template) => {
          try {
            const response = await api.recordSubscriptionGrant(template.key, true);
            return {
              templateKey: template.key,
              recorded: response.recorded === true,
              grantId: response.grantId
            };
          } catch {
            return { templateKey: template.key, recorded: false, grantId: undefined };
          }
        }));
        recorded += recordedGrants.filter((grant) => grant.recorded).length;
        grants.push(...recordedGrants.flatMap((grant) =>
          grant.recorded && typeof grant.grantId === "string" && grant.grantId
            ? [{ templateKey: grant.templateKey, grantId: grant.grantId }]
            : []
        ));
      } catch {
        // A user can decline one batch and still choose another. Continue so a
        // temporary platform-level failure never drops unrelated reminders.
      }
    }
    return { requested, accepted, recorded, batches: batches.length, grants };
  } catch {
    // Subscription authorization is optional and platform-controlled. Do not
    // show an alarming error or pretend that a push was guaranteed.
    return { requested: false, accepted: 0, recorded: 0, batches: 0, grants: [] };
  }
}
