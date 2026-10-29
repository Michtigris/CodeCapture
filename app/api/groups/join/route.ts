import { json } from "@/lib/http";
import { getCurrentUser } from "@/lib/session";
import { joinGroup } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return json({ error: "Connexion requise." }, 401);
  const body = await request.json().catch(() => null);
  const result = await joinGroup(user.id, String(body?.code ?? ""));
  if (!result || "error" in result) {
    if (result && "error" in result && result.error === "banned") {
      return json({ error: "Tu es banni de ce groupe.", code: "banned" }, 403);
    }
    if (result && "error" in result && result.error === "kicked") {
      return json({ error: "Tu es temporairement exclu.", code: "kicked", until: result.until ?? 0 }, 403);
    }
    return json({ error: "Ce code ne correspond à aucun groupe." }, 404);
  }
  return json({
    group: {
      id: result.id,
      name: result.name,
      code: result.code,
    },
  });
}
