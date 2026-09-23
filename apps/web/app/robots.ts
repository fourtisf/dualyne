import type { MetadataRoute } from "next";
import { brand } from "@refract/config";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/dashboard", "/health"] }],
    sitemap: `${brand.siteUrl}/sitemap.xml`,
    host: brand.siteUrl,
  };
}
