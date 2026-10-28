import { json } from "@/lib/http";
import { hashPassword, verifyPassword } from "@/lib/password";
import { getCurrentUser, publicUser } from "@/lib/session";
import { updateUser } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return json({ error: "Connexion requise." }, 401);
  return json({ user: publicUser(user) });
}

export async function PATCH(request: Request) {
  const user = await getCurrentUser();
  if (!user) return json({ error: "Connexion requise." }, 401);
  const body = await request.json().catch(() => null);
  const patch: { name?: string; email?: string; passwordHash?: string; salt?: string } = {};

  if (typeof body?.name === "string") {
    const name = body.name.trim();
    if (name.length < 1 || name.length > 40) {
      return json({ error: "Le prénom doit faire entre 1 et 40 caractères." }, 400);
    }
    patch.name = name;
  }
  if (typeof body?.email === "string") {
    const email = body.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) {
      return json({ error: "Entre un email valide." }, 400);
    }
    patch.email = email;
  }
  if (typeof body?.password === "string" && body.password.length > 0) {
    const next = body.password;
    const current = String(body?.currentPassword ?? "");
    if (next.length < 6 || next.length > 200) {
      return json({ error: "Mot de passe trop court (6 caractères minimum)." }, 400);
    }
    if (!(await verifyPassword(current, user.salt, user.passwordHash))) {
      return json({ error: "Le mot de passe actuel est incorrect." }, 400);
    }
    const hashed = await hashPassword(next);
    patch.passwordHash = hashed.hash;
    patch.salt = hashed.salt;
  }

  try {
    const updated = await updateUser(user.id, patch);
    if (!updated) return json({ error: "Compte introuvable." }, 404);
    return json({ user: publicUser(updated) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("existe déjà")) return json({ error: message }, 409);
    throw error;
  }
}
