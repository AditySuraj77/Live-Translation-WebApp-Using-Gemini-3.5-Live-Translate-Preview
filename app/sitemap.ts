import type { MetadataRoute } from "next";
import { POPULAR_PAIRS } from "@/lib/seo-pairs";

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://lingualive.app";

  const pairEntries: MetadataRoute.Sitemap = POPULAR_PAIRS.map((pair) => ({
    url: `${baseUrl}/translate/${pair.slug}`,
    lastModified: new Date(),
    changeFrequency: "weekly" as const,
    priority: 0.8,
  }));

  return [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: "daily" as const,
      priority: 1.0,
    },
    ...pairEntries,
  ];
}
