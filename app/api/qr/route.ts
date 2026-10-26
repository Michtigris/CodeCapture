import QRCode from "qrcode";
import { requestOrigin } from "@/lib/origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function allowedPath(path: string): boolean {
  if (path === "/" || path === "/groupes" || path === "/reglages") return true;
  if (/^\/[A-Za-z]{5}$/.test(path)) return true;
  return /^\/groupe\/[A-Za-z0-9-]{8,80}$/.test(path);
}

export async function GET(request: Request) {
  const path = new URL(request.url).searchParams.get("path") || "/";
  if (!allowedPath(path)) return new Response("Lien invalide.", { status: 400 });
  const target = `${requestOrigin(request)}${path === "/" ? "" : path}`;
  const svg = await QRCode.toString(target, {
    type: "svg",
    margin: 1,
    width: 180,
    errorCorrectionLevel: "M",
    color: { dark: "#0e0f0c", light: "#f4f1e8" },
  });
  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
