import type { MetadataRoute } from "next";
import { brand } from "@dualyne/config";
import { STATIC_CATALOG } from "@dualyne/shared";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    {
      url: `${brand.siteUrl}/`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 1,
      alternates: { languages: { en: `${brand.siteUrl}/`, id: `${brand.siteUrl}/id` } },
    },
    {
      url: `${brand.siteUrl}/id`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.9,
      alternates: { languages: { en: `${brand.siteUrl}/`, id: `${brand.siteUrl}/id` } },
    },
    ...STATIC_CATALOG.flatMap((m) =>
      (["", "/id"] as const).map((prefix) => ({
        url: `${brand.siteUrl}${prefix}/models/${m.id}`,
        lastModified: now,
        changeFrequency: "weekly" as const,
        priority: prefix ? 0.6 : 0.7,
        alternates: {
          languages: {
            en: `${brand.siteUrl}/models/${m.id}`,
            id: `${brand.siteUrl}/id/models/${m.id}`,
          },
        },
      })),
    ),
    { url: `${brand.siteUrl}/status`, lastModified: now, changeFrequency: "always", priority: 0.4 },
    { url: `${brand.siteUrl}/docs`, lastModified: now, changeFrequency: "weekly", priority: 0.8 },
    { url: `${brand.siteUrl}/terms`, lastModified: now, changeFrequency: "yearly", priority: 0.2 },
    { url: `${brand.siteUrl}/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.2 },
  ];
}
