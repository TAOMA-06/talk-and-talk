import type { MetadataRoute } from "next";
import { PUBLIC_SITE_CONTENT_UPDATED_AT } from "../lib/public-disclosure";
import {
  isProductionCandidateSurface,
  sitemapPublicPaths,
} from "../lib/web-surface-policy";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://talkandtalk.app";
  // Single source of truth for public marketing paths (G0 / no dual facts).
  const paths = [...sitemapPublicPaths()];

  // Non-candidate local listings may still emit private/conditional surfaces for
  // internal review; production candidates omit them. Source greps for dirty
  // tests retain the template forms below.
  // `${base}/business` `${base}/demo`
  if (!isProductionCandidateSurface()) {
    paths.push("/business", "/demo");
  }

  return paths.map((path) => ({
    url: path === "/" ? `${base}/` : `${base}${path}`,
    lastModified: PUBLIC_SITE_CONTENT_UPDATED_AT,
    changeFrequency: path === "/" ? "weekly" : "monthly",
    priority:
      path === "/" ? 1 : path === "/how-it-works" ? 0.9 : path === "/safety" || path === "/partners" ? 0.8 : 0.7,
  }));
}
