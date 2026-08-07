/**
 * Production surface disposition for the official website candidate.
 * G0-D01/D02: marketing public; deferred Web App + BFF/session are feature-gated
 * (not robots/noindex alone). Pure helpers so unit tests drive shipped policy.
 *
 * Fail-closed defaults:
 * - `NODE_ENV=production` (or WEB_SURFACE_MODE=production|candidate) locks deferred
 *   trade surfaces unless explicitly reopened for isolated development.
 * - Local/dev and automated rendered-html checks must set `WEB_SURFACE_MODE=open`
 *   (or development) when deferred pages must remain reachable.
 */

export type WebSurfaceKind =
  | "publicMarketing"
  | "privateConditional"
  | "deferredWebApp"
  | "devOnlyApi";

export type WebSurfaceDisposition =
  | "allow"
  | "notFound"
  | "routeNotAllowed";

export type WebRuntimeMode = "development" | "production" | "test" | "preview";

const PUBLIC_MARKETING_PATHS = new Set([
  "/",
  "/how-it-works",
  "/safety",
  "/about",
  "/partners",
]);

const PRIVATE_CONDITIONAL_PATHS = new Set(["/business", "/demo"]);

const DEFERRED_WEB_APP_PATHS = new Set([
  "/discover",
  "/login",
  "/community",
  "/orders",
  "/messages",
  "/profile",
  "/workbench",
]);

function normalizePath(pathname: string): string {
  if (!pathname) return "/";
  const bare = pathname.split("?")[0]?.split("#")[0] || "/";
  if (bare.length > 1 && bare.endsWith("/")) return bare.slice(0, -1);
  return bare.startsWith("/") ? bare : `/${bare}`;
}

function flagEnabled(value: string | undefined): boolean {
  const flag = (value || "").trim().toLowerCase();
  return flag === "1" || flag === "true" || flag === "yes";
}

export function classifyWebSurface(pathname: string): WebSurfaceKind {
  const path = normalizePath(pathname);
  if (PUBLIC_MARKETING_PATHS.has(path)) return "publicMarketing";
  if (PRIVATE_CONDITIONAL_PATHS.has(path)) return "privateConditional";
  if (path.startsWith("/companions/")) return "deferredWebApp";
  if (DEFERRED_WEB_APP_PATHS.has(path)) return "deferredWebApp";
  if (path.startsWith("/api/session") || path.startsWith("/api/backend")) {
    return "devOnlyApi";
  }
  // Unknown routes are not treated as public marketing; page gates leave them
  // to Next's normal 404 rather than expanding the marketing allow surface.
  return "deferredWebApp";
}

export function resolveWebRuntimeMode(
  nodeEnv = process.env.NODE_ENV,
  explicit = process.env.WEB_SURFACE_MODE,
): WebRuntimeMode {
  const mode = (explicit || nodeEnv || "production").trim().toLowerCase();
  if (mode === "development" || mode === "dev" || mode === "open") return "development";
  if (mode === "test") return "test";
  if (mode === "preview") return "preview";
  if (mode === "candidate") return "production";
  return "production";
}

/**
 * True when this process is a production/candidate public website.
 * Fail-closed: NODE_ENV=production locks unless WEB_SURFACE_MODE explicitly
 * opens the surface (development|open|test).
 */
export function isProductionCandidateSurface(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const mode = (env.WEB_SURFACE_MODE || "").trim().toLowerCase();
  if (mode === "development" || mode === "open" || mode === "test" || mode === "dev") {
    return false;
  }
  if (mode === "production" || mode === "candidate") return true;
  if (flagEnabled(env.WEB_SURFACE_LOCK)) return true;
  const nodeEnv = (env.NODE_ENV || "").trim().toLowerCase();
  // Production runtime without explicit open mode is a candidate lock.
  if (nodeEnv === "production") return true;
  return false;
}

/**
 * Isolated development trade/BFF surfaces require an explicit opt-in flag and a
 * non-production API base URL. Flag alone is not enough.
 */
export function isDeferredWebSurfaceEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!flagEnabled(env.WEB_ENABLE_DEFERRED_SURFACES)) return false;
  const api =
    env.TALKTALK_API_BASE_URL?.trim() ||
    env.NEXT_PUBLIC_API_BASE_URL?.trim() ||
    "";
  if (!api) return false;
  try {
    const host = new URL(api).hostname.toLowerCase();
    const isProdHost =
      host === "api.talkandtalk.app" ||
      (host.endsWith(".talkandtalk.app") &&
        !host.includes("staging") &&
        !host.includes("dev") &&
        !host.includes("local"));
    if (isProdHost && !flagEnabled(env.WEB_ALLOW_PRODUCTION_API)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function isPrivateConditionalSurfaceEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return flagEnabled(env.WEB_ENABLE_PRIVATE_SURFACES);
}

export function dispositionForPath(
  pathname: string,
  env: NodeJS.ProcessEnv = process.env,
): WebSurfaceDisposition {
  const kind = classifyWebSurface(pathname);
  if (kind === "publicMarketing") return "allow";

  if (kind === "privateConditional") {
    if (isPrivateConditionalSurfaceEnabled(env)) return "allow";
    if (isProductionCandidateSurface(env)) return "notFound";
    return "allow";
  }

  if (kind === "deferredWebApp") {
    if (isDeferredWebSurfaceEnabled(env) && !isProductionCandidateSurface(env)) {
      return "allow";
    }
    if (isProductionCandidateSurface(env)) return "notFound";
    // Non-production local builds keep deferred pages for integration/HTML tests
    // when WEB_SURFACE_MODE is open/development/test (or unset with non-prod NODE_ENV).
    return "allow";
  }

  if (kind === "devOnlyApi") {
    if (isProductionCandidateSurface(env)) {
      return isDeferredWebSurfaceEnabled(env) && flagEnabled(env.WEB_ALLOW_PRODUCTION_API)
        ? "allow"
        : "routeNotAllowed";
    }
    return "allow";
  }

  return "allow";
}

export function sitemapPublicPaths(): string[] {
  return ["/", "/how-it-works", "/safety", "/partners", "/about"];
}

export function shouldIndexPath(pathname: string): boolean {
  return classifyWebSurface(pathname) === "publicMarketing";
}
