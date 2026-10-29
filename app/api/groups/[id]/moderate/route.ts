import { json } from "@/lib/http";
import { getCurrentUser } from "@/lib/session";
import { getGroup, isMember, listMembers, moderateMember, type ModerateAction } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const ACTIONS: ModerateAction[] = ["kick", "ban", "unban", "look", "unlook"];

export async function POST(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return json({ error: "Connexion requise." }, 401);
  const group = await getGroup(id);
  if (!group || !isMember(group, user.id)) return json({ error: "Groupe introuvable." }, 404);
  if (group.userId !== user.id) return json({ error: "Réservé au créateur du groupe." }, 403);

  const body = await request.json().catch(() => null);
  const targetId = String(body?.targetId ?? "");
  const action = String(body?.action ?? "") as ModerateAction;
  if (!ACTIONS.includes(action)) return json({ error: "Action invalide." }, 400);
  if (!/^[0-9a-f-]{16,80}$/i.test(targetId)) return json({ error: "Membre invalide." }, 400);

  const result = await moderateMember(id, user.id, targetId, action);
  if ("error" in result) return json({ error: result.error }, result.status);
  return json({ ok: true, members: await listMembers(id) });
}
