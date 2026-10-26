import { json } from "@/lib/http";
import { getCurrentUser } from "@/lib/session";
import { joinGroup } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return json({ error: "Connexion requise." }, 401);
  const body = await request.json().catch(() => null);
  const group = await joinGroup(user.id, String(body?.code ?? ""));
  if (!group) return json({ error: "Ce code ne correspond à aucun groupe." }, 404);
  return json({
    group: {
      id: group.id,
      name: group.name,
      code: group.code,
    },
  });
}
