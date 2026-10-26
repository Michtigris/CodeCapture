import { parseAgentJson } from "@/lib/ai";
import { json } from "@/lib/http";
import { getCurrentUser } from "@/lib/session";
import { addCapture, getGroup, isMember, listPhotos } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return json({ error: "Connexion requise." }, 401);
  const group = await getGroup(id);
  if (!group || !isMember(group, user.id)) return json({ error: "Groupe introuvable." }, 404);

  const body = await request.json().catch(() => null);
  const text = String(body?.text ?? "");
  if (text.trim().length < 2 || text.length > 500_000) {
    return json({ error: "Colle la réponse de ChatGPT." }, 400);
  }

  let parsed: ReturnType<typeof parseAgentJson>;
  try {
    parsed = parseAgentJson(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Réponse illisible.";
    return json({ error: message }, 422);
  }
  if (!parsed.files.length) {
    return json({ error: parsed.notes || "Aucun fichier dans cette réponse." }, 422);
  }

  const known = new Set((await listPhotos(group.id)).map((photo) => photo.id));
  const requested = Array.isArray(body?.photoIds) ? body.photoIds.map((item: unknown) => String(item)) : [];
  const photoIds = requested.filter((photoId: string) => known.has(photoId));
  const capture = await addCapture({
    groupId: group.id,
    notes: parsed.notes,
    photoIds,
    files: parsed.files,
  });
  return json({
    capture: {
      id: capture.id,
      createdAt: capture.createdAt,
      notes: capture.notes,
      photoCount: capture.photoIds.length,
      files: capture.files,
    },
  });
}
