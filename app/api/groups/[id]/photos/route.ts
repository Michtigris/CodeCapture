import { json } from "@/lib/http";
import { sniffImage } from "@/lib/sniff";
import { getCurrentUser } from "@/lib/session";
import { addPhoto, deleteHistoryPhotos, getGroup, isLookOnly, isMember } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 7_000_000;

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return json({ error: "Connexion requise." }, 401);
  const group = await getGroup(id);
  if (!group || !isMember(group, user.id)) return json({ error: "Groupe introuvable." }, 404);
  if (isLookOnly(group, user.id)) return json({ error: "Mode lecture seule." }, 403);

  const form = await request.formData();
  const file = form.get("photo");
  if (!(file instanceof File)) return json({ error: "Photo manquante." }, 400);
  if (file.size > MAX_BYTES) return json({ error: "Cette photo est trop lourde." }, 413);
  const bytes = Buffer.from(await file.arrayBuffer());
  const ext = sniffImage(bytes);
  if (!ext) return json({ error: "Ce fichier n'est pas une image." }, 400);

  const photo = await addPhoto(group.id, ext, bytes);
  return json({
    photo: {
      id: photo.id,
      createdAt: photo.createdAt,
      captureId: photo.captureId,
      url: `/api/groups/${group.id}/photos/${photo.id}`,
    },
  });
}

export async function DELETE(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return json({ error: "Connexion requise." }, 401);
  const group = await getGroup(id);
  if (!group || !isMember(group, user.id)) return json({ error: "Groupe introuvable." }, 404);
  if (group.userId !== user.id) return json({ error: "Seul le créateur du groupe peut vider l'historique." }, 403);
  const count = await deleteHistoryPhotos(group.id);
  return json({ ok: true, count });
}
