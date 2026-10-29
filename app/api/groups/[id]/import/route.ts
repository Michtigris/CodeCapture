import { parseAgentJson } from "@/lib/ai";
import { json } from "@/lib/http";
import { parseInsert } from "@/lib/insert";
import { getCurrentUser } from "@/lib/session";
import { addCapture, getGroup, isMember, listPhotos } from "@/lib/store";
import type { ExtractedFile } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function languageOf(filename: string) {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "php") return "php";
  if (ext === "js" || ext === "mjs" || ext === "cjs") return "javascript";
  if (ext === "ts" || ext === "tsx") return "typescript";
  if (ext === "py") return "python";
  if (ext === "css") return "css";
  if (ext === "html" || ext === "htm") return "html";
  if (ext === "json") return "json";
  return "text";
}

export async function POST(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return json({ error: "Connexion requise." }, 401);
  const group = await getGroup(id);
  if (!group || !isMember(group, user.id)) return json({ error: "Groupe introuvable." }, 404);
  if (group.userId !== user.id) return json({ error: "Réservé au créateur du groupe." }, 403);

  const body = await request.json().catch(() => null);
  const text = String(body?.text ?? "");
  if (text.trim().length < 2 || text.length > 500_000) {
    return json({ error: "Colle la réponse de ChatGPT." }, 400);
  }

  let files: ExtractedFile[] = [];
  let notes = "";
  const inserted = parseInsert(text);
  if (inserted?.length) {
    files = inserted.map((file) => ({
      filename: file.filename,
      language: languageOf(file.filename),
      content: file.content,
    }));
  } else {
    try {
      const parsed = parseAgentJson(text);
      files = parsed.files;
      notes = parsed.notes;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Réponse illisible.";
      return json({ error: message }, 422);
    }
  }
  if (!files.length) {
    return json({ error: notes || "Aucun fichier dans cette réponse." }, 422);
  }

  const known = new Set((await listPhotos(group.id)).map((photo) => photo.id));
  const requested = Array.isArray(body?.photoIds) ? body.photoIds.map((item: unknown) => String(item)) : [];
  const photoIds = requested.filter((photoId: string) => known.has(photoId));
  const capture = await addCapture({
    groupId: group.id,
    notes,
    photoIds,
    files,
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
