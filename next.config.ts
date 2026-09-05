import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  compiler: {
    // Automatically strip all console.log in production, preserving console.error & console.warn
    removeConsole:
      process.env.NODE_ENV === "production"
        ? { exclude: ["error", "warn"] }
        : false,
  },
};

export default nextConfig;
