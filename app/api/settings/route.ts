import { isModel } from "@/lib/constants";
import { json } from "@/lib/http";
import { getCurrentUser, publicUser } from "@/lib/session";
import { updateUser } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return json({ error: "Connexion requise." }, 401);
  return json({
    user: publicUser(user),
    keyHint: user.openaiKey ? `…${user.openaiKey.slice(-4)}` : null,
  });
}

export async function PATCH(request: Request) {
  const user = await getCurrentUser();
  if (!user) return json({ error: "Connexion requise." }, 401);
  const body = await request.json().catch(() => null);
  const patch: { name?: string; model?: string; openaiKey?: string | null } = {};

  if (typeof body?.name === "string") {
    const name = body.name.trim();
    if (name.length < 1 || name.length > 40) {
      return json({ error: "Le prénom doit faire entre 1 et 40 caractères." }, 400);
    }
    patch.name = name;
  }
  if (typeof body?.model === "string") {
    if (!isModel(body.model)) return json({ error: "Modèle inconnu." }, 400);
    patch.model = body.model;
  }
  if (body?.clearKey === true) patch.openaiKey = null;
  if (typeof body?.openaiKey === "string" && body.openaiKey.trim()) {
    const key = body.openaiKey.trim();
    if (key.length < 12 || key.length > 300) return json({ error: "Cette clé ne semble pas valide." }, 400);
    patch.openaiKey = key;
  }

  const updated = await updateUser(user.id, patch);
  if (!updated) return json({ error: "Compte introuvable." }, 404);
  return json({
    user: publicUser(updated),
    keyHint: updated.openaiKey ? `…${updated.openaiKey.slice(-4)}` : null,
  });
}
