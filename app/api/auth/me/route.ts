import { json } from "@/lib/http";
import { getCurrentUser, publicUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return json({ error: "Connexion requise." }, 401);
  return json({ user: publicUser(user) });
}
