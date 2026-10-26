import { json } from "@/lib/http";
import { hashToken, newToken, verifyPassword } from "@/lib/password";
import { publicUser, setSessionCookie } from "@/lib/session";
import { createSession, findUserByEmail } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    return await login(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("Le ")) return json({ error: message }, 503);
    return json({ error: "La connexion n'a pas pu aboutir. Réessaie." }, 503);
  }
}

async function login(request: Request) {
  const body = await request.json().catch(() => null);
  const email = String(body?.email ?? "").trim().toLowerCase();
  const password = String(body?.password ?? "");
  const user = await findUserByEmail(email);
  if (!user || !(await verifyPassword(password, user.salt, user.passwordHash))) {
    return json({ error: "Email ou mot de passe incorrect." }, 401);
  }
  const token = newToken();
  await createSession(user.id, hashToken(token));
  await setSessionCookie(token);
  return json({ user: publicUser(user), token });
}
