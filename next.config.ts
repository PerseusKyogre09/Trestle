import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
      ],
    }];
  },
  experimental: {
    // The repository is pinned to TypeScript 5.9. The compiler API path is
    // the compatible Next.js check until the project adopts TypeScript 7.
    useTypeScriptCli: false,
  },
};

export default nextConfig;
