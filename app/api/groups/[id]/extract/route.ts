import { extractCode } from "@/lib/ai";
import { MAX_PHOTOS_PER_SEND } from "@/lib/constants";
import { json } from "@/lib/http";
import { mimeFor } from "@/lib/sniff";
import { getCurrentUser, resolveOpenAIKey } from "@/lib/session";
import { addCapture, getGroup, isLookOnly, isMember, listPhotos, readPhotoBytes } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return json({ error: "Connexion requise." }, 401);
  const group = await getGroup(id);
  if (!group || !isMember(group, user.id)) return json({ error: "Groupe introuvable." }, 404);
  if (isLookOnly(group, user.id)) return json({ error: "Mode lecture seule." }, 403);

  const body = await request.json().catch(() => ({}));
  const includeSent = body?.all === true;
  let photos = await listPhotos(group.id);
  if (includeSent) photos = photos.slice(-MAX_PHOTOS_PER_SEND);
  else photos = photos.filter((photo) => !photo.captureId).slice(0, MAX_PHOTOS_PER_SEND);
  if (!photos.length) return json({ error: "Aucune photo à envoyer." }, 400);

  const apiKey = resolveOpenAIKey(user);
  if (!apiKey) {
    return json({ error: "Ajoute ta clé API OpenAI dans Réglages." }, 400);
  }

  const images: { id: string; createdAt: string; bytes: Buffer; mime: string }[] = [];
  for (const photo of photos) {
    const bytes = await readPhotoBytes(photo);
    if (!bytes) continue;
    images.push({
      id: photo.id,
      createdAt: photo.createdAt,
      bytes,
      mime: mimeFor(photo.ext),
    });
  }
  if (!images.length) return json({ error: "Les fichiers photo sont introuvables." }, 400);

  try {
    const result = await extractCode({
      apiKey,
      model: user.model,
      brief: group.brief,
      photos: images.map(({ createdAt, bytes, mime }) => ({ createdAt, bytes, mime })),
    });
    if (!result.files.length) {
      return json(
        { error: result.notes || "Aucun fichier lisible sur ces photos. Rapproche l'écran et réessaie." },
        422,
      );
    }
    const capture = await addCapture({
      groupId: group.id,
      notes: result.notes,
      photoIds: images.map((photo) => photo.id),
      files: result.files,
    });
    console.log(`CodeCapture: ${photos.length} photo(s) → ${result.files.length} fichier(s)`);
    return json({
      capture: {
        id: capture.id,
        createdAt: capture.createdAt,
        notes: capture.notes,
        photoCount: capture.photoIds.length,
        files: capture.files,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Extraction impossible.";
    return json({ error: message }, 502);
  }
}
