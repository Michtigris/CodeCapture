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
