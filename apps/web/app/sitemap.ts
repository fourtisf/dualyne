import type { MetadataRoute } from "next";
import { brand } from "@dualyne/config";
import { STATIC_CATALOG } from "@dualyne/shared";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: `${brand.siteUrl}/`, lastModified: now, changeFrequency: "weekly", priority: 1 },
    ...STATIC_CATALOG.map((m) => ({
      url: `${brand.siteUrl}/models/${m.id}`,
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
    { url: `${brand.siteUrl}/status`, lastModified: now, changeFrequency: "always", priority: 0.4 },
    { url: `${brand.siteUrl}/docs`, lastModified: now, changeFrequency: "weekly", priority: 0.8 },
    { url: `${brand.siteUrl}/terms`, lastModified: now, changeFrequency: "yearly", priority: 0.2 },
    { url: `${brand.siteUrl}/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.2 },
  ];
}
