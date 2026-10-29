import { redirect } from "next/navigation";
import { InviteScreen } from "@/components/InviteScreen";
import { getCurrentUser } from "@/lib/session";
import { previewGroupByCode } from "@/lib/store";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ c?: string | string[] }>;
}) {
  const raw = (await searchParams).c;
  const code = (Array.isArray(raw) ? raw[0] : raw)?.trim().toUpperCase() ?? "";
  if (!/^[A-Z]{5}$/.test(code)) {
    return <InviteScreen invite={null} code="" />;
  }

  const user = await getCurrentUser();
  if (user) redirect(`/${code}`);

  const invite = await previewGroupByCode(code);
  return <InviteScreen invite={invite} code={code} />;
}
