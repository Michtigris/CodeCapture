import { redirect } from "next/navigation";
import { Workspace } from "@/components/Workspace";
import { getCurrentUser } from "@/lib/session";
import { joinGroup } from "@/lib/store";

export default async function Page({ params }: { params: Promise<{ pin: string }> }) {
  const { pin } = await params;
  if (!/^[a-zA-Z]{5}$/.test(pin)) redirect("/groupes");
  const upper = pin.toUpperCase();
  const user = await getCurrentUser();
  if (!user) redirect(`/?next=/${upper}`);
  const group = await joinGroup(user.id, upper);
  if (!group) redirect("/groupes");
  if (pin !== upper) redirect(`/${upper}`);
  return <Workspace groupId={group.id} />;
}
