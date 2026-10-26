import { json } from "@/lib/http";
import { sendResetEmail } from "@/lib/mail";
import { sameName } from "@/lib/names";
import { requestOrigin } from "@/lib/origin";
import { hashToken, newToken } from "@/lib/password";
import { dropReset, findUserByEmail, issueReset } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const email = String(body?.email ?? "").trim().toLowerCase();
  const name = String(body?.name ?? "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: "Entre un email valide." }, 400);
  }
  if (name.length < 1 || name.length > 40) {
    return json({ error: "Entre le prénom du compte." }, 400);
  }

  const user = await findUserByEmail(email);
  if (!user) return json({ error: "Aucun compte avec cet email." }, 404);
  if (!sameName(user.name, name)) {
    return json({ error: "Le prénom ne correspond pas à ce compte." }, 400);
  }

  const token = newToken();
  const issued = await issueReset(user.id, hashToken(token));
  if (issued === "soon") {
    return json({ error: "Un email vient d'être envoyé. Attends une minute avant d'en redemander un." }, 429);
  }

  const link = `${requestOrigin(request)}/reinitialiser?token=${token}`;
  try {
    await sendResetEmail(user.email, link);
  } catch (error) {
    await dropReset(hashToken(token));
    const message = error instanceof Error ? error.message : "";
    return json({ error: message.startsWith("L'") ? message : "L'email n'a pas pu être envoyé." }, 503);
  }

  return json({ message: "Un email vient de partir pour choisir un nouveau mot de passe." });
}
