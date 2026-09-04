export type MiniProgramEnvironment = "develop" | "trial" | "release";

export type BackendConfig =
  | { transport: "https"; baseUrl: string }
  | { transport: "cloudRun"; envId: string; service: string; apiPrefix: string };

/** HTTPS endpoints remain as an explicit fallback for non-CloudBase clients. */
const HTTPS_BACKENDS: Record<MiniProgramEnvironment, string> = {
  develop: "https://api-staging.talkandtalk.app/api/v1",
  trial: "https://api-staging.talkandtalk.app/api/v1",
  release: "https://api.talkandtalk.app/api/v1"
};

/** v1.0 uses the existing CloudBase environment for developer, trial and release builds. */
const CLOUD_RUN_ENV_IDS: Record<MiniProgramEnvironment, string> = {
  develop: "talk-and-talk-staging-d6d04a14b8",
  trial: "talk-and-talk-staging-d6d04a14b8",
  release: "talk-and-talk-staging-d6d04a14b8"
};

const USE_CLOUD_RUN: Record<MiniProgramEnvironment, boolean> = {
  develop: true,
  trial: true,
  release: true
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

/** Synthetic UI fixtures are allowed only in explicitly identified local/staging builds. */
export function clientSyntheticDesignAssetsEnabled(): boolean {
  try {
    const value = wx.getAccountInfoSync?.().miniProgram?.envVersion;
    return value === "develop" || value === "trial";
  } catch {
    return false;
  }
}

/**
 * `miniProgramEnvironment()` deliberately falls back to develop for transport
 * configuration in older tools. Capability safety has a stricter rule: only a
 * positively identified Developer Tools build may exercise dormant media/voice
 * code. Unknown, missing, or failed environment discovery is text-only.
 */
function isExplicitDevelopmentEnvironment(): boolean {
  try {
    return wx.getAccountInfoSync?.().miniProgram?.envVersion === "develop";
  } catch {
    return false;
  }
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
  privacy: "https://talk-and-talk-staging-d6d04a14b8-1428040864.tcloudbaseapp.com/legal/privacy.html",
  terms: "https://talk-and-talk-staging-d6d04a14b8-1428040864.tcloudbaseapp.com/legal/terms.html"
} as const;

export const LEGAL_CONSENT_VERSION = "2.2-2026-08-01";

/**
 * First commercial release stays text-only. Chat media uploads and TRTC voice
 * stay in the codebase for later activation, but default UX must not surface
 * those entry points until MEDIA/TRTC production evidence is archived.
 * A test-only override may exercise dormant capability code in `develop`, but
 * cannot reopen it in an experience build or a released Mini Program.
 */
const COMMERCIAL_TEXT_ONLY_DEFAULT = true;

export function isCommercialTextOnly(): boolean {
  // `trial` is an externally consumable experience build and `release` is the
  // production build. They must fail closed even when developer tooling or a
  // stale global override tries to opt them into dormant media/voice code.
  if (!isExplicitDevelopmentEnvironment()) return true;

  const override = (globalThis as { __TALK_AND_TALK_COMMERCIAL_TEXT_ONLY__?: boolean })
    .__TALK_AND_TALK_COMMERCIAL_TEXT_ONLY__;
  if (typeof override === "boolean") return override;
  return COMMERCIAL_TEXT_ONLY_DEFAULT;
}

/** Server mediaEnabled is still authoritative once text-only scope is lifted. */
export function clientChatMediaEnabled(serverEnabled: boolean): boolean {
  return !isCommercialTextOnly() && serverEnabled;
}

export function clientRealtimeVoiceEnabled(): boolean {
  return !isCommercialTextOnly();
}

/** Voice intro playback/edit is part of the global text-only fail-closed matrix. */
export function clientVoiceIntroEnabled(): boolean {
  return !isCommercialTextOnly();
}

/** Companion profile image management uses the same fail-closed media surface. */
export function clientCompanionProfileMediaEnabled(): boolean {
  return !isCommercialTextOnly();
}

/** Voice SKU create/activate is unreachable while text-only is on. */
export function clientVoiceSkuEnabled(): boolean {
  return !isCommercialTextOnly();
}
