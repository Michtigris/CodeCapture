import { json } from "@/lib/http";
import { mimeFor } from "@/lib/sniff";
import { getCurrentUser } from "@/lib/session";
import { deletePhoto, getGroup, getPhoto, isMember, readPhotoBytes } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; photoId: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  const { id, photoId } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return json({ error: "Connexion requise." }, 401);
  const group = await getGroup(id);
  if (!group || !isMember(group, user.id)) return json({ error: "Groupe introuvable." }, 404);
  const photo = await getPhoto(photoId);
  if (!photo || photo.groupId !== group.id) return json({ error: "Photo introuvable." }, 404);
  const buf = await readPhotoBytes(photo);
  if (!buf) return json({ error: "Photo introuvable." }, 404);
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": mimeFor(photo.ext),
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}

export async function DELETE(_request: Request, ctx: Ctx) {
  const { id, photoId } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return json({ error: "Connexion requise." }, 401);
  const group = await getGroup(id);
  if (!group || !isMember(group, user.id)) return json({ error: "Groupe introuvable." }, 404);
  const photo = await getPhoto(photoId);
  if (!photo || photo.groupId !== group.id) return json({ error: "Photo introuvable." }, 404);
  if (photo.captureId && group.userId !== user.id) {
    return json({ error: "Seul le créateur du groupe peut retirer une photo de l'historique." }, 403);
  }
  await deletePhoto(photo.id);
  return json({ ok: true });
}
