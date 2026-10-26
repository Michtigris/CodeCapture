import os from "os";

export function lanUrls(proto: string, port: string): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list ?? []) {
      const family = String(net.family);
      if (net.internal) continue;
      if (family !== "IPv4" && family !== "4") continue;
      const url = `${proto}://${net.address}:${port}`;
      if (seen.has(url)) continue;
      seen.add(url);
      urls.push(url);
    }
  }
  return urls;
}

export function portFromHost(host: string): string {
  if (host.startsWith("[")) {
    const match = host.match(/]:(\d+)$/);
    return match?.[1] ?? "3000";
  }
  const index = host.lastIndexOf(":");
  if (index === -1) return "3000";
  return host.slice(index + 1);
}
