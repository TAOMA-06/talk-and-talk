const PREVIEW_BACKEND = "https://talk-and-talk-web-api-308403-7-1428040864.sh.run.tcloudbase.com/api/v1";

export type PartnerRuntime = {
  [key: string]: string | undefined;
  WEB_PARTNER_PREVIEW?: string;
  TALKTALK_API_BASE_URL?: string;
  WEB_GATEWAY_SECRET?: string;
};

export function partnerRuntime(): PartnerRuntime {
  return (globalThis as typeof globalThis & { __TALKTALK_PARTNER_RUNTIME__?: PartnerRuntime })
    .__TALKTALK_PARTNER_RUNTIME__ || process.env;
}

export function isPartnerPreviewEnabled(env: PartnerRuntime = partnerRuntime()): boolean {
  return env.WEB_PARTNER_PREVIEW === "true"
    && env.TALKTALK_API_BASE_URL?.replace(/\/+$/, "") === PREVIEW_BACKEND
    && (env.WEB_GATEWAY_SECRET?.length || 0) >= 32;
}
