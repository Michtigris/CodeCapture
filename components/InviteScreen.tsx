import Link from "next/link";
import type { GroupInvitePreview } from "@/lib/store";
import { Mark } from "./Mark";

type Props = {
  invite: GroupInvitePreview | null;
  code: string;
};

function whenFr(iso: string) {
  const stamp = Date.parse(iso);
  if (!Number.isFinite(stamp)) return "";
  return new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" }).format(stamp);
}

export function InviteScreen({ invite, code }: Props) {
  const next = `/${(invite?.code || code).toUpperCase()}`;
  const loginHref = `/?next=${encodeURIComponent(next)}`;
  const registerHref = `/?next=${encodeURIComponent(next)}&mode=register`;

  if (!invite) {
    return (
      <main className="gate invite-gate">
        <p className="landing-brand">
          <Mark />
          CodeCapture
        </p>
        <section className="invite-card">
          <p className="kicker">Invitation</p>
          <h1>Lien introuvable</h1>
          <p className="lede">
            Ce code ne correspond à aucun groupe. Vérifie le lien, ou demande un nouveau QR au créateur.
          </p>
          <div className="invite-actions">
            <Link className="lime" href="/">
              Aller à CodeCapture
            </Link>
          </div>
        </section>
      </main>
    );
  }

  const created = whenFr(invite.createdAt);

  return (
    <main className="gate invite-gate">
      <p className="landing-brand">
        <Mark />
        CodeCapture
      </p>
      <section className="invite-card">
        <p className="kicker">Invitation</p>
        <h1>{invite.name}</h1>
        <p className="lede">
          Tu es sur le point d’entrer dans ce groupe. Connecte-toi ou crée un compte : le groupe s’ajoute ensuite à ta
          liste, et tu arrives directement dedans.
        </p>
        <dl className="invite-facts">
          <div>
            <dt>Code</dt>
            <dd className="group-code">{invite.code}</dd>
          </div>
          <div>
            <dt>Créé par</dt>
            <dd>{invite.creatorName}</dd>
          </div>
          <div>
            <dt>Membres</dt>
            <dd>
              {invite.memberCount} personne{invite.memberCount > 1 ? "s" : ""}
            </dd>
          </div>
          {created ? (
            <div>
              <dt>Depuis</dt>
              <dd>{created}</dd>
            </div>
          ) : null}
        </dl>
        <div className="invite-actions">
          <Link className="lime" href={loginHref}>
            Se connecter
          </Link>
          <Link className="ghost" href={registerHref}>
            Créer un compte
          </Link>
        </div>
      </section>
    </main>
  );
}
