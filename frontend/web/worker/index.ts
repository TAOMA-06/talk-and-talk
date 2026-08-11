/** Cloudflare Worker entry point for the Talk&Talk web application. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  // Keep the official Mini Program QR entry usable while excluding arbitrary image hosts.
  "img-src 'self' data: blob: https://talkandtalk.app https://*.talkandtalk.app https://mmbiz.qpic.cn https://wx.qlogo.cn",
  "font-src 'self' data:",
  "connect-src 'self' https://api.talkandtalk.app https://*.talkandtalk.app",
  "media-src 'self' blob:",
].join("; ");

// vinext emits the declared width as the primary `next/image` URL, even when
// its responsive `srcSet` uses the default device widths. These are the fixed
// public brand-mark widths used by the official-site components; keep the
// allowlist narrow rather than accepting arbitrary resize requests.
const PUBLIC_BRAND_IMAGE_WIDTHS = [36, 40, 44, 220, 420];

function withSecurityHeaders(response: Response, url: URL): Response {
  const headers = new Headers(response.headers);
  headers.set("Content-Security-Policy", CONTENT_SECURITY_POLICY);
  headers.set("Permissions-Policy", "camera=(), geolocation=(), microphone=(), payment=(), usb=()");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  if (url.protocol === "https:") {
    headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function enabled(value: string | undefined): boolean {
  return ["1", "true", "yes"].includes((value || "").trim().toLowerCase());
}

interface Env {
  ASSETS?: Fetcher;
  DB: D1Database;
  TALKTALK_API_BASE_URL?: string;
  TALKTALK_IMAGE_TRANSFORM_ENABLED?: string;
  IMAGES?: {
    input?: (stream: ReadableStream) => {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env | undefined, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    // `vinext start`'s local production adapter can call the Worker without a
    // binding object. Cloudflare supplies one in deployment, but public pages
    // must still render locally instead of failing before the app handler.
    const runtimeEnv = env ?? ({} as Env);
    const runtime = globalThis as typeof globalThis & {
      __TALKTALK_API_BASE_URL__?: string;
    };
    runtime.__TALKTALK_API_BASE_URL__ = runtimeEnv.TALKTALK_API_BASE_URL?.trim() || undefined;

    if (url.pathname === "/_vinext/image") {
      const assets = runtimeEnv.ASSETS;
      if (!assets) {
        // A misconfigured candidate must fail as an image-service error rather
        // than throwing an uncaught TypeError. The emitted Worker config
        // declares ASSETS; this branch is defense in depth for a bad runtime.
        return withSecurityHeaders(new Response("Image assets are unavailable", { status: 503 }), url);
      }

      // Static fallback is the first-release default. Only a separately
      // configured Cloudflare deployment may opt into a transformer after its
      // binding is verified; Miniflare otherwise serves the safe source image
      // without emitting a failed-transform error for every public icon.
      const imageInput = enabled(runtimeEnv.TALKTALK_IMAGE_TRANSFORM_ENABLED)
        ? runtimeEnv.IMAGES?.input
        : undefined;
      const allowedWidths = [
        ...new Set([...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES, ...PUBLIC_BRAND_IMAGE_WIDTHS]),
      ];
      const response = await handleImageOptimization(request, {
        fetchAsset: (path) => assets.fetch(new Request(new URL(path, request.url))),
        // A local Worker can have static assets without the Cloudflare Images
        // transformer. vinext then serves the safe source image with its cache
        // headers instead of dereferencing an unavailable binding.
        transformImage: imageInput
          ? async (body, { width, format, quality }) => {
              const result = await imageInput(body)
                .transform(width > 0 ? { width } : {})
                .output({ format, quality });
              return result.response();
            }
          : undefined,
      }, allowedWidths);
      return withSecurityHeaders(response, url);
    }

    return withSecurityHeaders(await handler.fetch(request, runtimeEnv, ctx), url);
  },
};

export default worker;
