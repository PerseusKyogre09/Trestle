import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // The repository is pinned to TypeScript 5.9. The compiler API path is
    // the compatible Next.js check until the project adopts TypeScript 7.
    useTypeScriptCli: false,
  },
};

export default nextConfig;
