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
  // Short /ABCDE URLs keep working. Page is under /j/[pin] so Safari can load the
  // encoded chunk (.../j/%5Bpin%5D/...). A root /[code] chunk 404s when brackets are encoded.
  async rewrites() {
    return [{ source: "/:pin([a-zA-Z]{5})", destination: "/j/:pin" }];
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
