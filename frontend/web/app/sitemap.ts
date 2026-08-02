import type { MetadataRoute } from "next";
import { PUBLIC_SITE_CONTENT_UPDATED_AT } from "../lib/public-disclosure";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://talkandtalk.app";
  return [
    { url: `${base}/`, lastModified: PUBLIC_SITE_CONTENT_UPDATED_AT, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/how-it-works`, lastModified: PUBLIC_SITE_CONTENT_UPDATED_AT, changeFrequency: "monthly", priority: 0.9 },
    { url: `${base}/safety`, lastModified: PUBLIC_SITE_CONTENT_UPDATED_AT, changeFrequency: "monthly", priority: 0.8 },
    { url: `${base}/partners`, lastModified: PUBLIC_SITE_CONTENT_UPDATED_AT, changeFrequency: "monthly", priority: 0.8 },
    { url: `${base}/business`, lastModified: PUBLIC_SITE_CONTENT_UPDATED_AT, changeFrequency: "monthly", priority: 0.7 },
    { url: `${base}/demo`, lastModified: PUBLIC_SITE_CONTENT_UPDATED_AT, changeFrequency: "monthly", priority: 0.7 },
    { url: `${base}/about`, lastModified: PUBLIC_SITE_CONTENT_UPDATED_AT, changeFrequency: "monthly", priority: 0.7 },
  ];
}
