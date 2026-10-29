import { json } from "@/lib/http";
import { getCurrentUser } from "@/lib/session";
import { getGroup, isLookOnly, isMember, saveInsertedFiles, saveManualFile, setFilesArchived } from "@/lib/store";
import { cleanInsertName, parseInsert } from "@/lib/insert";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return json({ error: "Connexion requise." }, 401);
  const group = await getGroup(id);
  if (!group || !isMember(group, user.id)) return json({ error: "Groupe introuvable." }, 404);
  if (isLookOnly(group, user.id)) return json({ error: "Mode lecture seule." }, 403);

  const body = await request.json().catch(() => null);
  if (Array.isArray(body?.archive) || Array.isArray(body?.restore)) {
    if (group.userId !== user.id) return json({ error: "Seul le créateur du groupe peut archiver." }, 403);
    const source = (Array.isArray(body.archive) ? body.archive : body.restore) as unknown[];
    const names = [...new Set(source.map((item) => (typeof item === "string" ? cleanInsertName(item) : null)).filter((item): item is string => !!item))].slice(0, 200);
    if (!names.length) return json({ error: "Rien à archiver." }, 400);
    const count = await setFilesArchived(group.id, names, Array.isArray(body.archive));
    return json({ ok: true, count });
  }
  if (typeof body?.block === "string") {
    const files = parseInsert(body.block);
    if (!files) return json({ error: "Ce collage n'a pas la forme attendue." }, 400);
    try {
      const placed = await saveInsertedFiles(group.id, files);
      return json(placed);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Enregistrement impossible.";
      return json({ error: message }, 400);
    }
  }
  const filename = String(body?.filename ?? "");
  const content = String(body?.content ?? "");
  const captureId = body?.captureId ? String(body.captureId) : null;
  const archivePending = body?.archivePending === true;
  try {
    const capture = await saveManualFile({ groupId: group.id, captureId, filename, content, archivePending });
    return json({
      capture: {
        id: capture.id,
        createdAt: capture.createdAt,
        notes: capture.notes,
        photoCount: capture.photoIds.length,
        files: capture.files.filter((file) => !file.archivedAt),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Enregistrement impossible.";
    const status = message.startsWith("Le ") || message.startsWith("Nom ") ? 400 : 500;
    return json({ error: message }, status);
  }
}
