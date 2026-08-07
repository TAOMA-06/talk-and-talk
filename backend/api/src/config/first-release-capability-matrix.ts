import type { ConfigService } from "@nestjs/config";

import { isCommercialTextOnlySurface } from "./commercial-surface";

/**
 * First-release (G1) capability matrix. MP-D05 default: global text-only with
 * no media exceptions. Pure helpers so unit tests drive the shipped policy.
 */
export type FirstReleaseCapability =
  | "chatMediaUpload"
  | "chatMediaPlayback"
  | "voiceIntro"
  | "trtcUserSig"
  | "voiceSkuActivation"
  | "caseEvidenceMedia";

export type FirstReleaseCapabilityMatrix = Record<FirstReleaseCapability, boolean>;

export function firstReleaseCapabilityMatrix(
  config?: Pick<ConfigService, "get"> | null
): FirstReleaseCapabilityMatrix {
  const textOnly = isCommercialTextOnlySurface(config);
  const mediaAllowed = !textOnly;
  return {
    chatMediaUpload: mediaAllowed,
    chatMediaPlayback: mediaAllowed,
    voiceIntro: mediaAllowed,
    trtcUserSig: mediaAllowed,
    voiceSkuActivation: mediaAllowed,
    // MP-D05 global text-only: case-evidence media is also fail-closed for first release.
    caseEvidenceMedia: mediaAllowed
  };
}

export function isFirstReleaseCapabilityEnabled(
  capability: FirstReleaseCapability,
  config?: Pick<ConfigService, "get"> | null
): boolean {
  return firstReleaseCapabilityMatrix(config)[capability];
}
