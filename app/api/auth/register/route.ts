import { json } from "@/lib/http";
import { hashPassword, newToken } from "@/lib/password";
import { publicUser, setSessionCookie } from "@/lib/session";
import { createSession, createUser, findUserByEmail } from "@/lib/store";
import { hashToken } from "@/lib/password";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    return await register(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("existe déjà")) return json({ error: message }, 409);
    if (message.startsWith("Le ")) return json({ error: message }, 503);
    return json({ error: "Le compte n'a pas pu être créé. Réessaie." }, 503);
  }
}

async function register(request: Request) {
  const body = await request.json().catch(() => null);
  const email = String(body?.email ?? "").trim().toLowerCase();
  const name = String(body?.name ?? "").trim();
  const password = String(body?.password ?? "");

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) {
    return json({ error: "Entre un email valide." }, 400);
  }
  if (name.length < 1 || name.length > 40) {
    return json({ error: "Le prénom doit faire entre 1 et 40 caractères." }, 400);
  }
  if (password.length < 6 || password.length > 200) {
    return json({ error: "Mot de passe trop court (6 caractères minimum)." }, 400);
  }
  if (await findUserByEmail(email)) {
    return json({ error: "Un compte existe déjà avec cet email." }, 409);
  }

  const { hash, salt } = await hashPassword(password);
  const user = await createUser({ email, name, passwordHash: hash, salt });
  const token = newToken();
  await createSession(user.id, hashToken(token));
  await setSessionCookie(token);
  return json({ user: publicUser(user) });
}
