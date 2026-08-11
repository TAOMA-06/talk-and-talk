function configuredValue(value: string | undefined) {
  return value?.trim() || "";
}

/** Public, optional service-entry configuration for the official site. */
export const miniprogramSearchName =
  configuredValue(process.env.NEXT_PUBLIC_MINIPROGRAM_SEARCH_NAME) || "Talk&Talk";

const ALLOWED_ENTRY_PROTOCOLS = new Set(["weixin:", "https:"]);
const ALLOWED_QR_PROTOCOLS = new Set(["https:"]);
const WEIXIN_ENTRY_HOST = "dl";
const WEIXIN_ENTRY_PATH = "/business/";
const WEIXIN_ENTRY_QUERY_KEY = "t";
/** HTTPS entry deep links and QR images must stay on first-party / WeChat CDN hosts. */
const ALLOWED_HTTPS_HOST_SUFFIXES = [
  "talkandtalk.app",
  "cdn.talkandtalk.app",
  "mmbiz.qpic.cn",
  "wx.qlogo.cn",
];

function isAllowedHost(hostname: string, suffixes: string[]): boolean {
  const host = hostname.toLowerCase();
  if (!host || host.includes("..")) return false;
  return suffixes.some(
    (suffix) => host === suffix || host.endsWith(`.${suffix}`),
  );
}

/**
 * Reject userinfo credentials and fragment injection. Query strings are blocked
 * on https assets (QR/entry) but allowed on weixin: deep links (platform tokens).
 */
function hasUnsafeUrlParts(url: URL, options: { allowQuery?: boolean } = {}): boolean {
  if (url.username || url.password || url.port || url.hash) return true;
  if (!options.allowQuery && url.search) return true;
  return false;
}

/**
 * The custom WeChat scheme is only a transport. Its destination must still be
 * pinned so a configuration typo or hostile value cannot turn the public CTA
 * into an arbitrary weixin: deep link. The platform token is optional, but if
 * present it must be the sole non-empty `t` query parameter.
 */
function isAllowedWeixinEntry(url: URL): boolean {
  if (url.hostname.toLowerCase() !== WEIXIN_ENTRY_HOST || url.pathname !== WEIXIN_ENTRY_PATH) {
    return false;
  }

  const queryEntries = [...url.searchParams.entries()];
  return (
    queryEntries.length === 0 ||
    (queryEntries.length === 1 &&
      queryEntries[0][0] === WEIXIN_ENTRY_QUERY_KEY &&
      queryEntries[0][1].length > 0)
  );
}

export type MiniprogramEntryResolution =
  | { kind: "path"; href: string }
  | { kind: "qr"; href: string }
  | { kind: "fallback"; searchName: string; reason: string };

export type MiniprogramQrResolution =
  | { kind: "qr"; href: string }
  | { kind: "fallback"; reason: string };

type MiniprogramQrEntryResolution =
  | { kind: "qr"; href: string }
  | { kind: "fallback"; searchName: string; reason: string };

function resolveQrUrl(qrUrl: string, searchName: string): MiniprogramQrEntryResolution {
  if (qrUrl) {
    try {
      const url = new URL(qrUrl);
      if (!ALLOWED_QR_PROTOCOLS.has(url.protocol)) {
        return { kind: "fallback", searchName, reason: "qr_protocol_not_allowlisted" };
      }
      if (hasUnsafeUrlParts(url)) {
        return { kind: "fallback", searchName, reason: "qr_url_injection" };
      }
      if (!isAllowedHost(url.hostname, ALLOWED_HTTPS_HOST_SUFFIXES)) {
        return { kind: "fallback", searchName, reason: "qr_host_not_allowlisted" };
      }
      return { kind: "qr", href: qrUrl };
    } catch {
      return { kind: "fallback", searchName, reason: "qr_url_invalid" };
    }
  }

  return { kind: "fallback", searchName, reason: "config_missing" };
}

/**
 * Resolve the official-site Mini Program CTA. Missing or non-allowlisted
 * configuration degrades to an honest search-name fallback (never a fake deep link).
 */
export function resolveMiniprogramEntry(env: {
  path?: string;
  qrUrl?: string;
  searchName?: string;
} = {}): MiniprogramEntryResolution {
  const path = configuredValue(env.path ?? process.env.NEXT_PUBLIC_MINIPROGRAM_PATH);
  const qrUrl = configuredValue(env.qrUrl ?? process.env.NEXT_PUBLIC_MINIPROGRAM_QR_URL);
  const searchName =
    configuredValue(env.searchName ?? process.env.NEXT_PUBLIC_MINIPROGRAM_SEARCH_NAME) ||
    miniprogramSearchName;

  if (path) {
    try {
      const url = new URL(path);
      if (!ALLOWED_ENTRY_PROTOCOLS.has(url.protocol)) {
        return { kind: "fallback", searchName, reason: "entry_protocol_not_allowlisted" };
      }
      if (hasUnsafeUrlParts(url, { allowQuery: url.protocol === "weixin:" })) {
        return { kind: "fallback", searchName, reason: "entry_url_injection" };
      }
      if (url.protocol === "weixin:" && !isAllowedWeixinEntry(url)) {
        return { kind: "fallback", searchName, reason: "entry_weixin_target_not_allowlisted" };
      }
      if (url.protocol === "https:" && !isAllowedHost(url.hostname, ALLOWED_HTTPS_HOST_SUFFIXES)) {
        return { kind: "fallback", searchName, reason: "entry_host_not_allowlisted" };
      }
      return { kind: "path", href: path };
    } catch {
      return { kind: "fallback", searchName, reason: "entry_path_invalid" };
    }
  }

  return resolveQrUrl(qrUrl, searchName);
}

/** Resolve the optional QR separately so a valid QR remains usable beside a deep link. */
export function resolveMiniprogramQr(env: { qrUrl?: string; searchName?: string } = {}): MiniprogramQrResolution {
  const qrUrl = configuredValue(env.qrUrl ?? process.env.NEXT_PUBLIC_MINIPROGRAM_QR_URL);
  const searchName =
    configuredValue(env.searchName ?? process.env.NEXT_PUBLIC_MINIPROGRAM_SEARCH_NAME) ||
    miniprogramSearchName;
  const resolution = resolveQrUrl(qrUrl, searchName);
  return resolution.kind === "qr"
    ? resolution
    : { kind: "fallback", reason: resolution.reason };
}

export function miniprogramCtaCopy(resolution: MiniprogramEntryResolution = resolveMiniprogramEntry()) {
  if (resolution.kind === "fallback") {
    return {
      primary: `在微信中搜索「${resolution.searchName}」小程序`,
      secondary: "官方网站负责说明规则与边界；真实服务请在微信小程序内完成。",
      fallback: true as const,
    };
  }
  return {
    primary: "进入微信小程序",
    secondary: "预约、消息与订单以小程序内服务端事实为准。",
    fallback: false as const,
  };
}
