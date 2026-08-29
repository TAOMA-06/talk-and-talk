import { resolveBackendMediaUrl } from "./api";
import { clientSyntheticDesignAssetsEnabled } from "./config";
import { Companion } from "./models";

type DemoCompanionAsset = { small: string; large: string };

const DEMO_COMPANION_ASSETS: Record<string, DemoCompanionAsset> = {
  c1: { small: "/assets/avatars/c1-linyu-384.webp", large: "/assets/avatars/c1-linyu-768.webp" },
  c2: { small: "/assets/avatars/c2-xuche-384.webp", large: "/assets/avatars/c2-xuche-768.webp" },
  c3: { small: "/assets/avatars/c3-zhouying-384.webp", large: "/assets/avatars/c3-zhouying-768.webp" },
  c4: { small: "/assets/avatars/c4-shenyi-384.webp", large: "/assets/avatars/c4-shenyi-768.webp" },
  c5: { small: "/assets/avatars/c5-wenzhou-384.webp", large: "/assets/avatars/c5-wenzhou-768.webp" }
};

/** Synthetic fallback assets are restricted to the fixed local seed ids. */
export function companionAvatarUrl(companion: Pick<Companion, "id" | "avatarUrl">, size: "small" | "large" = "small") {
  const server = resolveBackendMediaUrl(companion.avatarUrl);
  if (server) return server;
  if (!clientSyntheticDesignAssetsEnabled()) return "";
  return DEMO_COMPANION_ASSETS[companion.id]?.[size] ?? "";
}

export function companionCoverUrl(companion: Pick<Companion, "id" | "coverUrl">) {
  const server = resolveBackendMediaUrl(companion.coverUrl);
  if (server) return server;
  if (!clientSyntheticDesignAssetsEnabled()) return "";
  return DEMO_COMPANION_ASSETS[companion.id] ? HOME_HERO_ASSET : "";
}

export const HOME_HERO_ASSET = "/assets/illustrations/home-hero.webp";
