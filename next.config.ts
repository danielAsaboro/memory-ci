import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: { typedRoutes: true },
};

export default nextConfig;
