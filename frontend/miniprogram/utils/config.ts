export type MiniProgramEnvironment = "develop" | "trial" | "release";

export type BackendConfig =
  | { transport: "https"; baseUrl: string }
  | { transport: "cloudRun"; envId: string; service: string; apiPrefix: string };

/**
 * HTTPS remains the safe default and is also used by iOS and WeChat Pay callbacks.
 * `trial` intentionally targets staging so an experience build cannot mutate production.
 */
const HTTPS_BACKENDS: Record<MiniProgramEnvironment, string> = {
  develop: "https://api-staging.talkandtalk.app/api/v1",
  trial: "https://api-staging.talkandtalk.app/api/v1",
  release: "https://api.talkandtalk.app/api/v1"
};

/**
 * After creating the matching CloudBase environments, fill their IDs and switch the
 * corresponding flag to true. Release refuses an empty environment ID at runtime.
 */
const CLOUD_RUN_ENV_IDS: Record<MiniProgramEnvironment, string> = {
  develop: "",
  trial: "",
  release: ""
};

const USE_CLOUD_RUN: Record<MiniProgramEnvironment, boolean> = {
  develop: false,
  trial: false,
  release: false
};

const CLOUD_RUN_SERVICE = "talk-and-talk-api";

export function miniProgramEnvironment(): MiniProgramEnvironment {
  try {
    const value = wx.getAccountInfoSync?.().miniProgram?.envVersion;
    if (value === "trial" || value === "release") return value;
  } catch {
    // Tourist AppID and older developer tools may not expose account information.
  }
  return "develop";
}

export function backendConfig(): BackendConfig {
  const environment = miniProgramEnvironment();
  if (!USE_CLOUD_RUN[environment]) {
    return { transport: "https", baseUrl: HTTPS_BACKENDS[environment] };
  }

  const envId = CLOUD_RUN_ENV_IDS[environment].trim();
  if (!envId) {
    throw new Error(`CloudBase environment ID is missing for ${environment}`);
  }

  return {
    transport: "cloudRun",
    envId,
    service: CLOUD_RUN_SERVICE,
    apiPrefix: "/api/v1"
  };
}

export const LEGAL_URLS = {
  privacy: "https://api.talkandtalk.app/legal/privacy.html",
  terms: "https://api.talkandtalk.app/legal/terms.html"
} as const;

export const LEGAL_CONSENT_VERSION = "2.0-2026-07-20";
