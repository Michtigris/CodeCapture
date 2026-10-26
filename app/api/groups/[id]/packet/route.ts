import { MAX_PHOTOS_PER_SEND } from "@/lib/constants";
import { photosToPdf } from "@/lib/pdf";
import { json } from "@/lib/http";
import { getCurrentUser } from "@/lib/session";
import { getGroup, isMember, listPhotos, readPhotoBytes } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return json({ error: "Connexion requise." }, 401);
  const group = await getGroup(id);
  if (!group || !isMember(group, user.id)) return json({ error: "Groupe introuvable." }, 404);

  const all = new URL(request.url).searchParams.get("all") === "1";
  let photos = await listPhotos(group.id);
  photos = all ? photos.slice(-MAX_PHOTOS_PER_SEND) : photos.filter((photo) => !photo.captureId).slice(0, MAX_PHOTOS_PER_SEND);
  if (!photos.length) return json({ error: "Aucune photo à mettre dans le PDF." }, 400);

  const jpegs: Buffer[] = [];
  const ids: string[] = [];
  for (const photo of photos) {
    if (photo.ext !== "jpg") continue;
    const bytes = await readPhotoBytes(photo);
    if (!bytes) continue;
    jpegs.push(bytes);
    ids.push(photo.id);
  }
  if (!jpegs.length) return json({ error: "Ces photos ne peuvent pas entrer dans le PDF." }, 400);

  const intro = [
    "CodeCapture. Lis les photos de ce PDF dans l'ordre.",
    group.brief.trim(),
    "Reconstitue chaque fichier de code visible.",
    "Reponds uniquement avec un objet JSON de cette forme :",
    '{"files":[{"filename":"animal.php","language":"php","content":"<?php\\n..."}],"notes":""}',
    "Le champ filename est le nom affiche. Le champ content est le fichier brut, sans backticks.",
  ].join("\n");

  try {
    const pdf = photosToPdf({ intro, jpegs });
    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="codecapture.pdf"',
        "Cache-Control": "no-store",
        "X-Photo-Ids": ids.join(","),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "PDF impossible.";
    return json({ error: message }, 500);
  }
}
