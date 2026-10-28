import { json } from "@/lib/http";
import { getCurrentUser } from "@/lib/session";
import { countForGroups, createGroup } from "@/lib/store";
import type { GroupSummary } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return json({ error: "Connexion requise." }, 401);
  const snap = await countForGroups(user.id);
  const groups: GroupSummary[] = snap.groups
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((group) => {
      const photos = snap.photos.filter((photo) => photo.groupId === group.id);
      const captures = snap.captures
        .filter((capture) => capture.groupId === group.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const latest = captures[0];
      return {
        id: group.id,
        name: group.name,
        code: group.code,
        brief: group.brief,
        intervalSec: group.intervalSec,
        createdAt: group.createdAt,
        copiedIds: group.copiedIds ?? [],
        photoCount: photos.length,
        pendingCount: photos.filter((photo) => !photo.captureId).length,
        fileCount: latest?.files.filter((file) => !file.archivedAt).length ?? 0,
        memberCount: new Set(group.memberIds).size,
        creatorName: snap.names[group.userId] || "Inconnu",
        lastCaptureAt: latest?.createdAt ?? null,
        owner: group.userId === user.id,
      };
    });
  return json({ groups });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return json({ error: "Connexion requise." }, 401);
  const body = await request.json().catch(() => null);
  const name = String(body?.name ?? "").trim();
  if (name.length < 1 || name.length > 60) {
    return json({ error: "Donne un nom de groupe (60 caractères maximum)." }, 400);
  }
  if (name.toLowerCase() === user.email.toLowerCase()) {
    return json({ error: "Le nom du groupe n'est pas l'email du compte." }, 400);
  }
  const group = await createGroup(user.id, name);
  return json({ group });
}
