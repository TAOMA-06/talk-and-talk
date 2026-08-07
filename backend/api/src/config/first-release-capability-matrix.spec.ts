import {
  firstReleaseCapabilityMatrix,
  isFirstReleaseCapabilityEnabled
} from "./first-release-capability-matrix";

describe("first-release-capability-matrix", () => {
  it("defaults to global text-only fail-closed for every media/voice path", () => {
    const matrix = firstReleaseCapabilityMatrix({
      get: () => undefined
    });
    expect(matrix).toEqual({
      chatMediaUpload: false,
      chatMediaPlayback: false,
      voiceIntro: false,
      trtcUserSig: false,
      voiceSkuActivation: false,
      caseEvidenceMedia: false
    });
    expect(isFirstReleaseCapabilityEnabled("trtcUserSig", { get: () => "text_only" })).toBe(false);
    expect(isFirstReleaseCapabilityEnabled("chatMediaUpload", { get: () => "text_only" })).toBe(false);
  });

  it("opens media capabilities only when COMMERCIAL_SURFACE is full", () => {
    const config = {
      get: (key: string) => (key === "COMMERCIAL_SURFACE" ? "full" : undefined)
    } as Pick<import("@nestjs/config").ConfigService, "get">;
    const matrix = firstReleaseCapabilityMatrix(config);
    expect(matrix.chatMediaUpload).toBe(true);
    expect(matrix.trtcUserSig).toBe(true);
    expect(matrix.voiceSkuActivation).toBe(true);
    expect(matrix.caseEvidenceMedia).toBe(true);
  });
});
