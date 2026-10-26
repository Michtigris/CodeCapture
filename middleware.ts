import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { safeNext } from "@/lib/origin";

export function middleware(req: NextRequest) {
  const session = req.cookies.get("cc_session")?.value;
  const { pathname } = req.nextUrl;
  const codePath = pathname.match(/^\/([a-zA-Z]{5})$/);
  if (codePath && !session) {
    const url = new URL("/", req.url);
    url.searchParams.set("next", `/${codePath[1].toUpperCase()}`);
    return NextResponse.redirect(url);
  }

  const protectedPath =
    pathname === "/groupes" ||
    pathname.startsWith("/groupes/") ||
    pathname.startsWith("/groupe/") ||
    pathname === "/reglages" ||
    pathname.startsWith("/reglages/");

  if (protectedPath && !session) {
    const url = new URL("/", req.url);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  if (pathname === "/" && session) {
    return NextResponse.redirect(new URL(safeNext(req.nextUrl.searchParams.get("next")), req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/groupes", "/groupes/:path*", "/groupe/:path*", "/reglages", "/reglages/:path*", "/:code"],
};
