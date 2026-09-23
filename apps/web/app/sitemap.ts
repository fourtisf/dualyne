import type { MetadataRoute } from "next";
import { brand } from "@refract/config";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: `${brand.siteUrl}/`, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${brand.siteUrl}/docs`, lastModified: now, changeFrequency: "weekly", priority: 0.8 },
    { url: `${brand.siteUrl}/terms`, lastModified: now, changeFrequency: "yearly", priority: 0.2 },
    { url: `${brand.siteUrl}/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.2 },
  ];
}
