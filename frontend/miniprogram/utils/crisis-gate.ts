import { api } from "./api";
import {
  CrisisIntervention,
  CrisisInterventionRiskCode,
  CrisisInterventionSource
} from "./models";

const PENDING_CRISIS_KEY = "talkandtalk.pendingCrisisIntervention";

type PendingCrisisRoute = {
  id?: string;
  source: CrisisInterventionSource;
  riskCode: CrisisInterventionRiskCode;
  region: string;
  createdAt: string;
};

export function pendingCrisisRoute(): PendingCrisisRoute | null {
  const value = wx.getStorageSync(PENDING_CRISIS_KEY) as PendingCrisisRoute | undefined;
  if (!value || typeof value !== "object") return null;
  if (!value.source || !value.riskCode || !/^CN(?:-[0-9]{2})?$/.test(value.region || "")) return null;
  return value;
}

export function rememberPendingCrisisRoute(
  input: Pick<PendingCrisisRoute, "source" | "riskCode" | "region"> & { id?: string }
): void {
  wx.setStorageSync(PENDING_CRISIS_KEY, {
    ...input,
    createdAt: new Date().toISOString()
  });
}

export function rememberPendingCrisisIntervention(intervention: CrisisIntervention): void {
  rememberPendingCrisisRoute({
    id: intervention.id,
    source: intervention.source,
    riskCode: intervention.riskCode,
    region: intervention.region
  });
}

export function clearPendingCrisisRoute(): void {
  wx.removeStorageSync(PENDING_CRISIS_KEY);
}

export function openCrisisResources(input: {
  source: CrisisInterventionSource;
  riskCode: CrisisInterventionRiskCode;
  region?: string;
  id?: string;
}): void {
  const region = input.region && /^CN(?:-[0-9]{2})?$/.test(input.region) ? input.region : "CN";
  rememberPendingCrisisRoute({
    ...(input.id ? { id: input.id } : {}),
    source: input.source,
    riskCode: input.riskCode,
    region
  });
  const query = [
    `source=${encodeURIComponent(input.source)}`,
    `riskCode=${encodeURIComponent(input.riskCode)}`,
    `region=${encodeURIComponent(region)}`,
    input.id ? `id=${encodeURIComponent(input.id)}` : ""
  ].filter(Boolean).join("&");
  wx.navigateTo({ url: `/pages/crisis/index?${query}` });
}

/** Returns false after routing a known pending intervention to resources. */
export async function passCrisisGate(fallbackSource: CrisisInterventionSource): Promise<boolean> {
  try {
    const result = await api.activeCrisisIntervention();
    if (result.intervention?.status === "resourcesPending") {
      rememberPendingCrisisIntervention(result.intervention);
      openCrisisResources({
        id: result.intervention.id,
        source: result.intervention.source,
        riskCode: result.intervention.riskCode,
        region: result.intervention.region
      });
      return false;
    }
    clearPendingCrisisRoute();
    return true;
  } catch {
    // A remembered pending route is a local fail-closed backup. With no known
    // intervention, discovery may remain readable; server order intake is the
    // final authoritative barrier.
    const local = pendingCrisisRoute();
    if (!local) return true;
    openCrisisResources({
      id: local.id,
      source: local.source || fallbackSource,
      riskCode: local.riskCode,
      region: local.region
    });
    return false;
  }
}
