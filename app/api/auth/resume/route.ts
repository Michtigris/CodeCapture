import { json } from "@/lib/http";
import { hashToken } from "@/lib/password";
import { publicUser, setSessionCookie } from "@/lib/session";
import { findUserBySession } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const token = String(body?.token ?? "");
  if (!/^[0-9a-f]{64}$/i.test(token)) return json({ error: "Session expirée." }, 401);
  const user = await findUserBySession(hashToken(token));
  if (!user) return json({ error: "Session expirée." }, 401);
  await setSessionCookie(token);
  return json({ user: publicUser(user) });
}
