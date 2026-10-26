import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { getGroup, isMember } from "@/lib/store";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(`/?next=/groupe/${id}`);
  const group = await getGroup(id);
  if (!group || !isMember(group, user.id) || !group.code) redirect("/groupes");
  redirect(`/${group.code}`);
}
