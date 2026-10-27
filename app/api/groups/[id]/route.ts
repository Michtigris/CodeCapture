import { isInterval } from "@/lib/constants";
import { json } from "@/lib/http";
import { getCurrentUser } from "@/lib/session";
import { getGroup, isMember, listLiveCameras, loadGroupBundle, pruneHistoryPhotos, rememberCopiedPhotos, updateGroup, deleteGroup } from "@/lib/store";
import type { CaptureDTO, PhotoDTO } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function ownedGroup(id: string) {
  const user = await getCurrentUser();
  if (!user) return { error: json({ error: "Connexion requise." }, 401) };
  const group = await getGroup(id);
  if (!group || !isMember(group, user.id)) return { error: json({ error: "Groupe introuvable." }, 404) };
  return { user, group };
}

export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const access = await ownedGroup(id);
  if ("error" in access && access.error) return access.error;
  await pruneHistoryPhotos();
  const bundle = await loadGroupBundle(id);
  if (!bundle) return json({ error: "Groupe introuvable." }, 404);
  const { group, photos, captures } = bundle;
  const cameras = await listLiveCameras(group.id);
  const photoDTOs: PhotoDTO[] = photos.map((photo) => ({
    id: photo.id,
    createdAt: photo.createdAt,
    captureId: photo.captureId,
    url: `/api/groups/${group.id}/photos/${photo.id}`,
  }));
  const captureDTOs: CaptureDTO[] = captures.map((capture) => ({
    id: capture.id,
    createdAt: capture.createdAt,
    notes: capture.notes,
    photoCount: capture.photoIds.length,
    files: capture.files.filter((file) => !file.archivedAt),
  }));
  return json({
    group: {
      id: group.id,
      name: group.name,
      code: group.code,
      brief: group.brief,
      intervalSec: group.intervalSec,
      createdAt: group.createdAt,
      copiedIds: group.copiedIds ?? [],
      owner: group.userId === access.user.id,
    },
    photos: photoDTOs,
    captures: captureDTOs,
    cameras: cameras.map((camera) => ({
      deviceId: camera.deviceId,
      seenAt: camera.seenAt,
      phone: camera.phone !== false,
      camera: camera.camera === true,
      running: camera.running === true,
      intervalSec: camera.intervalSec || group.intervalSec,
      label: camera.label || (camera.phone !== false ? "Téléphone" : "Ordinateur"),
      ack: camera.ack || 0,
      nextAt: camera.nextAt && camera.nextAt > Date.now() ? camera.nextAt : 0,
    })),
  });
}

export async function PATCH(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const access = await ownedGroup(id);
  if ("error" in access && access.error) return access.error;
  const body = await request.json().catch(() => null);
  const patch: { name?: string; brief?: string; intervalSec?: number } = {};
  if (typeof body?.name === "string") {
    const name = body.name.trim();
    if (name.length < 1 || name.length > 60) return json({ error: "Nom de groupe invalide." }, 400);
    if (name.toLowerCase() === access.user.email.toLowerCase()) {
      return json({ error: "Le nom du groupe n'est pas l'email du compte." }, 400);
    }
    patch.name = name;
  }
  if (typeof body?.brief === "string") {
    if (body.brief.length > 4000) return json({ error: "Les consignes sont trop longues." }, 400);
    patch.brief = body.brief;
  }
  if (body?.intervalSec !== undefined) {
    const intervalSec = Number(body.intervalSec);
    if (!isInterval(intervalSec)) return json({ error: "Intervalle invalide." }, 400);
    patch.intervalSec = intervalSec;
  }
  if (Array.isArray(body?.copiedIds)) {
    const ids = body.copiedIds.filter((item: unknown): item is string => typeof item === "string").slice(0, 24);
    const copiedIds = await rememberCopiedPhotos(id, ids);
    if (!Object.keys(patch).length) return json({ copiedIds });
  }
  const group = await updateGroup(id, patch);
  return json({ group });
}

export async function DELETE(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const access = await ownedGroup(id);
  if ("error" in access && access.error) return access.error;
  if (access.group.userId !== access.user.id) {
    return json({ error: "Seul le créateur peut supprimer ce groupe." }, 403);
  }
  await deleteGroup(id);
  return json({ ok: true });
}
