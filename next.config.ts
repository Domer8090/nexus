import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // The dev server binds to 127.0.0.1 (see package.json); allow that origin for dev assets and HMR.
  allowedDevOrigins: ["127.0.0.1"],
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
