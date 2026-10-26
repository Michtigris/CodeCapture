import { json } from "@/lib/http";
import { lanUrls, portFromHost } from "@/lib/network";
import { getCurrentUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return json({ error: "Connexion requise." }, 401);
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || url.host;
  const proto = (request.headers.get("x-forwarded-proto") || url.protocol.replace(":", "")).split(",")[0];
  const port = portFromHost(host);
  const hosted = Boolean(process.env["VERCEL"]);
  return json({
    origin: `${proto}://${host}`,
    lan: hosted ? [] : lanUrls(proto, port),
    hosted,
  });
}
