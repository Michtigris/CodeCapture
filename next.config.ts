import type { NextConfig } from "next";
import os from "os";
import path from "path";

function devOrigins(): string[] {
  const hosts = new Set<string>(["localhost", "127.0.0.1"]);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list ?? []) {
      const family = String(net.family);
      if (family === "IPv4" || family === "4") hosts.add(net.address);
    }
  }
  return [...hosts];
}

const nextConfig: NextConfig = {
  poweredByHeader: false,
  allowedDevOrigins: devOrigins(),
  // Short /ABCDE URLs keep working, but the page lives under /j/[code]
  // so Safari's encoded chunk path (.../j/%5Bcode%5D/...) is served (root /%5Bcode%5D/ 404s).
  async rewrites() {
    return [{ source: "/:code([a-zA-Z]{5})", destination: "/j/:code" }];
  },
  webpack: (config, { isServer }) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      "@prettier/plugin-php/standalone": path.join(process.cwd(), "node_modules/@prettier/plugin-php/src/index.mjs"),
    };
    if (!isServer) {
      config.resolve.fallback = { ...(config.resolve.fallback ?? {}), fs: false, path: false };
    }
    return config;
  },
};

export default nextConfig;
