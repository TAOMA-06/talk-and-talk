import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/companions/",
        "/community",
        "/discover",
        "/login",
        "/messages",
        "/orders",
        "/profile",
        "/workbench",
      ],
    },
    sitemap: "https://talkandtalk.app/sitemap.xml",
    host: "https://talkandtalk.app",
  };
}
