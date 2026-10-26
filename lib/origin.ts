export function requestOrigin(request: Request): string {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "codecapture.websr.fr";
  const proto = request.headers.get("x-forwarded-proto") ?? (host.includes("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export function safeNext(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || value.includes("?")) {
    return "/groupes";
  }
  const code = value.match(/^\/([A-Za-z]{5})$/);
  if (code) return `/${code[1].toUpperCase()}`;
  if (value === "/groupes" || value === "/reglages" || value.startsWith("/groupe/") || value.startsWith("/reglages/")) {
    return value;
  }
  return "/groupes";
}
