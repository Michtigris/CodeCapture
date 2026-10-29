import { redirect } from "next/navigation";
import { Workspace } from "@/components/Workspace";
import { getCurrentUser } from "@/lib/session";
import { joinGroup } from "@/lib/store";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ c?: string | string[] }>;
}) {
  const raw = (await searchParams).c;
  const code = (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? "";
  if (!/^[a-zA-Z]{5}$/.test(code)) redirect("/groupes");
  const upper = code.toUpperCase();
  const user = await getCurrentUser();
  if (!user) redirect(`/?next=/${upper}`);
  const group = await joinGroup(user.id, upper);
  if (!group) redirect("/groupes");
  if (code !== upper) redirect(`/${upper}`);
  return <Workspace groupId={group.id} />;
}
