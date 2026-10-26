import { json } from "@/lib/http";
import { lanUrls, portFromHost } from "@/lib/network";
import { getCurrentUser } from "@/lib/session";

function isPublicHost(host: string): boolean {
  if (process.env["VERCEL"]) return true;
  const name = host.replace(/:\d+$/, "").replace(/^\[|\]$/g, "").toLowerCase();
  if (!name || name === "localhost" || name === "127.0.0.1" || name === "::1") return false;
  if (name.endsWith(".local")) return false;
  if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(name)) return false;
  return true;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return json({ error: "Connexion requise." }, 401);
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || url.host;
  const proto = (request.headers.get("x-forwarded-proto") || url.protocol.replace(":", "")).split(",")[0];
  const port = portFromHost(host);
  const hosted = isPublicHost(host);
  return json({
    origin: `${proto}://${host}`,
    lan: hosted ? [] : lanUrls(proto, port),
    hosted,
  });
}
