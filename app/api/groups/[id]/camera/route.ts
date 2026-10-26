import { isInterval } from "@/lib/constants";
import { json } from "@/lib/http";
import { getCurrentUser } from "@/lib/session";
import { getGroup, isMember, listLiveCameras, pushCameraCommand, touchCamera } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function owned(id: string) {
  const user = await getCurrentUser();
  if (!user) return { error: json({ error: "Connexion requise." }, 401) };
  const group = await getGroup(id);
  if (!group || !isMember(group, user.id)) return { error: json({ error: "Groupe introuvable." }, 404) };
  return { group };
}

function present(cameras: Awaited<ReturnType<typeof listLiveCameras>>, fallbackInterval: number) {
  return cameras.map((camera) => ({
    deviceId: camera.deviceId,
    seenAt: camera.seenAt,
    phone: camera.phone !== false,
    camera: camera.camera === true,
    running: camera.running === true,
    intervalSec: camera.intervalSec || fallbackInterval,
    label: camera.label || (camera.phone !== false ? "Téléphone" : "Ordinateur"),
    ack: camera.ack || 0,
  }));
}

export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const access = await owned(id);
  if ("error" in access && access.error) return access.error;
  const cameras = await listLiveCameras(id);
  return json({ cameras: present(cameras, access.group.intervalSec) });
}

export async function POST(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const access = await owned(id);
  if ("error" in access && access.error) return access.error;
  const body = await request.json().catch(() => null);
  const action = String(body?.action ?? "");
  const targetId = String(body?.targetId ?? "");
  const deviceId = String(body?.deviceId ?? "");

  if (action === "command") {
    if (!/^[0-9a-f-]{16,80}$/i.test(targetId)) return json({ error: "Appareil invalide." }, 400);
    const command = String(body?.command ?? "");
    if (command !== "start" && command !== "stop" && command !== "shoot" && command !== "interval") {
      return json({ error: "Commande invalide." }, 400);
    }
    const intervalSec = Number(body?.intervalSec);
    if (command === "interval" && !isInterval(intervalSec)) return json({ error: "Intervalle invalide." }, 400);
    const commandId = await pushCameraCommand(id, {
      deviceId: targetId,
      action: command,
      intervalSec: command === "interval" ? intervalSec : undefined,
    });
    const cameras = await listLiveCameras(id);
    return json({ cameras: present(cameras, access.group.intervalSec), commandId });
  }

  if (!/^[0-9a-f-]{16,80}$/i.test(deviceId)) return json({ error: "Appareil invalide." }, 400);
  const intervalSec = Number(body?.intervalSec);
  const givenName = String(body?.givenName ?? "").trim().split(/\s+/)[0]?.slice(0, 24) ?? "";
  const status = await touchCamera(id, deviceId, body?.phone === true, {
    camera: body?.camera === true,
    running: body?.running === true,
    intervalSec: isInterval(intervalSec) ? intervalSec : undefined,
    givenName: givenName || undefined,
    ack: Number(body?.ack) > 0 ? Number(body.ack) : undefined,
  });
  const cameras = await listLiveCameras(id);
  return json({
    cameras: present(cameras, access.group.intervalSec),
    command: status.command,
    watch: status.watch,
  });
}
