import { SENSES, gapBySec, isGap, isInterval } from "@/lib/constants";
import { json } from "@/lib/http";
import { getCurrentUser } from "@/lib/session";
import {
  getGroup,
  groupPeople,
  isLookOnly,
  isMember,
  listLiveCameras,
  memberGate,
  pushCameraCommand,
  touchCamera,
} from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function owned(id: string) {
  const user = await getCurrentUser();
  if (!user) return { error: json({ error: "Connexion requise." }, 401) };
  const group = await getGroup(id);
  if (!group || !isMember(group, user.id)) return { error: json({ error: "Groupe introuvable." }, 404) };
  const gate = memberGate(group, user.id);
  if (!gate.ok) {
    return {
      error: json(
        {
          error: gate.reason === "banned" ? "Tu es banni de ce groupe." : "Tu es temporairement exclu.",
          code: gate.reason,
          until: gate.until ?? 0,
        },
        403,
      ),
    };
  }
  return { user, group };
}

function present(
  cameras: Awaited<ReturnType<typeof listLiveCameras>>,
  fallbackInterval: number,
  names: Record<string, string>,
) {
  return cameras.map((camera) => ({
    deviceId: camera.deviceId,
    seenAt: camera.seenAt,
    phone: camera.phone !== false,
    camera: camera.camera === true,
    running: camera.running === true,
    intervalSec: camera.intervalSec || fallbackInterval,
    label: camera.label || (camera.phone !== false ? "Téléphone" : "Ordinateur"),
    ownerName: camera.userId ? names[camera.userId] || "" : "",
    ack: camera.ack || 0,
    nextAt: camera.nextAt && camera.nextAt > Date.now() ? camera.nextAt : 0,
  }));
}

export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const access = await owned(id);
  if ("error" in access && access.error) return access.error;
  const cameras = await listLiveCameras(id);
  const people = await groupPeople(id);
  return json({ cameras: present(cameras, access.group.intervalSec, people.names) });
}

export async function POST(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const access = await owned(id);
  if ("error" in access && access.error) return access.error;
  const body = await request.json().catch(() => null);
  const action = String(body?.action ?? "");
  const targetId = String(body?.targetId ?? "");
  const deviceId = String(body?.deviceId ?? "");

  if (isLookOnly(access.group, access.user.id)) {
    return json({ error: "Mode lecture seule : caméra indisponible." }, 403);
  }

  if (action === "command") {
    if (!/^[0-9a-f-]{16,80}$/i.test(targetId)) return json({ error: "Appareil invalide." }, 400);
    const command = String(body?.command ?? "");
    if (command !== "start" && command !== "stop" && command !== "shoot" && command !== "interval") {
      return json({ error: "Commande invalide." }, 400);
    }
    const intervalSec = Number(body?.intervalSec);
    if (command === "interval" && !isInterval(intervalSec)) return json({ error: "Intervalle invalide." }, 400);
    const sense = SENSES.find((item) => item.id === body?.sense)?.id;
    const gap = isGap(body?.gap) ? gapBySec(body.gap) : undefined;
    const commandId = await pushCameraCommand(id, {
      deviceId: targetId,
      action: command,
      intervalSec: command === "interval" ? intervalSec : undefined,
      sense,
      gap,
    });
    const cameras = await listLiveCameras(id);
    const people = await groupPeople(id);
    return json({ cameras: present(cameras, access.group.intervalSec, people.names), commandId });
  }

  if (!/^[0-9a-f-]{16,80}$/i.test(deviceId)) return json({ error: "Appareil invalide." }, 400);
  const intervalSec = Number(body?.intervalSec);
  const givenName = String(body?.givenName ?? "").trim().split(/\s+/)[0]?.slice(0, 24) ?? "";
  const status = await touchCamera(id, deviceId, body?.phone === true, {
    camera: body?.camera === true,
    running: body?.running === true,
    intervalSec: isInterval(intervalSec) ? intervalSec : undefined,
    givenName: givenName || undefined,
    userId: access.user.id,
    ack: Number(body?.ack) > 0 ? Number(body.ack) : undefined,
    nextAt: Number(body?.nextAt) > Date.now() ? Number(body.nextAt) : 0,
  });
  const cameras = await listLiveCameras(id);
  const people = await groupPeople(id);
  return json({
    cameras: present(cameras, access.group.intervalSec, people.names),
    command: status.command,
    watch: status.watch,
  });
}
