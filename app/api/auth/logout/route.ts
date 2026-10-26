import { json } from "@/lib/http";
import { hashToken } from "@/lib/password";
import { clearSessionCookie, readSessionToken } from "@/lib/session";
import { deleteSession } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const token = await readSessionToken();
  if (token) await deleteSession(hashToken(token));
  await clearSessionCookie();
  return json({ ok: true });
}
