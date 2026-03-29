import type { NextConfig } from "next";

// next-sitemap.config.js is the single sitemap source of truth
// src/app/sitemap.ts has been removed to prevent duplicate sitemap generation

const nextConfig: NextConfig = {
  images: {
    unoptimized: true,
  },
  async redirects() {
    return [
      {
        source: "/sitemap",
        destination: "/sitemap.xml",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
