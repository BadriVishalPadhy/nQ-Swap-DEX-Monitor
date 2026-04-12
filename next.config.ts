import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Turbopack configuration (Next.js 16 default bundler)
  turbopack: {},
  // Allow external packages in server-side code
  serverExternalPackages: ['ws'],
};

export default nextConfig;
