import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { safeNext } from "@/lib/origin";

export function middleware(req: NextRequest) {
  const session = req.cookies.get("cc_session")?.value;
  const { pathname } = req.nextUrl;
  const pinPath = pathname.match(/^\/([a-zA-Z]{5})$/);
  if (pinPath && !session) {
    const url = new URL("/invite", req.url);
    url.searchParams.set("c", pinPath[1].toUpperCase());
    return NextResponse.redirect(url);
  }

  const protectedPath =
    pathname === "/groupes" ||
    pathname.startsWith("/groupes/") ||
    pathname.startsWith("/groupe/") ||
    pathname === "/reglages" ||
    pathname.startsWith("/reglages/") ||
    pathname === "/join";

  if (protectedPath && !session) {
    const url = new URL("/", req.url);
    const next = pathname === "/join" ? req.nextUrl.searchParams.get("c") : null;
    url.searchParams.set("next", next && /^[a-zA-Z]{5}$/.test(next) ? `/${next.toUpperCase()}` : pathname);
    return NextResponse.redirect(url);
  }
  if (pathname === "/" && session) {
    return NextResponse.redirect(new URL(safeNext(req.nextUrl.searchParams.get("next")), req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/groupes", "/groupes/:path*", "/groupe/:path*", "/reglages", "/reglages/:path*", "/join", "/invite", "/:pin"],
};
