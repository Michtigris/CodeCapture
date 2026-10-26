import { json } from "@/lib/http";
import { hashPassword, hashToken, newToken } from "@/lib/password";
import { publicUser, setSessionCookie } from "@/lib/session";
import { createSession, findUserById, resetPassword } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const token = String(body?.token ?? "");
  const password = String(body?.password ?? "");
  if (!/^[0-9a-f]{32,128}$/i.test(token)) {
    return json({ error: "Ce lien n'est plus valable. Redemande un email." }, 400);
  }
  if (password.length < 6 || password.length > 200) {
    return json({ error: "Mot de passe trop court (6 caractères minimum)." }, 400);
  }

  const { hash, salt } = await hashPassword(password);
  const userId = await resetPassword(hashToken(token), hash, salt);
  if (!userId) return json({ error: "Ce lien n'est plus valable. Redemande un email." }, 400);
  const user = await findUserById(userId);
  if (!user) return json({ error: "Ce lien n'est plus valable. Redemande un email." }, 400);

  const session = newToken();
  await createSession(user.id, hashToken(session));
  await setSessionCookie(session);
  return json({ user: publicUser(user), token: session });
}
